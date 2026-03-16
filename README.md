# Manual System — Sistema de Gestión de Manuales de Procesos Internos

Sistema web empresarial completo para gestión, visualización y control de manuales de procesos internos, diseñado para despliegue en red local (intranet) con soporte para hasta 80 usuarios concurrentes.

---

## Tabla de Contenidos

- [Características](#características)
- [Arquitectura](#arquitectura)
- [Stack Tecnológico](#stack-tecnológico)
- [Estructura del Proyecto](#estructura-del-proyecto)
- [Requisitos Previos](#requisitos-previos)
- [Instalación Rápida](#instalación-rápida)
- [Instalación Manual](#instalación-manual)
- [Configuración](#configuración)
- [Usuarios por Defecto](#usuarios-por-defecto)
- [Roles y Permisos](#roles-y-permisos)
- [API Reference](#api-reference)
- [Despliegue en Producción](#despliegue-en-producción)
- [Administración](#administración)
- [Seguridad](#seguridad)

---

## Características

### Gestión Documental
- **4 tipos de documento**: solo-documento, solo-video, documento+video, multimedia
- **Formatos soportados**: PDF, DOCX, XLSX, PPTX, Markdown, imágenes (PNG, JPG, WEBP), videos (MP4, MKV, AVI, MOV)
- **Control de versiones** con numeración semántica (X.Y.Z)
- **Flujo de aprobación** configurable por área (borrador → revisión → aprobado → publicado → obsoleto)
- **Niveles de confidencialidad**: Público, Restringido, Crítico
- **Conversión automática** DOCX → PDF mediante LibreOffice
- **Generación de miniaturas** de documentos y videos

### Streaming de Video
- Procesamiento asíncrono en cola (BullMQ)
- **Streaming adaptativo HLS** con múltiples calidades (360p, 720p, 1080p)
- Extracción de capítulos para navegación interna
- Transcripción automática con Whisper
- Reproducción con Video.js

### Inteligencia Artificial
- **3 proveedores**: Ollama (local/offline), OpenAI, Anthropic Claude
- **Resumenes automáticos** en 5 estilos: ejecutivo, bullets, breve, glosario, comparativo
- **Chat RAG** con contexto del documento (preguntas y respuestas)
- Límites de uso diario por usuario configurables
- Embeddings vectoriales para búsqueda semántica

### Búsqueda
- Motor de búsqueda **MeiliSearch** con búsqueda de texto completo
- Historial de búsquedas por usuario
- Autocompletado y sugerencias
- Indexación automática al publicar documentos

### Notificaciones en Tiempo Real
- Notificaciones **WebSocket** (Socket.io) sin necesidad de refrescar
- Eventos: nuevo documento publicado, documento favorito actualizado, asignación de revisión, expiración próxima
- Configuración de preferencias por usuario

### Administración
- Panel de estadísticas del sistema
- Monitoreo visual de colas de trabajos (Bull Board)
- Gestión de usuarios y áreas organizativas
- Logs de auditoría inmutables
- Configuración del sistema en caliente
- Gestión de backups

---

## Arquitectura

```
┌─────────────────────────────────────────────────────┐
│                   Nginx (Reverse Proxy)              │
│              HTTP :80  →  HTTPS :443                 │
└──────────┬──────────────────────┬───────────────────┘
           │                      │
    ┌──────▼──────┐        ┌──────▼──────┐
    │  Frontend   │        │   Backend   │
    │  React/Vite │        │  Fastify API│
    │  (estático) │        │    :3001    │
    └─────────────┘        └──────┬──────┘
                                  │
              ┌───────────────────┼───────────────────┐
              │                   │                   │
       ┌──────▼──────┐   ┌───────▼───────┐  ┌───────▼───────┐
       │ PostgreSQL  │   │     Redis     │  │  MeiliSearch  │
       │    :5432    │   │    :6379      │  │    :7700      │
       └─────────────┘   └───────────────┘  └───────────────┘
                                  │
                         ┌────────▼────────┐
                         │  Ollama (opt.)  │
                         │    :11434       │
                         └─────────────────┘
```

**Flujo de procesamiento de video:**
```
Upload → Validación → Encoding (360p/720p/1080p) → HLS → Thumbnails → Transcripción → Indexación
```

---

## Stack Tecnológico

| Capa | Tecnología | Versión |
|------|-----------|---------|
| **Runtime** | Node.js | 20 LTS |
| **API Framework** | Fastify | 4.28.x |
| **ORM / DB** | Prisma + PostgreSQL | 5.16 / 16 |
| **Cache / Queues** | Redis + BullMQ | 7 / 5.12 |
| **Búsqueda** | MeiliSearch | 1.7 |
| **WebSocket** | Socket.io | 4.7.x |
| **Autenticación** | JWT RS256 | — |
| **Frontend** | React + Vite | 18.3 / 5.3 |
| **Estado** | Zustand | 4.5 |
| **Data Fetching** | TanStack Query | 5.51 |
| **Estilos** | Tailwind CSS | 4.0 |
| **Editor de texto** | TipTap | 2.5 |
| **Video Player** | Video.js | 8.14 |
| **PDF Viewer** | react-pdf | 9.0 |
| **Video Processing** | FFmpeg + Fluent-FFmpeg | — |
| **Doc Conversion** | LibreOffice | — |
| **Contenedores** | Docker + Compose v2 | — |
| **Proxy** | Nginx | 1.25 |

---

## Estructura del Proyecto

```
manual-system/
├── backend/
│   ├── src/
│   │   ├── app.ts                    # Entrada principal de la API
│   │   ├── modules/
│   │   │   ├── auth/                 # JWT, login, refresh tokens
│   │   │   ├── users/                # Gestión de usuarios (RBAC)
│   │   │   ├── areas/                # Jerarquía organizativa
│   │   │   ├── documents/            # Documentos y versiones
│   │   │   ├── videos/               # Upload, HLS, transcripción
│   │   │   ├── ai/                   # Resúmenes y chat RAG
│   │   │   ├── search/               # MeiliSearch
│   │   │   ├── notifications/        # Notificaciones en tiempo real
│   │   │   └── admin/                # Panel de administración
│   │   ├── jobs/
│   │   │   ├── video.processor.job.ts
│   │   │   ├── ai.summary.job.ts
│   │   │   └── notifications.job.ts
│   │   ├── middleware/
│   │   │   ├── auth.middleware.ts
│   │   │   └── audit.middleware.ts
│   │   └── plugins/                  # prisma, redis, meilisearch, socket
│   ├── prisma/
│   │   ├── schema.prisma             # Esquema de base de datos (24 tablas)
│   │   ├── seed.ts                   # Datos iniciales
│   │   └── migrations/
│   └── uploads/                      # Almacenamiento de archivos
│       ├── documents/
│       ├── videos/hls/               # Segmentos HLS
│       └── temp/
│
├── frontend/
│   └── src/
│       ├── pages/                    # LoginPage, Dashboard, Documentos, etc.
│       ├── components/               # UI reutilizable, viewers, AI
│       ├── stores/                   # Zustand (auth, UI)
│       └── lib/                      # api.ts, socket.ts
│
├── ai-service/
│   ├── prompts/                      # Plantillas de prompts (RAG, summary)
│   └── ollama/docker-compose.ollama.yml
│
├── nginx/
│   ├── nginx.conf
│   └── ssl/                          # cert.pem + key.pem
│
├── docker-compose.yml                # Stack de desarrollo
├── docker-compose.prod.yml           # Overrides de producción
├── install.sh                        # Script de instalación automática
└── .env.example                      # Plantilla de variables de entorno
```

---

## Requisitos Previos

- **Sistema Operativo**: Ubuntu 22.04 LTS (recomendado para producción)
- **RAM**: mínimo 8 GB (recomendado 16 GB con Ollama)
- **Disco**: mínimo 50 GB (videos consumen espacio significativo)
- **CPU**: 4 cores mínimo (8 recomendados para encoding de video)
- **Acceso root** o sudo
- **Docker Engine** 24+ y **Docker Compose** v2 (se instalan automáticamente con `install.sh`)

> Para desarrollo en Windows/macOS se requiere Docker Desktop.

---

## Instalación Rápida

```bash
# Clonar el repositorio
git clone https://github.com/ricardCortez/manual-system.git
cd manual-system

# Dar permisos al script y ejecutar (Ubuntu/Debian)
chmod +x install.sh
sudo ./install.sh
```

El script automatiza:
1. Instalación de dependencias del sistema (FFmpeg, LibreOffice, ImageMagick, etc.)
2. Instalación de Docker y Docker Compose v2
3. Instalación de Node.js 20 LTS
4. Generación de `.env` con contraseñas seguras aleatorias
5. Configuración de certificados SSL (mkcert)
6. Configuración del dominio en `/etc/hosts`
7. Generación de claves JWT (RS256)
8. Build e inicio de contenedores
9. Migraciones y seed de base de datos
10. Inicialización de índices en MeiliSearch
11. Verificación de salud del sistema

Al finalizar, el sistema estará disponible en: **`https://manuals.empresa.local`**

---

## Instalación Manual

### 1. Copiar variables de entorno

```bash
cp .env.example .env
# Editar .env con tus valores
```

### 2. Generar claves JWT

```bash
cd backend
npm install
npm run keys:generate
```

### 3. Iniciar servicios con Docker

```bash
# Desarrollo
docker-compose up -d

# Producción
docker-compose -f docker-compose.yml -f docker-compose.prod.yml up -d
```

### 4. Migraciones y datos iniciales

```bash
cd backend
npm run db:migrate
npm run db:seed
```

### 5. Inicializar índices de búsqueda

```bash
npm run search:index
```

---

## Configuración

### Variables de Entorno Principales

**`backend/.env`**

```env
# Base de datos
DATABASE_URL="postgresql://user:password@localhost:5432/manuals_db"

# Redis
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=your_redis_password

# JWT (rutas a las claves generadas con keys:generate)
JWT_PRIVATE_KEY_PATH=./keys/private.key
JWT_PUBLIC_KEY_PATH=./keys/public.key
JWT_ACCESS_EXPIRES_IN=15m
JWT_REFRESH_EXPIRES_IN=7d

# MeiliSearch
MEILISEARCH_HOST=http://localhost:7700
MEILISEARCH_MASTER_KEY=your_meilisearch_key

# Modo IA: LOCAL | EXTERNAL | HYBRID
AI_MODE=LOCAL

# Ollama (modo LOCAL)
OLLAMA_BASE_URL=http://ollama:11434
OLLAMA_CHAT_MODEL=llama3.2
OLLAMA_EMBED_MODEL=nomic-embed-text

# OpenAI (modo EXTERNAL)
OPENAI_API_KEY=sk-...
OPENAI_MODEL=gpt-4o-mini

# Anthropic (modo EXTERNAL)
ANTHROPIC_API_KEY=sk-ant-...
ANTHROPIC_MODEL=claude-haiku-4-5

# Límites IA por usuario/día
AI_SUMMARY_DAILY_LIMIT=20
AI_CHAT_DAILY_LIMIT=50

# Tamaños máximos de subida
MAX_VIDEO_SIZE_MB=2048
MAX_DOCUMENT_SIZE_MB=500
```

**`frontend/.env`**

```env
VITE_API_URL=https://manuals.empresa.local/api/v1
```

---

## Usuarios por Defecto

| Email | Contraseña | Rol |
|-------|-----------|-----|
| `admin@empresa.local` | `Admin123!` | SUPER_ADMIN |
| `soporte@empresa.local` | `Soporte123!` | ADMIN_AREA |

> **Importante**: Cambiar estas contraseñas inmediatamente en entornos de producción.

---

## Roles y Permisos

| Rol | Descripción | Capacidades |
|-----|-------------|-------------|
| **SUPER_ADMIN** | Administrador del sistema | Acceso total, configuración del sistema |
| **ADMIN_AREA** | Administrador de área | Gestión de usuarios y documentos de su área |
| **EDITOR** | Editor de contenidos | Crear, editar y subir documentos |
| **REVISOR** | Revisor de documentos | Aprobar/rechazar documentos en flujo de revisión |
| **VISUALIZADOR** | Usuario de solo lectura | Ver y descargar documentos según permisos |

Adicionalmente, cada documento puede tener permisos granulares ACL: **ver**, **descargar**, **imprimir**, **editar**.

---

## API Reference

**Base URL**: `/api/v1`

### Autenticación

| Método | Ruta | Descripción |
|--------|------|-------------|
| `POST` | `/auth/login` | Iniciar sesión (devuelve access + refresh token) |
| `POST` | `/auth/refresh` | Renovar access token |
| `POST` | `/auth/logout` | Cerrar sesión (invalida refresh token) |
| `POST` | `/auth/password/change` | Cambiar contraseña |

### Documentos

| Método | Ruta | Descripción |
|--------|------|-------------|
| `GET` | `/documents` | Listar documentos (filtros, paginación) |
| `GET` | `/documents/:id` | Detalle + versiones |
| `POST` | `/documents` | Crear documento |
| `PUT` | `/documents/:id` | Actualizar metadatos |
| `POST` | `/documents/:id/versions` | Subir nueva versión |
| `POST` | `/documents/:id/publish` | Publicar documento |
| `DELETE` | `/documents/:id` | Archivar documento |
| `GET` | `/documents/:id/versions/:vId/download` | Descargar versión |
| `POST` | `/documents/:id/favorites` | Agregar a favoritos |

### Videos

| Método | Ruta | Descripción |
|--------|------|-------------|
| `POST` | `/videos/:versionId/upload` | Subir video (multipart) |
| `GET` | `/videos/:versionId/status` | Estado de procesamiento |
| `GET` | `/videos/:versionId/hls/playlist.m3u8` | Playlist HLS |
| `POST` | `/videos/:versionId/chapters` | Configurar capítulos |

### Inteligencia Artificial

| Método | Ruta | Descripción |
|--------|------|-------------|
| `POST` | `/ai/summary` | Generar resumen (async) |
| `GET` | `/ai/summary/:id` | Obtener resultado |
| `POST` | `/ai/chat/start` | Iniciar sesión de chat RAG |
| `POST` | `/ai/chat/:sessionId/message` | Enviar mensaje |
| `GET` | `/ai/usage/today` | Uso diario del usuario |

### Búsqueda

| Método | Ruta | Descripción |
|--------|------|-------------|
| `GET` | `/search?q=texto` | Búsqueda de texto completo |
| `GET` | `/search/recent` | Búsquedas recientes |
| `GET` | `/search/suggestions` | Autocompletado |

### Administración

| Método | Ruta | Descripción |
|--------|------|-------------|
| `GET` | `/admin/dashboard` | Estadísticas del sistema |
| `GET` | `/admin/queues` | Estado de colas BullMQ |
| `POST` | `/admin/reindex` | Reindexar MeiliSearch |
| `GET` | `/admin/config` | Configuración del sistema |
| `PUT` | `/admin/config` | Actualizar configuración |
| `GET` | `/admin/logs` | Logs de auditoría |

### Health Check

```bash
GET /health
```

---

## Despliegue en Producción

```bash
# Build y levantamiento con overrides de producción
docker-compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build

# Ver logs
docker-compose logs -f backend

# Escalar workers de procesamiento (si se requiere más capacidad)
docker-compose up -d --scale backend=2
```

### Checklist de Producción

- [ ] Cambiar contraseñas del `.env` (generar con `openssl rand -hex 32`)
- [ ] Cambiar contraseñas de los usuarios seed
- [ ] Configurar certificado SSL válido (o renovar el autofirmado anualmente)
- [ ] Configurar dominio en DNS interno (o `/etc/hosts` en cada cliente)
- [ ] Configurar política de retención de backups
- [ ] Revisar límites de uso de IA según necesidades
- [ ] Configurar SMTP para notificaciones por email (opcional)
- [ ] Ajustar `MAX_VIDEO_SIZE_MB` y `MAX_DOCUMENT_SIZE_MB` según capacidad del servidor

### Backup

```bash
# Desde la API de administración
POST /api/v1/admin/backup

# O directamente con pg_dump
docker exec manual-system-db pg_dump -U postgres manuals_db > backup_$(date +%Y%m%d).sql
```

---

## Administración

### Bull Board (Monitoreo de Colas)

Disponible en: `https://manuals.empresa.local/admin/queues`

Permite visualizar y administrar los trabajos de:
- **Video Queue**: encoding, HLS, transcripción
- **AI Queue**: resúmenes, chat
- **Notification Queue**: entregas de notificaciones

### Prisma Studio (BD en Desarrollo)

```bash
cd backend
npm run db:studio
# Abre en http://localhost:5555
```

### Reindexar Búsqueda

```bash
cd backend
npm run search:index
# O via API: POST /api/v1/admin/reindex
```

---

## Seguridad

- **JWT RS256**: tokens firmados asimétricamente; la clave privada nunca sale del backend
- **Access tokens de corta duración** (15 min) + refresh tokens revocables (7 días)
- **bcryptjs** con 12 rondas para contraseñas
- **Bloqueo de cuenta** tras intentos fallidos configurables
- **Rate limiting** por usuario e IP
- **Validación estricta** de entradas con Zod en todos los endpoints
- **Audit log inmutable**: todos los accesos y modificaciones quedan registrados
- **TLS 1.2+** obligatorio (configurado en Nginx)
- **Headers de seguridad** via Helmet (CSP, HSTS, X-Frame-Options)
- **CORS estricto** limitado al dominio configurado
- **Prepared statements** via Prisma ORM (prevención de SQL injection)
- **Subida de archivos** con validación de tipo MIME y tamaño máximo

---

## Desarrollo Local

```bash
# Backend (con hot reload)
cd backend
npm install
npm run dev   # :3001

# Frontend (con hot reload y proxy a backend)
cd frontend
npm install
npm run dev   # :5173

# Solo servicios de infraestructura (sin contenedor de app)
docker-compose up -d postgres redis meilisearch
```

### Tests

```bash
cd backend
npm test              # Ejecutar suite
npm run test:coverage # Con reporte de cobertura
```

### Linting y Types

```bash
npm run lint       # ESLint
npm run typecheck  # tsc sin emit
```

---

## Licencia

Uso interno corporativo. Todos los derechos reservados.

---

*Desarrollado para despliegue en intranet empresarial. Para soporte o reportar problemas, abrir un issue en el repositorio interno.*
