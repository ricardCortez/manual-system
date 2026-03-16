import type { FastifyInstance } from "fastify";
import path from "path";
import fs from "fs/promises";
import { createReadStream, existsSync } from "fs";
import { pipeline } from "stream/promises";
import { prisma } from "../../plugins/prisma";
import { authenticate, requireEditor } from "../../middleware/auth.middleware";
import { createAuditLog } from "../../middleware/audit.middleware";
import { videoQueue } from "../../jobs/queues";

const UPLOAD_BASE = process.env.UPLOAD_BASE_PATH || "./uploads";

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

      await pipeline(data.file, createReadStream(originalPath) as never);
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
