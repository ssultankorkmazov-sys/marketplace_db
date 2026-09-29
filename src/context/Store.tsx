import {createContext,useContext,useEffect,useState,type ReactNode} from 'react'
type Cart=Record<number,number>
interface Ctx{cart:Cart;favs:number[];add:(id:number,stock:number,q?:number)=>void;setQty:(id:number,q:number)=>void;remove:(id:number)=>void;clear:()=>void;toggleFav:(id:number)=>void;count:number}
const C=createContext<Ctx>(null!)
const load=<T,>(k:string,d:T):T=>{try{return JSON.parse(localStorage.getItem(k)??'')as T}catch{return d}}
export const StoreProvider=({children}:{children:ReactNode})=>{
const[cart,setCart]=useState<Cart>(()=>load('cart',{}));const[favs,setFavs]=useState<number[]>(()=>load('favs',[]))
useEffect(()=>localStorage.setItem('cart',JSON.stringify(cart)),[cart]);useEffect(()=>localStorage.setItem('favs',JSON.stringify(favs)),[favs])
const add=(id:number,stock:number,q=1)=>setCart(c=>({...c,[id]:Math.min(stock,(c[id]??0)+q)}))
const setQty=(id:number,q:number)=>setCart(c=>({...c,[id]:Math.max(1,q)}))
const remove=(id:number)=>setCart(c=>{const n={...c};delete n[id];return n})
const toggleFav=(id:number)=>setFavs(f=>f.includes(id)?f.filter(x=>x!==id):[...f,id])
return <C.Provider value={{cart,favs,add,setQty,remove,clear:()=>setCart({}),toggleFav,count:Object.values(cart).reduce((a,b)=>a+b,0)}}>{children}</C.Provider>}
export const useStore=()=>useContext(C)
