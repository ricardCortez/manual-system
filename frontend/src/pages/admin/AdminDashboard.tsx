import { useQuery } from "@tanstack/react-query";
import { FileText, Users, Activity, Database, CheckCircle, AlertCircle } from "lucide-react";
import api from "@/lib/api";
import { useIsAdmin } from "@/stores/auth.store";
import { Navigate } from "react-router-dom";

interface Stats {
  documents: { total: number; published: number; draft: number };
  users: { total: number; active: number };
  storage: { documentsBytes: number; videosBytes: number };
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export function AdminDashboard() {
  const isAdmin = useIsAdmin();

  const { data, isLoading } = useQuery({
    queryKey: ["admin-dashboard"],
    queryFn: () => api.get("/admin/dashboard").then((r) => r.data),
    enabled: isAdmin,
  });

  const { data: health } = useQuery({
    queryKey: ["health"],
    queryFn: async () => {
      try {
        // Make request to /health endpoint through current host (goes via Nginx)
        const response = await fetch("/health");
        if (!response.ok) throw new Error("Health check failed");
        return response.json();
      } catch (err) {
        console.error("Health check error:", err);
        // Return false for all services if health check fails
        return { services: { database: false, redis: false, meilisearch: false } };
      }
    },
    refetchInterval: 30000,
  });

  if (!isAdmin) return <Navigate to="/" replace />;

  const stats: Stats = data?.stats ?? {};

  const cards = [
    {
      label: "Documentos",
      value: stats.documents?.total ?? "—",
      sub: `${stats.documents?.published ?? 0} publicados`,
      icon: <FileText className="w-6 h-6" />,
      color: "text-blue-600 bg-blue-50",
    },
    {
      label: "Usuarios",
      value: stats.users?.total ?? "—",
      sub: `${stats.users?.active ?? 0} activos`,
      icon: <Users className="w-6 h-6" />,
      color: "text-green-600 bg-green-50",
    },
    {
      label: "Documentos",
      value: stats.storage ? formatBytes(stats.storage.documentsBytes) : "—",
      sub: "almacenados",
      icon: <Database className="w-6 h-6" />,
      color: "text-purple-600 bg-purple-50",
    },
    {
      label: "Videos",
      value: stats.storage ? formatBytes(stats.storage.videosBytes) : "—",
      sub: "almacenados",
      icon: <Activity className="w-6 h-6" />,
      color: "text-orange-600 bg-orange-50",
    },
  ];

  const services = health?.services ?? {};

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Panel de Administración</h1>
        <p className="text-gray-400 text-sm mt-1">Estado y estadísticas del sistema</p>
      </div>

      {/* Estadísticas */}
      {isLoading ? (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="bg-gray-100 rounded-xl h-24 animate-pulse" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {cards.map((card, i) => (
            <div key={i} className="bg-white rounded-xl border border-gray-200 p-5">
              <div className={`inline-flex p-2 rounded-lg ${card.color} mb-3`}>
                {card.icon}
              </div>
              <p className="text-2xl font-bold text-gray-900">{card.value}</p>
              <p className="text-sm text-gray-500">{card.label} · {card.sub}</p>
            </div>
          ))}
        </div>
      )}

      {/* Estado de servicios */}
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <h2 className="font-semibold text-gray-800 mb-4">Estado de servicios</h2>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          {Object.entries({
            database: "PostgreSQL",
            redis: "Redis",
            meilisearch: "MeiliSearch",
          }).map(([key, label]) => {
            const ok = services[key] === true;
            return (
              <div key={key} className={`flex items-center gap-2 px-3 py-2 rounded-lg ${ok ? "bg-green-50" : "bg-red-50"}`}>
                {ok ? (
                  <CheckCircle className="w-4 h-4 text-green-600" />
                ) : (
                  <AlertCircle className="w-4 h-4 text-red-500" />
                )}
                <span className={`text-sm font-medium ${ok ? "text-green-700" : "text-red-600"}`}>
                  {label}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Links de administración */}
      <div className="grid md:grid-cols-2 gap-4">
        <a
          href="/admin/queues"
          target="_blank"
          rel="noreferrer"
          className="block bg-white border border-gray-200 rounded-xl p-5 hover:border-blue-300 hover:shadow-sm transition-all"
        >
          <h3 className="font-semibold text-gray-800">Cola de trabajos (Bull Board)</h3>
          <p className="text-sm text-gray-400 mt-1">Monitorear procesamiento de videos, IA y notificaciones</p>
        </a>
        <a
          href="/api/docs"
          target="_blank"
          rel="noreferrer"
          className="block bg-white border border-gray-200 rounded-xl p-5 hover:border-purple-300 hover:shadow-sm transition-all"
        >
          <h3 className="font-semibold text-gray-800">Documentación API</h3>
          <p className="text-sm text-gray-400 mt-1">Swagger UI con todos los endpoints disponibles</p>
        </a>
      </div>
    </div>
  );
}
