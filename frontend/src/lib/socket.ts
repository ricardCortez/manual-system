import { io, Socket } from "socket.io-client";

let socket: Socket | null = null;

export function connectSocket(_token: string): Socket {
  if (socket?.connected) return socket;

  socket = io(window.location.origin, {
    path: "/socket.io",
    // Use a function so socket.io always reads the latest token from localStorage
    // (the API refresh interceptor updates localStorage but not the Zustand store)
    auth: (cb) => cb({ token: localStorage.getItem("accessToken") ?? "" }),
    transports: ["websocket", "polling"],
    reconnection: true,
    reconnectionAttempts: 10,
    reconnectionDelay: 3000,
  });

  socket.on("connect", () => console.log("[Socket] Conectado:", socket?.id));
  socket.on("disconnect", (reason) => console.log("[Socket] Desconectado:", reason));
  socket.on("connect_error", async (err) => {
    console.error("[Socket] Error:", err.message);
    // If token expired, try to refresh and let socket.io reconnect automatically
    if (err.message.includes("Token") || err.message.includes("token")) {
      const refreshToken = localStorage.getItem("refreshToken");
      if (!refreshToken) return;
      try {
        const resp = await fetch("/api/v1/auth/refresh", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ refreshToken }),
        });
        if (resp.ok) {
          const data = await resp.json();
          localStorage.setItem("accessToken", data.accessToken);
          localStorage.setItem("refreshToken", data.refreshToken);
          // socket.io will retry with the new token via the auth function above
        } else {
          localStorage.clear();
          window.location.href = "/login";
        }
      } catch {
        // Network error, let it retry
      }
    }
  });

  return socket;
}

export function disconnectSocket() {
  socket?.disconnect();
  socket = null;
}

export function getSocket(): Socket | null {
  return socket;
}

export function joinDocument(documentId: string) {
  socket?.emit("join:document", documentId);
}

export function leaveDocument(documentId: string) {
  socket?.emit("leave:document", documentId);
}
