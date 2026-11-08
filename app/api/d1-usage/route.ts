import { env } from 'cloudflare:workers';
import { getCurrentUser } from '@/lib/auth';
import { D1_METER_NAME } from '@/lib/d1-meter-state';
import { mergeUsage, usageDay, usageStatus, type DoUsage } from '@/lib/do-usage-state';

/**
 * Денні підсумки службових лічильників: прочитані рядки D1 (рахує воркер, підсумок у Durable Object) і звернення до самих Durable Objects
 * («Диспетчер»: канал власника + лічильник бази). У D1 нічого не читає й не пише; кожне читання — три запити до Durable Objects.
 */
export async function GET():Promise<Response>{
  const user=await getCurrentUser();
  if(!user)return Response.json({error:'Потрібно увійти.'},{status:401});
  try{
    const meterStub=env.OWNER_CHANNEL.get(env.OWNER_CHANNEL.idFromName(D1_METER_NAME));
    const ownerStub=env.OWNER_CHANNEL.get(env.OWNER_CHANNEL.idFromName(user.id));
    const [meter,meterUsage,ownerUsage]=await Promise.all([
      meterStub.fetch('https://d1-meter/meter/read'),
      meterStub.fetch('https://d1-meter/usage/read'),
      ownerStub.fetch('https://owner-channel/usage/read'),
    ]);
    if(!meter.ok)throw new Error(`meter ${meter.status}`);
    const rows=await meter.json() as Record<string,unknown>;
    const usages=await Promise.all([meterUsage,ownerUsage].map(async(response)=>response.ok?await response.json() as DoUsage:null));
    const dispatcher=usageStatus(mergeUsage(usages,usageDay(Date.now())));
    return Response.json({...rows,dispatcher},{headers:{'Cache-Control':'no-store'}});
  }catch(reason){
    console.error('d1 usage read failed',reason);
    return Response.json({error:'Не вдалося прочитати лічильник бази.'},{status:502});
  }
}
