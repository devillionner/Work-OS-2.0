import { env } from 'cloudflare:workers';
import { getCurrentUser } from '@/lib/auth';
import { resolveAnalyticsRange } from '@/lib/analytics-range';
import { analyticsMetricInfo, isAnalyticsMetric, readAnalyticsMetricEvents } from '@/lib/analytics-events';

export async function GET(request:Request):Promise<Response>{
  const user=await getCurrentUser();
  if(!user)return Response.json({error:'Потрібно увійти.'},{status:401});
  const url=new URL(request.url);
  const metric=url.searchParams.get('metric');
  if(!isAnalyticsMetric(metric))return Response.json({error:'Невідомий показник.'},{status:400});
  let range;
  try{range=resolveAnalyticsRange(url.searchParams,kyivDate());}
  catch(error){return Response.json({error:error instanceof Error?error.message:'Некоректний період аналітики.'},{status:400,headers:{'Cache-Control':'no-store'}});}
  const details=await readAnalyticsMetricEvents(env.DB,{userId:user.id,metric,from:range.from,to:range.to,limit:100});
  return Response.json({metric,...analyticsMetricInfo(metric),range:{from:range.from,to:range.to},...details},{headers:{'Cache-Control':'no-store'}});
}

function kyivDate(){
  const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Kyiv',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());
  const values=Object.fromEntries(parts.map(part=>[part.type,part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}
