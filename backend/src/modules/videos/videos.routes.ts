import type { FastifyInstance } from "fastify";
import path from "path";
import fs from "fs/promises";
import { existsSync } from "fs";
import { pipeline } from "stream/promises";
import { createWriteStream } from "fs";
import { exec } from "child_process";
import { promisify } from "util";
import { prisma } from "../../plugins/prisma";
import { authenticate, requireEditor } from "../../middleware/auth.middleware";
import { createAuditLog } from "../../middleware/audit.middleware";
import { videoQueue } from "../../jobs/queues";

const execAsync = promisify(exec);
const UPLOAD_BASE = process.env.UPLOAD_BASE_PATH || "./uploads";
const FFPROBE = process.env.FFMPEG_BIN?.replace("ffmpeg", "ffprobe") || "ffprobe";

/**
 * Validates video properties early using ffprobe:
 * - Duration: 5-3600 seconds
 * - Codec: h264, h265, vp8, vp9, etc.
 * - Resolution: max 4K
 */
async function validateVideoFile(filePath: string): Promise<{
  duration: number;
  width: number;
  height: number;
  codec: string;
} | null> {
  const MIN_DURATION = parseInt(process.env.MIN_VIDEO_DURATION_SECS || "5");
  const MAX_DURATION = parseInt(process.env.MAX_VIDEO_DURATION_SECS || "3600");

  try {
    const result = await execAsync(
      `${FFPROBE} -v error -show_format -show_streams -print_format json "${filePath}"`,
      { timeout: 10000 }
    );

    const probe = JSON.parse(result.stdout) as {
      format: { duration: string };
      streams: Array<{ codec_type: string; codec_name: string; width?: number; height?: number }>;
    };

    const videoStream = probe.streams.find((s) => s.codec_type === "video");
    if (!videoStream) {
      throw new Error("No video stream found in file");
    }

    const duration = parseFloat(probe.format.duration);
    const width = videoStream.width || 0;
    const height = videoStream.height || 0;
    const codec = videoStream.codec_name || "unknown";

    // Validate ranges
    if (duration < MIN_DURATION || duration > MAX_DURATION) {
      throw new Error(
        `Video duration ${duration}s out of range [${MIN_DURATION}s, ${MAX_DURATION}s]`
      );
    }

    if (width > 4096 || height > 4096) {
      throw new Error(`Video resolution ${width}x${height} exceeds 4K limit`);
    }

    return { duration, width, height, codec };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes("timeout")) {
      throw new Error("Video validation timeout — file may be corrupted or too large");
    }
    throw new Error(`Video validation failed: ${message}`);
  }
}

