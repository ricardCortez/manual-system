import { create } from "zustand";

interface UIState {
  sidebarCollapsed: boolean;
  theme: "light" | "dark";
  spotlightOpen: boolean;
  notificationsOpen: boolean;
  unreadNotifications: number;

  toggleSidebar: () => void;
  setSidebarCollapsed: (v: boolean) => void;
  toggleTheme: () => void;
  setTheme: (t: "light" | "dark") => void;
  openSpotlight: () => void;
  closeSpotlight: () => void;
  toggleNotifications: () => void;
  setUnreadNotifications: (n: number) => void;
  decrementUnread: () => void;
}

export const useUIStore = create<UIState>()((set) => ({
  sidebarCollapsed: false,
  theme: (localStorage.getItem("theme") as "light" | "dark") || "light",
  spotlightOpen: false,
  notificationsOpen: false,
  unreadNotifications: 0,

  toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
  setSidebarCollapsed: (v) => set({ sidebarCollapsed: v }),

  toggleTheme: () =>
    set((s) => {
      const next = s.theme === "light" ? "dark" : "light";
      localStorage.setItem("theme", next);
      document.documentElement.classList.toggle("dark", next === "dark");
      return { theme: next };
    }),

  setTheme: (t) => {
    localStorage.setItem("theme", t);
    document.documentElement.classList.toggle("dark", t === "dark");
    set({ theme: t });
  },

  openSpotlight: () => set({ spotlightOpen: true }),
  closeSpotlight: () => set({ spotlightOpen: false }),
  toggleNotifications: () => set((s) => ({ notificationsOpen: !s.notificationsOpen })),
  setUnreadNotifications: (n) => set({ unreadNotifications: n }),
  decrementUnread: () => set((s) => ({ unreadNotifications: Math.max(0, s.unreadNotifications - 1) })),
}));
