import type { FastifyInstance } from "fastify";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { prisma } from "../../plugins/prisma";
import { redis, cache, CacheKeys } from "../../plugins/redis";
import { authenticate } from "../../middleware/auth.middleware";
import { createAuditLog } from "../../middleware/audit.middleware";
import { v4 as uuidv4 } from "uuid";
import fs from "fs";
import jwt from "jsonwebtoken";

const loginSchema = z.object({
  email: z.string().email("Email inválido"),
  password: z.string().min(1, "Contraseña requerida"),
});

const refreshSchema = z.object({
  refreshToken: z.string().min(1, "Refresh token requerido"),
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z
    .string()
    .min(8, "Mínimo 8 caracteres")
    .regex(/[A-Z]/, "Debe contener al menos una mayúscula")
    .regex(/[0-9]/, "Debe contener al menos un número"),
});

const privateKey = fs.readFileSync(
  process.env.JWT_PRIVATE_KEY_PATH || "./keys/private.pem",
  "utf8"
);

function generateTokens(userId: string, role: string) {
  const accessToken = jwt.sign({ id: userId, role }, privateKey, {
    algorithm: "RS256",
    expiresIn: (process.env.JWT_ACCESS_EXPIRES || "15m") as `${number}${"s" | "m" | "h" | "d"}`,
  });

  const refreshToken = uuidv4();
  return { accessToken, refreshToken };
}

