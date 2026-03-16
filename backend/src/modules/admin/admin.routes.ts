import type { FastifyInstance } from "fastify";
import { prisma } from "../../plugins/prisma";
import { redis } from "../../plugins/redis";
import { meiliSearch } from "../../plugins/meilisearch";
import { ollamaClient } from "../ai/ollama";
import { authenticate, requireAdmin, requireSuperAdmin } from "../../middleware/auth.middleware";
import { videoQueue, aiQueue, notificationQueue } from "../../jobs/queues";
import { exec } from "child_process";
import { promisify } from "util";
import path from "path";
import fs from "fs/promises";

const execAsync = promisify(exec);

export async function adminRoutes(app: FastifyInstance) {
  app.addHook("preHandler", [authenticate, requireAdmin]);

  // ── GET /api/v1/admin/dashboard ──────────────────────
  app.get("/dashboard", async () => {
    const now = new Date();
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    const [
      docsByStatus,
      docsByType,
      docsExpiringIn30,
      activeUsers7d,
      aiStats,
      diskUsage,
    ] = await prisma.$transaction([
      prisma.document.groupBy({ by: ["status"], where: { isDeleted: false }, _count: { _all: true } }),
      prisma.document.groupBy({ by: ["type"], where: { isDeleted: false }, _count: { _all: true } }),
      prisma.document.count({
        where: {
          isDeleted: false,
          status: "PUBLICADO",
          expiryDate: { gte: now, lte: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000) },
        },
      }),
      prisma.auditLog.groupBy({
        by: ["userId"],
        where: { createdAt: { gte: sevenDaysAgo }, userId: { not: null } },
        _count: { _all: true },
        orderBy: { _count: { userId: "desc" } },
        take: 5,
      }),
      prisma.aISummary.aggregate({
        where: { status: "DONE" },
        _count: { _all: true },
        _sum: { tokensUsed: true },
      }),
      // Disk usage aproximado
      prisma.documentVersion.aggregate({ _sum: { fileSize: true } }),
    ]);

    // Accesos por día (últimos 7 días)
    const accessByDay = await prisma.auditLog.groupBy({
      by: ["createdAt"],
      where: {
        action: { in: ["DOCUMENT_VIEWED", "VIDEO_VIEWED"] },
        createdAt: { gte: sevenDaysAgo },
      },
      _count: { _all: true },
    });

    return {
      documents: { byStatus: docsByStatus, byType: docsByType, expiringIn30: docsExpiringIn30 },
      users: { mostActive7d: activeUsers7d },
      ai: {
        totalSummaries: aiStats._count._all,
        totalTokens: aiStats._sum.tokensUsed || 0,
      },
      storage: { totalBytes: diskUsage._sum.fileSize || 0 },
      access: { last7Days: accessByDay },
    };
  });

  // ── GET /api/v1/admin/health ─────────────────────────
  app.get("/health", async () => {
    const checks = await Promise.allSettled([
      prisma.$queryRaw`SELECT 1`.then(() => ({ name: "database", status: "ok" })),
      redis.ping().then((r) => ({ name: "redis", status: r === "PONG" ? "ok" : "error" })),
      meiliSearch.client.health().then(() => ({ name: "meilisearch", status: "ok" })),
      ollamaClient.checkHealth().then((ok) => ({ name: "ollama", status: ok ? "ok" : "unavailable" })),
    ]);

    const results = checks.map((c, i) => {
      if (c.status === "fulfilled") return c.value;
      return { name: ["database", "redis", "meilisearch", "ollama"][i], status: "error", error: (c.reason as Error)?.message };
    });

    const allOk = results.every((r) => r.status === "ok" || r.status === "unavailable");

    return {
      overall: allOk ? "healthy" : "degraded",
      services: results,
      timestamp: new Date().toISOString(),
    };
  });

  // ── GET /api/v1/admin/queues-status ──────────────────
  app.get("/queues-status", async () => {
    const [videoStats, aiStats, notifStats] = await Promise.all([
      videoQueue.getJobCounts(),
      aiQueue.getJobCounts(),
      notificationQueue.getJobCounts(),
    ]);

    return {
      video: { name: "video-processing", ...videoStats },
      ai: { name: "ai-processing", ...aiStats },
      notifications: { name: "notifications", ...notifStats },
    };
  });

  // ── GET /api/v1/admin/audit ──────────────────────────
  app.get("/audit", async (request) => {
    const {
      userId, action, documentId, page = 1, limit = 50,
      from, to,
    } = request.query as {
      userId?: string; action?: string; documentId?: string;
      page?: number; limit?: number; from?: string; to?: string;
    };

    const where = {
      ...(userId && { userId }),
      ...(action && { action: action as Parameters<typeof prisma.auditLog.findMany>[0]["where"]["action"] }),
      ...(documentId && { documentId }),
      ...(from || to ? {
        createdAt: {
          ...(from && { gte: new Date(from) }),
          ...(to && { lte: new Date(to) }),
        },
      } : {}),
    };

    const [logs, total] = await prisma.$transaction([
      prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
        include: {
          user: { select: { id: true, name: true, email: true } },
        },
      }),
      prisma.auditLog.count({ where }),
    ]);

    return { data: logs, pagination: { page, limit, total, pages: Math.ceil(total / limit) } };
  });

  // ── GET /api/v1/admin/config ─────────────────────────
  app.get("/config", { preHandler: [requireSuperAdmin] }, async () => {
    const configs = await prisma.systemConfig.findMany({
      where: { encrypted: false },
    });
    return Object.fromEntries(configs.map((c) => [c.key, c.value]));
  });

  // ── PUT /api/v1/admin/config ─────────────────────────
  app.put("/config", { preHandler: [requireSuperAdmin] }, async (request, reply) => {
    const updates = request.body as Record<string, string>;

    await prisma.$transaction(
      Object.entries(updates).map(([key, value]) =>
        prisma.systemConfig.upsert({
          where: { key },
          create: { key, value, updatedBy: request.user.id },
          update: { value, updatedBy: request.user.id },
        })
      )
    );

    return reply.status(204).send();
  });

  // ── POST /api/v1/admin/backup ────────────────────────
  app.post("/backup", { preHandler: [requireSuperAdmin] }, async (request, reply) => {
    const backupDir = process.env.BACKUP_PATH || "/backups";
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const backupFile = path.join(backupDir, `manuals_backup_${timestamp}.sql`);

    const dbUrl = process.env.DATABASE_URL || "";
    const match = dbUrl.match(/postgresql:\/\/([^:]+):([^@]+)@([^:]+):(\d+)\/(.+)/);
    if (!match) {
      return reply.status(500).send({ statusCode: 500, error: "Internal Server Error", message: "DATABASE_URL inválida" });
    }

    const [, user, password, host, port, db] = match;

    await fs.mkdir(backupDir, { recursive: true });

    await execAsync(
      `PGPASSWORD="${password}" pg_dump -h ${host} -p ${port} -U ${user} -d ${db} -F p -f "${backupFile}"`,
      { timeout: 300000 }
    );

    const stat = await fs.stat(backupFile);

    return { file: backupFile, size: stat.size, timestamp };
  });

  // ── GET /api/v1/admin/ai-usage ───────────────────────
  app.get("/ai-usage", async (request) => {
    const { from, to, userId } = request.query as { from?: string; to?: string; userId?: string };

    const where = {
      ...(userId && { userId }),
      ...(from || to ? {
        date: {
          ...(from && { gte: new Date(from) }),
          ...(to && { lte: new Date(to) }),
        },
      } : {}),
    };

    const usage = await prisma.aIUsageLog.findMany({
      where,
      include: { user: { select: { name: true, email: true } } },
      orderBy: { date: "desc" },
      take: 100,
    });

    const totals = await prisma.aIUsageLog.aggregate({
      where,
      _sum: { summaryCount: true, chatMessageCount: true, tokensUsed: true },
    });

    return { usage, totals: totals._sum };
  });
}
