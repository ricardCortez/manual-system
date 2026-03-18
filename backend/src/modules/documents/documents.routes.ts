import type { FastifyInstance } from "fastify";
import { z } from "zod";
import path from "path";
import fs from "fs/promises";
import { createWriteStream, createReadStream } from "fs";
import { pipeline } from "stream/promises";
import { exec } from "child_process";
import { promisify } from "util";
import { prisma } from "../../plugins/prisma";
import { meiliSearch } from "../../plugins/meilisearch";
import { authenticate, requireEditor, requireAdmin } from "../../middleware/auth.middleware";
import { createAuditLog, auditDocumentAccess } from "../../middleware/audit.middleware";
import { extractTextFromFile } from "./document.utils";
import { generateThumbnail } from "./thumbnail.utils";
import { convertToPdf } from "./conversion.utils";
import { videoQueue } from "../../jobs/queues";
import type { DocumentStatus, ConfidentialityLevel, DocumentType } from "@prisma/client";

const execAsync = promisify(exec);
const FFPROBE = process.env.FFMPEG_BIN?.replace("ffmpeg", "ffprobe") || "ffprobe";

// All video MIME types → Prisma FileType "VIDEO"
const VIDEO_MIMES: Record<string, string> = {
  "video/mp4": "VIDEO",
  "video/quicktime": "VIDEO",
  "video/x-msvideo": "VIDEO",
  "video/x-matroska": "VIDEO",
  "video/webm": "VIDEO",
  "video/x-ms-wmv": "VIDEO",
  "video/x-flv": "VIDEO",
  "video/mp4v-es": "VIDEO",
};

const UPLOAD_BASE = process.env.UPLOAD_BASE_PATH || "./uploads";

const createDocumentSchema = z.object({
  title: z.string().min(3).max(200),
  code: z.string().min(2).max(50),
  description: z.string().max(1000).optional(),
  type: z.enum(["DOCUMENT", "VIDEO", "DOCUMENT_VIDEO", "MULTIMEDIA"]),
  areaId: z.string(),
  confidentiality: z.enum(["PUBLICO", "RESTRINGIDO", "CRITICO"]).default("PUBLICO"),
  processName: z.string().max(200).optional(),
  subProcess: z.string().max(200).optional(),
  effectiveDate: z.string().datetime().optional(),
  expiryDate: z.string().datetime().optional(),
  reviewDate: z.string().datetime().optional(),
  tags: z.array(z.string()).default([]),
});

const listDocumentsSchema = z.object({
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(100).default(20),
  areaId: z.string().optional(),
  status: z.string().optional(),
  type: z.string().optional(),
  confidentiality: z.string().optional(),
  search: z.string().optional(),
  tags: z.string().optional(), // CSV de tags
  sort: z.enum(["createdAt", "updatedAt", "title"]).default("updatedAt"),
  order: z.enum(["asc", "desc"]).default("desc"),
});

