import "dotenv/config";
import dotenv from "dotenv";
// Runtime override: allows changing env vars without rebuilding the container
dotenv.config({ override: true, path: `${__dirname}/.env.override` });
import Fastify from "fastify";
import fastifyCors from "@fastify/cors";
import fastifyHelmet from "@fastify/helmet";
import fastifyRateLimit from "@fastify/rate-limit";
import fastifyJwt from "@fastify/jwt";
import fastifyMultipart from "@fastify/multipart";
import fastifyStatic from "@fastify/static";
import fastifySwagger from "@fastify/swagger";
import fastifySwaggerUi from "@fastify/swagger-ui";
import fastifyWebsocket from "@fastify/websocket";
import { createBullBoard } from "@bull-board/api";
import { BullMQAdapter } from "@bull-board/api/bullMQAdapter";
import { FastifyAdapter } from "@bull-board/fastify";
import path from "path";
import fs from "fs";

import { prisma } from "./plugins/prisma";
import { redis } from "./plugins/redis";
import { meiliSearch } from "./plugins/meilisearch";
import { socketServer } from "./plugins/socket";
import { authRoutes } from "./modules/auth/auth.routes";
import { userRoutes } from "./modules/users/users.routes";
import { areaRoutes } from "./modules/areas/areas.routes";
import { documentRoutes } from "./modules/documents/documents.routes";
import { videoRoutes } from "./modules/videos/videos.routes";
import { aiRoutes } from "./modules/ai/ai.routes";
import { searchRoutes } from "./modules/search/search.routes";
import { notificationRoutes } from "./modules/notifications/notifications.routes";
import { adminRoutes } from "./modules/admin/admin.routes";
import { videoQueue, aiQueue, notificationQueue } from "./jobs/queues";

// ──────────────────────────────────────────────────────
// Construir app Fastify
// ──────────────────────────────────────────────────────
const app = Fastify({
  logger: {
    level: process.env.NODE_ENV === "production" ? "warn" : "info",
    transport:
      process.env.NODE_ENV !== "production"
        ? { target: "pino-pretty", options: { colorize: true } }
        : undefined,
  },
  trustProxy: true, // Nginx delante
  maxParamLength: 200,
});

