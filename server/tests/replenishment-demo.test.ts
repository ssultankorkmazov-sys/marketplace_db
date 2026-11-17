import { afterEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import type { Pool } from 'pg';
import * as childProcess from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../src/app.js';

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return { ...actual, spawn: vi.fn(), execFile: vi.fn() };
});

const reportPath = fileURLToPath(new URL('../../ml/sales_prediction/reports/phase3ab-synthetic-replenishment.json', import.meta.url));
const token = Buffer.from('r'.repeat(32)).toString('base64url');
const cookie = `marketkz_session=${token}`;
const admin = { user_id: 8, name: 'Admin', email: 'admin@example.kz', phone: '+77000000008', address: null, role: 'admin' as const };
const user = { ...admin, user_id: 9, role: 'user' as const };
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
  vi.restoreAllMocks();
});

function fakePool(sessionUser: typeof admin | typeof user | null) {
  const query = vi.fn(async (sql: string) => {
    if (sql.includes('FROM user_sessions')) return { rows: sessionUser ? [sessionUser] : [] };
    throw new Error('Unexpected database query for replenishment demo endpoint.');
  });
  return { pool: { query } as unknown as Pool, query };
}

async function temporaryReport(contents: string) {
  const directory = await mkdtemp(join(tmpdir(), 'marketkz-replenishment-demo-'));
  temporaryDirectories.push(directory);
  const path = join(directory, 'report.json');
  await writeFile(path, contents, 'utf8');
  return path;
}

async function temporaryMissingReport() {
  const directory = await mkdtemp(join(tmpdir(), 'marketkz-replenishment-demo-'));
  temporaryDirectories.push(directory);
  return join(directory, 'missing.json');
}

describe('synthetic replenishment demo API', () => {
  it('rejects unauthenticated requests before reading the report', async () => {
    const { pool, query } = fakePool(null);
    const path = await temporaryMissingReport();
    const response = await request(createApp(pool, { replenishmentDemoReportPath: path })).get('/api/v1/admin/replenishment/demo');
    expect(response.status).toBe(401);
    expect(query).not.toHaveBeenCalled();
  });

  it('rejects authenticated non-admins before reading the report', async () => {
    const { pool, query } = fakePool(user);
    const path = await temporaryMissingReport();
    const response = await request(createApp(pool, { replenishmentDemoReportPath: path }))
      .get('/api/v1/admin/replenishment/demo').set('Cookie', cookie);
    expect(response.status).toBe(403);
    expect(query).toHaveBeenCalledTimes(1);
    expect(String(query.mock.calls[0][0])).toContain('FROM user_sessions');
  });

  it('returns the authoritative synthetic report to an administrator without business-data queries', async () => {
    const spawn = vi.spyOn(childProcess, 'spawn');
    const execFile = vi.spyOn(childProcess, 'execFile');
    const { pool, query } = fakePool(admin);
    const expected = JSON.parse(await readFile(reportPath, 'utf8'));
    const response = await request(createApp(pool)).get('/api/v1/admin/replenishment/demo').set('Cookie', cookie);
    expect(response.status).toBe(200);
    expect(response.body).toEqual(expected);
    expect(response.body.metadata.source).toBe('SYNTHETIC');
    expect(response.body.recommendations[0].product_name).toBe('Школьный рюкзак');
    expect(response.body.recommendations.every((row: { source: string }) => row.source === 'SYNTHETIC')).toBe(true);
    expect(response.body.recommendations.every((row: { product_name: string }) => typeof row.product_name === 'string' && row.product_name.length > 0)).toBe(true);
    expect(query).toHaveBeenCalledTimes(1);
    expect(String(query.mock.calls[0][0])).toContain('FROM user_sessions');
    expect(spawn).not.toHaveBeenCalled();
    expect(execFile).not.toHaveBeenCalled();
  });

  it('rejects a report row without its synthetic catalog product name', async () => {
    const report = JSON.parse(await readFile(reportPath, 'utf8'));
    delete report.recommendations[0].product_name;
    const path = await temporaryReport(JSON.stringify(report));
    const { pool } = fakePool(admin);
    const response = await request(createApp(pool, { replenishmentDemoReportPath: path }))
      .get('/api/v1/admin/replenishment/demo').set('Cookie', cookie);
    expect(response.status).toBe(503);
    expect(response.body).toEqual({ error: 'Демонстрационный отчёт временно недоступен.' });
  });

  it('returns a safe 503 when the report is missing', async () => {
    const path = await temporaryMissingReport();
    const { pool } = fakePool(admin);
    const response = await request(createApp(pool, { replenishmentDemoReportPath: path }))
      .get('/api/v1/admin/replenishment/demo').set('Cookie', cookie);
    expect(response.status).toBe(503);
    expect(response.body).toEqual({ error: 'Демонстрационный отчёт временно недоступен.' });
    expect(JSON.stringify(response.body)).not.toContain(path);
    expect(JSON.stringify(response.body)).not.toMatch(/stack|syntaxerror|json/i);
  });

  it.each([
    ['malformed report', '{not-json'],
    ['invalid report shape', JSON.stringify({ metadata: { source: 'REAL' }, recommendations: [] })],
  ])('returns a safe 503 for a %s', async (_label, contents) => {
    const path = await temporaryReport(contents);
    const { pool } = fakePool(admin);
    const response = await request(createApp(pool, { replenishmentDemoReportPath: path }))
      .get('/api/v1/admin/replenishment/demo').set('Cookie', cookie);
    expect(response.status).toBe(503);
    expect(response.body).toEqual({ error: 'Демонстрационный отчёт временно недоступен.' });
    expect(JSON.stringify(response.body)).not.toContain(path);
    expect(JSON.stringify(response.body)).not.toMatch(/stack|syntaxerror|json/i);
  });

  it('does not accept the report location from request input', async () => {
    const { pool } = fakePool(admin);
    const response = await request(createApp(pool)).get('/api/v1/admin/replenishment/demo?path=C%3A%5Cprivate.json').set('Cookie', cookie);
    expect(response.status).toBe(200);
    expect(response.body.metadata.source).toBe('SYNTHETIC');
  });
});
