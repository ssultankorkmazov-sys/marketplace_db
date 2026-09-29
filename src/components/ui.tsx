import {useEffect,useState,type ReactNode} from 'react'
import {Link,NavLink,useNavigate,useSearchParams} from 'react-router-dom'
import {Search,Heart,ShoppingCart,User,MapPin,Star,Store,Inbox,X,Smartphone,Laptop,Tablet,Headphones,Gamepad2,Shirt,Home as HomeIcon,Sparkles,BookOpen,Package,LayoutGrid,Truck,AlertCircle,Instagram,Send,Youtube,type LucideIcon} from 'lucide-react'
import {useStore} from '../context/Store'
import type {ProductStats} from '../services'
import {photoOverrides,productImages} from '../data/productImages'
export const formatPrice=(n:number)=>Math.round(n).toLocaleString('ru-RU')+' ₸'
export function useAsync<T>(fn:()=>Promise<T>,deps:unknown[]){const[s,set]=useState<{data?:T;error?:string;loading:boolean}>({loading:true})
useEffect(()=>{let ok=true;set({loading:true});fn().then(d=>ok&&set({data:d,loading:false})).catch(e=>ok&&set({error:String(e),loading:false}));return()=>{ok=false}},deps);return s}

export const btn={
 primary:'inline-flex items-center justify-center gap-2 rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-dark active:scale-[.98] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:cursor-not-allowed disabled:bg-neutral-200 disabled:text-neutral-400',
 secondary:'inline-flex items-center justify-center gap-2 rounded-lg border border-neutral-300 bg-white px-4 py-2 text-sm font-semibold transition hover:border-neutral-400 hover:bg-neutral-50 active:scale-[.98] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:opacity-50',
 danger:'inline-flex items-center justify-center gap-2 rounded-lg bg-red-50 px-3 py-2 text-sm font-medium text-brand transition hover:bg-red-100'}

const icons:[RegExp,LucideIcon][]=[[/phone|смарт/i,Smartphone],[/laptop|ноут/i,Laptop],[/tablet|планш/i,Tablet],[/head|науш|audio/i,Headphones],[/gam|игр/i,Gamepad2],[/cloth|одежд|shoe|fashion/i,Shirt],[/home|дом|appliance/i,HomeIcon],[/beauty|космет/i,Sparkles],[/book|книг/i,BookOpen]]
export const catIcon=(name:string):LucideIcon=>icons.find(([r])=>r.test(name))?.[1]??Package

export const Container=({children,className=''}:{children:ReactNode;className?:string})=><div className={`mx-auto w-full max-w-[1280px] px-4 md:px-6 ${className}`}>{children}</div>
export const Page=({title,children}:{title?:string;children:ReactNode})=><main><Container className="py-5 md:py-8">{title&&<h1 className="mb-5 text-2xl font-bold tracking-tight md:text-3xl">{title}</h1>}{children}</Container></main>
export const Skeleton=({n=10}:{n?:number})=><div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 md:gap-4">{Array.from({length:n},(_,i)=><div key={i} className="animate-pulse rounded-xl border border-neutral-200 bg-white p-3"><div className="aspect-square rounded-lg bg-neutral-100"/><div className="mt-3 h-3 w-2/3 rounded bg-neutral-100"/><div className="mt-2 h-4 w-1/2 rounded bg-neutral-100"/><div className="mt-4 h-8 rounded bg-neutral-100"/></div>)}</div>
export const LoadingState=()=><Skeleton/>
export const ErrorState=({msg}:{msg?:string})=><div className="py-16 text-center"><AlertCircle className="mx-auto text-brand" size={40}/><h2 className="mt-3 text-lg font-semibold">Не удалось загрузить данные</h2><p className="mt-1 text-sm text-neutral-500">{msg}</p><button className={`${btn.primary} mt-4`} onClick={()=>location.reload()}>Повторить</button></div>
export const EmptyState=({title,text,to='/',cta='Перейти к покупкам'}:{title:string;text?:string;to?:string;cta?:string})=><div className="mx-auto max-w-sm py-16 text-center"><div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-neutral-100"><Inbox className="text-neutral-400" size={28}/></div><h2 className="mt-4 text-lg font-semibold">{title}</h2><p className="mt-1 text-sm text-neutral-500">{text}</p><Link to={to} className={`${btn.primary} mt-5`}>{cta}</Link></div>
export const Stars=({v}:{v:number})=><span className="inline-flex items-center gap-1 text-sm font-medium"><Star size={14} className="fill-amber-400 text-amber-400"/>{v?v.toFixed(1):'—'}</span>

