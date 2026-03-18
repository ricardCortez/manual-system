import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router-dom";
import { Video, Play, Clock, Search, Plus, Trash2 } from "lucide-react";
import api from "@/lib/api";
import { useDebounce } from "@/hooks/useDebounce";
import { useCanEdit, useIsAdmin } from "@/stores/auth.store";

interface VideoDoc {
  id: string;
  title: string;
  status: string;
  area?: { name: string };
  updatedAt: string;
  currentVersion?: {
    videoAsset?: {
      processingStatus: string;
      processingProgress?: number;
      duration?: number;
      thumbnailPath?: string;
    };
  };
}

const PROCESSING_STATUSES = ["PENDING", "UPLOADING", "VALIDATING", "ENCODING", "GENERATING_HLS", "EXTRACTING_AUDIO", "TRANSCRIBING", "INDEXING"];

function ProcessingBadge({ asset }: { asset: VideoDoc["currentVersion"]["videoAsset"] }) {
  if (!asset) return <div className="w-full h-full flex items-center justify-center"><Video className="w-12 h-12 text-gray-600" /></div>;
  if (asset.processingStatus === "FAILED") return (
    <div className="w-full h-full flex flex-col items-center justify-center gap-1 text-red-400">
      <Video className="w-8 h-8" /><span className="text-xs">Error al procesar</span>
    </div>
  );
  if (PROCESSING_STATUSES.includes(asset.processingStatus)) return (
    <div className="w-full h-full flex flex-col items-center justify-center gap-2 text-gray-400 px-4">
      <div className="w-full bg-gray-700 rounded-full h-1.5">
        <div className="bg-blue-500 h-1.5 rounded-full transition-all" style={{ width: `${asset.processingProgress ?? 0}%` }} />
      </div>
      <span className="text-xs text-center">{asset.processingStatus.replace(/_/g, " ")} {asset.processingProgress ?? 0}%</span>
    </div>
  );
  return null;
}

function formatDuration(seconds?: number) {
  if (!seconds) return "";
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function VideosPage() {
  const [search, setSearch] = useState("");
  const canEdit = useCanEdit();
  const isAdmin = useIsAdmin();
  const navigate = useNavigate();
  const debouncedSearch = useDebounce(search, 300);
  const queryClient = useQueryClient();

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/documents/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["videos"] }),
  });

  function handleDelete(doc: VideoDoc, e: React.MouseEvent) {
    e.preventDefault();
    if (!window.confirm(`¿Eliminar "${doc.title}"? Esta acción no se puede deshacer.`)) return;
    deleteMutation.mutate(doc.id);
  }

  const { data, isLoading } = useQuery({
    queryKey: ["videos", debouncedSearch],
    queryFn: () =>
      api
        .get("/documents", {
          params: {
            type: "VIDEO",
            search: debouncedSearch || undefined,
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
        <div className="flex items-center gap-3">
          <span className="text-sm text-gray-400">{data?.total ?? 0} videos</span>
          {canEdit && (
            <button
              onClick={() => navigate("/documentos?upload=VIDEO&returnTo=/videos")}
              className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 transition-colors"
            >
              <Plus size={16} />
              Subir video
            </button>
          )}
        </div>
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
                {doc.currentVersion?.videoAsset?.processingStatus === "COMPLETED" && doc.currentVersion.videoAsset.thumbnailPath ? (
                  <>
                    <img
                      src={`/uploads/${doc.currentVersion.videoAsset.thumbnailPath}`}
                      alt={doc.title}
                      className="w-full h-full object-cover"
                    />
                    <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity bg-black/30">
                      <div className="w-12 h-12 bg-white/90 rounded-full flex items-center justify-center">
                        <Play className="w-5 h-5 text-gray-900 ml-0.5" />
                      </div>
                    </div>
                    {doc.currentVersion.videoAsset.duration && (
                      <span className="absolute bottom-2 right-2 bg-black/70 text-white text-xs px-1.5 py-0.5 rounded flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        {formatDuration(doc.currentVersion.videoAsset.duration)}
                      </span>
                    )}
                  </>
                ) : (
                  <ProcessingBadge asset={doc.currentVersion?.videoAsset} />
                )}
              </div>
              <div className="p-3">
                <div className="flex items-start justify-between gap-2">
                  <p className="text-sm font-medium text-gray-800 line-clamp-2">{doc.title}</p>
                  {isAdmin && (
                    <button
                      onClick={(e) => handleDelete(doc, e)}
                      disabled={deleteMutation.isPending}
                      className="shrink-0 p-1 rounded text-gray-400 hover:text-red-600 hover:bg-red-50 transition-colors"
                      title="Eliminar video"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
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
