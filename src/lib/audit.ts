import type { DB, AuditEntityType } from "./types";

/**
 * Append an audit event. Call INSIDE a mutateDB mutator so it's written
 * atomically with the change it records (same write-lock, one file write).
 */
export function logAudit(
  db: DB,
  event: {
    actor?: string;
    action: string;
    entityType: AuditEntityType;
    entity: string;
    detail?: string;
    at?: string;
  },
): void {
  if (!db.auditLog) db.auditLog = [];
  if (db.meta.nextAudit == null) db.meta.nextAudit = 1;
  const n = db.meta.nextAudit++;
  db.auditLog.push({
    id: `a${n}`,
    at: event.at || new Date().toISOString(),
    actor: (event.actor || "").trim() || "System",
    action: event.action,
    entityType: event.entityType,
    entity: event.entity,
    detail: event.detail,
  });
}
