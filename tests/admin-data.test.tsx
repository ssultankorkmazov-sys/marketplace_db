import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { BrowserRouter } from 'react-router-dom'
import { AdminCategories, AdminReviews, AdminUsers } from '../src/pages/Admin'

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
const category = { category_id: 6, category_name: 'Cameras', count: 1 }
const user = { user_id: 7, name: 'Buyer', email: 'buyer@example.kz', phone: '+77000000007', address: null, order_count: 2, review_count: 1 }
const review = { review_id: 3, user_id: 7, product_id: 8, rating: 5, comment: 'Works well', review_date: '2026-10-13T00:00:00Z', user: { user_id: 7, name: 'Buyer' }, product: { product_id: 8, name: 'Camera' } }

afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks() })

describe('admin entity screens', () => {
  it('loads categories from the admin API and shows API errors', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(json({ categories: [category] })).mockResolvedValueOnce(json({ error: 'Database unavailable' }, 500))
    vi.stubGlobal('fetch', fetchMock)
    const { unmount } = render(<BrowserRouter><AdminCategories/></BrowserRouter>)
    expect(await screen.findByText('Cameras')).toBeTruthy()
    expect(fetchMock.mock.calls[0][0]).toContain('/admin/categories')
    unmount()
    render(<BrowserRouter><AdminCategories/></BrowserRouter>)
    expect(await screen.findByText('Не удалось загрузить данные')).toBeTruthy()
    expect(screen.getByText(/Database unavailable/)).toBeTruthy()
  })

  it('loads safe user details and review data from protected APIs', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.endsWith('/admin/users')) return json({ users: [user] })
      if (url.endsWith('/admin/reviews')) return json({ reviews: [review] })
      if (url.endsWith('/admin/products')) return json({ products: [{ product_id: 8, name: 'Camera', description: null, price: 10, stock_quantity: 1, category_id: 6 }] })
      return json({ error: 'Unexpected request' }, 500)
    })
    vi.stubGlobal('fetch', fetchMock)
    const { unmount } = render(<BrowserRouter><AdminUsers/></BrowserRouter>)
    expect(await screen.findByText('buyer@example.kz')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Профиль Buyer' }))
    expect(screen.getByText('2')).toBeTruthy()
    unmount()
    render(<BrowserRouter><AdminReviews/></BrowserRouter>)
    expect(await screen.findByText('Works well')).toBeTruthy()
    expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith('/admin/reviews'))).toBe(true)
  })

  it('shows an API error after review deletion fails', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.endsWith('/admin/reviews')) return json({ reviews: [review] })
      if (url.endsWith('/admin/users')) return json({ users: [user] })
      if (url.endsWith('/admin/products')) return json({ products: [{ product_id: 8, name: 'Camera', description: null, price: 10, stock_quantity: 1, category_id: 6 }] })
      return json({ error: 'Delete failed' }, 500)
    })
    vi.stubGlobal('fetch', fetchMock)
    render(<BrowserRouter><AdminReviews/></BrowserRouter>)
    fireEvent.click(await screen.findByRole('button', { name: 'Удалить отзыв 3' }))
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Delete failed'))
  })
})
