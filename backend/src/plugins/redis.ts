import IORedis from "ioredis";

export const redis = new IORedis(process.env.REDIS_URL || "redis://localhost:6379", {
  maxRetriesPerRequest: null, // Requerido por BullMQ
  enableReadyCheck: false,
  lazyConnect: true,
});

redis.on("error", (err) => {
  console.error("[Redis] Error de conexión:", err.message);
});

redis.on("connect", () => {
  console.log("[Redis] Conectado");
});

// Helper para caché genérico
export const cache = {
  async get<T>(key: string): Promise<T | null> {
    const value = await redis.get(key);
    return value ? (JSON.parse(value) as T) : null;
  },

  async set(key: string, value: unknown, ttlSeconds?: number): Promise<void> {
    const serialized = JSON.stringify(value);
    if (ttlSeconds) {
      await redis.setex(key, ttlSeconds, serialized);
    } else {
      await redis.set(key, serialized);
    }
  },

  async del(...keys: string[]): Promise<void> {
    await redis.del(...keys);
  },

  async invalidatePattern(pattern: string): Promise<void> {
    const keys = await redis.keys(pattern);
    if (keys.length > 0) {
      await redis.del(...keys);
    }
  },
};

// Prefijos de caché estandarizados
export const CacheKeys = {
  user: (id: string) => `user:${id}`,
  userPermissions: (id: string) => `permissions:${id}`,
  document: (id: string) => `doc:${id}`,
  documentList: (areaId: string, page: number) => `docs:${areaId}:${page}`,
  aiUsage: (userId: string, date: string) => `ai:usage:${userId}:${date}`,
  notifications: (userId: string) => `notifs:${userId}`,
} as const;
