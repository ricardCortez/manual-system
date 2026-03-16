#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════
# MANUAL SYSTEM — Script de instalación automática
# Servidor: Ubuntu Server 22.04 LTS
# Uso: bash install.sh
# ═══════════════════════════════════════════════════════════════
set -euo pipefail

BLUE='\033[0;34m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
RED='\033[0;31m'; NC='\033[0m'

info()  { echo -e "${BLUE}[INFO]${NC}  $*"; }
ok()    { echo -e "${GREEN}[OK]${NC}    $*"; }
warn()  { echo -e "${YELLOW}[WARN]${NC}  $*"; }
error() { echo -e "${RED}[ERROR]${NC} $*"; exit 1; }

echo ""
echo "═══════════════════════════════════════════════════════"
echo "       MANUAL SYSTEM — Instalación automatizada"
echo "═══════════════════════════════════════════════════════"
echo ""

# ── 1. Verificar prerrequisitos ─────────────────────────
info "Verificando prerrequisitos..."

[[ "$(uname)" == "Linux" ]] || error "Este script requiere Linux (Ubuntu 22.04)"
[[ "$(id -u)" -eq 0 ]]     || error "Ejecuta como root: sudo bash install.sh"

# ── 2. Instalar dependencias del sistema ────────────────
info "Instalando dependencias del sistema..."

apt-get update -qq
apt-get install -y -qq \
    curl wget git ca-certificates gnupg lsb-release \
    openssl libnss3-tools mkcert \
    ffmpeg libavcodec-extra \
    libreoffice-headless libreoffice-calc libreoffice-impress \
    poppler-utils imagemagick \
    build-essential python3

ok "Dependencias instaladas"

# ── 3. Instalar Docker ──────────────────────────────────
if ! command -v docker &>/dev/null; then
    info "Instalando Docker..."
    curl -fsSL https://get.docker.com | sh
    systemctl enable --now docker
    ok "Docker instalado"
else
    ok "Docker ya está instalado ($(docker --version | cut -d' ' -f3 | tr -d ','))"
fi

# ── 4. Instalar Docker Compose v2 ───────────────────────
if ! docker compose version &>/dev/null; then
    info "Instalando Docker Compose v2..."
    apt-get install -y docker-compose-plugin
    ok "Docker Compose instalado"
else
    ok "Docker Compose ya está disponible"
fi

# ── 5. Instalar Node.js 20 LTS ──────────────────────────
if ! command -v node &>/dev/null || [[ "$(node -v | cut -d'.' -f1 | tr -d 'v')" -lt 20 ]]; then
    info "Instalando Node.js 20 LTS..."
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
    apt-get install -y nodejs
    ok "Node.js $(node -v) instalado"
else
    ok "Node.js $(node -v) ya está instalado"
fi

# ── 6. Configurar .env ─────────────────────────────────
if [[ ! -f .env ]]; then
    info "Configurando variables de entorno..."
    cp .env.example .env

    # Generar contraseñas seguras automáticamente
    POSTGRES_PASS=$(openssl rand -base64 24 | tr -dc 'a-zA-Z0-9' | head -c 32)
    REDIS_PASS=$(openssl rand -base64 24 | tr -dc 'a-zA-Z0-9' | head -c 24)
    MEILI_KEY=$(openssl rand -base64 32 | tr -dc 'a-zA-Z0-9' | head -c 40)

    sed -i "s/CHANGE_ME_strong_password_2025/${POSTGRES_PASS}/g" .env
    sed -i "s/CHANGE_ME_redis_password/${REDIS_PASS}/g" .env
    sed -i "s/CHANGE_ME_meili_master_key_32chars_minimum/${MEILI_KEY}/g" .env

    ok ".env configurado con contraseñas generadas automáticamente"
    warn "Revisa y ajusta .env antes de continuar en producción"
fi

if [[ ! -f backend/.env ]]; then
    cp backend/.env.example backend/.env
    # Propagar variables al backend
    source .env
    sed -i "s/CHANGE_ME@localhost:5432/${POSTGRES_USER:-manuals_user}:${POSTGRES_PASSWORD}@postgres:5432/g" backend/.env
    sed -i "s/:CHANGE_ME@localhost:6379/:${REDIS_PASSWORD}@redis:6379/g" backend/.env
    sed -i "s/CHANGE_ME_meili_master_key/${MEILISEARCH_MASTER_KEY}/g" backend/.env
fi

if [[ ! -f frontend/.env ]]; then
    cp frontend/.env.example frontend/.env
fi

# ── 7. Generar certificados SSL con mkcert ──────────────
info "Generando certificados SSL internos..."

