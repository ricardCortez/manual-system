import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Settings, Save, RefreshCw } from "lucide-react";
import { useState, useEffect } from "react";
import api from "@/lib/api";
import { useAuthStore } from "@/stores/auth.store";
import { Navigate } from "react-router-dom";

interface ConfigEntry {
  key: string;
  value: string;
  description?: string;
}

export function AdminConfig() {
  const role = useAuthStore((s) => s.user?.role);
  const isSuperAdmin = role === "SUPER_ADMIN";
  const queryClient = useQueryClient();
  const [edited, setEdited] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["admin-config"],
    queryFn: () => api.get("/admin/config").then((r) => r.data),
    enabled: isSuperAdmin,
  });

  const config: ConfigEntry[] = data?.config ?? [];

  useEffect(() => {
    if (config.length) {
      const initial: Record<string, string> = {};
      config.forEach((c) => { initial[c.key] = c.value; });
      setEdited(initial);
    }
  }, [data]);

  const saveMutation = useMutation({
    mutationFn: (updates: Record<string, string>) =>
      api.put("/admin/config", { config: updates }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-config"] });
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    },
  });

  const reindexMutation = useMutation({
    mutationFn: () => api.post("/admin/reindex"),
  });

  if (!isSuperAdmin) return <Navigate to="/admin" replace />;

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-6">
      <div className="flex items-center gap-2">
        <Settings className="w-6 h-6 text-gray-500" />
        <h1 className="text-2xl font-bold text-gray-900">Configuración del sistema</h1>
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-16 bg-gray-100 rounded-xl animate-pulse" />
          ))}
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 divide-y divide-gray-100">
          {config.map((entry) => (
            <div key={entry.key} className="px-5 py-4">
              <label className="block text-sm font-medium text-gray-700 mb-1">
                {entry.key}
              </label>
              {entry.description && (
                <p className="text-xs text-gray-400 mb-2">{entry.description}</p>
              )}
              <input
                type="text"
                value={edited[entry.key] ?? entry.value}
                onChange={(e) => setEdited((prev) => ({ ...prev, [entry.key]: e.target.value }))}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          ))}
          {config.length === 0 && (
            <div className="px-5 py-8 text-center text-gray-400">
              No hay configuraciones disponibles.
            </div>
          )}
        </div>
      )}

      <div className="flex items-center gap-3">
        <button
          onClick={() => saveMutation.mutate(edited)}
          disabled={saveMutation.isPending || config.length === 0}
          className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 transition-colors"
        >
          <Save className="w-4 h-4" />
          {saveMutation.isPending ? "Guardando..." : "Guardar cambios"}
        </button>
        {saved && <span className="text-sm text-green-600 font-medium">✓ Guardado</span>}
      </div>

      {/* Herramientas */}
      <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-4">
        <h2 className="font-semibold text-gray-800">Herramientas de mantenimiento</h2>
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-gray-700">Reindexar búsqueda</p>
            <p className="text-xs text-gray-400">Reconstruye el índice de MeiliSearch con todos los documentos</p>
          </div>
          <button
            onClick={() => reindexMutation.mutate()}
            disabled={reindexMutation.isPending}
            className="inline-flex items-center gap-2 px-3 py-2 border border-gray-200 rounded-lg text-sm hover:bg-gray-50 disabled:opacity-50 transition-colors"
          >
            <RefreshCw className={`w-4 h-4 ${reindexMutation.isPending ? "animate-spin" : ""}`} />
            {reindexMutation.isPending ? "Indexando..." : "Reindexar"}
          </button>
        </div>
      </div>
    </div>
  );
}
