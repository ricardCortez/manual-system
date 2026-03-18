import { useState, useRef, useEffect, type FormEvent } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import { FileText, Search, Filter, Eye, Plus, Upload, X, Trash2, AlertCircle, CheckCircle } from "lucide-react";
import api from "@/lib/api";
import { useDebounce } from "@/hooks/useDebounce";
import { useCanEdit, useIsAdmin } from "@/stores/auth.store";

interface Document {
  id: string;
  title: string;
  type: string;
  status: string;
  confidentiality: string;
  area?: { name: string };
  updatedAt: string;
}

interface Area {
  id: string;
  name: string;
  code: string;
}

const STATUS_LABELS: Record<string, string> = {
  BORRADOR: "Borrador",
  EN_REVISION: "En revisión",
  APROBADO: "Aprobado",
  PUBLICADO: "Publicado",
  OBSOLETO: "Obsoleto",
};

const STATUS_COLORS: Record<string, string> = {
  BORRADOR: "bg-gray-100 text-gray-600",
  EN_REVISION: "bg-yellow-100 text-yellow-700",
  APROBADO: "bg-blue-100 text-blue-700",
  PUBLICADO: "bg-green-100 text-green-700",
  OBSOLETO: "bg-red-100 text-red-600",
};

const DOC_TYPES = [
  { value: "DOCUMENT", label: "Documento" },
  { value: "VIDEO", label: "Video" },
  { value: "DOCUMENT_VIDEO", label: "Documento + Video" },
  { value: "MULTIMEDIA", label: "Multimedia" },
];

const CONF_LEVELS = [
  { value: "PUBLICO", label: "Público" },
  { value: "RESTRINGIDO", label: "Restringido" },
  { value: "CRITICO", label: "Crítico" },
];

const VERSION_TYPES = [
  { value: "major", label: "Mayor (1.0.0)" },
  { value: "minor", label: "Menor (0.1.0)" },
  { value: "patch", label: "Parche (0.0.1)" },
];

interface NewDocForm {
  title: string;
  code: string;
  description: string;
  type: string;
  areaId: string;
  confidentiality: string;
  versionType: string;
  changelog: string;
}

const EMPTY_FORM: NewDocForm = {
  title: "",
  code: "",
  description: "",
  type: "DOCUMENT",
  areaId: "",
  confidentiality: "PUBLICO",
  versionType: "minor",
  changelog: "",
};

// Chunked upload settings (5MB chunks)
const CHUNK_SIZE = 5 * 1024 * 1024; // 5MB
const MAX_RETRIES = 3;

