import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { FileText, Video, Search, Clock, Star, BookOpen } from "lucide-react";
import api from "@/lib/api";
import { useAuthStore } from "@/stores/auth.store";

export function DashboardPage() {
  const user = useAuthStore((s) => s.user);

  const { data: recents } = useQuery({
    queryKey: ["recents"],
    queryFn: () => api.get("/documents?limit=5&sort=updatedAt").then((r) => r.data),
  });

  const { data: favorites } = useQuery({
    queryKey: ["favorites"],
    queryFn: () => api.get("/documents?favorite=true&limit=5").then((r) => r.data),
  });

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-8">
      {/* Bienvenida */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">
          Bienvenido, {user?.name ?? "Usuario"}
        </h1>
        <p className="text-gray-500 mt-1">Sistema de Gestión de Manuales Internos</p>
      </div>

      {/* Accesos rápidos */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Link
          to="/documentos"
          className="flex flex-col items-center gap-2 p-5 bg-white rounded-xl border border-gray-200 hover:border-blue-400 hover:shadow transition-all"
        >
          <FileText className="w-8 h-8 text-blue-600" />
          <span className="text-sm font-medium text-gray-700">Documentos</span>
        </Link>
        <Link
          to="/videos"
          className="flex flex-col items-center gap-2 p-5 bg-white rounded-xl border border-gray-200 hover:border-purple-400 hover:shadow transition-all"
        >
          <Video className="w-8 h-8 text-purple-600" />
          <span className="text-sm font-medium text-gray-700">Videos</span>
        </Link>
        <Link
          to="/buscar"
          className="flex flex-col items-center gap-2 p-5 bg-white rounded-xl border border-gray-200 hover:border-green-400 hover:shadow transition-all"
        >
          <Search className="w-8 h-8 text-green-600" />
          <span className="text-sm font-medium text-gray-700">Buscar</span>
        </Link>
        <Link
          to="/areas"
          className="flex flex-col items-center gap-2 p-5 bg-white rounded-xl border border-gray-200 hover:border-orange-400 hover:shadow transition-all"
        >
          <BookOpen className="w-8 h-8 text-orange-600" />
          <span className="text-sm font-medium text-gray-700">Áreas</span>
        </Link>
      </div>

      <div className="grid md:grid-cols-2 gap-6">
        {/* Recientes */}
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <div className="flex items-center gap-2 mb-4">
            <Clock className="w-5 h-5 text-gray-400" />
            <h2 className="font-semibold text-gray-800">Documentos recientes</h2>
          </div>
          {recents?.data?.length ? (
            <ul className="space-y-2">
              {recents.data.map((doc: { id: string; title: string; area?: { name: string } }) => (
                <li key={doc.id}>
                  <Link
                    to={`/documentos/${doc.id}`}
                    className="flex items-center gap-3 p-2 rounded-lg hover:bg-gray-50 transition-colors"
                  >
                    <FileText className="w-4 h-4 text-blue-500 shrink-0" />
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-gray-800 truncate">{doc.title}</p>
                      {doc.area && (
                        <p className="text-xs text-gray-400">{doc.area.name}</p>
                      )}
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-gray-400">No hay documentos recientes.</p>
          )}
        </div>

        {/* Favoritos */}
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <div className="flex items-center gap-2 mb-4">
            <Star className="w-5 h-5 text-yellow-400" />
            <h2 className="font-semibold text-gray-800">Favoritos</h2>
          </div>
          {favorites?.data?.length ? (
            <ul className="space-y-2">
              {favorites.data.map((doc: { id: string; title: string; area?: { name: string } }) => (
                <li key={doc.id}>
                  <Link
                    to={`/documentos/${doc.id}`}
                    className="flex items-center gap-3 p-2 rounded-lg hover:bg-gray-50 transition-colors"
                  >
                    <FileText className="w-4 h-4 text-yellow-500 shrink-0" />
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-gray-800 truncate">{doc.title}</p>
                      {doc.area && (
                        <p className="text-xs text-gray-400">{doc.area.name}</p>
                      )}
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-gray-400">No tienes favoritos aún.</p>
          )}
        </div>
      </div>
    </div>
  );
}
