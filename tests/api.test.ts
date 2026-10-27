import { afterEach, describe, expect, it, vi } from 'vitest'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  vi.resetModules()
})

describe('configured production API URL', () => {
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
})
