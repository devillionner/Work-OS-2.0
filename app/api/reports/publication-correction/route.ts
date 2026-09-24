import { env } from 'cloudflare:workers';
import { getCurrentUser } from '@/lib/auth';
import { readHistoricalPublicationOptions, recordHistoricalPublication, ReportCorrectionError, validateAccountingDate } from '@/lib/reports/publication-correction';
import { readBoundedText } from '@/lib/http-body';

const REQUEST_MAX_BYTES=32*1024;

export async function GET(request:Request):Promise<Response>{
  const user=await getCurrentUser();
  if(!user)return Response.json({error:'Потрібно увійти.'},{status:401});
  const url=new URL(request.url);
  const date=(url.searchParams.get('date')||'').trim();
  try{
    validateAccountingDate(date,unixNow());
    const options=await readHistoricalPublicationOptions(env.DB,{userId:user.id,date,search:url.searchParams.get('search')||'',platform:url.searchParams.get('platform')});
    return Response.json(options,{headers:{'Cache-Control':'no-store'}});
  }catch(reason){return correctionError(reason);}
}

export async function POST(request:Request):Promise<Response>{
  const user=await getCurrentUser();
  if(!user)return Response.json({error:'Потрібно увійти.'},{status:401});
  if(!sameOrigin(request))return Response.json({error:'Недійсний запит.'},{status:403});
  const body=await readJson(request);
  if(body instanceof Response)return body;
  const date=text(body.date,10);
  const chatId=text(body.chatId,200);
  const telegramAccountId=nullableText(body.telegramAccountId,200);
  const advertisementId=nullableText(body.advertisementId,200);
  const language=body.language==='uk'||body.language==='ru'?body.language:null;
  if(!date||!chatId)return Response.json({error:'Оберіть дату та чат.'},{status:400});
  try{
    const result=await recordHistoricalPublication(env.DB,{userId:user.id,chatId,date,telegramAccountId,advertisementId,language,now:unixNow()});
    return Response.json({ok:true,...result});
  }catch(reason){return correctionError(reason);}
}

function correctionError(reason:unknown){
  if(reason instanceof ReportCorrectionError)return Response.json({error:reason.message},{status:reason.status});
  console.error('historical publication correction error',reason);
  return Response.json({error:'Не вдалося додати історичну публікацію.'},{status:500});
}
async function readJson(request:Request):Promise<Record<string,unknown>|Response>{
  const media=(request.headers.get('content-type')||'').split(';',1)[0].trim().toLowerCase();
  if(media!=='application/json')return Response.json({error:'Очікується application/json.'},{status:415});
  const raw=await readBoundedText(request,REQUEST_MAX_BYTES);
  if(raw instanceof Response)return raw;
  let parsed:unknown;try{parsed=JSON.parse(raw);}catch{return Response.json({error:'Некоректний JSON.'},{status:400});}
  return parsed&&typeof parsed==='object'&&!Array.isArray(parsed)?parsed as Record<string,unknown>:Response.json({error:'Некоректний запит.'},{status:400});
}
function text(value:unknown,max:number){return typeof value==='string'?value.trim().slice(0,max):'';}
function nullableText(value:unknown,max:number){const valueText=text(value,max);return valueText||null;}
function sameOrigin(request:Request){const origin=request.headers.get('origin');return Boolean(origin&&origin===new URL(request.url).origin);}
function unixNow(){return Math.floor(Date.now()/1000);}
