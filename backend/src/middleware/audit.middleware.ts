import type { FastifyRequest } from "fastify";
import { prisma } from "../plugins/prisma";
import type { AuditAction } from "@prisma/client";

// ──────────────────────────────────────────────────────
// Log de auditoría — inmutable (append-only)
// ──────────────────────────────────────────────────────

export async function createAuditLog(params: {
  userId?: string;
  action: AuditAction;
  entityType?: string;
  entityId?: string;
  documentId?: string;
  documentVersionId?: string;
  metadata?: Record<string, unknown>;
  request?: FastifyRequest;
}) {
  try {
    await prisma.auditLog.create({
      data: {
        userId: params.userId,
        action: params.action,
        entityType: params.entityType,
        entityId: params.entityId,
        documentId: params.documentId,
        documentVersionId: params.documentVersionId,
        metadata: params.metadata,
        ip: params.request?.ip,
        userAgent: params.request?.headers["user-agent"],
        sessionId: params.request?.headers["x-session-id"] as string | undefined,
      },
    });
  } catch (err) {
    // No fallar la operación principal si el log falla
    console.error("[AuditLog] Error al registrar:", err);
  }
}

// Helper para registrar acceso a documento
export async function auditDocumentAccess(
  userId: string,
  documentId: string,
  versionId: string,
  action: Extract<AuditAction, "DOCUMENT_VIEWED" | "DOCUMENT_DOWNLOADED" | "DOCUMENT_PRINTED">,
  request?: FastifyRequest
) {
  return createAuditLog({
    userId,
    action,
    entityType: "Document",
    entityId: documentId,
    documentId,
    documentVersionId: versionId,
    request,
  });
}