export const Img=({id,alt,className=''}:{id:number;alt:string;className?:string})=>{const[bad,setBad]=useState(false);const src=(!bad&&photoOverrides[id])||productImages[id]
return <div className={`flex items-center justify-center bg-white ${className}`}>{src?<img src={src} alt={alt} loading="lazy" onError={()=>setBad(true)} className="h-full w-full object-contain p-[8%]"/>:<Package className="text-neutral-300"/>}</div>}
export const Qty=({v,max,on}:{v:number;max:number;on:(n:number)=>void})=><div className="inline-flex items-center overflow-hidden rounded-lg border border-neutral-300 bg-white"><button aria-label="Меньше" className="h-9 w-9 hover:bg-neutral-100" onClick={()=>on(Math.max(1,v-1))}>−</button><span className="w-9 text-center text-sm font-medium">{v}</span><button aria-label="Больше" className="h-9 w-9 hover:bg-neutral-100 disabled:opacity-30" disabled={v>=max} onClick={()=>on(Math.min(max,v+1))}>+</button></div>
export const Logo=()=><Link to="/" className="flex shrink-0 items-center gap-2 text-xl font-extrabold tracking-tight"><span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand text-white"><Store size={18}/></span><span>Market<span className="text-brand">KZ</span></span></Link>

const Badge=({n}:{n:number})=>n>0?<span className="absolute -right-2 -top-1.5 min-w-4 rounded-full bg-brand px-1 text-center text-[10px] font-semibold leading-4 text-white">{n}</span>:null
export function Header(){const[sp]=useSearchParams();const[q,setQ]=useState(sp.get('q')??'');const nav=useNavigate();const{count,favs}=useStore()
useEffect(()=>setQ(sp.get('q')??''),[sp])
const act='relative flex flex-col items-center gap-0.5 text-xs text-neutral-600 transition hover:text-brand'
return <header className="sticky top-0 z-30 border-b border-neutral-200 bg-white/95 backdrop-blur"><Container className="flex flex-wrap items-center gap-x-6 gap-y-2 py-3">
<Logo/>
<form role="search" className="relative order-last w-full md:order-none md:mx-auto md:w-auto md:flex-1 md:max-w-2xl" onSubmit={e=>{e.preventDefault();nav(`/search?q=${encodeURIComponent(q.trim())}`)}}>
<label htmlFor="q" className="sr-only">Поиск товаров</label><Search size={18} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400"/>
<input id="q" value={q} onChange={e=>setQ(e.target.value)} placeholder="Искать товары" className="h-11 w-full rounded-lg border border-neutral-200 bg-neutral-100 pl-10 pr-24 text-sm outline-none transition focus:border-brand focus:bg-white focus:ring-2 focus:ring-brand/20"/>
{q&&<button type="button" aria-label="Очистить" onClick={()=>{setQ('');nav('/search?q=')}} className="absolute right-[4.5rem] top-1/2 -translate-y-1/2 rounded p-1 text-neutral-400 hover:text-neutral-700"><X size={16}/></button>}
<button className={`${btn.primary} absolute right-1 top-1 h-9`}>Найти</button></form>
<nav className="ml-auto flex items-center gap-5 md:gap-6"><span className="hidden items-center gap-1 text-sm text-neutral-600 lg:flex"><MapPin size={16}/>Алматы</span>
<Link to="/favorites" className={act} aria-label="Избранное"><Heart size={22}/><span className="hidden md:block">Избранное</span><Badge n={favs.length}/></Link>
<Link to="/cart" className={act} aria-label="Корзина"><ShoppingCart size={22}/><span className="hidden md:block">Корзина</span><Badge n={count}/></Link>
<Link to="/profile" className={`${act} max-md:hidden`}><User size={22}/><span>Профиль</span></Link></nav></Container></header>}

