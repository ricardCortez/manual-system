import fs from "fs/promises";
import path from "path";
import { ollamaClient } from "./ollama";
import { openAIClient, anthropicAIClient } from "./openai";
import { resolveAIProvider, chunkText } from "./ai.utils";

const PROMPTS_DIR = path.join(__dirname, "../../../..", "ai-service", "prompts");

// ──────────────────────────────────────────────────────
// Generador de resúmenes
// ──────────────────────────────────────────────────────

type SummaryType = "EXECUTIVE" | "BULLETS" | "BRIEF" | "GLOSSARY" | "COMPARATIVE";
type SummaryLength = "SHORT" | "MEDIUM" | "DETAILED";

const lengthInstructions: Record<SummaryLength, string> = {
  SHORT: "Sé muy conciso. Máximo 150 palabras.",
  MEDIUM: "Equilibrio entre detalle y brevedad. Entre 200-400 palabras.",
  DETAILED: "Sé exhaustivo y detallado. Hasta 800 palabras.",
};

const typePrompts: Record<SummaryType, string> = {
  EXECUTIVE: `Eres un asistente experto en análisis de documentos corporativos.
Genera un RESUMEN EJECUTIVO del siguiente documento.
El resumen debe incluir: objetivo del documento, puntos principales, procedimientos clave y conclusiones.
Tono formal y profesional. Escribe en español.
{length_instruction}

DOCUMENTO:
{text}

RESUMEN EJECUTIVO:`,

  BULLETS: `Eres un asistente experto en síntesis de documentos.
Genera una lista de PUNTOS CLAVE del siguiente documento.
Formato: bullet points (•) numerados, cada uno accionable y específico.
Entre 5 y 10 puntos. Tono directo. Escribe en español.
{length_instruction}

DOCUMENTO:
{text}

PUNTOS CLAVE:`,

  BRIEF: `Genera un RESUMEN BREVE de este documento en UN solo párrafo.
Máximo 150 palabras. Captura la esencia principal. Escribe en español.

DOCUMENTO:
{text}

RESUMEN BREVE:`,

  GLOSSARY: `Eres un experto en terminología técnica y corporativa.
Identifica y define los TÉRMINOS TÉCNICOS Y SIGLAS más importantes del documento.
Formato: Término: Definición (una línea).
Ordena alfabéticamente. Escribe en español.
{length_instruction}

DOCUMENTO:
{text}

GLOSARIO DE TÉRMINOS:`,

  COMPARATIVE: `Analiza y COMPARA los siguientes documentos.
Identifica: diferencias principales, similitudes, evolución entre versiones, y cuál documento aplica a qué situación.
Usa formato estructurado con secciones claras. Escribe en español.
{length_instruction}

DOCUMENTOS A COMPARAR:
{text}

ANÁLISIS COMPARATIVO:`,
};

export async function generateSummary(params: {
  text: string;
  summaryType: SummaryType;
  summaryLength: SummaryLength;
  confidentiality: string;
  compareTexts?: string[]; // Para COMPARATIVE
}): Promise<{ text: string; model: string; provider: string; tokensUsed: number; durationMs: number }> {
  const provider = resolveAIProvider(params.confidentiality);
  const lengthInstruction = lengthInstructions[params.summaryLength];

  // Preparar texto (chunking si es largo)
  let documentText = params.text;

  if (params.summaryType === "COMPARATIVE" && params.compareTexts?.length) {
    // Unir textos de documentos comparados
    const allTexts = [params.text, ...params.compareTexts];
    documentText = allTexts
      .map((t, i) => `--- DOCUMENTO ${i + 1} ---\n${t.slice(0, 15000)}`)
      .join("\n\n");
  } else if (params.text.length > 100000) {
    // Documentos muy largos: chunking + resumen de resúmenes
    const chunks = chunkText(params.text, 30000);
    const chunkSummaries: string[] = [];

    for (const chunk of chunks) {
      const chunkPrompt = typePrompts["BRIEF"].replace("{text}", chunk);
      const result = await callAI(provider, chunkPrompt);
      chunkSummaries.push(result.text);
    }

    // Resumir los resúmenes parciales
    documentText = `Resúmenes parciales del documento:\n\n${chunkSummaries.join("\n\n---\n\n")}`;
  }

  // Construir prompt final
  const promptTemplate = typePrompts[params.summaryType];
  const prompt = promptTemplate
    .replace("{text}", documentText.slice(0, 50000))
    .replace("{length_instruction}", lengthInstruction);

  return callAI(provider, prompt);
}

async function callAI(
  provider: "OLLAMA" | "OPENAI" | "ANTHROPIC",
  prompt: string
): Promise<{ text: string; model: string; provider: string; tokensUsed: number; durationMs: number }> {
  switch (provider) {
    case "OLLAMA": {
      const result = await ollamaClient.generate(prompt);
      return { ...result, provider: "OLLAMA" };
    }
    case "OPENAI": {
      const result = await openAIClient.generate(prompt);
      return { ...result, provider: "OPENAI" };
    }
    case "ANTHROPIC": {
      const result = await anthropicAIClient.generate(prompt);
      return { ...result, provider: "ANTHROPIC" };
    }
  }
}
