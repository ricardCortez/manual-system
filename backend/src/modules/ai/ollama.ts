// ──────────────────────────────────────────────────────
// Cliente Ollama — LLM Self-hosted
// ──────────────────────────────────────────────────────

// When OLLAMA_BASE_URL points to localhost, replace with Docker host gateway so
// the backend container can reach Ollama running on the host machine.
const _rawOllamaUrl = process.env.OLLAMA_BASE_URL || "http://172.20.0.1:11434";
const OLLAMA_BASE_URL = _rawOllamaUrl.replace(/^(https?:\/\/)localhost(:\d+)?/, "$1172.20.0.1$2");
const DEFAULT_MODEL = process.env.OLLAMA_DEFAULT_MODEL || "qwen2.5:0.5b";
const FALLBACK_MODEL = process.env.OLLAMA_FALLBACK_MODEL || "qwen2.5:0.5b";
const TIMEOUT = parseInt(process.env.OLLAMA_TIMEOUT_MS || "300000"); // 5min for CPU inference
// num_ctx: ventana de contexto. qwen2.5 soporta hasta 32K, pero con 4GB RAM limitamos a 4096
// para dejar margen al sistema. Configurable via OLLAMA_NUM_CTX.
const NUM_CTX = parseInt(process.env.OLLAMA_NUM_CTX || "4096");

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
            num_ctx: NUM_CTX,
          },
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        // Si el modelo no existe, intentar con fallback en cascada
        if (response.status === 404 && model !== FALLBACK_MODEL) {
          console.warn(`[Ollama] Modelo ${model} no disponible, usando ${FALLBACK_MODEL}`);
          return this.generate(prompt, { ...options, model: FALLBACK_MODEL });
        }
        if (response.status === 404 && model !== "qwen2.5:0.5b") {
          console.warn(`[Ollama] Modelo ${model} no disponible, usando qwen2.5:0.5b`);
          return this.generate(prompt, { ...options, model: "qwen2.5:0.5b" });
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
          options: { temperature: 0.3, num_ctx: 2048 },
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
