export type FinalReportState = {
  canSubmit: boolean;
  reason: string | null;
};

type WorkdayRow = { ended_at:number|null; status:string };

export async function readFinalReportState(
  db:D1Database,userId:string,date:string,now:number,today:string,
):Promise<FinalReportState> {
  if (date < today) return { canSubmit:true, reason:null };
  if (date > today) return { canSubmit:false, reason:'Майбутній фінальний звіт недоступний.' };
  const workday=await db.prepare(`SELECT ended_at,status FROM workdays WHERE user_id=?1 AND work_date=?2 LIMIT 1`)
    .bind(userId,date).first<WorkdayRow>();
  if (workday?.status==='ended' && workday.ended_at) return { canSubmit:true, reason:null };
  if (kyivMinutes(now) >= 23*60) return { canSubmit:true, reason:null };
  return { canSubmit:false, reason:'Фінальний звіт можна здати після завершення зміни або о 23:00.' };
}

function kyivMinutes(epoch:number) {
  const parts=new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/Kyiv',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date(epoch*1000));
  const values=Object.fromEntries(parts.map(part=>[part.type,part.value]));
  return Number(values.hour)*60+Number(values.minute);
}
