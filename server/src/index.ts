import dotenv from 'dotenv';
import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { checkDatabase, createPool } from './db.js';
import { createAuditRealtime } from './realtime.js';
import type { AuditLog } from './audit.js';

dotenv.config({ path: resolve(process.cwd(), '../.env') });

async function main() {
  const config = loadConfig();
  const pool = createPool(config);
  try {
    await checkDatabase(pool);
    let realtime: ReturnType<typeof createAuditRealtime> | null = null;
    const auditPublisher = { publish(log: AuditLog) { realtime?.publish(log); } };
    const allowLocalOrigins = config.nodeEnv === 'development';
    const server = createServer(createApp(pool, { secureCookies: config.nodeEnv === 'production', allowLocalOrigins, auditPublisher }));
    realtime = createAuditRealtime(server, pool, { allowLocalOrigins });
    server.listen(config.port, () => {
      console.log(`MarketKZ backend listening on port ${config.port}`);
    });

    const shutdown = () => { void realtime?.close().finally(() => server.close(() => void pool.end())); };
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  } catch (error) {
    console.error('Unable to connect to PostgreSQL:', error instanceof Error ? error.message : error);
    await pool.end();
    process.exitCode = 1;
  }
}

void main();
