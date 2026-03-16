import { useEffect } from "react";
import { Outlet, useNavigate } from "react-router-dom";
import { useAuthStore } from "@/stores/auth.store";
import { useUIStore } from "@/stores/ui.store";
import { connectSocket } from "@/lib/socket";
import { Sidebar } from "./Sidebar";
import { Spotlight } from "./Spotlight";
import { NotificationsDrawer } from "./NotificationsDrawer";

export function AppLayout() {
  const { isAuthenticated, accessToken, user } = useAuthStore();
  const { theme, sidebarCollapsed, spotlightOpen, notificationsOpen } = useUIStore();
  const navigate = useNavigate();

  useEffect(() => {
    if (!isAuthenticated) { navigate("/login"); return; }
    if (accessToken) connectSocket(accessToken);
  }, [isAuthenticated, accessToken, navigate]);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
  }, [theme]);

  // Atajos de teclado globales
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        useUIStore.getState().openSpotlight();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  if (!isAuthenticated) return null;

  return (
    <div
      className="flex h-screen overflow-hidden"
      style={{ background: "var(--bg-primary)", color: "var(--text-primary)" }}
    >
      {/* Sidebar */}
      <Sidebar />

      {/* Contenido principal */}
      <main
        className="flex-1 overflow-auto transition-all"
        style={{
          marginLeft: sidebarCollapsed ? "var(--sidebar-collapsed)" : "var(--sidebar-width)",
          transition: "margin-left var(--transition-base)",
        }}
      >
        <Outlet />
      </main>

      {/* Overlays globales */}
      {spotlightOpen && <Spotlight />}
      {notificationsOpen && <NotificationsDrawer />}
    </div>
  );
}
