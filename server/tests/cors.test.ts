import { describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import type { Pool } from 'pg';
import { createApp } from '../src/app.js';

const frontendOrigin = 'https://ssultankorkmazov-sys.github.io';
const localOrigins = ['http://localhost:5173', 'http://127.0.0.1:5173'];

describe('CORS allowlist', () => {
  it('allows credentialed catalog reads from the production frontend', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const response = await request(createApp({ query } as unknown as Pool))
      .get('/api/v1/categories')
      .set('Origin', frontendOrigin);

    expect(response.status).toBe(200);
    expect(response.headers['access-control-allow-origin']).toBe(frontendOrigin);
    expect(response.headers['access-control-allow-credentials']).toBe('true');
    expect(response.headers.vary).toContain('Origin');
  });

  it.each(localOrigins)('allows credentialed API requests from local origin %s', async (origin) => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const response = await request(createApp({ query } as unknown as Pool))
      .get('/api/v1/categories')
      .set('Origin', origin);

    expect(response.status).toBe(200);
    expect(response.headers['access-control-allow-origin']).toBe(origin);
    expect(response.headers['access-control-allow-credentials']).toBe('true');
  });

  it('answers JSON registration preflight with the allowed method and headers', async () => {
    const query = vi.fn();
    const response = await request(createApp({ query } as unknown as Pool))
      .options('/api/v1/auth/register')
      .set('Origin', frontendOrigin)
      .set('Access-Control-Request-Method', 'POST')
      .set('Access-Control-Request-Headers', 'content-type');

    expect(response.status).toBe(204);
    expect(response.headers['access-control-allow-origin']).toBe(frontendOrigin);
    expect(response.headers['access-control-allow-credentials']).toBe('true');
    expect(response.headers['access-control-allow-methods']).toContain('POST');
    expect(response.headers['access-control-allow-headers']).toContain('Content-Type');
    expect(query).not.toHaveBeenCalled();
  });

  it('answers local credentialed preflight requests', async () => {
    const query = vi.fn();
    const origin = 'http://localhost:5173';
    const response = await request(createApp({ query } as unknown as Pool))
      .options('/api/v1/auth/register')
      .set('Origin', origin)
      .set('Access-Control-Request-Method', 'POST')
      .set('Access-Control-Request-Headers', 'content-type');

    expect(response.status).toBe(204);
    expect(response.headers['access-control-allow-origin']).toBe(origin);
    expect(response.headers['access-control-allow-credentials']).toBe('true');
    expect(response.headers['access-control-allow-methods']).toContain('POST');
    expect(response.headers['access-control-allow-headers']).toContain('Content-Type');
    expect(query).not.toHaveBeenCalled();
  });

  it('rejects browser requests from an unapproved origin without reflecting that origin', async () => {
    const query = vi.fn();
    const response = await request(createApp({ query } as unknown as Pool))
      .post('/api/v1/auth/register')
      .set('Origin', 'https://untrusted.example')
      .send({});

    expect(response.status).toBe(403);
    expect(response.headers['access-control-allow-origin']).toBeUndefined();
    expect(query).not.toHaveBeenCalled();
  });
});
