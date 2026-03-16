import { prisma } from "../../plugins/prisma";

// ──────────────────────────────────────────────────────
// Control de límites de uso de IA
// ──────────────────────────────────────────────────────

export async function checkAIUsageLimit(
  userId: string,
  type: "summary" | "chat",
  date: string
): Promise<boolean> {
  const limit =
    type === "summary"
      ? parseInt(process.env.AI_DAILY_SUMMARY_LIMIT || "20")
      : parseInt(process.env.AI_DAILY_CHAT_LIMIT || "50");

  const usage = await prisma.aIUsageLog.findUnique({
    where: { userId_date: { userId, date: new Date(date) } },
  });

  if (!usage) return true;

  if (type === "summary") return usage.summaryCount < limit;
  return usage.chatMessageCount < limit;
}

export async function incrementAIUsage(
  userId: string,
  type: "summary" | "chat",
  tokensUsed: number,
  provider: string,
  date: string
) {
  await prisma.aIUsageLog.upsert({
    where: { userId_date: { userId, date: new Date(date) } },
    create: {
      userId,
      date: new Date(date),
      summaryCount: type === "summary" ? 1 : 0,
      chatMessageCount: type === "chat" ? 1 : 0,
      tokensUsed,
      provider: provider as Parameters<typeof prisma.aIUsageLog.create>[0]["data"]["provider"],
    },
    update: {
      summaryCount: type === "summary" ? { increment: 1 } : undefined,
      chatMessageCount: type === "chat" ? { increment: 1 } : undefined,
      tokensUsed: { increment: tokensUsed },
    },
  });
}

// ──────────────────────────────────────────────────────
// Determinar proveedor de IA según modo y confidencialidad
// ──────────────────────────────────────────────────────

export function resolveAIProvider(confidentiality: string): "OLLAMA" | "OPENAI" | "ANTHROPIC" {
  const mode = (process.env.AI_MODE || "LOCAL").toUpperCase();

  if (mode === "LOCAL") return "OLLAMA";
  if (mode === "EXTERNAL") {
    return process.env.OPENAI_API_KEY ? "OPENAI" : "ANTHROPIC";
  }

  // Modo HYBRID: docs RESTRINGIDO/CRITICO → solo Ollama
  if (confidentiality === "RESTRINGIDO" || confidentiality === "CRITICO") {
    return "OLLAMA";
  }

  return process.env.OPENAI_API_KEY ? "OPENAI" : "ANTHROPIC";
}

// ──────────────────────────────────────────────────────
// Chunking para documentos largos
// ──────────────────────────────────────────────────────

export function chunkText(text: string, maxChars = 30000): string[] {
  if (text.length <= maxChars) return [text];

  const chunks: string[] = [];
  let pos = 0;

  while (pos < text.length) {
    let end = Math.min(pos + maxChars, text.length);

    // Intentar cortar en párrafo o frase completa
    if (end < text.length) {
      const lastParagraph = text.lastIndexOf("\n\n", end);
      const lastSentence = text.lastIndexOf(". ", end);
      const cutPoint = Math.max(lastParagraph, lastSentence);
      if (cutPoint > pos + maxChars / 2) {
        end = cutPoint + 1;
      }
    }

    chunks.push(text.slice(pos, end).trim());
    pos = end;
  }

  return chunks;
}
