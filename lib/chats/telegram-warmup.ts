import { businessDate } from '../business-time.ts';

export type TelegramWarmupSnapshot = {
  accountId:string;
  createdAt:number;
  joinedCount:number;
  publicationCount:number;
  ready:boolean;
  readyAt:number|null;
  steps:Array<{id:'created'|'joined'|'published'|'ready';label:string;instruction:string;done:boolean}>;
};

type AccountRow={id:string;created_at:number};
type CountRow={joined_count:number;publication_count:number};
type StateRow={action:string;occurred_at:number}|null;

export async function readTelegramWarmup(db:D1Database,userId:string,accountId:string):Promise<TelegramWarmupSnapshot> {
  const account=await db.prepare(`SELECT id,created_at FROM telegram_accounts WHERE id=?1 AND user_id=?2 LIMIT 1`)
    .bind(accountId,userId).first<AccountRow>();
  if(!account) throw new Error('Telegram-акаунт не знайдено.');
  const counts=await db.prepare(`SELECT
      SUM(CASE WHEN event_type='chat_joined' AND cancelled_at IS NULL THEN 1 ELSE 0 END) AS joined_count,
      SUM(CASE WHEN event_type='publication' AND cancelled_at IS NULL THEN 1 ELSE 0 END) AS publication_count
    FROM activity_events WHERE user_id=?1 AND telegram_account_id=?2`)
    .bind(userId,accountId).first<CountRow>();
  const state=await db.prepare(`SELECT json_extract(metadata_json,'$.action') AS action,occurred_at
    FROM activity_events WHERE user_id=?1 AND telegram_account_id=?2 AND event_type='telegram_warmup_state'
    ORDER BY rowid DESC LIMIT 1`).bind(userId,accountId).first<{action:string;occurred_at:number}>() as StateRow;
  const joinedCount=Number(counts?.joined_count||0);
  const publicationCount=Number(counts?.publication_count||0);
  const ready=state?.action==='complete';
  const readyAt=ready?Number(state?.occurred_at||0):null;
  return {
    accountId,
    createdAt:Number(account.created_at),
    joinedCount,
    publicationCount,
    ready,
    readyAt,
    steps:[
      {id:'created',label:'Акаунт додано',instruction:'Перевір назву акаунта та працюй саме з його окремою чергою.',done:true},
      {id:'joined',label:'Перше приєднання',instruction:'Приєднай перші робочі чати вручну; використовуй наявні перерви між серіями.',done:joinedCount>0},
      {id:'published',label:'Перша публікація',instruction:'Зроби першу ручну публікацію та переконайся, що вона з’явилась у звіті й історії.',done:publicationCount>0},
      {id:'ready',label:'Готовий до звичайного темпу',instruction:'Після власної перевірки відміть акаунт готовим. Це не запускає автопостинг і не змінює ліміти.',done:ready},
    ],
  };
}

export async function changeTelegramWarmupReady(db:D1Database,input:{userId:string;accountId:string;ready:boolean;now:number}) {
  const account=await db.prepare(`SELECT id FROM telegram_accounts WHERE id=?1 AND user_id=?2 LIMIT 1`).bind(input.accountId,input.userId).first();
  if(!account) throw new Error('Telegram-акаунт не знайдено.');
  const current=await readTelegramWarmup(db,input.userId,input.accountId);
  if(current.ready===input.ready) return current;
  if(input.ready && (current.joinedCount<1 || current.publicationCount<1)) {
    throw new Error('Спочатку виконайте перше приєднання та першу публікацію.');
  }
  const id=crypto.randomUUID();
  const action=input.ready?'complete':'reopen';
  await db.prepare(`INSERT INTO activity_events
    (id,user_id,event_type,platform,occurred_at,event_date,metadata_json,source_key,telegram_account_id)
    VALUES (?1,?2,'telegram_warmup_state','telegram',?3,?4,json_object('action',?5),?6,?7)`)
    .bind(id,input.userId,input.now,businessDate(input.now),action,`telegram-warmup:${id}`,input.accountId).run();
  return readTelegramWarmup(db,input.userId,input.accountId);
}
