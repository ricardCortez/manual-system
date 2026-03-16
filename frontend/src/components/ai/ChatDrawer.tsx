import { useState, useRef, useEffect } from "react";
import { X, Send, Sparkles, Loader2, FileText } from "lucide-react";
import { useMutation } from "@tanstack/react-query";
import api from "@/lib/api";

interface Message {
  role: "user" | "assistant";
  content: string;
  sourceRef?: string | null;
  timestamp: string;
}

interface ChatDrawerProps {
  documentVersionId: string;
  documentTitle: string;
  onClose: () => void;
}

export function ChatDrawer({ documentVersionId, documentTitle, onClose }: ChatDrawerProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [sessionId, setSessionId] = useState<string | undefined>();
  const [messageCount, setMessageCount] = useState(0);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const MAX_MESSAGES = 10;

  const chatMutation = useMutation({
    mutationFn: (question: string) =>
      api.post<{ answer: string; sessionId: string; sourceRef: string | null; messageCount: number }>(
        "/ai/chat",
        { documentVersionId, question, sessionId }
      ).then((r) => r.data),
    onSuccess: (data, question) => {
      setSessionId(data.sessionId);
      setMessageCount(data.messageCount);
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: data.answer, sourceRef: data.sourceRef, timestamp: new Date().toISOString() },
      ]);
    },
    onError: () => {
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: "Lo siento, ocurrió un error al procesar tu pregunta. Intenta nuevamente.",
          timestamp: new Date().toISOString(),
        },
      ]);
    },
  });

  const handleSend = () => {
    const q = input.trim();
    if (!q || chatMutation.isPending || messageCount >= MAX_MESSAGES) return;

    setMessages((prev) => [
      ...prev,
      { role: "user", content: q, timestamp: new Date().toISOString() },
    ]);
    setInput("");
    chatMutation.mutate(q);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); }
  };

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const remaining = MAX_MESSAGES - messageCount;

  return (
    <>
      {/* Overlay */}
      <div className="fixed inset-0 z-40" onClick={onClose} />

      {/* Drawer */}
      <div
        className="fixed top-0 right-0 h-full z-50 flex flex-col"
        style={{
          width: 420,
          background: "var(--bg-elevated)",
          boxShadow: "var(--shadow-xl)",
          borderLeft: "1px solid var(--border-subtle)",
        }}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-4 py-3.5 shrink-0"
          style={{ borderBottom: "1px solid var(--border-subtle)" }}
        >
          <div className="flex items-center gap-2">
            <span className="ai-badge">
              <Sparkles size={11} />
              Chat con el documento
            </span>
          </div>
          <button onClick={onClose} style={{ color: "var(--text-tertiary)" }}>
            <X size={18} />
          </button>
        </div>

        {/* Contexto del documento */}
        <div
          className="flex items-center gap-2 px-4 py-2.5 shrink-0"
          style={{ background: "var(--ai-bg)", borderBottom: "1px solid var(--ai-border)" }}
        >
          <FileText size={13} style={{ color: "var(--ai-primary)" }} />
          <p className="text-xs truncate flex-1" style={{ color: "var(--text-secondary)" }}>
            {documentTitle}
          </p>
          <span className="text-xs shrink-0" style={{ color: remaining <= 2 ? "var(--status-obsolete)" : "var(--text-tertiary)" }}>
            {remaining} preguntas restantes hoy
          </span>
        </div>

        {/* Mensajes */}
        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
          {messages.length === 0 && (
            <div className="text-center py-8">
              <Sparkles size={28} className="mx-auto mb-3" style={{ color: "var(--ai-primary)", opacity: 0.5 }} />
              <p className="text-sm font-500 mb-1" style={{ color: "var(--text-primary)" }}>
                Pregunta sobre el documento
              </p>
              <p className="text-xs" style={{ color: "var(--text-tertiary)" }}>
                Las respuestas se basan únicamente en el contenido del documento.
              </p>
              <div className="mt-4 space-y-2">
                {[
                  "¿Cuáles son los pasos principales?",
                  "¿Quién es el responsable?",
                  "¿Qué herramientas se necesitan?",
                ].map((q) => (
                  <button
                    key={q}
                    onClick={() => { setInput(q); inputRef.current?.focus(); }}
                    className="block w-full text-left px-3 py-2 rounded-lg text-xs transition-colors"
                    style={{
                      background: "var(--bg-tertiary)",
                      color: "var(--text-secondary)",
                      border: "1px solid var(--border-subtle)",
                    }}
                  >
                    {q}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((msg, i) => (
            <div key={i} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
              <div
                className="max-w-[85%] rounded-2xl px-4 py-2.5"
                style={{
                  background: msg.role === "user" ? "var(--text-primary)" : "var(--ai-bg)",
                  border: msg.role === "assistant" ? "1px solid var(--ai-border)" : "none",
                  borderRadius: msg.role === "user" ? "18px 18px 4px 18px" : "18px 18px 18px 4px",
                }}
              >
                <p
                  className="text-sm leading-relaxed whitespace-pre-wrap"
                  style={{ color: msg.role === "user" ? "var(--text-inverse)" : "var(--text-primary)" }}
                >
                  {msg.content}
                </p>
                {msg.sourceRef && (
                  <p className="text-xs mt-1.5 font-500" style={{ color: "var(--ai-primary)" }}>
                    📍 {msg.sourceRef}
                  </p>
                )}
              </div>
            </div>
          ))}

          {chatMutation.isPending && (
            <div className="flex justify-start">
              <div
                className="rounded-2xl px-4 py-3"
                style={{ background: "var(--ai-bg)", border: "1px solid var(--ai-border)" }}
              >
                <div className="flex items-center gap-2">
                  <Loader2 size={13} className="animate-spin" style={{ color: "var(--ai-primary)" }} />
                  <span className="text-xs" style={{ color: "var(--text-tertiary)" }}>Analizando documento...</span>
                </div>
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* Input */}
        <div className="shrink-0 p-3" style={{ borderTop: "1px solid var(--border-subtle)" }}>
          {messageCount >= MAX_MESSAGES ? (
            <p className="text-center text-xs py-2" style={{ color: "var(--status-obsolete)" }}>
              Límite diario de {MAX_MESSAGES} preguntas por documento alcanzado
            </p>
          ) : (
            <div
              className="flex items-end gap-2 rounded-xl p-2.5"
              style={{ background: "var(--bg-tertiary)", border: "1px solid var(--border-default)" }}
            >
              <textarea
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Escribe tu pregunta..."
                rows={1}
                className="flex-1 bg-transparent text-sm outline-none resize-none"
                style={{
                  color: "var(--text-primary)",
                  maxHeight: 120,
                  overflowY: "auto",
                  lineHeight: 1.5,
                }}
              />
              <button
                onClick={handleSend}
                disabled={!input.trim() || chatMutation.isPending}
                className="p-2 rounded-lg transition-all shrink-0"
                style={{
                  background: input.trim() ? "var(--ai-primary)" : "var(--bg-secondary)",
                  color: input.trim() ? "white" : "var(--text-disabled)",
                }}
              >
                <Send size={14} />
              </button>
            </div>
          )}
          <p className="text-center text-xs mt-1.5" style={{ color: "var(--text-disabled)" }}>
            Respuestas basadas en el contenido del documento · Sin IA en videos
          </p>
        </div>
      </div>
    </>
  );
}
