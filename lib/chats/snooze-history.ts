export const ARCHIVE_SUGGESTION_SNOOZE_COUNT = 3;

export function shouldSuggestChatArchive(snoozeCount: number) {
  return Number.isFinite(snoozeCount) && snoozeCount >= ARCHIVE_SUGGESTION_SNOOZE_COUNT;
}
