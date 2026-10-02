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
  const workflowFilter = reviewQueue ? `c.workflow_status IN ('waiting','ready') AND ?3='profile_review'` : 'c.workflow_status=?3';
  const profileFilter = reviewQueue || input.needsReview ? ` AND (p.review_status IS NULL OR p.review_status!='confirmed')` : '';
  const accountFilter = input.platform === 'telegram' ? ` AND (c.telegram_account_id=?7 OR (c.telegram_account_id IS NULL AND c.workflow_status='to_join'))` : '';
  // profile_review spans two statuses; `+` keeps the planner on the (platform, status) index instead of
  // walking the owner's whole updated_at index to avoid a sort over that one queue.
  const orderColumn = reviewQueue ? '+c.updated_at' : 'c.updated_at';
  return db.prepare(`SELECT ${CHAT_LIST_COLUMNS()},(SELECT dc.decision FROM chat_discovery_candidates dc WHERE dc.user_id=c.user_id AND dc.imported_chat_id=c.id AND dc.id NOT LIKE 'waiting-%' ORDER BY dc.updated_at DESC,dc.id LIMIT 1) AS discovery_decision,(SELECT wa.id FROM whatsapp_autopost_jobs wa WHERE wa.user_id=c.user_id AND wa.chat_id=c.id AND wa.published_on=?4 AND wa.status IN ('pending','claimed') ORDER BY wa.created_at DESC LIMIT 1) AS autopost_job_id,EXISTS(SELECT 1 FROM chat_publications cp WHERE cp.user_id=c.user_id AND cp.chat_id=c.id AND cp.published_on=?4) AS published_today FROM chats c LEFT JOIN chat_profiles p ON p.chat_id=c.id WHERE c.user_id=?1 AND c.platform=?2 AND ${workflowFilter}${profileFilter}${accountFilter} AND ?5>=0 ORDER BY ${orderColumn} DESC,c.id LIMIT 50 OFFSET ?6`)
    .bind(input.userId, input.platform, input.status, input.today, input.now, input.offset, ...(input.accountId ? [input.accountId] : []));
}
