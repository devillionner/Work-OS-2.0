import { env } from 'cloudflare:workers';
import { getCurrentUser } from '@/lib/auth';
import { ChatDuplicateError, mergeDuplicateChats, readChatDuplicateGroups, renameDuplicateChat } from '@/lib/chats/duplicates';
import { readJsonObject, sameOrigin } from '@/lib/http-json';

const PLATFORMS=new Set(['telegram','whatsapp','viber','facebook']);
const REQUEST_MAX_BYTES=16*1024;

export async function GET(request:Request):Promise<Response>{
  const user=await getCurrentUser();
  if(!user)return Response.json({error:'Потрібно увійти.'},{status:401});
  const url=new URL(request.url);
  const requested=(url.searchParams.get('platform')||'').trim();
  if(requested&&!PLATFORMS.has(requested))return bad('Невідома платформа.');
  try{
    // Дублікати шукаються по всіх акаунтах Telegram: один чат живе лише в одному акаунті.
    const {groups,indexing}=await readChatDuplicateGroups(env.DB,{userId:user.id,platform:requested||null});
    return Response.json({platform:requested||null,groups,indexing},{headers:{'Cache-Control':'no-store'}});
  }catch(reason){return duplicateError(reason);}
}

export async function POST(request:Request):Promise<Response>{
  const user=await getCurrentUser();
  if(!user)return Response.json({error:'Потрібно увійти.'},{status:401});
  if(!sameOrigin(request))return Response.json({error:'Недійсний запит.'},{status:403});
  const parsed=await readJsonObject(request,REQUEST_MAX_BYTES);
  if(parsed instanceof Response)return parsed;
  const action=text(parsed.action);
  try{
    if(action==='merge'){
      const keepId=text(parsed.keepId);
      const removeIds=Array.isArray(parsed.removeIds)?parsed.removeIds.filter((id):id is string=>typeof id==='string').map(id=>id.trim().slice(0,200)):[];
      const result=await mergeDuplicateChats(env.DB,{userId:user.id,keepId,removeIds,acceptLoss:parsed.acceptLoss===true,now:unixNow()});
      return Response.json({ok:true,...result});
    }
    if(action!=='rename')return bad('Невідома дія менеджера дублікатів.');
    const id=text(parsed.id);
    const stateToken=typeof parsed.stateToken==='string'?parsed.stateToken:'';
    const name=typeof parsed.name==='string'?parsed.name:'';
    if(!id||!stateToken)return bad('Некоректний стан чату.');
    return Response.json({ok:true,...await renameDuplicateChat(env.DB,{userId:user.id,id,stateToken,name,now:unixNow()})});
  }catch(reason){return duplicateError(reason);}
}

function duplicateError(reason:unknown){
  if(reason instanceof ChatDuplicateError)return Response.json({error:reason.message,code:reason.code||undefined},{status:reason.status});
  console.error('chat duplicate manager error',reason);
  return Response.json({error:'Не вдалося оновити менеджер дублікатів.'},{status:500});
}
function bad(error:string){return Response.json({error},{status:400});}
function text(value:unknown){return typeof value==='string'?value.trim().slice(0,200):'';}
function unixNow(){return Math.floor(Date.now()/1000);}
