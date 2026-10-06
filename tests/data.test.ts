// Verifies src/data/mock.ts against db/marketplace_db.sql (the source of truth) using an INDEPENDENT parser,
// plus hard-coded spot checks taken from the project brief.
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { categories, orderItems, orders, payments, products, reviews, users } from '../src/data/mock'
import { productImage } from '../src/data/productImages'

const SQL = fs.readFileSync(path.resolve(__dirname, '../db/marketplace_db.sql'), 'utf8')

// Line-based parser: every tuple of an INSERT sits on its own line "(v1, 'v2', ...),".
function rowsOf(table: string): (string | number)[][] {
    const m = SQL.match(new RegExp(`INSERT INTO ${table}\\s*(?:\\([^)]*\\))?\\s*VALUES([\\s\\S]*?);`, 'i'))
    if (!m) throw new Error('no INSERT for ' + table)
    return m[1].split('\n').map(l => l.trim()).filter(l => l.startsWith('(')).map(l => {
        const vals: (string | number)[] = []
        for (const t of l.matchAll(/'((?:[^']|'')*)'|(-?\d+(?:\.\d+)?)/g)) vals.push(t[1] !== undefined ? t[1].replace(/''/g, "'") : Number(t[2]))
        return vals
    })
}
const iso = (s: string | number) => String(s).replace(' ', 'T')
const sqlUsers = rowsOf('users'), sqlCats = rowsOf('categories'), sqlProducts = rowsOf('products'), sqlOrders = rowsOf('orders')
const sqlItems = rowsOf('order_items'), sqlPays = rowsOf('payments'), sqlReviews = rowsOf('reviews')

describe('record counts (350 total)', () => {
    it('SQL file itself has 50 rows per table', () => {
        for (const r of [sqlUsers, sqlCats, sqlProducts, sqlOrders, sqlItems, sqlPays, sqlReviews]) expect(r).toHaveLength(50)
    })
    it('seed has exactly 50 in every table, 350 overall', () => {
        const all = { categories, users, products, orders, orderItems, payments, reviews }
        for (const [k, v] of Object.entries(all)) expect(v, k).toHaveLength(50)
        expect(Object.values(all).reduce((a, v) => a + v.length, 0)).toBe(350)
    })
    it('ids are exactly 1..50 in every table', () => {
        const seq = Array.from({ length: 50 }, (_, i) => i + 1)
        expect(categories.map(r => r.category_id)).toEqual(seq)
        expect(users.map(r => r.user_id)).toEqual(seq)
        expect(products.map(r => r.product_id)).toEqual(seq)
        expect(orders.map(r => r.order_id)).toEqual(seq)
        expect(orderItems.map(r => r.order_item_id)).toEqual(seq)
        expect(payments.map(r => r.payment_id)).toEqual(seq)
        expect(reviews.map(r => r.review_id)).toEqual(seq)
    })
})

describe('every row equals the SQL row (all fields, all 350 records)', () => {
    it('categories', () => sqlCats.forEach((r, i) => expect(categories[i]).toEqual({ category_id: i + 1, category_name: r[0] })))
    it('users', () => sqlUsers.forEach((r, i) => expect(users[i]).toEqual({ user_id: i + 1, name: r[0], email: r[1], phone: r[2], address: r[3] })))
    it('products', () => sqlProducts.forEach((r, i) => expect(products[i]).toEqual({ product_id: i + 1, name: r[0], description: r[1], price: r[2], stock_quantity: r[3], category_id: r[4] })))
    it('orders', () => sqlOrders.forEach((r, i) => expect(orders[i]).toEqual({ order_id: i + 1, user_id: r[0], order_date: iso(r[1]), status: r[2], total_amount: r[3] })))
    it('order_items', () => sqlItems.forEach((r, i) => expect(orderItems[i]).toEqual({ order_item_id: i + 1, order_id: r[0], product_id: r[1], quantity: r[2], unit_price: r[3] })))
    it('payments', () => sqlPays.forEach((r, i) => expect(payments[i]).toEqual({ payment_id: i + 1, order_id: r[0], payment_date: iso(r[1]), amount: r[2], payment_method: r[3], status: r[4] })))
    it('reviews', () => sqlReviews.forEach((r, i) => expect(reviews[i]).toEqual({ review_id: i + 1, user_id: r[0], product_id: r[1], rating: r[2], comment: r[3], review_date: iso(r[4]) })))
})

