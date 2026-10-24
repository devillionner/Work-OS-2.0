export const APP_VERSION = '3.2.32';
export const APP_RELEASE_DATE = '2026-10-24';

// User-facing copy only. Keep each note short and plain; technical details belong in docs and commits.
export const APP_CHANGES = [
  'Автопост WhatsApp знову розпізнає кнопку «Надіслати» у вікні фото: після оновлення WhatsApp Web усі чати зупинялись на «вікно фото не готове».',
  'Якщо WhatsApp Web не готовий (не залогінений, не додає фото), черга сама стає на паузу, а картка пояснює причину й час наступної спроби. Чати більше не мотаються по колу.',
  'Автопост у два рази менше навантажує базу: закриття вчорашніх задач і вибір наступної задачі читають кілька рядків замість сотень.',
] as const;
