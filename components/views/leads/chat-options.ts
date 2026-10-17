export type ChatOptionRow = { id: string; name: string; platform: string; status: string; link: string };

const KEEP_MS = 10 * 60 * 1000;
let cache: { at: number; promise: Promise<ChatOptionRow[]> } | null = null;

/**
 * Усі чати Work OS одним запитом на сесію: пошук у полі «Чат-джерело» іде в браузері, тож кожна літера не б'є по базі.
 * Кеш живе кілька хвилин; `force` перечитує список (новий чат, доданий щойно).
 */
export function loadChatOptions(force = false): Promise<ChatOptionRow[]> {
  if (!force && cache && Date.now() - cache.at < KEEP_MS) return cache.promise;
  const promise = fetch('/api/leads/chat-options', { cache: 'no-store' }).then(async (response) => {
    const body = await response.json().catch(() => ({})) as { chats?: ChatOptionRow[]; error?: string };
    if (!response.ok || !body.chats) throw new Error(body.error || 'Не вдалося завантажити список чатів.');
    return body.chats;
  });
  cache = { at: Date.now(), promise };
  promise.catch(() => { if (cache?.promise === promise) cache = null; });
  return promise;
}
