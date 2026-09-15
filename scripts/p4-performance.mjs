import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { readFileSync, readdirSync } from 'node:fs';
import { Miniflare } from 'miniflare';
import { previewBulkChats } from '../lib/chats/bulk.ts';

const RUNS = Number(process.env.PERF_RUNS || 12);
const OWNER = 'u';
const DATE = '2026-09-10';
const NOW = Date.parse('2026-09-10T12:00:00Z') / 1000;

function sqlStatements(sql) {
  const statements=[]; let current=''; let trigger=false;
  for (const line of sql.replace(/^\uFEFF/, '').split('\n')) {
    const trimmed=line.trim(); if (!trimmed || trimmed.startsWith('--')) continue;
    current += ` ${line}`;
    if (/^CREATE TRIGGER/i.test(trimmed)) trigger=true;
    if ((!trigger && trimmed.endsWith(';')) || (trigger && trimmed.startsWith('END;'))) {
      statements.push(current.trim()); current=''; trigger=false;
    }
  }
  assert.equal(current.trim(), ''); return statements;
}
function pct(values,p){const a=[...values].sort((x,y)=>x-y);return a[Math.min(a.length-1,Math.ceil(a.length*p)-1)];}
function rounded(value){return Math.round(value*10)/10;}
function summary(samples,metas,payloadBytes,statements=1){
  const rows=metas.map(m=>Number(m.rows_read||0)); const d=metas.map(m=>Number(m.duration||0));
  return {runs:samples.length,statements,p50Ms:rounded(pct(samples,.5)),p95Ms:rounded(pct(samples,.95)),maxMs:rounded(Math.max(...samples)),rowsReadP50:Math.round(pct(rows,.5)),rowsReadP95:Math.round(pct(rows,.95)),d1DurationP95Ms:rounded(pct(d,.95)),payloadBytes};
}
async function all(db,sql,binds=[]){return db.prepare(sql).bind(...binds).all();}
async function benchQuery(db,sql,binds=[]){
  await all(db,sql,binds); const samples=[]; const metas=[]; let payloadBytes=0;
  for(let i=0;i<RUNS;i++){const t=performance.now();const result=await all(db,sql,binds);samples.push(performance.now()-t);metas.push(result.meta);payloadBytes=Buffer.byteLength(JSON.stringify(result.results));}
  return summary(samples,metas,payloadBytes);
}
async function benchBatch(db,queries){
  const execute=()=>db.batch(queries.map(({sql,binds=[]})=>db.prepare(sql).bind(...binds)));
  await execute(); const samples=[]; const metas=[]; let payloadBytes=0;
  for(let i=0;i<RUNS;i++){const t=performance.now();const result=await execute();samples.push(performance.now()-t);metas.push({rows_read:result.reduce((n,r)=>n+Number(r.meta.rows_read||0),0),duration:result.reduce((n,r)=>n+Number(r.meta.duration||0),0)});payloadBytes=Buffer.byteLength(JSON.stringify(result.map(r=>r.results)));}
  return summary(samples,metas,payloadBytes,queries.length);
}
async function explain(db,sql,binds=[]){const r=await all(db,`EXPLAIN QUERY PLAN ${sql}`,binds);return r.results.map(x=>x.detail);}

