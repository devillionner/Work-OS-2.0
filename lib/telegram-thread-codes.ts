/**
 * Коди збоїв Telegram, за якими чат міг виявитись форумом, який автопост вважав звичайним чатом (підвал «You can reply to messages in topics»):
 * вікно фото не відкрилось, поле повідомлення не знайшлось, гілка не відкрилась. Текст підвалу в результаті задачі не зберігається,
 * тому такий чат не вважається форумом сам: його перевіряє прохід гілок, і лише результат проходу (`telegram_forum`) вирішує, куди він піде.
 */
export const THREAD_SUSPECT_CODES: readonly string[] = ['telegram_attachment_not_opened', 'telegram_composer_not_found', 'telegram_thread_not_opened'];

/** Явні збої гілок: вони й так не потрапляють у «Потребують рішення» (`needs_thread`). */
export const THREAD_CODES: readonly string[] = ['thread_required', 'thread_closed'];
