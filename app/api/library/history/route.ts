import { env } from 'cloudflare:workers';
import { getCurrentUser } from '@/lib/auth';

export async function GET(request:Request):Promise<Response>{
  const user=await getCurrentUser();
  if(!user)return Response.json({error:'Потрібно увійти.'},{status:401});
  const id=(new URL(request.url).searchParams.get('id')||'').trim();
  if(!id)return Response.json({error:'Матеріал не знайдено.'},{status:400});
  const item=await env.DB.prepare(`SELECT id,title,collection,version FROM library_items WHERE id=?1 AND user_id=?2 LIMIT 1`).bind(id,user.id).first<{id:string;title:string;collection:string;version:number}>();
  if(!item)return Response.json({error:'Матеріал не знайдено.'},{status:404});
  const history=await env.DB.prepare(`SELECT id,version_number,action,kind,collection,title,uk_text,ru_text,notes,tags_json,platforms_json,archived_at,saved_at
    FROM library_item_versions WHERE user_id=?1 AND item_id=?2 ORDER BY version_number DESC LIMIT 50`).bind(user.id,id).all<HistoryRow>();
  return Response.json({item:{...item,version:Number(item.version)},versions:history.results.map(publicVersion)},{headers:{'Cache-Control':'no-store'}});
}

type HistoryRow={id:string;version_number:number;action:string;kind:string;collection:string;title:string;uk_text:string;ru_text:string;notes:string;tags_json:string;platforms_json:string;archived_at:number|null;saved_at:number};
function publicVersion(row:HistoryRow){return {id:row.id,versionNumber:Number(row.version_number),action:row.action,kind:row.kind,collection:row.collection,title:row.title,ukText:row.uk_text,ruText:row.ru_text,notes:row.notes,tags:parseList(row.tags_json),platforms:parseList(row.platforms_json),archivedAt:row.archived_at,savedAt:Number(row.saved_at)};}
function parseList(value:string):string[]{try{const parsed=JSON.parse(value);return Array.isArray(parsed)?parsed.filter((item):item is string=>typeof item==='string'):[];}catch{return[];}}
