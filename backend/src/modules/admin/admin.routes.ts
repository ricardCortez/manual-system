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
  app.addHook("preHandler", authenticate);
  app.addHook("preHandler", requireAdmin);

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
      docsBytesResult,
      videosBytesResult,
      totalUsers,
      activeUsersCount,
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
      prisma.documentVersion.aggregate({
        where: { document: { type: { not: "VIDEO" }, isDeleted: false } },
        _sum: { fileSize: true },
      }),
      prisma.documentVersion.aggregate({
        where: { document: { type: "VIDEO", isDeleted: false } },
        _sum: { fileSize: true },
      }),
      prisma.user.count({ where: { deletedAt: null } }),
      prisma.user.count({ where: { isActive: true, deletedAt: null } }),
    ]);

    // Derivar totales de documentos
    const totalDocs = docsByStatus.reduce((sum, g) => sum + g._count._all, 0);
    const publishedDocs = docsByStatus.find((g) => g.status === "PUBLICADO")?._count._all ?? 0;
    const draftDocs = docsByStatus.find((g) => g.status === "BORRADOR")?._count._all ?? 0;

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
      stats: {
        documents: { total: totalDocs, published: publishedDocs, draft: draftDocs },
        users: { total: totalUsers, active: activeUsersCount },
        storage: {
          documentsBytes: docsBytesResult._sum.fileSize || 0,
          videosBytes: videosBytesResult._sum.fileSize || 0,
        },
      },
      documents: { byStatus: docsByStatus, byType: docsByType, expiringIn30: docsExpiringIn30 },
      users: { mostActive7d: activeUsers7d },
      ai: {
        totalSummaries: aiStats._count._all,
        totalTokens: aiStats._sum.tokensUsed || 0,
      },
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

  // ── GET /api/v1/admin/cleanup (preview) ─────────────
  app.get("/cleanup", { preHandler: [requireSuperAdmin] }, async () => {
    const now = new Date();
    const stuckCutoff = new Date(now.getTime() - 4 * 60 * 60 * 1000); // 4 horas
    const notifCutoff = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
    const searchCutoff = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    const STUCK_STATUSES = ["PENDING", "UPLOADING", "VALIDATING", "ENCODING", "GENERATING_HLS", "EXTRACTING_AUDIO", "TRANSCRIBING", "INDEXING"] as const;

    const [
      softDeletedDocs,
      failedVideos,
      stuckVideos,
      expiredTokens,
      oldNotifications,
      oldSearchHistory,
    ] = await prisma.$transaction([
      prisma.document.count({ where: { isDeleted: true } }),
      prisma.videoAsset.count({ where: { processingStatus: "FAILED" } }),
      prisma.videoAsset.count({
        where: { processingStatus: { in: [...STUCK_STATUSES] }, createdAt: { lt: stuckCutoff } },
      }),
      prisma.refreshToken.count({
        where: { OR: [{ revokedAt: { not: null } }, { expiresAt: { lt: now } }] },
      }),
      prisma.notification.count({ where: { createdAt: { lt: notifCutoff } } }),
      prisma.searchHistory.count({ where: { createdAt: { lt: searchCutoff } } }),
    ]);

    return {
      preview: {
        softDeletedDocuments: softDeletedDocs,
        failedVideoAssets: failedVideos,
        stuckVideoAssets: stuckVideos,
        expiredTokens,
        oldNotifications,
        oldSearchHistory,
      },
      config: {
        stuckThresholdHours: 4,
        notificationsOlderThanDays: 90,
        searchHistoryOlderThanDays: 30,
      },
    };
  });

  // ── POST /api/v1/admin/cleanup (ejecutar) ────────────
  app.post("/cleanup", { preHandler: [requireSuperAdmin] }, async (request, reply) => {
    const now = new Date();
    const stuckCutoff = new Date(now.getTime() - 4 * 60 * 60 * 1000);
    const notifCutoff = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
    const searchCutoff = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    const STUCK_STATUSES = ["PENDING", "UPLOADING", "VALIDATING", "ENCODING", "GENERATING_HLS", "EXTRACTING_AUDIO", "TRANSCRIBING", "INDEXING"] as const;

    const results = {
      softDeletedDocuments: 0,
      failedVideoAssets: 0,
      stuckVideoAssets: 0,
      expiredTokens: 0,
      oldNotifications: 0,
      oldSearchHistory: 0,
      freedBytes: 0,
      errors: [] as string[],
    };

    // ── 1. Documentos con isDeleted: true ──────────────
    const softDeletedDocs = await prisma.document.findMany({
      where: { isDeleted: true },
      select: { id: true },
    });
    const softDeletedIds = softDeletedDocs.map((d) => d.id);

    if (softDeletedIds.length > 0) {
      const softDeletedVersions = await prisma.documentVersion.findMany({
        where: { documentId: { in: softDeletedIds } },
        select: { filePath: true, thumbnailPath: true, fileSize: true },
      });
      for (const v of softDeletedVersions) {
        results.freedBytes += v.fileSize || 0;
        await fs.unlink(v.filePath).catch(() => null);
        if (v.thumbnailPath) await fs.unlink(v.thumbnailPath).catch(() => null);
      }

      // Eliminar registros sin cascade antes de borrar los documentos
      await prisma.readConfirmation.deleteMany({ where: { documentId: { in: softDeletedIds } } });
      await prisma.auditLog.updateMany({ where: { documentId: { in: softDeletedIds } }, data: { documentId: null } });
      await prisma.aIChatSession.deleteMany({ where: { documentId: { in: softDeletedIds } } });
      await prisma.approvalFlow.deleteMany({ where: { documentId: { in: softDeletedIds } } });
      await prisma.accessPermission.deleteMany({ where: { documentId: { in: softDeletedIds } } });
    }

    const deletedDocs = await prisma.document.deleteMany({ where: { isDeleted: true } });
    results.softDeletedDocuments = deletedDocs.count;

    // ── 2. VideoAssets FAILED ──────────────────────────
    const failedAssets = await prisma.videoAsset.findMany({
      where: { processingStatus: "FAILED" },
      select: { id: true, originalPath: true, hlsBasePath: true, thumbnailPath: true, originalSize: true },
    });
    for (const asset of failedAssets) {
      results.freedBytes += asset.originalSize || 0;
      await fs.unlink(asset.originalPath).catch(() => null);
      if (asset.hlsBasePath) await fs.rm(asset.hlsBasePath, { recursive: true, force: true }).catch(() => null);
      if (asset.thumbnailPath) await fs.unlink(asset.thumbnailPath).catch(() => null);
    }
    if (failedAssets.length > 0) {
      const deleted = await prisma.videoAsset.deleteMany({ where: { processingStatus: "FAILED" } });
      results.failedVideoAssets = deleted.count;
    }

    // ── 3. VideoAssets atascados (> 4h sin completar) ──
    const stuckAssets = await prisma.videoAsset.findMany({
      where: { processingStatus: { in: [...STUCK_STATUSES] }, createdAt: { lt: stuckCutoff } },
      select: { id: true, originalPath: true, hlsBasePath: true, thumbnailPath: true, originalSize: true },
    });
    for (const asset of stuckAssets) {
      results.freedBytes += asset.originalSize || 0;
      await fs.unlink(asset.originalPath).catch(() => null);
      if (asset.hlsBasePath) await fs.rm(asset.hlsBasePath, { recursive: true, force: true }).catch(() => null);
      if (asset.thumbnailPath) await fs.unlink(asset.thumbnailPath).catch(() => null);
    }
    if (stuckAssets.length > 0) {
      const deleted = await prisma.videoAsset.deleteMany({
        where: { processingStatus: { in: [...STUCK_STATUSES] }, createdAt: { lt: stuckCutoff } },
      });
      results.stuckVideoAssets = deleted.count;
    }

    // ── 4. RefreshTokens expirados / revocados ─────────
    const deletedTokens = await prisma.refreshToken.deleteMany({
      where: { OR: [{ revokedAt: { not: null } }, { expiresAt: { lt: now } }] },
    });
    results.expiredTokens = deletedTokens.count;

    // ── 5. Notificaciones antiguas ─────────────────────
    const deletedNotifs = await prisma.notification.deleteMany({ where: { createdAt: { lt: notifCutoff } } });
    results.oldNotifications = deletedNotifs.count;

    // ── 6. Historial de búsqueda antiguo ──────────────
    const deletedSearch = await prisma.searchHistory.deleteMany({ where: { createdAt: { lt: searchCutoff } } });
    results.oldSearchHistory = deletedSearch.count;

    // ── Registro de auditoría ──────────────────────────
    await prisma.auditLog.create({
      data: {
        userId: request.user.id,
        action: "SYSTEM_CONFIG_CHANGED",
        entityType: "System",
        entityId: "cleanup",
        metadata: results as unknown as Parameters<typeof prisma.auditLog.create>[0]["data"]["metadata"],
      },
    });

    return reply.status(200).send(results);
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
