import { useState, useEffect, useRef } from "react";
import { Sparkles, RefreshCw, Copy, Check, ChevronDown, AlertTriangle, Loader2 } from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import api from "@/lib/api";
import { getSocket } from "@/lib/socket";
import clsx from "clsx";

type SummaryType = "EXECUTIVE" | "BULLETS" | "BRIEF" | "GLOSSARY";
type SummaryLength = "SHORT" | "MEDIUM" | "DETAILED";

const summaryTypeLabels: Record<SummaryType, string> = {
  EXECUTIVE: "Resumen ejecutivo",
  BULLETS: "Puntos clave",
  BRIEF: "Resumen breve",
  GLOSSARY: "Glosario",
};

const summaryTypeDesc: Record<SummaryType, string> = {
  EXECUTIVE: "3-5 párrafos, tono formal",
  BULLETS: "5-10 bullets accionables",
  BRIEF: "1 párrafo, máx. 150 palabras",
  GLOSSARY: "Define términos técnicos",
};

interface AISummary {
  id: string;
  summaryType: SummaryType;
  summaryLength: SummaryLength;
  content: string | null;
  status: "PENDING" | "PROCESSING" | "DONE" | "FAILED";
  model: string | null;
  generationMs: number | null;
  createdAt: string;
  errorMessage?: string | null;
}

interface SummaryPanelProps {
  documentVersionId: string;
  isOutdated?: boolean;
  onChatOpen?: () => void;
}

