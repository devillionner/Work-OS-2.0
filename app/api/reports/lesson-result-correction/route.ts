import { getCurrentUser } from '@/lib/auth';
import { getDb } from '@/db';
import { env } from 'cloudflare:workers';
import { D1LeadRepository } from '@/lib/leads/data/repository';
import { executeLeadCommand } from '@/lib/leads/application/service';
import { commandBody, errorResponse, json } from '@/lib/leads/application/http';
import { LeadError, date as validDate, only, record, string } from '@/lib/leads/domain/validation';
import { readHistoricalLessonResultOptions, resolveHistoricalLessonResultTarget } from '@/lib/reports/lesson-result-correction';
import { ReportCorrectionError } from '@/lib/reports/publication-correction';

export async function GET(request:Request):Promise<Response>{
  try{
    const user=await getCurrentUser();
    if(!user)return json({error:'Потрібно увійти.'},401);
    const date=validDate(new URL(request.url).searchParams.get('date'),'Дата обліку');
    const lessons=await readHistoricalLessonResultOptions(env.DB,{userId:user.id,date,now:unixNow()});
    return json({date,lessons});
  }catch(error){return correctionError(error);}
}

export async function POST(request:Request):Promise<Response>{
  try{
    const user=await getCurrentUser();
    if(!user)return json({error:'Потрібно увійти.'},401);
    const body=record(await commandBody(request));
    only(body,['requestId','date','lessonId','status','reason']);
    const requestId=string(body.requestId,'ID запиту',100,true);
    const date=validDate(body.date,'Дата обліку');
    const lessonId=string(body.lessonId,'Урок',200,true);
    const now=unixNow();
    const target=await resolveHistoricalLessonResultTarget(env.DB,{userId:user.id,date,lessonId,now});
    if(!target)throw new LeadError('Урок за вибрану дату не знайдено.',404);
    const repo=new D1LeadRepository(getDb());
    const leadId=await executeLeadCommand(repo,user.id,{
      commandId:requestId,
      leadId:target.leadId,
      version:Number(target.leadVersion),
      action:'lesson_status',
      entityId:lessonId,
      data:{status:body.status,reason:body.reason,accountingDate:date},
    },now);
    return json({ok:true,leadId,lessonId,date});
  }catch(error){return correctionError(error);}
}

function correctionError(error:unknown){
  if(error instanceof ReportCorrectionError)return json({error:error.message},error.status);
  return errorResponse(error);
}
function unixNow(){return Math.floor(Date.now()/1000);}
