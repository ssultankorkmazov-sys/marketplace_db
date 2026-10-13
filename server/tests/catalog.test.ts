import { afterEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import type { Pool } from 'pg';
import { createApp } from '../src/app.js';

const product = { product_id: 1, name: 'iPhone 15', description: 'Apple smartphone', price: 399999, stock_quantity: 25, category_id: 1, rating: 5, reviews: 1 };
function appWith(query: Pool['query']) {
  return createApp({ query } as unknown as Pool);
}

describe('catalog API', () => {
  afterEach(() => vi.restoreAllMocks());

  it('lists categories, including slash-terminated collection URL', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{ category_id: 1, category_name: 'Smartphones', count: 3 }] });
    const response = await request(appWith(query)).get('/api/v1/categories/');
    expect(response.status).toBe(200);
    expect(response.body[0]).toMatchObject({ category_name: 'Smartphones', count: 3 });
    expect(String(query.mock.calls[0][0])).toContain('FROM public.categories c LEFT JOIN public.products p');
  });

  it('lists products and their rating summary', async () => {
    const query = vi.fn().mockImplementation((sql: string) => sql.includes('COUNT(*)')
      ? Promise.resolve({ rows: [{ total: 1 }] }) : Promise.resolve({ rows: [product] }));
    const response = await request(appWith(query)).get('/api/v1/products');
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ total: 1, items: [product] });
    expect(query.mock.calls.some(([sql]) => String(sql).includes('FROM public.products p'))).toBe(true);
    expect(query.mock.calls.some(([sql]) => String(sql).includes('LEFT JOIN public.reviews r'))).toBe(true);
  });

  it('searches and filters with bound values', async () => {
    const query = vi.fn().mockImplementation((sql: string) => sql.includes('COUNT(*)')
      ? Promise.resolve({ rows: [{ total: 1 }] }) : Promise.resolve({ rows: [product] }));
    const response = await request(appWith(query)).get('/api/v1/products?q=phone&categoryId=1');
    expect(response.status).toBe(200);
    const listQuery = query.mock.calls.find(([sql]) => String(sql).includes('LIMIT'))!;
    expect(listQuery[1]).toEqual([1, '%phone%', 20, 0]);
    expect(String(listQuery[0])).toContain('ILIKE $2');
  });

  it('paginates with a capped page size', async () => {
    const query = vi.fn().mockImplementation((sql: string) => sql.includes('COUNT(*)')
      ? Promise.resolve({ rows: [{ total: 250 }] }) : Promise.resolve({ rows: [product] }));
    const response = await request(appWith(query)).get('/api/v1/products?page=2&pageSize=25');
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ page: 2, pageSize: 25, total: 250, totalPages: 10 });
    expect(query.mock.calls.find(([sql]) => String(sql).includes('LIMIT'))?.[1]).toEqual([25, 25]);
    expect((await request(appWith(query)).get('/api/v1/products?pageSize=101')).status).toBe(400);
  });

  it('sorts only by allowlisted product name and price columns', async () => {
    const query = vi.fn().mockImplementation((sql: string) => sql.includes('COUNT(*)')
      ? Promise.resolve({ rows: [{ total: 1 }] }) : Promise.resolve({ rows: [product] }));
    const response = await request(appWith(query)).get('/api/v1/products?sortBy=price&sortOrder=desc');
    expect(response.status).toBe(200);
    expect(String(query.mock.calls.find(([sql]) => String(sql).includes('LIMIT'))?.[0])).toContain('ORDER BY p.price DESC');
    expect((await request(appWith(query)).get('/api/v1/products?sortBy=price;drop')).status).toBe(400);
  });

  it('returns 404 for missing products and categories', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const app = appWith(query);
    expect((await request(app).get('/api/v1/products/999')).status).toBe(404);
    expect((await request(app).get('/api/v1/categories/999')).status).toBe(404);
  });

  it('rejects invalid parameters and reports database failures as 500', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const app = appWith(query);
    expect((await request(app).get('/api/v1/products?page=0')).status).toBe(400);
    expect((await request(app).get('/api/v1/products?sortOrder=random')).status).toBe(400);
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const failed = appWith(vi.fn().mockRejectedValue(new Error('database down')));
    expect((await request(failed).get('/api/v1/products')).status).toBe(500);
    expect(log).toHaveBeenCalled();
  });
});
