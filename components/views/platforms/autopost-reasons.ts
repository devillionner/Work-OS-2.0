/** Причини, з яких автопост у WhatsApp чи Viber не відправив повідомлення, людською мовою (коди дають адаптер на ПК і сервер). */
const REASONS: Record<string, string> = {
  viber_unsupported_platform: 'Автопост Viber працює лише на Linux-ПК із Waydroid.',
  adb_missing: 'На ПК немає adb. Встанови пакет android-tools.',
  waydroid_missing: 'На ПК не встановлений Waydroid.',
  waydroid_not_running: 'Waydroid не запущений. Запусти його на ПК: waydroid session start.',
  waydroid_frozen: 'Контейнер Waydroid заморожений. Вимкни це: waydroid prop set persist.waydroid.suspend false і перезапусти сесію.',
  android_unreachable: 'Android у Waydroid недоступний для adb. Перезапусти сесію Waydroid.',
  android_unauthorized: 'Android не дозволив adb. У вікні Waydroid підтвердь «Allow USB debugging».',
  viber_not_installed: 'У Waydroid не встановлений Viber. Встанови його з Google Play.',
  viber_not_activated: 'Viber у Waydroid не активований. Відкрий його й активуй як додатковий пристрій.',
  viber_language: 'Мова Android у Waydroid має бути англійською.',
  adbkeyboard_missing: 'У Waydroid не встановлена клавіатура ADBKeyBoard: без неї підпис не ввести. Встанови її з adb install.',
  invalid_viber_link: 'Посилання чату не підходить для автопосту: потрібне посилання виду invite.viber.com.',
  target_name_missing: 'У чату немає назви. Додай назву й повтори.',
  viber_chat_missing: 'Посилання на чат неактивне, або чат видалено.',
  viber_banned: 'Viber не пускає в цей чат: акаунт заблоковано в ньому.',
  viber_read_only: 'У цьому чаті писати можуть лише адміни.',
  viber_not_joined: 'Автопост не зміг приєднатися до цього чату: кнопка вступу не подіяла. Перевір чат вручну.',
  blocking_dialog: 'Viber показав діалог, який автопост не розпізнав. Пропущено без відправки.',
  target_unconfirmed: 'Не вдалося переконатися, що відкрито саме цей чат (назва в Viber інша). Пропущено без відправки й без вступу.',
  target_not_found: 'У вікні відправки Viber немає чату з такою назвою серед останніх. Пропущено без відправки.',
  target_ambiguous: 'У вікні відправки Viber кілька чатів із такою назвою. Пропущено, щоб не надіслати не туди.',
  send_ui_unavailable: 'Viber не показав потрібний екран публікації (галерея, перегляд фото чи поле підпису). Пропущено без відправки.',
  image_missing: 'Немає фото для автопосту. Додай фото на вкладці «Автопост» у WhatsApp.',
  send_not_confirmed: 'Не вдалося підтвердити, що повідомлення з’явилось у чаті. Перевір чат вручну: автопост не повторює відправку, щоб не було дубля.',
  helper_timeout: 'Відправка не завершилась вчасно. Перевір чат вручну: повторної відправки не було.',
  helper_error: 'Адаптер Viber завершився з помилкою. Перевір чат вручну: повторної відправки не було.',
  android_error: 'Android у Waydroid не виконав крок відправки. Пропущено без відправки.',
  stale_precondition: 'Чат змінився до відправки (інша черга, публікація чи правила). Пропущено.',
  target_not_verified: 'Ціль не підтверджено. Пропущено без відправки.',
  adapter_failed: 'Автопост не зміг виконати відправку. Перевір чат вручну.',
  waydroid_suspend: 'У Waydroid увімкнене автозаморожування. Вимкни його: waydroid prop set persist.waydroid.suspend false.',
  message_not_found: 'Перевірено: до моменту відправки нашого повідомлення в чаті немає, тож дубля не буде.',
  // WhatsApp: ці коди приходять із браузерного адаптера.
  whatsapp_chat_missing: 'Група WhatsApp більше недоступна.',
  whatsapp_removed_from_group: 'Тебе вилучено з групи WhatsApp.',
  invalid_whatsapp_link: 'Запрошення WhatsApp недійсне або скинуте.',
  admin_only: 'У цій групі писати можуть лише адміни.',
  read_only: 'У цьому чаті немає поля для повідомлення.',
  approval_required: 'Адміни ще не прийняли заявку на вступ.',
  whatsapp_join_retry_later: 'WhatsApp просить повторити пізніше.',
  membership_not_confirmed: 'Не вдалося підтвердити, що ти в цій групі.',
  joined_target_not_verified: 'Не вдалося підтвердити, що відкрито саме цю групу.',
  media_send_not_confirmed: 'Фото відправлено, але WhatsApp не підтвердив доставку. Перевір чат вручну: повтору не було.',
  media_send_failed: 'WhatsApp показав помилку відправки фото. Перевір чат вручну.',
  send_failed: 'WhatsApp показав помилку відправки. Перевір чат вручну.',
  media_attach_failed: 'Не вдалося прикріпити фото.',
  media_preview_not_ready: 'WhatsApp не показав попередній перегляд фото.',
  media_caption_not_found: 'Не знайдено поле підпису до фото.',
  media_caption_mismatch: 'Підпис до фото вставився не повністю.',
  autopost_budget_exhausted: 'Не вистачило часу на відправку в цей чат.',
  publication_reconcile_failed: 'Повідомлення відправлено, але Work OS не записала публікацію. Перевір чат і додай публікацію вручну.',
  // Telegram: ці коди приходять із браузерного адаптера Telegram Web.
  thread_required: 'У чаті є гілки, а гілку для публікації ще не вибрано.',
  thread_closed: 'Вибрана гілка закрита або зникла. Вибери іншу.',
  telegram_chat_missing: 'Чат Telegram не існує, або посилання недійсне чи прострочене.',
  telegram_no_access: 'Акаунт Telegram не бачить цей чат (не учасник, вийшов або вилучений). Перевір чат вручну.',
  telegram_banned: 'Telegram не пускає в цей чат: акаунт заблоковано в ньому.',
  telegram_read_only: 'У цьому чаті Telegram писати можуть лише адміни.',
  telegram_slow_mode: 'У чаті Telegram увімкнений повільний режим, чат відкладено до завтра.',
  telegram_flood_wait: 'Telegram просить зачекати. Усю чергу Telegram поставлено на паузу.',
  telegram_send_failed: 'Telegram показав помилку відправки. Перевір чат вручну.',
  telegram_text_too_long: 'Текст оголошення довший за ліміт Telegram (4096 символів).',
  caption_too_long: 'Текст задовгий для підпису до фото в Telegram (до 1024 символів).',
  text_too_long: 'Текст довший за ліміт Telegram (4096 символів).',
  telegram_caption_too_long: 'Текст задовгий для підпису до фото в Telegram (до 1024 символів).',
  telegram_attachment_not_opened: 'Telegram Web не відкрив вікно вкладення з фото.',
  telegram_attachment_failed: 'Telegram Web показав помилку відправки фото. Перевір чат вручну.',
  telegram_page_not_ready: 'Telegram Web не завантажився.',
  telegram_chat_not_opened: 'Telegram Web не відкрив чат.',
  telegram_composer_not_found: 'Telegram Web не показав поле повідомлення.',
  telegram_text_mismatch: 'Текст у полі повідомлення Telegram не збігся з оголошенням.',
  telegram_thread_not_opened: 'Telegram Web не відкрив гілку чату.',
};

