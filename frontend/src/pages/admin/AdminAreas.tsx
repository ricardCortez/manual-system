import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { FolderTree, Plus, Pencil, Trash2, X, ChevronRight } from "lucide-react";
import api from "@/lib/api";
import { useIsAdmin } from "@/stores/auth.store";
import { Navigate } from "react-router-dom";

interface Area {
  id: string;
  name: string;
  code: string;
  description?: string;
  color?: string;
  parentId?: string;
  isActive: boolean;
  manager?: { id: string; name: string };
  _count?: { users: number; documents: number };
}

const EMPTY_FORM = { name: "", code: "", description: "", color: "#6366f1", parentId: "" };

function AreaModal({
  initial,
  areas,
  onClose,
  onSave,
  isPending,
  error,
}: {
  initial: typeof EMPTY_FORM & { id?: string };
  areas: Area[];
  onClose: () => void;
  onSave: (data: typeof EMPTY_FORM) => void;
  isPending: boolean;
  error?: string;
}) {
  const [form, setForm] = useState(initial);
  const isEdit = !!initial.id;

  function set(k: keyof typeof EMPTY_FORM, v: string) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h2 className="font-semibold text-gray-800">{isEdit ? "Editar área" : "Nueva área"}</h2>
          <button onClick={onClose} className="p-1 rounded hover:bg-gray-100">
            <X size={18} className="text-gray-500" />
          </button>
        </div>

        <div className="p-6 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <label className="block text-xs font-medium text-gray-600 mb-1">Nombre *</label>
              <input
                value={form.name}
                onChange={(e) => set("name", e.target.value)}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="Ej: Recursos Humanos"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Código *</label>
              <input
                value={form.code}
                onChange={(e) => set("code", e.target.value.toUpperCase())}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono"
                placeholder="RH"
                maxLength={20}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Color</label>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={form.color}
                  onChange={(e) => set("color", e.target.value)}
                  className="w-10 h-9 rounded border border-gray-200 cursor-pointer p-0.5"
                />
                <input
                  value={form.color}
                  onChange={(e) => set("color", e.target.value)}
                  className="flex-1 px-3 py-2 border border-gray-200 rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="#6366f1"
                  maxLength={7}
                />
              </div>
            </div>
            <div className="col-span-2">
              <label className="block text-xs font-medium text-gray-600 mb-1">Área padre</label>
              <select
                value={form.parentId}
                onChange={(e) => set("parentId", e.target.value)}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">— Sin área padre —</option>
                {areas
                  .filter((a) => a.id !== initial.id)
                  .map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name} ({a.code})
                    </option>
                  ))}
              </select>
            </div>
            <div className="col-span-2">
              <label className="block text-xs font-medium text-gray-600 mb-1">Descripción</label>
              <textarea
                value={form.description}
                onChange={(e) => set("description", e.target.value)}
                rows={2}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                placeholder="Descripción opcional..."
                maxLength={500}
              />
            </div>
          </div>

          {error && <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">{error}</p>}
        </div>

        <div className="flex justify-end gap-2 px-6 py-4 border-t border-gray-100">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800 rounded-lg hover:bg-gray-100 transition-colors"
          >
            Cancelar
          </button>
          <button
            onClick={() => onSave(form)}
            disabled={isPending || !form.name.trim() || !form.code.trim()}
            className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors disabled:opacity-50"
          >
            {isPending ? "Guardando..." : isEdit ? "Guardar cambios" : "Crear área"}
          </button>
        </div>
      </div>
    </div>
  );
}

