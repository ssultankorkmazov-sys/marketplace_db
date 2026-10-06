// Data-access layer. Today: localStorage tables. Later: replace bodies with fetch('/api/...'); UI stays unchanged.
import {T,KEYS,save,nextId} from './data/store'
import type {Product,Review,User,OrderItem} from './types/database'
export type ProductStats=Product&{rating:number;reviews:number}
const stats=(p:Product):ProductStats=>{const r=T.reviews().filter(x=>x.product_id===p.product_id);return{...p,reviews:r.length,rating:r.length?r.reduce((a,x)=>a+x.rating,0)/r.length:0}}
const wait=<V,>(v:V)=>Promise.resolve(v)
const user=(id:number)=>T.users().find(u=>u.user_id===id),product=(id:number)=>T.products().find(p=>p.product_id===id)
const withProduct=(items:OrderItem[])=>items.map(i=>({...i,product:product(i.product_id)}))
// ---- products / categories
export const getProducts=(q?:string)=>{const s=q?.trim().toLowerCase();return wait(T.products().filter(p=>!s||p.name.toLowerCase().includes(s)||(p.description??'').toLowerCase().includes(s)).map(stats))}
export const getProductById=(id:number)=>{const p=product(id);return wait(p&&stats(p))}
export const getProductsByCategory=(id:number)=>wait(T.products().filter(p=>p.category_id===id).map(stats))
export const getCategories=()=>wait(T.categories().map(c=>({...c,count:T.products().filter(p=>p.category_id===c.category_id).length})))
export const getCategoryById=(id:number)=>wait(T.categories().find(c=>c.category_id===id))
type ProductInput=Omit<Product,'product_id'>
export const createProduct=(d:ProductInput)=>{const p={...d,product_id:nextId(T.products().map(x=>x.product_id))};save(KEYS.products,[...T.products(),p]);return wait(p)}
export const updateProduct=(id:number,d:Partial<ProductInput>)=>{save(KEYS.products,T.products().map(p=>p.product_id===id?{...p,...d}:p));return wait(product(id))}
export const deleteProduct=(id:number)=>{if(T.orderItems().some(i=>i.product_id===id))return Promise.reject(new Error('Товар есть в заказах — удалить нельзя.'))
save(KEYS.products,T.products().filter(p=>p.product_id!==id));save(KEYS.reviews,T.reviews().filter(r=>r.product_id!==id));return wait(true)}
const dupCat=(name:string,id=0)=>T.categories().some(c=>c.category_id!==id&&c.category_name.toLowerCase()===name.trim().toLowerCase())
export const createCategory=(name:string)=>{if(!name.trim()||dupCat(name))return Promise.reject(new Error('Название пустое или уже существует.'))
const c={category_id:nextId(T.categories().map(x=>x.category_id)),category_name:name.trim()};save(KEYS.categories,[...T.categories(),c]);return wait(c)}
export const updateCategory=(id:number,name:string)=>{if(!name.trim()||dupCat(name,id))return Promise.reject(new Error('Название пустое или уже существует.'))
save(KEYS.categories,T.categories().map(c=>c.category_id===id?{...c,category_name:name.trim()}:c));return wait(true)}
export const deleteCategory=(id:number)=>{const n=T.products().filter(p=>p.category_id===id).length;if(n)return Promise.reject(new Error(`Нельзя удалить: в категории ${n} товар(ов).`))
save(KEYS.categories,T.categories().filter(c=>c.category_id!==id));return wait(true)}
// ---- reviews
export const getReviewsByProductId=(id:number):Promise<(Review&{user?:User})[]>=>wait(T.reviews().filter(r=>r.product_id===id).sort((a,b)=>b.review_date.localeCompare(a.review_date)).map(r=>({...r,user:user(r.user_id)})))
export const getReviewsByUserId=(id:number)=>wait(T.reviews().filter(r=>r.user_id===id).map(r=>({...r,product:product(r.product_id)})))
export const getReviews=()=>wait([...T.reviews()])
export const getReviewsForProduct=(id:number)=>getReviewsByProductId(id)
export const getAllReviews=()=>wait(T.reviews().map(r=>({...r,user:user(r.user_id),product:product(r.product_id)})))
export const createReview=(d:{user_id:number;product_id:number;rating:number;comment:string})=>{const r:Review={...d,review_id:nextId(T.reviews().map(x=>x.review_id)),review_date:new Date().toISOString()};save(KEYS.reviews,[...T.reviews(),r]);return wait(r)}
export const deleteReview=(id:number)=>{save(KEYS.reviews,T.reviews().filter(r=>r.review_id!==id));return wait(true)}
// ---- users
export const getUsers=()=>wait(T.users())
export const getUserById=(id:number)=>wait(user(id))
export const addUser=(d:Omit<User,'user_id'>):User=>{const u={...d,user_id:nextId(T.users().map(x=>x.user_id))};save(KEYS.users,[...T.users(),u]);return u}
export const createUser=(d:Omit<User,'user_id'>)=>wait(addUser(d))
export const updateUser=(id:number,d:Partial<Omit<User,'user_id'>>)=>{save(KEYS.users,T.users().map(u=>u.user_id===id?{...u,...d}:u));return wait(user(id))}
// ---- orders
const bundle=(o:import('./types/database').Order)=>({order:o,user:user(o.user_id),items:withProduct(T.orderItems().filter(i=>i.order_id===o.order_id)),payment:T.payments().find(p=>p.order_id===o.order_id)})
export const getOrders=()=>wait(T.orders().map(bundle))
export const getOrdersByUserId=(id:number)=>wait(T.orders().filter(o=>o.user_id===id).map(o=>({...o,items:bundle(o).items})))
export const getOrderById=(id:number)=>{const o=T.orders().find(x=>x.order_id===id);return wait(o&&bundle(o))}
export const getOrderItems=()=>wait([...T.orderItems()])
export const getPayments=()=>wait([...T.payments()])
export const getPaymentByOrderId=(id:number)=>wait(T.payments().find(p=>p.order_id===id))
export const updateOrderStatus=(id:number,status:string)=>{save(KEYS.orders,T.orders().map(o=>o.order_id===id?{...o,status}:o));return wait(true)}
export const nextOrderId=()=>nextId(T.orders().map(o=>o.order_id))
const METHODS:Record<string,string>={card:'Bank Card',kaspi:'Kaspi Pay',cash:'Cash on delivery'}
export function createOrder(userId:number,lines:{product_id:number;quantity:number;unit_price:number}[],pay:string){
const order_id=nextOrderId(),now=new Date().toISOString(),total=lines.reduce((a,l)=>a+l.quantity*l.unit_price,0)
const i0=nextId(T.orderItems().map(i=>i.order_item_id))
save(KEYS.orders,[...T.orders(),{order_id,user_id:userId,order_date:now,status:'Processing',total_amount:total}])
save(KEYS.orderItems,[...T.orderItems(),...lines.map((l,k)=>({order_item_id:i0+k,order_id,...l}))])
save(KEYS.payments,[...T.payments(),{payment_id:nextId(T.payments().map(p=>p.payment_id)),order_id,payment_date:now,amount:total,payment_method:METHODS[pay]??'Bank Card',status:pay==='cash'?'Pending':'Paid'}])
return order_id}