export function autopostReasonText(code: string | null | undefined): string {
  if (!code) return 'Автопост не зміг виконати відправку.';
  return REASONS[code] || 'Автопост не зміг виконати відправку. Перевір чат вручну.';
}

/** Чому чат не потрапив у партію (коди з відповіді запуску партії). */
const BATCH_SKIP: Record<string, string> = {
  profile_rule: 'правила профілю',
  no_advertisement: 'немає придатного оголошення',
  no_text: 'в оголошенні немає тексту',
  library_changed: 'оголошення змінилось',
  not_available: 'чат відкладено',
  discovery_not_target: 'чат ще не підтверджено як цільовий',
  already_published: 'уже опубліковано',
  already_queued: 'уже в черзі',
  rules_unavailable: 'не вдалося перевірити правила',
  chat_not_found: 'чат не знайдено',
  thread_required: 'не вибрано гілку',
  caption_too_long: 'текст задовгий для підпису до фото',
  text_too_long: 'текст довший за ліміт Telegram',
  in_schedule: 'чат стоїть у розкладі',
  wrong_account: 'чат іншого акаунта',
  account_disabled: 'акаунт вимкнено',
  account_missing: 'не вибрано акаунт',
};

export function batchSkipText(code: string): string { return BATCH_SKIP[code] || 'не пройшов перевірку'; }

