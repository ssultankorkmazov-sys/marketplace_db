// localStorage seeding: fresh install, migration from the old placeholder seed (v1 / pre-versioning), dev reset.
import { beforeEach, describe, expect, it } from 'vitest'
import { SEED_VERSION, T, resetAllData, resetCache } from '../src/data/store'
import * as auth from '../src/authService'

const ls = (k: string) => JSON.parse(localStorage.getItem(k) ?? 'null')
const set = (k: string, v: unknown) => localStorage.setItem(k, JSON.stringify(v))
beforeEach(() => { localStorage.clear(); resetCache() })

// What a browser that opened the OLD site looks like: placeholder rows 1..50, plus things the visitor created.
function seedLegacyBrowser({ withVersion }: { withVersion: boolean }) {
    const ph = (id: number) => ({ user_id: id, name: 'Madina Ospanova', email: 'madina.ospanova@mail.kz', phone: '+7 701 123 45 67', address: 'Алматы' })
    set('marketkz_users', [...Array.from({ length: 50 }, (_, i) => ph(i + 1)).map((u, i) => ({ ...u, email: `old${i + 1}@mail.kz`, phone: `+7 700 000 ${i}` })),
        { user_id: 51, name: 'Registered Reg', email: 'reg@x.kz', phone: '+7 777 000 00 01', address: null },
        { user_id: 53, name: 'Clash', email: 'ARUZHAN.SAPAROVA@gmail.com', phone: '+7 777 000 00 03', address: null }]) // collides with a real seed email
    set('marketkz_orders', [{ order_id: 1, user_id: 1, order_date: 'x', status: 'Delivered', total_amount: 1 },
        { order_id: 51, user_id: 3, order_date: 'x', status: 'Processing', total_amount: 5 },   // made as placeholder user 3 -> dropped
        { order_id: 52, user_id: 51, order_date: 'x', status: 'Processing', total_amount: 7 }, // made by registered user -> kept
        { order_id: 53, user_id: 53, order_date: 'x', status: 'Processing', total_amount: 9 }])
    set('marketkz_order_items', [{ order_item_id: 51, order_id: 51, product_id: 1, quantity: 1, unit_price: 5 }, { order_item_id: 52, order_id: 52, product_id: 2, quantity: 1, unit_price: 7 }, { order_item_id: 53, order_id: 53, product_id: 2, quantity: 1, unit_price: 9 }])
    set('marketkz_payments', [{ payment_id: 51, order_id: 51, payment_date: 'x', amount: 5, payment_method: 'Bank Card', status: 'Paid' }, { payment_id: 52, order_id: 52, payment_date: 'x', amount: 7, payment_method: 'Bank Card', status: 'Pending' }])
    set('marketkz_reviews', [{ review_id: 1, user_id: 1, product_id: 1, rating: 1, comment: 'placeholder', review_date: 'x' },
        { review_id: 51, user_id: 3, product_id: 1, rating: 2, comment: 'by placeholder identity', review_date: 'x' },
        { review_id: 52, user_id: 51, product_id: 1, rating: 3, comment: 'by registered user', review_date: 'x' }])
    set('marketkz_credentials', { 'reg@x.kz': 'secret1', 'old3@mail.kz': 'x' })
    set('marketkz_auth', { user_id: 3, email: 'old3@mail.kz', role: 'user', isAuthenticated: true })
    if (withVersion) localStorage.setItem('marketkz_seed_version', '1')
}

describe('seeding', () => {
    it('fresh browser: seeds the exact SQL data and records the version', () => {
        expect(T.users()).toHaveLength(50); expect(T.users()[0].email).toBe('aruzhan.saparova@gmail.com')
        expect(T.reviews()).toHaveLength(50); expect(T.payments()[0].payment_method).toBe('Kaspi Pay')
        expect(localStorage.getItem('marketkz_seed_version')).toBe(SEED_VERSION)
        expect(ls('marketkz_users')).toHaveLength(50) // persisted
    })
    it('does not overwrite persisted data when the version matches', () => {
        T.products(); const rows = ls('marketkz_products'); rows[0].price = 1; set('marketkz_products', rows); resetCache()
        expect(T.products()[0].price).toBe(1)
    })
})

