import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Users, Search, Shield, UserCheck, UserX, Plus, Pencil, X } from "lucide-react";
import api from "@/lib/api";
import { useIsAdmin } from "@/stores/auth.store";
import { Navigate } from "react-router-dom";
import { useDebounce } from "@/hooks/useDebounce";

interface User {
  id: string;
  name: string;
  email: string;
  role: string;
  isActive: boolean;
  area?: { id: string; name: string };
  jobTitle?: string;
  phone?: string;
  createdAt: string;
}

interface Area {
  id: string;
  name: string;
  code: string;
}

const ROLES = ["SUPER_ADMIN", "ADMIN_AREA", "EDITOR", "REVISOR", "VISUALIZADOR"] as const;

const ROLE_LABELS: Record<string, string> = {
  SUPER_ADMIN: "Super Admin",
  ADMIN_AREA: "Admin Área",
  EDITOR: "Editor",
  REVISOR: "Revisor",
  VISUALIZADOR: "Visualizador",
};

const ROLE_COLORS: Record<string, string> = {
  SUPER_ADMIN: "bg-red-100 text-red-700",
  ADMIN_AREA: "bg-orange-100 text-orange-700",
  EDITOR: "bg-blue-100 text-blue-700",
  REVISOR: "bg-purple-100 text-purple-700",
  VISUALIZADOR: "bg-gray-100 text-gray-600",
};

const EMPTY_CREATE = { name: "", email: "", password: "", role: "VISUALIZADOR" as string, areaId: "", jobTitle: "", phone: "" };
const EMPTY_EDIT = { name: "", role: "VISUALIZADOR" as string, areaId: "", jobTitle: "", phone: "" };

