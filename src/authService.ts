// FRONTEND DEMO AUTH ONLY. localStorage auth is NOT secure. Credentials live apart from the DB-shaped users table.
import {T,checkSeedVersion} from './data/store'
import {addUser} from './services'
export interface AuthUser{user_id:number;email:string;role:'user'|'admin';isAuthenticated:boolean}
const AUTH='marketkz_auth',CREDS='marketkz_credentials'
export const DEMO_ADMIN={email:'admin@marketkz.kz',password:'admin123'}
const DEMO_USER_PASSWORD='user123' // seeded users have no stored password
const norm=(e:string)=>e.trim().toLowerCase()
const creds=():Record<string,string>=>{try{return JSON.parse(localStorage.getItem(CREDS)??'{}')}catch{return{}}}
const open=(s:AuthUser)=>{localStorage.setItem(AUTH,JSON.stringify(s));return s}
export const getSession=():AuthUser|null=>{checkSeedVersion();try{const s=JSON.parse(localStorage.getItem(AUTH)??'null') as AuthUser|null;return s?.isAuthenticated?s:null}catch{return null}}
export const isAuthenticated=()=>getSession()!==null
export const getCurrentUser=()=>{const s=getSession();return s?T.users().find(u=>u.user_id===s.user_id):undefined}
export function login(email:string,password:string):AuthUser{const e=norm(email)
if(e===DEMO_ADMIN.email||e==='admin@marketz.kz'){if(password!==DEMO_ADMIN.password)throw new Error('Неверный email или пароль');return open({user_id:0,email:DEMO_ADMIN.email,role:'admin',isAuthenticated:true})}
const u=T.users().find(x=>norm(x.email)===e);if(!u||password!==(creds()[e]??DEMO_USER_PASSWORD))throw new Error('Неверный email или пароль')
return open({user_id:u.user_id,email:u.email,role:'user',isAuthenticated:true})}
export function register(d:{name:string;email:string;phone:string;address:string;password:string}):AuthUser{const e=norm(d.email)
if(e===DEMO_ADMIN.email||T.users().some(x=>norm(x.email)===e))throw new Error('Пользователь с таким email уже существует')
if(T.users().some(x=>x.phone===d.phone.trim()))throw new Error('Этот телефон уже используется')
const u=addUser({name:d.name.trim(),email:e,phone:d.phone.trim(),address:d.address.trim()||null})
localStorage.setItem(CREDS,JSON.stringify({...creds(),[e]:d.password}));return open({user_id:u.user_id,email:u.email,role:'user',isAuthenticated:true})}
export const logout=()=>localStorage.removeItem(AUTH)
