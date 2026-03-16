import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../../plugins/prisma";
import { authenticate } from "../../middleware/auth.middleware";
import { createAuditLog } from "../../middleware/audit.middleware";
import { aiQueue } from "../../jobs/queues";
import { checkAIUsageLimit } from "./ai.utils";
import { ragChat } from "./chat";

const generateSummarySchema = z.object({
  documentVersionId: z.string(),
  summaryType: z.enum(["EXECUTIVE", "BULLETS", "BRIEF", "GLOSSARY", "COMPARATIVE"]),
  summaryLength: z.enum(["SHORT", "MEDIUM", "DETAILED"]).default("MEDIUM"),
  compareDocIds: z.array(z.string()).optional(), // Para COMPARATIVE
  forceRegenerate: z.boolean().default(false),
});

const chatSchema = z.object({
  documentVersionId: z.string(),
  question: z.string().min(3).max(1000),
  sessionId: z.string().optional(),
});

export async function aiRoutes(app: FastifyInstance) {
  app.addHook("preHandler", authenticate);

  // ── POST /api/v1/ai/summary ──────────────────────────
  app.post(
    "/summary",
    {
      schema: {
        tags: ["IA"],
        summary: "Generar resumen automático de un documento",
      },
      config: { rateLimit: { max: 10, timeWindow: "1m" } },
    },
    async (request, reply) => {
      const body = generateSummarySchema.parse(request.body);

      // Verificar que el documento existe y es de tipo documento (no video puro)
      const docVersion = await prisma.documentVersion.findUnique({
        where: { id: body.documentVersionId },
        include: {
          document: {
            select: { id: true, type: true, confidentiality: true, title: true },
          },
        },
      });

      if (!docVersion) {
        return reply.status(404).send({ statusCode: 404, error: "Not Found", message: "Versión de documento no encontrada" });
      }

      // Videos puros no tienen IA
      if (docVersion.document.type === "VIDEO") {
        return reply.status(400).send({
          statusCode: 400,
          error: "Bad Request",
          message: "Los videos no tienen resúmenes IA. Solo documentos escritos.",
        });
      }

      if (!docVersion.extractedText) {
        return reply.status(400).send({
          statusCode: 400,
          error: "Bad Request",
          message: "El documento no tiene texto extraído. Re-sube el archivo.",
        });
      }

      // Verificar límite de uso diario
      const today = new Date().toISOString().slice(0, 10);
      const canProceed = await checkAIUsageLimit(request.user.id, "summary", today);
      if (!canProceed) {
        return reply.status(429).send({
          statusCode: 429,
          error: "Too Many Requests",
          message: `Límite de ${process.env.AI_DAILY_SUMMARY_LIMIT || 20} resúmenes diarios alcanzado`,
        });
      }

      // Revisar si ya existe resumen vigente
      if (!body.forceRegenerate) {
        const existing = await prisma.aISummary.findFirst({
          where: {
            documentVersionId: body.documentVersionId,
            summaryType: body.summaryType,
            summaryLength: body.summaryLength,
            status: "DONE",
          },
          orderBy: { createdAt: "desc" },
        });

        if (existing) {
          return { summary: existing, isNew: false };
        }
      }

      // Crear registro pendiente
      const summary = await prisma.aISummary.create({
        data: {
          documentId: docVersion.document.id,
          documentVersionId: body.documentVersionId,
          userId: request.user.id,
          summaryType: body.summaryType,
          summaryLength: body.summaryLength,
          compareDocIds: body.compareDocIds || [],
          status: "PENDING",
        },
      });

      // Encolar job
      await aiQueue.add(
        "generate-summary",
        {
          summaryId: summary.id,
          documentVersionId: body.documentVersionId,
          summaryType: body.summaryType,
          summaryLength: body.summaryLength,
          userId: request.user.id,
          confidentiality: docVersion.document.confidentiality,
          compareDocIds: body.compareDocIds || [],
        },
        {
          attempts: 2,
          backoff: { type: "fixed", delay: 5000 },
          removeOnComplete: 50,
          removeOnFail: 100,
        }
      );

      await createAuditLog({
        userId: request.user.id,
        action: "AI_SUMMARY_GENERATED",
        entityType: "AISummary",
        entityId: summary.id,
        documentId: docVersion.document.id,
        metadata: { summaryType: body.summaryType, summaryLength: body.summaryLength },
        request,
      });

      return reply.status(202).send({ summary, isNew: true });
    }
  );

  // ── GET /api/v1/ai/summary/:summaryId ────────────────
  app.get<{ Params: { summaryId: string } }>(
    "/summary/:summaryId",
    {
      schema: { tags: ["IA"], summary: "Estado de un resumen IA" },
    },
    async (request, reply) => {
      const summary = await prisma.aISummary.findUnique({
        where: { id: request.params.summaryId },
      });

      if (!summary) {
        return reply.status(404).send({ statusCode: 404, error: "Not Found", message: "Resumen no encontrado" });
      }

      return summary;
    }
  );

  // ── GET /api/v1/ai/summaries/:documentVersionId ──────
  app.get<{ Params: { versionId: string } }>(
    "/summaries/:versionId",
    {
      schema: { tags: ["IA"], summary: "Todos los resúmenes de una versión" },
    },
    async (request) => {
      return prisma.aISummary.findMany({
        where: {
          documentVersionId: request.params.versionId,
          status: "DONE",
        },
        orderBy: { createdAt: "desc" },
      });
    }
  );

  // ── POST /api/v1/ai/chat ─────────────────────────────
  app.post(
    "/chat",
    {
      schema: {
        tags: ["IA"],
        summary: "Chat con el documento (RAG básico)",
      },
      config: { rateLimit: { max: 15, timeWindow: "1m" } },
    },
    async (request, reply) => {
      const { documentVersionId, question, sessionId } = chatSchema.parse(request.body);

      const docVersion = await prisma.documentVersion.findUnique({
        where: { id: documentVersionId },
        include: { document: { select: { id: true, type: true, title: true } } },
      });

      if (!docVersion) {
        return reply.status(404).send({ statusCode: 404, error: "Not Found", message: "Versión no encontrada" });
      }

      if (docVersion.document.type === "VIDEO") {
        return reply.status(400).send({
          statusCode: 400,
          error: "Bad Request",
          message: "El chat IA no está disponible para videos",
        });
      }

      if (!docVersion.extractedText) {
        return reply.status(400).send({
          statusCode: 400,
          error: "Bad Request",
          message: "El documento no tiene texto para consultar",
        });
      }

      // Verificar límite de mensajes de chat
      const today = new Date().toISOString().slice(0, 10);
      const canProceed = await checkAIUsageLimit(request.user.id, "chat", today);
      if (!canProceed) {
        return reply.status(429).send({
          statusCode: 429,
          error: "Too Many Requests",
          message: `Límite de ${process.env.AI_DAILY_CHAT_LIMIT || 50} preguntas diarias alcanzado`,
        });
      }

      // Verificar límite de mensajes por documento por usuario por día
      const existingSession = sessionId
        ? await prisma.aIChatSession.findUnique({ where: { id: sessionId } })
        : null;

      if (!existingSession) {
        // Verificar si ya tiene 10 preguntas HOY para este doc
        const todayStart = new Date();
        todayStart.setHours(0, 0, 0, 0);

        const sessionsToday = await prisma.aIChatSession.findMany({
          where: {
            userId: request.user.id,
            documentVersionId,
            lastActivityAt: { gte: todayStart },
          },
          select: { messageCount: true },
        });

        const totalMessages = sessionsToday.reduce((sum, s) => sum + s.messageCount, 0);
        if (totalMessages >= 10) {
          return reply.status(429).send({
            statusCode: 429,
            error: "Too Many Requests",
            message: "Límite de 10 preguntas por documento por día alcanzado",
          });
        }
      }

      // Ejecutar RAG
      const response = await ragChat({
        userId: request.user.id,
        documentVersionId,
        documentText: docVersion.extractedText,
        documentTitle: docVersion.document.title,
        question,
        sessionId,
      });

      await createAuditLog({
        userId: request.user.id,
        action: "AI_CHAT_SESSION_STARTED",
        documentId: docVersion.document.id,
        request,
      });

      return reply.status(200).send(response);
    }
  );

  // ── GET /api/v1/ai/usage ─────────────────────────────
  app.get(
    "/usage",
    {
      schema: { tags: ["IA"], summary: "Uso de IA del usuario autenticado" },
    },
    async (request) => {
      const today = new Date().toISOString().slice(0, 10);

      const usage = await prisma.aIUsageLog.findUnique({
        where: { userId_date: { userId: request.user.id, date: new Date(today) } },
      });

      return {
        today: usage || { summaryCount: 0, chatMessageCount: 0, tokensUsed: 0 },
        limits: {
          dailySummaries: parseInt(process.env.AI_DAILY_SUMMARY_LIMIT || "20"),
          dailyChatMessages: parseInt(process.env.AI_DAILY_CHAT_LIMIT || "50"),
        },
      };
    }
  );
}
