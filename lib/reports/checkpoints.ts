import { lessonEpoch } from '../leads/domain/time.ts';

export const REPORT_CHECKPOINT_SLOTS = ['13:00','16:00','19:00'] as const;
export type ReportCheckpointSlot = (typeof REPORT_CHECKPOINT_SLOTS)[number];
export type ReportCheckpointState = 'skipped' | 'upcoming' | 'due' | 'submitted';

export type ReportCheckpoint = {
  slot: ReportCheckpointSlot;
  state: ReportCheckpointState;
  reason: string | null;
  submittedAt: number | null;
  text: string | null;
  version: number;
};

type WorkdayRow = { started_at:number; ended_at:number|null; status:string };
type CheckpointRow = { slot:ReportCheckpointSlot; report_text:string; submitted_at:number; version:number };

export async function readReportCheckpointPlan(
  db:D1Database,userId:string,date:string,now:number,today:string,
):Promise<ReportCheckpoint[]> {
  const [workday, rows] = await Promise.all([
    db.prepare(`SELECT started_at,ended_at,status FROM workdays WHERE user_id=?1 AND work_date=?2 LIMIT 1`).bind(userId,date).first<WorkdayRow>(),
    db.prepare(`SELECT slot,report_text,submitted_at,version FROM report_checkpoints WHERE user_id=?1 AND report_date=?2 ORDER BY slot`).bind(userId,date).all<CheckpointRow>(),
  ]);
  if (!workday) return [];
  const saved = new Map(rows.results.map((row)=>[row.slot,row]));
  return REPORT_CHECKPOINT_SLOTS.map((slot)=>checkpointView(slot,workday,saved.get(slot),date,now,today));
}
export async function readCheckpointSummary(db:D1Database,userId:string,date:string,slot:ReportCheckpointSlot) {
  const cutoff=lessonEpoch(date,slot);
  if(cutoff===null) throw new Error(`Не вдалося визначити час звіту ${slot}.`);
  const result=await db.prepare(`SELECT COALESCE(e.platform,l.platform,c.platform) AS platform,e.event_type,COUNT(*) AS count,0 AS changes_after_report
    FROM activity_events e
    LEFT JOIN leads l ON l.id=e.lead_id AND l.user_id=e.user_id
    LEFT JOIN chats c ON c.id=e.chat_id AND c.user_id=e.user_id
    WHERE e.user_id=?1 AND e.event_date=?2 AND e.occurred_at<=?3
      AND (e.cancelled_at IS NULL OR e.cancelled_at>?3)
      AND e.event_type NOT IN ('chat_state_changed','chat_bulk_added','chat_profile_changed','report_revision')
    GROUP BY COALESCE(e.platform,l.platform,c.platform),e.event_type`)
    .bind(userId,date,cutoff).all<{platform:string|null;event_type:string;count:number;changes_after_report:number}>();
  return result.results;
}

export async function saveReportCheckpoint(db:D1Database,input:{
  userId:string;date:string;slot:ReportCheckpointSlot;text:string;payload:unknown;now:number;today:string;expectedVersion:number;
}) {
  const workday=await db.prepare(`SELECT started_at,ended_at,status FROM workdays WHERE user_id=?1 AND work_date=?2 LIMIT 1`).bind(input.userId,input.date).first<WorkdayRow>();
  if(!workday) throw new Error('Робочий день за цю дату не знайдено.');
  const current=checkpointView(input.slot,workday,undefined,input.date,input.now,input.today);
  if(current.state==='skipped') throw new Error(current.reason||'Цей проміжний звіт не потрібен.');
  if(current.state==='upcoming') throw new Error(`Звіт ${input.slot} ще не настав.`);
  const text=input.text.trim().slice(0,20000);
  if(!text) throw new Error('Текст проміжного звіту порожній.');
  const id=`report_checkpoint:${input.userId}:${input.date}:${input.slot}`;
  const payloadJson=JSON.stringify(input.payload??{});
  if (!Number.isInteger(input.expectedVersion) || input.expectedVersion < 0) throw new Error('Некоректна версія проміжного звіту.');
  const result = input.expectedVersion === 0
    ? await db.prepare(`INSERT OR IGNORE INTO report_checkpoints
        (id,user_id,report_date,slot,report_text,payload_json,submitted_at,created_at,updated_at,version)
        VALUES (?1,?2,?3,?4,?5,?6,?7,?7,?7,1)`)
      .bind(id,input.userId,input.date,input.slot,text,payloadJson,input.now).run()
    : await db.prepare(`UPDATE report_checkpoints SET report_text=?1,payload_json=?2,submitted_at=?3,updated_at=?3,version=version+1
        WHERE user_id=?4 AND report_date=?5 AND slot=?6 AND version=?7`)
      .bind(text,payloadJson,input.now,input.userId,input.date,input.slot,input.expectedVersion).run();
  if (!Number(result.meta.changes || 0)) throw new Error('Проміжний звіт уже змінився. Оновіть дані та повторіть дію.');
  return readReportCheckpointPlan(db,input.userId,input.date,input.now,input.today);
}

function checkpointView(slot:ReportCheckpointSlot,workday:WorkdayRow,row:CheckpointRow|undefined,date:string,now:number,today:string):ReportCheckpoint {
  if(row) return {slot,state:'submitted',reason:null,submittedAt:Number(row.submitted_at),text:row.report_text,version:Number(row.version||0)};
  const startClock=clockMinutes(workday.started_at);
  const slotMinutes=clockValue(slot);
  if(startClock>=slotMinutes) return {slot,state:'skipped',reason:`Зміна почалась о ${clockLabel(workday.started_at)}, тому звіт ${slot} пропускається.`,submittedAt:null,text:null,version:0};
  if(slot==='19:00'&&workday.ended_at!==null) {
    const endClock=clockMinutes(workday.ended_at);
    if(endClock>=19*60&&endClock<=20*60) return {slot,state:'skipped',reason:'Зміна завершилась близько 19:30 — замість проміжного звіту потрібен фінальний.',submittedAt:null,text:null,version:0};
  }
  const dueAt=lessonEpoch(date,slot);
  const due=date<today||(date===today&&dueAt!==null&&now>=dueAt);
  return {slot,state:due?'due':'upcoming',reason:null,submittedAt:null,text:null,version:0};
}
function clockMinutes(epoch:number) {
  const parts=new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/Kyiv',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date(epoch*1000));
  const values=Object.fromEntries(parts.map(part=>[part.type,part.value]));
  return Number(values.hour)*60+Number(values.minute);
}
function clockLabel(epoch:number) {
  return new Intl.DateTimeFormat('uk-UA',{timeZone:'Europe/Kyiv',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date(epoch*1000));
}
function clockValue(slot:ReportCheckpointSlot) { const [hour,minute]=slot.split(':').map(Number); return hour*60+minute; }
