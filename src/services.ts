// Catalog reads use the backend; other demo workflows remain on localStorage during this stage.
import {T,KEYS,save,nextId} from './data/store'
import type {Product,Review,User,OrderItem} from './types/database'
import {adminApi,authApi,catalogApi,ordersApi,type ProductListOptions,type ShippingInput} from './api/client'
export type ProductStats=Product&{rating:number;reviews:number}
const stats=(p:Product):ProductStats=>{const r=T.reviews().filter(x=>x.product_id===p.product_id);return{...p,reviews:r.length,rating:r.length?r.reduce((a,x)=>a+x.rating,0)/r.length:0}}
const wait=<V,>(v:V)=>Promise.resolve(v)
const user=(id:number)=>T.users().find(u=>u.user_id===id),product=(id:number)=>T.products().find(p=>p.product_id===id)
const withProduct=(items:OrderItem[])=>items.map(i=>({...i,product:product(i.product_id)}))
// ---- products / categories
const useLocalCatalog=import.meta.env.MODE==='test'||(import.meta.env.DEV&&import.meta.env.VITE_USE_MOCKS==='true')
export const getCatalogProducts=(q?:string,options:Omit<ProductListOptions,'q'>={})=>{
 if(!useLocalCatalog)return catalogApi.products({q,...options})
 const s=q?.trim().toLowerCase(), category=options.categoryId
 let rows=T.products().filter(p=>(!s||p.name.toLowerCase().includes(s)||(p.description??'').toLowerCase().includes(s))&&(!category||p.category_id===category)).map(stats)
 if(options.sortBy==='price')rows.sort((a,b)=>(a.price-b.price)*(options.sortOrder==='desc'?-1:1))
 else if(options.sortBy==='name')rows.sort((a,b)=>a.name.localeCompare(b.name)*(options.sortOrder==='desc'?-1:1))
 return wait(rows)
}
export const getCatalogProductById=(id:number)=>useLocalCatalog?wait(product(id)&&stats(product(id)!)):catalogApi.product(id)
export const getCatalogProductsByCategory=(id:number)=>useLocalCatalog?wait(T.products().filter(p=>p.category_id===id).map(stats)):catalogApi.productsByCategory(id)
export const getCatalogCategories=()=>useLocalCatalog?wait(T.categories().map(c=>({...c,count:T.products().filter(p=>p.category_id===c.category_id).length}))):catalogApi.categories()
export const getCatalogCategoryById=(id:number)=>useLocalCatalog?wait(T.categories().find(c=>c.category_id===id)):catalogApi.category(id)

// Existing localStorage helpers remain available to the admin demo and order flow.
export const getProducts=(q?:string)=>{const s=q?.trim().toLowerCase();return wait(T.products().filter(p=>!s||p.name.toLowerCase().includes(s)||(p.description??'').toLowerCase().includes(s)).map(stats))}
export const getProductById=(id:number)=>{const p=product(id);return wait(p&&stats(p))}
export const getProductsByCategory=(id:number)=>wait(T.products().filter(p=>p.category_id===id).map(stats))
export const getCategories=()=>wait(T.categories().map(c=>({...c,count:T.products().filter(p=>p.category_id===c.category_id).length})))
export const getCategoryById=(id:number)=>wait(T.categories().find(c=>c.category_id===id))
type ProductInput=Omit<Product,'product_id'>
export const getAdminProducts=()=>adminApi.products()
export const createProduct=(d:ProductInput)=>adminApi.createProduct(d)
export const updateProduct=async(id:number,d:Partial<ProductInput>)=>{const current=(await getAdminProducts()).find(p=>p.product_id===id);if(!current)throw new Error('Товар не найден.');return adminApi.updateProduct(id,{name:current.name,description:current.description,price:current.price,stock_quantity:current.stock_quantity,category_id:current.category_id,...d})}
export const deleteProduct=(id:number)=>adminApi.deleteProduct(id)
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
export const getUserById=async(id:number)=>{const current=await authApi.me();return current.user.user_id===id?current.user:undefined}
export const addUser=(d:Omit<User,'user_id'>):User=>{const u={...d,user_id:nextId(T.users().map(x=>x.user_id))};save(KEYS.users,[...T.users(),u]);return u}
export const createUser=(d:Omit<User,'user_id'>)=>wait(addUser(d))
export const updateUser=async(id:number,d:Partial<Omit<User,'user_id'>>)=>{const current=await authApi.me();if(current.user.user_id!==id)throw new Error('Пользователь не найден');return (await authApi.updateProfile({name:d.name??current.user.name,phone:d.phone??current.user.phone,address:d.address===undefined?current.user.address:d.address})).user}
// ---- orders
const bundle=(o:import('./types/database').Order)=>({order:o,user:user(o.user_id),items:withProduct(T.orderItems().filter(i=>i.order_id===o.order_id)),payment:T.payments().find(p=>p.order_id===o.order_id)})
export const getOrders=()=>wait(T.orders().map(bundle))
export const getAdminOrders=()=>adminApi.orders()
export const getOrdersByUserId=async()=> (await ordersApi.list()).orders
export const getOrderById=async(id:number)=>{try{return await ordersApi.get(id)}catch(error){if((error as {status?:number}).status===404)return undefined;throw error}}
export const getOrderItems=()=>wait([...T.orderItems()])
export const getPayments=()=>wait([...T.payments()])
export const getPaymentByOrderId=(id:number)=>wait(T.payments().find(p=>p.order_id===id))
export const updateOrderStatus=(id:number,status:string)=>{save(KEYS.orders,T.orders().map(o=>o.order_id===id?{...o,status}:o));return wait(true)}
export const nextOrderId=()=>nextId(T.orders().map(o=>o.order_id))
export async function createOrder(lines:{product_id:number;quantity:number}[],shipping:ShippingInput,pay:string){
return (await ordersApi.create({items:lines,shipping,paymentMethod:pay})).order.order_id
}