export async function authRoutes(app: FastifyInstance) {
  // ── POST /api/v1/auth/login ──────────────────────────
  app.post(
    "/login",
    {
      schema: {
        tags: ["Auth"],
        summary: "Iniciar sesión",
        body: {
          type: "object",
          required: ["email", "password"],
          properties: {
            email: { type: "string", format: "email" },
            password: { type: "string" },
          },
        },
      },
    },
    async (request, reply) => {
      const { email, password } = loginSchema.parse(request.body);

      const user = await prisma.user.findUnique({
        where: { email: email.toLowerCase() },
        select: {
          id: true,
          email: true,
          name: true,
          role: true,
          areaId: true,
          passwordHash: true,
          isActive: true,
          failedLoginCount: true,
          lockedUntil: true,
        },
      });

      // Anti-timing: comparar siempre aunque el usuario no exista
      const passwordMatch = user
        ? await bcrypt.compare(password, user.passwordHash)
        : await bcrypt.compare(password, "$2b$12$invalidhashforsecurity");

      // Cuenta bloqueada
      if (user?.lockedUntil && user.lockedUntil > new Date()) {
        await createAuditLog({ userId: user.id, action: "LOGIN_FAILED", metadata: { reason: "account_locked" }, request });
        return reply.status(423).send({
          statusCode: 423,
          error: "Account Locked",
          message: "Cuenta bloqueada temporalmente por múltiples intentos fallidos",
        });
      }

      if (!user || !passwordMatch) {
        // Incrementar contador de fallos
        if (user) {
          const newCount = user.failedLoginCount + 1;
          await prisma.user.update({
            where: { id: user.id },
            data: {
              failedLoginCount: newCount,
              // Bloquear 15 minutos si supera 5 intentos
              lockedUntil: newCount >= 5 ? new Date(Date.now() + 15 * 60 * 1000) : undefined,
            },
          });
          await createAuditLog({ userId: user.id, action: "LOGIN_FAILED", request });
        }

        return reply.status(401).send({
          statusCode: 401,
          error: "Unauthorized",
          message: "Email o contraseña incorrectos",
        });
      }

      if (!user.isActive) {
        return reply.status(403).send({
          statusCode: 403,
          error: "Forbidden",
          message: "Cuenta desactivada. Contacta al administrador.",
        });
      }

      // Reset contador de fallos + login exitoso
      await prisma.user.update({
        where: { id: user.id },
        data: {
          failedLoginCount: 0,
          lockedUntil: null,
          lastLogin: new Date(),
          loginCount: { increment: 1 },
        },
      });

      const { accessToken, refreshToken } = generateTokens(user.id, user.role);
      const refreshExpiry = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

      await prisma.refreshToken.create({
        data: {
          token: refreshToken,
          userId: user.id,
          expiresAt: refreshExpiry,
        },
      });

      await createAuditLog({ userId: user.id, action: "LOGIN", request });

      return reply.status(200).send({
        accessToken,
        refreshToken,
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
          areaId: user.areaId,
        },
      });
    }
  );

  // ── POST /api/v1/auth/refresh ────────────────────────
  app.post(
    "/refresh",
    {
      schema: {
        tags: ["Auth"],
        summary: "Renovar access token",
      },
    },
    async (request, reply) => {
      const { refreshToken } = refreshSchema.parse(request.body);

      const tokenRecord = await prisma.refreshToken.findUnique({
        where: { token: refreshToken },
        include: { user: { select: { id: true, role: true, isActive: true } } },
      });

      if (!tokenRecord || tokenRecord.revokedAt || tokenRecord.expiresAt < new Date()) {
        return reply.status(401).send({
          statusCode: 401,
          error: "Unauthorized",
          message: "Refresh token inválido o expirado",
        });
      }

      if (!tokenRecord.user.isActive) {
        return reply.status(403).send({ statusCode: 403, error: "Forbidden", message: "Cuenta desactivada" });
      }

      // Rotación de refresh token
      const { accessToken, refreshToken: newRefreshToken } = generateTokens(
        tokenRecord.user.id,
        tokenRecord.user.role
      );

      await prisma.$transaction([
        // Revocar token anterior
        prisma.refreshToken.update({
          where: { id: tokenRecord.id },
          data: { revokedAt: new Date() },
        }),
        // Crear nuevo token
        prisma.refreshToken.create({
          data: {
            token: newRefreshToken,
            userId: tokenRecord.userId,
            expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
          },
        }),
      ]);

      await createAuditLog({ userId: tokenRecord.userId, action: "TOKEN_REFRESHED", request });

      return { accessToken, refreshToken: newRefreshToken };
    }
  );

  // ── POST /api/v1/auth/logout ─────────────────────────
  app.post(
    "/logout",
    {
      preHandler: [authenticate],
      schema: { tags: ["Auth"], summary: "Cerrar sesión" },
    },
    async (request, reply) => {
      const { refreshToken } = request.body as { refreshToken?: string };

      if (refreshToken) {
        await prisma.refreshToken.updateMany({
          where: { token: refreshToken, userId: request.user.id },
          data: { revokedAt: new Date() },
        });
      }

      // Invalidar caché del usuario
      await cache.del(CacheKeys.user(request.user.id));

      await createAuditLog({ userId: request.user.id, action: "LOGOUT", request });

      return reply.status(204).send();
    }
  );

  // ── GET /api/v1/auth/me ──────────────────────────────
  app.get(
    "/me",
    {
      preHandler: [authenticate],
      schema: { tags: ["Auth"], summary: "Perfil del usuario autenticado" },
    },
    async (request) => {
      const user = await prisma.user.findUnique({
        where: { id: request.user.id },
        select: {
          id: true,
          email: true,
          name: true,
          role: true,
          areaId: true,
          avatarUrl: true,
          phone: true,
          jobTitle: true,
          lastLogin: true,
          loginCount: true,
          area: { select: { id: true, name: true, code: true } },
        },
      });

      return user;
    }
  );

  // ── POST /api/v1/auth/change-password ────────────────
  app.post(
    "/change-password",
    {
      preHandler: [authenticate],
      schema: { tags: ["Auth"], summary: "Cambiar contraseña" },
    },
    async (request, reply) => {
      const { currentPassword, newPassword } = changePasswordSchema.parse(request.body);

      const user = await prisma.user.findUnique({
        where: { id: request.user.id },
        select: { passwordHash: true },
      });

      if (!user || !(await bcrypt.compare(currentPassword, user.passwordHash))) {
        return reply.status(400).send({
          statusCode: 400,
          error: "Bad Request",
          message: "Contraseña actual incorrecta",
        });
      }

      const newHash = await bcrypt.hash(newPassword, parseInt(process.env.BCRYPT_ROUNDS || "12"));

      await prisma.user.update({
        where: { id: request.user.id },
        data: { passwordHash: newHash, passwordChangedAt: new Date() },
      });

      // Revocar todos los refresh tokens al cambiar contraseña
      await prisma.refreshToken.updateMany({
        where: { userId: request.user.id, revokedAt: null },
        data: { revokedAt: new Date() },
      });

      await cache.del(CacheKeys.user(request.user.id));
      await createAuditLog({ userId: request.user.id, action: "PASSWORD_CHANGED", request });

      return { message: "Contraseña actualizada exitosamente" };
    }
  );
}
