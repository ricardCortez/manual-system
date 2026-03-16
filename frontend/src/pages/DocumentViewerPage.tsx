import { useState, useEffect, useRef } from "react";
import { useParams, Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowLeft, Download, Printer, Star, StarOff, CheckCircle,
  ChevronRight, Eye, Clock, Tag, Shield, FileText,
} from "lucide-react";
import { Document, Page, pdfjs } from "react-pdf";
import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import api from "@/lib/api";
import { SummaryPanel } from "@/components/ai/SummaryPanel";
import { ChatDrawer } from "@/components/ai/ChatDrawer";
import { VideoPlayer } from "@/components/video/VideoPlayer";

// Configurar worker de PDF.js
pdfjs.GlobalWorkerOptions.workerSrc = `//unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.js`;

const statusLabels: Record<string, string> = {
  BORRADOR: "Borrador",
  EN_REVISION: "En revisión",
  APROBADO: "Aprobado",
  PUBLICADO: "Publicado",
  OBSOLETO: "Obsoleto",
};

const confLabels: Record<string, { label: string; color: string }> = {
  PUBLICO:     { label: "Público",     color: "var(--conf-public)" },
  RESTRINGIDO: { label: "Restringido", color: "var(--conf-restricted)" },
  CRITICO:     { label: "Crítico",     color: "var(--conf-critical)" },
};

