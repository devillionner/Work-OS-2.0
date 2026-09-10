import { businessDate } from '../business-time.ts';
import { BulkChatError, normalizeGroupLink, suggestedChatName, validateBulkItems, type BulkInput, type ChatPlatform } from './bulk-input.ts';

export type BulkPreviewItem = BulkInput & {
  index: number; platform: ChatPlatform | null; status: 'new' | 'existing' | 'archived' | 'duplicate' | 'invalid';
  existingName?: string;
};
export type BulkPreview = { revision: number; items: BulkPreviewItem[] };
export type BulkResult = { added: number; counts: Partial<Record<ChatPlatform,number>> };
type ExistingChat = { id: string; platform: string; name: string; link: string; normalized_link: string; workflow_status: string };
const SCAN_LIMIT=10_000;

export async function previewBulkChats(db: D1Database, userId: string, rawItems: unknown): Promise<BulkPreview> {
  const input=validateBulkItems(rawItems);
  const normalized=input.map(item=>normalizeGroupLink(item.link));
  const platforms=[...new Set(normalized.flatMap(chat=>chat?[chat.platform]:[]))];
  // One owner/platform-scoped scan handles legacy URLs with aliases, different
  // casing and tracking queries without rewriting existing rows. No per-link SQL.
  // Keep memory bounded until canonical keys can be backfilled in a reviewed migration.
  const [revisionResult,chatsResult]=await db.batch([
    db.prepare('SELECT COALESCE((SELECT revision FROM backup_revisions WHERE user_id=?1),0) AS revision').bind(userId),
    db.prepare(`SELECT id,platform,name,link,normalized_link,workflow_status FROM chats
      WHERE user_id=?1 AND platform IN (SELECT value FROM json_each(?2)) LIMIT ?3`)
      .bind(userId,JSON.stringify(platforms),SCAN_LIMIT+1),
  ]);
  const existing=chatsResult.results as ExistingChat[];
  if(existing.length>SCAN_LIMIT) throw new BulkChatError('У вибраних платформах понад 10 000 чатів. Потрібна перевірка бази перед масовим додаванням.',409);
  const known=new Map<string,ExistingChat>();
  for(const row of existing) for(const link of new Set([row.link,row.normalized_link])) {
    const parsed=normalizeGroupLink(link);
    if(!parsed||parsed.platform!==row.platform) continue;
    const previous=known.get(parsed.link);
    if(!previous||previous.workflow_status==='archived') known.set(parsed.link,row);
  }
  const seen=new Set<string>();
  const items=input.map((item,index):BulkPreviewItem=>{
    const parsed=normalized[index];
    if(!parsed) return {...item,index,platform:null,status:'invalid'};
    const result={index,link:parsed.link,name:item.name||suggestedChatName(parsed),platform:parsed.platform};
    if(seen.has(parsed.link)) return {...result,status:'duplicate'};
    seen.add(parsed.link);
    const match=known.get(parsed.link);
    return match?{...result,status:match.workflow_status==='archived'?'archived':'existing',existingName:match.name}:{...result,status:'new'};
  });
  return {revision:Number((revisionResult.results[0] as {revision:number}).revision),items};
}

async function payloadHash(items: BulkInput[]) {
  const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(items)));
  return Array.from(new Uint8Array(digest),byte=>byte.toString(16).padStart(2,'0')).join('');
}
async function receipt(db: D1Database, userId: string, requestId: string, hash: string): Promise<BulkResult|null> {
  const row=await db.prepare("SELECT metadata_json FROM activity_events WHERE user_id=?1 AND source_key=?2 AND event_type='chat_bulk_added'")
    .bind(userId,`chat-bulk:${requestId}`).first<{metadata_json:string}>();
  if(!row) return null;
  const saved=JSON.parse(row.metadata_json) as {hash:string;result:BulkResult};
  if(saved.hash!==hash) throw new BulkChatError('Цей запит уже використано для іншого списку. Перевірте список знову.',409);
  return saved.result;
}

export async function addBulkChats(db: D1Database, userId: string, input: {
  items: unknown; revision: unknown; requestId: unknown;
}, now: number): Promise<BulkResult> {
  if(typeof input.requestId!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.requestId)) throw new BulkChatError('Некоректний запит додавання.');
  if(!Number.isSafeInteger(input.revision)||Number(input.revision)<0) throw new BulkChatError('Спочатку перевірте список.');
  const items=validateBulkItems(input.items);
  const hash=await payloadHash(items);
  const previous=await receipt(db,userId,input.requestId,hash);
  if(previous) return previous;
  const plan=await previewBulkChats(db,userId,items);
  if(plan.revision!==input.revision) {
    const concurrent=await receipt(db,userId,input.requestId,hash);
    if(concurrent) return concurrent;
    throw new BulkChatError('База змінилася після перевірки. Перевірте список знову.',409);
  }
  if(plan.items.some(item=>item.status!=='new')) throw new BulkChatError('У списку є повтори або нерозпізнані посилання. Перевірте список знову.',409);
  const rows=plan.items.map(item=>({id:crypto.randomUUID(),platform:item.platform,link:item.link,name:item.name,private:Number(normalizeGroupLink(item.link)!.private)}));
  const result:BulkResult={added:rows.length,counts:{}};
  for(const row of rows) result.counts[row.platform!] = (result.counts[row.platform!]||0)+1;
  let results: D1Result[];
  try {
    results=await db.batch([
      // Materialize the revision before row triggers advance it. This is one
      // all-or-nothing insert, not a loop of 500 statements or partial chunks.
      db.prepare(`WITH guard AS MATERIALIZED (
        SELECT COALESCE((SELECT revision FROM backup_revisions WHERE user_id=?2),0) AS revision)
        INSERT INTO chats(id,user_id,platform,name,link,normalized_link,workflow_status,is_private,created_at,updated_at)
        SELECT json_extract(item.value,'$.id'),?2,json_extract(item.value,'$.platform'),json_extract(item.value,'$.name'),
          json_extract(item.value,'$.link'),json_extract(item.value,'$.link'),'to_join',json_extract(item.value,'$.private'),?3,?3
        FROM json_each(?1) item CROSS JOIN guard WHERE guard.revision=?4 RETURNING id`)
        .bind(JSON.stringify(rows),userId,now,plan.revision),
      db.prepare(`INSERT INTO activity_events(id,user_id,event_type,occurred_at,event_date,metadata_json,source_key)
        SELECT ?1,?2,'chat_bulk_added',?3,?4,?5,?6 WHERE changes()=?7`)
        .bind(crypto.randomUUID(),userId,now,businessDate(now),JSON.stringify({hash,result,chatIds:rows.map(row=>row.id)}),`chat-bulk:${input.requestId}`,rows.length),
    ]);
  } catch(error) {
    const concurrent=await receipt(db,userId,input.requestId,hash);
    if(concurrent) return concurrent;
    throw error;
  }
  if(results[0].results.length===rows.length) return result;
  const concurrent=await receipt(db,userId,input.requestId,hash);
  if(concurrent) return concurrent;
  throw new BulkChatError('База змінилася під час додавання. Перевірте список знову.',409);
}
