const SETTING_KEY='whatsapp_autopost_caption_v1';
export const MAX_WHATSAPP_AUTOPOST_CAPTION_CHARS=4000;

export type WhatsAppAutopostCaption={text:string;updatedAt:number};

export function cleanWhatsAppAutopostCaption(value:unknown){
  if(value===undefined||value===null)return '';
  if(typeof value!=='string')throw new Error('Текст автопоста має бути текстом.');
  const text=value.replace(/\r\n?/gu,'\n').split('\n')
    .map(line=>line.replace(/[\t ]+/gu,' ').trimEnd()).join('\n').trim().normalize('NFC');
  if(Array.from(text).length>MAX_WHATSAPP_AUTOPOST_CAPTION_CHARS)
    throw new Error(`Текст автопоста має бути не довший за ${MAX_WHATSAPP_AUTOPOST_CAPTION_CHARS} символів.`);
  return text;
}

export async function readWhatsAppAutopostCaption(db:D1Database,userId:string):Promise<WhatsAppAutopostCaption|null>{
  const row=await db.prepare(`SELECT value_json,updated_at FROM user_settings WHERE user_id=?1 AND setting_key=?2 LIMIT 1`)
    .bind(userId,SETTING_KEY).first<{value_json:string;updated_at:number}>();
  if(!row)return null;
  try{
    const parsed=JSON.parse(row.value_json) as {text?:unknown};
    const text=cleanWhatsAppAutopostCaption(parsed?.text);
    return text?{text,updatedAt:Number(row.updated_at)||0}:null;
  }catch{return null;}
}

export async function saveWhatsAppAutopostCaption(db:D1Database,userId:string,value:unknown,now:number):Promise<WhatsAppAutopostCaption|null>{
  const text=cleanWhatsAppAutopostCaption(value);
  if(!text){await deleteWhatsAppAutopostCaption(db,userId);return null;}
  await db.prepare(`INSERT INTO user_settings(user_id,setting_key,value_json,source_import_id,updated_at)
    VALUES (?1,?2,?3,NULL,?4)
    ON CONFLICT(user_id,setting_key) DO UPDATE SET value_json=excluded.value_json,source_import_id=NULL,updated_at=excluded.updated_at`)
    .bind(userId,SETTING_KEY,JSON.stringify({version:1,text}),now).run();
  return {text,updatedAt:now};
}

export async function deleteWhatsAppAutopostCaption(db:D1Database,userId:string){
  await db.prepare(`DELETE FROM user_settings WHERE user_id=?1 AND setting_key=?2`).bind(userId,SETTING_KEY).run();
}
