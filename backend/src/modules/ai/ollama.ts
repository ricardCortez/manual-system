// ──────────────────────────────────────────────────────
// Cliente Ollama — LLM Self-hosted
// ──────────────────────────────────────────────────────

const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL || "http://localhost:11434";
const DEFAULT_MODEL = process.env.OLLAMA_DEFAULT_MODEL || "llama3.1:8b";
const FALLBACK_MODEL = process.env.OLLAMA_FALLBACK_MODEL || "mistral:7b";
const TIMEOUT = parseInt(process.env.OLLAMA_TIMEOUT_MS || "120000");

interface OllamaResponse {
  model: string;
  response: string;
  done: boolean;
  eval_count?: number;
  eval_duration?: number;
  total_duration?: number;
}

interface GenerateOptions {
  model?: string;
  temperature?: number;
  stream?: boolean;
  context?: number[];
}

export const ollamaClient = {
  async generate(
    prompt: string,
    options: GenerateOptions = {}
  ): Promise<{ text: string; model: string; tokensUsed: number; durationMs: number }> {
    const model = options.model || DEFAULT_MODEL;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), TIMEOUT);

    try {
      const response = await fetch(`${OLLAMA_BASE_URL}/api/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model,
          prompt,
          stream: false,
          options: {
            temperature: options.temperature ?? 0.3,
            num_ctx: 8192,
          },
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        // Si el modelo no existe, intentar con fallback
        if (response.status === 404 && model !== FALLBACK_MODEL) {
          console.warn(`[Ollama] Modelo ${model} no disponible, usando ${FALLBACK_MODEL}`);
          return this.generate(prompt, { ...options, model: FALLBACK_MODEL });
        }
        throw new Error(`Ollama HTTP ${response.status}: ${await response.text()}`);
      }

      const data = (await response.json()) as OllamaResponse;

      return {
        text: data.response,
        model: data.model,
        tokensUsed: data.eval_count || 0,
        durationMs: data.total_duration ? Math.round(data.total_duration / 1_000_000) : 0,
      };
    } finally {
      clearTimeout(timeoutId);
    }
  },

  async *generateStream(
    prompt: string,
    model = DEFAULT_MODEL
  ): AsyncGenerator<string> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), TIMEOUT);

    try {
      const response = await fetch(`${OLLAMA_BASE_URL}/api/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model,
          prompt,
          stream: true,
          options: { temperature: 0.3, num_ctx: 8192 },
        }),
        signal: controller.signal,
      });

      if (!response.body) throw new Error("No response body");

      const reader = response.body.getReader();
      const decoder = new TextDecoder();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const lines = decoder.decode(value).split("\n").filter(Boolean);
        for (const line of lines) {
          try {
            const parsed = JSON.parse(line) as OllamaResponse;
            if (parsed.response) yield parsed.response;
            if (parsed.done) return;
          } catch {
            // Línea incompleta, ignorar
          }
        }
      }
    } finally {
      clearTimeout(timeoutId);
    }
  },

  async checkHealth(): Promise<boolean> {
    try {
      const response = await fetch(`${OLLAMA_BASE_URL}/api/tags`, {
        signal: AbortSignal.timeout(5000),
      });
      return response.ok;
    } catch {
      return false;
    }
  },

  async listModels(): Promise<string[]> {
    try {
      const response = await fetch(`${OLLAMA_BASE_URL}/api/tags`);
      const data = await response.json() as { models: Array<{ name: string }> };
      return data.models.map((m) => m.name);
    } catch {
      return [];
    }
  },
};
