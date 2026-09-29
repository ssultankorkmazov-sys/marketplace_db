// Frontend-only image mapping (the DB has no image_url column).
// Locally drawn product illustrations: always load, no external dependency.
// To use real photos, add product_id -> URL to `photoOverrides`; Img falls back to the illustration on error.
import {products,categories} from './mock'
const svg=(b:string)=>'data:image/svg+xml,'+encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#3f3f46"/><stop offset="1" stop-color="#18181b"/></linearGradient></defs><ellipse cx="100" cy="184" rx="58" ry="6" fill="#000" opacity=".08"/>${b}</svg>`)
const D='url(#g)',S='#e9eef7',R='#c8102e'
const art:Record<string,string>={
phone:`<rect x="62" y="16" width="76" height="162" rx="14" fill="${D}"/><rect x="67" y="24" width="66" height="146" rx="9" fill="${S}"/><rect x="72" y="30" width="56" height="58" rx="8" fill="${R}" opacity=".85"/><rect x="72" y="96" width="36" height="6" rx="3" fill="#a1a1aa"/>`,
laptop:`<rect x="40" y="44" width="120" height="84" rx="6" fill="${D}"/><rect x="46" y="50" width="108" height="72" rx="3" fill="${S}"/><rect x="52" y="56" width="50" height="8" rx="2" fill="${R}"/><path d="M20 134h160l-10 14H30z" fill="#b9bcc4"/>`,
tablet:`<rect x="44" y="26" width="112" height="148" rx="12" fill="${D}"/><rect x="51" y="33" width="98" height="134" rx="6" fill="${S}"/><rect x="57" y="40" width="86" height="42" rx="5" fill="${R}" opacity=".85"/>`,
earbuds:`<rect x="48" y="112" width="104" height="58" rx="20" fill="#f4f4f5" stroke="#d4d4d8" stroke-width="3"/><circle cx="100" cy="141" r="5" fill="#a1a1aa"/><path d="M70 100a11 11 0 1 1 22 0v20H70z M108 100a11 11 0 1 1 22 0v20h-22z" fill="#fff" stroke="#d4d4d8" stroke-width="3"/>`,
headphones:`<path d="M52 122V98a48 48 0 0 1 96 0v24" fill="none" stroke="#27272a" stroke-width="10"/><rect x="38" y="112" width="30" height="54" rx="13" fill="${D}"/><rect x="132" y="112" width="30" height="54" rx="13" fill="${D}"/>`,
console:`<path d="M84 18h32l16 152H68z" fill="#f5f5f5" stroke="#d4d4d8" stroke-width="2"/><path d="M95 18h10l7 152H88z" fill="#1f2937"/><rect x="72" y="170" width="56" height="8" rx="3" fill="#a1a1aa"/>`,
mouse:`<rect x="68" y="34" width="64" height="118" rx="32" fill="${D}"/><path d="M100 34v48" stroke="#71717a" stroke-width="2"/><rect x="96" y="50" width="8" height="18" rx="4" fill="${R}"/>`,
vacuum:`<rect x="92" y="16" width="16" height="112" rx="6" fill="#9ca3af"/><rect x="72" y="118" width="56" height="34" rx="9" fill="${R}"/><rect x="58" y="152" width="84" height="12" rx="6" fill="${D}"/>`,
watch:`<rect x="76" y="10" width="48" height="180" rx="14" fill="#52525b"/><rect x="58" y="54" width="84" height="92" rx="24" fill="${D}"/><rect x="65" y="61" width="70" height="78" rx="18" fill="${S}"/><rect x="74" y="74" width="30" height="8" rx="2" fill="${R}"/>`,
box:`<rect x="48" y="58" width="104" height="94" rx="8" fill="#d4d4d8"/><path d="M48 84h104" stroke="#a1a1aa" stroke-width="3"/>`}
const kinds:[RegExp,string][]=[[/watch|часы/i,'watch'],[/airpods|earbud/i,'earbuds'],[/headphone|науш/i,'headphones'],[/tablet|ipad|планш/i,'tablet'],[/laptop|macbook|ноут/i,'laptop'],[/phone|смарт/i,'phone'],[/mouse|мыш/i,'mouse'],[/console|playstation|xbox/i,'console'],[/vacuum|пылесос/i,'vacuum']]
const catName=(id:number)=>categories.find(c=>c.category_id===id)?.category_name??''
const kindOf=(t:string)=>kinds.find(([r])=>r.test(t))?.[1]??'box'
export const photoOverrides:Record<number,string>={}
export const productImages:Record<number,string>=Object.fromEntries(products.map(p=>[p.product_id,svg(art[kindOf(`${p.name} ${p.description??''} ${catName(p.category_id)}`)])]))
