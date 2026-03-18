import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Settings, Save, RefreshCw, Trash2, AlertTriangle } from "lucide-react";
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

  const { data: cleanupPreview, refetch: refetchPreview } = useQuery({
    queryKey: ["admin-cleanup-preview"],
    queryFn: () => api.get("/admin/cleanup").then((r) => r.data),
    enabled: isSuperAdmin,
  });

  const [confirmCleanup, setConfirmCleanup] = useState(false);
  const [cleanupResult, setCleanupResult] = useState<Record<string, number> | null>(null);

  const cleanupMutation = useMutation({
    mutationFn: () => api.post("/admin/cleanup"),
    onSuccess: (res) => {
      setCleanupResult(res.data);
      setConfirmCleanup(false);
      refetchPreview();
    },
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

        <div className="border-t border-gray-100 pt-4 space-y-3">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-sm font-medium text-gray-700">Limpiar registros y archivos</p>
              <p className="text-xs text-gray-400 mt-0.5">
                Elimina documentos borrados, videos fallidos/atascados, tokens expirados y datos obsoletos
              </p>
            </div>
            <button
              onClick={() => { setCleanupResult(null); setConfirmCleanup(true); }}
              disabled={cleanupMutation.isPending}
              className="shrink-0 inline-flex items-center gap-2 px-3 py-2 border border-red-200 text-red-600 rounded-lg text-sm hover:bg-red-50 disabled:opacity-50 transition-colors"
            >
              <Trash2 className="w-4 h-4" />
              Limpiar
            </button>
          </div>

          {/* Preview de lo que se limpiará */}
          {cleanupPreview?.preview && (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {[
                { key: "softDeletedDocuments", label: "Docs eliminados" },
                { key: "failedVideoAssets",    label: "Videos fallidos" },
                { key: "stuckVideoAssets",     label: "Videos atascados" },
                { key: "expiredTokens",        label: "Tokens expirados" },
                { key: "oldNotifications",     label: "Notificaciones antiguas" },
                { key: "oldSearchHistory",     label: "Historial búsqueda" },
              ].map(({ key, label }) => (
                <div key={key} className="flex justify-between items-center px-3 py-1.5 bg-gray-50 rounded-lg text-xs">
                  <span className="text-gray-500">{label}</span>
                  <span className={`font-semibold ${cleanupPreview.preview[key] > 0 ? "text-red-600" : "text-gray-400"}`}>
                    {cleanupPreview.preview[key]}
                  </span>
                </div>
              ))}
            </div>
          )}

          {/* Resultado tras ejecutar */}
          {cleanupResult && (
            <div className="p-3 bg-green-50 border border-green-200 rounded-lg text-xs text-green-700 space-y-1">
              <p className="font-semibold">✓ Limpieza completada</p>
              {Object.entries(cleanupResult)
                .filter(([k, v]) => k !== "errors" && k !== "freedBytes" && (v as number) > 0)
                .map(([k, v]) => (
                  <p key={k}>{k}: <span className="font-medium">{v as number}</span> eliminados</p>
                ))
              }
              {(cleanupResult.freedBytes as number) > 0 && (
                <p>Espacio liberado: <span className="font-medium">{((cleanupResult.freedBytes as number) / (1024 * 1024)).toFixed(1)} MB</span></p>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Modal de confirmación */}
      {confirmCleanup && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-2xl shadow-xl p-6 max-w-sm w-full mx-4 space-y-4">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-red-100 rounded-lg">
                <AlertTriangle className="w-5 h-5 text-red-600" />
              </div>
              <div>
                <p className="font-semibold text-gray-900">Confirmar limpieza</p>
                <p className="text-xs text-gray-400">Esta acción es irreversible</p>
              </div>
            </div>
            <p className="text-sm text-gray-600">
              Se eliminarán permanentemente los registros y archivos indicados en la vista previa. Los documentos activos y usuarios no se verán afectados.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setConfirmCleanup(false)}
                className="flex-1 px-4 py-2 border border-gray-200 rounded-lg text-sm hover:bg-gray-50 transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={() => cleanupMutation.mutate()}
                disabled={cleanupMutation.isPending}
                className="flex-1 px-4 py-2 bg-red-600 text-white rounded-lg text-sm font-medium hover:bg-red-700 disabled:opacity-50 transition-colors"
              >
                {cleanupMutation.isPending ? "Limpiando..." : "Confirmar"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
