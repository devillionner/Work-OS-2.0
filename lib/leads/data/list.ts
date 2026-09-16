import { leadSearchAliases } from './search.ts';

export type LeadListView =
  | 'active'
  | 'responses'
  | 'curator'
  | 'needs-details'
  | 'overdue'
  | 'archived';

export type LeadListOptions = {
  view: LeadListView;
  search: string;
  offset: number;
};

type LeadListRow = {
  id: string;
  name: string;
  platform: string;
  subject: string;
  status: string;
  funnel_stage: string;
  qualification: string | null;
  duplicate_state: string;
  response_date: string | null;
  next_action: string;
  next_contact_at: number | null;
  archived_at: number | null;
};

type CountRow = { count: number };
type BindValue = string | number;

export async function listLeads(
  db: D1Database,
  userId: string,
  options: LeadListOptions,
  now: number,
) {
  const { sql: whereSql, binds } = buildWhere(userId, options, now);
  const orderSql = options.view === 'overdue'
    ? 'l.next_contact_at ASC, l.id ASC'
    : 'l.updated_at DESC, l.id ASC';
  const [rowsResult, countResult] = await db.batch([
    db.prepare(`SELECT l.id,l.name,l.platform,l.subject,l.status,l.funnel_stage,l.qualification,
        l.duplicate_state,l.response_date,l.next_action,l.next_contact_at,l.archived_at
      FROM leads l
      WHERE ${whereSql}
      ORDER BY ${orderSql}
      LIMIT 50 OFFSET ?`).bind(...binds, options.offset),
    db.prepare(`SELECT COUNT(*) AS count FROM leads l WHERE ${whereSql}`).bind(...binds),
  ]);
  const rows = (rowsResult.results ?? []) as LeadListRow[];
  const count = (countResult.results?.[0] ?? null) as CountRow | null;
  return {
    leads: rows.map((row) => ({
      id: row.id,
      name: row.name,
      platform: row.platform,
      subject: row.subject,
      status: row.status,
      funnelStage: row.funnel_stage,
      qualification: row.qualification,
      duplicateState: row.duplicate_state,
      responseDate: row.response_date,
      nextAction: row.next_action,
      nextContactAt: row.next_contact_at === null ? null : Number(row.next_contact_at),
      archivedAt: row.archived_at === null ? null : Number(row.archived_at),
    })),
    total: Number(count?.count ?? 0),
    offset: options.offset,
  };
}