for (const withVersion of [true, false]) {
    describe(`migration from the placeholder seed (${withVersion ? 'stored v1' : 'pre-versioning, no version key'})`, () => {
        beforeEach(() => { seedLegacyBrowser({ withVersion }); resetCache() })

        it('replaces every placeholder seed row with the SQL rows', () => {
            const users = T.users()
            expect(users[0]).toMatchObject({ name: 'Aruzhan Saparova', email: 'aruzhan.saparova@gmail.com' })
            expect(users[49].name).toBe('Amina Rakhmetova')
            expect(JSON.stringify(ls('marketkz_users'))).not.toContain('@mail.kz')
            expect(T.orders()[0]).toMatchObject({ order_id: 1, status: 'Delivered', total_amount: 399999 })
            expect(T.reviews()[0].comment).toBe('Excellent smartphone, very happy with the purchase.')
            expect(T.payments()[0]).toMatchObject({ payment_method: 'Kaspi Pay', status: 'Paid' })
            expect(localStorage.getItem('marketkz_seed_version')).toBe(SEED_VERSION)
        })

        it('keeps registered users and their orders/payments/reviews/credentials; drops the rest', () => {
            expect(T.users().map(u => u.user_id)).toEqual([...Array.from({ length: 50 }, (_, i) => i + 1), 51]) // 53 collided with a seed email -> dropped
            expect(T.orders().map(o => o.order_id)).toEqual([...Array.from({ length: 50 }, (_, i) => i + 1), 52])
            expect(T.orderItems().map(i => i.order_item_id).slice(50)).toEqual([52])
            expect(T.payments().map(p => p.payment_id).slice(50)).toEqual([52])
            expect(T.reviews().map(r => r.review_id).slice(50)).toEqual([52])
            expect(T.reviews().some(r => r.comment === 'placeholder' || r.comment === 'by placeholder identity')).toBe(false)
            expect(ls('marketkz_credentials')).toEqual({ 'reg@x.kz': 'secret1' })
        })

        it('signs out a session that pointed at a placeholder identity, keeps a registered one', () => {
            expect(auth.getSession()).toBeNull()
            expect(localStorage.getItem('marketkz_auth')).toBeNull()
            localStorage.clear(); resetCache(); seedLegacyBrowser({ withVersion })
            set('marketkz_auth', { user_id: 51, email: 'reg@x.kz', role: 'user', isAuthenticated: true }); resetCache()
            expect(auth.getSession()?.user_id).toBe(51)
            expect(auth.getCurrentUser()?.name).toBe('Registered Reg')
        })

        it('keeps the admin session and a registered user can still log in', () => {
            localStorage.clear(); resetCache(); seedLegacyBrowser({ withVersion })
            set('marketkz_auth', { user_id: 0, email: 'admin@marketkz.kz', role: 'admin', isAuthenticated: true }); resetCache()
            expect(auth.getSession()?.role).toBe('admin')
            expect(auth.login('reg@x.kz', 'secret1').user_id).toBe(51)
        })

        it('is idempotent: a second load changes nothing', () => {
            T.users(); const snap = JSON.stringify(Object.keys(localStorage).sort().map(k => [k, localStorage.getItem(k)]))
            resetCache(); T.users(); T.orders()
            expect(JSON.stringify(Object.keys(localStorage).sort().map(k => [k, localStorage.getItem(k)]))).toBe(snap)
        })
    })
}

describe('seeded users can sign in with the demo password; no password lives on user rows', () => {
    it('login works and rows stay password-free', () => {
        expect(auth.login('amina.bekova@gmail.com', 'user123').user_id).toBe(3)
        T.users().forEach(u => expect(Object.keys(u).sort()).toEqual(['address', 'email', 'name', 'phone', 'user_id']))
    })
})

describe('development reset', () => {
    it('resetAllData() wipes edits, registrations and session, then re-seeds the SQL data', () => {
        auth.register({ name: 'Temp', email: 'temp@x.kz', phone: '+7 700 9', address: '', password: 'secret1' })
        expect(T.users()).toHaveLength(51); expect(auth.isAuthenticated()).toBe(true)
        resetAllData()
        expect(auth.isAuthenticated()).toBe(false)
        expect(localStorage.getItem('marketkz_users')).toBeNull()
        expect(T.users()).toHaveLength(50); expect(T.reviews()).toHaveLength(50); expect(T.users()[2].name).toBe('Amina Bekova')
    })
})
