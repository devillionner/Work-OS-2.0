import { env } from 'cloudflare:workers';
import { getCurrentUser } from '@/lib/auth';
import { readJsonObject, sameOrigin } from '@/lib/http-json';
import { addPushSubscription, cleanSubscription, pushToOwner, readPushSubscriptions, removePushSubscription } from '@/lib/push-store';
import { VAPID_PUBLIC_KEY } from '@/lib/web-push';

const REQUEST_MAX_BYTES = 8 * 1024;
type PushEnv = { VAPID_PRIVATE_KEY?: string };
const privateKey = () => (env as unknown as PushEnv).VAPID_PRIVATE_KEY || '';

// Сповіщення на телефон: публічний ключ і чи підключений пристрій (GET), підписка / відписка / тест (POST).
export async function GET():Promise<Response>{
  const user=await getCurrentUser();
  if(!user)return Response.json({error:'Потрібно увійти.'},{status:401});
  const subscriptions=await readPushSubscriptions(env.DB,user.id);
  return Response.json({publicKey:VAPID_PUBLIC_KEY,configured:Boolean(privateKey()),devices:subscriptions.length,endpoints:subscriptions.map(item=>item.endpoint)},{headers:{'Cache-Control':'no-store'}});
}

export async function POST(request:Request):Promise<Response>{
  const user=await getCurrentUser();
  if(!user)return Response.json({error:'Потрібно увійти.'},{status:401});
  if(!sameOrigin(request))return Response.json({error:'Недійсний запит.'},{status:403});
  const parsed=await readJsonObject(request,REQUEST_MAX_BYTES);
  if(parsed instanceof Response)return parsed;
  const now=Math.floor(Date.now()/1000);
  const action=typeof parsed.action==='string'?parsed.action:'';
  if(action==='subscribe'){
    const subscription=cleanSubscription(parsed.subscription,now);
    if(!subscription)return Response.json({error:'Браузер надіслав некоректну підписку.'},{status:400});
    return Response.json({ok:true,devices:await addPushSubscription(env.DB,user.id,subscription,now)});
  }
  if(action==='unsubscribe'){
    const endpoint=typeof parsed.endpoint==='string'?parsed.endpoint:'';
    return Response.json({ok:true,devices:await removePushSubscription(env.DB,user.id,endpoint,now)});
  }
  if(action==='test'){
    if(!privateKey())return Response.json({error:'Сповіщення на сервері ще не налаштовано.'},{status:409});
    const delivered=await pushToOwner(env.DB,privateKey(),user.id,{title:'Work OS',body:'Сповіщення працюють.',url:'/',tag:'test'},now);
    return Response.json({ok:delivered>0,delivered},{status:delivered>0?200:409});
  }
  return Response.json({error:'Невідома дія.'},{status:400});
}
