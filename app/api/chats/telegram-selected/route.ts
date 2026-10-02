import { env } from 'cloudflare:workers';
import { getCurrentUser } from '@/lib/auth';
import { readJsonObject, sameOrigin } from '@/lib/http-json';
import { addSelectedChatToJoin, parseSelectedExport, readSelectedChats, readSelectedChatsCount, saveSelectedChats, SELECTED_IMPORT_MAX_BYTES, SelectedChatsError } from '@/lib/chats/telegram-selected';

function json(value:unknown,status=200){
  return Response.json(value,{status,headers:{'Cache-Control':'no-store'}});
}

export async function GET(request:Request):Promise<Response>{
  try{
    const user=await getCurrentUser();
    if(!user)return json({error:'Потрібно увійти.'},401);
    if(new URL(request.url).searchParams.get('summary')==='1')return json(await readSelectedChatsCount(env.DB,user.id));
    return json(await readSelectedChats(env.DB,user.id));
  }catch(error){
    console.error('Telegram selected chats read failed',error instanceof Error?error.name:'unknown');
    return json({error:'Не вдалося завантажити відібрані чати.'},500);
  }
}

export async function POST(request:Request):Promise<Response>{
  try{
    const user=await getCurrentUser();
    if(!user)return json({error:'Потрібно увійти.'},401);
    if(!sameOrigin(request))return json({error:'Недійсний запит.'},403);
    const body=await readJsonObject(request,SELECTED_IMPORT_MAX_BYTES);
    if(body instanceof Response)return body;
    const now=Math.floor(Date.now()/1000);
    if(body.action==='add')return json(await addSelectedChatToJoin(env.DB,user.id,body.link,now));
    if(body.action!=='import')return json({error:'Невідома дія.'},400);
    return json(await saveSelectedChats(env.DB,user.id,parseSelectedExport(body.groups),now));
  }catch(error){
    if(error instanceof SelectedChatsError)return json({error:error.message},error.status);
    console.error('Telegram selected chats import failed',error instanceof Error?error.name:'unknown');
    return json({error:'Не вдалося імпортувати відібрані чати.'},500);
  }
}
