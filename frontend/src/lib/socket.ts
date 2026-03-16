import { io, Socket } from "socket.io-client";

let socket: Socket | null = null;

export function connectSocket(token: string): Socket {
  if (socket?.connected) return socket;

  socket = io(window.location.origin, {
    path: "/socket.io",
    auth: { token },
    transports: ["websocket", "polling"],
    reconnection: true,
    reconnectionAttempts: 5,
    reconnectionDelay: 2000,
  });

  socket.on("connect", () => console.log("[Socket] Conectado:", socket?.id));
  socket.on("disconnect", (reason) => console.log("[Socket] Desconectado:", reason));
  socket.on("connect_error", (err) => console.error("[Socket] Error:", err.message));

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
