// localStorage-backed tables. Seeded from ./mock on first use, then persisted (marketkz_* keys).
import * as seed from './mock'
import type {User,Category,Product,Order,OrderItem,Payment,Review} from '../types/database'
const cache=new Map<string,unknown[]>()
// Bump SEED_VERSION whenever db/marketplace_db.sql / src/data/mock.ts changes (npm run seed:generate).
// v1 = placeholder seed, v2 = exact SQL seed (350 records).
export const SEED_VERSION='2'
const VKEY='marketkz_seed_version',SEED_ID_MAX=50
const TABLE_KEYS=['marketkz_users','marketkz_products','marketkz_categories','marketkz_reviews','marketkz_orders','marketkz_order_items','marketkz_payments']
const OWNED=[...TABLE_KEYS,'marketkz_credentials','marketkz_auth']
let checked=false
const read=<R,>(k:string):R[]=>{try{const v=JSON.parse(localStorage.getItem(k)??'null');return Array.isArray(v)?v:[]}catch{return[]}}
const put=(k:string,v:unknown)=>localStorage.setItem(k,JSON.stringify(v))
// Replace the old seed rows with the current seed but KEEP what visitors created themselves:
// users registered after the seed (user_id>50) and their orders/payments/reviews. Rows created while signed in as an
// old placeholder identity (user_id<=50) are dropped, since that id now belongs to a different person.
// Products/categories were already the exact SQL rows and may carry admin edits, so they are left as they are.
export function migrateSeed(){
const oldUsers=read<User>('marketkz_users');const mail=new Set(seed.users.map(u=>u.email.toLowerCase())),tel=new Set(seed.users.map(u=>u.phone))
const keepUsers=oldUsers.filter(u=>u.user_id>SEED_ID_MAX&&!mail.has(String(u.email).toLowerCase())&&!tel.has(u.phone));const keep=new Set(keepUsers.map(u=>u.user_id))
const keepOrders=read<Order>('marketkz_orders').filter(o=>o.order_id>SEED_ID_MAX&&keep.has(o.user_id));const oids=new Set(keepOrders.map(o=>o.order_id))
put('marketkz_users',[...seed.users,...keepUsers])
put('marketkz_orders',[...seed.orders,...keepOrders])
put('marketkz_order_items',[...seed.orderItems,...read<OrderItem>('marketkz_order_items').filter(i=>i.order_id>SEED_ID_MAX&&oids.has(i.order_id))])
put('marketkz_payments',[...seed.payments,...read<Payment>('marketkz_payments').filter(p=>p.order_id>SEED_ID_MAX&&oids.has(p.order_id))])
put('marketkz_reviews',[...seed.reviews,...read<Review>('marketkz_reviews').filter(r=>r.review_id>SEED_ID_MAX&&keep.has(r.user_id))])
const emails=new Set(keepUsers.map(u=>u.email.toLowerCase()));let creds:Record<string,string>={};try{creds=JSON.parse(localStorage.getItem('marketkz_credentials')??'{}')}catch{/* ignore */}
put('marketkz_credentials',Object.fromEntries(Object.entries(creds).filter(([e])=>emails.has(e))))
try{const a=JSON.parse(localStorage.getItem('marketkz_auth')??'null');if(a&&a.user_id!==0&&!keep.has(a.user_id))localStorage.removeItem('marketkz_auth')}catch{localStorage.removeItem('marketkz_auth')}}
export function checkSeedVersion(){if(checked)return;checked=true
try{const v=localStorage.getItem(VKEY);const legacy=v===null&&TABLE_KEYS.some(k=>localStorage.getItem(k)!==null) // tables from before versioning = v1
if((v!==null&&v!==SEED_VERSION)||legacy)migrateSeed()
localStorage.setItem(VKEY,SEED_VERSION)}catch{/* storage unavailable */}}
// Development helper: wipes every marketkz_* table, credentials and session; next read re-seeds from mock.ts.
export function resetAllData(){try{OWNED.forEach(k=>localStorage.removeItem(k));localStorage.removeItem(VKEY)}catch{/* ignore */}cache.clear();checked=false}
function load<R>(key:string,init:R[]):R[]{checkSeedVersion();const hit=cache.get(key);if(hit)return hit as R[];let rows=init
try{const raw=localStorage.getItem(key);if(raw)rows=JSON.parse(raw);else localStorage.setItem(key,JSON.stringify(init))}catch{/* storage unavailable: seed only */}
cache.set(key,rows);return rows}
export function save<R>(key:string,rows:R[]){cache.set(key,rows);try{localStorage.setItem(key,JSON.stringify(rows))}catch{/* ignore */}}
export const resetCache=()=>{cache.clear();checked=false}
export const KEYS={users:'marketkz_users',products:'marketkz_products',categories:'marketkz_categories',reviews:'marketkz_reviews',orders:'marketkz_orders',orderItems:'marketkz_order_items',payments:'marketkz_payments'} as const
export const T={users:()=>load<User>(KEYS.users,seed.users),categories:()=>load<Category>(KEYS.categories,seed.categories),products:()=>load<Product>(KEYS.products,seed.products),orders:()=>load<Order>(KEYS.orders,seed.orders),orderItems:()=>load<OrderItem>(KEYS.orderItems,seed.orderItems),payments:()=>load<Payment>(KEYS.payments,seed.payments),reviews:()=>load<Review>(KEYS.reviews,seed.reviews)}
export const nextId=(ids:number[])=>Math.max(0,...ids)+1
