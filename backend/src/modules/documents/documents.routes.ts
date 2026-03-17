import type { FastifyInstance } from "fastify";
import { z } from "zod";
import path from "path";
import fs from "fs/promises";
import { createWriteStream } from "fs";
import { pipeline } from "stream/promises";
import { prisma } from "../../plugins/prisma";
import { meiliSearch } from "../../plugins/meilisearch";
import { authenticate, requireEditor, requireAdmin } from "../../middleware/auth.middleware";
import { createAuditLog, auditDocumentAccess } from "../../middleware/audit.middleware";
import { extractTextFromFile } from "./document.utils";
import { generateThumbnail } from "./thumbnail.utils";
import { convertToPdf } from "./conversion.utils";
import type { DocumentStatus, ConfidentialityLevel, DocumentType } from "@prisma/client";

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
            fileSize: true,
            thumbnailPath: true,
            pageCount: true,
            createdAt: true,
            createdBy: { select: { id: true, name: true } },
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

      // Validar MIME type real
      const allowedMimes = (process.env.ALLOWED_DOC_TYPES || "").split(",");
      if (!allowedMimes.includes(data.mimetype)) {
        return reply.status(415).send({
          statusCode: 415,
          error: "Unsupported Media Type",
          message: `Tipo de archivo no permitido: ${data.mimetype}`,
        });
      }

      // Determinar versión semántica
      const { versionType = "minor" } = request.body as { versionType?: "major" | "minor" | "patch" };
      const lastVersion = document.versions[0];
      const major = lastVersion?.versionMajor ?? 0;
      const minor = lastVersion?.versionMinor ?? 0;
      const patch = lastVersion?.versionPatch ?? 0;

      let newMajor = major, newMinor = minor, newPatch = patch;
      if (versionType === "major") { newMajor++; newMinor = 0; newPatch = 0; }
      else if (versionType === "minor") { newMinor++; newPatch = 0; }
      else { newPatch++; }

      const versionLabel = `${newMajor}.${newMinor}.${newPatch}`;
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

      // Contar páginas (solo PDF)
      let pageCount: number | undefined;
      if (finalMime === "application/pdf") {
        // Se calcula durante extracción de texto
      }

      const fileType = (mimeToFileType[finalMime] || "PDF") as Parameters<typeof prisma.documentVersion.create>[0]["data"]["fileType"];

      const version = await prisma.documentVersion.create({
        data: {
          documentId: id,
          versionMajor: newMajor,
          versionMinor: newMinor,
          versionPatch: newPatch,
          versionLabel,
          changelog: (request.body as { changelog?: string }).changelog,
          filePath: finalPath,
          fileType,
          fileSize: stat.size,
          mimeType: finalMime,
          originalName: data.filename,
          extractedText,
          thumbnailPath,
          pageCount,
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
