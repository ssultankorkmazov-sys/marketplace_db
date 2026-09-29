import {useEffect,useState,type ReactNode} from 'react'
import {Link,useNavigate} from 'react-router-dom'
import {Search,Heart,ShoppingCart,User,MapPin,Star,ShoppingBag,Inbox} from 'lucide-react'
import {useStore} from '../context/Store'
import {productImages} from '../data/productImages'
import type {ProductStats} from '../services'
export const formatPrice=(n:number)=>Math.round(n).toLocaleString('ru-RU')+' ₸'
export function useAsync<T>(fn:()=>Promise<T>,deps:unknown[]){const[s,set]=useState<{data?:T;error?:string;loading:boolean}>({loading:true})
useEffect(()=>{let ok=true;set({loading:true});fn().then(d=>ok&&set({data:d,loading:false})).catch(e=>ok&&set({error:String(e),loading:false}));return()=>{ok=false}},deps);return s}
export const LoadingState=()=><div className="py-20 text-center text-neutral-400">Загрузка…</div>
export const ErrorState=({msg}:{msg?:string})=><div className="py-20 text-center text-red-600">Ошибка: {msg}</div>
export const EmptyState=({title,text,to='/'}:{title:string;text?:string;to?:string})=><div className="py-20 text-center"><Inbox className="mx-auto mb-3 text-neutral-300" size={48}/><h2 className="text-xl font-semibold">{title}</h2><p className="text-neutral-500 mt-1">{text}</p><Link to={to} className="inline-block mt-5 bg-red-600 text-white px-5 py-2.5 rounded-xl font-medium">К покупкам</Link></div>
export const Stars=({v}:{v:number})=><span className="inline-flex items-center gap-1 text-sm"><Star size={14} className="fill-amber-400 text-amber-400"/>{v?v.toFixed(1):'—'}</span>
export const Img=({id,alt,className=''}:{id:number;alt:string;className?:string})=>{const[bad,setBad]=useState(false)
return bad?<div className={`bg-neutral-100 flex items-center justify-center text-neutral-300 ${className}`} role="img" aria-label={alt}><ShoppingBag size={40}/></div>:<img src={productImages[id]} alt={alt} loading="lazy" onError={()=>setBad(true)} className={`object-cover ${className}`}/>}
export const Qty=({v,max,on}:{v:number;max:number;on:(n:number)=>void})=><div className="inline-flex items-center border rounded-xl overflow-hidden"><button aria-label="Меньше" className="px-3 py-1.5 hover:bg-neutral-100" onClick={()=>on(Math.max(1,v-1))}>−</button><span className="w-8 text-center">{v}</span><button aria-label="Больше" className="px-3 py-1.5 hover:bg-neutral-100 disabled:opacity-30" disabled={v>=max} onClick={()=>on(Math.min(max,v+1))}>+</button></div>
export const Logo=()=><Link to="/" className="flex items-center gap-2 font-extrabold text-xl"><span className="bg-red-600 text-white rounded-lg w-8 h-8 flex items-center justify-center"><ShoppingBag size={18}/></span>Market<span className="text-red-600">KZ</span></Link>
export function Header(){const[q,setQ]=useState('');const nav=useNavigate();const{count,favs}=useStore()
const badge=(n:number)=>n>0&&<span className="absolute -top-1 -right-2 bg-red-600 text-white text-[10px] rounded-full px-1.5">{n}</span>
return <header className="sticky top-0 z-20 bg-white shadow-sm"><div className="max-w-7xl mx-auto px-4 py-3 flex items-center gap-3 md:gap-6 flex-wrap">
<Logo/><form role="search" className="order-last md:order-none w-full md:flex-1 relative" onSubmit={e=>{e.preventDefault();nav(`/search?q=${encodeURIComponent(q)}`)}}>
<label htmlFor="q" className="sr-only">Поиск</label><input id="q" value={q} onChange={e=>setQ(e.target.value)} placeholder="Искать товары…" className="w-full bg-neutral-100 rounded-xl pl-10 pr-4 py-2.5 outline-none focus:ring-2 ring-red-500"/><Search size={18} className="absolute left-3 top-3 text-neutral-400"/></form>
<nav className="flex items-center gap-4 ml-auto text-sm"><span className="hidden lg:flex items-center gap-1 text-neutral-600"><MapPin size={16}/>Алматы</span>
<Link to="/categories" className="hidden md:block hover:text-red-600">Категории</Link>
<Link to="/favorites" aria-label="Избранное" className="relative hover:text-red-600"><Heart/>{badge(favs.length)}</Link>
<Link to="/cart" aria-label="Корзина" className="relative hover:text-red-600"><ShoppingCart/>{badge(count)}</Link>
<Link to="/profile" aria-label="Профиль" className="hover:text-red-600"><User/></Link></nav></div></header>}
export const Footer=()=><footer className="mt-16 bg-neutral-900 text-neutral-400 text-sm"><div className="max-w-7xl mx-auto px-4 py-8 flex flex-wrap justify-between gap-4"><span>© MarketKZ — маркетплейс Казахстана</span><span>Доставка по всему Казахстану · +7 700 000 00 00</span></div></footer>
export function ProductCard({p}:{p:ProductStats}){const{add,favs,toggleFav}=useStore();const fav=favs.includes(p.product_id)
return <article className="bg-white rounded-2xl shadow-sm hover:shadow-md transition p-3 flex flex-col">
<div className="relative"><Link to={`/product/${p.product_id}`}><Img id={p.product_id} alt={p.name} className="w-full aspect-square rounded-xl"/></Link>
<button aria-label="В избранное" aria-pressed={fav} onClick={()=>toggleFav(p.product_id)} className="absolute top-2 right-2 bg-white/90 rounded-full p-1.5"><Heart size={18} className={fav?'fill-red-600 text-red-600':'text-neutral-500'}/></button></div>
<Link to={`/product/${p.product_id}`} className="mt-3 font-medium leading-snug line-clamp-2 hover:text-red-600">{p.name}</Link>
<div className="flex items-center gap-2 mt-1 text-neutral-500"><Stars v={p.rating}/><span className="text-xs">({p.reviews})</span></div>
<div className="text-lg font-bold text-red-600 mt-1">{formatPrice(p.price)}</div>
<div className={`text-xs mb-2 ${p.stock_quantity?'text-green-600':'text-neutral-400'}`}>{p.stock_quantity?'В наличии':'Нет в наличии'}</div>
<button disabled={!p.stock_quantity} onClick={()=>add(p.product_id,p.stock_quantity)} className="mt-auto bg-red-600 hover:bg-red-700 disabled:bg-neutral-200 disabled:text-neutral-400 text-white rounded-xl py-2 font-medium">В корзину</button></article>}
export const ProductGrid=({items}:{items:ProductStats[]})=><div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3 md:gap-4">{items.map(p=><ProductCard key={p.product_id} p={p}/>)}</div>
export const Page=({title,children}:{title?:string;children:ReactNode})=><main className="max-w-7xl mx-auto px-4 py-6">{title&&<h1 className="text-2xl font-bold mb-5">{title}</h1>}{children}</main>
