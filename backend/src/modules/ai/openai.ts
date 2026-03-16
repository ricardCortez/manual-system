import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";

// ──────────────────────────────────────────────────────
// Cliente OpenAI
// ──────────────────────────────────────────────────────

let openaiClient: OpenAI | null = null;

function getOpenAI(): OpenAI {
  if (!openaiClient) {
    if (!process.env.OPENAI_API_KEY) {
      throw new Error("OPENAI_API_KEY no configurada");
    }
    openaiClient = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
      organization: process.env.OPENAI_ORG_ID || undefined,
    });
  }
  return openaiClient;
}

export const openAIClient = {
  async generate(
    prompt: string,
    model = process.env.OPENAI_DEFAULT_MODEL || "gpt-4o-mini"
  ): Promise<{ text: string; model: string; tokensUsed: number; durationMs: number }> {
    const start = Date.now();
    const client = getOpenAI();

    const response = await client.chat.completions.create({
      model,
      messages: [{ role: "user", content: prompt }],
      temperature: 0.3,
      max_tokens: 4096,
    });

    const text = response.choices[0]?.message?.content || "";
    const tokensUsed = response.usage?.total_tokens || 0;

    return { text, model, tokensUsed, durationMs: Date.now() - start };
  },

  async *generateStream(
    prompt: string,
    model = process.env.OPENAI_DEFAULT_MODEL || "gpt-4o-mini"
  ): AsyncGenerator<string> {
    const client = getOpenAI();

    const stream = await client.chat.completions.create({
      model,
      messages: [{ role: "user", content: prompt }],
      temperature: 0.3,
      max_tokens: 4096,
      stream: true,
    });

    for await (const chunk of stream) {
      const content = chunk.choices[0]?.delta?.content;
      if (content) yield content;
    }
  },
};

// ──────────────────────────────────────────────────────
// Cliente Anthropic
// ──────────────────────────────────────────────────────

let anthropicClient: Anthropic | null = null;

function getAnthropic(): Anthropic {
  if (!anthropicClient) {
    if (!process.env.ANTHROPIC_API_KEY) {
      throw new Error("ANTHROPIC_API_KEY no configurada");
    }
    anthropicClient = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }
  return anthropicClient;
}

export const anthropicAIClient = {
  async generate(
    prompt: string,
    model = process.env.ANTHROPIC_DEFAULT_MODEL || "claude-haiku-4-5-20251001"
  ): Promise<{ text: string; model: string; tokensUsed: number; durationMs: number }> {
    const start = Date.now();
    const client = getAnthropic();

    const response = await client.messages.create({
      model,
      max_tokens: 4096,
      messages: [{ role: "user", content: prompt }],
    });

    const text = response.content[0]?.type === "text" ? response.content[0].text : "";
    const tokensUsed = (response.usage?.input_tokens || 0) + (response.usage?.output_tokens || 0);

    return { text, model, tokensUsed, durationMs: Date.now() - start };
  },
};
