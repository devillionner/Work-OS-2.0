import { env } from 'cloudflare:workers';
import { getCurrentUser } from '@/lib/auth';
import { readJsonObject, sameOrigin } from '@/lib/http-json';
import { DiscoveryError } from '@/lib/chat-discovery/domain';
import {
  confirmLocalDiscoveryPreview,
  persistLocalDiscoveryOutcome,
  previewTelegramDiscoveryText,
  searchLocalDiscoveryPreview,
} from '@/lib/chat-discovery/local-preview';

function json(value:unknown,status=200){
  return Response.json(value,{status,headers:{'Cache-Control':'no-store'}});
}

export async function POST(request:Request):Promise<Response>{
  const user=await getCurrentUser();
  if(!user)return json({error:'Потрібна авторизація.'},401);
  if(!sameOrigin(request))return json({error:'Недійсне джерело запиту.'},403);
  const body=await readJsonObject(request,256*1024);
  if(body instanceof Response)return body;
  const now=Math.floor(Date.now()/1000);
  try{
    if(body.action==='search'){
      return json(await searchLocalDiscoveryPreview(env.DB,user.id,{
        platforms:body.platforms,
        telegramCursor:body.telegramCursor,
        sourceCursor:body.sourceCursor,
        knownLinks:body.knownLinks,
        minMembers:body.minMembers,
      },now));
    }
    if(body.action==='telegram'){
      return json(await previewTelegramDiscoveryText(env.DB,user.id,{
        text:body.text,sourceUrl:body.sourceUrl,sourceTitle:body.sourceTitle,query:body.query,
        seedLabel:body.seedLabel,context:body.context,knownLinks:body.knownLinks,minMembers:body.minMembers,
      },now));
    }
    if(body.action==='persist-outcome'){
      return json(await persistLocalDiscoveryOutcome(env.DB,user.id,{
        platform:body.platform,link:body.link,name:body.name,sources:body.sources,minMembers:body.minMembers,outcome:body.outcome,
      },now));
    }
    if(body.action==='confirm'){
      return json(await confirmLocalDiscoveryPreview(env.DB,user.id,{
        platform:body.platform,link:body.link,name:body.name,sources:body.sources,minMembers:body.minMembers,runId:body.runId,preflight:body.preflight,
      },now));
    }
    throw new DiscoveryError('Невідома preview-дія.');
  }catch(error){
    if(error instanceof DiscoveryError)return json({error:error.message},error.status);
    console.error('Local discovery preview failed',error instanceof Error?error.name:'unknown');
    return json({error:'Локальний preview пошуку не завершено. Спробуйте ще раз.'},500);
  }
}
