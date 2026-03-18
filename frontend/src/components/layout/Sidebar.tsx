import { NavLink, useLocation } from "react-router-dom";
import {
  BookOpen, Video, Search, LayoutDashboard, Users, Settings,
  ChevronLeft, ChevronRight, Bell, LogOut, Moon, Sun, FolderTree,
  Activity, Sparkles,
} from "lucide-react";
import { useAuthStore, useIsAdmin } from "@/stores/auth.store";
import { useUIStore } from "@/stores/ui.store";
import clsx from "clsx";

const navItems = [
  { to: "/", icon: LayoutDashboard, label: "Inicio", exact: true },
  { to: "/documentos", icon: BookOpen, label: "Documentos" },
  { to: "/videos", icon: Video, label: "Videos" },
  { to: "/buscar", icon: Search, label: "Buscar" },
  { to: "/areas", icon: FolderTree, label: "Áreas" },
];

const adminItems = [
  { to: "/admin", icon: Activity, label: "Dashboard Admin" },
  { to: "/admin/usuarios", icon: Users, label: "Usuarios" },
  { to: "/admin/areas", icon: FolderTree, label: "Áreas" },
  { to: "/admin/configuracion", icon: Settings, label: "Configuración" },
];

export function Sidebar() {
  const { user, logout } = useAuthStore();
  const { sidebarCollapsed, toggleSidebar, theme, toggleTheme, toggleNotifications, unreadNotifications } = useUIStore();
  const isAdmin = useIsAdmin();
  const location = useLocation();

  return (
    <aside
      className="fixed top-0 left-0 h-full z-50 flex flex-col transition-all"
      style={{
        width: sidebarCollapsed ? "var(--sidebar-collapsed)" : "var(--sidebar-width)",
        background: "var(--bg-secondary)",
        borderRight: "1px solid var(--border-subtle)",
        transition: "width var(--transition-base)",
      }}
    >
      {/* Logo / Brand */}
      <div
        className="flex items-center gap-3 px-4 py-4 shrink-0"
        style={{ height: "var(--header-height)", borderBottom: "1px solid var(--border-subtle)" }}
      >
        <div
          className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
          style={{ background: "var(--text-primary)", color: "var(--text-inverse)" }}
        >
          <BookOpen size={16} />
        </div>
        {!sidebarCollapsed && (
          <div className="overflow-hidden">
            <p className="font-display text-sm font-600 leading-tight truncate" style={{ color: "var(--text-primary)" }}>
              Manual del Sistema
            </p>
            <p className="text-xs truncate" style={{ color: "var(--text-tertiary)" }}>
              {user?.role?.replace("_", " ")}
            </p>
          </div>
        )}
      </div>

      {/* Navegación principal */}
      <nav className="flex-1 overflow-y-auto py-4 px-2">
        <NavSection label="Principal" collapsed={sidebarCollapsed}>
          {navItems.map((item) => (
            <SidebarItem key={item.to} {...item} collapsed={sidebarCollapsed} />
          ))}
        </NavSection>

        {isAdmin && (
          <NavSection label="Administración" collapsed={sidebarCollapsed} className="mt-6">
            {adminItems.map((item) => (
              <SidebarItem key={item.to} {...item} collapsed={sidebarCollapsed} />
            ))}
          </NavSection>
        )}
      </nav>

      {/* Footer del sidebar */}
      <div className="shrink-0 p-2" style={{ borderTop: "1px solid var(--border-subtle)" }}>
        {/* Notificaciones */}
        <button
          onClick={toggleNotifications}
          className="w-full flex items-center gap-3 px-3 py-2 rounded-lg transition-colors relative"
          style={{ color: "var(--text-secondary)" }}
          title="Notificaciones"
        >
          <Bell size={18} className="shrink-0" />
          {!sidebarCollapsed && <span className="text-sm">Notificaciones</span>}
          {unreadNotifications > 0 && (
            <span
              className="absolute flex items-center justify-center text-xs font-600 rounded-full"
              style={{
                width: 18, height: 18,
                background: "var(--ai-primary)",
                color: "white",
                top: sidebarCollapsed ? 4 : "50%",
                right: sidebarCollapsed ? 4 : 12,
                transform: sidebarCollapsed ? "none" : "translateY(-50%)",
                fontSize: "0.65rem",
              }}
            >
              {unreadNotifications > 9 ? "9+" : unreadNotifications}
            </span>
          )}
        </button>

        {/* Toggle tema */}
        <button
          onClick={toggleTheme}
          className="w-full flex items-center gap-3 px-3 py-2 rounded-lg transition-colors"
          style={{ color: "var(--text-secondary)" }}
          title={theme === "light" ? "Modo oscuro" : "Modo claro"}
        >
          {theme === "light" ? <Moon size={18} className="shrink-0" /> : <Sun size={18} className="shrink-0" />}
          {!sidebarCollapsed && <span className="text-sm">{theme === "light" ? "Modo oscuro" : "Modo claro"}</span>}
        </button>

        {/* Avatar + logout */}
        <div className="flex items-center gap-2 px-3 py-2 mt-1">
          <div
            className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-600 shrink-0"
            style={{ background: "var(--ai-primary)", color: "white" }}
          >
            {user?.name.slice(0, 2).toUpperCase()}
          </div>
          {!sidebarCollapsed && (
            <>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-500 truncate" style={{ color: "var(--text-primary)" }}>{user?.name}</p>
                <p className="text-xs truncate" style={{ color: "var(--text-tertiary)" }}>{user?.email}</p>
              </div>
              <button
                onClick={() => logout()}
                className="p-1.5 rounded-md hover:bg-red-50 text-red-500 transition-colors shrink-0"
                title="Cerrar sesión"
              >
                <LogOut size={15} />
              </button>
            </>
          )}
        </div>

        {/* Toggle colapsar */}
        <button
          onClick={toggleSidebar}
          className="w-full flex items-center justify-center p-2 rounded-lg mt-1 transition-colors"
          style={{ color: "var(--text-tertiary)" }}
          title={sidebarCollapsed ? "Expandir" : "Colapsar"}
        >
          {sidebarCollapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
        </button>
      </div>
    </aside>
  );
}

// ── Subcomponentes ─────────────────────────────────────

function NavSection({ label, collapsed, children, className = "" }: {
  label: string;
  collapsed: boolean;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={className}>
      {!collapsed && (
        <p className="px-3 mb-1 text-xs font-600 uppercase tracking-wider" style={{ color: "var(--text-disabled)" }}>
          {label}
        </p>
      )}
      <div className="space-y-0.5">{children}</div>
    </div>
  );
}

function SidebarItem({ to, icon: Icon, label, collapsed, exact }: {
  to: string;
  icon: React.ElementType;
  label: string;
  collapsed: boolean;
  exact?: boolean;
}) {
  return (
    <NavLink
      to={to}
      end={exact}
      className={({ isActive }) =>
        clsx(
          "flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-all",
          isActive
            ? "font-500"
            : "hover:opacity-80"
        )
      }
      style={({ isActive }) => ({
        background: isActive ? "var(--bg-tertiary)" : "transparent",
        color: isActive ? "var(--text-primary)" : "var(--text-secondary)",
      })}
      title={collapsed ? label : undefined}
    >
      <Icon size={18} className="shrink-0" />
      {!collapsed && <span className="truncate">{label}</span>}
    </NavLink>
  );
}