/** Група причин для «Потребують рішення»: підпис, чи можна замість повтору «перевірити» (повідомлення могло піти). */
export type AutopostReasonGroup = { key: string; label: string; checkable: boolean; /** Повтор може дати дубль: потрібне підтвердження. */ risky?: boolean; /** Назву чату в Work OS можна оновити за назвою з месенджера. */ renameable?: boolean };
const GROUPS: Array<[string[], AutopostReasonGroup]> = [
  [['send_not_confirmed', 'helper_timeout', 'media_send_not_confirmed'], { key: 'unconfirmed', label: 'Не вдалося підтвердити', checkable: true, risky: true }],
  [['message_not_found'], { key: 'missing', label: 'Повідомлення не знайдено', checkable: true }],
  [['viber_banned', 'whatsapp_removed_from_group', 'membership_left', 'telegram_banned'], { key: 'blocked', label: 'Заблоковано в групі', checkable: false }],
  [['target_unconfirmed', 'target_not_found', 'target_ambiguous', 'joined_target_not_verified', 'target_not_verified'], { key: 'target', label: 'Не той чат', checkable: false, renameable: true }],
  [['viber_not_joined', 'membership_not_confirmed', 'approval_required', 'whatsapp_join_retry_later'], { key: 'join', label: 'Не вдалося приєднатися', checkable: false }],
  [['send_ui_unavailable', 'blocking_dialog', 'android_error', 'media_attach_failed', 'media_preview_not_ready', 'media_caption_not_found', 'media_caption_mismatch', 'media_send_failed', 'send_failed', 'telegram_send_failed', 'telegram_attachment_not_opened', 'telegram_attachment_failed', 'telegram_page_not_ready', 'telegram_chat_not_opened', 'telegram_composer_not_found', 'telegram_text_mismatch', 'telegram_thread_not_opened'], { key: 'screen', label: 'Збій екрана відправки', checkable: false }],
];
const OTHER_GROUP: AutopostReasonGroup = { key: 'other', label: 'Інше', checkable: false };
export function autopostReasonGroup(code: string | null | undefined): AutopostReasonGroup {
  return GROUPS.find(([codes]) => codes.includes(String(code)))?.[1] ?? OTHER_GROUP;
}

const MONTHS = ['січня', 'лютого', 'березня', 'квітня', 'травня', 'червня', 'липня', 'серпня', 'вересня', 'жовтня', 'листопада', 'грудня'];
/** «2026-10-21» → «21 жовтня». */
export function dayLabel(iso: string): string {
  const [, month, day] = iso.split('-').map(Number);
  return month >= 1 && month <= 12 ? `${day} ${MONTHS[month - 1]}` : iso;
}
