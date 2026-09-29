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
export const productCategoryName=(pid:number)=>{const p=db.products.find(x=>x.product_id===pid);return db.categories.find(c=>c.category_id===p?.category_id)?.category_name??''}

// Orders = mock rows + orders created at checkout (kept in localStorage, shaped like the DB tables).
type OrderBundle={order:Order;items:OrderItem[];payment?:Payment}
const loadSaved=():OrderBundle[]=>{try{return JSON.parse(localStorage.getItem('orders')??'[]')}catch{return[]}}
const allOrders=():OrderBundle[]=>[...db.orders.map(order=>({order,items:db.orderItems.filter(i=>i.order_id===order.order_id),payment:db.payments.find(p=>p.order_id===order.order_id)})),...loadSaved()]
const withProduct=(items:OrderItem[])=>items.map(i=>({...i,product:db.products.find(p=>p.product_id===i.product_id)}))
export const getOrdersByUserId=(id:number)=>wait(allOrders().filter(b=>b.order.user_id===id).map(b=>({...b.order,items:withProduct(b.items)})))
export const getOrderById=(id:number)=>{const b=allOrders().find(x=>x.order.order_id===id);return wait(b&&{order:b.order,items:withProduct(b.items),payment:b.payment,user:db.users.find(u=>u.user_id===b.order.user_id)})}
export const getPaymentByOrderId=(id:number)=>wait(allOrders().find(b=>b.order.order_id===id)?.payment)
export const nextOrderId=()=>Math.max(...allOrders().map(b=>b.order.order_id))+1
const METHODS:Record<string,string>={card:'Bank Card',kaspi:'Kaspi Pay',cash:'Cash on delivery'}
export function createOrder(userId:number,lines:{product_id:number;quantity:number;unit_price:number}[],pay:string){
const order_id=nextOrderId(),now=new Date().toISOString(),total=lines.reduce((a,l)=>a+l.quantity*l.unit_price,0),all=allOrders()
const item0=Math.max(0,...all.flatMap(b=>b.items.map(i=>i.order_item_id))),pay0=Math.max(0,...all.map(b=>b.payment?.payment_id??0))
const bundle:OrderBundle={order:{order_id,user_id:userId,order_date:now,status:'Processing',total_amount:total},items:lines.map((l,i)=>({order_item_id:item0+i+1,order_id,...l})),payment:{payment_id:pay0+1,order_id,payment_date:now,amount:total,payment_method:METHODS[pay]??'Bank Card',status:pay==='cash'?'Pending':'Paid'}}
localStorage.setItem('orders',JSON.stringify([...loadSaved(),bundle]));return order_id}
