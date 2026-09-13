export const ARCHIVE_SUGGESTION_SNOOZE_COUNT = 3;

export function chatSnoozeCountSql(alias = 'c') {
  return `(SELECT COUNT(*) FROM activity_events se
    WHERE se.user_id=${alias}.user_id AND se.chat_id=${alias}.id
      AND se.event_type='chat_state_changed'
      AND json_extract(se.metadata_json,'$.action')='snooze')`;
}

export function shouldSuggestChatArchive(snoozeCount: number) {
  return Number.isFinite(snoozeCount) && snoozeCount >= ARCHIVE_SUGGESTION_SNOOZE_COUNT;
}
