import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import { Search, FileText, Clock } from "lucide-react";
import api from "@/lib/api";
import { useDebounce } from "@/hooks/useDebounce";

interface SearchResult {
  id: string;
  title: string;
  type: string;
  area?: { name: string };
  snippet?: string;
  status: string;
}

export function SearchPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [query, setQuery] = useState(searchParams.get("q") ?? "");
  const debouncedQuery = useDebounce(query, 400);

  useEffect(() => {
    if (debouncedQuery) {
      setSearchParams({ q: debouncedQuery });
    } else {
      setSearchParams({});
    }
  }, [debouncedQuery, setSearchParams]);

  const { data: searchData, isLoading } = useQuery({
    queryKey: ["search", debouncedQuery],
    queryFn: () =>
      api.get("/search", { params: { q: debouncedQuery, limit: 20 } }).then((r) => r.data),
    enabled: debouncedQuery.length >= 2,
  });

  const { data: recentsData } = useQuery({
    queryKey: ["search-recent"],
    queryFn: () => api.get("/search/recent").then((r) => r.data),
    enabled: !debouncedQuery,
  });

  const results: SearchResult[] = searchData?.hits ?? [];
  const recents: string[] = recentsData?.queries ?? [];

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      <h1 className="text-2xl font-bold text-gray-900">Buscar</h1>

      {/* Barra de búsqueda */}
      <div className="relative">
        <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
        <input
          type="text"
          placeholder="Buscar en todos los manuales..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          autoFocus
          className="w-full pl-12 pr-4 py-3 text-base border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 shadow-sm"
        />
      </div>

      {/* Búsquedas recientes */}
      {!debouncedQuery && recents.length > 0 && (
        <div>
          <h2 className="text-sm font-medium text-gray-500 mb-2 flex items-center gap-1">
            <Clock className="w-4 h-4" /> Búsquedas recientes
          </h2>
          <div className="flex flex-wrap gap-2">
            {recents.map((q) => (
              <button
                key={q}
                onClick={() => setQuery(q)}
                className="px-3 py-1.5 bg-gray-100 hover:bg-gray-200 rounded-full text-sm text-gray-600 transition-colors"
              >
                {q}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Resultados */}
      {debouncedQuery.length >= 2 && (
        <div>
          {isLoading ? (
            <div className="space-y-3">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="bg-gray-100 rounded-xl h-16 animate-pulse" />
              ))}
            </div>
          ) : results.length === 0 ? (
            <div className="text-center py-12 text-gray-400">
              <Search className="w-10 h-10 mx-auto mb-2 opacity-30" />
              <p>No se encontraron resultados para <strong>"{debouncedQuery}"</strong></p>
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-sm text-gray-400">{searchData?.estimatedTotalHits ?? results.length} resultados</p>
              {results.map((result) => (
                <Link
                  key={result.id}
                  to={`/documentos/${result.id}`}
                  className="block bg-white border border-gray-200 rounded-xl p-4 hover:border-blue-300 hover:shadow-sm transition-all"
                >
                  <div className="flex items-start gap-3">
                    <FileText className="w-5 h-5 text-blue-500 shrink-0 mt-0.5" />
                    <div className="min-w-0">
                      <p className="font-medium text-gray-800">{result.title}</p>
                      {result.snippet && (
                        <p
                          className="text-sm text-gray-500 mt-1 line-clamp-2"
                          dangerouslySetInnerHTML={{ __html: result.snippet }}
                        />
                      )}
                      {result.area && (
                        <p className="text-xs text-gray-400 mt-1">{result.area.name}</p>
                      )}
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>
      )}

      {!debouncedQuery && recents.length === 0 && (
        <div className="text-center py-16 text-gray-400">
          <Search className="w-12 h-12 mx-auto mb-3 opacity-20" />
          <p>Escribe al menos 2 caracteres para buscar</p>
        </div>
      )}
    </div>
  );
}
