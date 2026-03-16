import type { FastifyInstance } from "fastify";
import { prisma } from "../../plugins/prisma";
import { authenticate } from "../../middleware/auth.middleware";

export async function notificationRoutes(app: FastifyInstance) {
  app.addHook("preHandler", authenticate);

  // ── GET /api/v1/notifications ────────────────────────
  app.get("/", async (request) => {
    const { page = 1, limit = 20, unreadOnly } = request.query as {
      page?: number; limit?: number; unreadOnly?: string;
    };

    const where = {
      userId: request.user.id,
      ...(unreadOnly === "true" && { readAt: null }),
    };

    const [notifications, total, unreadCount] = await prisma.$transaction([
      prisma.notification.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.notification.count({ where }),
      prisma.notification.count({ where: { userId: request.user.id, readAt: null } }),
    ]);

    return {
      data: notifications,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
      unreadCount,
    };
  });

  // ── POST /api/v1/notifications/mark-read ─────────────
  app.post("/mark-read", async (request, reply) => {
    const { ids } = request.body as { ids?: string[] };

    if (ids?.length) {
      await prisma.notification.updateMany({
        where: { id: { in: ids }, userId: request.user.id },
        data: { readAt: new Date() },
      });
    } else {
      // Marcar todas como leídas
      await prisma.notification.updateMany({
        where: { userId: request.user.id, readAt: null },
        data: { readAt: new Date() },
      });
    }

    return reply.status(204).send();
  });

  // ── DELETE /api/v1/notifications ─────────────────────
  app.delete("/", async (request, reply) => {
    await prisma.notification.deleteMany({
      where: { userId: request.user.id, readAt: { not: null } },
    });
    return reply.status(204).send();
  });
}
