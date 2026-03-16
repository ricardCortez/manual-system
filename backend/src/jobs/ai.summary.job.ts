import type { Job } from "bullmq";
import { prisma } from "../plugins/prisma";
import { socketServer } from "../plugins/socket";
import { generateSummary } from "../modules/ai/summarizer";
import { incrementAIUsage } from "../modules/ai/ai.utils";
import { notificationQueue } from "./queues";

interface AISummaryJobData {
  summaryId: string;
  documentVersionId: string;
  summaryType: "EXECUTIVE" | "BULLETS" | "BRIEF" | "GLOSSARY" | "COMPARATIVE";
  summaryLength: "SHORT" | "MEDIUM" | "DETAILED";
  userId: string;
  confidentiality: string;
  compareDocIds: string[];
}

export async function aiSummaryProcessor(job: Job<AISummaryJobData>) {
  const { summaryId, documentVersionId, summaryType, summaryLength, userId, confidentiality, compareDocIds } = job.data;

  // Marcar como procesando
  await prisma.aISummary.update({
    where: { id: summaryId },
    data: { status: "PROCESSING" },
  });

  // Notificar inicio
  socketServer.aiProgress(userId, summaryId, "started");

  try {
    // Obtener texto del documento
    const docVersion = await prisma.documentVersion.findUnique({
      where: { id: documentVersionId },
      select: { extractedText: true },
    });

    if (!docVersion?.extractedText) {
      throw new Error("No hay texto extraído en este documento");
    }

    // Obtener textos de documentos comparados (si es COMPARATIVE)
    let compareTexts: string[] = [];
    if (summaryType === "COMPARATIVE" && compareDocIds.length > 0) {
      const compareVersions = await prisma.documentVersion.findMany({
        where: { documentId: { in: compareDocIds } },
        orderBy: { createdAt: "desc" },
        select: { extractedText: true },
        take: compareDocIds.length,
      });
      compareTexts = compareVersions
        .map((v) => v.extractedText)
        .filter(Boolean) as string[];
    }

    // Generar resumen
    const result = await generateSummary({
      text: docVersion.extractedText,
      summaryType,
      summaryLength,
      confidentiality,
      compareTexts: compareTexts.length > 0 ? compareTexts : undefined,
    });

    // Guardar resultado
    await prisma.aISummary.update({
      where: { id: summaryId },
      data: {
        content: result.text,
        status: "DONE",
        model: result.model,
        provider: result.provider as Parameters<typeof prisma.aISummary.update>[0]["data"]["provider"],
        tokensUsed: result.tokensUsed,
        generationMs: result.durationMs,
        promptVersion: "1.0",
      },
    });

    // Incrementar uso
    const today = new Date().toISOString().slice(0, 10);
    await incrementAIUsage(userId, "summary", result.tokensUsed, result.provider, today);

    // Notificar completado
    socketServer.aiProgress(userId, summaryId, "done", {
      content: result.text,
      model: result.model,
      durationMs: result.durationMs,
    });

    // Crear notificación in-app
    await notificationQueue.add("ai-summary-ready", {
      userId,
      summaryId,
      summaryType,
    });

    return { summaryId, status: "DONE" };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);

    await prisma.aISummary.update({
      where: { id: summaryId },
      data: { status: "FAILED", errorMessage },
    });

    socketServer.aiProgress(userId, summaryId, "error", { message: errorMessage });

    throw error; // BullMQ manejará el retry
  }
}