const mf=new Miniflare({modules:true,port:0,script:'export default {fetch(){return new Response("ok")}}',d1Databases:['DB']});
const db=await mf.getD1Database('DB');
try {
  const folder=new URL('../migrations/',import.meta.url);
  for(const file of readdirSync(folder).filter(n=>n.endsWith('.sql')).sort()) for(const sql of sqlStatements(readFileSync(new URL(file,folder),'utf8'))) await db.prepare(sql).run();
  await db.prepare(`INSERT INTO users(id,email,display_name,created_at,last_login_at) VALUES ('u','u@example.test','Perf',1,1),('other','other@example.test','Other',1,1)`).run();
  const seedStart=performance.now();
  await db.prepare(`WITH RECURSIVE seq(n) AS (VALUES(1) UNION ALL SELECT n+1 FROM seq WHERE n<10000)
    INSERT INTO chats(id,user_id,platform,name,link,normalized_link,workflow_status,created_at,updated_at)
    SELECT 'perf-chat-'||n,'u','telegram','Chat '||n,'https://t.me/perf_'||n,'https://t.me/perf_'||n,'to_join',n,n FROM seq`).run();
  await db.prepare(`INSERT INTO chat_profiles(chat_id,language,cadence,weekdays_json,directions_json,note,review_status,source,updated_at)
    SELECT id,'uk','any','[]','[]','',CASE WHEN rowid%3=0 THEN 'draft' ELSE 'confirmed' END,'perf',updated_at FROM chats WHERE user_id='u'`).run();
  await db.prepare(`WITH RECURSIVE seq(n) AS (VALUES(1) UNION ALL SELECT n+1 FROM seq WHERE n<10000)
    INSERT INTO library_items(id,user_id,kind,collection,version,title,uk_text,ru_text,notes,tags_json,platforms_json,created_at,updated_at)
    SELECT 'perf-lib-'||n,'u','advertisement','advertisement',1,'Матеріал '||n,'Тестовий текст оголошення '||n,'Тестовый текст объявления '||n,'','[]','["telegram"]',n,n FROM seq`).run();
  await db.prepare(`WITH RECURSIVE seq(n) AS (VALUES(1) UNION ALL SELECT n+1 FROM seq WHERE n<10000)
    INSERT INTO leads(id,user_id,name,subject,platform,status,source_chat_id,created_at,updated_at)
    SELECT 'perf-lead-'||n,'u','Lead '||n,CASE n%4 WHEN 0 THEN 'Англійська' WHEN 1 THEN 'English' WHEN 2 THEN 'Математика' ELSE '' END,'telegram','response','perf-chat-'||n,n,n FROM seq`).run();
  await db.prepare(`WITH RECURSIVE digit(n) AS (VALUES(0) UNION ALL SELECT n+1 FROM digit WHERE n<9)
    INSERT INTO activity_events(id,user_id,event_type,platform,lead_id,occurred_at,event_date,metadata_json,source_key)
    SELECT 'perf-event-'||l.id||'-'||digit.n,'u',CASE WHEN digit.n<5 THEN 'lead_created' ELSE 'lesson_booked' END,'telegram',l.id,100+digit.n,'${DATE}','{}','perf:'||l.id||':'||digit.n FROM leads l CROSS JOIN digit WHERE l.user_id='u' AND l.id LIKE 'perf-lead-%'`).run();
  const dataset={chats:10000,profiles:10000,libraryItems:10000,leads:10000,events:100000,seedMs:Math.round(performance.now()-seedStart)};

  const subjectSql=`SELECT e.event_type,CASE WHEN e.event_type='lead_created' THEN l.subject ELSE COALESCE(NULLIF(ls.subject,''),l.subject) END AS subject,COUNT(*) AS count FROM activity_events e LEFT JOIN leads l ON l.id=e.lead_id AND l.user_id=e.user_id LEFT JOIN lessons ls ON ls.id=e.lesson_id AND ls.user_id=e.user_id WHERE e.user_id=?1 AND e.event_date>=?2 AND e.event_date<=?3 AND e.cancelled_at IS NULL AND e.event_type IN ('lead_created','lesson_booked','curator_booking_pending') GROUP BY e.event_type,CASE WHEN e.event_type='lead_created' THEN l.subject ELSE COALESCE(NULLIF(ls.subject,''),l.subject) END`;
  const chatSql=`SELECT c.id,c.name,c.link,c.platform,c.workflow_status,c.joined_at,c.snoozed_until,c.archive_reason,c.telegram_account_id,p.review_status AS profile_status,p.language,p.cadence,p.weekdays_json,p.directions_json,p.note,EXISTS(SELECT 1 FROM chat_publications cp WHERE cp.user_id=c.user_id AND cp.chat_id=c.id AND cp.published_on=?4) AS published_today FROM chats c LEFT JOIN chat_profiles p ON p.chat_id=c.id WHERE c.user_id=?1 AND c.platform='telegram' AND c.workflow_status='to_join' AND (c.telegram_account_id=?2 OR (c.telegram_account_id IS NULL AND c.workflow_status='to_join')) ORDER BY CASE WHEN c.snoozed_until IS NOT NULL AND c.snoozed_until>?3 THEN 1 ELSE 0 END,c.updated_at DESC,c.name LIMIT 50 OFFSET 0`;
  const chatCountSql=`SELECT COUNT(*) AS count FROM chats c WHERE c.user_id=?1 AND c.platform='telegram' AND c.workflow_status='to_join' AND (c.telegram_account_id=?2 OR (c.telegram_account_id IS NULL AND c.workflow_status='to_join'))`;
  const chatCountsSql=`SELECT c.workflow_status,COUNT(*) AS count,SUM(CASE WHEN p.review_status='confirmed' THEN 1 ELSE 0 END) AS confirmed_count,SUM(CASE WHEN p.review_status='draft' THEN 1 ELSE 0 END) AS draft_count,SUM(CASE WHEN p.chat_id IS NULL THEN 1 ELSE 0 END) AS empty_count FROM chats c LEFT JOIN chat_profiles p ON p.chat_id=c.id WHERE c.user_id=?1 AND c.platform='telegram' AND (c.telegram_account_id=?2 OR (c.telegram_account_id IS NULL AND c.workflow_status='to_join')) GROUP BY c.workflow_status`;
  const joinedSql=`SELECT c.name,c.link FROM activity_events e JOIN chats c ON c.id=e.chat_id AND c.user_id=e.user_id WHERE e.user_id=?1 AND COALESCE(e.platform,c.platform)='telegram' AND e.event_date=?2 AND e.event_type='chat_joined' AND e.cancelled_at IS NULL AND e.telegram_account_id=?3 GROUP BY c.id ORDER BY MIN(e.occurred_at),c.id`;
  const publishedSql=`SELECT c.name,c.link FROM chat_publications p JOIN chats c ON c.id=p.chat_id WHERE p.user_id=?1 AND c.platform='telegram' AND p.published_on=?2 AND p.telegram_account_id=?3 ORDER BY p.published_at,p.created_at`;
  const settingSql=`SELECT value_json FROM user_settings WHERE user_id=?1 AND setting_key='analytics-daily-goal-schedule-v1' LIMIT 1`;
  const publicationCountSql=`SELECT COUNT(*) AS count FROM activity_events WHERE user_id=?1 AND event_type='publication' AND event_date=?2 AND cancelled_at IS NULL`;
  const leadRowsSql=`SELECT id,name,platform,subject,status,funnel_stage,qualification,duplicate_state,response_date,next_action,next_contact_at,archived_at FROM leads WHERE user_id=?1 AND archived_at IS NULL ORDER BY updated_at DESC,id ASC LIMIT 50 OFFSET 0`;
  const leadCountSql=`SELECT COUNT(*) AS count FROM leads WHERE user_id=?1 AND archived_at IS NULL`;
  const librarySql=`SELECT id,kind,collection,version,title,uk_text,ru_text,notes,tags_json,platforms_json,archived_at,created_at,updated_at FROM library_items WHERE user_id=?1 AND archived_at IS NULL AND kind='advertisement' ORDER BY updated_at DESC,title LIMIT 200`;
  const bulkScanSql=`SELECT id,platform,name,link,normalized_link,workflow_status FROM chats WHERE user_id=?1 AND platform IN (SELECT value FROM json_each(?2)) LIMIT 10001`;

  const benchmarks={}; const plans={};
  benchmarks.subjectAnalytics=await benchQuery(db,subjectSql,[OWNER,DATE,DATE]); plans.subjectAnalytics=await explain(db,subjectSql,[OWNER,DATE,DATE]);
  benchmarks.chatQueuePage=await benchQuery(db,chatSql,[OWNER,'perf-account',NOW,DATE]); plans.chatQueuePage=await explain(db,chatSql,[OWNER,'perf-account',NOW,DATE]);
  benchmarks.chatReadBundle=await benchBatch(db,[{sql:chatSql,binds:[OWNER,'perf-account',NOW,DATE]},{sql:chatCountSql,binds:[OWNER,'perf-account']},{sql:chatCountsSql,binds:[OWNER,'perf-account']},{sql:joinedSql,binds:[OWNER,DATE,'perf-account']},{sql:publishedSql,binds:[OWNER,DATE,'perf-account']},{sql:settingSql,binds:[OWNER]},{sql:publicationCountSql,binds:[OWNER,DATE]}]);
  benchmarks.leadList=await benchBatch(db,[{sql:leadRowsSql,binds:[OWNER]},{sql:leadCountSql,binds:[OWNER]}]); plans.leadList=[...(await explain(db,leadRowsSql,[OWNER])),...(await explain(db,leadCountSql,[OWNER]))];
  benchmarks.libraryPage=await benchQuery(db,librarySql,[OWNER]); plans.libraryPage=await explain(db,librarySql,[OWNER]);
  benchmarks.bulkChatScan=await benchQuery(db,bulkScanSql,[OWNER,JSON.stringify(['telegram'])]); plans.bulkChatScan=await explain(db,bulkScanSql,[OWNER,JSON.stringify(['telegram'])]);

  let statementCount=0; const bulkMetas=[];
  const measured={prepare(sql){statementCount++;return db.prepare(sql);},async batch(items){const r=await db.batch(items);bulkMetas.push(...r.map(x=>x.meta));return r;}};
  const t=performance.now(); const preview=await previewBulkChats(measured,OWNER,[{link:'https://telegram.me/PERF_9999',name:''},{link:'https://t.me/fresh_perf_group',name:''}]);
  benchmarks.bulkPreviewActual={wallMs:rounded(performance.now()-t),statements:statementCount,rowsRead:bulkMetas.reduce((n,m)=>n+Number(m.rows_read||0),0),payloadBytes:Buffer.byteLength(JSON.stringify(preview)),statuses:preview.items.map(i=>i.status)};

  assert.ok(benchmarks.subjectAnalytics.p95Ms < 500, 'subject analytics p95 must stay below 500ms');
  assert.ok(benchmarks.chatReadBundle.p95Ms < 500, 'chat read bundle p95 must stay below 500ms');
  assert.ok(benchmarks.leadList.p95Ms < 500, 'lead list p95 must stay below 500ms');
  assert.ok(benchmarks.libraryPage.p95Ms < 500, 'library page p95 must stay below 500ms');
  assert.ok(benchmarks.bulkPreviewActual.wallMs < 500, '10k-chat bulk preview must stay below 500ms on the recorded local stand');
  assert.equal(benchmarks.chatReadBundle.statements,7);
  assert.equal(benchmarks.leadList.statements,2);
  assert.equal(benchmarks.bulkPreviewActual.statements,2);
  assert.deepEqual(benchmarks.bulkPreviewActual.statuses,['existing','new']);
  const output={environment:{node:process.version,runs:RUNS},dataset,benchmarks,plans};
  console.log(JSON.stringify(output,null,2));
} finally { await mf.dispose(); }
