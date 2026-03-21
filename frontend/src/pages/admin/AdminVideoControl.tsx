import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Video, CheckCircle2, Clock, Users, ChevronRight, X, Search, Play, Eye } from "lucide-react";
import { Navigate } from "react-router-dom";
import api from "@/lib/api";
import { useIsAdmin } from "@/stores/auth.store";

interface VideoStat {
  id: string;
  title: string;
  status: string;
  createdAt: string;
  area: { id: string; name: string } | null;
  duration: number | null;
  processingStatus: string | null;
  thumbnailPath: string | null;
  viewCount: number;
  completedCount: number;
  totalUsers: number;
  pendingCount: number;
  completedPercent: number;
}

interface UserViewStatus {
  id: string;
  name: string;
  email: string;
  role: string;
  jobTitle: string | null;
  area: { id: string; name: string } | null;
  hasCompleted: boolean;
  watchedPercent: number;
  completedAt: string | null;
  watchCount: number;
  lastWatchedAt: string | null;
}

interface VideoDetail {
  document: { id: string; title: string; status: string; duration: number | null };
  users: UserViewStatus[];
}

const ROLE_LABELS: Record<string, string> = {
  SUPER_ADMIN: "Super Admin",
  ADMIN_SISTEMA: "Admin Sistema",
  ADMIN_AREA: "Admin Área",
  VISUALIZADOR: "Visualizador",
};

