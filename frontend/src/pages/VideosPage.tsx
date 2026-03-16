import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Video, Play, Clock, Search } from "lucide-react";
import api from "@/lib/api";
import { useDebounce } from "@/hooks/useDebounce";

interface VideoDoc {
  id: string;
  title: string;
  area?: { name: string };
  updatedAt: string;
  currentVersion?: {
    videoAsset?: {
      status: string;
      durationSeconds?: number;
      thumbnailPath?: string;
    };
  };
}

function formatDuration(seconds?: number) {
  if (!seconds) return "";
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function VideosPage() {
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebounce(search, 300);

  const { data, isLoading } = useQuery({
    queryKey: ["videos", debouncedSearch],
    queryFn: () =>
      api
        .get("/documents", {
          params: {
            type: "VIDEO",
            q: debouncedSearch || undefined,
            status: "PUBLICADO",
            limit: 24,
          },
        })
        .then((r) => r.data),
  });

  const videos: VideoDoc[] = data?.data ?? [];

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Videos</h1>
        <span className="text-sm text-gray-400">{data?.total ?? 0} videos</span>
      </div>

      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
        <input
          type="text"
          placeholder="Buscar videos..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full pl-9 pr-4 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
        />
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="bg-gray-100 rounded-xl aspect-video animate-pulse" />
          ))}
        </div>
      ) : videos.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-gray-400">
          <Video className="w-12 h-12 mb-3 opacity-30" />
          <p>No hay videos disponibles.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {videos.map((doc) => (
            <Link
              key={doc.id}
              to={`/documentos/${doc.id}`}
              className="group bg-white rounded-xl border border-gray-200 overflow-hidden hover:shadow-md transition-all"
            >
              <div className="relative aspect-video bg-gray-900 flex items-center justify-center">
                {doc.currentVersion?.videoAsset?.thumbnailPath ? (
                  <img
                    src={`/uploads/${doc.currentVersion.videoAsset.thumbnailPath}`}
                    alt={doc.title}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <Video className="w-12 h-12 text-gray-600" />
                )}
                <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity bg-black/30">
                  <div className="w-12 h-12 bg-white/90 rounded-full flex items-center justify-center">
                    <Play className="w-5 h-5 text-gray-900 ml-0.5" />
                  </div>
                </div>
                {doc.currentVersion?.videoAsset?.durationSeconds && (
                  <span className="absolute bottom-2 right-2 bg-black/70 text-white text-xs px-1.5 py-0.5 rounded flex items-center gap-1">
                    <Clock className="w-3 h-3" />
                    {formatDuration(doc.currentVersion.videoAsset.durationSeconds)}
                  </span>
                )}
              </div>
              <div className="p-3">
                <p className="text-sm font-medium text-gray-800 line-clamp-2">{doc.title}</p>
                {doc.area && (
                  <p className="text-xs text-gray-400 mt-1">{doc.area.name}</p>
                )}
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
