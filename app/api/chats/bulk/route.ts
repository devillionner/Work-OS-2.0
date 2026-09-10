import { env } from 'cloudflare:workers';
import { getCurrentUser } from '@/lib/auth';
import { handleBulkChats } from '@/lib/chats/bulk-http';

export async function POST(request: Request): Promise<Response> {
  const user=await getCurrentUser();
  if(!user) return Response.json({error:'Потрібно увійти.'},{status:401});
  return handleBulkChats(env.DB,user.id,request,Math.floor(Date.now()/1000));
}
