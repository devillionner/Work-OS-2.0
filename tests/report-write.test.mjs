import assert from 'node:assert/strict';
import test from 'node:test';
import { saveReportText } from '../lib/reports/write.ts';
import { localDatabase } from './helpers/local-d1.mjs';

const DATE='2026-09-20';

void test('report text writes use optimistic revisions and preserve manual-adjustment metadata', async t => {
  const db=await localDatabase(t);
  const created=await saveReportText(db,{userId:'u',date:DATE,text:'v1',submitted:false,expectedRevision:0,now:10});
  assert.equal(created.ok,true);
  assert.equal(created.revision,1);

  await db.prepare(`UPDATE daily_reports SET payload_json=?1 WHERE user_id='u' AND report_date=?2`)
    .bind(JSON.stringify({source:'manual',manualAdjustments:{publications:1,responses:-1,bookings:0},legacyKey:'keep'}),DATE).run();

  const saved=await saveReportText(db,{userId:'u',date:DATE,text:'v2',submitted:false,expectedRevision:1,now:20});
  assert.equal(saved.ok,true);
  assert.equal(saved.revision,2);
  const row=await db.prepare(`SELECT report_text,payload_json,revision_count FROM daily_reports WHERE user_id='u' AND report_date=?1`).bind(DATE).first();
  assert.equal(row.report_text,'v2');
  assert.equal(row.revision_count,2);
  const payload=JSON.parse(row.payload_json);
  assert.deepEqual(payload.manualAdjustments,{publications:1,responses:-1,bookings:0});
  assert.equal(payload.legacyKey,'keep');
  assert.equal(payload.source,'manual');
});

void test('stale report save cannot overwrite a newer revision', async t => {
  const db=await localDatabase(t);
  await saveReportText(db,{userId:'u',date:DATE,text:'base',submitted:false,expectedRevision:0,now:10});
  const first=await saveReportText(db,{userId:'u',date:DATE,text:'newer',submitted:false,expectedRevision:1,now:20});
  const stale=await saveReportText(db,{userId:'u',date:DATE,text:'stale overwrite',submitted:false,expectedRevision:1,now:21});
  assert.equal(first.ok,true);
  assert.deepEqual(stale,{ok:false,currentRevision:2});
  const row=await db.prepare(`SELECT report_text,revision_count FROM daily_reports WHERE user_id='u' AND report_date=?1`).bind(DATE).first();
  assert.equal(row.report_text,'newer');
  assert.equal(row.revision_count,2);
});

void test('same draft text is idempotent while a resubmission creates a new version', async t => {
  const db=await localDatabase(t);
  await saveReportText(db,{userId:'u',date:DATE,text:'same',submitted:false,expectedRevision:0,now:10});
  const unchanged=await saveReportText(db,{userId:'u',date:DATE,text:'same',submitted:false,expectedRevision:1,now:11});
  assert.equal(unchanged.ok,true);
  assert.equal(unchanged.unchanged,true);
  assert.equal(unchanged.revision,1);

  const submitted=await saveReportText(db,{userId:'u',date:DATE,text:'same',submitted:true,expectedRevision:1,now:12});
  assert.equal(submitted.ok,true);
  assert.equal(submitted.revision,2);
  assert.equal(submitted.submittedAt,12);
});

void test('report UI and restore path send the loaded revision and preserve local text on conflict', async () => {
  const { readFile }=await import('node:fs/promises');
  const route=await readFile(new URL('../app/api/reports/route.ts',import.meta.url),'utf8');
  const workspace=await readFile(new URL('../components/reports-workspace.tsx',import.meta.url),'utf8');
  const history=await readFile(new URL('../components/report-history-dialog.tsx',import.meta.url),'utf8');
  assert.match(route,/expectedRevision/);
  assert.match(route,/currentRevision:result\.currentRevision/);
  assert.match(workspace,/expectedRevision: (data|editorData)\?\.selected\?\.revisionCount \?\? 0/);
  assert.match(workspace,/setReportConflict\(true\)/);
  assert.match(workspace,/Локальний текст залишено без змін/);
  assert.match(history,/expectedRevision: currentRevision/);
});