describe('spot checks hard-coded from the brief (guard the SQL file itself)', () => {
    it('categories', () => {
        expect(categories[0].category_name).toBe('Smartphones'); expect(categories[1].category_name).toBe('Laptops')
        expect(categories[4].category_name).toBe('Smart Watches'); expect(categories[44].category_name).toBe('Travel')
        expect(categories[45].category_name).toBe('Gaming Consoles'); expect(categories[46].category_name).toBe('Video Games')
        expect(categories[47].category_name).toBe('Computer Components'); expect(categories[48].category_name).toBe('Software'); expect(categories[49].category_name).toBe('Other')
    })
    it('users 1, 2, 3 and 50', () => {
        expect(users[0]).toEqual({ user_id: 1, name: 'Aruzhan Saparova', email: 'aruzhan.saparova@gmail.com', phone: '+77011234501', address: 'Almaty, Abay 10' })
        expect(users[1]).toEqual({ user_id: 2, name: 'Dias Nurlanov', email: 'dias.nurlanov@gmail.com', phone: '+77011234502', address: 'Almaty, Dostyk 25' })
        expect(users[2]).toEqual({ user_id: 3, name: 'Amina Bekova', email: 'amina.bekova@gmail.com', phone: '+77011234503', address: 'Astana, Turan 15' })
        expect(users[49]).toEqual({ user_id: 50, name: 'Amina Rakhmetova', email: 'amina.rakhmetova@gmail.com', phone: '+77011234550', address: 'Almaty, Dostyk 101' })
    })
    it('products 1, 4, 17, 50', () => {
        expect(products[0]).toMatchObject({ name: 'iPhone 15', price: 399999, stock_quantity: 25, category_id: 1 })
        expect(products[3]).toMatchObject({ name: 'MacBook Air M2', price: 499999, stock_quantity: 15, category_id: 2 })
        expect(products[16]).toMatchObject({ name: 'PlayStation 5', price: 299999, stock_quantity: 12, category_id: 8 })
        expect(products[49]).toMatchObject({ name: 'Wireless Gamepad', price: 44999, stock_quantity: 25, category_id: 45 })
    })
    it('orders 1 and 50', () => {
        expect(orders[0]).toEqual({ order_id: 1, user_id: 1, order_date: '2026-08-01T10:15:00', status: 'Delivered', total_amount: 399999 })
        expect(orders[49]).toEqual({ order_id: 50, user_id: 50, order_date: '2026-09-19T13:55:00', status: 'Delivered', total_amount: 44999 })
    })
    it('order items 1 and 50 (one product per order)', () => {
        expect(orderItems[0]).toMatchObject({ order_id: 1, product_id: 1, quantity: 1 })
        expect(orderItems[49]).toMatchObject({ order_id: 50, product_id: 50, quantity: 1 })
        orderItems.forEach(i => expect(i.quantity).toBe(1))
    })
    it('payments 1 and 50, and only the two supplied methods', () => {
        expect(payments[0]).toMatchObject({ order_id: 1, amount: 399999, payment_method: 'Kaspi Pay', status: 'Paid' })
        expect(payments[49]).toMatchObject({ order_id: 50, amount: 44999, payment_method: 'Bank Card', status: 'Paid' })
        expect(new Set(payments.map(p => p.payment_method))).toEqual(new Set(['Kaspi Pay', 'Bank Card']))
    })
    it('reviews 1, 2 and 50', () => {
        expect(reviews[0]).toEqual({ review_id: 1, user_id: 1, product_id: 1, rating: 5, comment: 'Excellent smartphone, very happy with the purchase.', review_date: '2026-08-05T15:00:00' })
        expect(reviews[1]).toEqual({ review_id: 2, user_id: 2, product_id: 2, rating: 5, comment: 'Great phone and fast delivery.', review_date: '2026-08-06T16:20:00' })
        expect(reviews[49]).toEqual({ review_id: 50, user_id: 50, product_id: 50, rating: 5, comment: 'Gamepad works perfectly.', review_date: '2026-09-20T18:00:00' })
        expect(users[reviews[49].user_id - 1].name).toBe('Amina Rakhmetova'); expect(products[reviews[49].product_id - 1].name).toBe('Wireless Gamepad')
    })
})

