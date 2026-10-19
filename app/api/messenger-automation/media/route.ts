import { env } from 'cloudflare:workers';
import { getCurrentUser } from '@/lib/auth';
import { readBoundedMultipartForm } from '@/lib/http-form';
import { sameOrigin } from '@/lib/http-json';
import {
  MAX_WHATSAPP_AUTOPOST_IMAGE_BYTES,
  deleteWhatsAppAutopostImage,
  readWhatsAppAutopostImage,
  saveWhatsAppAutopostImage,
} from '@/lib/whatsapp-autopost-media';

const MAX_MULTIPART_BYTES=MAX_WHATSAPP_AUTOPOST_IMAGE_BYTES+512*1024;

// Мініатюра фото автопосту в картці: байти з налаштувань; браузер кешує за параметром `v` (початок sha256), тож повторних читань D1 немає.
export async function GET():Promise<Response>{
  const user=await getCurrentUser();
  if(!user)return Response.json({error:'Потрібна авторизація.'},{status:401});
  const image=await readWhatsAppAutopostImage(env.DB,user.id,true);
  if(!image)return new Response(null,{status:404});
  const binary=atob(image.base64);
  const bytes=new Uint8Array(binary.length);
  for(let index=0;index<binary.length;index+=1)bytes[index]=binary.charCodeAt(index);
  return new Response(bytes,{headers:{'Content-Type':image.contentType,'Cache-Control':'private, max-age=86400','X-Content-Type-Options':'nosniff'}});
}

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
