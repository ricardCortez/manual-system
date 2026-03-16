import type { Job } from "bullmq";
import { exec } from "child_process";
import { promisify } from "util";
import path from "path";
import fs from "fs/promises";
import { prisma } from "../plugins/prisma";
import { socketServer } from "../plugins/socket";
import { meiliSearch } from "../plugins/meilisearch";

const execAsync = promisify(exec);

const FFMPEG = process.env.FFMPEG_BIN || "ffmpeg";
const FFPROBE = process.env.FFMPEG_BIN?.replace("ffmpeg", "ffprobe") || "ffprobe";
const THREADS = process.env.FFMPEG_THREADS || "4";
const USE_GPU = process.env.USE_GPU_ENCODING === "true";
const UPLOAD_BASE = process.env.UPLOAD_BASE_PATH || "./uploads";

interface VideoJobData {
  videoAssetId: string;
  originalPath: string;
  documentVersionId: string;
  userId: string;
}

export async function videoProcessor(job: Job<VideoJobData>) {
  const { videoAssetId, originalPath, userId } = job.data;

  const updateStatus = async (
    status: string,
    progress: number,
    extra: Record<string, unknown> = {}
  ) => {
    await prisma.videoAsset.update({
      where: { id: videoAssetId },
      data: {
        processingStatus: status as Parameters<typeof prisma.videoAsset.update>[0]["data"]["processingStatus"],
        processingProgress: progress,
        ...extra,
      },
    });
    socketServer.videoProgress(userId, videoAssetId, {
      step: status,
      percent: progress,
      status: "processing",
    });
  };

  try {
    // ── PASO 2: Validación ─────────────────────────────
    await updateStatus("VALIDATING", 5);
    const probeResult = await execAsync(
      `${FFPROBE} -v error -show_format -show_streams -print_format json "${originalPath}"`
    );
    const probe = JSON.parse(probeResult.stdout) as {
      format: { duration: string; size: string };
      streams: Array<{ codec_type: string; width?: number; height?: number; r_frame_rate?: string }>;
    };

    const videoStream = probe.streams.find((s) => s.codec_type === "video");
    const duration = parseFloat(probe.format.duration);
    const width = videoStream?.width || 0;
    const height = videoStream?.height || 0;

    // ── PASO 3-5: HLS multi-calidad ────────────────────
    await updateStatus("ENCODING", 15);

    const hlsDir = path.join(UPLOAD_BASE, "videos", "hls", videoAssetId);
    await fs.mkdir(hlsDir, { recursive: true });

    // Determinar resoluciones según el video original
    const resolutions: Array<{ name: string; scale: string; bitrate: string }> = [];
    if (height >= 1080) resolutions.push({ name: "1080p", scale: "1920:1080", bitrate: "5000k" });
    if (height >= 720) resolutions.push({ name: "720p", scale: "1280:720", bitrate: "2800k" });
    resolutions.push({ name: "360p", scale: "640:360", bitrate: "800k" });

    const videoCodec = USE_GPU ? "h264_nvenc" : "libx264";
    const hlsStreams: string[] = [];
    const variantStreams: string[] = [];

    for (let i = 0; i < resolutions.length; i++) {
      const res = resolutions[i];
      const resDir = path.join(hlsDir, res.name);
      await fs.mkdir(resDir, { recursive: true });

      await updateStatus("GENERATING_HLS", 20 + i * 15);

      await execAsync(
        `${FFMPEG} -i "${originalPath}" ` +
        `-vf "scale=${res.scale}:force_original_aspect_ratio=decrease,pad=${res.scale}:(ow-iw)/2:(oh-ih)/2" ` +
        `-c:v ${videoCodec} -b:v ${res.bitrate} -maxrate ${res.bitrate} -bufsize ${parseInt(res.bitrate) * 2}k ` +
        `-threads ${THREADS} ` +
        `-c:a aac -b:a 128k -ar 44100 ` +
        `-hls_time 6 -hls_list_size 0 -hls_segment_type mpegts ` +
        `-hls_segment_filename "${resDir}/segment_%03d.ts" ` +
        `"${resDir}/index.m3u8"`,
        { timeout: 3600000 } // 1 hora máximo
      );

      hlsStreams.push(res.name);
      variantStreams.push(
        `#EXT-X-STREAM-INF:BANDWIDTH=${parseInt(res.bitrate) * 1000},RESOLUTION=${res.scale.replace(":", "x")}\n${res.name}/index.m3u8`
      );
    }

    // Master playlist
    const masterContent = "#EXTM3U\n#EXT-X-VERSION:3\n" + variantStreams.join("\n");
    const masterPath = path.join(hlsDir, "master.m3u8");
    await fs.writeFile(masterPath, masterContent);

    // ── PASO 6: Thumbnail ──────────────────────────────
    await updateStatus("GENERATING_HLS", 65);
    const thumbPath = path.join(UPLOAD_BASE, "videos", "thumbnails", `${videoAssetId}.jpg`);
    await fs.mkdir(path.dirname(thumbPath), { recursive: true });

    await execAsync(
      `${FFMPEG} -i "${originalPath}" -ss 10 -vframes 1 -vf "scale=1280:720:force_original_aspect_ratio=decrease" "${thumbPath}"`,
      { timeout: 30000 }
    );

    // ── PASO 7-9: Transcripción Whisper ────────────────
    await updateStatus("EXTRACTING_AUDIO", 70);

    const audioPath = path.join(hlsDir, "audio.wav");
    await execAsync(
      `${FFMPEG} -i "${originalPath}" -ar 16000 -ac 1 -c:a pcm_s16le "${audioPath}"`,
      { timeout: 600000 }
    );

    await updateStatus("TRANSCRIBING", 78);

    const whisperBin = process.env.WHISPER_BIN_PATH || "whisper-cpp";
    const whisperModel = process.env.WHISPER_MODEL_PATH || "./models/ggml-base.bin";
    const vttPath = path.join(hlsDir, "transcript.vtt");

    let transcriptText = "";
    let segments: Array<{ start: number; end: number; text: string }> = [];

    try {
      const vttOutput = path.join(hlsDir, "audio");
      await execAsync(
        `${whisperBin} -m "${whisperModel}" -f "${audioPath}" -l es --output-vtt --output-file "${vttOutput}"`,
        { timeout: 1800000 } // 30 min máximo para transcripción
      );

      const vttContent = await fs.readFile(`${vttOutput}.vtt`, "utf-8");
      await fs.rename(`${vttOutput}.vtt`, vttPath);

      // Parsear VTT para extraer segmentos
      const parsed = parseVTT(vttContent);
      transcriptText = parsed.map((s) => s.text).join(" ");
      segments = parsed;
    } catch (whisperErr) {
      console.warn("[VideoProcessor] Transcripción fallida:", whisperErr);
      // Continuar sin transcripción
    }

    // ── PASO 10: Indexar ──────────────────────────────
    await updateStatus("INDEXING", 90);

    const docVersion = await prisma.documentVersion.findUnique({
      where: { id: job.data.documentVersionId },
      include: {
        document: {
          include: { area: { select: { id: true, name: true } }, author: { select: { name: true } } },
        },
      },
    });

    if (docVersion && transcriptText) {
      await meiliSearch.indexVideo({
        id: docVersion.document.id,
        title: docVersion.document.title,
        description: docVersion.document.description,
        areaId: docVersion.document.areaId,
        areaName: docVersion.document.area.name,
        authorId: docVersion.document.authorId,
        authorName: docVersion.document.author.name,
        tags: docVersion.document.tags,
        transcript: transcriptText,
        status: docVersion.document.status,
        createdAt: docVersion.document.createdAt,
        duration,
      });
    }

    // Actualizar VideoAsset con toda la info
    const fp = parseFloat;
    const fpsStr = videoStream?.r_frame_rate || "30/1";
    const [fpsN, fpsD] = fpsStr.split("/").map(Number);
    const fps = fpsD ? fpsN / fpsD : 30;

    await prisma.videoAsset.update({
      where: { id: videoAssetId },
      data: {
        processingStatus: "COMPLETED",
        processingProgress: 100,
        processingEndAt: new Date(),
        hlsManifestPath: masterPath,
        hlsBasePath: hlsDir,
        resolutions: hlsStreams,
        duration,
        width,
        height,
        fps,
        thumbnailPath: thumbPath,
      },
    });

    // Guardar transcripción si existe
    if (transcriptText && segments.length > 0) {
      await prisma.videoTranscript.create({
        data: {
          videoAssetId,
          fullText: transcriptText,
          language: "es",
          vttPath,
          segments,
          engine: "WHISPER_LOCAL",
          modelUsed: process.env.WHISPER_MODEL_PATH,
        },
      });
    }

    // Notificar al usuario que el video está listo
    socketServer.videoProgress(userId, videoAssetId, {
      step: "COMPLETED",
      percent: 100,
      status: "completed",
    });

    socketServer.notifyUser(userId, "notification", {
      type: "VIDEO_PROCESSING_COMPLETE",
      title: "Video procesado",
      body: "Tu video está listo para visualizar",
      data: { videoAssetId },
    });

    // Limpiar audio temporal
    await fs.unlink(audioPath).catch(() => null);

    return { videoAssetId, status: "COMPLETED", duration, resolutions: hlsStreams };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);

    await prisma.videoAsset.update({
      where: { id: videoAssetId },
      data: {
        processingStatus: "FAILED",
        processingError: errorMessage,
        processingEndAt: new Date(),
      },
    });

    socketServer.videoProgress(userId, videoAssetId, {
      step: "FAILED",
      percent: 0,
      status: "failed",
    });

    throw error;
  }
}

// ──────────────────────────────────────────────────────
// Parser básico de VTT
// ──────────────────────────────────────────────────────
function parseVTT(content: string): Array<{ start: number; end: number; text: string }> {
  const segments: Array<{ start: number; end: number; text: string }> = [];
  const lines = content.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    const timeMatch = line.match(
      /^(\d{2}:\d{2}:\d{2}\.\d{3})\s*-->\s*(\d{2}:\d{2}:\d{2}\.\d{3})/
    );

    if (timeMatch) {
      const textLines: string[] = [];
      let j = i + 1;
      while (j < lines.length && lines[j].trim() !== "") {
        textLines.push(lines[j].trim());
        j++;
      }

      segments.push({
        start: parseVTTTime(timeMatch[1]),
        end: parseVTTTime(timeMatch[2]),
        text: textLines.join(" ").replace(/<[^>]+>/g, ""),
      });
    }
  }

  return segments;
}

function parseVTTTime(time: string): number {
  const parts = time.split(":");
  const [h, m, s] = parts;
  return parseInt(h) * 3600 + parseInt(m) * 60 + parseFloat(s);
}
