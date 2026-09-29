import {useMemo,useState} from 'react'
import {Link,Route,Routes,useParams,useSearchParams} from 'react-router-dom'
import {Trash2} from 'lucide-react'
import {useStore} from './context/Store'
import * as svc from './services'
import {EmptyState,ErrorState,Footer,formatPrice,Header,Img,LoadingState,Page,ProductGrid,Qty,Stars,useAsync} from './components/ui'
import type {ProductStats} from './services'

const statusCls:Record<string,string>={Delivered:'bg-green-100 text-green-700',Shipped:'bg-blue-100 text-blue-700',Processing:'bg-amber-100 text-amber-700'}
const statusRu:Record<string,string>={Delivered:'Доставлен',Shipped:'В пути',Processing:'В обработке'}
const fmtDate=(s:string)=>new Date(s).toLocaleDateString('ru-RU')
const Badge=({s}:{s:string})=><span className={`px-2.5 py-1 rounded-full text-xs font-medium ${statusCls[s]??'bg-neutral-100'}`}>{statusRu[s]??s}</span>
function Async<T>({s,children}:{s:{data?:T;error?:string;loading:boolean};children:(d:T)=>React.ReactNode}){return s.loading?<LoadingState/>:s.error?<ErrorState msg={s.error}/>:s.data===undefined?<EmptyState title="Не найдено"/>:<>{children(s.data)}</>}
const Section=({title,items}:{title:string;items:ProductStats[]})=><section className="mt-10"><h2 className="text-xl font-bold mb-4">{title}</h2><ProductGrid items={items}/></section>

function Home(){const s=useAsync(async()=>({p:await svc.getProducts(),c:await svc.getCategories()}),[])
return <Page><Async s={s}>{({p,c})=><>
<div className="rounded-3xl bg-gradient-to-r from-red-600 to-rose-500 text-white p-8 md:p-14"><h1 className="text-3xl md:text-5xl font-extrabold">Все нужное в одном месте</h1><p className="mt-3 text-lg opacity-90">Быстрая доставка по Казахстану</p><Link to="/categories" className="inline-block mt-6 bg-white text-red-600 font-semibold px-6 py-3 rounded-xl">Перейти к покупкам</Link></div>
<section className="mt-10"><h2 className="text-xl font-bold mb-4">Популярные категории</h2><div className="flex flex-wrap gap-2">{c.map(x=><Link key={x.category_id} to={`/category/${x.category_id}`} className="bg-white rounded-full px-4 py-2 shadow-sm hover:text-red-600">{x.category_name}</Link>)}</div></section>
<Section title="Рекомендуем" items={p.slice(0,5)}/><Section title="Популярные товары" items={[...p].sort((a,b)=>b.reviews-a.reviews).slice(0,5)}/><Section title="С высоким рейтингом" items={[...p].sort((a,b)=>b.rating-a.rating).slice(0,5)}/></>}</Async></Page>}

function Categories(){const s=useAsync(svc.getCategories,[])
return <Page title="Категории"><Async s={s}>{c=><div className="grid grid-cols-2 md:grid-cols-4 gap-4">{c.map(x=><Link key={x.category_id} to={`/category/${x.category_id}`} className="bg-white rounded-2xl p-6 shadow-sm hover:shadow-md"><div className="w-12 h-12 rounded-xl bg-red-50 text-red-600 flex items-center justify-center font-bold text-xl">{x.category_name[0]}</div><div className="font-semibold mt-3">{x.category_name}</div><div className="text-sm text-neutral-500">{x.count} товаров</div></Link>)}</div>}</Async></Page>}

