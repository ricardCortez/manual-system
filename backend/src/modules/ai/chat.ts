import { prisma } from "../../plugins/prisma";
import { ollamaClient } from "./ollama";
import { openAIClient, anthropicAIClient } from "./openai";
import { resolveAIProvider, incrementAIUsage } from "./ai.utils";

// ──────────────────────────────────────────────────────
// RAG básico — Chat con documento
// ──────────────────────────────────────────────────────

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  sourceRef?: string;
  timestamp: string;
}

const RAG_SYSTEM_PROMPT = `Eres un asistente experto que responde preguntas sobre un documento corporativo.
REGLAS ESTRICTAS:
1. Responde ÚNICAMENTE basándote en el contenido del documento proporcionado.
2. Si la respuesta no está en el documento, di exactamente: "Esta información no se encuentra en el documento."
3. Cuando cites información, menciona "Según el documento..." o "De acuerdo con la sección X..."
4. Sé conciso y directo. Máximo 300 palabras por respuesta.
5. Responde en español.
6. NO inventes información, nombres, fechas o procedimientos.`;

export async function ragChat(params: {
  userId: string;
  documentVersionId: string;
  documentText: string;
  documentTitle: string;
  question: string;
  sessionId?: string;
}): Promise<{
  answer: string;
  sessionId: string;
  sourceRef: string | null;
  messageCount: number;
}> {
  // Obtener o crear sesión
  let session = params.sessionId
    ? await prisma.aIChatSession.findUnique({ where: { id: params.sessionId } })
    : null;

  const messages: ChatMessage[] = session
    ? (session.messages as ChatMessage[])
    : [];

  // Determinar proveedor
  const docVersion = await prisma.documentVersion.findUnique({
    where: { id: params.documentVersionId },
    include: { document: { select: { confidentiality: true } } },
  });

  const provider = resolveAIProvider(
    docVersion?.document.confidentiality || "PUBLICO"
  );

  // Construir contexto (fragmento relevante del documento)
  const relevantContext = extractRelevantContext(params.documentText, params.question);

  // Construir prompt con historial
  const historyText = messages
    .slice(-6) // Últimas 3 interacciones
    .map((m) => `${m.role === "user" ? "Usuario" : "Asistente"}: ${m.content}`)
    .join("\n");

  const prompt = `${RAG_SYSTEM_PROMPT}

DOCUMENTO: "${params.documentTitle}"
CONTEXTO DEL DOCUMENTO:
${relevantContext}

${historyText ? `HISTORIAL DE CONVERSACIÓN:\n${historyText}\n` : ""}
Usuario: ${params.question}
Asistente:`;

  let answer: string;
  let tokensUsed = 0;
  let modelUsed = "";

  switch (provider) {
    case "OLLAMA": {
      const result = await ollamaClient.generate(prompt, { temperature: 0.2 });
      answer = result.text.trim();
      tokensUsed = result.tokensUsed;
      modelUsed = result.model;
      break;
    }
    case "OPENAI": {
      const result = await openAIClient.generate(prompt);
      answer = result.text.trim();
      tokensUsed = result.tokensUsed;
      modelUsed = result.model;
      break;
    }
    case "ANTHROPIC": {
      const result = await anthropicAIClient.generate(prompt);
      answer = result.text.trim();
      tokensUsed = result.tokensUsed;
      modelUsed = result.model;
      break;
    }
  }

  // Extraer referencia de página/sección si la IA la menciona
  const sourceRef = extractSourceRef(answer);

  // Actualizar mensajes
  const now = new Date().toISOString();
  messages.push(
    { role: "user", content: params.question, timestamp: now },
    { role: "assistant", content: answer, sourceRef: sourceRef || undefined, timestamp: now }
  );

  // Guardar/actualizar sesión
  const updatedSession = await prisma.aIChatSession.upsert({
    where: { id: session?.id || "" },
    create: {
      userId: params.userId,
      documentVersionId: params.documentVersionId,
      documentId: docVersion?.document ? (docVersion as any).documentId : "",
      messages: messages,
      messageCount: messages.length,
      model: modelUsed,
      provider: provider as Parameters<typeof prisma.aIChatSession.create>[0]["data"]["provider"],
    },
    update: {
      messages: messages,
      messageCount: messages.length,
      lastActivityAt: new Date(),
    },
  });

  // Registrar uso
  const today = new Date().toISOString().slice(0, 10);
  await incrementAIUsage(params.userId, "chat", tokensUsed, provider, today);

  return {
    answer,
    sessionId: updatedSession.id,
    sourceRef,
    messageCount: messages.length,
  };
}

// Extrae contexto relevante del documento para la pregunta (RAG simple por keywords)
function extractRelevantContext(text: string, question: string, maxChars = 8000): string {
  if (text.length <= maxChars) return text;

  const keywords = question
    .toLowerCase()
    .replace(/[^\w\s]/g, "")
    .split(/\s+/)
    .filter((w) => w.length > 3);

  const paragraphs = text.split(/\n{2,}/);
  const scored = paragraphs.map((para) => {
    const lower = para.toLowerCase();
    const score = keywords.reduce((s, kw) => s + (lower.includes(kw) ? 1 : 0), 0);
    return { para, score };
  });

  scored.sort((a, b) => b.score - a.score);

  let context = "";
  for (const { para } of scored) {
    if ((context + para).length > maxChars) break;
    context += para + "\n\n";
  }

  return context || text.slice(0, maxChars);
}

// Extrae referencia a página o sección de la respuesta del modelo
function extractSourceRef(text: string): string | null {
  const pageMatch = text.match(/p[áa]gina\s+(\d+)/i);
  const sectionMatch = text.match(/secci[oó]n\s+([\d.]+)/i);

  if (pageMatch) return `Página ${pageMatch[1]}`;
  if (sectionMatch) return `Sección ${sectionMatch[1]}`;
  return null;
}
