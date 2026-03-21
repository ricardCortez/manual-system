import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { BookOpen, CheckCircle2, Clock, Users, ChevronRight, X, Search, Filter } from "lucide-react";
import { Navigate } from "react-router-dom";
import api from "@/lib/api";
import { useIsAdmin } from "@/stores/auth.store";

interface DocStat {
  id: string;
  title: string;
  type: string;
  status: string;
  createdAt: string;
  area: { id: string; name: string } | null;
  readCount: number;
  totalUsers: number;
  pendingCount: number;
  readPercent: number;
}

interface UserReadStatus {
  id: string;
  name: string;
  email: string;
  role: string;
  jobTitle: string | null;
  area: { id: string; name: string } | null;
  hasRead: boolean;
  confirmedAt: string | null;
  confirmedVersion: string | null;
}

interface DocDetail {
  document: { id: string; title: string; type: string; status: string };
  users: UserReadStatus[];
}

const STATUS_LABELS: Record<string, string> = {
  PUBLICADO: "Publicado",
  BORRADOR: "Borrador",
  ARCHIVADO: "Archivado",
  EN_REVISION: "En revisión",
};

const TYPE_LABELS: Record<string, string> = {
  MANUAL: "Manual",
  PROCEDIMIENTO: "Procedimiento",
  POLITICA: "Política",
  FORMATO: "Formato",
  INSTRUCTIVO: "Instructivo",
  OTRO: "Otro",
};

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

