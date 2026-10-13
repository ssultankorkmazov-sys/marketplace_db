import {createContext,useContext,useEffect,useState,type ReactNode} from 'react'
import * as auth from '../authService'
interface Ctx{session:auth.AuthSession|null;ready:boolean;login:(e:string,p:string)=>Promise<void>;register:(d:auth.RegisterData)=>Promise<void>;logout:()=>void;updateProfile:(d:{name:string;phone:string;address:string|null})=>Promise<void>}
const C=createContext<Ctx>(null!)
export const AuthProvider=({children}:{children:ReactNode})=>{const[session,setS]=useState<auth.AuthSession|null>(null);const[ready,setReady]=useState(false)
useEffect(()=>{let active=true;try{localStorage.removeItem('marketkz_auth');localStorage.removeItem('marketkz_credentials')}catch{/* Auth is server-backed even when browser storage is unavailable. */}void auth.getSession().then(s=>{if(active)setS(s)}).catch(()=>{if(active)setS(null)}).finally(()=>{if(active)setReady(true)});return()=>{active=false}},[])
const login=async(e:string,p:string)=>setS(await auth.login(e,p));const register=async(d:auth.RegisterData)=>setS(await auth.register(d));const logout=()=>{setS(null);void auth.logout()};const updateProfile=async(d:{name:string;phone:string;address:string|null})=>setS(await auth.updateProfile(d))
return <C.Provider value={{session,ready,login,register,logout,updateProfile}}>{children}</C.Provider>}
export const useAuth=()=>useContext(C)
