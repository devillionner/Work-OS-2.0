import { validateAccountingDate } from './publication-correction.ts';

const LESSON_LIMIT=100;

export type HistoricalLessonResultOption={
  lessonId:string;
  leadId:string;
  leadName:string;
  studentName:string;
  subject:string;
  lessonTime:string;
  status:string;
};

type LessonRow={
  lesson_id:string;
  lead_id:string;
  lead_name:string;
  student_name:string;
  subject:string;
  lesson_time:string;
  status:string;
};

export async function readHistoricalLessonResultOptions(db:D1Database,input:{userId:string;date:string;now:number}):Promise<HistoricalLessonResultOption[]>{
  validateAccountingDate(input.date,input.now);
  const result=await db.prepare(`SELECT ls.id AS lesson_id,ls.lead_id,l.name AS lead_name,ls.student_name,ls.subject,ls.lesson_time,ls.status
    FROM lessons ls JOIN leads l ON l.id=ls.lead_id AND l.user_id=ls.user_id
    WHERE ls.user_id=?1 AND ls.lesson_date=?2 AND ls.status IN ('booked','scheduled')
    ORDER BY CASE WHEN ls.lesson_time='' THEN 1 ELSE 0 END,ls.lesson_time,ls.id LIMIT ${LESSON_LIMIT}`)
    .bind(input.userId,input.date).all<LessonRow>();
  return result.results.map(row=>({
    lessonId:row.lesson_id,
    leadId:row.lead_id,
    leadName:row.lead_name,
    studentName:row.student_name,
    subject:row.subject,
    lessonTime:row.lesson_time,
    status:row.status,
  }));
}

export async function resolveHistoricalLessonResultTarget(db:D1Database,input:{userId:string;date:string;lessonId:string;now:number}){
  validateAccountingDate(input.date,input.now);
  return db.prepare(`SELECT ls.id AS lessonId,ls.lead_id AS leadId,l.version AS leadVersion
    FROM lessons ls JOIN leads l ON l.id=ls.lead_id AND l.user_id=ls.user_id
    WHERE ls.id=?1 AND ls.user_id=?2 AND ls.lesson_date=?3 LIMIT 1`)
    .bind(input.lessonId,input.userId,input.date).first<{lessonId:string;leadId:string;leadVersion:number}>();
}