function formatDate(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("es-PE", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatDuration(seconds: number | null) {
  if (!seconds) return "—";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m ${String(s).padStart(2, "0")}s`;
}

export function AdminVideoControl() {
  const isAdmin = useIsAdmin();
  const [selectedVideo, setSelectedVideo] = useState<VideoStat | null>(null);
  const [videoSearch, setVideoSearch] = useState("");
  const [userSearch, setUserSearch] = useState("");
  const [areaFilter, setAreaFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState<"" | "completed" | "pending">("");

  const { data: videos = [], isLoading } = useQuery<VideoStat[]>({
    queryKey: ["video-control"],
    queryFn: () => api.get("/admin/video-control").then((r) => r.data),
    enabled: isAdmin,
  });

  const { data: areas = [] } = useQuery<{ id: string; name: string }[]>({
    queryKey: ["areas-list"],
    queryFn: () => api.get("/areas").then((r) => r.data?.areas ?? r.data),
    enabled: isAdmin,
  });

  const { data: videoDetail, isLoading: loadingDetail } = useQuery<VideoDetail>({
    queryKey: ["video-control-doc", selectedVideo?.id, areaFilter, statusFilter],
    queryFn: () =>
      api
        .get(`/admin/video-control/${selectedVideo!.id}/users`, {
          params: {
            ...(areaFilter && { areaId: areaFilter }),
            ...(statusFilter && { status: statusFilter }),
          },
        })
        .then((r) => r.data),
    enabled: !!selectedVideo,
  });

  if (!isAdmin) return <Navigate to="/" replace />;

  // Stats globales
  const totalVideos = videos.length;
  const totalUsers = videos[0]?.totalUsers ?? 0;
  const videosCompletos = videos.filter((v) => v.completedPercent === 100).length;
  const avgPercent =
    totalVideos > 0
      ? Math.round(videos.reduce((s, v) => s + v.completedPercent, 0) / totalVideos)
      : 0;

  const filteredVideos = videos.filter((v) =>
    v.title.toLowerCase().includes(videoSearch.toLowerCase())
  );

  const filteredUsers = (videoDetail?.users ?? []).filter(
    (u) =>
      u.name.toLowerCase().includes(userSearch.toLowerCase()) ||
      u.email.toLowerCase().includes(userSearch.toLowerCase())
  );

  const completedUsers = filteredUsers.filter((u) => u.hasCompleted);
  const pendingUsers = filteredUsers.filter((u) => !u.hasCompleted);
  const shownUsers =
    statusFilter === "completed"
      ? completedUsers
      : statusFilter === "pending"
      ? pendingUsers
      : filteredUsers;

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      {/* Encabezado */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Control de Videos</h1>
        <p className="text-gray-400 text-sm mt-1">
          Seguimiento de visionado de videos por usuario (completado al alcanzar el 85%)
        </p>
      </div>

      {/* Estadísticas globales */}
      {!isLoading && videos.length > 0 && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[
            {
              label: "Videos",
              value: totalVideos,
              sub: "con seguimiento",
              icon: <Video className="w-5 h-5" />,
              color: "text-blue-600 bg-blue-50",
            },
            {
              label: "Usuarios activos",
              value: totalUsers,
              sub: "en el sistema",
              icon: <Users className="w-5 h-5" />,
              color: "text-purple-600 bg-purple-50",
            },
            {
              label: "Vistos al 100%",
              value: `${videosCompletos} / ${totalVideos}`,
              sub: "videos vistos por todos",
              icon: <CheckCircle2 className="w-5 h-5" />,
              color: "text-green-600 bg-green-50",
            },
            {
              label: "Promedio de visionado",
              value: `${avgPercent}%`,
              sub: "sobre todos los videos",
              icon: <Play className="w-5 h-5" />,
              color: "text-orange-600 bg-orange-50",
            },
          ].map((card) => (
            <div key={card.label} className="bg-white rounded-xl border border-gray-200 p-5">
              <div className={`inline-flex p-2 rounded-lg ${card.color} mb-3`}>{card.icon}</div>
              <p className="text-2xl font-bold text-gray-900">{card.value}</p>
              <p className="text-sm text-gray-500">
                {card.label} · {card.sub}
              </p>
            </div>
          ))}
        </div>
      )}

      <div className="flex gap-6 items-start">
        {/* Panel izquierdo: lista de videos */}
        <div
          className={`bg-white rounded-xl border border-gray-200 flex flex-col ${
            selectedVideo ? "w-96 shrink-0" : "flex-1"
          }`}
        >
          <div className="p-4 border-b border-gray-100">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                value={videoSearch}
                onChange={(e) => setVideoSearch(e.target.value)}
                placeholder="Buscar video..."
                className="w-full pl-9 pr-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>

          {isLoading ? (
            <div className="p-4 space-y-3">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="h-16 bg-gray-100 rounded-lg animate-pulse" />
              ))}
            </div>
          ) : filteredVideos.length === 0 ? (
            <div className="p-8 text-center text-gray-400 text-sm">
              No hay videos registrados
            </div>
          ) : (
            <div className="overflow-y-auto max-h-[600px]">
              {filteredVideos.map((video) => (
                <button
                  key={video.id}
                  onClick={() => {
                    setSelectedVideo(video);
                    setUserSearch("");
                    setStatusFilter("");
                  }}
                  className={`w-full text-left px-4 py-3 border-b border-gray-50 hover:bg-gray-50 transition-colors flex items-center gap-3 ${
                    selectedVideo?.id === video.id
                      ? "bg-blue-50 border-l-2 border-l-blue-500"
                      : ""
                  }`}
                >
                  {/* Thumbnail o icono */}
                  <div className="w-14 h-10 rounded-lg overflow-hidden bg-gray-100 shrink-0 flex items-center justify-center">
                    {video.thumbnailPath ? (
                      <img
                        src={`/uploads/${video.thumbnailPath}`}
                        className="w-full h-full object-cover"
                        alt=""
                      />
                    ) : (
                      <Video className="w-5 h-5 text-gray-400" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-900 truncate">{video.title}</p>
                    <p className="text-xs text-gray-400 mt-0.5">
                      {formatDuration(video.duration)}
                      {video.area ? ` · ${video.area.name}` : ""}
                    </p>
                    {/* Barra de progreso */}
                    <div className="mt-2 flex items-center gap-2">
                      <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all ${
                            video.completedPercent === 100
                              ? "bg-green-500"
                              : video.completedPercent > 50
                              ? "bg-blue-500"
                              : "bg-orange-400"
                          }`}
                          style={{ width: `${video.completedPercent}%` }}
                        />
                      </div>
                      <span className="text-xs font-medium text-gray-500 shrink-0">
                        {video.completedCount}/{video.totalUsers}
                      </span>
                    </div>
                  </div>
                  <ChevronRight className="w-4 h-4 text-gray-300 shrink-0" />
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Panel derecho: detalle por usuario */}
        {selectedVideo && (
          <div className="flex-1 bg-white rounded-xl border border-gray-200 flex flex-col min-w-0">
            {/* Header */}
            <div className="p-4 border-b border-gray-100 flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h2 className="font-semibold text-gray-900 truncate">{selectedVideo.title}</h2>
                <div className="flex items-center gap-2 mt-1">
                  <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">
                    {formatDuration(selectedVideo.duration)}
                  </span>
                  <span className="text-xs text-gray-400">
                    {selectedVideo.completedPercent}% completado · {selectedVideo.viewCount} visualizaciones
                  </span>
                </div>
              </div>
              <button
                onClick={() => setSelectedVideo(null)}
                className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 shrink-0"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Filtros */}
            <div className="px-4 py-3 border-b border-gray-100 flex flex-wrap gap-2">
              <div className="relative flex-1 min-w-48">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
                <input
                  value={userSearch}
                  onChange={(e) => setUserSearch(e.target.value)}
                  placeholder="Buscar usuario..."
                  className="w-full pl-8 pr-3 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <select
                value={areaFilter}
                onChange={(e) => setAreaFilter(e.target.value)}
                className="text-sm border border-gray-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
              >
                <option value="">Todas las áreas</option>
                {areas.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
              <div className="flex rounded-lg border border-gray-200 overflow-hidden text-sm">
                {(["", "completed", "pending"] as const).map((s) => (
                  <button
                    key={s}
                    onClick={() => setStatusFilter(s)}
                    className={`px-3 py-1.5 transition-colors ${
                      statusFilter === s
                        ? "bg-blue-600 text-white"
                        : "bg-white text-gray-600 hover:bg-gray-50"
                    }`}
                  >
                    {s === "" ? "Todos" : s === "completed" ? "Completaron" : "Pendientes"}
                  </button>
                ))}
              </div>
            </div>

            {/* Contadores */}
            <div className="px-4 py-2 bg-gray-50 border-b border-gray-100 flex gap-4 text-sm">
              <span className="flex items-center gap-1.5 text-green-700">
                <CheckCircle2 className="w-3.5 h-3.5" />
                {videoDetail ? completedUsers.length : "—"} completaron
              </span>
              <span className="flex items-center gap-1.5 text-orange-600">
                <Clock className="w-3.5 h-3.5" />
                {videoDetail ? pendingUsers.length : "—"} pendientes
              </span>
            </div>

            {/* Tabla de usuarios */}
            {loadingDetail ? (
              <div className="p-4 space-y-2">
                {Array.from({ length: 6 }).map((_, i) => (
                  <div key={i} className="h-10 bg-gray-100 rounded animate-pulse" />
                ))}
              </div>
            ) : (
              <div className="overflow-auto max-h-[500px]">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-gray-50 border-b border-gray-100">
                    <tr>
                      <th className="text-left px-4 py-2.5 font-medium text-gray-500 text-xs">Usuario</th>
                      <th className="text-left px-4 py-2.5 font-medium text-gray-500 text-xs">Área</th>
                      <th className="text-left px-4 py-2.5 font-medium text-gray-500 text-xs">Progreso</th>
                      <th className="text-left px-4 py-2.5 font-medium text-gray-500 text-xs">Estado</th>
                      <th className="text-left px-4 py-2.5 font-medium text-gray-500 text-xs">Última vez</th>
                      <th className="text-left px-4 py-2.5 font-medium text-gray-500 text-xs">Veces</th>
                    </tr>
                  </thead>
                  <tbody>
                    {shownUsers.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="px-4 py-8 text-center text-gray-400">
                          No se encontraron usuarios
                        </td>
                      </tr>
                    ) : (
                      shownUsers.map((u) => (
                        <tr
                          key={u.id}
                          className="border-b border-gray-50 hover:bg-gray-50 transition-colors"
                        >
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-2.5">
                              <div className="w-7 h-7 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center text-xs font-semibold shrink-0">
                                {u.name.slice(0, 2).toUpperCase()}
                              </div>
                              <div className="min-w-0">
                                <p className="font-medium text-gray-900 truncate">{u.name}</p>
                                <p className="text-xs text-gray-400 truncate">{u.email}</p>
                              </div>
                            </div>
                          </td>
                          <td className="px-4 py-3 text-gray-600 text-xs">
                            {u.area?.name ?? <span className="text-gray-300">—</span>}
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-2">
                              <div className="w-20 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                                <div
                                  className={`h-full rounded-full ${
                                    u.watchedPercent >= 85
                                      ? "bg-green-500"
                                      : u.watchedPercent > 30
                                      ? "bg-blue-400"
                                      : "bg-gray-300"
                                  }`}
                                  style={{ width: `${u.watchedPercent}%` }}
                                />
                              </div>
                              <span className="text-xs text-gray-500">{u.watchedPercent}%</span>
                            </div>
                          </td>
                          <td className="px-4 py-3">
                            {u.hasCompleted ? (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700">
                                <CheckCircle2 className="w-3 h-3" />
                                Completado
                              </span>
                            ) : u.watchedPercent > 0 ? (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-700">
                                <Eye className="w-3 h-3" />
                                En progreso
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-orange-100 text-orange-700">
                                <Clock className="w-3 h-3" />
                                Sin ver
                              </span>
                            )}
                          </td>
                          <td className="px-4 py-3 text-xs text-gray-500 whitespace-nowrap">
                            {formatDate(u.lastWatchedAt)}
                          </td>
                          <td className="px-4 py-3 text-xs text-gray-500 text-center">
                            {u.watchCount > 0 ? (
                              <span className="inline-flex items-center gap-1">
                                <Play className="w-3 h-3" />
                                {u.watchCount}
                              </span>
                            ) : (
                              "—"
                            )}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
