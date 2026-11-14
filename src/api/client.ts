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
export interface AdminCategory extends Category { count: number }
export interface AdminUser extends Pick<AuthUser, 'user_id'|'name'|'email'|'phone'|'address'> { order_count: number; review_count: number }
export interface AdminReview {
  review_id: number; user_id: number; product_id: number; rating: number; comment: string | null; review_date: string;
  user: { user_id: number; name: string }; product: { product_id: number; name: string }
}
export interface AuditLog {
  log_id: string;
  user_id: number | null;
  action: string;
  entity_type: string | null;
  entity_id: number | null;
  status: 'SUCCESS' | 'FAILURE';
  details: Record<string, unknown>;
  ip_address: string | null;
  created_at: string;
}
export interface AuditLogFilters {
  page?: number;
  pageSize?: number;
  action?: string;
  status?: 'SUCCESS' | 'FAILURE';
  userId?: number;
  from?: string;
  to?: string;
  q?: string;
}
export interface AuditLogPage extends AuditLogFilters {
  logs: AuditLog[];
  total: number;
  successful: number;
  failed: number;
  totalPages: number;
}
export type AnomalyType = 'REPEATED_FAILED_LOGINS' | 'REPEATED_ADMIN_ACCESS_DENIED' | 'UNUSUAL_ORDER_ACTIVITY'
export type AnomalySeverity = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'
export type AnomalyStatus = 'NEW' | 'INVESTIGATING' | 'RESOLVED' | 'FALSE_POSITIVE'
export interface AnomalyRecommendation { action: string; reason: string; priority: 'LOW' | 'MEDIUM' | 'HIGH'; verification_step: string }
export interface AnomalyIncident {
  incident_id: string; anomaly_type: AnomalyType; subject_user_id: number | null; severity: AnomalySeverity; risk_score: number; status: AnomalyStatus;
  detected_at: string; updated_at: string; first_event_at: string; last_event_at: string; evidence: Record<string, unknown>; explanation: string;
  recommendations: AnomalyRecommendation[]; deduplication_key: string; audit_log_ids: string[]; timeline: AnomalyAuditEvent[]
}
export interface AnomalyAuditEvent {
  log_id: string; created_at: string; action: string; status: 'SUCCESS' | 'FAILURE'; entity_type: string | null; entity_id: number | null
}
export interface AnomalyFilters { page?: number; pageSize?: number; severity?: AnomalySeverity; type?: AnomalyType; status?: AnomalyStatus; from?: string; to?: string }
export interface AnomalyPage {
  incidents: AnomalyIncident[]; page: number; pageSize: number; total: number; low: number; medium: number; high: number; critical: number; totalPages: number
}
export interface AnomalyQueueStats { pending: number; processed: number; dead_letter: number; processing_errors: number; last_processed_at: string | null }
export type StatisticalActionCategory = 'AUTH' | 'ORDER' | 'ADMIN_DENIED' | 'PRODUCT_ADMIN' | 'OTHER'
export type StatisticalDetectorStatus = 'DISABLED' | 'NOT_INTEGRATED' | 'INSUFFICIENT_DATA' | 'AVAILABLE'
export type StatisticalCalibrationStatus = 'NOT_RUN' | 'INSUFFICIENT_DATA' | 'CALIBRATED'
export interface StatisticalAnomalySnapshot {
  detector: 'JEFFREYS_DIVERGENCE'; experimental: true; operational: false
  detector_status: StatisticalDetectorStatus; calibration_status: StatisticalCalibrationStatus; calibration_sufficient: boolean
  divergence: number | null
  baseline: { sample_count: number | null; distribution: Record<StatisticalActionCategory, number> | null }
  current: { sample_count: number | null; distribution: Record<StatisticalActionCategory, number> | null }
  category_contributions: Record<StatisticalActionCategory, number> | null
  evaluated_at: string | null
}
export function auditWebSocketUrl(): string {
  const url = new URL(`${API_ROOT}/admin/logs/stream`, window.location.href);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  return url.toString();
}

export const adminApi = {
  async categories() { return (await request<{ categories: AdminCategory[] }>('/admin/categories')).categories },
  async createCategory(name: string) { return (await request<{ category: AdminCategory }>('/admin/categories', { method: 'POST', body: JSON.stringify({ name }) })).category },
  async updateCategory(id: number, name: string) { return (await request<{ category: AdminCategory }>(`/admin/categories/${id}`, { method: 'PATCH', body: JSON.stringify({ name }) })).category },
  async deleteCategory(id: number) { await request<void>(`/admin/categories/${id}`, { method: 'DELETE' }) },
  async users() { return (await request<{ users: AdminUser[] }>('/admin/users')).users },
  async reviews() { return (await request<{ reviews: AdminReview[] }>('/admin/reviews')).reviews },
  async deleteReview(id: number) { await request<void>(`/admin/reviews/${id}`, { method: 'DELETE' }) },
  async products() { return (await request<{ products: Product[] }>('/admin/products')).products },
  async createProduct(product: Omit<Product, 'product_id'>) {
    return (await request<{ product: Product }>('/admin/products', { method: 'POST', body: JSON.stringify(product) })).product
  },
  async updateProduct(id: number, product: Omit<Product, 'product_id'>) {
    return (await request<{ product: Product }>(`/admin/products/${id}`, { method: 'PATCH', body: JSON.stringify(product) })).product
  },
  async deleteProduct(id: number) { await request<void>(`/admin/products/${id}`, { method: 'DELETE' }) },
  async orders() { return (await request<{ orders: AdminOrder[] }>('/admin/orders')).orders },
  async updateOrderStatus(id: number, status: string) {
    return request<{ order: { order_id: number; status: string } }>(`/admin/orders/${id}/status`, { method: 'PATCH', body: JSON.stringify({ status }) });
  },
  async logs(filters: AuditLogFilters = {}) {
    const params = new URLSearchParams();
    for (const key of ['page', 'pageSize', 'action', 'status', 'userId', 'from', 'to', 'q'] as const) {
      const value = filters[key];
      if (value !== undefined && value !== '') params.set(key, String(value));
    }
    const query = params.toString();
    return request<AuditLogPage>(`/admin/logs${query ? `?${query}` : ''}`);
  },
  async log(id: number) { return (await request<{ log: AuditLog }>(`/admin/logs/${id}`)).log },
  async anomalies(filters: AnomalyFilters = {}) {
    const params = new URLSearchParams()
    for (const key of ['page', 'pageSize', 'severity', 'type', 'status', 'from', 'to'] as const) {
      const value = filters[key]
      if (value !== undefined && value !== '') params.set(key, String(value))
    }
    const query = params.toString()
    return request<AnomalyPage>(`/admin/anomalies${query ? `?${query}` : ''}`)
  },
  async anomalyQueueStats() { return request<AnomalyQueueStats>('/admin/anomalies/queue-stats') },
  async statisticalAnomalyStatus() { return request<StatisticalAnomalySnapshot>('/admin/anomalies/statistical-status') },
  async anomaly(id: string) { return (await request<{ incident: AnomalyIncident }>(`/admin/anomalies/${encodeURIComponent(id)}`)).incident },
  async updateAnomalyStatus(id: string, status: Exclude<AnomalyStatus, 'NEW'>) {
    return (await request<{ incident: Partial<AnomalyIncident> & Pick<AnomalyIncident, 'incident_id' | 'status'> }>(`/admin/anomalies/${encodeURIComponent(id)}/status`, { method: 'PATCH', body: JSON.stringify({ status }) })).incident
  },
}

