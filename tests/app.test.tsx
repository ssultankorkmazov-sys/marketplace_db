// jsdom smoke tests driving the real <App/> through the real services + localStorage.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { BrowserRouter, MemoryRouter } from 'react-router-dom'
import App from '../src/App'
import { AuthProvider } from '../src/context/Auth'
import { StoreProvider } from '../src/context/Store'
import { resetCache } from '../src/data/store'
import * as auth from '../src/authService'
import * as svc from '../src/services'
import { formatPrice } from '../src/components/ui'

const tree = () => <AuthProvider><StoreProvider><App /></StoreProvider></AuthProvider>
const mount = (path: string) => render(<MemoryRouter initialEntries={[path]}>{tree()}</MemoryRouter>)
// "Page refresh": drop React tree and the in-memory table cache, keep localStorage.
const refresh = (path: string) => { cleanup(); resetCache(); return mount(path) }
const esc = (t: string) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
// Error messages render inside the <label>, so match on the label prefix.
const type = (label: string, value: string) => fireEvent.change(screen.getByLabelText(new RegExp('^' + esc(label))), { target: { value } })
// formatPrice() uses non-breaking spaces; compare whitespace-normalised cell text.
const norm = (t: string | null | undefined) => (t ?? '').replace(/\s/g, ' ')
const cell = (text: string) => screen.findByText((_, el) => el?.tagName === 'TD' && norm(el.textContent) === norm(text))
const ls = (k: string) => JSON.parse(localStorage.getItem(k) ?? 'null')

beforeEach(() => { cleanup(); localStorage.clear(); resetCache(); vi.spyOn(window, 'confirm').mockReturnValue(true) })
afterEach(() => { cleanup(); vi.restoreAllMocks() })

const USER3 = { email: 'amina.bekova@gmail.com', password: 'user123' } // seeded user_id 3 (demo password)

describe('1-5. register, login, refresh, logout', () => {
    it('validates the registration form', async () => {
        mount('/register')
        fireEvent.click(screen.getByRole('button', { name: 'Создать аккаунт' }))
        expect(await screen.findByText('Введите имя')).toBeTruthy()
        expect(screen.getByText('Введите корректный email')).toBeTruthy()
        expect(screen.getByText('Введите телефон')).toBeTruthy()
        expect(screen.getByText('Минимум 6 символов')).toBeTruthy()
        type('Имя', 'Test'); type('Email', 'x@y.kz'); type('Телефон', '+7 700 000 00 00'); type('Пароль', 'secret1'); type('Повторите пароль', 'secret2')
        fireEvent.click(screen.getByRole('button', { name: 'Создать аккаунт' }))
        expect(await screen.findByText('Пароли не совпадают')).toBeTruthy()
        expect(ls('marketkz_users')?.length ?? 50).toBe(50)
    })

    it('rejects an email that already exists', async () => {
        mount('/register')
        type('Имя', 'Dup'); type('Email', 'ARUZHAN.SAPAROVA@gmail.com'); type('Телефон', '+7 700 111 11 11'); type('Пароль', 'secret1'); type('Повторите пароль', 'secret1')
        fireEvent.click(screen.getByRole('button', { name: 'Создать аккаунт' }))
        expect(await screen.findByText('Пользователь с таким email уже существует')).toBeTruthy()
    })

    it('registers, authenticates, persists across refresh, logs out and logs in again', async () => {
        mount('/register')
        type('Имя', 'Новый Клиент'); type('Email', 'new.client@mail.kz'); type('Телефон', '+7 701 555 55 55'); type('Адрес', 'Алматы, Абая 1'); type('Пароль', 'secret1'); type('Повторите пароль', 'secret1')
        fireEvent.click(screen.getByRole('button', { name: 'Создать аккаунт' }))
        expect(await screen.findByText('Личный кабинет')).toBeTruthy()
        expect(screen.getAllByText('Новый Клиент').length).toBeGreaterThan(0)

        // new DB-shaped row, new user_id, NO password on it; credentials live in a separate key
        const users = ls('marketkz_users')
        expect(users).toHaveLength(51)
        const row = users[50]
        expect(row.user_id).toBe(51)
        expect(Object.keys(row).sort()).toEqual(['address', 'email', 'name', 'phone', 'user_id'])
        expect(JSON.stringify(users)).not.toContain('secret1')
        expect(ls('marketkz_auth')).toMatchObject({ user_id: 51, role: 'user', isAuthenticated: true })

        // refresh -> still signed in
        refresh('/profile')
        expect(await screen.findByText('Личный кабинет')).toBeTruthy()
        expect(screen.getAllByText('new.client@mail.kz').length).toBeGreaterThan(0)

        // logout (profile page button - works on mobile too) -> /profile now redirects to login
        fireEvent.click(screen.getAllByRole('button', { name: /Выйти/ })[0])
        await waitFor(() => expect(auth.isAuthenticated()).toBe(false))
        refresh('/profile')
        expect(await screen.findByText('Вход в MarketKZ')).toBeTruthy()

        // login again with the registered credentials
        type('Email', 'new.client@mail.kz'); type('Пароль', 'secret1')
        fireEvent.click(screen.getByRole('button', { name: 'Войти' }))
        expect(await screen.findByText('Личный кабинет')).toBeTruthy()
    })

    it('rejects a wrong password', async () => {
        mount('/login')
        type('Email', USER3.email); type('Пароль', 'nope')
        fireEvent.click(screen.getByRole('button', { name: 'Войти' }))
        expect(await screen.findByText('Неверный email или пароль')).toBeTruthy()
        expect(auth.isAuthenticated()).toBe(false)
    })

    it('shows Login/Register links when signed out', () => {
        mount('/')
        expect(screen.getAllByRole('link', { name: 'Войти' }).length).toBeGreaterThan(0)
        expect(screen.getAllByRole('link', { name: 'Регистрация' }).length).toBeGreaterThan(0)
    })

    it('profile edit persists', async () => {
        auth.login(USER3.email, USER3.password)
        mount('/profile')
        fireEvent.click(await screen.findByRole('button', { name: /Редактировать профиль/ }))
        type('Телефон', '+7 777 000 11 22')
        fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }))
        await waitFor(() => expect(ls('marketkz_users')[2].phone).toBe('+7 777 000 11 22'))
        refresh('/profile')
        expect(await screen.findByText('+7 777 000 11 22')).toBeTruthy()
    })
})

