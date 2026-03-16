import { useEffect } from "react";
import { X, Bell, Check, CheckCheck, Loader2 } from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import { es } from "date-fns/locale";
import { useUIStore } from "@/stores/ui.store";
import api from "@/lib/api";

interface Notification {
  id: string;
  type: string;
  title: string;
  body: string;
  readAt: string | null;
  createdAt: string;
  data?: Record<string, unknown>;
}

const notifTypeIcon: Record<string, string> = {
  NEW_DOCUMENT_PUBLISHED: "📄",
  DOCUMENT_UPDATED_FAVORITES: "⭐",
  DOCUMENT_EXPIRING_SOON: "⏳",
  DOCUMENT_ASSIGNED_REVIEW: "👁️",
  APPROVAL_FLOW_COMPLETED: "✅",
  VIDEO_PROCESSING_COMPLETE: "🎬",
  AI_SUMMARY_READY: "✦",
  WEEKLY_DIGEST: "📊",
};

export function NotificationsDrawer() {
  const { toggleNotifications, setUnreadNotifications } = useUIStore();
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["notifications"],
    queryFn: () => api.get<{ data: Notification[]; unreadCount: number }>("/notifications").then((r) => r.data),
    refetchInterval: 30000,
  });

  const markReadMutation = useMutation({
    mutationFn: (ids?: string[]) => api.post("/notifications/mark-read", { ids }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["notifications"] }),
  });

  const clearMutation = useMutation({
    mutationFn: () => api.delete("/notifications"),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["notifications"] }),
  });

  useEffect(() => {
    if (data?.unreadCount !== undefined) {
      setUnreadNotifications(data.unreadCount);
    }
  }, [data?.unreadCount, setUnreadNotifications]);

  const notifications = data?.data || [];

  return (
    <>
      {/* Overlay */}
      <div
        className="fixed inset-0 z-40"
        style={{ background: "var(--bg-overlay)" }}
        onClick={toggleNotifications}
      />

      {/* Drawer */}
      <div
        className="drawer open fixed top-0 right-0 z-50 flex flex-col"
        style={{ width: 380, background: "var(--bg-elevated)" }}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-5 py-4 shrink-0"
          style={{ borderBottom: "1px solid var(--border-subtle)" }}
        >
          <div className="flex items-center gap-2">
            <Bell size={18} style={{ color: "var(--text-primary)" }} />
            <h2 className="font-display text-base font-600" style={{ color: "var(--text-primary)" }}>
              Notificaciones
            </h2>
            {(data?.unreadCount || 0) > 0 && (
              <span
                className="text-xs font-600 px-1.5 py-0.5 rounded-full"
                style={{ background: "var(--ai-primary)", color: "white" }}
              >
                {data?.unreadCount}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {(data?.unreadCount || 0) > 0 && (
              <button
                onClick={() => markReadMutation.mutate(undefined)}
                className="flex items-center gap-1 text-xs py-1 px-2 rounded-md transition-colors"
                style={{ color: "var(--text-secondary)", background: "var(--bg-tertiary)" }}
                title="Marcar todas como leídas"
              >
                <CheckCheck size={13} />
                Marcar leídas
              </button>
            )}
            <button onClick={toggleNotifications} style={{ color: "var(--text-tertiary)" }}>
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Lista */}
        <div className="flex-1 overflow-y-auto">
          {isLoading && (
            <div className="flex items-center justify-center py-12">
              <Loader2 size={20} className="animate-spin" style={{ color: "var(--text-tertiary)" }} />
            </div>
          )}

          {!isLoading && notifications.length === 0 && (
            <div className="flex flex-col items-center justify-center py-16 gap-3">
              <Bell size={32} style={{ color: "var(--text-disabled)" }} />
              <p className="text-sm" style={{ color: "var(--text-tertiary)" }}>Sin notificaciones</p>
            </div>
          )}

          {notifications.map((notif) => (
            <div
              key={notif.id}
              className="flex gap-3 px-5 py-3.5 cursor-pointer transition-colors"
              style={{
                background: !notif.readAt ? "var(--ai-bg)" : "transparent",
                borderBottom: "1px solid var(--border-subtle)",
              }}
              onClick={() => !notif.readAt && markReadMutation.mutate([notif.id])}
            >
              <span className="text-xl shrink-0 mt-0.5">
                {notifTypeIcon[notif.type] || "🔔"}
              </span>
              <div className="flex-1 min-w-0">
                <div className="flex items-start justify-between gap-2">
                  <p
                    className="text-sm font-500 leading-tight"
                    style={{ color: "var(--text-primary)" }}
                  >
                    {notif.title}
                  </p>
                  {!notif.readAt && (
                    <div
                      className="w-2 h-2 rounded-full shrink-0 mt-1"
                      style={{ background: "var(--ai-primary)" }}
                    />
                  )}
                </div>
                <p
                  className="text-xs mt-0.5 leading-relaxed"
                  style={{ color: "var(--text-secondary)" }}
                >
                  {notif.body}
                </p>
                <p className="text-xs mt-1" style={{ color: "var(--text-tertiary)" }}>
                  {formatDistanceToNow(new Date(notif.createdAt), { addSuffix: true, locale: es })}
                </p>
              </div>
            </div>
          ))}
        </div>

        {/* Footer */}
        {notifications.length > 0 && (
          <div
            className="shrink-0 px-5 py-3"
            style={{ borderTop: "1px solid var(--border-subtle)" }}
          >
            <button
              onClick={() => clearMutation.mutate()}
              className="text-xs transition-colors"
              style={{ color: "var(--text-tertiary)" }}
            >
              Limpiar notificaciones leídas
            </button>
          </div>
        )}
      </div>
    </>
  );
}
