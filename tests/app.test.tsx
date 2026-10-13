import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { BrowserRouter } from 'react-router-dom'
import { AuthProvider } from '../src/context/Auth'
import { StoreProvider } from '../src/context/Store'
import App from '../src/App'

const user = { user_id: 51, name: 'Test User', email: 'test@example.kz', phone: '+77001234567', address: null, role: 'user' }
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
function mount(path: string) { window.history.pushState({}, '', path); render(<BrowserRouter><AuthProvider><StoreProvider><App/></StoreProvider></AuthProvider></BrowserRouter>) }

beforeEach(() => { cleanup(); localStorage.clear(); window.history.replaceState({}, '', '/'); vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => String(input).endsWith('/auth/me') ? json({ error: 'Требуется вход.' }, 401) : json({ error: 'Unexpected request' }, 500))) })
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe('server-backed account flows', () => {
  it('registers through the API and never persists credentials in browser storage', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).endsWith('/auth/me')) return json({ error: 'Требуется вход.' }, 401)
      if (String(input).endsWith('/auth/register')) {
        expect(JSON.parse(String(init?.body))).toMatchObject({ email: 'test@example.kz', password: 'long-password' })
        return json({ user }, 201)
      }
      return json({ error: 'Unexpected request' }, 500)
    }))
    mount('/register')
    fireEvent.change(screen.getByLabelText('Имя'), { target: { value: user.name } })
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: user.email } })
    fireEvent.change(screen.getByLabelText('Телефон'), { target: { value: user.phone } })
    fireEvent.change(screen.getByLabelText('Пароль', { selector: 'input' }), { target: { value: 'long-password' } })
    fireEvent.change(screen.getByLabelText('Повторите пароль'), { target: { value: 'long-password' } })
    fireEvent.click(screen.getByRole('button', { name: 'Создать аккаунт' }))
    await waitFor(() => expect(window.location.pathname).toBe('/profile'))
    expect(localStorage.getItem('marketkz_credentials')).toBeNull()
    expect(localStorage.getItem('marketkz_auth')).toBeNull()
  })

  it('shows server validation errors on login', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => String(input).endsWith('/auth/me')
      ? json({ error: 'Требуется вход.' }, 401) : json({ error: 'Неверный email или пароль.' }, 401)))
    mount('/login')
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: user.email } })
    fireEvent.change(screen.getByLabelText('Пароль'), { target: { value: 'wrong-password' } })
    fireEvent.click(screen.getByRole('button', { name: 'Войти' }))
    expect(await screen.findByText('Неверный email или пароль.')).toBeTruthy()
  })
})