describe('6-10. product page reviews', () => {
    it('shows rating summary, distribution, user name, date and comment from the seed', async () => {
        mount('/product/1')
        expect(await screen.findByText('Excellent smartphone, very happy with the purchase.')).toBeTruthy()
        expect(screen.getByText('Aruzhan Saparova')).toBeTruthy()
        expect(screen.getAllByText(/5 августа 2026/).length).toBeGreaterThan(0)
        expect(screen.getAllByText('1 отзыв').length).toBeGreaterThan(0)
        for (const n of [5, 4, 3, 2, 1]) expect(screen.getByText(`${n} ★`)).toBeTruthy()
    })

    it('asks guests to log in', async () => {
        mount('/product/1')
        expect(await screen.findByText(/Пожалуйста, войдите, чтобы оставить отзыв/)).toBeTruthy()
    })

    it('lets a logged-in user write a review that shows immediately, recalculates and survives refresh', async () => {
        auth.login(USER3.email, USER3.password)
        mount('/product/1')
        await screen.findByText('Excellent smartphone, very happy with the purchase.')
        fireEvent.click(screen.getByRole('radio', { name: '3 из 5' }))
        fireEvent.change(screen.getByLabelText('Комментарий'), { target: { value: 'Battery is average.' } })
        fireEvent.click(screen.getByRole('button', { name: 'Отправить отзыв' }))
        expect(await screen.findByText('Battery is average.')).toBeTruthy()
        expect(screen.getByText('Amina Bekova')).toBeTruthy()
        expect(screen.getAllByText('2 отзыва').length).toBeGreaterThan(0)
        expect(screen.getAllByText('4.0').length).toBeGreaterThan(0) // (5+3)/2

        const saved = ls('marketkz_reviews')
        expect(saved).toHaveLength(51)
        expect(saved[50]).toMatchObject({ review_id: 51, user_id: 3, product_id: 1, rating: 3, comment: 'Battery is average.' })

        refresh('/product/1')
        expect(await screen.findByText('Battery is average.')).toBeTruthy()
    })
})

