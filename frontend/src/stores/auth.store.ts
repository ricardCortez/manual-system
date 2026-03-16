import { create } from "zustand";
import { persist } from "zustand/middleware";
import api from "@/lib/api";

interface User {
  id: string;
  name: string;
  email: string;
  role: "SUPER_ADMIN" | "ADMIN_AREA" | "EDITOR" | "REVISOR" | "VISUALIZADOR";
  areaId: string | null;
  avatarUrl?: string | null;
}

interface AuthState {
  user: User | null;
  accessToken: string | null;
  refreshToken: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;

  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  fetchMe: () => Promise<void>;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      user: null,
      accessToken: null,
      refreshToken: null,
      isAuthenticated: false,
      isLoading: false,

      login: async (email, password) => {
        set({ isLoading: true });
        try {
          const { data } = await api.post("/auth/login", { email, password });
          localStorage.setItem("accessToken", data.accessToken);
          localStorage.setItem("refreshToken", data.refreshToken);
          set({
            user: data.user,
            accessToken: data.accessToken,
            refreshToken: data.refreshToken,
            isAuthenticated: true,
            isLoading: false,
          });
        } catch (err) {
          set({ isLoading: false });
          throw err;
        }
      },

      logout: async () => {
        const { refreshToken } = get();
        try {
          await api.post("/auth/logout", { refreshToken });
        } catch {
          // Ignorar errores al cerrar sesión
        } finally {
          localStorage.removeItem("accessToken");
          localStorage.removeItem("refreshToken");
          set({ user: null, accessToken: null, refreshToken: null, isAuthenticated: false });
          window.location.href = "/login";
        }
      },

      fetchMe: async () => {
        try {
          const { data } = await api.get("/auth/me");
          set({ user: data, isAuthenticated: true });
        } catch {
          set({ user: null, isAuthenticated: false });
        }
      },
    }),
    {
      name: "auth-storage",
      partialize: (state) => ({
        user: state.user,
        accessToken: state.accessToken,
        refreshToken: state.refreshToken,
        isAuthenticated: state.isAuthenticated,
      }),
    }
  )
);

// Helpers de roles
export const useIsAdmin = () => {
  const role = useAuthStore((s) => s.user?.role);
  return role === "SUPER_ADMIN" || role === "ADMIN_AREA";
};

export const useCanEdit = () => {
  const role = useAuthStore((s) => s.user?.role);
  return role === "SUPER_ADMIN" || role === "ADMIN_AREA" || role === "EDITOR";
};

export const useCanReview = () => {
  const role = useAuthStore((s) => s.user?.role);
  return role === "SUPER_ADMIN" || role === "ADMIN_AREA" || role === "EDITOR" || role === "REVISOR";
};