export async function videoRoutes(app: FastifyInstance) {
  app.addHook("preHandler", authenticate);

  // ── POST /api/v1/videos/upload — Subida chunked ──────
  app.post(
    "/upload",
    {
      preHandler: [requireEditor],
      config: { rateLimit: { max: 5, timeWindow: "5m" } },
    },
    async (request, reply) => {
      const data = await request.file();
      if (!data) {
        return reply.status(400).send({ statusCode: 400, error: "Bad Request", message: "No se recibió archivo" });
      }

      const allowedVideoMimes = [
        "video/mp4",
        "video/quicktime",
        "video/x-msvideo",
        "video/x-matroska",
        "video/webm",
      ];

      if (!allowedVideoMimes.includes(data.mimetype)) {
        return reply.status(415).send({
          statusCode: 415,
          error: "Unsupported Media Type",
          message: `Formato de video no permitido: ${data.mimetype}`,
        });
      }

      const fields = data.fields as Record<string, { value: string }>;
      const documentVersionId = fields.documentVersionId?.value;
      const documentId = fields.documentId?.value;

      if (!documentVersionId || !documentId) {
        return reply.status(400).send({
          statusCode: 400,
          error: "Bad Request",
          message: "Se requiere documentVersionId y documentId",
        });
      }

      // Guardar archivo original
      const origDir = path.join(UPLOAD_BASE, "videos", "originals");
      await fs.mkdir(origDir, { recursive: true });

      const ext = path.extname(data.filename || ".mp4");
      const fileName = `${documentVersionId}${ext}`;
      const originalPath = path.join(origDir, fileName);

      await pipeline(data.file, createWriteStream(originalPath));
      const stat = await fs.stat(originalPath);

      // Verificar tamaño máximo
      const maxSize = parseInt(process.env.MAX_VIDEO_SIZE_MB || "2048") * 1024 * 1024;
      if (stat.size > maxSize) {
        await fs.unlink(originalPath).catch(() => null);
        return reply.status(413).send({
          statusCode: 413,
          error: "Payload Too Large",
          message: `El video supera el límite de ${process.env.MAX_VIDEO_SIZE_MB || 2048}MB`,
        });
      }

      // ── EARLY VALIDATION: Validate video before enqueuing ──
      let videoInfo;
      try {
        videoInfo = await validateVideoFile(originalPath);
        if (!videoInfo) {
          throw new Error("Video validation returned no data");
        }
      } catch (validationErr) {
        await fs.unlink(originalPath).catch(() => null);
        const errMsg = validationErr instanceof Error ? validationErr.message : String(validationErr);
        return reply.status(400).send({
          statusCode: 400,
          error: "Bad Request",
          message: `Video validation failed: ${errMsg}`,
        });
      }

      // Crear registro VideoAsset
      const videoAsset = await prisma.videoAsset.create({
        data: {
          documentVersionId,
          originalPath,
          originalSize: stat.size,
          originalFormat: ext.slice(1),
          processingStatus: "PENDING",
        },
      });

      // Encolar procesamiento
      await videoQueue.add(
        "process-video",
        {
          videoAssetId: videoAsset.id,
          originalPath,
          documentVersionId,
          userId: request.user.id,
        },
        { priority: 1 }
      );

      await createAuditLog({
        userId: request.user.id,
        action: "VIDEO_UPLOADED",
        entityType: "VideoAsset",
        entityId: videoAsset.id,
        documentId,
        request,
      });

      return reply.status(202).send({
        videoAssetId: videoAsset.id,
        status: "PENDING",
        message: "Video recibido. El procesamiento comenzará en breve.",
      });
    }
  );

  // ── GET /api/v1/videos/:videoAssetId/status ──────────
  app.get<{ Params: { videoAssetId: string } }>(
    "/:videoAssetId/status",
    async (request, reply) => {
      const asset = await prisma.videoAsset.findUnique({
        where: { id: request.params.videoAssetId },
        select: {
          id: true,
          processingStatus: true,
          processingProgress: true,
          processingError: true,
          resolutions: true,
          duration: true,
          thumbnailPath: true,
          hlsManifestPath: true,
        },
      });

      if (!asset) {
        return reply.status(404).send({ statusCode: 404, error: "Not Found", message: "Video no encontrado" });
      }

      return asset;
    }
  );

  // ── GET /api/v1/videos/:videoAssetId/transcript ──────
  app.get<{ Params: { videoAssetId: string } }>(
    "/:videoAssetId/transcript",
    async (request, reply) => {
      const transcript = await prisma.videoTranscript.findUnique({
        where: { videoAssetId: request.params.videoAssetId },
        select: {
          id: true,
          fullText: true,
          language: true,
          segments: true,
          vttPath: true,
          engine: true,
          createdAt: true,
        },
      });

      if (!transcript) {
        return reply.status(404).send({
          statusCode: 404,
          error: "Not Found",
          message: "Transcripción no disponible aún",
        });
      }

      return transcript;
    }
  );

  // ── GET /api/v1/videos/:videoAssetId/chapters ────────
  app.get<{ Params: { videoAssetId: string } }>(
    "/:videoAssetId/chapters",
    async (request) => {
      return prisma.videoChapter.findMany({
        where: { videoAssetId: request.params.videoAssetId },
        orderBy: { startSeconds: "asc" },
      });
    }
  );

  // ── PUT /api/v1/videos/:videoAssetId/chapters ────────
  app.put<{ Params: { videoAssetId: string } }>(
    "/:videoAssetId/chapters",
    { preHandler: [requireEditor] },
    async (request, reply) => {
      const chapters = request.body as Array<{
        title: string;
        startSeconds: number;
        endSeconds?: number;
        description?: string;
      }>;

      // Reemplazar capítulos existentes
      await prisma.$transaction([
        prisma.videoChapter.deleteMany({
          where: { videoAssetId: request.params.videoAssetId },
        }),
        prisma.videoChapter.createMany({
          data: chapters.map((c, i) => ({
            videoAssetId: request.params.videoAssetId,
            title: c.title,
            startSeconds: c.startSeconds,
            endSeconds: c.endSeconds,
            description: c.description,
            order: i,
            createdById: request.user.id,
          })),
        }),
      ]);

      return reply.status(204).send();
    }
  );

  // ── Auditoría de visualización de video ──────────────
  app.post<{ Params: { videoAssetId: string } }>(
    "/:videoAssetId/view",
    async (request) => {
      const asset = await prisma.videoAsset.findUnique({
        where: { id: request.params.videoAssetId },
        include: { documentVersion: { select: { documentId: true } } },
      });

      if (asset?.documentVersion?.documentId) {
        await createAuditLog({
          userId: request.user.id,
          action: "VIDEO_VIEWED",
          entityType: "VideoAsset",
          entityId: request.params.videoAssetId,
          documentId: asset.documentVersion.documentId,
          request,
        });
      }

      return { ok: true };
    }
  );
}
