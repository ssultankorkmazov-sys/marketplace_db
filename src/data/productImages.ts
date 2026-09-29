// Frontend-only mapping (the DB has no image_url column).
export const productImages:Record<number,string>=Object.fromEntries(Array.from({length:50},(_,i)=>[i+1,`https://picsum.photos/seed/marketkz${i+1}/500/500`]))
