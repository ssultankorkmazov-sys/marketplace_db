import { describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import type { Pool } from 'pg';
import { createApp } from '../src/app.js';

const person = { user_id: 55, name: 'Test Person', email: 'person@example.kz', phone: '+77001234567', address: null, role: 'user' };
function appWith(query: Pool['query']) { return createApp({ query } as unknown as Pool); }

describe('server authentication and profile', () => {
  it('validates registration, hashes passwords, issues an HttpOnly cookie, and omits the hash', async () => {
    const query = vi.fn().mockImplementation((sql: string) => sql.includes('INSERT INTO users')
      ? Promise.resolve({ rows: [person] }) : Promise.resolve({ rows: [] }));
    const response = await request(appWith(query)).post('/api/v1/auth/register').send({ name: ' Test Person ', email: 'PERSON@example.kz', phone: '+77001234567', address: '', password: 'long-password' });
    expect(response.status).toBe(201);
    expect(response.body.user).toMatchObject(person);
    expect(JSON.stringify(response.body)).not.toContain('password');
    expect(response.headers['set-cookie'][0]).toMatch(/HttpOnly/);
    const insert = query.mock.calls.find(([sql]) => String(sql).includes('INSERT INTO users'))!;
    expect(insert[1][1]).toBe('PERSON@example.kz');
    expect(insert[1][4]).toMatch(/^[\da-f]{32}:[\da-f]{128}$/);
    expect((await request(appWith(query)).post('/api/v1/auth/register').send({ ...person, password: 'short' })).status).toBe(400);
  });

  it('rejects duplicate email or phone without exposing SQL errors', async () => {
    const query = vi.fn().mockRejectedValue(Object.assign(new Error('private database detail'), { code: '23505' }));
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const response = await request(appWith(query)).post('/api/v1/auth/register').send({ name: 'Test', email: 'person@example.kz', phone: '12345', password: 'long-password' });
    expect(response.status).toBe(409);
    expect(response.text).not.toContain('private database detail');
    log.mockRestore();
  });

  it('requires a server session and limits profile changes to the authenticated user', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const app = appWith(query);
    expect((await request(app).get('/api/v1/auth/me')).status).toBe(401);
    expect((await request(app).patch('/api/v1/profile').send({ name: 'Other', phone: '12345' })).status).toBe(401);
    expect((await request(app).post('/api/v1/auth/logout')).status).toBe(204);
  });

  it('updates only the identity established by the server session', async () => {
    const query = vi.fn().mockImplementation((sql: string) => {
      if (sql.includes('INSERT INTO users')) return Promise.resolve({ rows: [person] });
      if (sql.includes('INSERT INTO user_sessions')) return Promise.resolve({ rows: [] });
      if (sql.includes('FROM user_sessions')) return Promise.resolve({ rows: [person] });
      if (sql.includes('UPDATE users')) return Promise.resolve({ rows: [{ ...person, name: 'Updated User' }] });
      return Promise.resolve({ rows: [] });
    });
    const agent = request.agent(appWith(query));
    expect((await agent.post('/api/v1/auth/register').send({ name: person.name, email: person.email, phone: person.phone, password: 'long-password' })).status).toBe(201);
    const updated = await agent.patch('/api/v1/profile').send({ name: 'Updated User', phone: person.phone, address: null });
    expect(updated.status).toBe(200);
    expect(updated.body.user.name).toBe('Updated User');
    const update = query.mock.calls.find(([sql]) => String(sql).includes('UPDATE users'))!;
    expect(String(update[0])).toContain('WHERE user_id=$4');
    expect(update[1][3]).toBe(person.user_id);
  });

  it('verifies the stored password hash without returning it to the client', async () => {
    const registerQuery = vi.fn().mockImplementation((sql: string, values: unknown[]) => sql.includes('INSERT INTO users')
      ? Promise.resolve({ rows: [person] }) : Promise.resolve({ rows: [] }));
    await request(appWith(registerQuery)).post('/api/v1/auth/register').send({ name: person.name, email: person.email, phone: person.phone, password: 'long-password' });
    const hash = String(registerQuery.mock.calls[0][1][4]);
    const loginQuery = vi.fn().mockResolvedValue({ rows: [{ ...person, password_hash: hash }] });
    const success = await request(appWith(loginQuery)).post('/api/v1/auth/login').send({ email: person.email, password: 'long-password' });
    expect(success.status).toBe(200);
    expect(success.body.user).toMatchObject(person);
    expect(JSON.stringify(success.body)).not.toContain(hash);
    expect((await request(appWith(loginQuery)).post('/api/v1/auth/login').send({ email: person.email, password: 'incorrect' })).status).toBe(401);
  });
});
