import { afterEach, describe, expect, it, vi } from 'vitest'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  vi.resetModules()
})

describe('configured production API URL', () => {
  it('uses protected admin endpoints for categories, users, and reviews', async () => {
    vi.stubEnv('VITE_API_URL', 'https://marketkz-api.onrender.com/api/v1')
    const category = { category_id: 9, category_name: 'New', count: 0 }
    const user = { user_id: 4, name: 'Buyer', email: 'buyer@example.kz', phone: '123', address: null, order_count: 1, review_count: 0 }
    const review = { review_id: 3, user_id: 4, product_id: 9, rating: 5, comment: 'Nice', review_date: '2026-10-13', user: { user_id: 4, name: 'Buyer' }, product: { product_id: 9, name: 'Camera' } }
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ categories: [category] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ category }), { status: 201 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ category }), { status: 200 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ users: [user] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ reviews: [review] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
    vi.stubGlobal('fetch', fetchMock)
    const { adminApi } = await import('../src/api/client')

    await adminApi.categories()
    await adminApi.createCategory('New')
    await adminApi.updateCategory(9, 'New')
    await adminApi.deleteCategory(9)
    await adminApi.users()
    await adminApi.reviews()
    await adminApi.deleteReview(3)

    expect(fetchMock.mock.calls.map(([url, init]) => [url, (init as RequestInit).method ?? 'GET'])).toEqual([
      ['https://marketkz-api.onrender.com/api/v1/admin/categories', 'GET'],
      ['https://marketkz-api.onrender.com/api/v1/admin/categories', 'POST'],
      ['https://marketkz-api.onrender.com/api/v1/admin/categories/9', 'PATCH'],
      ['https://marketkz-api.onrender.com/api/v1/admin/categories/9', 'DELETE'],
      ['https://marketkz-api.onrender.com/api/v1/admin/users', 'GET'],
      ['https://marketkz-api.onrender.com/api/v1/admin/reviews', 'GET'],
      ['https://marketkz-api.onrender.com/api/v1/admin/reviews/3', 'DELETE'],
    ])
    expect(fetchMock.mock.calls.every(([, init]) => (init as RequestInit).credentials === 'include')).toBe(true)
  })

  it('uses the Render API for catalog GET and registration POST requests', async () => {
    vi.stubEnv('VITE_API_URL', 'https://marketkz-api.onrender.com/api/v1')
    const user = { user_id: 51, name: 'Test Buyer', email: 'buyer@example.kz', phone: '+77001234567', address: null, role: 'user' }
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ items: [], page: 1, pageSize: 10, total: 50, totalPages: 5 }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ user }), { status: 201 }))
    vi.stubGlobal('fetch', fetchMock)

    const { authApi, catalogApi } = await import('../src/api/client')
    await catalogApi.products({ page: 1, pageSize: 10 })
    await authApi.register({ name: user.name, email: user.email, phone: user.phone, address: '', password: 'test-password' })

    expect(fetchMock.mock.calls[0][0]).toBe('https://marketkz-api.onrender.com/api/v1/products?page=1&pageSize=10')
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ credentials: 'include' })
    expect(fetchMock.mock.calls[1][0]).toBe('https://marketkz-api.onrender.com/api/v1/auth/register')
    expect(fetchMock.mock.calls[1][1]).toMatchObject({ method: 'POST', credentials: 'include' })
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toMatchObject({ email: user.email, password: 'test-password' })
  })

  it('requests paginated audit logs with filters and credentials', async () => {
    vi.stubEnv('VITE_API_URL', 'https://marketkz-api.onrender.com/api/v1')
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ logs: [], page: 2, pageSize: 10, total: 0, successful: 0, failed: 0, totalPages: 0 }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const { adminApi } = await import('../src/api/client')

    await adminApi.logs({ page: 2, pageSize: 10, action: 'ORDER_CREATED', status: 'SUCCESS', userId: 8, from: '2026-10-01', to: '2026-10-31', q: '42' })

    expect(fetchMock.mock.calls[0][0]).toBe('https://marketkz-api.onrender.com/api/v1/admin/logs?page=2&pageSize=10&action=ORDER_CREATED&status=SUCCESS&userId=8&from=2026-10-01&to=2026-10-31&q=42')
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ credentials: 'include' })
  })

  it('creates a secure production WebSocket URL', async () => {
    vi.stubEnv('VITE_API_URL', 'https://marketkz-api.onrender.com/api/v1')
    const { auditWebSocketUrl } = await import('../src/api/client')
    expect(auditWebSocketUrl()).toBe('wss://marketkz-api.onrender.com/api/v1/admin/logs/stream')
  })

  it('requests anomalies with only supported filters and session credentials', async () => {
    vi.stubEnv('VITE_API_URL', 'https://marketkz-api.onrender.com/api/v1')
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ incidents: [], page: 2, pageSize: 20, total: 0, low: 0, medium: 0, high: 0, critical: 0, totalPages: 0 }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const { adminApi } = await import('../src/api/client')

    await adminApi.anomalies({ page: 2, pageSize: 20, severity: 'HIGH', type: 'UNUSUAL_ORDER_ACTIVITY', status: 'INVESTIGATING', from: '2026-10-01', to: '2026-10-31' })

    expect(fetchMock.mock.calls[0][0]).toBe('https://marketkz-api.onrender.com/api/v1/admin/anomalies?page=2&pageSize=20&severity=HIGH&type=UNUSUAL_ORDER_ACTIVITY&status=INVESTIGATING&from=2026-10-01&to=2026-10-31')
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ credentials: 'include' })
  })

  it('uses the protected statistical anomaly status contract endpoint', async () => {
    vi.stubEnv('VITE_API_URL', 'https://marketkz-api.onrender.com/api/v1')
    const snapshot = {
      detector: 'JEFFREYS_DIVERGENCE', experimental: true, operational: false,
      detector_status: 'DISABLED', calibration_status: 'NOT_RUN', calibration_sufficient: false,
      divergence: null, baseline: { sample_count: null, distribution: null },
      current: { sample_count: null, distribution: null }, category_contributions: null, evaluated_at: null,
    }
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(snapshot), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const { adminApi } = await import('../src/api/client')

    expect(await adminApi.statisticalAnomalyStatus()).toEqual(snapshot)
    expect(fetchMock.mock.calls[0][0]).toBe('https://marketkz-api.onrender.com/api/v1/admin/anomalies/statistical-status')
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ credentials: 'include' })
  })

  it('loads anomaly details and changes only the requested status', async () => {
    vi.stubEnv('VITE_API_URL', 'https://marketkz-api.onrender.com/api/v1')
    const incident = { incident_id: '17', status: 'RESOLVED' }
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ incident }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ incident }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const { adminApi } = await import('../src/api/client')

    await adminApi.anomaly('17')
    await adminApi.updateAnomalyStatus('17', 'RESOLVED')

    expect(fetchMock.mock.calls[0][0]).toBe('https://marketkz-api.onrender.com/api/v1/admin/anomalies/17')
    expect(fetchMock.mock.calls[1][0]).toBe('https://marketkz-api.onrender.com/api/v1/admin/anomalies/17/status')
    expect(fetchMock.mock.calls[1][1]).toMatchObject({ method: 'PATCH', credentials: 'include' })
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ status: 'RESOLVED' })
  })
})
