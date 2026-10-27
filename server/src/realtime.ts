import type { Server } from 'node:http';
import type { Pool } from 'pg';
import { WebSocket, WebSocketServer } from 'ws';
import type { AuditLog, AuditPublisher } from './audit.js';
import { isAllowedFrontendOrigin, sessionUserFromToken } from './app.js';

const STREAM_PATH = '/api/v1/admin/logs/stream';
const SESSION_COOKIE = 'marketkz_session';

function cookieToken(header: string | undefined): string | undefined {
  return header?.split(';').map((part) => part.trim())
    .find((part) => part.startsWith(`${SESSION_COOKIE}=`))?.slice(SESSION_COOKIE.length + 1);
}

function reject(socket: import('node:stream').Duplex, status: number, message: string) {
  socket.write(`HTTP/1.1 ${status} ${message}\r\nConnection: close\r\n\r\n`);
  socket.destroy();
}

export function createAuditRealtime(server: Server, pool: Pool, options: { allowLocalOrigins?: boolean; sessionCheckIntervalMs?: number } = {}): AuditPublisher & { close(): Promise<void> } {
  const wss = new WebSocketServer({ noServer: true, maxPayload: 1024 });
  const alive = new WeakSet<WebSocket>();
  const sessionTokens = new WeakMap<WebSocket, string>();
  const configuredSessionCheckInterval = options.sessionCheckIntervalMs;
  const sessionCheckIntervalMs = Number.isSafeInteger(configuredSessionCheckInterval) && (configuredSessionCheckInterval ?? 0) > 0
    ? configuredSessionCheckInterval!
    : 15_000;
  let shuttingDown = false;
  const handleUpgrade = (request: import('node:http').IncomingMessage, socket: import('node:stream').Duplex, head: Buffer) => {
    const url = new URL(request.url ?? '/', 'http://localhost');
    if (url.pathname !== STREAM_PATH) return reject(socket, 404, 'Not Found');
    const origin = request.headers.origin;
    if (!isAllowedFrontendOrigin(origin, options.allowLocalOrigins ?? false)) return reject(socket, 403, 'Forbidden');
    const token = cookieToken(request.headers.cookie);
    if (!token || !/^[A-Za-z\d_-]{40,50}$/.test(token)) return reject(socket, 401, 'Unauthorized');

    void sessionUserFromToken(pool, token).then((user) => {
      if (!user || user.role !== 'admin') return reject(socket, user ? 403 : 401, user ? 'Forbidden' : 'Unauthorized');
      if (shuttingDown || socket.destroyed) return reject(socket, 503, 'Service Unavailable');
      wss.handleUpgrade(request, socket, head, (websocket) => {
        sessionTokens.set(websocket, token);
        wss.emit('connection', websocket, request);
      });
    }).catch(() => reject(socket, 503, 'Service Unavailable'));
  };

  server.on('upgrade', handleUpgrade);
  wss.on('connection', (socket) => {
    const token = sessionTokens.get(socket);
    if (!token) {
      socket.close(1008, 'Session unavailable');
      return;
    }
    const onError = () => undefined;
    const onPong = () => alive.add(socket);
    const onMessage = () => socket.close(1008, 'Client messages are not supported');
    let checkingSession = false;
    const checkSession = async () => {
      if (checkingSession || socket.readyState !== WebSocket.OPEN) return;
      checkingSession = true;
      try {
        const user = await sessionUserFromToken(pool, token);
        if (!user || user.role !== 'admin') socket.close(1008, 'Administrator session is no longer valid');
      } catch {
        socket.close(1011, 'Session validation unavailable');
      } finally {
        checkingSession = false;
      }
    };

    socket.on('error', onError);
    alive.add(socket);
    socket.on('pong', onPong);
    socket.send(JSON.stringify({ type: 'connected' }));
    socket.on('message', onMessage);
    const sessionTimer = setInterval(() => { void checkSession(); }, sessionCheckIntervalMs);
    sessionTimer.unref();
    socket.once('close', () => {
      clearInterval(sessionTimer);
      alive.delete(socket);
      socket.off('error', onError);
      socket.off('pong', onPong);
      socket.off('message', onMessage);
    });
  });

  const heartbeat = setInterval(() => {
    for (const socket of wss.clients) {
      if (socket.readyState !== WebSocket.OPEN) continue;
      if (!alive.has(socket)) { socket.terminate(); continue; }
      alive.delete(socket);
      socket.ping();
    }
  }, 30_000);
  heartbeat.unref();

  return {
    publish(log: AuditLog) {
      const payload = JSON.stringify({ type: 'audit_log', log });
      for (const socket of wss.clients) {
        if (socket.readyState === WebSocket.OPEN) socket.send(payload, (error) => { if (error) socket.terminate(); });
      }
    },
    async close() {
      shuttingDown = true;
      clearInterval(heartbeat);
      server.off('upgrade', handleUpgrade);
      for (const socket of wss.clients) socket.close(1001, 'Server shutting down');
      await new Promise<void>((resolve, rejectClose) => wss.close((error) => error ? rejectClose(error) : resolve()));
    },
  };
}