mkdir -p nginx/ssl

if ! command -v mkcert &>/dev/null; then
    # Instalar mkcert manualmente
    MKCERT_VERSION="v1.4.4"
    curl -Lo /usr/local/bin/mkcert \
        "https://github.com/FiloSottile/mkcert/releases/download/${MKCERT_VERSION}/mkcert-${MKCERT_VERSION}-linux-amd64"
    chmod +x /usr/local/bin/mkcert
fi

mkcert -install 2>/dev/null || true

DOMAIN="manuals.empresa.local"
mkcert -cert-file nginx/ssl/cert.pem -key-file nginx/ssl/key.pem \
    "${DOMAIN}" "*.${DOMAIN}" localhost 127.0.0.1 ::1 2>/dev/null

ok "Certificados SSL generados para ${DOMAIN}"

# ── 8. Configurar /etc/hosts ────────────────────────────
DOMAIN="manuals.empresa.local"
if ! grep -q "${DOMAIN}" /etc/hosts; then
    echo "127.0.0.1  ${DOMAIN}" >> /etc/hosts
    ok "Dominio ${DOMAIN} añadido a /etc/hosts"
    warn "En otros equipos de la red, apuntar DNS o /etc/hosts al IP del servidor"
fi

# ── 9. Generar llaves JWT RS256 ─────────────────────────
if [[ ! -f backend/keys/private.pem ]]; then
    info "Generando par de llaves JWT RS256..."
    mkdir -p backend/keys
    openssl genrsa -out backend/keys/private.pem 2048
    openssl rsa -in backend/keys/private.pem -pubout -out backend/keys/public.pem
    chmod 600 backend/keys/private.pem
    ok "Llaves JWT generadas"
fi

# ── 10. Construir e iniciar servicios ───────────────────
info "Iniciando contenedores Docker..."

docker compose pull --quiet
docker compose build --quiet

info "Levantando servicios base..."
docker compose up -d postgres redis meilisearch

info "Esperando que PostgreSQL esté listo..."
for i in {1..30}; do
    if docker compose exec -T postgres pg_isready -U manuals_user -d manuals_db &>/dev/null; then
        ok "PostgreSQL listo"
        break
    fi
    sleep 2
    [[ $i -eq 30 ]] && error "PostgreSQL no responde después de 60 segundos"
done

# ── 11. Ejecutar migraciones y seed ─────────────────────
info "Ejecutando migraciones de base de datos..."
docker compose run --rm backend sh -c "npx prisma migrate deploy && npm run db:seed"
ok "Migraciones y seed completados"

# ── 12. Iniciar todos los servicios ─────────────────────
info "Iniciando todos los servicios..."
docker compose up -d

ok "Todos los servicios iniciados"

# ── 13. Verificar health checks ─────────────────────────
info "Verificando estado de los servicios..."
sleep 10

check_service() {
    local name=$1 url=$2
    if curl -sf --max-time 5 "${url}" &>/dev/null; then
        ok "${name} funcionando"
    else
        warn "${name} no responde en ${url} (puede necesitar más tiempo)"
    fi
}

check_service "Backend API"    "http://localhost:3001/health"
check_service "MeiliSearch"    "http://localhost:7700/health"
check_service "Frontend"       "http://localhost:5173"

# ── 14. Indexar documentos en MeiliSearch ───────────────
info "Inicializando índices de búsqueda..."
docker compose exec -T backend npm run search:index 2>/dev/null || warn "Índices serán creados al primer uso"

# ── Resumen final ────────────────────────────────────────
echo ""
echo "═══════════════════════════════════════════════════════"
echo -e "${GREEN}  ✓ Instalación completada exitosamente${NC}"
echo "═══════════════════════════════════════════════════════"
echo ""
echo "  🌐  Sistema:    https://manuals.empresa.local"
echo "  📚  API Docs:   https://manuals.empresa.local/api/docs"
echo "  🔧  Bull Board: https://manuals.empresa.local/admin/queues"
echo ""
echo "  Usuarios iniciales:"
echo "  → admin@empresa.local / Admin123! (SUPER_ADMIN)"
echo "  → soporte@empresa.local / Soporte123! (ADMIN_AREA)"
echo ""
echo -e "  ${YELLOW}⚠️  Cambia las contraseñas de los usuarios en producción${NC}"
echo ""
echo "  Para IA local (Ollama), ejecuta:"
echo "  docker compose --profile ai-local up -d ollama"
echo "  docker exec -it manuals_ollama ollama pull llama3.1:8b"
echo ""
echo "  Documentación completa: README.md"
echo "═══════════════════════════════════════════════════════"
