import type { FastifyInstance } from "fastify";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { prisma } from "../../plugins/prisma";
import { authenticate, requireAdmin, requireSuperAdmin } from "../../middleware/auth.middleware";
import { createAuditLog } from "../../middleware/audit.middleware";
import { cache, CacheKeys } from "../../plugins/redis";

const createUserSchema = z.object({
  name: z.string().min(2).max(100),
  email: z.string().email(),
  password: z.string().min(8).regex(/[A-Z]/).regex(/[0-9]/),
  role: z.enum(["SUPER_ADMIN", "ADMIN_AREA", "EDITOR", "REVISOR", "VISUALIZADOR"]),
  areaId: z.string().optional(),
  jobTitle: z.string().max(100).optional(),
  phone: z.string().max(20).optional(),
});

const updateUserSchema = createUserSchema.partial().omit({ password: true });

const listSchema = z.object({
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(100).default(20),
  areaId: z.string().optional(),
  role: z.string().optional(),
  isActive: z.coerce.boolean().optional(),
  search: z.string().optional(),
});

export async function userRoutes(app: FastifyInstance) {
  app.addHook("preHandler", authenticate);

  // ── GET /api/v1/users ────────────────────────────────
  app.get("/", { preHandler: [requireAdmin] }, async (request) => {
    const p = listSchema.parse(request.query);
    const skip = (p.page - 1) * p.limit;

    const where = {
      ...(p.areaId && { areaId: p.areaId }),
      ...(p.role && { role: p.role as Parameters<typeof prisma.user.findMany>[0]["where"]["role"] }),
      ...(p.isActive !== undefined && { isActive: p.isActive }),
      ...(p.search && {
        OR: [
          { name: { contains: p.search, mode: "insensitive" as const } },
          { email: { contains: p.search, mode: "insensitive" as const } },
        ],
      }),
    };

    const [users, total] = await prisma.$transaction([
      prisma.user.findMany({
        where,
        skip,
        take: p.limit,
        orderBy: { name: "asc" },
        select: {
          id: true, name: true, email: true, role: true,
          isActive: true, lastLogin: true, loginCount: true,
          jobTitle: true, phone: true, avatarUrl: true,
          area: { select: { id: true, name: true } },
          createdAt: true,
        },
      }),
      prisma.user.count({ where }),
    ]);

    return { data: users, pagination: { page: p.page, limit: p.limit, total, pages: Math.ceil(total / p.limit) } };
  });

  // ── GET /api/v1/users/:id ────────────────────────────
  app.get<{ Params: { id: string } }>("/:id", { preHandler: [requireAdmin] }, async (request, reply) => {
    const user = await prisma.user.findUnique({
      where: { id: request.params.id },
      select: {
        id: true, name: true, email: true, role: true,
        isActive: true, lastLogin: true, loginCount: true,
        jobTitle: true, phone: true, avatarUrl: true, areaId: true,
        area: { select: { id: true, name: true } },
        createdAt: true, passwordChangedAt: true,
      },
    });

    if (!user) return reply.status(404).send({ statusCode: 404, error: "Not Found", message: "Usuario no encontrado" });
    return user;
  });

  // ── POST /api/v1/users ───────────────────────────────
  app.post("/", { preHandler: [requireAdmin] }, async (request, reply) => {
    const data = createUserSchema.parse(request.body);

    const exists = await prisma.user.findUnique({ where: { email: data.email.toLowerCase() } });
    if (exists) {
      return reply.status(409).send({ statusCode: 409, error: "Conflict", message: "El email ya está registrado" });
    }

    const { password: _pw, ...rest } = data;
    const passwordHash = await bcrypt.hash(_pw, parseInt(process.env.BCRYPT_ROUNDS || "12"));

    const user = await prisma.user.create({
      data: {
        ...rest,
        email: rest.email.toLowerCase(),
        passwordHash,
        passwordChangedAt: new Date(),
      },
      select: { id: true, name: true, email: true, role: true, areaId: true, createdAt: true },
    });

    await createAuditLog({ userId: request.user.id, action: "USER_CREATED", entityType: "User", entityId: user.id, request });
    return reply.status(201).send(user);
  });

  // ── POST /api/v1/users/import — CSV masivo ───────────
  app.post("/import", { preHandler: [requireAdmin] }, async (request, reply) => {
    const BCRYPT_ROUNDS = parseInt(process.env.BCRYPT_ROUNDS || "12");
    const VALID_ROLES = ["SUPER_ADMIN", "ADMIN_AREA", "EDITOR", "REVISOR", "VISUALIZADOR"];

    // Generar contraseña segura: mayúscula + minúsculas + dígitos + símbolo
    function generatePassword(): string {
      const upper = "ABCDEFGHJKLMNPQRSTUVWXYZ";
      const lower = "abcdefghjkmnpqrstuvwxyz";
      const digits = "23456789";
      const symbols = "!@#$%&*";
      const rand = (s: string) => s[Math.floor(Math.random() * s.length)];
      const base = [rand(upper), rand(upper), rand(lower), rand(lower), rand(lower),
                    rand(digits), rand(digits), rand(symbols)];
      // Mezclar aleatoriamente
      for (let i = base.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [base[i], base[j]] = [base[j], base[i]];
      }
      return base.join("");
    }

    // Leer todas las partes del multipart (archivo + campos)
    let csvBuffer: Buffer | null = null;
    let defaultRole = "VISUALIZADOR";
    let defaultAreaId: string | undefined;

    const parts = request.parts();
    for await (const part of parts) {
      if (part.type === "file" && part.fieldname === "file") {
        csvBuffer = await part.toBuffer();
      } else if (part.type === "field") {
        if (part.fieldname === "defaultRole") defaultRole = String(part.value);
        if (part.fieldname === "defaultAreaId") defaultAreaId = String(part.value) || undefined;
      }
    }

    if (!csvBuffer) {
      return reply.status(400).send({ statusCode: 400, error: "Bad Request", message: "No se recibió archivo CSV" });
    }

    if (!VALID_ROLES.includes(defaultRole)) defaultRole = "VISUALIZADOR";

    const lines = csvBuffer.toString("utf-8").split("\n").slice(1); // omitir header
    const results = {
      created: 0,
      skipped: 0,
      errors: [] as string[],
      users: [] as { name: string; email: string; role: string; area: string; password: string }[],
    };

    // Pre-cargar áreas por código para evitar N queries
    const allAreas = await prisma.area.findMany({ select: { id: true, code: true, name: true } });
    const areaByCode = new Map(allAreas.map((a) => [a.code.toUpperCase(), a]));
    const areaById = new Map(allAreas.map((a) => [a.id, a]));

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line) continue;

      // Soporte CSV con o sin comillas
      const cols = line.split(",").map((v) => v.trim().replace(/^"|"$/g, ""));
      const [name, email, roleCol, areaCol] = cols;

      if (!name || !email) {
        results.errors.push(`Fila ignorada — nombre o correo vacío: "${line}"`);
        continue;
      }

      // Rol: columna CSV > default seleccionado
      const role = (roleCol && VALID_ROLES.includes(roleCol.toUpperCase())
        ? roleCol.toUpperCase()
        : defaultRole) as Parameters<typeof prisma.user.create>[0]["data"]["role"];

      // Área: columna CSV (por código) > default seleccionado > null
      let areaId: string | undefined = defaultAreaId;
      let areaName = areaId ? (areaById.get(areaId)?.name ?? "—") : "—";
      if (areaCol) {
        const foundArea = areaByCode.get(areaCol.toUpperCase());
        if (foundArea) { areaId = foundArea.id; areaName = foundArea.name; }
      }

      try {
        const exists = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
        if (exists) { results.skipped++; continue; }

        const password = generatePassword();
        await prisma.user.create({
          data: {
            name,
            email: email.toLowerCase(),
            role,
            areaId,
            passwordHash: await bcrypt.hash(password, BCRYPT_ROUNDS),
            passwordChangedAt: new Date(),
          },
        });

        results.created++;
        results.users.push({ name, email: email.toLowerCase(), role, area: areaName, password });
      } catch (e) {
        results.errors.push(`"${name}" <${email}>: ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    await createAuditLog({
      userId: request.user.id,
      action: "USER_CREATED",
      metadata: { import: { created: results.created, skipped: results.skipped } },
      request,
    });
    return reply.send(results);
  });

  // ── PATCH /api/v1/users/:id ──────────────────────────
  app.patch<{ Params: { id: string } }>("/:id", { preHandler: [requireAdmin] }, async (request, reply) => {
    const data = updateUserSchema.parse(request.body);

    const user = await prisma.user.update({
      where: { id: request.params.id },
      data,
      select: { id: true, name: true, email: true, role: true, isActive: true },
    });

    await cache.del(CacheKeys.user(request.params.id));
    await createAuditLog({ userId: request.user.id, action: "USER_UPDATED", entityType: "User", entityId: user.id, request });
    return user;
  });

  // ── PATCH /api/v1/users/:id/deactivate ───────────────
  app.patch<{ Params: { id: string } }>("/:id/deactivate", { preHandler: [requireAdmin] }, async (request, reply) => {
    if (request.params.id === request.user.id) {
      return reply.status(400).send({ statusCode: 400, error: "Bad Request", message: "No puedes desactivar tu propia cuenta" });
    }

    await prisma.user.update({ where: { id: request.params.id }, data: { isActive: false } });
    await cache.del(CacheKeys.user(request.params.id));
    await createAuditLog({ userId: request.user.id, action: "USER_DEACTIVATED", entityType: "User", entityId: request.params.id, request });
    return reply.status(204).send();
  });

  // ── GET /api/v1/users/me/favorites ───────────────────
  app.get("/me/favorites", async (request) => {
    return prisma.userFavorite.findMany({
      where: { userId: request.user.id },
      include: {
        document: {
          select: {
            id: true, title: true, code: true, type: true, status: true,
            updatedAt: true, area: { select: { name: true } },
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });
  });

  // ── GET /api/v1/users/me/recent ───────────────────────
  app.get("/me/recent", async (request) => {
    return prisma.userRecentDocument.findMany({
      where: { userId: request.user.id },
      include: {
        document: {
          select: {
            id: true, title: true, code: true, type: true, status: true,
            updatedAt: true, area: { select: { name: true } },
          },
        },
      },
      orderBy: { viewedAt: "desc" },
      take: 10,
    });
  });
}
