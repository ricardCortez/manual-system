# ═══════════════════════════════════════════
# Frontend Dockerfile — React + Vite
# ═══════════════════════════════════════════

FROM node:20-alpine AS base
WORKDIR /app

# ── Development ────────────────────────────
FROM base AS development
COPY package*.json ./
RUN npm install
COPY . .
EXPOSE 5173
CMD ["npm", "run", "dev"]

# ── Builder ────────────────────────────────
FROM base AS builder
COPY package*.json ./
RUN npm install
COPY . .
ARG VITE_API_URL=https://manuals.empresa.local
ENV VITE_API_URL=${VITE_API_URL}
RUN npm run build

# ── Production (Nginx sirve los estáticos) ─
FROM nginx:1.25-alpine AS production
COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