export function DocumentViewerPage() {
  const { id } = useParams<{ id: string }>();
  const [numPages, setNumPages] = useState<number>(0);
  const [pageNumber, setPageNumber] = useState(1);
  const [isFavorite, setIsFavorite] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [headerHidden, setHeaderHidden] = useState(false);
  const lastScrollY = useRef(0);
  const queryClient = useQueryClient();

  const { data: document, isLoading } = useQuery({
    queryKey: ["document", id],
    queryFn: () => api.get(`/documents/${id}`).then((r) => r.data),
    enabled: !!id,
  });

  // Detectar scroll para modo inmersivo
  useEffect(() => {
    const handleScroll = () => {
      const current = window.scrollY;
      setHeaderHidden(current > 100 && current > lastScrollY.current);
      lastScrollY.current = current;
    };
    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  const favMutation = useMutation({
    mutationFn: () =>
      isFavorite
        ? api.delete(`/documents/${id}/favorite`)
        : api.post(`/documents/${id}/favorite`),
    onSuccess: () => setIsFavorite((v) => !v),
  });

  const confirmReadMutation = useMutation({
    mutationFn: () =>
      api.post(`/documents/${id}/confirm-read`, {
        versionId: document?.currentVersionId,
      }),
  });

  if (isLoading) return <DocumentViewerSkeleton />;
  if (!document) return <div className="p-8 text-center">Documento no encontrado</div>;

  const currentVersion = document.versions?.[0];
  const isDocType = document.type === "DOCUMENT" || document.type === "DOCUMENT_VIDEO" || document.type === "MULTIMEDIA";
  const isVideoType = document.type === "VIDEO" || document.type === "DOCUMENT_VIDEO";
  const conf = confLabels[document.confidentiality] || confLabels.PUBLICO;

  return (
    <div className="min-h-screen" style={{ background: "var(--bg-primary)" }}>
      {/* Header inmersivo */}
      <header
        className={`immersive-header sticky top-0 z-10 ${headerHidden ? "hidden" : ""}`}
        style={{
          background: "var(--bg-primary)",
          borderBottom: "1px solid var(--border-subtle)",
          backdropFilter: "blur(12px)",
        }}
      >
        <div className="max-w-5xl mx-auto px-6 h-14 flex items-center gap-4">
          <Link
            to="/documentos"
            className="flex items-center gap-1.5 text-sm transition-colors"
            style={{ color: "var(--text-tertiary)" }}
          >
            <ArrowLeft size={15} />
            Documentos
          </Link>

          <ChevronRight size={13} style={{ color: "var(--text-disabled)" }} />

          <div className="flex items-center gap-2 text-sm flex-1 min-w-0">
            <span style={{ color: "var(--text-secondary)" }} className="truncate">{document.area?.name}</span>
            <ChevronRight size={13} style={{ color: "var(--text-disabled)" }} />
            <span className="truncate font-500" style={{ color: "var(--text-primary)" }}>{document.title}</span>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={() => favMutation.mutate()}
              className="p-2 rounded-lg transition-colors"
              style={{ color: isFavorite ? "#F59E0B" : "var(--text-tertiary)" }}
              title={isFavorite ? "Quitar de favoritos" : "Añadir a favoritos"}
            >
              {isFavorite ? <Star size={16} fill="currentColor" /> : <StarOff size={16} />}
            </button>

            <button
              className="p-2 rounded-lg transition-colors"
              style={{ color: "var(--text-tertiary)" }}
              title="Descargar"
              onClick={() => window.open(`/uploads/${currentVersion?.filePath}`, "_blank")}
            >
              <Download size={16} />
            </button>
          </div>
        </div>
      </header>

      {/* Contenido principal */}
      <div className="max-w-5xl mx-auto px-6 py-8">
        {/* Metadatos del documento */}
        <div className="mb-6">
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-2">
                <span
                  className="text-xs px-2 py-0.5 rounded font-mono"
                  style={{ background: "var(--bg-tertiary)", color: "var(--text-secondary)" }}
                >
                  {document.code}
                </span>
                <span
                  className="text-xs px-2 py-0.5 rounded-full font-500"
                  style={{ background: `${conf.color}15`, color: conf.color }}
                >
                  <Shield size={10} className="inline mr-1" />
                  {conf.label}
                </span>
              </div>

              <h1
                className="font-display text-3xl font-700 leading-tight mb-2"
                style={{ color: "var(--text-primary)", letterSpacing: "-0.025em" }}
              >
                {document.title}
              </h1>

              {document.description && (
                <p className="text-base leading-relaxed mb-3" style={{ color: "var(--text-secondary)" }}>
                  {document.description}
                </p>
              )}

              <div className="flex flex-wrap items-center gap-4 text-sm" style={{ color: "var(--text-tertiary)" }}>
                <span className="flex items-center gap-1.5">
                  <FileText size={14} />
                  {document.area?.name}
                </span>
                <span className="flex items-center gap-1.5">
                  <Eye size={14} />
                  {document.author?.name}
                </span>
                {document.updatedAt && (
                  <span className="flex items-center gap-1.5">
                    <Clock size={14} />
                    {format(new Date(document.updatedAt), "d MMM yyyy", { locale: es })}
                  </span>
                )}
              </div>
            </div>

            {/* Estado */}
            <div
              className="relative shrink-0 flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-500"
              style={{
                background: "var(--bg-secondary)",
                borderLeft: `3px solid var(--status-${document.status?.toLowerCase() === "en_revision" ? "review" : document.status?.toLowerCase()})`,
              }}
            >
              {statusLabels[document.status] || document.status}
            </div>
          </div>

          {/* Tags */}
          {document.tags?.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-3">
              <Tag size={13} style={{ color: "var(--text-tertiary)" }} className="mt-0.5" />
              {document.tags.map((tag: string) => (
                <span
                  key={tag}
                  className="tag text-xs"
                  style={{
                    background: "var(--bg-tertiary)",
                    color: "var(--text-secondary)",
                    border: "1px solid var(--border-subtle)",
                  }}
                >
                  {tag}
                </span>
              ))}
            </div>
          )}
        </div>

        {/* Visor de contenido */}
        {isVideoType && currentVersion?.videoAsset && (
          <div className="mb-6">
            <VideoPlayer
              hlsUrl={`/uploads/${currentVersion.videoAsset.hlsManifestPath}`}
              thumbnailUrl={currentVersion.videoAsset.thumbnailPath ? `/uploads/${currentVersion.videoAsset.thumbnailPath}` : undefined}
              chapters={currentVersion.videoAsset.chapters}
              transcriptSegments={currentVersion.videoAsset.transcript?.segments}
              vttUrl={currentVersion.videoAsset.transcript?.vttPath ? `/uploads/${currentVersion.videoAsset.transcript.vttPath}` : undefined}
              title={document.title}
            />
          </div>
        )}

        {isDocType && currentVersion?.filePath && currentVersion.mimeType === "application/pdf" && (
          <div
            className="rounded-2xl overflow-hidden mb-6"
            style={{ border: "1px solid var(--border-subtle)", background: "#525659" }}
          >
            {/* Toolbar PDF */}
            <div
              className="flex items-center justify-between px-4 py-2.5"
              style={{ background: "var(--bg-secondary)", borderBottom: "1px solid var(--border-subtle)" }}
            >
              <div className="flex items-center gap-2">
                <button
                  disabled={pageNumber <= 1}
                  onClick={() => setPageNumber((p) => p - 1)}
                  className="px-3 py-1 rounded text-sm transition-colors disabled:opacity-40"
                  style={{ background: "var(--bg-tertiary)", color: "var(--text-secondary)" }}
                >
                  ‹
                </button>
                <span className="text-sm" style={{ color: "var(--text-secondary)" }}>
                  {pageNumber} / {numPages}
                </span>
                <button
                  disabled={pageNumber >= numPages}
                  onClick={() => setPageNumber((p) => p + 1)}
                  className="px-3 py-1 rounded text-sm transition-colors disabled:opacity-40"
                  style={{ background: "var(--bg-tertiary)", color: "var(--text-secondary)" }}
                >
                  ›
                </button>
              </div>
              <button
                onClick={() => window.open(`/uploads/${currentVersion.filePath}`, "_blank")}
                className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg transition-colors"
                style={{ background: "var(--bg-tertiary)", color: "var(--text-secondary)" }}
              >
                <Download size={13} />
                Descargar PDF
              </button>
            </div>

            {/* Visor react-pdf */}
            <div className="flex justify-center p-6">
              <Document
                file={`/uploads/${currentVersion.filePath}`}
                onLoadSuccess={({ numPages: n }) => setNumPages(n)}
                loading={<div className="skeleton w-full max-w-2xl" style={{ height: 800 }} />}
              >
                <Page
                  pageNumber={pageNumber}
                  width={Math.min(window.innerWidth - 80, 800)}
                  renderTextLayer
                  renderAnnotationLayer
                />
              </Document>
            </div>
          </div>
        )}

        {/* Panel IA — solo para documentos escritos */}
        {isDocType && !isVideoType && currentVersion && (
          <SummaryPanel
            documentVersionId={currentVersion.id}
            isOutdated={document.versions?.length > 1 && document.currentVersionId !== currentVersion.id}
            onChatOpen={() => setChatOpen(true)}
          />
        )}

        {/* Confirmación de lectura */}
        <div
          className="mt-6 flex items-center gap-4 p-4 rounded-xl"
          style={{ background: "var(--bg-secondary)", border: "1px solid var(--border-subtle)" }}
        >
          <CheckCircle size={20} style={{ color: "var(--status-approved)", shrink: 0 }} />
          <div className="flex-1">
            <p className="text-sm font-500" style={{ color: "var(--text-primary)" }}>
              Confirmar lectura
            </p>
            <p className="text-xs" style={{ color: "var(--text-tertiary)" }}>
              Al confirmar, se registra que has leído y entendido este manual.
            </p>
          </div>
          <button
            onClick={() => confirmReadMutation.mutate()}
            disabled={confirmReadMutation.isSuccess || confirmReadMutation.isPending}
            className="px-4 py-2 rounded-lg text-sm font-500 transition-all shrink-0"
            style={{
              background: confirmReadMutation.isSuccess ? "var(--status-approved)" : "var(--text-primary)",
              color: "var(--text-inverse)",
              opacity: confirmReadMutation.isPending ? 0.7 : 1,
            }}
          >
            {confirmReadMutation.isSuccess ? "✓ Confirmado" : "He leído este manual"}
          </button>
        </div>
      </div>

      {/* Chat Drawer — solo para documentos escritos */}
      {chatOpen && currentVersion && (
        <ChatDrawer
          documentVersionId={currentVersion.id}
          documentTitle={document.title}
          onClose={() => setChatOpen(false)}
        />
      )}
    </div>
  );
}

function DocumentViewerSkeleton() {
  return (
    <div className="max-w-5xl mx-auto px-6 py-8">
      <div className="skeleton h-4 w-32 mb-6" />
      <div className="skeleton h-8 w-2/3 mb-3" />
      <div className="skeleton h-4 w-full mb-2" />
      <div className="skeleton h-4 w-3/4 mb-8" />
      <div className="skeleton rounded-2xl" style={{ height: 600 }} />
    </div>
  );
}
