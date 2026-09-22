export type DiscoveryMembershipState = 'not_checked' | 'pending' | 'joined' | 'left';

export function discoveryMembershipStatement(db: D1Database, input: {
  userId: string;
  chatId: string;
  eventId: string;
  membershipState: DiscoveryMembershipState;
  now: number;
  resetInspection?: boolean;
}) {
  const resetInspection = Number(input.resetInspection === true);
  return db.prepare(`UPDATE chat_discovery_candidates
    SET membership_state=?1,
        checked_at=CASE WHEN ?6 THEN NULL ELSE checked_at END,
        member_count=CASE WHEN ?6 THEN NULL ELSE member_count END,
        chat_type=CASE WHEN ?6 THEN 'unknown' ELSE chat_type END,
        activity_state=CASE WHEN ?6 THEN 'unknown' ELSE activity_state END,
        topic_match=CASE WHEN ?6 THEN 'unknown' ELSE topic_match END,
        can_write=CASE WHEN ?6 THEN NULL ELSE can_write END,
        ads_policy=CASE WHEN ?6 THEN 'unknown' ELSE ads_policy END,
        access_state=CASE WHEN ?6 THEN 'unknown' ELSE access_state END,
        inspection_state=CASE WHEN ?6 THEN 'not_checked' ELSE inspection_state END,
        decision=CASE
          WHEN ?6 THEN 'review'
          WHEN ?1<>'joined' AND decision='target' THEN 'review'
          WHEN ?1='joined' AND decision='review' AND reason_codes_json='["unknown_membership"]' THEN 'target'
          ELSE decision END,
        reason_codes_json=CASE
          WHEN ?6 THEN '["unknown_chat_type","unknown_member_count","unknown_topic_match","unknown_can_write","unknown_ads_allowed","unknown_activity","unknown_membership","unknown_inspection","unknown_access"]'
          WHEN ?1<>'joined' AND decision='target' THEN '["unknown_membership"]'
          WHEN ?1='joined' AND decision='review' AND reason_codes_json='["unknown_membership"]' THEN '["all_required_confirmed"]'
          WHEN ?1='joined' AND decision='review' AND EXISTS(
            SELECT 1 FROM json_each(reason_codes_json) WHERE value='unknown_membership'
          ) THEN (
            SELECT COALESCE(json_group_array(value),'[]') FROM (
              SELECT value FROM json_each(reason_codes_json)
              WHERE value<>'unknown_membership' ORDER BY CAST(key AS INTEGER)
            )
          )
          ELSE reason_codes_json END,
        updated_at=?2,version=version+1
    WHERE user_id=?3 AND imported_chat_id=?4
      AND EXISTS(SELECT 1 FROM activity_events
        WHERE id=?5 AND user_id=?3 AND chat_id=?4 AND event_type='chat_state_changed')`)
    .bind(input.membershipState, input.now, input.userId, input.chatId, input.eventId, resetInspection);
}

export function discoveryMembershipForTransition(action: string): DiscoveryMembershipState | null {
  if (action === 'waiting') return 'pending';
  if (action === 'joined' || action === 'approved') return 'joined';
  if (action === 'restore' || action === 'return_to_join' || action === 'failed') return 'not_checked';
  return null;
}