export function SummaryPanel({ documentVersionId, isOutdated, onChatOpen }: SummaryPanelProps) {
  const [selectedType, setSelectedType] = useState<SummaryType>("BULLETS");
  const [selectedLength, setSelectedLength] = useState<SummaryLength>("MEDIUM");
  const [showConfig, setShowConfig] = useState(false);
  const [activeSummaryId, setActiveSummaryId] = useState<string | null>(null);
  const [streamingText, setStreamingText] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const queryClient = useQueryClient();

  // Cargar resúmenes existentes
  const { data: summaries = [] } = useQuery<AISummary[]>({
    queryKey: ["ai-summaries", documentVersionId],
    queryFn: () => api.get(`/ai/summaries/${documentVersionId}`).then((r) => r.data),
  });

  // Resumen activo para mostrar
  const activeSummary = activeSummaryId
    ? summaries.find((s) => s.id === activeSummaryId)
    : summaries.find((s) => s.summaryType === selectedType && s.summaryLength === selectedLength && s.status === "DONE");

  // Escuchar progreso por WebSocket
  useEffect(() => {
    const socket = getSocket();
    if (!socket) return;

    const onProgress = ({ summaryId, event, data }: { summaryId: string; event: string; data?: { content?: string } }) => {
      if (event === "started") setStreamingText("Analizando documento...");
      if (event === "streaming" && data?.content) setStreamingText((p) => (p || "") + data.content);
      if (event === "done") {
        setStreamingText(null);
        queryClient.invalidateQueries({ queryKey: ["ai-summaries", documentVersionId] });
      }
      if (event === "error") setStreamingText(null);
    };

    socket.on("ai:progress", onProgress);
    return () => { socket.off("ai:progress", onProgress); };
  }, [documentVersionId, queryClient]);

  // Generar resumen
  const generateMutation = useMutation({
    mutationFn: (forceRegenerate = false) =>
      api.post("/ai/summary", {
        documentVersionId,
        summaryType: selectedType,
        summaryLength: selectedLength,
        forceRegenerate,
      }),
    onSuccess: ({ data }) => {
      setActiveSummaryId(data.summary.id);
      setShowConfig(false);
      if (data.isNew) setStreamingText("En cola...");
      queryClient.invalidateQueries({ queryKey: ["ai-summaries", documentVersionId] });
    },
  });

  const handleCopy = async () => {
    const text = activeSummary?.content || streamingText;
    if (!text) return;
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const isProcessing = generateMutation.isPending || streamingText !== null;

  return (
    <div
      className="rounded-xl overflow-hidden mt-6"
      style={{ background: "var(--ai-bg)", border: "1px solid var(--ai-border)" }}
    >
      {/* Header */}
      <div
        className="flex items-center justify-between px-4 py-3"
        style={{ borderBottom: "1px solid var(--ai-border)" }}
      >
        <div className="flex items-center gap-2">
          <span className="ai-badge">
            <Sparkles size={11} />
            Resumen IA
          </span>
          {isOutdated && (
            <span
              className="flex items-center gap-1 text-xs px-2 py-0.5 rounded-full"
              style={{ background: "rgba(245,158,11,0.1)", color: "#F59E0B", border: "1px solid rgba(245,158,11,0.2)" }}
            >
              <AlertTriangle size={11} />
              Desactualizado
            </span>
          )}
          {activeSummary && !isProcessing && (
            <span className="text-xs" style={{ color: "var(--text-tertiary)" }}>
              {summaryTypeLabels[activeSummary.summaryType]} ·{" "}
              {format(new Date(activeSummary.createdAt), "dd/MM/yyyy HH:mm", { locale: es })}
            </span>
          )}
        </div>

        <div className="flex items-center gap-1">
          {activeSummary?.content && (
            <button
              onClick={handleCopy}
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-md text-xs transition-colors"
              style={{ color: "var(--ai-primary)", background: "var(--ai-bg-hover)" }}
            >
              {copied ? <Check size={13} /> : <Copy size={13} />}
              {copied ? "Copiado" : "Copiar"}
            </button>
          )}
          {activeSummary && (
            <button
              onClick={() => generateMutation.mutate(true)}
              disabled={isProcessing}
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-md text-xs transition-colors"
              style={{ color: "var(--ai-primary)", background: "var(--ai-bg-hover)" }}
            >
              <RefreshCw size={13} className={isProcessing ? "animate-spin" : ""} />
              Regenerar
            </button>
          )}
          <button
            onClick={() => setShowConfig((v) => !v)}
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-md text-xs transition-colors"
            style={{ color: "var(--ai-primary)", background: "var(--ai-bg-hover)" }}
          >
            <ChevronDown size={13} className={clsx("transition-transform", showConfig && "rotate-180")} />
            Configurar
          </button>
        </div>
      </div>

      {/* Configuración */}
      {showConfig && (
        <div className="px-4 py-3" style={{ borderBottom: "1px solid var(--ai-border)" }}>
          <div className="flex flex-wrap gap-4">
            {/* Tipo de resumen */}
            <div>
              <p className="text-xs font-500 mb-2" style={{ color: "var(--text-secondary)" }}>Tipo</p>
              <div className="flex gap-2 flex-wrap">
                {(Object.keys(summaryTypeLabels) as SummaryType[]).map((type) => (
                  <button
                    key={type}
                    onClick={() => setSelectedType(type)}
                    className="px-3 py-1.5 rounded-lg text-xs transition-all"
                    style={{
                      background: selectedType === type ? "var(--ai-primary)" : "var(--bg-tertiary)",
                      color: selectedType === type ? "white" : "var(--text-secondary)",
                    }}
                    title={summaryTypeDesc[type]}
                  >
                    {summaryTypeLabels[type]}
                  </button>
                ))}
              </div>
            </div>

            {/* Longitud */}
            <div>
              <p className="text-xs font-500 mb-2" style={{ color: "var(--text-secondary)" }}>Longitud</p>
              <div className="flex gap-2">
                {(["SHORT", "MEDIUM", "DETAILED"] as SummaryLength[]).map((len) => (
                  <button
                    key={len}
                    onClick={() => setSelectedLength(len)}
                    className="px-3 py-1.5 rounded-lg text-xs transition-all"
                    style={{
                      background: selectedLength === len ? "var(--ai-primary)" : "var(--bg-tertiary)",
                      color: selectedLength === len ? "white" : "var(--text-secondary)",
                    }}
                  >
                    {len === "SHORT" ? "Corto" : len === "MEDIUM" ? "Medio" : "Detallado"}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <button
            onClick={() => generateMutation.mutate(false)}
            disabled={isProcessing}
            className="mt-3 flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-500 transition-all"
            style={{ background: "var(--ai-primary)", color: "white", opacity: isProcessing ? 0.7 : 1 }}
          >
            {isProcessing ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
            {isProcessing ? "Generando..." : "Generar resumen"}
          </button>
        </div>
      )}

      {/* Contenido del resumen */}
      <div className="px-4 py-4">
        {/* Streaming / cargando */}
        {streamingText !== null && (
          <div>
            {activeSummary?.summaryType === "BULLETS"
              ? <BulletsContent text={streamingText} isStreaming />
              : <ProseContent text={streamingText} isStreaming />
            }
          </div>
        )}

        {/* Resumen cargado */}
        {!streamingText && activeSummary?.status === "DONE" && activeSummary.content && (
          <div>
            <p className="text-xs mb-3" style={{ color: "var(--text-tertiary)" }}>
              Tipo: <strong>{summaryTypeLabels[activeSummary.summaryType]}</strong> ·
              Modelo: <strong>{activeSummary.model}</strong>
              {activeSummary.generationMs && ` · ${(activeSummary.generationMs / 1000).toFixed(1)}s`}
            </p>
            {activeSummary.summaryType === "BULLETS"
              ? <BulletsContent text={activeSummary.content} />
              : activeSummary.summaryType === "GLOSSARY"
              ? <GlossaryContent text={activeSummary.content} />
              : <ProseContent text={activeSummary.content} />
            }
          </div>
        )}

        {/* Error */}
        {!streamingText && activeSummary?.status === "FAILED" && (
          <p className="text-sm" style={{ color: "var(--status-obsolete)" }}>
            Error al generar: {activeSummary.errorMessage || "Error desconocido"}
          </p>
        )}

        {/* Sin resumen todavía */}
        {!streamingText && !activeSummary && !generateMutation.isPending && (
          <div className="text-center py-4">
            <Sparkles size={24} className="mx-auto mb-2" style={{ color: "var(--ai-primary)", opacity: 0.5 }} />
            <p className="text-sm" style={{ color: "var(--text-tertiary)" }}>
              No hay resumen generado. Haz clic en{" "}
              <button
                onClick={() => setShowConfig(true)}
                className="font-500 transition-colors"
                style={{ color: "var(--ai-primary)" }}
              >
                Configurar
              </button>{" "}
              para generarlo.
            </p>
          </div>
        )}
      </div>

      {/* Botón de chat */}
      {onChatOpen && (
        <div
          className="px-4 py-3 flex items-center justify-end"
          style={{ borderTop: "1px solid var(--ai-border)" }}
        >
          <button
            onClick={onChatOpen}
            className="flex items-center gap-2 text-sm font-500 transition-colors"
            style={{ color: "var(--ai-primary)" }}
          >
            <Sparkles size={14} />
            Preguntar al documento →
          </button>
        </div>
      )}
    </div>
  );
}

// ── Sub-renderers de contenido ─────────────────────────

function ProseContent({ text, isStreaming }: { text: string; isStreaming?: boolean }) {
  return (
    <p
      className={clsx("text-sm leading-relaxed whitespace-pre-wrap", isStreaming && "typing-cursor")}
      style={{ color: "var(--text-primary)" }}
    >
      {text}
    </p>
  );
}

function BulletsContent({ text, isStreaming }: { text: string; isStreaming?: boolean }) {
  const items = text
    .split(/\n/)
    .filter((line) => line.trim())
    .map((line) => line.replace(/^[•\-*]\s*/, "").trim());

  return (
    <ul className="space-y-2">
      {items.map((item, i) => (
        <li key={i} className="flex items-start gap-2.5 text-sm" style={{ color: "var(--text-primary)" }}>
          <span className="mt-1.5 w-1.5 h-1.5 rounded-full shrink-0" style={{ background: "var(--ai-primary)" }} />
          <span className={clsx("leading-relaxed", isStreaming && i === items.length - 1 && "typing-cursor")}>
            {item}
          </span>
        </li>
      ))}
    </ul>
  );
}

function GlossaryContent({ text }: { text: string }) {
  const entries = text
    .split(/\n/)
    .filter((line) => line.trim() && line.includes(":"))
    .map((line) => {
      const colonIdx = line.indexOf(":");
      return { term: line.slice(0, colonIdx).trim(), def: line.slice(colonIdx + 1).trim() };
    });

  return (
    <dl className="space-y-3">
      {entries.map((entry, i) => (
        <div key={i}>
          <dt className="text-sm font-600" style={{ color: "var(--ai-primary)" }}>{entry.term}</dt>
          <dd className="text-sm mt-0.5" style={{ color: "var(--text-secondary)" }}>{entry.def}</dd>
        </div>
      ))}
    </dl>
  );
}
