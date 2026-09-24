export const BULK_MAX_ITEMS = 500;
export const BULK_MAX_TEXT = 100_000;
export const BULK_IMPORT_MAX_ITEMS = 10_000;
export const BULK_IMPORT_MAX_TEXT = 2_000_000;
export type ChatPlatform = 'telegram' | 'whatsapp' | 'viber' | 'facebook';
export const CHAT_PLATFORM_NAMES: Record<ChatPlatform,string> = {telegram:'Telegram',whatsapp:'WhatsApp',viber:'Viber',facebook:'Facebook'};
export type BulkInput = { link: string; name: string };
export type ChatLink = { platform: ChatPlatform; link: string; private: boolean };

export class BulkChatError extends Error {
  status: number;
  constructor(message: string, status = 400) { super(message); this.name='BulkChatError'; this.status=status; }
}

export function cleanChatName(value: string) {
  const named: Record<string,string> = {amp:'&',quot:'"',apos:"'",lt:'<',gt:'>',nbsp:' '};
  let name=value;
  for(let pass=0;pass<4;pass++) name=name.replace(/&(#x[0-9a-f]+|#\d+|amp|quot|apos|lt|gt|nbsp);/gi,(_,entity:string)=>{
    if(!entity.startsWith('#')) return named[entity.toLowerCase()];
    const code=entity[1].toLowerCase()==='x'?parseInt(entity.slice(2),16):Number(entity.slice(1));
    return code>0&&code<=0x10ffff&&!(code>=0xd800&&code<=0xdfff)?String.fromCodePoint(code):'';
  });
  return Array.from(name.replace(/\p{Cc}/gu,' ').replace(/\s+/g,' ').trim().normalize('NFC')).slice(0,180).join('');
}

