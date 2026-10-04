import { env } from 'cloudflare:workers';
import { getCurrentUser } from '@/lib/auth';
import { readJsonObject, sameOrigin } from '@/lib/http-json';
import { DiscoveryError } from '@/lib/chat-discovery/domain';
import {
  archiveLocalDiscoveryOutcomes,
  confirmLocalDiscoveryPreview,
  previewTelegramDiscoveryText,
  readDiscoveryTelegramGroupSources,
} from '@/lib/chat-discovery/local-preview';

function json(value:unknown,status=200){
  return Response.json(value,{status,headers:{'Cache-Control':'no-store'}});
}

// Confirming a found target can insert a new to_join chat, which is executor-dispatchable work for
// the owner Durable Object — see app/api/chat-discovery/route.ts's wakeOwnerChannelDiscovery for why
// a failed wake is non-fatal here (D1 already has the change; the next real event picks it up).
async function wakeOwnerChannelDiscovery(userId: string) {
  try {
    const stub = env.OWNER_CHANNEL.get(env.OWNER_CHANNEL.idFromName(userId));
    const url = new URL('https://owner-channel/discovery-wake');
    url.searchParams.set('userId', userId);
    await stub.fetch(new Request(url, { method: 'POST' }));
  } catch (error) {
    console.error('Discovery wake failed', error instanceof Error ? error.name : 'unknown');
  }
}

export async function POST(request:Request):Promise<Response>{
  const user=await getCurrentUser();
  if(!user)return json({error:'Потрібна авторизація.'},401);
  if(!sameOrigin(request))return json({error:'Недійсне джерело запиту.'},403);
  const body=await readJsonObject(request,256*1024);
  if(body instanceof Response)return body;
  const now=Math.floor(Date.now()/1000);
  try{
    if(body.action==='telegram'){
      return json(await previewTelegramDiscoveryText(env.DB,user.id,{
        text:body.text,sourceUrl:body.sourceUrl,sourceTitle:body.sourceTitle,query:body.query,
        seedLabel:body.seedLabel,context:body.context,knownLinks:body.knownLinks,minMembers:body.minMembers,
      },now));
    }
    // Search and qualification never write D1; only "Підтвердити" (confirm) and "Архівувати всі" do.
    if(body.action==='archive-outcomes'){
      return json(await archiveLocalDiscoveryOutcomes(env.DB,user.id,{items:body.items},now));
    }
    if(body.action==='telegram-groups'){
      return json(await readDiscoveryTelegramGroupSources(env.DB,user.id));
    }
    if(body.action==='confirm'){
      const confirmed = await confirmLocalDiscoveryPreview(env.DB,user.id,{
        platform:body.platform,link:body.link,name:body.name,sources:body.sources,minMembers:body.minMembers,runId:body.runId,preflight:body.preflight,
      },now);
      await wakeOwnerChannelDiscovery(user.id);
      return json(confirmed);
    }
    throw new DiscoveryError('Невідома preview-дія.');
  }catch(error){
    if(error instanceof DiscoveryError)return json({error:error.message},error.status);
    console.error('Local discovery preview failed',error instanceof Error?error.name:'unknown');
    return json({error:'Локальний preview пошуку не завершено. Спробуйте ще раз.'},500);
  }
}