function Catalog({items,title}:{items:ProductStats[];title:string}){
const[min,setMin]=useState('');const[max,setMax]=useState('');const[rate,setRate]=useState(0);const[stock,setStock]=useState(false);const[sort,setSort]=useState('pop')
const list=useMemo(()=>items.filter(p=>(!min||p.price>=+min)&&(!max||p.price<=+max)&&p.rating>=rate&&(!stock||p.stock_quantity>0)).sort((a,b)=>sort==='asc'?a.price-b.price:sort==='desc'?b.price-a.price:sort==='rate'?b.rating-a.rating:b.reviews-a.reviews),[items,min,max,rate,stock,sort])
const inp="w-full border rounded-lg px-3 py-2 text-sm"
return <Page title={title}><p className="text-neutral-500 -mt-3 mb-4">Найдено товаров: {list.length}</p><div className="flex flex-col md:flex-row gap-6">
<aside className="md:w-56 shrink-0 bg-white rounded-2xl p-4 shadow-sm space-y-3 h-fit"><h2 className="font-semibold">Фильтры</h2>
<label className="block text-sm">Цена от<input className={inp} type="number" value={min} onChange={e=>setMin(e.target.value)}/></label>
<label className="block text-sm">Цена до<input className={inp} type="number" value={max} onChange={e=>setMax(e.target.value)}/></label>
<label className="block text-sm">Рейтинг от<select className={inp} value={rate} onChange={e=>setRate(+e.target.value)}>{[0,3,4,4.5].map(r=><option key={r} value={r}>{r||'Любой'}</option>)}</select></label>
<label className="flex gap-2 text-sm"><input type="checkbox" checked={stock} onChange={e=>setStock(e.target.checked)}/>Только в наличии</label></aside>
<div className="flex-1"><div className="flex justify-end mb-3"><label className="text-sm">Сортировка: <select className="border rounded-lg px-2 py-1" value={sort} onChange={e=>setSort(e.target.value)}><option value="pop">Популярные</option><option value="asc">Цена: по возрастанию</option><option value="desc">Цена: по убыванию</option><option value="rate">По рейтингу</option></select></label></div>
{list.length?<ProductGrid items={list}/>:<EmptyState title="Ничего не найдено" text="Измените фильтры или запрос."/>}</div></div></Page>}
function CategoryPage(){const id=+useParams().categoryId!;const s=useAsync(async()=>({c:await svc.getCategoryById(id),p:await svc.getProductsByCategory(id)}),[id])
return <Async s={s}>{({c,p})=>c?<Catalog items={p} title={c.category_name}/>:<EmptyState title="Категория не найдена"/>}</Async>}
function Search(){const q=useSearchParams()[0].get('q')??'';const s=useAsync(()=>svc.getProducts(q),[q]);return <Async s={s}>{p=><Catalog key={q} items={p} title={`Поиск: ${q}`}/>}</Async>}

function ProductPage(){const id=+useParams().productId!;const{add,favs,toggleFav}=useStore();const[q,setQ]=useState(1)
const nav=useAsync(async()=>({p:await svc.getProductById(id),c:undefined as undefined,r:await svc.getReviewsByProductId(id)}),[id])
const cat=useAsync(async()=>{const p=await svc.getProductById(id);return p&&svc.getCategoryById(p.category_id)},[id])
return <Page><Async s={nav}>{({p,r})=>p?<>
<div className="bg-white rounded-2xl shadow-sm p-5 grid md:grid-cols-2 gap-8"><Img id={p.product_id} alt={p.name} className="w-full aspect-square rounded-xl"/>
<div><div className="text-sm text-neutral-500">{cat.data?.category_name}</div><h1 className="text-3xl font-bold mt-1">{p.name}</h1><div className="mt-2">Средняя оценка: <Stars v={p.rating}/> · {p.reviews} отзывов</div>
<div className="text-3xl font-extrabold text-red-600 mt-4">{formatPrice(p.price)}</div>
<div className={`mt-1 text-sm ${p.stock_quantity?'text-green-600':'text-neutral-500'}`}>{p.stock_quantity?`В наличии: ${p.stock_quantity} шт.`:'Нет в наличии'}</div>
<p className="mt-4 text-neutral-700">{p.description}</p>
{p.stock_quantity>0&&<div className="mt-6 flex flex-wrap items-center gap-3"><Qty v={q} max={p.stock_quantity} on={setQ}/>
<button onClick={()=>add(p.product_id,p.stock_quantity,q)} className="bg-red-600 text-white px-6 py-2.5 rounded-xl font-medium">В корзину</button>
<Link to="/checkout" onClick={()=>add(p.product_id,p.stock_quantity,q)} className="border border-red-600 text-red-600 px-6 py-2.5 rounded-xl font-medium">Купить сейчас</Link></div>}
<button onClick={()=>toggleFav(p.product_id)} className="mt-4 text-sm text-neutral-500 hover:text-red-600">{favs.includes(p.product_id)?'Убрать из избранного':'В избранное'}</button></div></div>
<h2 className="text-xl font-bold mt-8 mb-3">Отзывы покупателей</h2>{r.length?<div className="space-y-3">{r.map(x=><div key={x.review_id} className="bg-white rounded-2xl p-4 shadow-sm"><div className="flex justify-between"><b>{x.user?.name}</b><span className="text-xs text-neutral-400">{fmtDate(x.review_date)}</span></div><Stars v={x.rating}/><p className="mt-1">{x.comment}</p></div>)}</div>:<p className="text-neutral-500">Отзывов пока нет.</p>}</>:<EmptyState title="Товар недоступен"/>}</Async></Page>}

