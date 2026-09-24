import { env, waitUntil } from 'cloudflare:workers';
import { getCurrentUser } from '@/lib/auth';
import { handleBulkChats } from '@/lib/chats/bulk-http';
import { enrichImportedChatNames } from '@/lib/chats/name-enrichment';

export async function POST(request: Request): Promise<Response> {
  const user=await getCurrentUser();
  if(!user) return Response.json({error:'Потрібно увійти.'},{status:401});
  const now=Math.floor(Date.now()/1000);
  const background=request.clone();
  const response=await handleBulkChats(env.DB,user.id,request,now);
  if(response.ok) {
    try {
      const body=await background.json() as {action?:unknown;items?:unknown};
      if(body.action==='add'&&Array.isArray(body.items)) {
        const links=body.items.flatMap((item)=>item&&typeof item==='object'&&'link' in item&&typeof item.link==='string'?[item.link]:[]);
        if(links.length) waitUntil(enrichImportedChatNames(env.DB,user.id,links,now).catch((error)=>{
          console.error('Background chat-name enrichment failed',error instanceof Error?error.name:'unknown');
          return {checked:0,updated:0,confirm:0,error:0,truncated:false};
        }));
      }
    } catch {
      // Successful bulk response is authoritative; name enrichment is best-effort only.
    }
  }
  return response;
}
