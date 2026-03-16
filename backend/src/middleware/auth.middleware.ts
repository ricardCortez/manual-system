import type { FastifyRequest, FastifyReply } from "fastify";
import { prisma } from "../plugins/prisma";
import { cache, CacheKeys } from "../plugins/redis";
import type { UserRole } from "@prisma/client";

// Extender tipo de request para incluir usuario autenticado
declare module "fastify" {
  interface FastifyRequest {
    user: {
      id: string;
      email: string;
      name: string;
      role: UserRole;
      areaId: string | null;
    };
  }
}

// ──────────────────────────────────────────────────────
// Autenticación obligatoria
// ──────────────────────────────────────────────────────
export async function authenticate(
  request: FastifyRequest,
  reply: FastifyReply
) {
  try {
    await request.jwtVerify();

    const payload = request.user as { id: string };

    // Intentar desde caché primero
    const cached = await cache.get<typeof request.user>(CacheKeys.user(payload.id));
    if (cached) {
      request.user = cached;
      return;
    }

    // Cargar desde BD
    const user = await prisma.user.findUnique({
      where: { id: payload.id, isActive: true },
      select: { id: true, email: true, name: true, role: true, areaId: true },
    });

    if (!user) {
      return reply.status(401).send({
        statusCode: 401,
        error: "Unauthorized",
        message: "Usuario no encontrado o inactivo",
      });
    }

    // Guardar en caché por 5 minutos
    await cache.set(CacheKeys.user(user.id), user, 300);
    request.user = user;
  } catch {
    return reply.status(401).send({
      statusCode: 401,
      error: "Unauthorized",
      message: "Token de acceso inválido o expirado",
    });
  }
}

// ──────────────────────────────────────────────────────
// Guard de roles
// ──────────────────────────────────────────────────────
export function requireRole(...roles: UserRole[]) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    if (!request.user) {
      return reply.status(401).send({ statusCode: 401, error: "Unauthorized", message: "No autenticado" });
    }

    if (!roles.includes(request.user.role)) {
      return reply.status(403).send({
        statusCode: 403,
        error: "Forbidden",
        message: `Se requiere uno de los roles: ${roles.join(", ")}`,
      });
    }
  };
}

// Shortcuts de roles más comunes
export const requireAdmin = requireRole("SUPER_ADMIN", "ADMIN_AREA");
export const requireSuperAdmin = requireRole("SUPER_ADMIN");
export const requireEditor = requireRole("SUPER_ADMIN", "ADMIN_AREA", "EDITOR");
export const requireRevisor = requireRole("SUPER_ADMIN", "ADMIN_AREA", "EDITOR", "REVISOR");
