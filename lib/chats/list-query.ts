import { chatSnoozeCountSql } from './snooze-history.ts';
import { chatLeftAtSql, chatStateTokenSql } from './state.ts';

export const CHAT_LIST_COLUMNS = () => `c.id,c.name,c.link,c.platform,c.workflow_status,c.joined_at,c.snoozed_until,c.archive_reason,c.archived_at,${chatSnoozeCountSql()} AS snooze_count,${chatLeftAtSql()} AS left_at,c.telegram_account_id,${chatStateTokenSql()} AS state_token,p.review_status AS profile_status,p.language AS profile_language,p.cadence AS profile_cadence,p.weekdays_json AS profile_weekdays,p.custom_interval_days AS profile_custom_interval_days,p.next_allowed_on AS profile_next_allowed_on,p.directions_json AS profile_directions,p.note AS profile_note`;

// One page (50) of a platform queue. The status must stay a plain equality/IN on the column so the
// (user_id, platform, workflow_status, updated_at) index drives it: the former
// `(?3='profile_review' AND …) OR c.workflow_status=?3` walked every chat of the owner (≈6 000 rows per page).
export function chatListPageStatement(db: D1Database, input: {
  userId: string; platform: string; status: string; needsReview: boolean; today: string; now: number; offset: number; accountId: string | null;
}) {
  const reviewQueue = input.status === 'profile_review';
  const workflowFilter = 'c.workflow_status=?3';
  const profileFilter = reviewQueue || input.needsReview ? ` AND (p.review_status IS NULL OR p.review_status!='confirmed')` : '';
  const accountFilter = input.platform === 'telegram' ? ` AND (c.telegram_account_id=?7 OR (c.telegram_account_id IS NULL AND c.workflow_status='to_join'))` : '';
  const columns = `${CHAT_LIST_COLUMNS()},(SELECT dc.decision FROM chat_discovery_candidates dc WHERE dc.user_id=c.user_id AND dc.imported_chat_id=c.id AND dc.id NOT LIKE 'waiting-%' ORDER BY dc.updated_at DESC,dc.id LIMIT 1) AS discovery_decision,(SELECT wa.id FROM whatsapp_autopost_jobs wa WHERE wa.user_id=c.user_id AND wa.chat_id=c.id AND wa.published_on=?4 AND wa.status IN ('pending','claimed') ORDER BY wa.created_at DESC LIMIT 1) AS autopost_job_id,EXISTS(SELECT 1 FROM chat_publications cp WHERE cp.user_id=c.user_id AND cp.chat_id=c.id AND cp.published_on=?4) AS published_today`;
  // A single-status queue comes out of the (platform, status, updated_at) index already sorted, so
  // LIMIT stops early and the per-chat subqueries run for the 50 page rows only. The review queue spans
  // two statuses and must be sorted, and inlined that evaluated all eight subqueries for every chat of
  // the queue before sorting: measured 4 003 rows for a 400-chat queue, ≈3 400 per call on staging
  // (d1 insights, 2026-10-04). There the page ids are picked from the index first and materialized.
  // Each status arm walks its own index range in order and stops after offset+50 rows; merging the two
  // sorted arms gives the same page as one sort over the whole queue.
  const reviewBranch = (status: 'waiting' | 'ready') => `SELECT * FROM (SELECT c.id,c.updated_at FROM chats c LEFT JOIN chat_profiles p ON p.chat_id=c.id WHERE c.user_id=?1 AND c.platform=?2 AND c.workflow_status='${status}' AND ?3='profile_review'${profileFilter}${accountFilter} AND ?5>=0 ORDER BY c.updated_at DESC,c.id LIMIT ?6+50)`;
  const sql = reviewQueue
    ? `WITH page AS MATERIALIZED (SELECT id FROM (${reviewBranch('waiting')} UNION ALL ${reviewBranch('ready')}) ORDER BY updated_at DESC,id LIMIT 50 OFFSET ?6) SELECT ${columns} FROM page CROSS JOIN chats c ON c.id=page.id LEFT JOIN chat_profiles p ON p.chat_id=c.id WHERE c.user_id=?1 ORDER BY c.updated_at DESC,c.id`
    : `SELECT ${columns} FROM chats c LEFT JOIN chat_profiles p ON p.chat_id=c.id WHERE c.user_id=?1 AND c.platform=?2 AND ${workflowFilter}${profileFilter}${accountFilter} AND ?5>=0 ORDER BY c.updated_at DESC,c.id LIMIT 50 OFFSET ?6`;
  return db.prepare(sql)
    .bind(input.userId, input.platform, input.status, input.today, input.now, input.offset, ...(input.accountId ? [input.accountId] : []));
}
