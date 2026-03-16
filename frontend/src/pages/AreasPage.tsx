import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { ChevronRight, Folder, FolderOpen, FileText } from "lucide-react";
import { useState } from "react";
import api from "@/lib/api";

interface Area {
  id: string;
  name: string;
  description?: string;
  children?: Area[];
  _count?: { documents: number };
}

function AreaCard({ area, depth = 0 }: { area: Area; depth?: number }) {
  const [expanded, setExpanded] = useState(depth === 0);
  const hasChildren = area.children && area.children.length > 0;

  return (
    <div className={depth > 0 ? "ml-5 border-l border-gray-200 pl-4" : ""}>
      <div className="flex items-center gap-2 py-2 group">
        {hasChildren ? (
          <button
            onClick={() => setExpanded(!expanded)}
            className="flex items-center gap-2 flex-1 text-left"
          >
            {expanded ? (
              <FolderOpen className="w-5 h-5 text-blue-500 shrink-0" />
            ) : (
              <Folder className="w-5 h-5 text-blue-400 shrink-0" />
            )}
            <span className="font-medium text-gray-800 group-hover:text-blue-600 transition-colors">
              {area.name}
            </span>
            <ChevronRight
              className={`w-4 h-4 text-gray-400 transition-transform ${expanded ? "rotate-90" : ""}`}
            />
          </button>
        ) : (
          <div className="flex items-center gap-2 flex-1">
            <Folder className="w-5 h-5 text-gray-400 shrink-0" />
            <span className="font-medium text-gray-700">{area.name}</span>
          </div>
        )}
        <Link
          to={`/documentos?area=${area.id}`}
          className="hidden group-hover:flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800 shrink-0"
        >
          <FileText className="w-3.5 h-3.5" />
          {area._count?.documents ?? 0} docs
        </Link>
        {!hasChildren && (
          <span className="text-xs text-gray-400 shrink-0">
            {area._count?.documents ?? 0} docs
          </span>
        )}
      </div>
      {area.description && (
        <p className="text-sm text-gray-400 mb-1 ml-7">{area.description}</p>
      )}
      {hasChildren && expanded && (
        <div>
          {area.children!.map((child) => (
            <AreaCard key={child.id} area={child} depth={depth + 1} />
          ))}
        </div>
      )}
    </div>
  );
}

export function AreasPage() {
  const { data, isLoading } = useQuery({
    queryKey: ["areas"],
    queryFn: () => api.get("/areas").then((r) => r.data),
  });

  const areas: Area[] = data?.data ?? data ?? [];

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Áreas organizativas</h1>
        <p className="text-gray-400 text-sm mt-1">Estructura de departamentos y sus manuales</p>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-5">
        {isLoading ? (
          <div className="space-y-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="h-8 bg-gray-100 rounded animate-pulse" />
            ))}
          </div>
        ) : areas.length === 0 ? (
          <p className="text-center text-gray-400 py-8">No hay áreas configuradas.</p>
        ) : (
          <div className="space-y-1">
            {areas.map((area) => (
              <AreaCard key={area.id} area={area} depth={0} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