export function AdminReadControl() {
  const isAdmin = useIsAdmin();
  const [selectedDoc, setSelectedDoc] = useState<DocStat | null>(null);
  const [docSearch, setDocSearch] = useState("");
  const [userSearch, setUserSearch] = useState("");
  const [areaFilter, setAreaFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState<"" | "read" | "pending">("");

  const { data: docs = [], isLoading } = useQuery<DocStat[]>({
    queryKey: ["read-control"],
    queryFn: () => api.get("/admin/read-control").then((r) => r.data),
    enabled: isAdmin,
  });

  const { data: areas = [] } = useQuery<{ id: string; name: string }[]>({
    queryKey: ["areas-list"],
    queryFn: () => api.get("/areas").then((r) => r.data?.areas ?? r.data),
    enabled: isAdmin,
  });

  const { data: docDetail, isLoading: loadingDetail } = useQuery<DocDetail>({
    queryKey: ["read-control-doc", selectedDoc?.id, areaFilter, statusFilter],
    queryFn: () =>
      api
        .get(`/admin/read-control/${selectedDoc!.id}/users`, {
          params: {
            ...(areaFilter && { areaId: areaFilter }),
            ...(statusFilter && { status: statusFilter }),
          },
        })
        .then((r) => r.data),
    enabled: !!selectedDoc,
  });

  if (!isAdmin) return <Navigate to="/" replace />;

  // Stats globales
  const totalDocs = docs.length;
  const totalConfirmed = docs.reduce((s, d) => s + d.readCount, 0);
  const totalPending = docs.reduce((s, d) => s + d.pendingCount, 0);
  const overallPercent =
    totalDocs > 0 && docs[0]?.totalUsers > 0
      ? Math.round((totalConfirmed / (totalDocs * docs[0].totalUsers)) * 100)
      : 0;

  const filteredDocs = docs.filter((d) =>
    d.title.toLowerCase().includes(docSearch.toLowerCase())
  );

  const filteredUsers = (docDetail?.users ?? []).filter((u) =>
    u.name.toLowerCase().includes(userSearch.toLowerCase()) ||
    u.email.toLowerCase().includes(userSearch.toLowerCase())
  );

  const readUsers = filteredUsers.filter((u) => u.hasRead);
  const pendingUsers = filteredUsers.filter((u) => !u.hasRead);
  const shownUsers = statusFilter === "read" ? readUsers : statusFilter === "pending" ? pendingUsers : filteredUsers;

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      {/* Encabezado */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Control de Lectura</h1>
        <p className="text-gray-400 text-sm mt-1">
          Seguimiento de confirmaciones de lectura por documento y usuario
        </p>
      </div>

      {/* Estadísticas globales */}
      {!isLoading && docs.length > 0 && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[
            {
              label: "Documentos",
              value: totalDocs,
              sub: "con seguimiento",
              icon: <BookOpen className="w-5 h-5" />,
              color: "text-blue-600 bg-blue-50",
            },
            {
              label: "Usuarios totales",
              value: docs[0]?.totalUsers ?? 0,
              sub: "activos en el sistema",
              icon: <Users className="w-5 h-5" />,
              color: "text-purple-600 bg-purple-50",
            },
            {
              label: "Confirmaciones",
              value: totalConfirmed,
              sub: "lecturas registradas",
              icon: <CheckCircle2 className="w-5 h-5" />,
              color: "text-green-600 bg-green-50",
            },
            {
              label: "Pendientes",
              value: totalPending,
              sub: "lecturas sin confirmar",
              icon: <Clock className="w-5 h-5" />,
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
        {/* Panel izquierdo: lista de documentos */}
        <div className={`bg-white rounded-xl border border-gray-200 flex flex-col ${selectedDoc ? "w-96 shrink-0" : "flex-1"}`}>
          <div className="p-4 border-b border-gray-100">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                value={docSearch}
                onChange={(e) => setDocSearch(e.target.value)}
                placeholder="Buscar documento..."
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
          ) : filteredDocs.length === 0 ? (
            <div className="p-8 text-center text-gray-400 text-sm">
              No hay documentos registrados
            </div>
          ) : (
            <div className="overflow-y-auto max-h-[600px]">
              {filteredDocs.map((doc) => (
                <button
                  key={doc.id}
                  onClick={() => {
                    setSelectedDoc(doc);
                    setUserSearch("");
                    setStatusFilter("");
                  }}
                  className={`w-full text-left px-4 py-3 border-b border-gray-50 hover:bg-gray-50 transition-colors flex items-center gap-3 ${
                    selectedDoc?.id === doc.id ? "bg-blue-50 border-l-2 border-l-blue-500" : ""
                  }`}
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-900 truncate">{doc.title}</p>
                    <p className="text-xs text-gray-400 mt-0.5">
                      {TYPE_LABELS[doc.type] ?? doc.type}
                      {doc.area ? ` · ${doc.area.name}` : ""}
                    </p>
                    {/* Barra de progreso */}
                    <div className="mt-2 flex items-center gap-2">
                      <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all ${
                            doc.readPercent === 100
                              ? "bg-green-500"
                              : doc.readPercent > 50
                              ? "bg-blue-500"
                              : "bg-orange-400"
                          }`}
                          style={{ width: `${doc.readPercent}%` }}
                        />
                      </div>
                      <span className="text-xs font-medium text-gray-500 shrink-0">
                        {doc.readCount}/{doc.totalUsers}
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
        {selectedDoc && (
          <div className="flex-1 bg-white rounded-xl border border-gray-200 flex flex-col min-w-0">
            {/* Header del detalle */}
            <div className="p-4 border-b border-gray-100 flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h2 className="font-semibold text-gray-900 truncate">{selectedDoc.title}</h2>
                <div className="flex items-center gap-2 mt-1">
                  <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">
                    {TYPE_LABELS[selectedDoc.type] ?? selectedDoc.type}
                  </span>
                  <span
                    className={`text-xs px-2 py-0.5 rounded-full ${
                      selectedDoc.status === "PUBLICADO"
                        ? "bg-green-100 text-green-700"
                        : "bg-gray-100 text-gray-600"
                    }`}
                  >
                    {STATUS_LABELS[selectedDoc.status] ?? selectedDoc.status}
                  </span>
                  <span className="text-xs text-gray-400">
                    {selectedDoc.readPercent}% leído
                  </span>
                </div>
              </div>
              <button
                onClick={() => setSelectedDoc(null)}
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
                  <option key={a.id} value={a.id}>{a.name}</option>
                ))}
              </select>
              <div className="flex rounded-lg border border-gray-200 overflow-hidden text-sm">
                {(["", "read", "pending"] as const).map((s) => (
                  <button
                    key={s}
                    onClick={() => setStatusFilter(s)}
                    className={`px-3 py-1.5 transition-colors ${
                      statusFilter === s
                        ? "bg-blue-600 text-white"
                        : "bg-white text-gray-600 hover:bg-gray-50"
                    }`}
                  >
                    {s === "" ? "Todos" : s === "read" ? "Leyeron" : "Pendientes"}
                  </button>
                ))}
              </div>
            </div>

            {/* Contadores */}
            <div className="px-4 py-2 bg-gray-50 border-b border-gray-100 flex gap-4 text-sm">
              <span className="flex items-center gap-1.5 text-green-700">
                <CheckCircle2 className="w-3.5 h-3.5" />
                {docDetail ? readUsers.length : "—"} leyeron
              </span>
              <span className="flex items-center gap-1.5 text-orange-600">
                <Clock className="w-3.5 h-3.5" />
                {docDetail ? pendingUsers.length : "—"} pendientes
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
                      <th className="text-left px-4 py-2.5 font-medium text-gray-500 text-xs">Cargo</th>
                      <th className="text-left px-4 py-2.5 font-medium text-gray-500 text-xs">Estado</th>
                      <th className="text-left px-4 py-2.5 font-medium text-gray-500 text-xs">Fecha lectura</th>
                    </tr>
                  </thead>
                  <tbody>
                    {shownUsers.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="px-4 py-8 text-center text-gray-400">
                          No se encontraron usuarios
                        </td>
                      </tr>
                    ) : (
                      shownUsers.map((u) => (
                        <tr key={u.id} className="border-b border-gray-50 hover:bg-gray-50 transition-colors">
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
                          <td className="px-4 py-3 text-gray-600 text-xs">
                            {u.jobTitle ?? <span className="text-gray-300">—</span>}
                          </td>
                          <td className="px-4 py-3">
                            {u.hasRead ? (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700">
                                <CheckCircle2 className="w-3 h-3" />
                                Leído
                                {u.confirmedVersion && (
                                  <span className="text-green-500">v{u.confirmedVersion}</span>
                                )}
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-orange-100 text-orange-700">
                                <Clock className="w-3 h-3" />
                                Pendiente
                              </span>
                            )}
                          </td>
                          <td className="px-4 py-3 text-xs text-gray-500 whitespace-nowrap">
                            {formatDate(u.confirmedAt)}
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
