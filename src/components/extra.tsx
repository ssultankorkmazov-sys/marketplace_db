import {useEffect,type ReactNode} from 'react'
import {Link} from 'react-router-dom'
import {ChevronRight,X} from 'lucide-react'
export type Crumb={label:string;to?:string}
export const Breadcrumbs=({items}:{items:Crumb[]})=><nav aria-label="Хлебные крошки" className="no-scrollbar flex items-center gap-1 overflow-x-auto whitespace-nowrap text-xs text-neutral-500">{items.map((c,i)=><span key={i} className="flex items-center gap-1">{i>0&&<ChevronRight size={12}/>}{c.to?<Link to={c.to} className="hover:text-brand">{c.label}</Link>:<span className="text-neutral-800">{c.label}</span>}</span>)}</nav>
export function Drawer({open,title,onClose,children}:{open:boolean;title:string;onClose:()=>void;children:ReactNode}){
useEffect(()=>{document.body.style.overflow=open?'hidden':'';return()=>{document.body.style.overflow=''}},[open]);if(!open)return null
return <div className="fixed inset-0 z-50 md:hidden" role="dialog" aria-modal="true" aria-label={title}><div className="absolute inset-0 bg-black/40" onClick={onClose}/><div className="absolute inset-x-0 bottom-0 max-h-[85vh] overflow-y-auto rounded-t-2xl bg-white p-5"><div className="mb-4 flex items-center justify-between"><h2 className="font-semibold">{title}</h2><button aria-label="Закрыть" onClick={onClose}><X size={20}/></button></div>{children}</div></div>}
