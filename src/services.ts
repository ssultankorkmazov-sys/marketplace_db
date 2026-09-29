// Data-access layer. Swap bodies for fetch('/api/...') later; UI is unaffected.
import * as db from './data/mock'
import type {Product,Category,Review,Order,OrderItem,Payment,User} from './types/database'
export const CURRENT_USER_ID=1
export type ProductStats=Product&{rating:number;reviews:number}
const stats=(p:Product):ProductStats=>{const r=db.reviews.filter(x=>x.product_id===p.product_id);return{...p,reviews:r.length,rating:r.length?r.reduce((a,x)=>a+x.rating,0)/r.length:0}}
const wait=<T,>(v:T)=>Promise.resolve(v)
export const getProducts=(q?:string)=>{const s=q?.trim().toLowerCase();return wait(db.products.filter(p=>!s||p.name.toLowerCase().includes(s)||(p.description??'').toLowerCase().includes(s)).map(stats))}
export const getProductById=(id:number)=>{const p=db.products.find(x=>x.product_id===id);return wait(p?stats(p):undefined)}
export const getProductsByCategory=(id:number)=>wait(db.products.filter(p=>p.category_id===id).map(stats))
export const getCategories=()=>wait(db.categories.map(c=>({...c,count:db.products.filter(p=>p.category_id===c.category_id).length})))
export const getCategoryById=(id:number):Promise<Category|undefined>=>wait(db.categories.find(c=>c.category_id===id))
export const getReviewsByProductId=(id:number):Promise<(Review&{user?:User})[]>=>wait(db.reviews.filter(r=>r.product_id===id).map(r=>({...r,user:db.users.find(u=>u.user_id===r.user_id)})))
export const getReviewsByUserId=(id:number)=>wait(db.reviews.filter(r=>r.user_id===id).map(r=>({...r,product:db.products.find(p=>p.product_id===r.product_id)})))
export const getUserById=(id:number)=>wait(db.users.find(u=>u.user_id===id))
export const getOrdersByUserId=(id:number)=>wait(db.orders.filter(o=>o.user_id===id).map(o=>({...o,items:orderItems(o.order_id)})))
const orderItems=(id:number):(OrderItem&{product?:Product})[]=>db.orderItems.filter(i=>i.order_id===id).map(i=>({...i,product:db.products.find(p=>p.product_id===i.product_id)}))
export const getOrderById=(id:number):Promise<{order:Order;items:ReturnType<typeof orderItems>;payment?:Payment;user?:User}|undefined>=>{const order=db.orders.find(o=>o.order_id===id);return wait(order&&{order,items:orderItems(id),payment:db.payments.find(p=>p.order_id===id),user:db.users.find(u=>u.user_id===order.user_id)})}
export const nextOrderId=()=>Math.max(...db.orders.map(o=>o.order_id))+1
export const productCategoryName=(pid:number)=>{const p=db.products.find(x=>x.product_id===pid);return db.categories.find(c=>c.category_id===p?.category_id)?.category_name??''}
