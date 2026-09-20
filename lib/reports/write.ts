export type ReportWriteResult =
  | { ok: true; id: string; revision: number; submittedAt: number | null; updatedAt: number; unchanged: boolean }
  | { ok: false; currentRevision: number };

type ExistingReport = {
  id: string;
  report_text: string;
  payload_json: string | null;
  submitted_at: number | null;
  submitted_activity_revision: number | null;
  revision_count: number | null;
};

export async function saveReportText(db: D1Database, input: {
  userId: string;
  date: string;
  text: string;
  submitted: boolean;
  expectedRevision: number;
  now: number;
}): Promise<ReportWriteResult> {
  const current = await db.prepare(`SELECT id,report_text,payload_json,submitted_at,submitted_activity_revision,revision_count
    FROM daily_reports WHERE user_id=?1 AND report_date=?2 LIMIT 1`)
    .bind(input.userId, input.date).first<ExistingReport>();
  const currentRevision = current ? Math.max(1, Number(current.revision_count || 1)) : 0;
  if (currentRevision !== input.expectedRevision) return { ok:false, currentRevision };

  let submittedAt = current?.submitted_at ?? null;
  let submittedActivityRevision = current?.submitted_activity_revision ?? null;
  if (input.submitted) {
    submittedAt = input.now;
    const activity = await db.prepare(`SELECT revision FROM activity_day_revisions
      WHERE user_id=?1 AND event_date=?2 LIMIT 1`).bind(input.userId, input.date).first<{ revision:number }>();
    submittedActivityRevision = Number(activity?.revision || 0);
  }

  if (current && current.report_text === input.text && current.submitted_at === submittedAt) {
    return { ok:true, id:current.id, revision:currentRevision, submittedAt, updatedAt:input.now, unchanged:true };
  }

  const id = current?.id || `report_${input.userId}_${input.date}`;
  const payloadJson = manualPayload(current?.payload_json ?? null, input.now);
  const result = await db.prepare(`INSERT INTO daily_reports
    (id,user_id,report_date,report_text,payload_json,submitted_at,submitted_activity_revision,updated_at,source_import_id)
    VALUES (?1,?2,?3,?4,?5,?6,?7,?8,NULL)
    ON CONFLICT(user_id,report_date) DO UPDATE SET
      report_text=excluded.report_text,payload_json=excluded.payload_json,submitted_at=excluded.submitted_at,
      submitted_activity_revision=excluded.submitted_activity_revision,updated_at=excluded.updated_at,
      revision_count=COALESCE(daily_reports.revision_count,1)+1,source_import_id=NULL
    WHERE daily_reports.user_id=excluded.user_id AND COALESCE(daily_reports.revision_count,1)=?9`)
    .bind(id,input.userId,input.date,input.text,payloadJson,submittedAt,submittedActivityRevision,input.now,input.expectedRevision).run();

  if (!result.meta.changes) {
    const latest = await db.prepare(`SELECT revision_count FROM daily_reports
      WHERE user_id=?1 AND report_date=?2 LIMIT 1`).bind(input.userId,input.date).first<{revision_count:number|null}>();
    return { ok:false, currentRevision:latest ? Math.max(1,Number(latest.revision_count || 1)) : 0 };
  }
  return {
    ok:true,
    id,
    revision:current ? input.expectedRevision + 1 : 1,
    submittedAt,
    updatedAt:input.now,
    unchanged:false,
  };
}

function manualPayload(value: string | null, now: number): string {
  let payload: Record<string, unknown> = {};
  if (value) {
    try {
      const parsed: unknown = JSON.parse(value);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) payload = parsed as Record<string, unknown>;
    } catch {}
  }
  return JSON.stringify({ ...payload, source:'manual', updatedAt:now });
}