/**
 * Validates video file using ffprobe for early detection of invalid videos
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
      throw new Error("No video stream found");
    }

    const duration = parseFloat(probe.format.duration);
    const width = videoStream.width || 0;
    const height = videoStream.height || 0;
    const codec = videoStream.codec_name || "unknown";

    if (duration < MIN_DURATION || duration > MAX_DURATION) {
      throw new Error(
        `Duration ${duration}s out of range [${MIN_DURATION}s, ${MAX_DURATION}s]`
      );
    }

    if (width > 4096 || height > 4096) {
      throw new Error(`Resolution ${width}x${height} exceeds 4K limit`);
    }

    return { duration, width, height, codec };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes("timeout")) {
      throw new Error("Validation timeout — file may be corrupted");
    }
    throw new Error(`Video validation failed: ${message}`);
  }
}

export async function documentRoutes(app: FastifyInstance) {
  // Todas las rutas requieren autenticación
  app.addHook("preHandler", authenticate);

  // ── GET /api/v1/documents ────────────────────────────
  app.get("/", async (request) => {
    const params = listDocumentsSchema.parse(request.query);
    const skip = (params.page - 1) * params.limit;
    const tags = params.tags ? params.tags.split(",") : undefined;

    const where = {
      isDeleted: false,
      ...(params.areaId && { areaId: params.areaId }),
      ...(params.status && { status: params.status as DocumentStatus }),
      ...(params.type && { type: params.type as DocumentType }),
      ...(params.confidentiality && { confidentiality: params.confidentiality as ConfidentialityLevel }),
      ...(tags?.length && { tags: { hasSome: tags } }),
    };

    const [documents, total] = await prisma.$transaction([
      prisma.document.findMany({
        where,
        skip,
        take: params.limit,
        orderBy: { [params.sort]: params.order },
        select: {
          id: true,
          title: true,
          code: true,
          description: true,
          type: true,
          status: true,
          confidentiality: true,
          tags: true,
          processName: true,
          expiryDate: true,
          createdAt: true,
          updatedAt: true,
          area: { select: { id: true, name: true, code: true } },
          author: { select: { id: true, name: true } },
          currentVersionId: true,
        },
      }),
      prisma.document.count({ where }),
    ]);

    return {
      data: documents,
      pagination: {
        page: params.page,
        limit: params.limit,
        total,
        pages: Math.ceil(total / params.limit),
      },
    };
  });

  // ── GET /api/v1/documents/:id ────────────────────────
  app.get<{ Params: { id: string } }>("/:id", async (request, reply) => {
    const { id } = request.params;

    const document = await prisma.document.findFirst({
      where: { id, isDeleted: false },
      include: {
        area: { select: { id: true, name: true, code: true } },
        author: { select: { id: true, name: true, email: true } },
        meta: true,
        versions: {
          orderBy: [{ versionMajor: "desc" }, { versionMinor: "desc" }, { versionPatch: "desc" }],
          select: {
            id: true,
            versionLabel: true,
            versionMajor: true,
            versionMinor: true,
            versionPatch: true,
            changelog: true,
            fileType: true,
            mimeType: true,
            fileSize: true,
            filePath: true,
            thumbnailPath: true,
            pageCount: true,
            extractedText: true,
            createdAt: true,
            createdBy: { select: { id: true, name: true } },
            videoAsset: {
              select: {
                id: true,
                processingStatus: true,
                processingProgress: true,
                hlsManifestPath: true,
                thumbnailPath: true,
                duration: true,
                resolutions: true,
                transcript: {
                  select: {
                    id: true,
                    vttPath: true,
                    segments: true,
                  },
                },
                chapters: {
                  orderBy: { startSeconds: "asc" },
                },
              },
            },
          },
        },
      },
    });

    if (!document) {
      return reply.status(404).send({ statusCode: 404, error: "Not Found", message: "Documento no encontrado" });
    }

    // Registrar visualización
    await auditDocumentAccess(request.user.id, document.id, document.currentVersionId || "", "DOCUMENT_VIEWED", request);

    // Actualizar historial reciente
    await prisma.userRecentDocument.upsert({
      where: { userId_documentId: { userId: request.user.id, documentId: id } },
      create: { userId: request.user.id, documentId: id, viewedAt: new Date(), viewCount: 1 },
      update: { viewedAt: new Date(), viewCount: { increment: 1 } },
    });

    return document;
  });

  // ── POST /api/v1/documents ───────────────────────────
  app.post(
    "/",
    { preHandler: [requireEditor] },
    async (request, reply) => {
      const data = createDocumentSchema.parse(request.body);

      // Verificar código único
      const existing = await prisma.document.findUnique({ where: { code: data.code } });
      if (existing) {
        return reply.status(409).send({
          statusCode: 409,
          error: "Conflict",
          message: `Ya existe un documento con el código ${data.code}`,
        });
      }

      const document = await prisma.document.create({
        data: {
          ...data,
          authorId: request.user.id,
          effectiveDate: data.effectiveDate ? new Date(data.effectiveDate) : undefined,
          expiryDate: data.expiryDate ? new Date(data.expiryDate) : undefined,
          reviewDate: data.reviewDate ? new Date(data.reviewDate) : undefined,
        },
        include: {
          area: { select: { id: true, name: true } },
          author: { select: { id: true, name: true } },
        },
      });

      await createAuditLog({
        userId: request.user.id,
        action: "DOCUMENT_CREATED",
        entityType: "Document",
        entityId: document.id,
        documentId: document.id,
        request,
      });

      return reply.status(201).send(document);
    }
  );

  // ── POST /api/v1/documents/:id/upload ────────────────
  // Subida de archivo para una versión del documento
  app.post<{ Params: { id: string } }>(
    "/:id/upload",
    {
      preHandler: [requireEditor],
      config: { rateLimit: { max: 10, timeWindow: "5m" } }, // Límite especial para uploads
    },
    async (request, reply) => {
      const { id } = request.params;

      const document = await prisma.document.findFirst({
        where: { id, isDeleted: false },
        include: { versions: { orderBy: { createdAt: "desc" }, take: 1 } },
      });

      if (!document) {
        return reply.status(404).send({ statusCode: 404, error: "Not Found", message: "Documento no encontrado" });
      }

      const data = await request.file();
      if (!data) {
        return reply.status(400).send({ statusCode: 400, error: "Bad Request", message: "No se recibió archivo" });
      }

      const fields = data.fields as Record<string, { value: string }>;
      const isVideoMime = data.mimetype in VIDEO_MIMES;
      const isVideoDoc = document.type === "VIDEO" || document.type === "DOCUMENT_VIDEO";

      // Validar MIME type real
      const allowedMimes = (process.env.ALLOWED_DOC_TYPES || "").split(",");
      if (!isVideoMime && !allowedMimes.includes(data.mimetype)) {
        return reply.status(415).send({
          statusCode: 415,
          error: "Unsupported Media Type",
          message: `Tipo de archivo no permitido: ${data.mimetype}`,
        });
      }
      if (isVideoMime && !isVideoDoc) {
        return reply.status(415).send({
          statusCode: 415,
          error: "Unsupported Media Type",
          message: "Solo los documentos de tipo VIDEO pueden recibir archivos de video.",
        });
      }

      // Determinar versión semántica (los campos de multipart están en data.fields, no en request.body)
      const versionType = (fields.versionType?.value ?? "minor") as "major" | "minor" | "patch";
      const lastVersion = document.versions[0];
      const major = lastVersion?.versionMajor ?? 0;
      const minor = lastVersion?.versionMinor ?? 0;
      const patch = lastVersion?.versionPatch ?? 0;

      let newMajor = major, newMinor = minor, newPatch = patch;
      if (versionType === "major") { newMajor++; newMinor = 0; newPatch = 0; }
      else if (versionType === "minor") { newMinor++; newPatch = 0; }
      else { newPatch++; }

      const versionLabel = `${newMajor}.${newMinor}.${newPatch}`;

      // ── Ruta VIDEO ───────────────────────────────────────
      if (isVideoMime) {
        const origDir = path.join(UPLOAD_BASE, "videos", "originals");
        await fs.mkdir(origDir, { recursive: true });

        const ext = path.extname(data.filename || ".mp4") || ".mp4";
        const tempFile = path.join(origDir, `tmp_${Date.now()}${ext}`);
        await pipeline(data.file, createWriteStream(tempFile));
        const stat = await fs.stat(tempFile);

        // ── EARLY VALIDATION: Validate video before processing ──
        let videoInfo;
        try {
          videoInfo = await validateVideoFile(tempFile);
          if (!videoInfo) {
            throw new Error("Video validation returned no data");
          }
        } catch (validationErr) {
          await fs.unlink(tempFile).catch(() => null);
          const errMsg = validationErr instanceof Error ? validationErr.message : String(validationErr);
          return reply.status(400).send({
            statusCode: 400,
            error: "Bad Request",
            message: `Video validation failed: ${errMsg}`,
          });
        }

        // Crear DocumentVersion sin filePath (el video se procesará aparte)
        const version = await prisma.documentVersion.create({
          data: {
            documentId: id,
            versionMajor: newMajor,
            versionMinor: newMinor,
            versionPatch: newPatch,
            versionLabel,
            changelog: fields.changelog?.value,
            filePath: tempFile,
            fileType: (VIDEO_MIMES[data.mimetype] || "VIDEO") as Parameters<typeof prisma.documentVersion.create>[0]["data"]["fileType"],
            fileSize: stat.size,
            mimeType: data.mimetype,
            originalName: data.filename,
            createdById: request.user.id,
          },
        });

        // Renombrar archivo usando el versionId
        const finalFile = path.join(origDir, `${version.id}${ext}`);
        await fs.rename(tempFile, finalFile);
        await prisma.documentVersion.update({ where: { id: version.id }, data: { filePath: finalFile } });

        // Actualizar versión actual del documento
        await prisma.document.update({ where: { id }, data: { currentVersionId: version.id } });

        // Crear VideoAsset y encolar procesamiento
        const videoAsset = await prisma.videoAsset.create({
          data: {
            documentVersionId: version.id,
            originalPath: finalFile,
            originalSize: stat.size,
            originalFormat: ext.slice(1).toLowerCase(),
            processingStatus: "PENDING",
          },
        });

        await videoQueue.add("process-video", {
          videoAssetId: videoAsset.id,
          originalPath: finalFile,
          documentVersionId: version.id,
          userId: request.user.id,
        }, { priority: 1 });

        await createAuditLog({
          userId: request.user.id,
          action: "DOCUMENT_VERSION_UPLOADED",
          entityType: "DocumentVersion",
          entityId: version.id,
          documentId: id,
          documentVersionId: version.id,
          metadata: { version: versionLabel, fileType: "VIDEO", fileSize: stat.size, videoAssetId: videoAsset.id },
          request,
        });

        return reply.status(201).send({ ...version, videoAssetId: videoAsset.id, processingStatus: "PENDING" });
      }

      // ── Ruta DOCUMENTO ───────────────────────────────────
      const destDir = path.join(UPLOAD_BASE, "documents", id);
      await fs.mkdir(destDir, { recursive: true });

      const ext = path.extname(data.filename);
      const fileName = `v${versionLabel}${ext}`;
      const filePath = path.join(destDir, fileName);

      // Guardar archivo
      await pipeline(data.file, createWriteStream(filePath));
      const stat = await fs.stat(filePath);

      // Convertir a PDF si es necesario (DOCX, XLSX, PPTX)
      let finalPath = filePath;
      let finalMime = data.mimetype;
      const mimeToFileType: Record<string, string> = {
        "application/pdf": "PDF",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "DOCX",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "XLSX",
        "application/vnd.openxmlformats-officedocument.presentationml.presentation": "PPTX",
        "text/markdown": "MD",
        "image/png": "PNG",
        "image/jpeg": "JPG",
        "image/webp": "WEBP",
      };

      const needsConversion = ["DOCX", "XLSX", "PPTX"].includes(mimeToFileType[data.mimetype] || "");
      if (needsConversion) {
        finalPath = await convertToPdf(filePath, destDir);
        finalMime = "application/pdf";
      }

      // Extraer texto
      const extractedText = await extractTextFromFile(finalPath, finalMime);

      // Generar thumbnail
      const thumbnailPath = await generateThumbnail(finalPath, finalMime, destDir, versionLabel);

      const fileType = (mimeToFileType[finalMime] || "PDF") as Parameters<typeof prisma.documentVersion.create>[0]["data"]["fileType"];

      const version = await prisma.documentVersion.create({
        data: {
          documentId: id,
          versionMajor: newMajor,
          versionMinor: newMinor,
          versionPatch: newPatch,
          versionLabel,
          changelog: fields.changelog?.value,
          filePath: finalPath,
          fileType,
          fileSize: stat.size,
          mimeType: finalMime,
          originalName: data.filename,
          extractedText,
          thumbnailPath,
          createdById: request.user.id,
        },
      });

      // Actualizar versión actual del documento
      await prisma.document.update({
        where: { id },
        data: { currentVersionId: version.id },
      });

      // Indexar en MeiliSearch
      await meiliSearch.indexDocument({
        id,
        title: document.title,
        description: document.description,
        code: document.code,
        type: document.type,
        status: document.status,
        confidentiality: document.confidentiality,
        areaId: document.areaId,
        areaName: "", // Se complementa con join
        authorId: document.authorId,
        authorName: request.user.name,
        tags: document.tags,
        processName: document.processName,
        thumbnailPath,
        extractedText,
        updatedAt: new Date(),
      });

      await createAuditLog({
        userId: request.user.id,
        action: "DOCUMENT_VERSION_UPLOADED",
        entityType: "DocumentVersion",
        entityId: version.id,
        documentId: id,
        documentVersionId: version.id,
        metadata: { version: versionLabel, fileType, fileSize: stat.size },
        request,
      });

      return reply.status(201).send(version);
    }
  );

  // ── POST /api/v1/documents/:id/upload-chunk ──────────
  // Chunked upload handler for large files (5MB chunks)
  app.post<{ Params: { id: string } }>(
    "/:id/upload-chunk",
    {
      preHandler: [requireEditor],
      config: { rateLimit: { max: 100, timeWindow: "5m" } }, // More lenient for chunks
    },
    async (request, reply) => {
      const { id } = request.params;
      const data = await request.file();

      if (!data) {
        return reply.status(400).send({ statusCode: 400, error: "Bad Request", message: "No chunk received" });
      }

      const fields = data.fields as Record<string, { value: string }>;
      const chunkIndex = parseInt(fields.chunkIndex?.value || "0");
      const totalChunks = parseInt(fields.totalChunks?.value || "1");
      const uploadSessionId = fields.uploadSessionId?.value || `session_${id}_${Date.now()}`;
      const fileName = fields.fileName?.value || "video.mp4";
      const fileSize = parseInt(fields.fileSize?.value || "0");

      const document = await prisma.document.findFirst({ where: { id, isDeleted: false } });
      if (!document) {
        return reply.status(404).send({ statusCode: 404, error: "Not Found", message: "Document not found" });
      }

      // Create temp directory for chunks
      const chunkDir = path.join(UPLOAD_BASE, ".tmp", uploadSessionId);
      await fs.mkdir(chunkDir, { recursive: true });

      const chunkPath = path.join(chunkDir, `chunk_${chunkIndex}`);

      try {
        // Save chunk
        await pipeline(data.file, createWriteStream(chunkPath));

        // If first chunk, validate video header
        if (chunkIndex === 0) {
          try {
            // Temporarily concat first chunk to check header
            const tempPath = path.join(chunkDir, "temp_validation");
            await pipeline(createReadStream(chunkPath), createWriteStream(tempPath));

            // Try to validate (will work for complete files or first chunk only if format allows)
            await validateVideoFile(tempPath);
            await fs.unlink(tempPath).catch(() => null);
          } catch (validationErr) {
            // Clean up session on validation failure
            await fs.rm(chunkDir, { recursive: true, force: true });
            const errMsg = validationErr instanceof Error ? validationErr.message : String(validationErr);
            return reply.status(400).send({
              statusCode: 400,
              error: "Bad Request",
              message: `Video validation failed: ${errMsg}. Upload cancelled.`,
            });
          }
        }

        // Check if all chunks received
        if (chunkIndex === totalChunks - 1) {
          try {
            // Assemble final file
            const origDir = path.join(UPLOAD_BASE, "videos", "originals");
            await fs.mkdir(origDir, { recursive: true });

            const ext = path.extname(fileName) || ".mp4";
            const versionId = `${id}_${Date.now()}`;
            const finalPath = path.join(origDir, `${versionId}${ext}`);

            // Concatenate all chunks using fs operations
            const writeStream = createWriteStream(finalPath);
            for (let i = 0; i < totalChunks; i++) {
              const chunkPath = path.join(chunkDir, `chunk_${i}`);
              const chunkData = await fs.readFile(chunkPath);
              writeStream.write(chunkData);
            }
            await new Promise((resolve, reject) => {
              writeStream.end(() => resolve(undefined));
              writeStream.on("error", reject);
            });

            // Verify final file
            const stat = await fs.stat(finalPath);
            if (stat.size !== fileSize) {
              await fs.unlink(finalPath).catch(() => null);
              await fs.rm(chunkDir, { recursive: true, force: true });
              return reply.status(400).send({
                statusCode: 400,
                error: "Bad Request",
                message: `File size mismatch: expected ${fileSize}, got ${stat.size}`,
              });
            }

            // Clean up chunk directory
            await fs.rm(chunkDir, { recursive: true, force: true });

            return reply.status(200).send({
              uploadSessionId,
              totalChunks,
              finalPath,
              fileSize: stat.size,
              message: "All chunks received and assembled",
            });
          } catch (assemblyErr) {
            await fs.rm(chunkDir, { recursive: true, force: true });
            const errMsg = assemblyErr instanceof Error ? assemblyErr.message : String(assemblyErr);
            return reply.status(500).send({
              statusCode: 500,
              error: "Internal Server Error",
              message: `Failed to assemble chunks: ${errMsg}`,
            });
          }
        }

        // Chunk saved, waiting for more
        return reply.status(202).send({
          uploadSessionId,
          chunkIndex,
          totalChunks,
          message: `Chunk ${chunkIndex + 1} of ${totalChunks} received`,
        });
      } catch (err) {
        // Clean up on error
        await fs.rm(chunkDir, { recursive: true, force: true });
        const errMsg = err instanceof Error ? err.message : String(err);
        return reply.status(500).send({
          statusCode: 500,
          error: "Internal Server Error",
          message: `Chunk upload failed: ${errMsg}`,
        });
      }
    }
  );

  // ── PATCH /api/v1/documents/:id/status ───────────────
  app.patch<{ Params: { id: string } }>(
    "/:id/status",
    { preHandler: [requireEditor] },
    async (request, reply) => {
      const { id } = request.params;
      const { status, justification } = request.body as { status: DocumentStatus; justification?: string };

      const allowed: DocumentStatus[] = ["BORRADOR", "EN_REVISION", "APROBADO", "PUBLICADO", "OBSOLETO"];
      if (!allowed.includes(status)) {
        return reply.status(400).send({ statusCode: 400, error: "Bad Request", message: "Estado inválido" });
      }

      const document = await prisma.document.update({
        where: { id, isDeleted: false },
        data: { status },
      });

      await createAuditLog({
        userId: request.user.id,
        action: "DOCUMENT_STATUS_CHANGED",
        documentId: id,
        metadata: { newStatus: status, justification },
        request,
      });

      // Actualizar en MeiliSearch
      await meiliSearch.indexDocument({
        id,
        title: document.title,
        description: document.description,
        code: document.code,
        type: document.type,
        status: document.status,
        confidentiality: document.confidentiality,
        areaId: document.areaId,
        areaName: "",
        authorId: document.authorId,
        authorName: "",
        tags: document.tags,
        thumbnailPath: null,
        extractedText: null,
        updatedAt: new Date(),
      });

      return document;
    }
  );

  // ── DELETE /api/v1/documents/:id (soft delete) ───────
  app.delete<{ Params: { id: string } }>(
    "/:id",
    { preHandler: [requireAdmin] },
    async (request, reply) => {
      const { id } = request.params;

      await prisma.document.update({
        where: { id },
        data: { isDeleted: true, deletedAt: new Date() },
      });

      await meiliSearch.deleteDocument(id);
      await createAuditLog({
        userId: request.user.id,
        action: "DOCUMENT_DELETED",
        documentId: id,
        request,
      });

      return reply.status(204).send();
    }
  );

  // ── POST /api/v1/documents/:id/favorite ──────────────
  app.post<{ Params: { id: string } }>("/:id/favorite", async (request, reply) => {
    await prisma.userFavorite.upsert({
      where: { userId_documentId: { userId: request.user.id, documentId: request.params.id } },
      create: { userId: request.user.id, documentId: request.params.id },
      update: {},
    });
    return reply.status(204).send();
  });

  app.delete<{ Params: { id: string } }>("/:id/favorite", async (request, reply) => {
    await prisma.userFavorite.deleteMany({
      where: { userId: request.user.id, documentId: request.params.id },
    });
    return reply.status(204).send();
  });

  // ── POST /api/v1/documents/:id/confirm-read ──────────
  app.post<{ Params: { id: string } }>("/:id/confirm-read", async (request, reply) => {
    const { id } = request.params;
    const { versionId } = request.body as { versionId: string };

    const crypto = await import("crypto");
    const hash = crypto
      .createHash("sha256")
      .update(`${request.user.id}:${versionId}:${Date.now()}`)
      .digest("hex");

    await prisma.readConfirmation.upsert({
      where: { userId_documentVersionId: { userId: request.user.id, documentVersionId: versionId } },
      create: {
        userId: request.user.id,
        documentId: id,
        documentVersionId: versionId,
        hash,
      },
      update: { confirmedAt: new Date(), hash },
    });

    return reply.status(201).send({ hash, confirmedAt: new Date() });
  });
}