describe('11-21. admin panel', () => {
    const asAdmin = () => auth.login('admin@marketkz.kz', 'admin123')
    const rows = () => screen.getAllByRole('row').length - 1 // minus header

    it('dashboard totals come from the data (50/50/50/50/50) and revenue is computed from orders', async () => {
        asAdmin(); mount('/admin')
        await screen.findByText('Дашборд', { selector: 'h1' })
        const val = (label: string) => screen.getAllByText(label).map(e => e.previousElementSibling?.textContent).find(t => t && /\d/.test(t))
        await waitFor(() => expect(val('Товары')).toBe('50'))
        expect(val('Категории')).toBe('50'); expect(val('Пользователи')).toBe('50'); expect(val('Заказы')).toBe('50'); expect(val('Отзывы')).toBe('50')
        const expected = (await svc.getOrders()).filter(x => x.order.status !== 'Cancelled').reduce((a, x) => a + x.order.total_amount, 0)
        expect(val('Выручка')).toBe(formatPrice(expected))
    })

    it('users: lists 50, searches by name / email / phone, opens details, never shows passwords', async () => {
        asAdmin(); mount('/admin/users')
        await waitFor(() => expect(rows()).toBe(50))
        const q = screen.getByLabelText('Поиск пользователей')
        fireEvent.change(q, { target: { value: 'dias' } }); await waitFor(() => expect(rows()).toBe(2)) // Dias Nurlanov + Dias Tolegen
        fireEvent.change(q, { target: { value: 'nurlanov' } }); await waitFor(() => expect(rows()).toBe(1))
        fireEvent.change(q, { target: { value: 'amina.bekova@' } }); await waitFor(() => expect(rows()).toBe(1))
        fireEvent.change(q, { target: { value: '+77011234501' } }); await waitFor(() => expect(rows()).toBe(1))
        fireEvent.click(screen.getByRole('button', { name: 'Профиль Aruzhan Saparova' }))
        expect(await screen.findByRole('dialog')).toBeTruthy()
        expect(document.body.textContent).not.toMatch(/user123|admin123|password|пароль/i)
    })

    it('products: lists 50, edit persists, create persists', async () => {
        asAdmin(); mount('/admin/products')
        await waitFor(() => expect(rows()).toBe(50))
        fireEvent.click(screen.getByRole('button', { name: 'Изменить iPhone 15' }))
        await screen.findByLabelText(/^Цена/); type('Цена, ₸', '410000')
        fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }))
        expect(await cell(formatPrice(410000))).toBeTruthy()
        expect(ls('marketkz_products')[0]).toMatchObject({ product_id: 1, price: 410000 })
        refresh('/admin/products')
        expect(await cell(formatPrice(410000))).toBeTruthy()

        fireEvent.click(screen.getByRole('button', { name: /Добавить товар/ }))
        await screen.findByLabelText(/^Название/)
        type('Название', 'Test Gadget'); type('Цена, ₸', '1000'); type('Остаток', '5')
        fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }))
        expect(await screen.findByText('Test Gadget')).toBeTruthy()
        expect(ls('marketkz_products')).toHaveLength(51)
        expect(ls('marketkz_products')[50].product_id).toBe(51)
    })

    it('categories: lists 50 with product counts; deleting a used category is blocked, an empty one works', async () => {
        asAdmin(); mount('/admin/categories')
        await waitFor(() => expect(rows()).toBe(50))
        fireEvent.click(screen.getByRole('button', { name: 'Удалить Smartphones' }))
        expect(await screen.findByText(/Нельзя удалить: в категории 3 товар/)).toBeTruthy()
        expect(ls('marketkz_categories')).toHaveLength(50)
        fireEvent.click(screen.getByRole('button', { name: 'Удалить Other' })) // 0 products
        await waitFor(() => expect(rows()).toBe(49))
        expect(ls('marketkz_categories')).toHaveLength(49)
    })

    it('orders: lists 50, status change persists across refresh, details open', async () => {
        asAdmin(); mount('/admin/orders')
        await waitFor(() => expect(rows()).toBe(50))
        const sel = screen.getByLabelText('Статус заказа 1') as HTMLSelectElement
        expect([...sel.options].map(o => o.value)).toEqual(['Processing', 'Shipped', 'Delivered', 'Cancelled'])
        fireEvent.change(sel, { target: { value: 'Cancelled' } })
        await waitFor(() => expect(ls('marketkz_orders')[0].status).toBe('Cancelled'))
        refresh('/admin/orders')
        await waitFor(() => expect((screen.getByLabelText('Статус заказа 1') as HTMLSelectElement).value).toBe('Cancelled'))
        fireEvent.click(screen.getByRole('button', { name: 'Заказ 1' }))
        expect(within(await screen.findByRole('dialog')).getByText(/Итого/)).toBeTruthy()
    })

    it('reviews: lists 50, filters work, deleting one updates the product rating immediately', async () => {
        asAdmin()
        expect((await svc.getProductById(1))!.reviews).toBe(1)
        mount('/admin/reviews')
        await waitFor(() => expect(rows()).toBe(50))
        fireEvent.change(screen.getByLabelText('Фильтр по товару'), { target: { value: '1' } })
        await waitFor(() => expect(rows()).toBe(1))
        fireEvent.click(screen.getByRole('button', { name: 'Удалить отзыв 1' }))
        await waitFor(() => expect(ls('marketkz_reviews')).toHaveLength(49))
        const p = (await svc.getProductById(1))!
        expect([p.reviews, p.rating]).toEqual([0, 0])
        refresh('/product/1')
        expect(await screen.findByText('Отзывов пока нет.')).toBeTruthy()
    })
})

