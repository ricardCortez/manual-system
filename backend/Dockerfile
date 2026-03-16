# ═══════════════════════════════════════════
# Backend Dockerfile — Node.js 20 LTS
# ═══════════════════════════════════════════

# ── Stage 1: Base con dependencias del sistema ──
FROM node:20-alpine AS base

RUN apk add --no-cache \
    ffmpeg \
    libreoffice \
    poppler-utils \
    imagemagick \
    python3 \
    && rm -rf /var/cache/apk/*

WORKDIR /app

# ── Stage 2: Dependencias npm ──────────────────
FROM base AS deps

COPY package*.json ./
RUN npm install

# ── Stage 3: Development ───────────────────────
FROM base AS development

WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Generar cliente Prisma
RUN npx prisma generate

EXPOSE 3001

CMD ["npm", "run", "dev"]

# ── Stage 4: Builder ───────────────────────────
FROM base AS builder

WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

RUN npx prisma generate
RUN npm run build

# ── Stage 5: Production ────────────────────────
FROM base AS production

ENV NODE_ENV=production
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/prisma ./prisma
COPY package*.json ./

# Solo dependencias de producción
RUN npm prune --production

# Crear directorios de uploads
RUN mkdir -p uploads/documents uploads/videos/originals uploads/videos/hls \
    uploads/videos/thumbnails uploads/temp keys

# Usuario no-root
RUN addgroup -S appgroup && adduser -S appuser -G appgroup \
    && chown -R appuser:appgroup /app

USER appuser

EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=10s --retries=3 \
    CMD wget -qO- http://localhost:3001/health || exit 1

CMD ["node", "dist/app.js"]