function UserCreateModal({
  areas,
  onClose,
  onSave,
  isPending,
  error,
}: {
  areas: Area[];
  onClose: () => void;
  onSave: (data: typeof EMPTY_CREATE) => void;
  isPending: boolean;
  error?: string;
}) {
  const [form, setForm] = useState(EMPTY_CREATE);
  function set(k: keyof typeof EMPTY_CREATE, v: string) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h2 className="font-semibold text-gray-800">Nuevo usuario</h2>
          <button onClick={onClose} className="p-1 rounded hover:bg-gray-100">
            <X size={18} className="text-gray-500" />
          </button>
        </div>

        <div className="p-6 space-y-4">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Nombre completo *</label>
            <input
              value={form.name}
              onChange={(e) => set("name", e.target.value)}
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="Juan Pérez"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Correo electrónico *</label>
            <input
              type="email"
              value={form.email}
              onChange={(e) => set("email", e.target.value)}
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="juan@empresa.com"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Contraseña *</label>
            <input
              type="password"
              value={form.password}
              onChange={(e) => set("password", e.target.value)}
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="Mín. 8 caracteres, 1 mayúscula, 1 número"
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Rol *</label>
              <select
                value={form.role}
                onChange={(e) => set("role", e.target.value)}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                {ROLES.map((r) => (
                  <option key={r} value={r}>{ROLE_LABELS[r]}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Área</label>
              <select
                value={form.areaId}
                onChange={(e) => set("areaId", e.target.value)}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">— Sin área —</option>
                {areas.map((a) => (
                  <option key={a.id} value={a.id}>{a.name}</option>
                ))}
              </select>
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Cargo</label>
            <input
              value={form.jobTitle}
              onChange={(e) => set("jobTitle", e.target.value)}
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="Gerente, Analista..."
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Teléfono</label>
            <input
              value={form.phone}
              onChange={(e) => set("phone", e.target.value)}
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="+1 555 000 0000"
            />
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
            disabled={isPending || !form.name.trim() || !form.email.trim() || !form.password.trim()}
            className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors disabled:opacity-50"
          >
            {isPending ? "Creando..." : "Crear usuario"}
          </button>
        </div>
      </div>
    </div>
  );
}

function UserEditModal({
  user,
  areas,
  onClose,
  onSave,
  isPending,
  error,
}: {
  user: User;
  areas: Area[];
  onClose: () => void;
  onSave: (data: typeof EMPTY_EDIT) => void;
  isPending: boolean;
  error?: string;
}) {
  const [form, setForm] = useState<typeof EMPTY_EDIT>({
    name: user.name,
    role: user.role,
    areaId: user.area?.id ?? "",
    jobTitle: user.jobTitle ?? "",
    phone: user.phone ?? "",
  });
  function set(k: keyof typeof EMPTY_EDIT, v: string) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h2 className="font-semibold text-gray-800">Editar usuario</h2>
          <button onClick={onClose} className="p-1 rounded hover:bg-gray-100">
            <X size={18} className="text-gray-500" />
          </button>
        </div>

        <div className="p-6 space-y-4">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Nombre completo *</label>
            <input
              value={form.name}
              onChange={(e) => set("name", e.target.value)}
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Rol *</label>
              <select
                value={form.role}
                onChange={(e) => set("role", e.target.value)}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                {ROLES.map((r) => (
                  <option key={r} value={r}>{ROLE_LABELS[r]}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Área</label>
              <select
                value={form.areaId}
                onChange={(e) => set("areaId", e.target.value)}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">— Sin área —</option>
                {areas.map((a) => (
                  <option key={a.id} value={a.id}>{a.name}</option>
                ))}
              </select>
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Cargo</label>
            <input
              value={form.jobTitle}
              onChange={(e) => set("jobTitle", e.target.value)}
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Teléfono</label>
            <input
              value={form.phone}
              onChange={(e) => set("phone", e.target.value)}
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
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
            disabled={isPending || !form.name.trim()}
            className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors disabled:opacity-50"
          >
            {isPending ? "Guardando..." : "Guardar cambios"}
          </button>
        </div>
      </div>
    </div>
  );
}

export function AdminUsers() {
  const isAdmin = useIsAdmin();
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebounce(search, 300);
  const queryClient = useQueryClient();
  const [createModal, setCreateModal] = useState(false);
  const [editUser, setEditUser] = useState<User | null>(null);
  const [mutationError, setMutationError] = useState("");

  const { data, isLoading } = useQuery({
    queryKey: ["admin-users", debouncedSearch],
    queryFn: () =>
      api.get("/users", { params: { q: debouncedSearch || undefined, limit: 50 } }).then((r) => r.data),
    enabled: isAdmin,
  });

  const { data: areas = [] } = useQuery<Area[]>({
    queryKey: ["areas-flat"],
    queryFn: () => api.get("/areas/flat").then((r) => r.data),
    enabled: isAdmin,
  });

  const toggleActive = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) =>
      api.patch(`/users/${id}`, { isActive }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["admin-users"] }),
  });

  const createMutation = useMutation({
    mutationFn: (data: typeof EMPTY_CREATE) =>
      api.post("/users", {
        name: data.name,
        email: data.email,
        password: data.password,
        role: data.role,
        areaId: data.areaId || undefined,
        jobTitle: data.jobTitle || undefined,
        phone: data.phone || undefined,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-users"] });
      queryClient.invalidateQueries({ queryKey: ["admin-dashboard"] });
      setCreateModal(false);
      setMutationError("");
    },
    onError: (err: { response?: { data?: { message?: string } } }) => {
      setMutationError(err.response?.data?.message ?? "Error al crear el usuario");
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: typeof EMPTY_EDIT }) =>
      api.patch(`/users/${id}`, {
        name: data.name,
        role: data.role,
        areaId: data.areaId || undefined,
        jobTitle: data.jobTitle || undefined,
        phone: data.phone || undefined,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-users"] });
      setEditUser(null);
      setMutationError("");
    },
    onError: (err: { response?: { data?: { message?: string } } }) => {
      setMutationError(err.response?.data?.message ?? "Error al actualizar el usuario");
    },
  });

  if (!isAdmin) return <Navigate to="/" replace />;

  const users: User[] = data?.data ?? data ?? [];

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Users className="w-6 h-6 text-gray-500" />
          <h1 className="text-2xl font-bold text-gray-900">Usuarios</h1>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-sm text-gray-400">{users.length} usuarios</span>
          <button
            onClick={() => { setMutationError(""); setCreateModal(true); }}
            className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 transition-colors"
          >
            <Plus size={16} />
            Nuevo usuario
          </button>
        </div>
      </div>

      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
        <input
          type="text"
          placeholder="Buscar usuario..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full pl-9 pr-4 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        {isLoading ? (
          <div className="p-8 text-center text-gray-400">Cargando...</div>
        ) : users.length === 0 ? (
          <div className="p-8 text-center text-gray-400">No se encontraron usuarios.</div>
        ) : (
          <table className="w-full">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">Usuario</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase hidden md:table-cell">Rol</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase hidden lg:table-cell">Área</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">Estado</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {users.map((user) => (
                <tr key={user.id} className="hover:bg-gray-50 transition-colors">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center text-blue-700 font-semibold text-sm shrink-0">
                        {user.name.charAt(0).toUpperCase()}
                      </div>
                      <div>
                        <p className="text-sm font-medium text-gray-800">{user.name}</p>
                        <p className="text-xs text-gray-400">{user.email}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 hidden md:table-cell">
                    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${ROLE_COLORS[user.role] ?? "bg-gray-100 text-gray-600"}`}>
                      <Shield className="w-3 h-3" />
                      {ROLE_LABELS[user.role] ?? user.role}
                    </span>
                  </td>
                  <td className="px-4 py-3 hidden lg:table-cell">
                    <span className="text-sm text-gray-500">{user.area?.name ?? "—"}</span>
                  </td>
                  <td className="px-4 py-3">
                    {user.isActive ? (
                      <span className="inline-flex items-center gap-1 text-xs text-green-700 bg-green-50 px-2 py-0.5 rounded-full">
                        <UserCheck className="w-3 h-3" /> Activo
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-xs text-red-600 bg-red-50 px-2 py-0.5 rounded-full">
                        <UserX className="w-3 h-3" /> Inactivo
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-2">
                      <button
                        onClick={() => { setMutationError(""); setEditUser(user); }}
                        className="p-1.5 rounded text-gray-400 hover:text-blue-600 hover:bg-blue-50 transition-colors"
                        title="Editar"
                      >
                        <Pencil size={14} />
                      </button>
                      <button
                        onClick={() => toggleActive.mutate({ id: user.id, isActive: !user.isActive })}
                        disabled={toggleActive.isPending}
                        className="text-xs text-gray-500 hover:text-gray-800 underline"
                      >
                        {user.isActive ? "Desactivar" : "Activar"}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {createModal && (
        <UserCreateModal
          areas={areas}
          onClose={() => setCreateModal(false)}
          onSave={(data) => createMutation.mutate(data)}
          isPending={createMutation.isPending}
          error={mutationError}
        />
      )}

      {editUser && (
        <UserEditModal
          user={editUser}
          areas={areas}
          onClose={() => setEditUser(null)}
          onSave={(data) => updateMutation.mutate({ id: editUser.id, data })}
          isPending={updateMutation.isPending}
          error={mutationError}
        />
      )}
    </div>
  );
}