function buildWhere(userId: string, options: LeadListOptions, now: number) {
  const where: string[] = ['l.user_id=?'];
  const binds: BindValue[] = [userId];
  if (options.view === 'archived') where.push('l.archived_at IS NOT NULL');
  else where.push('l.archived_at IS NULL');

  if (options.view === 'overdue') {
    where.push("l.next_contact_at IS NOT NULL AND l.next_contact_at<? AND trim(l.next_action)<>''");
    binds.push(now);
  }
  if (options.view === 'responses') where.push(responseExistsSql());
  if (options.view === 'curator') where.push(curatorExistsSql());
  if (options.view === 'needs-details')
    where.push("(l.needs_details=1 OR l.funnel_stage='clarification')");

  const rawSearch = options.search.trim();
  if (rawSearch) {
    const normalizedSearch = rawSearch.toLocaleLowerCase('uk-UA');
    const variants = searchVariants(rawSearch);
    const searchSql: string[] = [];
    const searchBinds: BindValue[] = [];
    const addVariants = (expression: string) => {
      searchSql.push(`(${variants.map(() => `instr(${expression},?)>0`).join(' OR ')})`);
      searchBinds.push(...variants);
    };

    addVariants("l.name || ' ' || l.subject || ' ' || l.note || ' ' || l.teacher_name || ' ' || l.next_action");
    searchSql.push('instr(lower(l.telegram_username),?)>0');
    searchBinds.push(normalizedSearch);
    searchSql.push('instr(lower(l.platform),?)>0');
    searchBinds.push(normalizedSearch);
    searchSql.push('instr(lower(l.source_chat_link),?)>0');
    searchBinds.push(normalizedSearch);
    searchSql.push('instr(lower(l.status),?)>0');
    searchBinds.push(normalizedSearch);
    searchSql.push('instr(lower(l.funnel_stage),?)>0');
    searchBinds.push(normalizedSearch);

    const lessonVariantSql = variants.map(() => `instr(x.teacher_name || ' ' || x.student_name || ' ' || x.subject,?)>0`).join(' OR ');
    searchSql.push(`EXISTS (
      SELECT 1 FROM lessons x
      WHERE x.user_id=l.user_id AND x.lead_id=l.id AND (${lessonVariantSql})
    )`);
    searchBinds.push(...variants);

    const studentVariantSql = variants.map(() => `instr(s.name || ' ' || s.surname || ' ' || s.note,?)>0`).join(' OR ');
    searchSql.push(`EXISTS (
      SELECT 1 FROM students s
      WHERE s.user_id=l.user_id AND s.lead_id=l.id AND (${studentVariantSql})
    )`);
    searchBinds.push(...variants);

    const phoneSearch = rawSearch.replace(/\D/g, '');
    if (phoneSearch.length >= 4) {
      searchSql.push('instr(l.normalized_phone,?)>0');
      searchBinds.push(phoneSearch);
    }
    const telegramSearch = normalizedSearch
      .replace(/^@/, '')
      .replace(/^https?:\/\/(?:www\.)?t\.me\//, '')
      .split(/[/?#]/, 1)[0] ?? '';
    if (telegramSearch) {
      searchSql.push('instr(l.normalized_telegram,?)>0');
      searchBinds.push(telegramSearch);
    }

    for (const alias of leadSearchAliases(normalizedSearch)) {
      if (alias === 'response') searchSql.push(responseExistsSql());
      if (alias === 'clarification') searchSql.push("(l.funnel_stage='clarification' OR l.needs_details=1)");
      if (alias === 'booked') searchSql.push(`(l.funnel_stage='booked' OR EXISTS (
        SELECT 1 FROM lessons b WHERE b.user_id=l.user_id AND b.lead_id=l.id AND b.status='booked'
      ))`);
      if (alias === 'reminder') searchSql.push(`(l.funnel_stage='reminder' OR EXISTS (
        SELECT 1 FROM lessons rl JOIN lesson_reminders rr ON rr.lesson_id=rl.id AND rr.user_id=rl.user_id
        WHERE rl.user_id=l.user_id AND rl.lead_id=l.id AND rr.enabled=1 AND rr.sent_at IS NULL AND rr.skipped_at IS NULL
      ))`);
      if (alias === 'lesson') searchSql.push(`(l.funnel_stage='lesson' OR EXISTS (
        SELECT 1 FROM lessons ls WHERE ls.user_id=l.user_id AND ls.lead_id=l.id
      ))`);
      if (alias === 'result') searchSql.push("l.funnel_stage='result'");
      if (alias === 'curator') searchSql.push(curatorExistsSql());
      if (alias === 'new') searchSql.push("l.status='new'");
      if (alias === 'active') searchSql.push("l.status='active'");
      if (alias === 'won') searchSql.push("l.status='won'");
      if (alias === 'lost') searchSql.push("l.status='lost'");
    }
    where.push(`(${searchSql.join(' OR ')})`);
    binds.push(...searchBinds);
  }
  return { sql: where.join(' AND '), binds };
}

function searchVariants(value: string): string[] {
  const trimmed = value.trim();
  const lower = trimmed.toLocaleLowerCase('uk-UA');
  const upper = lower.toLocaleUpperCase('uk-UA');
  const title = lower
    .split(/(\s+)/)
    .map((part) => part.trim() ? `${part.charAt(0).toLocaleUpperCase('uk-UA')}${part.slice(1)}` : part)
    .join('');
  return [...new Set([trimmed, lower, upper, title])];
}

function responseExistsSql() {
  return `EXISTS (
    SELECT 1 FROM activity_events e
    WHERE e.user_id=l.user_id AND e.lead_id=l.id
      AND e.event_type='lead_created' AND e.cancelled_at IS NULL
  )`;
}

function curatorExistsSql() {
  return `EXISTS (
    SELECT 1 FROM curator_requests c
    WHERE c.user_id=l.user_id AND c.lead_id=l.id AND c.status='pending'
  )`;
}
