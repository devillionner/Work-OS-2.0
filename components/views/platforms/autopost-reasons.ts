/** Причини, з яких автопост у WhatsApp чи Viber не відправив повідомлення, людською мовою (коди дають адаптер на ПК і сервер). */
const REASONS: Record<string, string> = {
  viber_not_running: 'Viber не запущений. Запусти його на ПК.',
  accessibility_off: 'У Viber вимкнена доступність. Закрий Viber і відкрий його з ярлика «Viber»: у ярлику вже є потрібний параметр.',
  viber_window_unavailable: 'Вікно Viber недоступне. Відкрий Viber на ПК.',
  viber_language: 'Інтерфейс Viber має бути англійською. Зміни мову в налаштуваннях Viber.',
  viber_unsupported_platform: 'Автопост Viber працює лише на Linux-ПК, де запущений Viber.',
  my_notes_unavailable: 'Не вдалося відкрити «Мої нотатки» у Viber. Перевір, що вони стоять першою в «Обраних чатах».',
  input_not_set: 'Viber не прийняв вставлений текст. Прибери зайві вікна над Viber і повтори.',
  source_missing: 'У «Мої нотатки» немає нотатки з таким підписом. Надішли з телефона в «Мої нотатки» оголошення з фото й підписом.',
  forward_unavailable: 'Viber не показав кнопку пересилання біля нотатки. Пропущено без відправки.',
  invalid_viber_link: 'Посилання чату не підходить для автопосту: потрібне посилання виду invite.viber.com.',
  target_name_missing: 'У чату немає назви. Додай назву й повтори.',
  viber_chat_missing: 'Посилання на чат неактивне, або чат видалено.',
  viber_banned: 'Viber не пускає в цей чат.',
  viber_read_only: 'У цьому чаті писати можуть лише адміністратори.',
  viber_not_joined: 'Ти ще не приєднаний до цього чату, тож автопост його пропустив.',
  viber_transient_error: 'Viber показав тимчасову помилку. Повтори пізніше.',
  blocking_dialog: 'Viber показав діалог, який автопост не розпізнав. Пропущено без відправки.',
  target_unconfirmed: 'Не вдалося переконатися, що відкрито саме цей чат. Пропущено без відправки.',
  target_not_found: 'У вікні пересилання Viber немає чату з такою назвою. Перевір назву чату в Work OS.',
  target_ambiguous: 'У вікні пересилання кілька чатів із такою назвою. Пропущено, щоб не надіслати не туди.',
  avatar_mismatch: 'Аватар чату у вікні пересилання не збігається з відкритим чатом. Пропущено, щоб не надіслати не туди.',
  send_not_confirmed: 'Не вдалося підтвердити, що повідомлення з’явилось у чаті. Перевір чат вручну: автопост не повторює відправку, щоб не було дубля.',
  helper_timeout: 'Помічник Viber не відповів вчасно. Перевір чат вручну: повторної відправки не було.',
  helper_error: 'Помічник Viber завершився з помилкою. Перевір чат вручну: повторної відправки не було.',
  stale_precondition: 'Чат змінився до відправки (інша черга, публікація чи правила). Пропущено.',
  target_not_verified: 'Ціль не підтверджено. Пропущено без відправки.',
  adapter_failed: 'Автопост не зміг виконати відправку. Перевір чат вручну.',
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
};

export function batchSkipText(code: string): string { return BATCH_SKIP[code] || 'не пройшов перевірку'; }
