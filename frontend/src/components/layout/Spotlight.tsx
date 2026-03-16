import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { Search, FileText, Video, Clock, X } from "lucide-react";
import { useUIStore } from "@/stores/ui.store";
import api from "@/lib/api";
import { useDebounce } from "@/hooks/useDebounce";

interface SearchResult {
  id: string;
  title: string;
  type: string;
  areaName?: string;
  _formatted?: { title?: string };
}

export function Spotlight() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [selected, setSelected] = useState(0);
  const [history, setHistory] = useState<string[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const { closeSpotlight } = useUIStore();
  const navigate = useNavigate();
  const debouncedQuery = useDebounce(query, 300);

  useEffect(() => {
    inputRef.current?.focus();
    const stored = JSON.parse(localStorage.getItem("searchHistory") || "[]");
    setHistory(stored);
  }, []);

  useEffect(() => {
    if (!debouncedQuery.trim()) { setResults([]); return; }

    setIsSearching(true);
    api.get(`/search/suggestions?q=${encodeURIComponent(debouncedQuery)}`)
      .then(({ data }) => setResults(data))
      .catch(() => setResults([]))
      .finally(() => setIsSearching(false));
  }, [debouncedQuery]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") { closeSpotlight(); return; }
    if (e.key === "ArrowDown") { e.preventDefault(); setSelected((s) => Math.min(s + 1, results.length - 1)); }
    if (e.key === "ArrowUp") { e.preventDefault(); setSelected((s) => Math.max(s - 1, 0)); }
    if (e.key === "Enter") {
      if (results[selected]) goToResult(results[selected]);
      else if (query.trim()) goToSearch(query);
    }
  };

  const goToResult = (result: SearchResult) => {
    saveToHistory(result.title);
    closeSpotlight();
    navigate(`/documentos/${result.id}`);
  };

  const goToSearch = (q: string) => {
    saveToHistory(q);
    closeSpotlight();
    navigate(`/buscar?q=${encodeURIComponent(q)}`);
  };

  const saveToHistory = (term: string) => {
    const updated = [term, ...history.filter((h) => h !== term)].slice(0, 8);
    localStorage.setItem("searchHistory", JSON.stringify(updated));
  };

  return (
    <div className="spotlight-overlay" onClick={closeSpotlight}>
      <div
        className="w-full max-w-xl mx-4 rounded-2xl overflow-hidden"
        style={{ background: "var(--bg-elevated)", boxShadow: "var(--shadow-xl)" }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Input */}
        <div className="flex items-center gap-3 px-4 py-3.5" style={{ borderBottom: "1px solid var(--border-subtle)" }}>
          <Search size={18} style={{ color: "var(--text-tertiary)" }} className="shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => { setQuery(e.target.value); setSelected(0); }}
            onKeyDown={handleKeyDown}
            placeholder="Buscar manuales, videos, procesos..."
            className="flex-1 bg-transparent text-base outline-none"
            style={{ color: "var(--text-primary)" }}
          />
          {query && (
            <button onClick={() => setQuery("")} style={{ color: "var(--text-tertiary)" }}>
              <X size={16} />
            </button>
          )}
          <kbd
            className="hidden sm:flex items-center px-1.5 py-0.5 text-xs rounded"
            style={{ background: "var(--bg-tertiary)", color: "var(--text-tertiary)", border: "1px solid var(--border-default)" }}
          >
            Esc
          </kbd>
        </div>

        {/* Resultados o historial */}
        <div className="max-h-80 overflow-y-auto py-2">
          {!query && history.length > 0 && (
            <>
              <p className="px-4 py-1.5 text-xs font-500 uppercase tracking-wider" style={{ color: "var(--text-disabled)" }}>
                Búsquedas recientes
              </p>
              {history.map((term, i) => (
                <button
                  key={i}
                  onClick={() => goToSearch(term)}
                  className="w-full flex items-center gap-3 px-4 py-2.5 text-sm hover:opacity-80 transition-colors text-left"
                  style={{ color: "var(--text-secondary)" }}
                >
                  <Clock size={14} className="shrink-0" style={{ color: "var(--text-tertiary)" }} />
                  {term}
                </button>
              ))}
            </>
          )}

          {query && isSearching && (
            <div className="flex flex-col gap-2 px-4 py-3">
              {[...Array(3)].map((_, i) => (
                <div key={i} className="skeleton h-8 w-full" />
              ))}
            </div>
          )}

          {query && !isSearching && results.length > 0 && (
            <>
              <p className="px-4 py-1.5 text-xs font-500 uppercase tracking-wider" style={{ color: "var(--text-disabled)" }}>
                Resultados
              </p>
              {results.map((result, i) => (
                <button
                  key={result.id}
                  onClick={() => goToResult(result)}
                  className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-left transition-colors"
                  style={{
                    background: i === selected ? "var(--bg-tertiary)" : "transparent",
                    color: "var(--text-primary)",
                  }}
                >
                  {result.type === "VIDEO"
                    ? <Video size={15} className="shrink-0" style={{ color: "var(--text-tertiary)" }} />
                    : <FileText size={15} className="shrink-0" style={{ color: "var(--text-tertiary)" }} />
                  }
                  <span
                    className="flex-1 truncate"
                    dangerouslySetInnerHTML={{ __html: result._formatted?.title || result.title }}
                  />
                  {result.areaName && (
                    <span className="text-xs shrink-0" style={{ color: "var(--text-tertiary)" }}>
                      {result.areaName}
                    </span>
                  )}
                </button>
              ))}
            </>
          )}

          {query && !isSearching && results.length === 0 && (
            <div className="text-center py-8">
              <p className="text-sm" style={{ color: "var(--text-tertiary)" }}>
                No hay resultados para "{query}"
              </p>
              <button
                onClick={() => goToSearch(query)}
                className="mt-2 text-sm font-500 transition-colors"
                style={{ color: "var(--ai-primary)" }}
              >
                Buscar en todos los documentos →
              </button>
            </div>
          )}
        </div>

        {/* Footer */}
        <div
          className="flex items-center gap-4 px-4 py-2.5 text-xs"
          style={{ borderTop: "1px solid var(--border-subtle)", color: "var(--text-disabled)" }}
        >
          <span><kbd className="font-mono">↑↓</kbd> navegar</span>
          <span><kbd className="font-mono">↵</kbd> abrir</span>
          <span><kbd className="font-mono">Esc</kbd> cerrar</span>
        </div>
      </div>
    </div>
  );
}
