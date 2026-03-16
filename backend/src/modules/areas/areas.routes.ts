import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../../plugins/prisma";
import { authenticate, requireAdmin } from "../../middleware/auth.middleware";
import { createAuditLog } from "../../middleware/audit.middleware";

const areaSchema = z.object({
  name: z.string().min(2).max(100),
  code: z.string().min(2).max(20).toUpperCase(),
  description: z.string().max(500).optional(),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
  parentId: z.string().optional(),
  managerId: z.string().optional(),
});

export async function areaRoutes(app: FastifyInstance) {
  app.addHook("preHandler", authenticate);

  // ── GET /api/v1/areas — árbol completo ───────────────
  app.get("/", async () => {
    const areas = await prisma.area.findMany({
      where: { isActive: true },
      include: {
        manager: { select: { id: true, name: true } },
        _count: { select: { users: true, documents: true } },
      },
      orderBy: { name: "asc" },
    });

    // Construir árbol jerárquico
    const buildTree = (parentId: string | null): typeof areas => {
      return areas
        .filter((a) => a.parentId === parentId)
        .map((a) => ({ ...a, children: buildTree(a.id) }));
    };

    return buildTree(null);
  });

  // ── GET /api/v1/areas/flat — lista plana ─────────────
  app.get("/flat", async () => {
    return prisma.area.findMany({
      where: { isActive: true },
      select: { id: true, name: true, code: true, color: true, parentId: true },
      orderBy: { name: "asc" },
    });
  });

  // ── GET /api/v1/areas/:id ────────────────────────────
  app.get<{ Params: { id: string } }>("/:id", async (request, reply) => {
    const area = await prisma.area.findUnique({
      where: { id: request.params.id },
      include: {
        manager: { select: { id: true, name: true } },
        parent: { select: { id: true, name: true } },
        children: { select: { id: true, name: true, code: true } },
        _count: { select: { users: true, documents: true } },
      },
    });

    if (!area) return reply.status(404).send({ statusCode: 404, error: "Not Found", message: "Área no encontrada" });
    return area;
  });

  // ── POST /api/v1/areas ───────────────────────────────
  app.post("/", { preHandler: [requireAdmin] }, async (request, reply) => {
    const data = areaSchema.parse(request.body);

    const exists = await prisma.area.findUnique({ where: { code: data.code } });
    if (exists) {
      return reply.status(409).send({ statusCode: 409, error: "Conflict", message: `Código de área "${data.code}" ya existe` });
    }

    const area = await prisma.area.create({ data });
    await createAuditLog({ userId: request.user.id, action: "AREA_CREATED", entityType: "Area", entityId: area.id, request });
    return reply.status(201).send(area);
  });

  // ── PATCH /api/v1/areas/:id ──────────────────────────
  app.patch<{ Params: { id: string } }>("/:id", { preHandler: [requireAdmin] }, async (request, reply) => {
    const data = areaSchema.partial().parse(request.body);
    const area = await prisma.area.update({ where: { id: request.params.id }, data });
    return area;
  });

  // ── DELETE /api/v1/areas/:id (soft) ──────────────────
  app.delete<{ Params: { id: string } }>("/:id", { preHandler: [requireAdmin] }, async (request, reply) => {
    const hasDocuments = await prisma.document.count({ where: { areaId: request.params.id, isDeleted: false } });
    if (hasDocuments > 0) {
      return reply.status(409).send({
        statusCode: 409,
        error: "Conflict",
        message: `El área tiene ${hasDocuments} documentos activos. Reasígnalos antes de eliminarla.`,
      });
    }

    await prisma.area.update({ where: { id: request.params.id }, data: { isActive: false } });
    return reply.status(204).send();
  });
}
