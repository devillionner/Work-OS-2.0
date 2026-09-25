const SETTING_KEY='whatsapp_autopost_image_v1';
export const MAX_WHATSAPP_AUTOPOST_IMAGE_BYTES=640*1024;
const ALLOWED_TYPES=new Set(['image/jpeg','image/png','image/webp']);

export type WhatsAppAutopostImage={
  fileName:string;contentType:string;sizeBytes:number;sha256:string;base64:string;updatedAt:number;
};
export type WhatsAppAutopostImageMeta=Omit<WhatsAppAutopostImage,'base64'>;

export async function readWhatsAppAutopostImage(db:D1Database,userId:string,includeBase64=false):Promise<WhatsAppAutopostImage|null>{
  const row=await db.prepare(`SELECT value_json,updated_at FROM user_settings WHERE user_id=?1 AND setting_key=?2 LIMIT 1`)
    .bind(userId,SETTING_KEY).first<{value_json:string;updated_at:number}>();
  if(!row)return null;
  let parsed:unknown;
  try{parsed=JSON.parse(row.value_json);}catch{return null;}
  if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))return null;
  const value=parsed as Record<string,unknown>;
  const fileName=typeof value.fileName==='string'?value.fileName.trim().slice(0,180):'';
  const contentType=typeof value.contentType==='string'?value.contentType.toLowerCase():'';
  const sizeBytes=Number(value.sizeBytes);
  const sha256=typeof value.sha256==='string'?value.sha256.toLowerCase():'';
  const base64=typeof value.base64==='string'?value.base64:'';
  if(!fileName||!ALLOWED_TYPES.has(contentType)||!Number.isSafeInteger(sizeBytes)||sizeBytes<1||sizeBytes>MAX_WHATSAPP_AUTOPOST_IMAGE_BYTES||!/^[a-f0-9]{64}$/u.test(sha256)||!base64)return null;
  return {fileName,contentType,sizeBytes,sha256,base64:includeBase64?base64:'',updatedAt:Number(row.updated_at)||0};
}

export function publicWhatsAppAutopostImage(image:WhatsAppAutopostImage):WhatsAppAutopostImageMeta{
  return {fileName:image.fileName,contentType:image.contentType,sizeBytes:image.sizeBytes,sha256:image.sha256,updatedAt:image.updatedAt};
}

export async function saveWhatsAppAutopostImage(db:D1Database,userId:string,input:{fileName:string;contentType:string;bytes:Uint8Array},now:number):Promise<WhatsAppAutopostImageMeta>{
  const contentType=String(input.contentType||'').toLowerCase();
  if(!ALLOWED_TYPES.has(contentType))throw new Error('Підтримуються JPG, PNG або WebP.');
  if(!input.bytes.byteLength||input.bytes.byteLength>MAX_WHATSAPP_AUTOPOST_IMAGE_BYTES)throw new Error('Фото автопоста має бути не більше 640 КБ після стискання.');
  const fileName=cleanFileName(input.fileName,contentType);
  const sha256=await sha256Hex(input.bytes);
  const stored={version:1,fileName,contentType,sizeBytes:input.bytes.byteLength,sha256,base64:bytesToBase64(input.bytes)};
  await db.prepare(`INSERT INTO user_settings(user_id,setting_key,value_json,source_import_id,updated_at)
    VALUES (?1,?2,?3,NULL,?4)
    ON CONFLICT(user_id,setting_key) DO UPDATE SET value_json=excluded.value_json,source_import_id=NULL,updated_at=excluded.updated_at`)
    .bind(userId,SETTING_KEY,JSON.stringify(stored),now).run();
  return {fileName,contentType,sizeBytes:input.bytes.byteLength,sha256,updatedAt:now};
}

export async function deleteWhatsAppAutopostImage(db:D1Database,userId:string){
  await db.prepare(`DELETE FROM user_settings WHERE user_id=?1 AND setting_key=?2`).bind(userId,SETTING_KEY).run();
}

function cleanFileName(value:string,contentType:string){
  const fallback=contentType==='image/png'?'work-os-autopost.png':contentType==='image/webp'?'work-os-autopost.webp':'work-os-autopost.jpg';
  const clean=Array.from(String(value||'').replace(/[\\/\p{Cc}]/gu,' ').trim().normalize('NFC')).slice(0,180).join('');
  return clean||fallback;
}
async function sha256Hex(bytes:Uint8Array){
  const digest=await crypto.subtle.digest('SHA-256',bytes.slice().buffer);
  return [...new Uint8Array(digest)].map(value=>value.toString(16).padStart(2,'0')).join('');
}
function bytesToBase64(bytes:Uint8Array){
  let binary='';
  const chunk=0x6000;
  for(let offset=0;offset<bytes.length;offset+=chunk)binary+=String.fromCharCode(...bytes.subarray(offset,Math.min(bytes.length,offset+chunk)));
  return btoa(binary);
}