export function normalizeGroupLink(raw: string): ChatLink | null {
  let value=raw.trim().replace(/^[<([]+/,'').replace(/[>),.;!\]]+$/,'');
  if(!value||value.length>2048||/%(?![a-f0-9]{2})/i.test(value)) return null;
  if(!/^[a-z][a-z\d+.-]*:/i.test(value)) value=`https://${value}`;
  let url: URL;
  try { url=new URL(value); } catch { return null; }
  if(!['https:','http:'].includes(url.protocol)||url.username||url.password||url.port) return null;
  const host=url.hostname.toLowerCase().replace(/^www\./,'');
  let path: string;
  try { path=decodeURIComponent(url.pathname).replace(/\/+$/,''); } catch { return null; }
  if(/[\p{Cc}\s]/u.test(path)) return null;
  if(['t.me','telegram.me','telegram.dog'].includes(host)) {
    const invite=/^\/(?:\+|joinchat\/)([A-Za-z0-9_-]+)$/.exec(path);
    if(invite) return {platform:'telegram',link:`https://t.me/+${invite[1]}`,private:true};
    const publicName=/^\/([A-Za-z][A-Za-z0-9_]{3,31})$/.exec(path);
    if(!publicName||['share','proxy','socks','login','addstickers','addemoji','setlanguage','confirmphone','joinchat'].includes(publicName[1].toLowerCase())) return null;
    return {platform:'telegram',link:`https://t.me/${publicName[1].toLowerCase()}`,private:false};
  }
  if(host==='chat.whatsapp.com'&&/^\/[A-Za-z0-9_-]+$/.test(path)) return {platform:'whatsapp',link:`https://chat.whatsapp.com${path}`,private:true};
  if(host==='invite.viber.com') {
    const key=url.searchParams.has('g2')?'g2':'g';
    const invite=url.searchParams.get(key);
    if(!invite||!/^[/+A-Za-z0-9=_-]+$/.test(invite)) return null;
    return {platform:'viber',link:`https://invite.viber.com/?${key}=${encodeURIComponent(invite)}`,private:true};
  }
  if(['chats.viber.com','vb.me'].includes(host)&&/^\/[^/?#\s]+$/.test(path)) return {platform:'viber',link:`https://${host}${url.pathname.replace(/\/+$/,'')}`,private:false};
  if(['facebook.com','m.facebook.com','mobile.facebook.com','fb.com'].includes(host)) {
    const group=/^\/groups\/([A-Za-z0-9._-]+)(?:\/.*)?$/i.exec(path);
    if(group) return {platform:'facebook',link:`https://www.facebook.com/groups/${group[1].toLowerCase()}`,private:false};
    const vanity=/^\/([A-Za-z0-9._-]+)$/.exec(path);
    const reserved=new Set(['profile.php','login','share','watch','reel','photo','events','marketplace','help','settings','groups','pages']);
    if(vanity&&!reserved.has(vanity[1].toLowerCase())) return {platform:'facebook',link:`https://www.facebook.com/${vanity[1].toLowerCase()}`,private:false};
  }
  return null;
}

export function suggestedChatName(chat: ChatLink): string {
  const url=new URL(chat.link);
  const token=decodeURIComponent(url.pathname.split('/').filter(Boolean).pop() || url.searchParams.get('g2') || url.searchParams.get('g') || 'запрошення');
  return `${CHAT_PLATFORM_NAMES[chat.platform]} · ${token.slice(0,30)}${token.length>30?'…':''}`;
}

export function parseBulkText(text: string): BulkInput[] {
  return parseBulkTextWithin(text,BULK_MAX_TEXT,BULK_MAX_ITEMS,`За раз можна додати до ${BULK_MAX_ITEMS} посилань. Розділіть список.`);
}

export function parseBulkImportText(text: string): BulkInput[] {
  return parseBulkTextWithin(text,BULK_IMPORT_MAX_TEXT,BULK_IMPORT_MAX_ITEMS,'За один імпорт можна обробити до 10 000 посилань.');
}

function parseBulkTextWithin(text:string,maxText:number,maxItems:number,itemError:string):BulkInput[] {
  if(text.length>maxText) throw new BulkChatError('Список завеликий. Скоротіть його або імпортуйте окремими списками.');
  const rows: BulkInput[]=[];
  for(const line of text.replace(/[,;](?=(?:https?:\/\/|www\.))/gi,' ').split(/\r?\n/).map(s=>s.trim()).filter(Boolean)) {
    const matches=[...line.matchAll(/(?:[a-z][a-z\d+.-]*:\/\/|www\.|(?:t\.me|telegram\.me|telegram\.dog|chat\.whatsapp\.com|invite\.viber\.com|chats\.viber\.com|vb\.me|(?:m\.|mobile\.)?facebook\.com|fb\.com)\/)[^\s<>"']+/gi)];
    const name=matches.length===1?cleanChatName(line.replace(matches[0][0],' ').replace(/^\s*(?:\d+[.)]|[-–—•])\s*/,'')).replace(/^[\s|:;,[\]()]+|[\s|:;,[\]()]+$/g,''):'';
    if(matches.length) for(const match of matches) rows.push({link:match[0],name});
    else rows.push({link:line.slice(0,2048),name:''});
    if(rows.length>maxItems) throw new BulkChatError(itemError);
  }
  if(!rows.length) throw new BulkChatError('Вставте посилання на чати.');
  return rows;
}

export function validateBulkItems(value: unknown): BulkInput[] {
  if(!Array.isArray(value)||!value.length||value.length>BULK_MAX_ITEMS) throw new BulkChatError(`Вкажіть від 1 до ${BULK_MAX_ITEMS} посилань.`);
  return value.map(item=>{
    if(!item||typeof item!=='object'||typeof item.link!=='string'||item.link.length>2048||typeof item.name!=='string'||item.name.length>1000) throw new BulkChatError('Некоректний запис у списку чатів.');
    return {link:item.link.trim(),name:cleanChatName(item.name)};
  });
}
