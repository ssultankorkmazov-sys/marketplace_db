import dotenv from 'dotenv';
import { resolve } from 'node:path';
import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { checkDatabase, createPool } from './db.js';

dotenv.config({ path: resolve(process.cwd(), '../.env') });

async function main() {
  const config = loadConfig();
  const pool = createPool(config);
  try {
    await checkDatabase(pool);
    const server = createApp(pool, { secureCookies: config.nodeEnv === 'production' }).listen(config.port, () => {
      console.log(`MarketKZ backend listening on port ${config.port}`);
    });

    const shutdown = () => server.close(() => void pool.end());
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  } catch (error) {
    console.error('Unable to connect to PostgreSQL:', error instanceof Error ? error.message : error);
    await pool.end();
    process.exitCode = 1;
  }
}

void main();
