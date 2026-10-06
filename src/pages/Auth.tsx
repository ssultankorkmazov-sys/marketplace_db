import {useState,type InputHTMLAttributes,type ReactNode} from 'react'
import {Link,useLocation,useNavigate} from 'react-router-dom'
import {useAuth} from '../context/Auth'
import {btn,Container,Logo} from '../components/ui'
const Field=({label,error,...p}:{label:string;error?:string}&InputHTMLAttributes<HTMLInputElement>)=><label className="block text-sm"><span className="mb-1 block text-neutral-600">{label}</span><input {...p} aria-invalid={!!error} className={`h-10 w-full rounded-lg border px-3 text-sm outline-none focus:border-brand ${error?'border-brand':'border-neutral-300'}`}/>{error&&<span role="alert" className="mt-1 block text-xs text-brand">{error}</span>}</label>
const Shell=({title,children}:{title:string;children:ReactNode})=><main><Container className="py-8 md:py-14"><div className="mx-auto max-w-md rounded-xl border border-neutral-200 bg-white p-6 md:p-8"><div className="mb-5 flex flex-col items-center gap-3"><Logo/><h1 className="text-xl font-bold">{title}</h1></div>{children}</div></Container></main>
export function Login(){const{login,session}=useAuth();const nav=useNavigate();const from=(useLocation().state as {from?:string}|null)?.from
const[f,setF]=useState({email:'',password:''});const[err,setErr]=useState('');const[hint,setHint]=useState(false)
return <Shell title="Вход в MarketKZ"><form className="space-y-3" onSubmit={e=>{e.preventDefault();try{login(f.email,f.password);setErr('');nav(from??(f.email.trim().toLowerCase().startsWith('admin@')?'/admin':'/'),{replace:true})}catch(x){setErr((x as Error).message)}}}>
<Field label="Email" type="email" required autoComplete="email" value={f.email} onChange={e=>setF({...f,email:e.target.value})}/><Field label="Пароль" type="password" required autoComplete="current-password" value={f.password} onChange={e=>setF({...f,password:e.target.value})}/>
{err&&<p role="alert" className="text-sm text-brand">{err}</p>}<button className={`${btn.primary} h-10 w-full`}>Войти</button>
<button type="button" onClick={()=>setHint(true)} className="text-xs text-neutral-500 hover:text-brand">Забыли пароль?</button>{hint&&<p className="text-xs text-neutral-500">Демо-режим: восстановление пароля недоступно.</p>}</form>
<p className="mt-4 text-center text-sm text-neutral-500">Нет аккаунта? <Link to="/register" className="font-medium text-brand">Регистрация</Link></p>
<p className="mt-4 rounded-lg bg-neutral-50 p-3 text-xs text-neutral-500">Демо (не защищено): админ <b>admin@marketkz.kz</b> / <b>admin123</b>. Для пользователей из базы пароль <b>user123</b>.</p>{session&&null}</Shell>}
const EMAIL=/^[^\s@]+@[^\s@]+\.[^\s@]+$/
export function Register(){const{register}=useAuth();const nav=useNavigate();const[f,setF]=useState({name:'',email:'',phone:'',address:'',password:'',confirm:''});const[e,setE]=useState<Record<string,string>>({})
const set=(k:keyof typeof f)=>(ev:React.ChangeEvent<HTMLInputElement>)=>setF({...f,[k]:ev.target.value})
function submit(ev:React.FormEvent){ev.preventDefault();const x:Record<string,string>={}
if(!f.name.trim())x.name='Введите имя';if(!EMAIL.test(f.email.trim()))x.email='Введите корректный email';if(!f.phone.trim())x.phone='Введите телефон'
if(f.password.length<6)x.password='Минимум 6 символов';if(f.confirm!==f.password)x.confirm='Пароли не совпадают'
if(!Object.keys(x).length){try{register(f);nav('/profile');return}catch(z){x.form=(z as Error).message}}setE(x)}
return <Shell title="Регистрация"><form noValidate className="space-y-3" onSubmit={submit}>
<Field label="Имя" value={f.name} onChange={set('name')} error={e.name} autoComplete="name"/><Field label="Email" type="email" value={f.email} onChange={set('email')} error={e.email} autoComplete="email"/>
<Field label="Телефон" type="tel" placeholder="+7 7XX XXX XX XX" value={f.phone} onChange={set('phone')} error={e.phone}/><Field label="Адрес" value={f.address} onChange={set('address')} error={e.address}/>
<Field label="Пароль" type="password" value={f.password} onChange={set('password')} error={e.password} autoComplete="new-password"/><Field label="Повторите пароль" type="password" value={f.confirm} onChange={set('confirm')} error={e.confirm} autoComplete="new-password"/>
{e.form&&<p role="alert" className="text-sm text-brand">{e.form}</p>}<button className={`${btn.primary} h-10 w-full`}>Создать аккаунт</button></form>
<p className="mt-4 text-center text-sm text-neutral-500">Уже есть аккаунт? <Link to="/login" className="font-medium text-brand">Войти</Link></p></Shell>}