function useCartItems(){const{cart}=useStore();return useAsync(async()=>Promise.all(Object.entries(cart).map(async([id,qty])=>({p:await svc.getProductById(+id),qty}))).then(x=>x.filter(i=>i.p).map(i=>({p:i.p as ProductStats,qty:Math.min(i.qty,(i.p as ProductStats).stock_quantity)}))),[JSON.stringify(cart)])}
const Cart=()=>{const{setQty,remove}=useStore();const s=useCartItems()
return <Page title="Корзина"><Async s={s}>{items=>{const total=items.reduce((a,i)=>a+i.p.price*i.qty,0)
return items.length?<div className="grid lg:grid-cols-3 gap-6"><div className="lg:col-span-2 space-y-3">{items.map(({p,qty})=><div key={p.product_id} className="bg-white rounded-2xl p-3 shadow-sm flex gap-4 items-center"><Img id={p.product_id} alt={p.name} className="w-20 h-20 rounded-xl"/>
<div className="flex-1"><Link to={`/product/${p.product_id}`} className="font-medium">{p.name}</Link><div className="text-sm text-neutral-500">{formatPrice(p.price)}</div><div className="mt-2"><Qty v={qty} max={p.stock_quantity} on={n=>setQty(p.product_id,n)}/></div></div>
<div className="text-right font-bold text-red-600">{formatPrice(p.price*qty)}</div><button aria-label="Удалить" onClick={()=>remove(p.product_id)}><Trash2 size={18} className="text-neutral-400 hover:text-red-600"/></button></div>)}</div>
<div className="bg-white rounded-2xl p-5 shadow-sm h-fit"><div className="flex justify-between text-lg font-bold"><span>Итого:</span><span>{formatPrice(total)}</span></div><Link to="/checkout" className="block text-center mt-4 bg-red-600 text-white py-3 rounded-xl font-medium">Оформить заказ</Link></div></div>
:<EmptyState title="В корзине пока пусто" text="Добавьте товары, чтобы оформить заказ."/>}}</Async></Page>}

function Checkout(){const{clear}=useStore();const s=useCartItems();const u=useAsync(()=>svc.getUserById(svc.CURRENT_USER_ID),[]);const[done,setDone]=useState<number|null>(null)
const inp="w-full border rounded-lg px-3 py-2";const field=(l:string,n:string,d?:string)=><label className="block text-sm mb-3">{l}<input required name={n} defaultValue={d} className={inp}/></label>
if(done)return <Page><div className="text-center py-16"><h1 className="text-3xl font-bold text-green-600">Заказ успешно оформлен!</h1><p className="mt-2 text-lg">Номер заказа: #{done}</p><Link to="/orders" className="inline-block mt-6 bg-red-600 text-white px-6 py-3 rounded-xl">Мои заказы</Link></div></Page>
return <Page title="Оформление заказа"><Async s={s}>{items=>{const total=items.reduce((a,i)=>a+i.p.price*i.qty,0)
return items.length?<form onSubmit={e=>{e.preventDefault();setDone(svc.nextOrderId());clear()}} className="grid lg:grid-cols-3 gap-6"><div className="lg:col-span-2 bg-white rounded-2xl p-5 shadow-sm">
<h2 className="font-semibold mb-3">Покупатель</h2>{field('Имя','name',u.data?.name)}{field('Телефон','phone',u.data?.phone)}
<h2 className="font-semibold my-3">Доставка</h2>{field('Город','city','Алматы')}{field('Адрес','address',u.data?.address??'')}
<h2 className="font-semibold my-3">Оплата</h2>{['Банковская карта','Kaspi Pay','Наличными при получении'].map((m,i)=><label key={m} className="flex gap-2 mb-1"><input type="radio" name="pay" defaultChecked={!i}/>{m}</label>)}</div>
<div className="bg-white rounded-2xl p-5 shadow-sm h-fit"><h2 className="font-semibold mb-2">Ваш заказ</h2>{items.map(i=><div key={i.p.product_id} className="flex justify-between text-sm py-1"><span>{i.p.name} × {i.qty}</span><span>{formatPrice(i.p.price*i.qty)}</span></div>)}
<div className="flex justify-between text-sm py-1"><span>Доставка</span><span>Бесплатно</span></div><div className="flex justify-between font-bold text-lg border-t mt-2 pt-2"><span>Итого</span><span>{formatPrice(total)}</span></div>
<button className="w-full mt-4 bg-red-600 text-white py-3 rounded-xl font-medium">Подтвердить заказ</button></div></form>:<EmptyState title="В корзине пока пусто" text="Добавьте товары, чтобы оформить заказ."/>}}</Async></Page>}

