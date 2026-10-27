import type { Pool, PoolClient } from 'pg';

export type AuditStatus = 'SUCCESS' | 'FAILURE';
export interface AuditLog {
  log_id: string;
  user_id: number | null;
  action: string;
  entity_type: string | null;
  entity_id: number | null;
  status: AuditStatus;
  details: Record<string, unknown>;
  ip_address: string | null;
  created_at: string;
}

export interface AuditEventInput {
  userId?: number | null;
  action: string;
  entityType?: string | null;
  entityId?: number | null;
  status: AuditStatus;
  details?: Record<string, unknown>;
  ipAddress?: string | null;
}

export interface AuditPublisher {
  publish(log: AuditLog): void;
}

export async function insertAuditLog(db: Pool | PoolClient, event: AuditEventInput): Promise<AuditLog> {
  const { rows } = await db.query<AuditLog>(
    `INSERT INTO audit_logs (user_id, action, entity_type, entity_id, status, details, ip_address)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7)
     RETURNING log_id::text AS log_id, user_id, action, entity_type, entity_id, status, details, ip_address::text AS ip_address, created_at`,
    [event.userId ?? null, event.action, event.entityType ?? null, event.entityId ?? null, event.status,
      JSON.stringify(event.details ?? {}), event.ipAddress ?? null],
  );
  if (!rows[0]) throw new Error('Audit insert returned no row.');
  return rows[0];
}

export function publishAuditLog(publisher: AuditPublisher | undefined, log: AuditLog): void {
  publisher?.publish(log);
}

export async function recordAuditLog(
  db: Pool | PoolClient,
  event: AuditEventInput,
  publisher?: AuditPublisher,
): Promise<AuditLog> {
  const log = await insertAuditLog(db, event);
  publishAuditLog(publisher, log);
  return log;
}