async function buildApp() {
  // ── Seguridad ────────────────────────────────────────
  await app.register(fastifyHelmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'"], // Necesario para Swagger UI
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", "data:", "blob:"],
        mediaSrc: ["'self'", "blob:"],
        connectSrc: ["'self'", "ws:", "wss:"],
      },
    },
    crossOriginEmbedderPolicy: false, // Para Video.js
  });

  await app.register(fastifyCors, {
    origin: true, // Auth via JWT — CORS abierto para acceso por IP o hostname en LAN
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  });

  // ── Rate limiting ────────────────────────────────────
  await app.register(fastifyRateLimit, {
    global: true,
    max: parseInt(process.env.RATE_LIMIT_MAX || "100"),
    timeWindow: parseInt(process.env.RATE_LIMIT_WINDOW_MS || "60000"),
    redis: redis,
    keyGenerator: (request) =>
      request.user?.id || request.ip || "anonymous",
    // Upload-chunk routes have their own per-route limit; skip global counter
    // so large multi-chunk uploads are not blocked by the general 100/min cap.
    skip: (request: { url: string }) => /\/upload(-chunk)?$/.test(request.url),
    errorResponseBuilder: () => ({
      statusCode: 429,
      error: "Too Many Requests",
      message: "Demasiadas solicitudes. Intenta nuevamente en un minuto.",
    }),
  });

  // ── JWT ──────────────────────────────────────────────
  const privateKey = fs.readFileSync(
    process.env.JWT_PRIVATE_KEY_PATH || "./keys/private.pem",
    "utf8"
  );
  const publicKey = fs.readFileSync(
    process.env.JWT_PUBLIC_KEY_PATH || "./keys/public.pem",
    "utf8"
  );

  await app.register(fastifyJwt, {
    secret: { private: privateKey, public: publicKey },
    sign: { algorithm: "RS256", expiresIn: process.env.JWT_ACCESS_EXPIRES || "15m" },
    verify: { algorithms: ["RS256"] },
  });

  // ── Multipart (upload) ───────────────────────────────
  await app.register(fastifyMultipart, {
    limits: {
      fileSize: parseInt(process.env.MAX_VIDEO_SIZE_MB || "2048") * 1024 * 1024,
      files: 1,
    },
  });

  // ── Archivos estáticos (uploads) ─────────────────────
  await app.register(fastifyStatic, {
    root: path.resolve(process.env.UPLOAD_BASE_PATH || "./uploads"),
    prefix: "/uploads/",
    decorateReply: false,
  });

  // ── WebSocket ────────────────────────────────────────
  await app.register(fastifyWebsocket);

  // ── Swagger ──────────────────────────────────────────
  await app.register(fastifySwagger, {
    openapi: {
      info: {
        title: process.env.APP_NAME || "Manual del Sistema — API",
        description: "API REST para el sistema de gestión de manuales internos",
        version: "1.0.0",
      },
      servers: [{ url: process.env.APP_URL || "http://localhost:3001" }],
      components: {
        securitySchemes: {
          bearerAuth: {
            type: "http",
            scheme: "bearer",
            bearerFormat: "JWT",
          },
        },
      },
      security: [{ bearerAuth: [] }],
    },
  });

  await app.register(fastifySwaggerUi, {
    routePrefix: "/api/docs",
    uiConfig: { docExpansion: "list", deepLinking: true },
  });

  // ── Bull Board (admin de colas) ───────────────────────
  if (process.env.BULL_BOARD_ENABLED === "true") {
    const serverAdapter = new FastifyAdapter();
    createBullBoard({
      queues: [
        new BullMQAdapter(videoQueue),
        new BullMQAdapter(aiQueue),
        new BullMQAdapter(notificationQueue),
      ],
      serverAdapter,
    });
    serverAdapter.setBasePath(process.env.BULL_BOARD_PATH || "/admin/queues");
    await app.register(serverAdapter.registerPlugin(), {
      basePath: process.env.BULL_BOARD_PATH || "/admin/queues",
      prefix: process.env.BULL_BOARD_PATH || "/admin/queues",
    });
  }

  // ── Socket.io ────────────────────────────────────────
  // Hijack /socket.io requests before Fastify routes them — socket.io handles
  // them directly on the HTTP server (both WebSocket upgrade and polling).
  // Without this, Fastify's notFoundHandler also responds, corrupting the stream.
  app.addHook("onRequest", async (request, reply) => {
    if (request.raw.url?.startsWith("/socket.io")) {
      reply.hijack();
    }
  });

  socketServer.attach(app.server);

  // ── Rutas ────────────────────────────────────────────
  await app.register(authRoutes, { prefix: "/api/v1/auth" });
  await app.register(userRoutes, { prefix: "/api/v1/users" });
  await app.register(areaRoutes, { prefix: "/api/v1/areas" });
  await app.register(documentRoutes, { prefix: "/api/v1/documents" });
  await app.register(videoRoutes, { prefix: "/api/v1/videos" });
  await app.register(aiRoutes, { prefix: "/api/v1/ai" });
  await app.register(searchRoutes, { prefix: "/api/v1/search" });
  await app.register(notificationRoutes, { prefix: "/api/v1/notifications" });
  await app.register(adminRoutes, { prefix: "/api/v1/admin" });

  // ── PDF.js worker — MIME type correcto sin depender de nginx ──
  app.get("/api/v1/pdf-worker", { schema: { hide: true } }, async (_req: any, reply: any) => {
    const workerPath = path.resolve(process.env.UPLOAD_BASE_PATH || "./uploads", "pdf.worker.min.mjs");
    try {
      const content = await fs.promises.readFile(workerPath);
      return reply
        .header("Content-Type", "application/javascript; charset=utf-8")
        .header("Cache-Control", "public, max-age=31536000, immutable")
        .send(content);
    } catch {
      return reply.status(404).send({ message: "PDF worker not found" });
    }
  });

  // ── Health check ─────────────────────────────────────
  app.get("/health", { schema: { hide: true } }, async () => {
    const dbOk = await prisma.$queryRaw`SELECT 1`.then(() => true).catch(() => false);
    const redisOk = await redis.ping().then((r) => r === "PONG").catch(() => false);
    const meiliOk = await meiliSearch.client.health().then(() => true).catch(() => false);

    return {
      status: dbOk && redisOk && meiliOk ? "ok" : "degraded",
      timestamp: new Date().toISOString(),
      version: "1.0.0",
      services: { database: dbOk, redis: redisOk, meilisearch: meiliOk },
    };
  });

  // ── Error handler global ─────────────────────────────
  app.setErrorHandler((error, request, reply) => {
    app.log.error({ err: error, url: request.url }, "Unhandled error");

    if (error.validation) {
      return reply.status(400).send({
        statusCode: 400,
        error: "Validation Error",
        message: error.message,
        details: error.validation,
      });
    }

    const statusCode = error.statusCode || 500;
    return reply.status(statusCode).send({
      statusCode,
      error: error.name || "Internal Server Error",
      message:
        process.env.NODE_ENV === "production" && statusCode === 500
          ? "Error interno del servidor"
          : error.message,
    });
  });

  // ── 404 handler ──────────────────────────────────────
  app.setNotFoundHandler((request, reply) => {
    reply.status(404).send({
      statusCode: 404,
      error: "Not Found",
      message: `Ruta no encontrada: ${request.method} ${request.url}`,
    });
  });

  return app;
}

// ──────────────────────────────────────────────────────
// Iniciar servidor
// ──────────────────────────────────────────────────────
async function start() {
  try {
    const server = await buildApp();

    // Ejecutar migraciones pendientes
    await prisma.$connect();
    app.log.info("✓ Base de datos conectada");

    // Inicializar índices de búsqueda
    await meiliSearch.initIndexes();
    app.log.info("✓ MeiliSearch inicializado");

    const port = parseInt(process.env.APP_PORT || "3001");
    const host = process.env.APP_HOST || "0.0.0.0";

    await server.listen({ port, host });
    app.log.info(`✓ Servidor escuchando en http://${host}:${port}`);
    app.log.info(`✓ API docs: http://${host}:${port}/api/docs`);
  } catch (err) {
    app.log.error(err, "Error al iniciar el servidor");
    process.exit(1);
  }
}

// Graceful shutdown
const shutdown = async (signal: string) => {
  app.log.info(`Recibida señal ${signal}, cerrando...`);
  await app.close();
  await prisma.$disconnect();
  await redis.quit();
  process.exit(0);
};

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

start();

export { app };
