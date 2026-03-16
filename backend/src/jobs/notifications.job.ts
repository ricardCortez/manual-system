import type { Job } from "bullmq";
import { prisma } from "../plugins/prisma";
import { socketServer } from "../plugins/socket";

interface NotificationJobData {
  type: string;
  userId?: string;
  userIds?: string[];
  areaId?: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
}

export async function notificationProcessor(job: Job<NotificationJobData>) {
  const { type, userId, userIds, areaId, title, body, data } = job.data;

  // Determinar destinatarios
  let targetUserIds: string[] = [];

  if (userId) {
    targetUserIds = [userId];
  } else if (userIds) {
    targetUserIds = userIds;
  } else if (areaId) {
    const users = await prisma.user.findMany({
      where: { areaId, isActive: true },
      select: { id: true },
    });
    targetUserIds = users.map((u) => u.id);
  }

  // Crear notificaciones en BD y enviar por WebSocket
  await Promise.all(
    targetUserIds.map(async (uid) => {
      await prisma.notification.create({
        data: {
          userId: uid,
          type: type as Parameters<typeof prisma.notification.create>[0]["data"]["type"],
          title,
          body,
          data,
        },
      });

      socketServer.notifyUser(uid, "notification", { type, title, body, data });
    })
  );

  return { sent: targetUserIds.length };
}
