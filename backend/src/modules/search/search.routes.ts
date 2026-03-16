import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../../plugins/prisma";
import { meiliSearch } from "../../plugins/meilisearch";
import { authenticate } from "../../middleware/auth.middleware";

const searchSchema = z.object({
  q: z.string().min(1).max(200),
  type: z.enum(["all", "documents", "videos"]).default("all"),
  areaId: z.string().optional(),
  status: z.string().optional(),
  docType: z.string().optional(),
  tags: z.string().optional(),
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(50).default(20),
});

export async function searchRoutes(app: FastifyInstance) {
  app.addHook("preHandler", authenticate);

  // ── GET /api/v1/search ───────────────────────────────
  app.get("/", async (request) => {
    const params = searchSchema.parse(request.query);
    const offset = (params.page - 1) * params.limit;
    const tags = params.tags ? params.tags.split(",") : undefined;

    const filters: Record<string, unknown> = {
      ...(params.areaId && { areaId: params.areaId }),
      ...(params.status && { status: params.status }),
      ...(params.docType && { type: params.docType }),
      ...(tags && { tags }),
    };

    const results: { documents?: unknown; videos?: unknown } = {};

    if (params.type === "all" || params.type === "documents") {
      results.documents = await meiliSearch.searchDocuments(params.q, filters, {
        limit: params.limit,
        offset,
      });
    }

    if (params.type === "all" || params.type === "videos") {
      const videosIndex = meiliSearch.client.index("videos");
      results.videos = await videosIndex.search(params.q, {
        limit: params.limit,
        offset,
        attributesToHighlight: ["title", "description", "transcript"],
        highlightPreTag: "<mark>",
        highlightPostTag: "</mark>",
      });
    }

    // Guardar en historial
    await prisma.searchHistory.create({
      data: {
        userId: request.user.id,
        query: params.q,
        results:
          ((results.documents as { estimatedTotalHits?: number })?.estimatedTotalHits || 0) +
          ((results.videos as { estimatedTotalHits?: number })?.estimatedTotalHits || 0),
      },
    });

    return results;
  });

  // ── GET /api/v1/search/history ───────────────────────
  app.get("/history", async (request) => {
    return prisma.searchHistory.findMany({
      where: { userId: request.user.id },
      orderBy: { createdAt: "desc" },
      take: 10,
      select: { id: true, query: true, results: true, createdAt: true },
    });
  });

  // ── DELETE /api/v1/search/history ────────────────────
  app.delete("/history", async (request, reply) => {
    await prisma.searchHistory.deleteMany({ where: { userId: request.user.id } });
    return reply.status(204).send();
  });

  // ── GET /api/v1/search/suggestions ──────────────────
  // Autocompletar con las primeras letras
  app.get("/suggestions", async (request) => {
    const { q } = request.query as { q: string };
    if (!q || q.length < 2) return [];

    const index = meiliSearch.client.index("documents");
    const result = await index.search(q, {
      limit: 5,
      attributesToRetrieve: ["title", "code"],
      attributesToHighlight: ["title"],
    });

    return result.hits.map((h: { title: string; code: string }) => ({ title: h.title, code: h.code }));
  });
}