describe('22. access control', () => {
    it('redirects guests from every /admin route to /login', async () => {
        for (const path of ['/admin', '/admin/products', '/admin/categories', '/admin/users', '/admin/orders', '/admin/reviews']) {
            mount(path)
            expect(await screen.findByText('Вход в MarketKZ'), path).toBeTruthy()
            cleanup()
        }
    })
    it('redirects a normal user from /admin to the storefront', async () => {
        auth.login(USER3.email, USER3.password)
        mount('/admin/users')
        expect(await screen.findByText(/Всё нужное/)).toBeTruthy()
        expect(screen.queryByText('Админ-панель')).toBeNull()
    })
    it('does not expose the Admin Panel menu entry to normal users, but does to admin', async () => {
        auth.login(USER3.email, USER3.password)
        mount('/')
        await screen.findByText(/Всё нужное/)
        expect(screen.queryByRole('link', { name: 'Админ-панель' })).toBeNull()
        cleanup(); auth.logout(); auth.login('admin@marketkz.kz', 'admin123'); mount('/')
        expect(await screen.findByRole('link', { name: 'Админ-панель' })).toBeTruthy()
    })
    it('admin cannot place storefront orders (no user_id 0 orders)', async () => {
        auth.login('admin@marketkz.kz', 'admin123'); localStorage.setItem('cart', JSON.stringify({ 1: 1 }))
        mount('/checkout')
        expect(await screen.findByText(/недоступно администратору/)).toBeTruthy()
    })
    it('also accepts the alternate demo admin address from the brief (admin@marketz.kz)', () => {
        expect(auth.login('admin@marketz.kz', 'admin123').role).toBe('admin')
        expect(() => auth.login('admin@marketkz.kz', 'wrong')).toThrow()
    })
})

describe('23 + regression: existing storefront features', () => {
    it('categories page shows all 50 categories', async () => {
        mount('/categories')
        await screen.findByText('Smartphones')
        expect(document.querySelectorAll('a[href^="/category/"]').length).toBe(50)
        expect(screen.getByText('Software')).toBeTruthy()
    })
    it('category page + price filter', async () => {
        mount('/category/1')
        await screen.findByText(/Найдено 3 товаров/)
        fireEvent.change(screen.getAllByLabelText('Цена от')[0], { target: { value: '300000' } })
        await screen.findByText(/Найдено 2 товаров/)
    })
    it('search finds products by name', async () => {
        mount('/search?q=nike')
        await screen.findByText(/Найдено 2 товаров/)
    })
    it('sorting by price puts the cheapest first', async () => {
        mount('/search?q=')
        await screen.findByText(/Найдено 50 товаров/)
        fireEvent.change(screen.getByLabelText('Сортировка'), { target: { value: 'asc' } })
        await waitFor(() => expect(document.querySelector('article a[href^="/product/"]:not([tabindex])')?.textContent).toBe('Notebook A5'))
    })
    it('cart respects stock limits and checkout creates order + items + payment', async () => {
        auth.login(USER3.email, USER3.password)
        localStorage.setItem('cart', JSON.stringify({ 14: 2 })) // Sony Alpha A6400, stock 8
        mount('/cart')
        await screen.findByText('Sony Alpha A6400')
        // the cart re-renders (skeleton) on every change, so await the button each time
        for (let i = 0; i < 12; i++) {
            const plus = await screen.findByRole('button', { name: 'Больше' })
            if (!plus.hasAttribute('disabled')) fireEvent.click(plus)
        }
        await waitFor(() => expect(screen.getByRole('button', { name: 'Больше' }).hasAttribute('disabled')).toBe(true))
        expect(JSON.parse(localStorage.getItem('cart')!)[14]).toBe(8)
        cleanup(); mount('/checkout')
        fireEvent.click(await screen.findByRole('button', { name: 'Подтвердить заказ' }))
        expect(await screen.findByText('Заказ успешно оформлен!')).toBeTruthy()
        expect(ls('marketkz_orders')).toHaveLength(51)
        expect(ls('marketkz_orders')[50]).toMatchObject({ order_id: 51, user_id: 3, status: 'Processing', total_amount: 8 * 399999 })
        expect(ls('marketkz_order_items')[50]).toMatchObject({ order_id: 51, product_id: 14, quantity: 8 })
        expect(ls('marketkz_payments')[50]).toMatchObject({ order_id: 51, amount: 8 * 399999 })
        cleanup(); mount('/orders/51')
        expect(await screen.findByText('Заказ #51', { selector: 'h1' })).toBeTruthy()
    })
    it('favorites toggle works', async () => {
        mount('/product/1')
        fireEvent.click((await screen.findAllByRole('button', { name: /В избранное/ }))[0])
        await waitFor(() => expect(JSON.parse(localStorage.getItem('favs')!)).toEqual([1]))
        cleanup(); mount('/favorites')
        expect(await screen.findByText('iPhone 15')).toBeTruthy()
    })
    it('unknown route shows the not-found state instead of crashing', async () => {
        mount('/definitely/not/a/page')
        expect(await screen.findByText('Страница не найдена')).toBeTruthy()
    })
})

