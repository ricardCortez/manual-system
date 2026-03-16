import { Server as SocketIOServer } from "socket.io";
import type { Server as HTTPServer } from "http";
import jwt from "jsonwebtoken";
import fs from "fs";

// ──────────────────────────────────────────────────────
// Socket.io — Notificaciones y progreso en tiempo real
// ──────────────────────────────────────────────────────

let io: SocketIOServer;

export const socketServer = {
  attach(httpServer: HTTPServer) {
    const publicKey = fs.readFileSync(
      process.env.JWT_PUBLIC_KEY_PATH || "./keys/public.pem",
      "utf8"
    );

    io = new SocketIOServer(httpServer, {
      cors: {
        origin: process.env.APP_URL || "https://manuals.empresa.local",
        credentials: true,
      },
      path: "/socket.io",
      transports: ["websocket", "polling"],
    });

    // Middleware de autenticación
    io.use((socket, next) => {
      const token = socket.handshake.auth.token || socket.handshake.headers.authorization?.split(" ")[1];

      if (!token) {
        return next(new Error("Token de autenticación requerido"));
      }

      try {
        const payload = jwt.verify(token, publicKey, { algorithms: ["RS256"] }) as { id: string; role: string };
        socket.data.userId = payload.id;
        socket.data.role = payload.role;
        next();
      } catch {
        next(new Error("Token inválido o expirado"));
      }
    });

    io.on("connection", (socket) => {
      const userId = socket.data.userId;

      // Unirse a sala personal del usuario
      socket.join(`user:${userId}`);

      socket.on("join:document", (documentId: string) => {
        socket.join(`document:${documentId}`);
      });

      socket.on("leave:document", (documentId: string) => {
        socket.leave(`document:${documentId}`);
      });

      socket.on("disconnect", () => {
        socket.leave(`user:${userId}`);
      });
    });

    return io;
  },

  // ── Emisores de eventos ──────────────────────────────

  /** Notificación personal a un usuario */
  notifyUser(userId: string, event: string, data: unknown) {
    io?.to(`user:${userId}`).emit(event, data);
  },

  /** Progreso de procesamiento de video */
  videoProgress(userId: string, videoId: string, progress: { step: string; percent: number; status: string }) {
    io?.to(`user:${userId}`).emit("video:progress", { videoId, ...progress });
  },

  /** Progreso de generación de resumen IA */
  aiProgress(userId: string, summaryId: string, event: "started" | "streaming" | "done" | "error", data?: unknown) {
    io?.to(`user:${userId}`).emit("ai:progress", { summaryId, event, data });
  },

  /** Notificación a todos los usuarios de un área */
  notifyArea(areaId: string, event: string, data: unknown) {
    io?.to(`area:${areaId}`).emit(event, data);
  },

  /** Broadcast a todos los usuarios autenticados */
  broadcast(event: string, data: unknown) {
    io?.emit(event, data);
  },

  getInstance(): SocketIOServer {
    return io;
  },
};
