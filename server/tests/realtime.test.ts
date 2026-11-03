import { createServer, type Server } from 'node:http';
import { once } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Pool } from 'pg';
import WebSocket from 'ws';
import { createAuditRealtime } from '../src/realtime.js';
import type { AuditLog } from '../src/audit.js';
import type { AnomalyIncident } from '../src/anomalies.js';

const token = Buffer.from('a'.repeat(32)).toString('base64url');
const cookie = `marketkz_session=${token}`;
const log: AuditLog = { log_id: '7', user_id: 1, action: 'ORDER_CREATED', entity_type: 'order', entity_id: 11, status: 'SUCCESS', details: { item_count: 1 }, ip_address: null, created_at: '2026-10-20T10:00:00.000Z' };
const incident: AnomalyIncident = { incident_id: '3', anomaly_type: 'UNUSUAL_ORDER_ACTIVITY', subject_user_id: 1, severity: 'MEDIUM', risk_score: 50, status: 'NEW', detected_at: '2026-11-01T10:00:00.000Z', updated_at: '2026-11-01T10:00:00.000Z', first_event_at: '2026-11-01T09:56:00.000Z', last_event_at: '2026-11-01T10:00:00.000Z', evidence: { event_count: 5, audit_log_ids: ['1', '2', '3', '4', '5'] }, explanation: 'Five orders crossed the configured threshold.', recommendations: [{ action: 'Review linked orders.', reason: 'The configured threshold was exceeded.', priority: 'MEDIUM', verification_step: 'Verify order states.' }], deduplication_key: 'UNUSUAL_ORDER_ACTIVITY:user:1' };
const origin = 'https://ssultankorkmazov-sys.github.io';
const instances: { server: Server; realtime: ReturnType<typeof createAuditRealtime> }[] = [];

async function openSocket(role: 'admin' | 'user' | null, requestOrigin = origin, sessionCheckIntervalMs = 15_000, path = '/api/v1/admin/logs/stream') {
  let currentRole = role;
  const query = vi.fn(async () => ({ rows: currentRole ? [{ user_id: 1, name: 'User', email: 'user@example.kz', phone: '0', address: null, role: currentRole }] : [] }));
  const server = createServer();
  const realtime = createAuditRealtime(server, { query } as unknown as Pool, { sessionCheckIntervalMs });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  instances.push({ server, realtime });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing test server address');
  return { query, realtime, setRole(value: 'admin' | 'user' | null) { currentRole = value; }, socket: new WebSocket(`ws://127.0.0.1:${address.port}${path}`, { headers: { Origin: requestOrigin, Cookie: cookie } }) };
}

afterEach(async () => {
  await Promise.all(instances.splice(0).map(async ({ server, realtime }) => {
    await realtime.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }));
});

describe('audit WebSocket authorization and delivery', () => {
  it('authenticates a session admin and delivers new audit events', async () => {
    const { socket, realtime, query } = await openSocket('admin');
    const opened = once(socket, 'open');
    const greetingMessage = once(socket, 'message');
    await opened;
    const greeting = JSON.parse(String((await greetingMessage)[0]));
    expect(greeting.type).toBe('connected');
    const eventMessage = once(socket, 'message');
    realtime.publish(log);
    const event = JSON.parse(String((await eventMessage)[0]));
    expect(event).toEqual({ type: 'audit_log', log });
    expect(query).toHaveBeenCalledWith(expect.stringContaining('FROM user_sessions'), expect.any(Array));
    const closed = once(socket, 'close');
    socket.close();
    await closed;
  });

  it('delivers incident notifications through the existing administrator socket', async () => {
    const { socket, realtime } = await openSocket('admin');
    const opened = once(socket, 'open');
    const greeting = once(socket, 'message');
    await opened;
    await greeting;
    const message = once(socket, 'message');
    realtime.publishIncident(incident);
    expect(JSON.parse(String((await message)[0]))).toEqual({ type: 'anomaly_incident', incident });
    const closed = once(socket, 'close');
    socket.close();
    await closed;
  });

  it.each([['ordinary user', 'user'], ['missing session', null]] as const)('rejects a WebSocket connection for %s', async (_label, role) => {
    const { socket } = await openSocket(role);
    const [error] = await once(socket, 'error') as [Error];
    expect(error.message).toMatch(/Unexpected server response: (401|403)/);
  });

  it('rejects an unapproved origin before session lookup', async () => {
    const { socket, query } = await openSocket('admin', 'https://untrusted.example');
    const [error] = await once(socket, 'error') as [Error];
    expect(error.message).toMatch(/Unexpected server response: 403/);
    expect(query).not.toHaveBeenCalled();
  });

  it('rejects WebSocket upgrades for unknown paths instead of leaving the client pending', async () => {
    const { socket, query } = await openSocket('admin', origin, 15_000, '/unknown/stream');
    const [error] = await once(socket, 'error') as [Error];
    expect(error.message).toMatch(/Unexpected server response: 404/);
    expect(query).not.toHaveBeenCalled();
  });

  it('safely handles publishing after an administrator disconnects', async () => {
    const { socket, realtime } = await openSocket('admin');
    const opened = once(socket, 'open');
    const greeting = once(socket, 'message');
    await opened;
    await greeting;
    const closed = once(socket, 'close');
    socket.close();
    await closed;
    expect(() => realtime.publish(log)).not.toThrow();
  });

  it.each([['session revocation', null], ['administrator role removal', 'user']] as const)(
    'closes an open socket after %s', async (_label, nextRole) => {
      const { socket, setRole } = await openSocket('admin', origin, 10);
      const opened = once(socket, 'open');
      const greeting = once(socket, 'message');
      await opened;
      await greeting;
      const closed = once(socket, 'close');
      setRole(nextRole);
      const [code] = await closed;
      expect(code).toBe(1008);
    },
  );

  it('stops revalidation queries after a client disconnects', async () => {
    const { socket, query } = await openSocket('admin', origin, 10);
    const opened = once(socket, 'open');
    const greeting = once(socket, 'message');
    await opened;
    await greeting;
    const closed = once(socket, 'close');
    socket.close();
    await closed;
    const countAfterClose = query.mock.calls.length;
    await new Promise((resolve) => setTimeout(resolve, 35));
    expect(query).toHaveBeenCalledTimes(countAfterClose);
  });
});
