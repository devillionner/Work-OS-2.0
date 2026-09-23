export const CHAT_LEAVE_CHECKLIST_PLATFORMS = ['telegram', 'whatsapp', 'viber'] as const;

export function supportsChatLeaveChecklist(platform: string) {
  return (CHAT_LEAVE_CHECKLIST_PLATFORMS as readonly string[]).includes(platform);
}
