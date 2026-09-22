export type DiscoveryMembershipState = 'not_checked' | 'pending' | 'joined' | 'left';

export function discoveryMembershipStatement(db: D1Database, input: {
  userId: string;
  chatId: string;
  eventId: string;
  membershipState: DiscoveryMembershipState;
  now: number;
}) {
  return db.prepare(`UPDATE chat_discovery_candidates
    SET membership_state=?1,
        decision=CASE WHEN ?1<>'joined' AND decision='target' THEN 'review' ELSE decision END,
        reason_codes_json=CASE WHEN ?1<>'joined' AND decision='target' THEN '["unknown_membership"]' ELSE reason_codes_json END,
        updated_at=?2,version=version+1
    WHERE user_id=?3 AND imported_chat_id=?4
      AND EXISTS(SELECT 1 FROM activity_events
        WHERE id=?5 AND user_id=?3 AND chat_id=?4 AND event_type='chat_state_changed')`)
    .bind(input.membershipState, input.now, input.userId, input.chatId, input.eventId);
}

export function discoveryMembershipForTransition(action: string): DiscoveryMembershipState | null {
  if (action === 'waiting') return 'pending';
  if (action === 'joined' || action === 'approved') return 'joined';
  if (action === 'return_to_join' || action === 'failed') return 'not_checked';
  return null;
}