export function AdminAreas() {
  const isAdmin = useIsAdmin();
  const queryClient = useQueryClient();
  const [modal, setModal] = useState<null | (typeof EMPTY_FORM & { id?: string })>(null);
  const [mutationError, setMutationError] = useState("");

  const { data: areas = [], isLoading } = useQuery<Area[]>({
    queryKey: ["admin-areas"],
    queryFn: () => api.get("/areas/flat").then((r) => r.data),
    enabled: isAdmin,
  });

  const createMutation = useMutation({
    mutationFn: (data: typeof EMPTY_FORM) =>
      api.post("/areas", {
        name: data.name,
        code: data.code,
        description: data.description || undefined,
        color: data.color || undefined,
        parentId: data.parentId || undefined,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-areas"] });
      queryClient.invalidateQueries({ queryKey: ["areas"] });
      setModal(null);
      setMutationError("");
    },
    onError: (err: { response?: { data?: { message?: string } } }) => {
      setMutationError(err.response?.data?.message ?? "Error al crear el área");
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: typeof EMPTY_FORM }) =>
      api.patch(`/areas/${id}`, {
        name: data.name,
        code: data.code,
        description: data.description || undefined,
        color: data.color || undefined,
        parentId: data.parentId || undefined,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-areas"] });
      queryClient.invalidateQueries({ queryKey: ["areas"] });
      setModal(null);
      setMutationError("");
    },
    onError: (err: { response?: { data?: { message?: string } } }) => {
      setMutationError(err.response?.data?.message ?? "Error al actualizar el área");
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/areas/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-areas"] });
      queryClient.invalidateQueries({ queryKey: ["areas"] });
    },
    onError: (err: { response?: { data?: { message?: string } } }) => {
      alert(err.response?.data?.message ?? "No se puede eliminar el área");
    },
  });

  if (!isAdmin) return <Navigate to="/" replace />;

  function openCreate() {
    setMutationError("");
    setModal({ ...EMPTY_FORM });
  }

  function openEdit(area: Area) {
    setMutationError("");
    setModal({
      id: area.id,
      name: area.name,
      code: area.code,
      description: area.description ?? "",
      color: area.color ?? "#6366f1",
      parentId: area.parentId ?? "",
    });
  }

  function handleSave(data: typeof EMPTY_FORM) {
    if (modal?.id) {
      updateMutation.mutate({ id: modal.id, data });
    } else {
      createMutation.mutate(data);
    }
  }

  function handleDelete(area: Area) {
    if (!window.confirm(`¿Eliminar el área "${area.name}"? Esta acción no se puede deshacer si no tiene documentos activos.`)) return;
    deleteMutation.mutate(area.id);
  }

  const parentMap = Object.fromEntries(areas.map((a) => [a.id, a.name]));
  const isPending = createMutation.isPending || updateMutation.isPending;

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <FolderTree className="w-6 h-6 text-gray-500" />
          <h1 className="text-2xl font-bold text-gray-900">Áreas</h1>
        </div>
        <button
          onClick={openCreate}
          className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 transition-colors"
        >
          <Plus size={16} />
          Nueva área
        </button>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        {isLoading ? (
          <div className="p-8 text-center text-gray-400">Cargando...</div>
        ) : areas.length === 0 ? (
          <div className="p-8 text-center text-gray-400">No hay áreas registradas.</div>
        ) : (
          <table className="w-full">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">Área</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase hidden md:table-cell">Código</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase hidden lg:table-cell">Padre</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {areas.map((area) => (
                <tr key={area.id} className="hover:bg-gray-50 transition-colors">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <div
                        className="w-3 h-3 rounded-full shrink-0"
                        style={{ background: area.color ?? "#6366f1" }}
                      />
                      <span className="text-sm font-medium text-gray-800">{area.name}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3 hidden md:table-cell">
                    <span className="text-xs font-mono text-gray-500 bg-gray-100 px-2 py-0.5 rounded">
                      {area.code}
                    </span>
                  </td>
                  <td className="px-4 py-3 hidden lg:table-cell">
                    {area.parentId ? (
                      <span className="flex items-center gap-1 text-sm text-gray-500">
                        <ChevronRight size={14} />
                        {parentMap[area.parentId] ?? area.parentId}
                      </span>
                    ) : (
                      <span className="text-sm text-gray-400">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-2">
                      <button
                        onClick={() => openEdit(area)}
                        className="p-1.5 rounded text-gray-400 hover:text-blue-600 hover:bg-blue-50 transition-colors"
                        title="Editar"
                      >
                        <Pencil size={14} />
                      </button>
                      <button
                        onClick={() => handleDelete(area)}
                        disabled={deleteMutation.isPending}
                        className="p-1.5 rounded text-gray-400 hover:text-red-600 hover:bg-red-50 transition-colors"
                        title="Eliminar"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {modal !== null && (
        <AreaModal
          initial={modal}
          areas={areas}
          onClose={() => setModal(null)}
          onSave={handleSave}
          isPending={isPending}
          error={mutationError}
        />
      )}
    </div>
  );
}