function Orders(){const s=useAsync(()=>svc.getOrdersByUserId(svc.CURRENT_USER_ID),[])
return <Page title="Мои заказы"><Async s={s}>{o=>o.length?<div className="space-y-3">{o.map(x=><Link key={x.order_id} to={`/orders/${x.order_id}`} className="block bg-white rounded-2xl p-4 shadow-sm hover:shadow-md"><div className="flex justify-between items-center"><b>Заказ #{x.order_id}</b><Badge s={x.status}/></div><div className="text-sm text-neutral-500">{fmtDate(x.order_date)} · {x.items.map(i=>i.product?.name).join(', ')}</div><div className="font-bold text-red-600 mt-1">{formatPrice(x.total_amount)}</div></Link>)}</div>:<EmptyState title="Заказов пока нет"/>}</Async></Page>}
function OrderDetails(){const id=+useParams().orderId!;const s=useAsync(()=>svc.getOrderById(id),[id])
return <Page><Async s={s}>{({order,items,payment,user})=><div className="bg-white rounded-2xl p-5 shadow-sm"><div className="flex justify-between items-center"><h1 className="text-2xl font-bold">Заказ #{order.order_id}</h1><Badge s={order.status}/></div><p className="text-neutral-500 text-sm">{fmtDate(order.order_date)}</p>
<div className="mt-4 divide-y">{items.map(i=><div key={i.order_item_id} className="flex justify-between py-2"><Link to={`/product/${i.product_id}`}>{i.product?.name} × {i.quantity}</Link><span>{formatPrice(i.unit_price*i.quantity)}</span></div>)}</div>
<div className="mt-4 text-sm space-y-1"><div>Адрес доставки: {user?.address}</div><div>Оплата: {payment?.payment_method} ({payment?.status})</div></div><div className="text-xl font-bold mt-4">Итого: {formatPrice(order.total_amount)}</div></div>}</Async></Page>}

function Favorites(){const{favs}=useStore();const s=useAsync(async()=>(await svc.getProducts()).filter(p=>favs.includes(p.product_id)),[favs.join()])
return <Page title="Избранное"><Async s={s}>{p=>p.length?<ProductGrid items={p}/>:<EmptyState title="В избранном пока пусто"/>}</Async></Page>}
function Profile(){const s=useAsync(async()=>({u:await svc.getUserById(svc.CURRENT_USER_ID),r:await svc.getReviewsByUserId(svc.CURRENT_USER_ID)}),[])
return <Page title="Профиль"><Async s={s}>{({u,r})=>u?<div className="grid md:grid-cols-2 gap-6"><div className="bg-white rounded-2xl p-5 shadow-sm"><h2 className="font-semibold mb-2">Личные данные</h2><div className="text-xl font-bold">{u.name}</div><div>{u.email}</div><div>{u.phone}</div><div>{u.address}</div>
<div className="mt-4 flex gap-3 text-red-600"><Link to="/orders">Мои заказы</Link><Link to="/favorites">Избранное</Link></div></div>
<div className="bg-white rounded-2xl p-5 shadow-sm"><h2 className="font-semibold mb-2">Мои отзывы</h2>{r.length?r.map(x=><div key={x.review_id} className="py-1 border-b text-sm"><b>{x.product?.name}</b> <Stars v={x.rating}/> {x.comment}</div>):<p className="text-neutral-500">Отзывов нет.</p>}</div></div>:<EmptyState title="Пользователь не найден"/>}</Async></Page>}

export default function App(){return <><Header/><Routes>
<Route path="/" element={<Home/>}/><Route path="/categories" element={<Categories/>}/><Route path="/category/:categoryId" element={<CategoryPage/>}/><Route path="/search" element={<Search/>}/>
<Route path="/product/:productId" element={<ProductPage/>}/><Route path="/cart" element={<Cart/>}/><Route path="/checkout" element={<Checkout/>}/>
<Route path="/orders" element={<Orders/>}/><Route path="/orders/:orderId" element={<OrderDetails/>}/><Route path="/favorites" element={<Favorites/>}/><Route path="/profile" element={<Profile/>}/>
<Route path="*" element={<Page><EmptyState title="Страница не найдена"/></Page>}/></Routes><Footer/></>}
