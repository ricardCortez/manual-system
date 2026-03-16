import { MeiliSearch } from "meilisearch";

const client = new MeiliSearch({
  host: process.env.MEILISEARCH_HOST || "http://localhost:7700",
  apiKey: process.env.MEILISEARCH_KEY,
});

// ──────────────────────────────────────────────────────
// Índices de MeiliSearch
// ──────────────────────────────────────────────────────

export const INDEXES = {
  DOCUMENTS: "documents",
  VIDEOS: "videos",
} as const;

export const meiliSearch = {
  client,

  async initIndexes() {
    // Índice de documentos
    await client.createIndex(INDEXES.DOCUMENTS, { primaryKey: "id" }).catch(() => null);
    const docsIndex = client.index(INDEXES.DOCUMENTS);

    await docsIndex.updateSettings({
      searchableAttributes: [
        "title",
        "description",
        "extractedText",
        "tags",
        "processName",
        "subProcess",
        "areaName",
        "authorName",
        "code",
      ],
      filterableAttributes: [
        "areaId",
        "status",
        "type",
        "confidentiality",
        "tags",
        "authorId",
        "effectiveDate",
        "expiryDate",
      ],
      sortableAttributes: ["createdAt", "updatedAt", "title", "viewCount"],
      displayedAttributes: [
        "id",
        "title",
        "description",
        "code",
        "type",
        "status",
        "confidentiality",
        "areaId",
        "areaName",
        "authorName",
        "tags",
        "processName",
        "thumbnailPath",
        "updatedAt",
        "_rankingScore",
      ],
      typoTolerance: { enabled: true, minWordSizeForTypos: { oneTypo: 4, twoTypos: 8 } },
      pagination: { maxTotalHits: 1000 },
    });

    // Índice de videos (incluye transcripciones)
    await client.createIndex(INDEXES.VIDEOS, { primaryKey: "id" }).catch(() => null);
    const videosIndex = client.index(INDEXES.VIDEOS);

    await videosIndex.updateSettings({
      searchableAttributes: [
        "title",
        "description",
        "transcript",
        "tags",
        "areaName",
        "authorName",
      ],
      filterableAttributes: ["areaId", "status", "tags", "level", "authorId"],
      sortableAttributes: ["createdAt", "duration", "title"],
    });
  },

  // ── Operaciones de documentos ────────────────────────

  async indexDocument(doc: {
    id: string;
    title: string;
    description?: string | null;
    code: string;
    type: string;
    status: string;
    confidentiality: string;
    areaId: string;
    areaName: string;
    authorId: string;
    authorName: string;
    tags: string[];
    processName?: string | null;
    subProcess?: string | null;
    thumbnailPath?: string | null;
    extractedText?: string | null;
    updatedAt: Date;
  }) {
    const index = client.index(INDEXES.DOCUMENTS);
    await index.addDocuments([
      {
        ...doc,
        extractedText: doc.extractedText?.slice(0, 50000), // Limitar tamaño
        updatedAt: doc.updatedAt.toISOString(),
      },
    ]);
  },

  async deleteDocument(id: string) {
    const index = client.index(INDEXES.DOCUMENTS);
    await index.deleteDocument(id);
  },

  async searchDocuments(query: string, filters: Record<string, unknown> = {}, options = {}) {
    const index = client.index(INDEXES.DOCUMENTS);

    const filterParts: string[] = [];
    if (filters.areaId) filterParts.push(`areaId = "${filters.areaId}"`);
    if (filters.status) filterParts.push(`status = "${filters.status}"`);
    if (filters.type) filterParts.push(`type = "${filters.type}"`);
    if (filters.confidentiality) filterParts.push(`confidentiality = "${filters.confidentiality}"`);
    if (filters.tags && Array.isArray(filters.tags) && filters.tags.length > 0) {
      filterParts.push(`tags IN [${filters.tags.map((t) => `"${t}"`).join(", ")}]`);
    }

    return index.search(query, {
      limit: 20,
      offset: 0,
      attributesToHighlight: ["title", "description", "extractedText"],
      highlightPreTag: "<mark>",
      highlightPostTag: "</mark>",
      showRankingScore: true,
      filter: filterParts.length > 0 ? filterParts.join(" AND ") : undefined,
      ...options,
    });
  },

  // ── Video / transcripciones ──────────────────────────

  async indexVideo(video: {
    id: string;
    title: string;
    description?: string | null;
    areaId: string;
    areaName: string;
    authorId: string;
    authorName: string;
    tags: string[];
    transcript?: string;
    status: string;
    level?: string;
    createdAt: Date;
    duration?: number | null;
  }) {
    const index = client.index(INDEXES.VIDEOS);
    await index.addDocuments([
      {
        ...video,
        createdAt: video.createdAt.toISOString(),
      },
    ]);
  },
};
