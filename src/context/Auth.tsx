import {createContext,useContext,useState,type ReactNode} from 'react'
import * as auth from '../authService'
interface Ctx{session:auth.AuthUser|null;login:(e:string,p:string)=>void;register:(d:Parameters<typeof auth.register>[0])=>void;logout:()=>void}
const C=createContext<Ctx>(null!)
export const AuthProvider=({children}:{children:ReactNode})=>{const[session,setS]=useState(auth.getSession())
return <C.Provider value={{session,login:(e,p)=>setS(auth.login(e,p)),register:d=>setS(auth.register(d)),logout:()=>{auth.logout();setS(null)}}}>{children}</C.Provider>}
export const useAuth=()=>useContext(C)