export function DocumentsPage() {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [page, setPage] = useState(1);
  const debouncedSearch = useDebounce(search, 300);
  const canEdit = useCanEdit();
  const isAdmin = useIsAdmin();
  const queryClient = useQueryClient();

  const [searchParams, setSearchParams] = useSearchParams();
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState<NewDocForm>(EMPTY_FORM);

  // Abrir modal preseleccionado desde otra página (ej: /documentos?upload=VIDEO)
  useEffect(() => {
    const uploadType = searchParams.get("upload");
    if (uploadType) {
      setForm({ ...EMPTY_FORM, type: uploadType });
      setModalOpen(true);
      setSearchParams({}, { replace: true });
    }
  }, [searchParams]);
  const [file, setFile] = useState<File | null>(null);
  const [step, setStep] = useState<"meta" | "upload">("meta");
  const [createdDocId, setCreatedDocId] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [isChunkedUpload, setIsChunkedUpload] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["documents", debouncedSearch, statusFilter, page],
    queryFn: () =>
      api
        .get("/documents", {
          params: {
            search: debouncedSearch || undefined,
            status: statusFilter || undefined,
            page,
            limit: 20,
          },
        })
        .then((r) => r.data),
  });

  const { data: areasData } = useQuery({
    queryKey: ["areas-flat"],
    queryFn: () => api.get("/areas/flat").then((r) => r.data),
    enabled: modalOpen,
  });

  const areas: Area[] = areasData ?? [];
  const docs: Document[] = data?.data ?? [];
  const total = data?.pagination?.total ?? data?.total ?? 0;
  const totalPages = Math.ceil(total / 20);

  const createDocMutation = useMutation({
    mutationFn: (body: object) => api.post("/documents", body).then((r) => r.data),
    onSuccess: (doc) => {
      setCreatedDocId(doc.id);
      setStep("upload");
      setUploadError(null);
    },
    onError: (err: { response?: { data?: { message?: string } } }) => {
      setUploadError(err?.response?.data?.message ?? "Error al crear el documento");
    },
  });

  const [deleteError, setDeleteError] = useState<string | null>(null);
  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/documents/${id}`),
    onSuccess: () => {
      setDeleteError(null);
      queryClient.invalidateQueries({ queryKey: ["documents"] });
    },
    onError: (err: { response?: { data?: { message?: string } } }) => {
      setDeleteError(err?.response?.data?.message ?? "Error al eliminar el documento");
    },
  });

  function handleDelete(doc: Document) {
    if (!window.confirm(`¿Eliminar "${doc.title}"? Esta acción no se puede deshacer.`)) return;
    deleteMutation.mutate(doc.id);
  }

  /**
   * Uploads file in chunks (5MB each) for better reliability and progress tracking
   */
  async function uploadFileInChunks(
    docId: string,
    file: File,
    versionType: string,
    changelog: string
  ): Promise<void> {
    const totalChunks = Math.ceil(file.size / CHUNK_SIZE);
    const uploadSessionId = `${docId}_${Date.now()}`;

    for (let chunkIndex = 0; chunkIndex < totalChunks; chunkIndex++) {
      let retries = 0;
      let success = false;

      while (retries < MAX_RETRIES && !success) {
        try {
          const start = chunkIndex * CHUNK_SIZE;
          const end = Math.min(start + CHUNK_SIZE, file.size);
          const chunk = file.slice(start, end);

          const fd = new FormData();
          fd.append("file", chunk);
          fd.append("chunkIndex", String(chunkIndex));
          fd.append("totalChunks", String(totalChunks));
          fd.append("uploadSessionId", uploadSessionId);
          fd.append("fileName", file.name);
          fd.append("fileSize", String(file.size));

          const response = await api.post(`/documents/${docId}/upload-chunk`, fd, {
            headers: { "Content-Type": "multipart/form-data" },
          });

          success = true;

          // Update progress
          const uploadedBytes = end;
          const percentComplete = Math.round((uploadedBytes / file.size) * 100);
          setUploadProgress(percentComplete);

          // If last chunk, proceed to final upload
          if (chunkIndex === totalChunks - 1) {
            // Now do final upload with full file
            const finalFd = new FormData();
            finalFd.append("file", file);
            finalFd.append("versionType", versionType);
            if (changelog) finalFd.append("changelog", changelog);

            await api.post(`/documents/${docId}/upload`, finalFd, {
              headers: { "Content-Type": "multipart/form-data" },
            });
          }
        } catch (err) {
          retries++;
          if (retries >= MAX_RETRIES) {
            const errMsg = (err as any)?.response?.data?.message || "Error uploading chunk";
            throw new Error(`${errMsg} (chunk ${chunkIndex + 1}/${totalChunks})`);
          }
          // Wait before retry
          await new Promise((resolve) => setTimeout(resolve, 1000 * retries));
        }
      }
    }
  }

  const uploadMutation = useMutation({
    mutationFn: ({ docId, file, versionType, changelog }: { docId: string; file: File; versionType: string; changelog: string }) => {
      // Use chunked upload for files > 50MB, otherwise direct upload
      if (file.size > 50 * 1024 * 1024) {
        setIsChunkedUpload(true);
        return uploadFileInChunks(docId, file, versionType, changelog);
      } else {
        setIsChunkedUpload(false);
        const fd = new FormData();
        fd.append("file", file);
        fd.append("versionType", versionType);
        if (changelog) fd.append("changelog", changelog);
        return api.post(`/documents/${docId}/upload`, fd, {
          headers: { "Content-Type": "multipart/form-data" },
        });
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["documents"] });
      setUploadProgress(0);
      closeModal();
    },
    onError: (err: { response?: { data?: { message?: string } } }) => {
      setUploadProgress(0);
      setUploadError(err?.response?.data?.message ?? "Error al subir el archivo");
    },
  });

  function closeModal() {
    setModalOpen(false);
    setForm(EMPTY_FORM);
    setFile(null);
    setStep("meta");
    setCreatedDocId(null);
    setUploadError(null);
    setUploadProgress(0);
    setIsChunkedUpload(false);
  }

  function handleField(key: keyof NewDocForm, value: string) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function handleMetaSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setUploadError(null);
    createDocMutation.mutate({
      title: form.title,
      code: form.code,
      description: form.description || undefined,
      type: form.type,
      areaId: form.areaId,
      confidentiality: form.confidentiality,
    });
  }

  function handleUploadSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!file || !createdDocId) return;
    setUploadError(null);
    uploadMutation.mutate({
      docId: createdDocId,
      file,
      versionType: form.versionType,
      changelog: form.changelog,
    });
  }

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Documentos</h1>
        <div className="flex items-center gap-3">
          <span className="text-sm text-gray-400">{total} documentos</span>
          {canEdit && (
            <button
              onClick={() => setModalOpen(true)}
              className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors"
            >
              <Plus className="w-4 h-4" />
              Nuevo documento
            </button>
          )}
        </div>
      </div>

      {deleteError && (
        <div className="flex items-center justify-between px-4 py-2 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
          <span>{deleteError}</span>
          <button onClick={() => setDeleteError(null)} className="ml-4 text-red-400 hover:text-red-600">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Filtros */}
      <div className="flex gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            placeholder="Buscar documentos..."
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            className="w-full pl-9 pr-4 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <div className="flex items-center gap-2">
          <Filter className="w-4 h-4 text-gray-400" />
          <select
            value={statusFilter}
            onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}
            className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="">Todos los estados</option>
            {Object.entries(STATUS_LABELS).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Tabla */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        {isLoading ? (
          <div className="p-8 text-center text-gray-400">Cargando...</div>
        ) : docs.length === 0 ? (
          <div className="p-8 text-center text-gray-400">No se encontraron documentos.</div>
        ) : (
          <table className="w-full">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">Título</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase hidden md:table-cell">Área</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase hidden sm:table-cell">Estado</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase hidden lg:table-cell">Actualizado</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {docs.map((doc) => (
                <tr key={doc.id} className="hover:bg-gray-50 transition-colors">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <FileText className="w-4 h-4 text-blue-500 shrink-0" />
                      <span className="text-sm font-medium text-gray-800 line-clamp-1">{doc.title}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3 hidden md:table-cell">
                    <span className="text-sm text-gray-500">{doc.area?.name ?? "—"}</span>
                  </td>
                  <td className="px-4 py-3 hidden sm:table-cell">
                    <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[doc.status] ?? "bg-gray-100 text-gray-600"}`}>
                      {STATUS_LABELS[doc.status] ?? doc.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 hidden lg:table-cell">
                    <span className="text-sm text-gray-400">
                      {new Date(doc.updatedAt).toLocaleDateString("es-PE")}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <Link
                        to={`/documentos/${doc.id}`}
                        className="inline-flex items-center gap-1 text-blue-600 hover:text-blue-800 text-sm"
                      >
                        <Eye className="w-4 h-4" />
                        <span className="hidden sm:inline">Ver</span>
                      </Link>
                      {isAdmin && (
                        <button
                          onClick={() => handleDelete(doc)}
                          disabled={deleteMutation.isPending}
                          className="p-1.5 rounded text-gray-400 hover:text-red-600 hover:bg-red-50 transition-colors"
                          title="Eliminar documento"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Paginación */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2">
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page === 1}
            className="px-3 py-1.5 text-sm border border-gray-200 rounded-lg disabled:opacity-40 hover:bg-gray-50"
          >
            Anterior
          </button>
          <span className="text-sm text-gray-500">Página {page} de {totalPages}</span>
          <button
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page === totalPages}
            className="px-3 py-1.5 text-sm border border-gray-200 rounded-lg disabled:opacity-40 hover:bg-gray-50"
          >
            Siguiente
          </button>
        </div>
      )}

      {/* Modal nuevo documento */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
              <div>
                <h2 className="text-lg font-semibold text-gray-900">Nuevo documento</h2>
                <p className="text-xs text-gray-400 mt-0.5">
                  {step === "meta" ? "Paso 1 de 2 — Información" : "Paso 2 de 2 — Archivo"}
                </p>
              </div>
              <button
                onClick={closeModal}
                className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Paso 1: Metadatos */}
            {step === "meta" && (
              <form onSubmit={handleMetaSubmit} className="px-6 py-5 space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="col-span-2">
                    <label className="block text-sm font-medium text-gray-700 mb-1">Título *</label>
                    <input
                      required
                      value={form.title}
                      onChange={(e) => handleField("title", e.target.value)}
                      placeholder="Nombre del documento"
                      className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Código *</label>
                    <input
                      required
                      value={form.code}
                      onChange={(e) => handleField("code", e.target.value)}
                      placeholder="DOC-001"
                      className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Tipo *</label>
                    <select
                      required
                      value={form.type}
                      onChange={(e) => handleField("type", e.target.value)}
                      className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      {DOC_TYPES.map((t) => (
                        <option key={t.value} value={t.value}>{t.label}</option>
                      ))}
                    </select>
                  </div>
                  <div className="col-span-2">
                    <label className="block text-sm font-medium text-gray-700 mb-1">Área *</label>
                    <select
                      required
                      value={form.areaId}
                      onChange={(e) => handleField("areaId", e.target.value)}
                      className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      <option value="">Seleccionar área...</option>
                      {areas.map((a) => (
                        <option key={a.id} value={a.id}>{a.name}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Confidencialidad</label>
                    <select
                      value={form.confidentiality}
                      onChange={(e) => handleField("confidentiality", e.target.value)}
                      className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      {CONF_LEVELS.map((c) => (
                        <option key={c.value} value={c.value}>{c.label}</option>
                      ))}
                    </select>
                  </div>
                  <div className="col-span-2">
                    <label className="block text-sm font-medium text-gray-700 mb-1">Descripción</label>
                    <textarea
                      value={form.description}
                      onChange={(e) => handleField("description", e.target.value)}
                      placeholder="Descripción breve del documento..."
                      rows={3}
                      className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                    />
                  </div>
                </div>

                {uploadError && (
                  <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">{uploadError}</p>
                )}

                <div className="flex justify-end gap-3 pt-2">
                  <button
                    type="button"
                    onClick={closeModal}
                    className="px-4 py-2 text-sm text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50"
                  >
                    Cancelar
                  </button>
                  <button
                    type="submit"
                    disabled={createDocMutation.isPending}
                    className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-60"
                  >
                    {createDocMutation.isPending ? "Creando..." : "Siguiente →"}
                  </button>
                </div>
              </form>
            )}

            {/* Paso 2: Subir archivo */}
            {step === "upload" && (
              <form onSubmit={handleUploadSubmit} className="px-6 py-5 space-y-4">
                <div
                  onClick={() => fileInputRef.current?.click()}
                  className={`border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-colors ${
                    file ? "border-blue-400 bg-blue-50" : "border-gray-200 hover:border-blue-300 hover:bg-gray-50"
                  }`}
                >
                  <Upload className="w-8 h-8 mx-auto mb-3 text-gray-400" />
                  {file ? (
                    <div>
                      <p className="text-sm font-medium text-blue-700">{file.name}</p>
                      <p className="text-xs text-gray-400 mt-1">{(file.size / 1024 / 1024).toFixed(2)} MB</p>
                    </div>
                  ) : (
                    <div>
                      <p className="text-sm font-medium text-gray-700">Haz clic para seleccionar un archivo</p>
                      <p className="text-xs text-gray-400 mt-1">
                        {form.type === "VIDEO"
                          ? "MP4, MOV, AVI, MKV, WEBM"
                          : form.type === "DOCUMENT_VIDEO"
                          ? "PDF, DOCX, imágenes, MP4, MOV…"
                          : "PDF, DOCX, XLSX, PPTX, imágenes"}
                      </p>
                    </div>
                  )}
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept={
                      form.type === "VIDEO"
                        ? ".mp4,.mov,.avi,.mkv,.webm,.wmv,.flv,.m4v"
                        : form.type === "DOCUMENT_VIDEO"
                        ? ".pdf,.docx,.xlsx,.pptx,.doc,.xls,.ppt,.png,.jpg,.jpeg,.webp,.md,.mp4,.mov,.avi,.mkv,.webm"
                        : ".pdf,.docx,.xlsx,.pptx,.doc,.xls,.ppt,.png,.jpg,.jpeg,.webp,.md"
                    }
                    className="hidden"
                    onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Tipo de versión</label>
                  <select
                    value={form.versionType}
                    onChange={(e) => handleField("versionType", e.target.value)}
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    {VERSION_TYPES.map((v) => (
                      <option key={v.value} value={v.value}>{v.label}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Notas de versión</label>
                  <input
                    value={form.changelog}
                    onChange={(e) => handleField("changelog", e.target.value)}
                    placeholder="Ej: Versión inicial"
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                {uploadError && (
                  <div className="flex items-start gap-2 px-3 py-2 bg-red-50 rounded-lg">
                    <AlertCircle className="w-4 h-4 text-red-600 mt-0.5 shrink-0" />
                    <p className="text-sm text-red-600">{uploadError}</p>
                  </div>
                )}

                {uploadMutation.isPending && uploadProgress > 0 && (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-xs text-gray-600">
                      <span>{isChunkedUpload ? "Subida segmentada" : "Subiendo"}</span>
                      <span>{uploadProgress}%</span>
                    </div>
                    <div className="w-full h-2 bg-gray-200 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-blue-600 transition-all duration-300"
                        style={{ width: `${uploadProgress}%` }}
                      />
                    </div>
                  </div>
                )}

                <div className="flex justify-between gap-3 pt-2">
                  <button
                    type="button"
                    onClick={closeModal}
                    className="px-4 py-2 text-sm text-gray-500 hover:text-gray-700"
                  >
                    Omitir archivo
                  </button>
                  <div className="flex gap-3">
                    <button
                      type="button"
                      onClick={() => { setStep("meta"); setUploadError(null); }}
                      className="px-4 py-2 text-sm text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50"
                    >
                      ← Atrás
                    </button>
                    <button
                      type="submit"
                      disabled={!file || uploadMutation.isPending}
                      className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-60"
                    >
                      <Upload className="w-4 h-4" />
                      {uploadMutation.isPending ? "Subiendo..." : "Subir y finalizar"}
                    </button>
                  </div>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
