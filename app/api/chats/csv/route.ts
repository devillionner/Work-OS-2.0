import { env } from 'cloudflare:workers';
import { getCurrentUser } from '@/lib/auth';
import { businessDate } from '@/lib/business-time';
import { applyChatCsvImport, CHAT_CSV_MAX_BYTES, ChatCsvError, exportChatCsv, parseChatCsv, previewChatCsvImport, stripRows } from '@/lib/chats/csv';
import { sameOrigin } from '@/lib/http-json';

export async function GET():Promise<Response>{
  const user=await getCurrentUser();
  if(!user)return Response.json({error:'Потрібно увійти.'},{status:401});
  try{
    const csv=await exportChatCsv(env.DB,user.id);
    const filename=`work-os-chats-${businessDate(unixNow())}.csv`;
    return new Response(csv,{headers:{
      'Content-Type':'text/csv; charset=utf-8',
      'Content-Disposition':`attachment; filename="${filename}"`,
      'Cache-Control':'no-store',
      'X-Content-Type-Options':'nosniff',
    }});
  }catch(reason){return csvError(reason);}
}

export async function POST(request:Request):Promise<Response>{
  const user=await getCurrentUser();
  if(!user)return Response.json({error:'Потрібно увійти.'},{status:401});
  if(!sameOrigin(request))return Response.json({error:'Недійсний запит.'},{status:403});
  const mode=new URL(request.url).searchParams.get('mode');
  if(mode!=='preview'&&mode!=='apply')return Response.json({error:'Невідомий режим CSV.'},{status:400});
  const body=await readCsvBody(request);
  if(body instanceof Response)return body;
  try{
    const rows=parseChatCsv(body);
    if(mode==='preview'){
      const preview=await previewChatCsvImport(env.DB,user.id,rows);
      return Response.json(stripRows(preview),{headers:{'Cache-Control':'no-store'}});
    }
    const revisionText=new URL(request.url).searchParams.get('revision')||'';
    if(!/^\d+$/.test(revisionText))return Response.json({error:'Спочатку виконайте preview CSV.'},{status:400});
    const expectedRevision=Number(revisionText);
    if(!Number.isSafeInteger(expectedRevision)||expectedRevision<0)return Response.json({error:'Некоректна версія preview.'},{status:400});
    const result=await applyChatCsvImport(env.DB,{userId:user.id,rows,expectedRevision,now:unixNow()});
    return Response.json(result,{headers:{'Cache-Control':'no-store'}});
  }catch(reason){return csvError(reason);}
}

async function readCsvBody(request:Request):Promise<string|Response>{
  const mediaType=(request.headers.get('content-type')||'').split(';',1)[0].trim().toLowerCase();
  if(mediaType!=='text/csv')return Response.json({error:'CSV потрібно надіслати як text/csv.'},{status:415});
  const declared=Number(request.headers.get('content-length')||0);
  if(Number.isFinite(declared)&&declared>CHAT_CSV_MAX_BYTES)return Response.json({error:'CSV завеликий.'},{status:413});
  const text=await request.text();
  if(new TextEncoder().encode(text).byteLength>CHAT_CSV_MAX_BYTES)return Response.json({error:'CSV завеликий.'},{status:413});
  return text;
}
function csvError(reason:unknown){
  if(reason instanceof ChatCsvError)return Response.json({error:reason.message},{status:reason.status});
  console.error('chat csv error',reason);
  return Response.json({error:'Не вдалося обробити CSV чатів.'},{status:500});
}
function unixNow(){return Math.floor(Date.now()/1000);}
