import type { Category, Product } from '../types/database'
import type { ProductStats } from '../services'

const API_ROOT = (import.meta.env.VITE_API_URL || '/api/v1').replace(/\/$/, '')

export interface ProductListOptions {
  q?: string;
  categoryId?: number;
  sortBy?: 'id' | 'price' | 'name';
  sortOrder?: 'asc' | 'desc';
  page?: number;
  pageSize?: number;
}

interface ProductPage {
  items: ProductStats[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${API_ROOT}${path}`, { ...init, credentials: 'include', headers: { Accept: 'application/json', ...(init.body ? { 'Content-Type': 'application/json' } : {}), ...init.headers } })
  if (!response.ok) {
    if (response.status === 404 || response.status === 401 || response.status === 409) throw Object.assign(new Error((await response.clone().json().catch(() => null) as { error?: string } | null)?.error || 'Request failed'), { status: response.status })
    const payload = await response.json().catch(() => null) as { error?: string } | null
    throw new Error(payload?.error || `API request failed (${response.status})`)
  }
  if (response.status === 204) return undefined as T
  return response.json() as Promise<T>
}

function queryString(options: ProductListOptions) {
  const params = new URLSearchParams()
  for (const key of ['q', 'categoryId', 'sortBy', 'sortOrder', 'page', 'pageSize'] as const) {
    const value = options[key]
    if (value !== undefined && value !== '') params.set(key, String(value))
  }
  const encoded = params.toString()
  return encoded ? `?${encoded}` : ''
}

export const catalogApi = {
  async categories(): Promise<(Category & { count: number })[]> {
    return request('/categories')
  },
  async category(id: number): Promise<(Category & { count: number }) | null> {
    try { return await request(`/categories/${id}`) }
    catch (error) { if ((error as { status?: number }).status === 404) return null; throw error }
  },
  async products(options: ProductListOptions = {}): Promise<ProductStats[]> {
    const result = await request<ProductPage>(`/products${queryString({ page: 1, pageSize: 100, ...options })}`)
    return result.items
  },
  async productsByCategory(id: number): Promise<ProductStats[]> {
    const result = await request<ProductPage>(`/categories/${id}/products?page=1&pageSize=100`)
    return result.items
  },
  async product(id: number): Promise<ProductStats | null> {
    try { return await request(`/products/${id}`) }
    catch (error) { if ((error as { status?: number }).status === 404) return null; throw error }
  },
}

export interface AuthUser { user_id: number; name: string; email: string; phone: string; address: string | null; role: 'user' | 'admin' }
export const authApi = {
  async login(email: string, password: string) { return request<{ user: AuthUser }>('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) }) },
  async register(input: { name: string; email: string; phone: string; address: string; password: string }) { return request<{ user: AuthUser }>('/auth/register', { method: 'POST', body: JSON.stringify(input) }) },
  async me() { return request<{ user: AuthUser }>('/auth/me') },
  async logout() { await request<void>('/auth/logout', { method: 'POST' }) },
  async updateProfile(input: { name: string; phone: string; address: string | null }) { return request<{ user: AuthUser }>('/profile', { method: 'PATCH', body: JSON.stringify(input) }) },
}

export interface OrderLineInput { product_id: number; quantity: number }
export interface ShippingInput { name: string; phone: string; city: string; address: string }
export interface ApiOrder { order_id: number; user_id: number; order_date: string; status: string; total_amount: number }
export interface ApiOrderLine { order_item_id: number; order_id: number; product_id: number; quantity: number; unit_price: number; product?: { product_id: number; name: string; description?: string | null; stock_quantity?: number; category_id?: number } }
export interface ApiPayment { payment_id: number; order_id: number; payment_date: string; amount: number; payment_method: string; status: string }
export interface ApiOrderBundle { order: ApiOrder; user: AuthUser; items: ApiOrderLine[]; payment: ApiPayment | null; shipping?: ShippingInput }
export const ordersApi = {
  async create(input: { items: OrderLineInput[]; shipping: ShippingInput; paymentMethod: string }) {
    return request<{ order: ApiOrder }>('/orders', { method: 'POST', body: JSON.stringify(input) })
  },
  async list() { return request<{ orders: (ApiOrder & { items: ApiOrderLine[]; payment: ApiPayment | null })[] }>('/orders') },
  async get(id: number) { return request<ApiOrderBundle>(`/orders/${id}`) },
}

export interface AdminOrder { order: ApiOrder; user: Pick<AuthUser, 'user_id'|'name'|'email'|'phone'|'address'>; payment: ApiPayment | null; items: ApiOrderLine[] }
export const adminApi = {
  async products() { return (await request<{ products: Product[] }>('/admin/products')).products },
  async createProduct(product: Omit<Product, 'product_id'>) {
    return (await request<{ product: Product }>('/admin/products', { method: 'POST', body: JSON.stringify(product) })).product
  },
  async updateProduct(id: number, product: Omit<Product, 'product_id'>) {
    return (await request<{ product: Product }>(`/admin/products/${id}`, { method: 'PATCH', body: JSON.stringify(product) })).product
  },
  async deleteProduct(id: number) { await request<void>(`/admin/products/${id}`, { method: 'DELETE' }) },
  async orders() { return (await request<{ orders: AdminOrder[] }>('/admin/orders')).orders },
}

