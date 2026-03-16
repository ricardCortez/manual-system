-- Extensiones PostgreSQL requeridas
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- Habilitar búsqueda full-text en español
CREATE TEXT SEARCH CONFIGURATION spanish_unaccent (COPY = spanish);
