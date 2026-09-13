import { cleanChatName, type ChatPlatform } from './bulk-input.ts';
import { chatStateTokenSql } from './state.ts';

export type DuplicateChat = {
  id:string; name:string; link:string; normalizedLink:string; status:string;
  archiveReason:string|null; telegramAccountId:string|null; stateToken:string;
};
export type ChatDuplicateGroup = {
  kind:'link'|'name'; key:string; chats:DuplicateChat[];
};

type Row = {
  id:string; name:string; link:string; normalized_link:string; workflow_status:string;
  archive_reason:string|null; telegram_account_id:string|null; state_token:string;
};

const MAX_SCAN = 10_000;

export function duplicateNameKey(value:string) {
  return cleanChatName(value).toLocaleLowerCase('uk-UA');
}

export async function readChatDuplicateGroups(
  db:D1Database,
  input:{userId:string;platform:ChatPlatform;accountId?:string|null},
):Promise<ChatDuplicateGroup[]> {
  const telegramFilter=input.platform==='telegram' ? ` AND c.telegram_account_id=?3` : '';
  const result=await db.prepare(`SELECT c.id,c.name,c.link,c.normalized_link,c.workflow_status,c.archive_reason,
      c.telegram_account_id,${chatStateTokenSql()} AS state_token
    FROM chats c WHERE c.user_id=?1 AND c.platform=?2${telegramFilter}
    ORDER BY c.workflow_status='archived',c.name,c.id LIMIT ${MAX_SCAN+1}`)
    .bind(input.userId,input.platform,...(input.platform==='telegram'?[input.accountId||'']:[])).all<Row>();
  if(result.results.length>MAX_SCAN) throw new Error('Для менеджера дублікатів забагато чатів. Спочатку звузьте робочий набір.');

  const chats:DuplicateChat[]=result.results.map(row=>({
    id:row.id,name:row.name,link:row.link,normalizedLink:row.normalized_link,status:row.workflow_status,
    archiveReason:row.archive_reason,telegramAccountId:row.telegram_account_id,stateToken:row.state_token,
  }));
  const byLink=new Map<string,DuplicateChat[]>();
  const byName=new Map<string,DuplicateChat[]>();
  for(const chat of chats) {
    if(chat.normalizedLink) push(byLink,chat.normalizedLink,chat);
    const nameKey=duplicateNameKey(chat.name);
    if(nameKey) push(byName,nameKey,chat);
  }
  const exactLinks=[...byLink.entries()]
    .filter(([,items])=>items.length>1)
    .map(([key,items])=>({kind:'link' as const,key,chats:items}));
  const sameNames=[...byName.entries()]
    .filter(([,items])=>items.length>1&&new Set(items.map(item=>item.normalizedLink)).size>1)
    .map(([key,items])=>({kind:'name' as const,key,chats:items}));
  return [...exactLinks,...sameNames].sort((a,b)=>a.kind.localeCompare(b.kind)||a.key.localeCompare(b.key,'uk'));
}

function push(map:Map<string,DuplicateChat[]>,key:string,chat:DuplicateChat) {
  const current=map.get(key);
  if(current) current.push(chat); else map.set(key,[chat]);
}