// Independent second source: the product table from the original brief (id, category, price, stock).
const BRIEF: [number, number, number, number][] = [
    [1, 1, 399999, 25], [2, 1, 349999, 30], [3, 1, 119999, 40], [4, 2, 499999, 15], [5, 2, 279999, 20], [6, 2, 219999, 25], [7, 3, 299999, 18], [8, 3, 279999, 20], [9, 4, 109999, 35], [10, 4, 159999, 15],
    [11, 5, 189999, 20], [12, 5, 99999, 25], [13, 6, 299999, 10], [14, 6, 399999, 8], [15, 7, 299999, 12], [16, 7, 349999, 10], [17, 8, 299999, 12], [18, 8, 279999, 10], [19, 9, 49999, 30], [20, 9, 29999, 35],
    [21, 10, 89999, 15], [22, 10, 129999, 12], [23, 11, 24999, 50], [24, 11, 49999, 40], [25, 12, 89999, 25], [26, 12, 69999, 30], [27, 13, 59999, 20], [28, 13, 44999, 25], [29, 14, 29999, 40], [30, 14, 19999, 45],
    [31, 15, 24999, 30], [32, 15, 29999, 35], [33, 16, 7999, 50], [34, 16, 9999, 45], [35, 17, 1999, 100], [36, 17, 2999, 100], [37, 18, 12999, 40], [38, 19, 8999, 50], [39, 20, 10999, 35], [40, 21, 29999, 25],
    [41, 22, 79999, 15], [42, 23, 24999, 30], [43, 24, 89999, 15], [44, 26, 19999, 40], [45, 27, 24999, 30], [46, 28, 39999, 20], [47, 30, 19999, 25], [48, 34, 34999, 20], [49, 36, 9999, 50], [50, 45, 44999, 25],
]
it('all 50 products also match the first brief (id, category, price, stock)', () => {
    BRIEF.forEach(([id, cat, price, stock]) => expect([products[id - 1].category_id, products[id - 1].price, products[id - 1].stock_quantity]).toEqual([cat, price, stock]))
})

describe('foreign keys and consistency', () => {
    const has = (rows: object[], k: string) => new Set(rows.map(r => (r as Record<string, unknown>)[k]))
    it('products -> categories', () => products.forEach(p => expect(has(categories, 'category_id').has(p.category_id)).toBe(true)))
    it('orders -> users', () => orders.forEach(o => expect(has(users, 'user_id').has(o.user_id)).toBe(true)))
    it('order_items -> orders, products', () => orderItems.forEach(i => {
        expect(has(orders, 'order_id').has(i.order_id)).toBe(true); expect(has(products, 'product_id').has(i.product_id)).toBe(true)
    }))
    it('payments -> orders (one payment per order, UNIQUE)', () => {
        payments.forEach(p => expect(has(orders, 'order_id').has(p.order_id)).toBe(true))
        expect(new Set(payments.map(p => p.order_id)).size).toBe(50)
    })
    it('reviews -> users, products; rating 1..5', () => reviews.forEach(r => {
        expect(has(users, 'user_id').has(r.user_id)).toBe(true); expect(has(products, 'product_id').has(r.product_id)).toBe(true)
        expect(r.rating).toBeGreaterThanOrEqual(1); expect(r.rating).toBeLessThanOrEqual(5)
    }))
    it('amounts agree: order total = item price x qty = payment amount = product price', () => orders.forEach(o => {
        const it = orderItems.find(i => i.order_id === o.order_id)!, pay = payments.find(p => p.order_id === o.order_id)!
        expect(it.unit_price * it.quantity).toBe(o.total_amount); expect(pay.amount).toBe(o.total_amount); expect(products[it.product_id - 1].price).toBe(it.unit_price)
    }))
    it('UNIQUE constraints hold for email, phone and category_name', () => {
        expect(new Set(users.map(u => u.email)).size).toBe(50); expect(new Set(users.map(u => u.phone)).size).toBe(50); expect(new Set(categories.map(c => c.category_name)).size).toBe(50)
    })
})

describe('no placeholder data', () => {
    it('no placeholder-era emails, phone formats or comments remain', () => {
        users.forEach(u => { expect(u.email).toMatch(/@gmail\.com$/); expect(u.phone).toMatch(/^\+7701123\d{4}$/) })
        const old = ['Madina Ospanova', 'Gulnara Rakhimova', 'Excellent product, very happy with the purchase.', 'Highly recommend this product.', 'Decent, but could be better.']
        const blob = JSON.stringify({ users, reviews })
        old.forEach(t => expect(blob).not.toContain(t))
        reviews.forEach(r => expect(r.comment).not.toMatch(/^(Great quality and fast delivery|Good value for the price|Works exactly as described)\.$/))
    })
    it('no placeholder statuses: payments are all Paid as in the SQL, order statuses only the SQL ones', () => {
        expect(new Set(orders.map(o => o.status))).toEqual(new Set(['Delivered', 'Shipped', 'Processing']))
        payments.forEach(p => expect(p.status).toBe('Paid'))
    })
    it('users carry no password / role fields', () => users.forEach(u => expect(Object.keys(u).sort()).toEqual(['address', 'email', 'name', 'phone', 'user_id'])))
})

describe('product images', () => {
    it('every one of the 50 products gets a category-specific illustration (not the generic fallback)', () => {
        const generic = productImage(999999)
        products.forEach(p => expect(productImage(p.product_id), p.name).not.toBe(generic))
    })
    it('specific products get distinct art', () => {
        expect(productImage(45)).not.toBe(productImage(47)); expect(productImage(47)).not.toBe(productImage(49)); expect(productImage(1)).toBe(productImage(2))
    })
})
