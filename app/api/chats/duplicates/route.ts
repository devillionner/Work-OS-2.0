import { env } from 'cloudflare:workers';
import { getCurrentUser } from '@/lib/auth';
import { ChatDuplicateError, readChatDuplicateGroups, renameDuplicateChat } from '@/lib/chats/duplicates';
import { readJsonObject, sameOrigin } from '@/lib/http-json';

const PLATFORMS=new Set(['telegram','whatsapp','viber','facebook']);
const REQUEST_MAX_BYTES=16*1024;

export async function GET(request:Request):Promise<Response>{
  const user=await getCurrentUser();
  if(!user)return Response.json({error:'Потрібно увійти.'},{status:401});
  const url=new URL(request.url);
  const platform=(url.searchParams.get('platform')||'telegram').trim();
  if(!PLATFORMS.has(platform))return bad('Невідома платформа.');
  const accountId=platform==='telegram'?await selectedAccount(user.id,url.searchParams.get('account')):null;
  try{
    const groups=await readChatDuplicateGroups(env.DB,{userId:user.id,platform,accountId});
    return Response.json({platform,accountId,groups},{headers:{'Cache-Control':'no-store'}});
  }catch(reason){return duplicateError(reason);}
}

export async function POST(request:Request):Promise<Response>{
  const user=await getCurrentUser();
  if(!user)return Response.json({error:'Потрібно увійти.'},{status:401});
  if(!sameOrigin(request))return Response.json({error:'Недійсний запит.'},{status:403});
  const parsed=await readJsonObject(request,REQUEST_MAX_BYTES);
  if(parsed instanceof Response)return parsed;
  const action=text(parsed.action);
  if(action!=='rename')return bad('Невідома дія менеджера дублікатів.');
  const id=text(parsed.id);
  const stateToken=typeof parsed.stateToken==='string'?parsed.stateToken:'';
  const name=typeof parsed.name==='string'?parsed.name:'';
  if(!id||!stateToken)return bad('Некоректний стан чату.');
  try{
    return Response.json({ok:true,...await renameDuplicateChat(env.DB,{userId:user.id,id,stateToken,name,now:unixNow()})});
  }catch(reason){return duplicateError(reason);}
}

function duplicateError(reason:unknown){
  if(reason instanceof ChatDuplicateError)return Response.json({error:reason.message},{status:reason.status});
  console.error('chat duplicate manager error',reason);
  return Response.json({error:'Не вдалося оновити менеджер дублікатів.'},{status:500});
}
function bad(error:string){return Response.json({error},{status:400});}
function text(value:unknown){return typeof value==='string'?value.trim().slice(0,200):'';}
function unixNow(){return Math.floor(Date.now()/1000);}
async function selectedAccount(userId:string,requested:string|null){
  const row=requested
    ? await env.DB.prepare(`SELECT id FROM telegram_accounts WHERE id=?1 AND user_id=?2 AND is_enabled=1 LIMIT 1`).bind(requested,userId).first<{id:string}>()
    : await env.DB.prepare(`SELECT id FROM telegram_accounts WHERE user_id=?1 AND is_enabled=1 ORDER BY is_selected DESC,account_number LIMIT 1`).bind(userId).first<{id:string}>();
  return row?.id||null;
}
