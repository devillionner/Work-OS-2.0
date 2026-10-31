import { env } from 'cloudflare:workers';
import { getCurrentUser } from '@/lib/auth';
import { D1_METER_NAME } from '@/lib/d1-meter-state';

/** Денний підсумок прочитаних рядків D1 (рахує воркер, лічильник у Durable Object; у D1 нічого не читає й не пише). */
export async function GET():Promise<Response>{
  const user=await getCurrentUser();
  if(!user)return Response.json({error:'Потрібно увійти.'},{status:401});
  try{
    const stub=env.OWNER_CHANNEL.get(env.OWNER_CHANNEL.idFromName(D1_METER_NAME));
    const response=await stub.fetch('https://d1-meter/meter/read');
    if(!response.ok)throw new Error(`meter ${response.status}`);
    return Response.json(await response.json(),{headers:{'Cache-Control':'no-store'}});
  }catch(reason){
    console.error('d1 usage read failed',reason);
    return Response.json({error:'Не вдалося прочитати лічильник бази.'},{status:502});
  }
}
