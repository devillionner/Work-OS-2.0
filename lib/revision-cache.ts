import { readSyncRevision } from './sync-revision.ts';

const CACHE_ORIGIN='https://work-os-cache.invalid';
// У Workers `caches.default` є, у DOM-типах (перевірка типів модулів без runtime Workers) його немає.
const edgeCache=():Cache=>(caches as unknown as {default:Cache}).default;

/** Ключ кешу й ревізія, за якою його взято: відповідь може нести ревізію, щоб клієнт не перечитував те, що вже бачив. */
export async function revisionCacheEntry(db:D1Database,userId:string,namespace:string,key:string):Promise<{request:Request;revision:number}> {
  const revision=await readSyncRevision(db,userId);
  return {request:await cacheRequestFor(userId,namespace,String(revision),key),revision};
}
export async function revisionCacheRequest(db:D1Database,userId:string,namespace:string,key:string):Promise<Request> {
  return (await revisionCacheEntry(db,userId,namespace,key)).request;
}
/** Кеш за власним ключем без глобальної ревізії (ключ сам несе потрібну версію даних, напр. суму ревізій днів). */
export async function keyedCacheRequest(userId:string,namespace:string,key:string):Promise<Request> {
  return cacheRequestFor(userId,namespace,'',key);
}
async function cacheRequestFor(userId:string,namespace:string,revision:string,key:string):Promise<Request> {
  const raw=`${namespace}\n${userId}\n${revision}\n${key}`;
  const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(raw));
  const hex=Array.from(new Uint8Array(digest),byte=>byte.toString(16).padStart(2,'0')).join('');
  return new Request(`${CACHE_ORIGIN}/${encodeURIComponent(namespace)}/${hex}`,{method:'GET'});
}
export async function matchRevisionJson(request:Request):Promise<Response|null> {
  try {
    const cached=await edgeCache().match(request);
    if(!cached)return null;
    return new Response(cached.body,{status:200,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Work-OS-Cache':'HIT'}});
  } catch { return null; }
}
export async function putRevisionJson(request:Request,value:unknown,maxAgeSeconds:number):Promise<void> {
  const ttl=Math.max(5,Math.min(600,Math.floor(maxAgeSeconds)));
  try {
    await edgeCache().put(request,new Response(JSON.stringify(value),{headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':`public,max-age=${ttl}`}}));
  } catch {}
}