describe('SQL seed is what the UI actually shows', () => {
    it('product 50 shows its real reviewer, comment and date', async () => {
        mount('/product/50')
        expect(await screen.findByText('Gamepad works perfectly.')).toBeTruthy()
        expect(screen.getByText('Amina Rakhmetova')).toBeTruthy()
        expect(screen.getAllByText(/20 сентября 2026/).length).toBeGreaterThan(0)
    })
    it('admin orders shows the real customer and payment of order 1 and order 50', async () => {
        auth.login('admin@marketkz.kz', 'admin123'); mount('/admin/orders')
        await waitFor(() => expect(screen.getAllByRole('row').length - 1).toBe(50))
        const row = (n: number) => screen.getByText(`#${n}`).closest('tr')!
        expect(within(row(1)).getByText('Aruzhan Saparova')).toBeTruthy(); expect(within(row(1)).getByText(/Kaspi Pay · Paid/)).toBeTruthy()
        expect(within(row(50)).getByText('Amina Rakhmetova')).toBeTruthy(); expect(within(row(50)).getByText(/Bank Card · Paid/)).toBeTruthy()
        expect((within(row(5)).getByLabelText('Статус заказа 5') as HTMLSelectElement).value).toBe('Processing')
    })
    it('admin reviews shows real user and product names', async () => {
        auth.login('admin@marketkz.kz', 'admin123'); mount('/admin/reviews')
        await waitFor(() => expect(screen.getAllByRole('row').length - 1).toBe(50))
        const r1 = screen.getByText('Excellent smartphone, very happy with the purchase.').closest('tr')!
        expect(within(r1).getByText('Aruzhan Saparova')).toBeTruthy(); expect(within(r1).getByText('iPhone 15')).toBeTruthy()
    })
    it('a browser holding the OLD placeholder data shows the SQL data after the update', async () => {
        localStorage.setItem('marketkz_users', JSON.stringify([{ user_id: 1, name: 'Madina Ospanova', email: 'madina.ospanova@mail.kz', phone: '+7 701 123 45 67', address: 'x' }]))
        localStorage.setItem('marketkz_reviews', JSON.stringify([{ review_id: 1, user_id: 1, product_id: 1, rating: 3, comment: 'Excellent product, very happy with the purchase.', review_date: '2026-08-05T10:00:00' }]))
        localStorage.setItem('marketkz_seed_version', '1'); resetCache()
        mount('/product/1')
        expect(await screen.findByText('Excellent smartphone, very happy with the purchase.')).toBeTruthy()
        expect(screen.getByText('Aruzhan Saparova')).toBeTruthy()
        expect(screen.queryByText('Madina Ospanova')).toBeNull()
        expect(screen.queryByText('Excellent product, very happy with the purchase.')).toBeNull()
    })
})

describe('GitHub Pages routing', () => {
    it('serves deep links under the /marketplace_db/ basename (same router config as main.tsx)', async () => {
        window.history.pushState({}, '', '/marketplace_db/product/2')
        render(<BrowserRouter basename="/marketplace_db/">{tree()}</BrowserRouter>)
        expect(await screen.findByText('Great phone and fast delivery.')).toBeTruthy()
        expect(screen.getByText('Dias Nurlanov')).toBeTruthy()
        cleanup()
        window.history.pushState({}, '', '/marketplace_db/admin')
        render(<BrowserRouter basename="/marketplace_db/">{tree()}</BrowserRouter>)
        expect(await screen.findByText('Вход в MarketKZ')).toBeTruthy()
        expect(window.location.pathname).toBe('/marketplace_db/login')
    })
})
