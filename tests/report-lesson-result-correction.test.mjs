import assert from 'node:assert/strict';
import test from 'node:test';
import { applyLessonAction } from '../lib/leads/application/lesson-actions.ts';
import { readHistoricalLessonResultOptions, resolveHistoricalLessonResultTarget } from '../lib/reports/lesson-result-correction.ts';
import { localDatabase } from './helpers/local-d1.mjs';

const DATE='2026-09-10';
const NOW=Math.floor(Date.parse('2026-09-13T12:00:00Z')/1000);

void test('historical lesson result options are owner/date/status scoped',async t=>{
  const db=await localDatabase(t);
  await db.prepare(`INSERT INTO leads(id,user_id,name,subject,platform,status,created_at,updated_at)
    VALUES ('lead-u','u','Олена','Англійська','telegram','response',1,1),('lead-other','other','Інший','Математика','telegram','response',1,1)`).run();
  await db.prepare(`INSERT INTO lessons(id,user_id,lead_id,student_name,subject,lesson_date,lesson_time,status,created_at,updated_at)
    VALUES ('lesson-booked','u','lead-u','Олена','Англійська',?1,'18:00','booked',1,1),
           ('lesson-scheduled','u','lead-u','Дитина','Математика',?1,'17:00','scheduled',1,1),
           ('lesson-done','u','lead-u','Олена','Англійська',?1,'16:00','completed',1,1),
           ('lesson-other-day','u','lead-u','Олена','Англійська','2026-09-11','15:00','booked',1,1),
           ('lesson-foreign','other','lead-other','Інший','Математика',?1,'14:00','booked',1,1)`).bind(DATE).run();

  const options=await readHistoricalLessonResultOptions(db,{userId:'u',date:DATE,now:NOW});
  assert.deepEqual(options.map(item=>item.lessonId),['lesson-scheduled','lesson-booked']);
  assert.equal(options[0].leadName,'Олена');
  assert.equal(options[0].studentName,'Дитина');
  const target=await resolveHistoricalLessonResultTarget(db,{userId:'u',date:DATE,lessonId:'lesson-booked',now:NOW});
  assert.equal(target.leadId,'lead-u');
  assert.equal(await resolveHistoricalLessonResultTarget(db,{userId:'u',date:DATE,lessonId:'lesson-foreign',now:NOW}),null);
});

void test('lesson status accepts explicit historical accounting date without changing default behavior',()=>{
  const old={id:'lesson-1',status:'booked',lessonDate:DATE};
  const makeContext=()=>{
    const events=[];
    const changes={lead:{id:'lead-1',userId:'u',funnelStage:'booked'},lessons:[]};
    return {events,changes,context:{
      action:'lesson_status',entityId:'lesson-1',aggregate:{lessons:[old]},changes,now:NOW,
      event:(type,date,lessonId,metadata)=>events.push({type,date,lessonId,metadata}),
    }};
  };

  const historical=makeContext();
  applyLessonAction({...historical.context,data:{status:'cancelled',reason:'Учень попередив',accountingDate:'2026-09-09'}});
  assert.equal(historical.changes.lessons[0].status,'cancelled');
  assert.equal(historical.changes.lead.funnelStage,'clarification');
  assert.deepEqual(historical.events,[{
    type:'lesson_cancelled',date:'2026-09-09',lessonId:'lesson-1',
    metadata:{reason:'Учень попередив',accountingDate:'2026-09-09',correction:'historical_report'},
  }]);

  const normal=makeContext();
  applyLessonAction({...normal.context,data:{status:'completed',reason:''}});
  assert.equal(normal.events[0].date,DATE);
  assert.deepEqual(normal.events[0].metadata,{reason:''});

  const future=makeContext();
  assert.throws(()=>applyLessonAction({...future.context,data:{status:'no-show',reason:'Не вийшов на зв’язок',accountingDate:'2026-09-14'}}),/майбутньому/);
  assert.equal(future.changes.lessons.length,0);
  assert.equal(future.events.length,0);
});
