import { BulkChatError, parseBulkText } from './bulk-input.ts';
import { addBulkChats, previewBulkChats } from './bulk.ts';

function json(value: unknown,status=200) { return Response.json(value,{status,headers:{'Cache-Control':'no-store'}}); }

async function readBody(request: Request): Promise<Record<string,unknown>> {
  if(request.headers.get('origin')!==new URL(request.url).origin) throw new BulkChatError('Недійсне джерело запиту.',403);
  if(request.headers.get('content-type')?.split(';')[0].trim().toLowerCase()!=='application/json') throw new BulkChatError('Потрібен JSON.',415);
  const reader=request.body?.getReader();
  if(!reader) throw new BulkChatError('Порожній запит.');
  const chunks: Uint8Array[]=[];let length=0;
  for(;;) {
    const {done,value}=await reader.read(); if(done) break;
    length+=value.byteLength;
    if(length>256_000) { await reader.cancel(); throw new BulkChatError('Запит завеликий. Розділіть список.',413); }
    chunks.push(value);
  }
  const bytes=new Uint8Array(length);let offset=0;
  for(const chunk of chunks) { bytes.set(chunk,offset);offset+=chunk.byteLength; }
  let body: unknown;
  try { body=JSON.parse(new TextDecoder().decode(bytes)); } catch { throw new BulkChatError('Некоректний JSON.'); }
  if(!body||typeof body!=='object'||Array.isArray(body)) throw new BulkChatError('Некоректний запит.');
  return body as Record<string,unknown>;
}

export async function handleBulkChats(db: D1Database,userId: string,request: Request,now: number) {
  try {
    const body=await readBody(request);
    if(body.action==='preview') return json(await previewBulkChats(db,userId,typeof body.text==='string'?parseBulkText(body.text):body.items));
    if(body.action==='add') return json(await addBulkChats(db,userId,{items:body.items,revision:body.revision,requestId:body.requestId},now));
    throw new BulkChatError('Невідома дія.');
  } catch(error) {
    if(error instanceof BulkChatError) return json({error:error.message},error.status);
    console.error('Bulk chat request failed',error instanceof Error?error.name:'unknown');
    return json({error:'Не вдалося підтвердити додавання. Спробуйте ще раз із цим самим списком.'},500);
  }
}
