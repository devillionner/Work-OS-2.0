// Guard both the incoming parent and every row an import upsert can replace.
// These statements run in the SAME D1 batch as the upsert and job cursor.
export function legacyLeadGuards(
  db: D1Database,
  phase: string,
  value: object,
  userId: string,
): D1PreparedStatement[] {
  const tables: Record<string, string> = {
    leads: 'leads',
    students: 'students',
    lessons: 'lessons',
    curatorRequests: 'curator_requests',
    events: 'activity_events',
  };
  const row = value as {
    id?: string;
    leadId?: string | null;
    legacyId?: string | null;
    sourceKey?: string;
  };
  const table = tables[phase];
  if (!table) return [];
  const leadId = phase === 'leads' ? row.id : row.leadId;
  const result: D1PreparedStatement[] = [];
  if (leadId)
    result.push(
      db
        .prepare('INSERT INTO lead_import_guards(lead_id,user_id) VALUES (?,?)')
        .bind(leadId, userId),
    );
  const parent = phase === 'leads' ? 'id' : 'lead_id';
  // Match all unique targets used by the importer, not just its proposed ID.
  const matches: Array<{ clause: string; params: (string | null)[] }> = [
    { clause: 'id=?2', params: [row.id ?? null] },
  ];
  if (phase === 'events')
    matches.push({ clause: 'source_key=?2', params: [row.sourceKey ?? null] });
  if (phase === 'lessons')
    matches.push({ clause: 'legacy_id=?2', params: [row.legacyId ?? null] });
  if (phase === 'students' || phase === 'curatorRequests')
    matches.push({
      clause: 'lead_id=?2 AND legacy_id=?3',
      params: [leadId ?? null, row.legacyId ?? null],
    });
  for (const match of matches)
    result.push(
      db
        .prepare(
          `INSERT INTO lead_import_guards(lead_id,user_id) SELECT ${parent},user_id FROM ${table} WHERE user_id=?1 AND ${parent} IS NOT NULL AND (${match.clause})`,
        )
        .bind(userId, ...match.params),
    );
  return result;
}
