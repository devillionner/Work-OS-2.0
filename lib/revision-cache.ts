import { readSyncRevision } from './sync-revision.ts';

const CACHE_ORIGIN='https://work-os-cache.invalid';

export async function revisionCacheRequest(db:D1Database,userId:string,namespace:string,key:string):Promise<Request> {
  const revision=await readSyncRevision(db,userId);
  const raw=`${namespace}\n${userId}\n${revision}\n${key}`;
  const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(raw));
  const hex=Array.from(new Uint8Array(digest),byte=>byte.toString(16).padStart(2,'0')).join('');
  return new Request(`${CACHE_ORIGIN}/${encodeURIComponent(namespace)}/${hex}`,{method:'GET'});
}
export async function matchRevisionJson(request:Request):Promise<Response|null> {
  try {
    const cached=await caches.default.match(request);
    if(!cached)return null;
    return new Response(cached.body,{status:200,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Work-OS-Cache':'HIT'}});
  } catch { return null; }
}
export async function putRevisionJson(request:Request,value:unknown,maxAgeSeconds:number):Promise<void> {
  const ttl=Math.max(5,Math.min(600,Math.floor(maxAgeSeconds)));
  try {
    await caches.default.put(request,new Response(JSON.stringify(value),{headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':`public,max-age=${ttl}`}}));
  } catch {}
}