export function BottomNav(){const{count}=useStore();const items:[string,string,LucideIcon][]=[['/','Главная',Store],['/categories','Каталог',LayoutGrid],['/cart','Корзина',ShoppingCart],['/favorites','Избранное',Heart],['/profile','Профиль',User]]
return <nav aria-label="Навигация" className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 border-t border-neutral-200 bg-white pb-[env(safe-area-inset-bottom)] md:hidden">{items.map(([to,l,I])=><NavLink key={to} to={to} end={to==='/'} className={({isActive})=>`relative flex flex-col items-center gap-0.5 py-2 text-[10px] ${isActive?'text-brand':'text-neutral-500'}`}><I size={20}/>{l}{to==='/cart'&&<span className="absolute right-[28%] top-1"><Badge n={count}/></span>}</NavLink>)}</nav>}

export const Footer=()=><footer className="mt-12 border-t border-neutral-200 bg-white pb-16 md:pb-0"><Container className="grid gap-8 py-10 text-sm sm:grid-cols-2 lg:grid-cols-4">
<div><Logo/><p className="mt-3 text-neutral-500">Маркетплейс с доставкой по всему Казахстану.</p><div className="mt-3 flex gap-3 text-neutral-500"><Instagram size={18}/><Send size={18}/><Youtube size={18}/></div></div>
{[['Покупателям',['Как заказать','Доставка и оплата','Возврат']],['Помощь',['Поддержка','+7 700 000 00 00','support@marketkz.kz']],['О компании',['О нас','Вакансии','Партнёрам']]].map(([t,l])=><div key={t as string}><h3 className="mb-3 font-semibold">{t as string}</h3><ul className="space-y-2 text-neutral-500">{(l as string[]).map(x=><li key={x}>{x}</li>)}</ul></div>)}</Container>
<div className="border-t border-neutral-100 py-4 text-center text-xs text-neutral-400">© 2026 MarketKZ. Все права защищены.</div></footer>

export function ProductCard({p}:{p:ProductStats}){const{add,favs,toggleFav,cart}=useStore();const fav=favs.includes(p.product_id);const inCart=cart[p.product_id]>0
const badge=p.stock_quantity>0&&p.stock_quantity<=5?'Осталось мало':p.rating>=4.5&&p.reviews>=2?'Хит':null
return <article className="group flex flex-col overflow-hidden rounded-xl border border-neutral-200 bg-white transition duration-200 hover:-translate-y-0.5 hover:shadow-lg">
<div className="relative"><Link to={`/product/${p.product_id}`} tabIndex={-1}><Img id={p.product_id} alt={p.name} className="aspect-square w-full"/></Link>
{badge&&<span className="absolute left-2 top-2 rounded bg-brand px-1.5 py-0.5 text-[11px] font-semibold text-white">{badge}</span>}
<button aria-label="В избранное" aria-pressed={fav} onClick={()=>toggleFav(p.product_id)} className="absolute right-2 top-2 rounded-full bg-white/90 p-1.5 shadow-sm transition hover:scale-110"><Heart key={String(fav)} size={18} className={fav?'pop fill-brand text-brand':'text-neutral-500'}/></button></div>
<div className="flex flex-1 flex-col p-3"><div className="flex items-center gap-2 text-xs text-neutral-500"><Stars v={p.rating}/><span>{p.reviews} отзывов</span></div>
<Link to={`/product/${p.product_id}`} className="mt-1 line-clamp-2 min-h-10 text-sm leading-5 hover:text-brand">{p.name}</Link>
<div className="mt-2 text-xl font-bold tracking-tight">{formatPrice(p.price)}</div>
<div className={`mt-0.5 flex items-center gap-1 text-xs ${p.stock_quantity?'text-emerald-600':'text-neutral-400'}`}>{p.stock_quantity?<><Truck size={13}/>Доставка завтра</>:'Нет в наличии'}</div>
<button disabled={!p.stock_quantity} onClick={()=>add(p.product_id,p.stock_quantity)} className={`${inCart?btn.secondary:btn.primary} mt-3 w-full`}>{inCart?`В корзине · ${cart[p.product_id]}`:'Добавить в корзину'}</button></div></article>}
export const ProductGrid=({items,cols='lg:grid-cols-4 xl:grid-cols-5'}:{items:ProductStats[];cols?:string})=><div className={`grid grid-cols-2 gap-3 md:grid-cols-3 ${cols} md:gap-4`}>{items.map(p=><ProductCard key={p.product_id} p={p}/>)}</div>
