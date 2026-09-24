import { env } from 'cloudflare:workers';
import { getCurrentUser } from '@/lib/auth';
import { activityTotals, type ActivitySummaryRow } from '@/lib/activity-summary';
import { readJsonObject, sameOrigin } from '@/lib/http-json';
import { readCheckpointSummary, readReportCheckpointPlan, REPORT_CHECKPOINT_SLOTS, saveReportCheckpoint, type ReportCheckpointSlot } from '@/lib/reports/checkpoints';

const PLATFORM_NAMES:Record<string,string>={telegram:'Telegram',whatsapp:'WhatsApp',viber:'Viber',facebook:'Facebook',threads:'Threads',unknown:'Інше'};
const REQUEST_MAX_BYTES=16*1024;

export async function GET(request:Request):Promise<Response>{
  const user=await getCurrentUser();
  if(!user) return Response.json({error:'Потрібно увійти.'},{status:401});
  const url=new URL(request.url);
  const date=validDate(url.searchParams.get('date'))?url.searchParams.get('date')!:kyivDate();
  if(date>kyivDate()) return Response.json({error:'Майбутні звіти недоступні.'},{status:400});
  const now=Math.floor(Date.now()/1000);
  const checkpoints=await readReportCheckpointPlan(env.DB,user.id,date,now,kyivDate());
  return Response.json({date,checkpoints},{headers:{'Cache-Control':'no-store'}});
}

export async function POST(request:Request):Promise<Response>{
  const user=await getCurrentUser();
  if(!user) return Response.json({error:'Потрібно увійти.'},{status:401});
  if(!sameOrigin(request)) return Response.json({error:'Недійсний запит.'},{status:403});
  const parsed=await readJsonObject(request,REQUEST_MAX_BYTES);
  if(parsed instanceof Response) return parsed;
  const body=parsed as {date?:unknown;slot?:unknown;expectedVersion?:unknown};
  const date=validDate(body.date)?body.date:'';
  const slot=typeof body.slot==='string'&&REPORT_CHECKPOINT_SLOTS.includes(body.slot as ReportCheckpointSlot)?body.slot as ReportCheckpointSlot:null;
  const expectedVersion=Number(body.expectedVersion);
  if(!date||!slot||!Number.isInteger(expectedVersion)||expectedVersion<0) return Response.json({error:'Некоректний проміжний звіт.'},{status:400});
  const today=kyivDate();
  if(date>today) return Response.json({error:'Майбутні звіти недоступні.'},{status:400});
  const now=Math.floor(Date.now()/1000);
  const summary=await readCheckpointSummary(env.DB,user.id,date,slot);
  const text=buildCheckpointText(date,slot,summary);
  try {
    const checkpoints=await saveReportCheckpoint(env.DB,{userId:user.id,date,slot,text,payload:{summary,cutoff:slot},now,today,expectedVersion});
    return Response.json({ok:true,date,checkpoints,text});
  } catch(reason) {
    return Response.json({error:reason instanceof Error?reason.message:'Не вдалося здати проміжний звіт.'},{status:409});
  }
}

function buildCheckpointText(date:string,slot:ReportCheckpointSlot,rows:ActivitySummaryRow[]) {
  const groups=new Map<string,ActivitySummaryRow[]>();
  for(const row of rows){const key=row.platform||'unknown';groups.set(key,[...(groups.get(key)||[]),row]);}
  const lines=[`Проміжний звіт станом на ${slot} · ${formatDate(date)}`];
  for(const [platform,values] of [...groups].sort(([a],[b])=>a.localeCompare(b))) {
    const totals=activityTotals(values);
    lines.push(`${PLATFORM_NAMES[platform]||platform}: оголошення ${totals.publications}, відгуки ${totals.responses}, записи ${totals.bookings}`);
  }
  const total=activityTotals(rows);
  lines.push(`Разом: оголошення ${total.publications}, відгуки ${total.responses}, записи ${total.bookings}`);
  return lines.join('\n');
}
function validDate(value:unknown):value is string{return typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value);}
function kyivDate(){const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Kyiv',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());const values=Object.fromEntries(parts.map(part=>[part.type,part.value]));return `${values.year}-${values.month}-${values.day}`;}
function formatDate(value:string){const [year,month,day]=value.split('-');return `${day}.${month}.${year}`;}
