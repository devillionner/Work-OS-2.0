import { env } from 'cloudflare:workers';
import { getCurrentUser } from '@/lib/auth';
import { readBoundedMultipartForm } from '@/lib/http-form';
import { sameOrigin } from '@/lib/http-json';
import {
  MAX_WHATSAPP_AUTOPOST_IMAGE_BYTES,
  deleteWhatsAppAutopostImage,
  saveWhatsAppAutopostImage,
} from '@/lib/whatsapp-autopost-media';

const MAX_MULTIPART_BYTES=MAX_WHATSAPP_AUTOPOST_IMAGE_BYTES+512*1024;

export async function POST(request:Request):Promise<Response>{
  const user=await getCurrentUser();
  if(!user)return Response.json({error:'Потрібна авторизація.'},{status:401});
  if(!sameOrigin(request))return Response.json({error:'Недійсне джерело запиту.'},{status:403});
  try{
    const form=await readBoundedMultipartForm(request,MAX_MULTIPART_BYTES);
    if(form instanceof Response)return form;
    const file=form.get('file');
    if(!(file instanceof File))return Response.json({error:'Оберіть фото.'},{status:400});
    const image=await saveWhatsAppAutopostImage(env.DB,user.id,{
      fileName:file.name,contentType:file.type||'application/octet-stream',
      bytes:new Uint8Array(await file.arrayBuffer()),
    },Math.floor(Date.now()/1000));
    return Response.json({image},{headers:{'Cache-Control':'no-store'}});
  }catch(error){
    return Response.json({error:error instanceof Error?error.message:'Не вдалося зберегти фото автопоста.'},{status:400});
  }
}

export async function DELETE(request:Request):Promise<Response>{
  const user=await getCurrentUser();
  if(!user)return Response.json({error:'Потрібна авторизація.'},{status:401});
  if(!sameOrigin(request))return Response.json({error:'Недійсне джерело запиту.'},{status:403});
  await deleteWhatsAppAutopostImage(env.DB,user.id);
  return Response.json({ok:true},{headers:{'Cache-Control':'no-store'}});
}
