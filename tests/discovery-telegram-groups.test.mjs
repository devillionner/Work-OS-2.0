import assert from 'node:assert/strict';
import test from 'node:test';

import {
  TELEGRAM_MIN_ACTION_GAP_MS,
  TELEGRAM_PARALLEL_TABS,
  TelegramStopped,
  TelegramWebSession,
  classifyTelegramSearchStatus,
  completeWhatsappInvites,
  createTelegramPacer,
  isTelegramFloodText,
  parseTelegramMemberCount,
  telegramActionPauseMs,
} from '../scripts/telegram-web-cdp.mjs';
import { telegramGroupDiscoveryPlan, telegramGroupSource, telegramPublicUsername } from '../scripts/chat-discovery-source-crawl.mjs';
import {
  archiveLocalDiscoveryOutcomes,
  previewTelegramDiscoveryText,
  readDiscoveryTelegramGroupSources,
} from '../lib/chat-discovery/local-preview.ts';
import { localDatabase, seedChat } from './helpers/local-d1.mjs';

// Operator decision 2026-10-02: Discovery sources are public Telegram GROUPS (not channels) searched in the
// operator's Telegram Web; results stay local until «Підтвердити» / «Архівувати всі».

const seedData = {
  cities: [{ country: 'Іспанія', uk: 'Валенсія', name: 'Valencia', population: 800000 }],
  keywords: ['Українці в місті (назва міста)', 'Барахолка + назва міста', 'Мамочки + назва міста', 'Перевезення + назва міста або країни'],
};

void test('Telegram search results: groups are sources, channels are not', () => {
  assert.equal(classifyTelegramSearchStatus('21,565 members'), 'group');
  assert.equal(classifyTelegramSearchStatus('1 234 учасники'), 'group');
  assert.equal(classifyTelegramSearchStatus('11,366 subscribers'), 'channel');
  assert.equal(classifyTelegramSearchStatus('5 тис. підписників'), 'channel');
  assert.equal(classifyTelegramSearchStatus('last seen recently'), 'other');
  assert.equal(parseTelegramMemberCount('21,565 members'), 21565);
  assert.equal(parseTelegramMemberCount('1.2K members'), 1200);
  assert.equal(parseTelegramMemberCount('21 565 учасників'), 21565);
  assert.equal(parseTelegramMemberCount('1,5 тис. учасників'), 1500);
});

void test('only complete WhatsApp invites are taken from a search snippet; cut ones need the full message', () => {
  assert.deepEqual(completeWhatsappInvites('WhatsApp: https://chat.whatsapp.com/JTAo6UK2NfYKcrCV4pAVu9 YouTube: …'), ['https://chat.whatsapp.com/JTAo6UK2NfYKcrCV4pAVu9']);
  assert.deepEqual(completeWhatsappInvites('група https://chat.whatsapp.com/JTAo6UK2Nf…'), []);
  assert.deepEqual(completeWhatsappInvites('група https://chat.whatsapp.com/JTAo6UK2NfYKcr...'), []);
  assert.deepEqual(completeWhatsappInvites('chat.whatsapp.com/invite/AbCdEfGhIjKlMnOpQrSt12 and https://whatsapp.com/channel/0029VbBatFA4yltFo4420Z2Q'),
    ['https://chat.whatsapp.com/AbCdEfGhIjKlMnOpQrSt12']);
});

void test('Telegram rate limits are recognised so the run stops instead of hammering the account', () => {
  assert.equal(isTelegramFloodText('Too many requests. Please try again later.'), true);
  assert.equal(isTelegramFloodText('Забагато спроб. Повторіть спробу пізніше'), true);
  assert.equal(isTelegramFloodText('Українці Валенсія'), false);
  const pauses = [0, 0.5, 0.999].map(value => telegramActionPauseMs(() => value));
  assert.ok(pauses.every(ms => ms >= 4000 && ms < 8000));
});

// Operator decision 2026-10-06: four tabs of the SAME Telegram account scan in parallel. The flood limit
// belongs to the account, so the tabs book their request-shaped actions in one shared pacer; otherwise four
// tabs would simply quadruple the request rate the pauses above exist to keep down.
void test('the shared pacer spaces parallel tabs so the account sees one action per gap', () => {
  let now = 1_000;
  const reserve = createTelegramPacer(2_500, () => now);
  // Four tabs booking at the same instant are spread across the gap instead of firing together.
  assert.deepEqual([reserve(), reserve(), reserve(), reserve()], [0, 2_500, 5_000, 7_500]);
  // A tab that arrives after the queue drained waits for nobody.
  now = 20_000;
  assert.equal(reserve(), 0);
  assert.equal(reserve(), 2_500);
  // Four tabs at the default gap stay slower than one tab's own 4–8 s pause would be on its own.
  assert.ok(TELEGRAM_MIN_ACTION_GAP_MS * TELEGRAM_PARALLEL_TABS >= 8_000,
    'four paced tabs must not exceed the request rate a single unpaced tab produced');
});

void test('a paced action waits for its slot and still ends on Stop', async () => {
  let stopped = false;
  const session = new TelegramWebSession({ close() {} }, () => 0, () => stopped, { reserveSlot: () => 5_000 });
  setTimeout(() => { stopped = true; }, 200);
  const startedAt = Date.now();
  await assert.rejects(session.paced(), (error) => error instanceof TelegramStopped);
  assert.ok(Date.now() - startedAt < 800, `paced() held for ${Date.now() - startedAt} ms instead of releasing on Stop`);
});

void test('joined Telegram chats become sources only through a public username', () => {
  assert.equal(telegramPublicUsername('https://t.me/espanolukraine'), 'espanolukraine');
  assert.equal(telegramPublicUsername('https://t.me/s/espana_ucrania'), 'espana_ucrania');
  assert.equal(telegramPublicUsername('https://t.me/+AbCdEf123'), null);
  assert.equal(telegramPublicUsername('https://t.me/joinchat/AbCdEf123'), null);
  assert.equal(telegramPublicUsername('https://t.me/some_helper_bot'), null);
  assert.equal(telegramPublicUsername('https://chat.whatsapp.com/abc'), null);
});

void test('the plan alternates Telegram searches with joined groups and drops the web-only word WhatsApp', () => {
  const plan = telegramGroupDiscoveryPlan(seedData, [
    { link: 'https://t.me/espanolukraine', name: 'Українці в Іспанії' },
    { link: 'https://t.me/+private', name: 'Приватна' },
    { link: 'https://t.me/a_group_one', name: 'A' },
    { link: 'https://t.me/a_group_two', name: 'B' },
    { link: 'https://t.me/a_group_three', name: 'C' },
    { link: 'https://t.me/ESPANOLUKRAINE', name: 'Дубль' },
  ]);
  assert.equal(plan[0].kind, 'search');
  assert.equal(plan[1].kind, 'joined');
  assert.deepEqual(plan[1].groups.map(group => group.username), ['espanolukraine', 'a_group_one', 'a_group_two']);
  assert.deepEqual(plan[3].groups.map(group => group.username), ['a_group_three']);
  const queries = plan.filter(step => step.kind === 'search').map(step => step.query);
  assert.ok(queries.length > 3);
  assert.ok(queries.every(query => !/whatsapp/iu.test(query)));
  const normalized = queries.map(query => query.toLocaleLowerCase('uk-UA').split(' ').sort().join(' '));
  assert.equal(new Set(normalized).size, normalized.length, 'reordered duplicates are searched once');
  assert.ok(queries.some(query => /Барахолка Валенсія/u.test(query)));
});

void test('a scanned group becomes one Telegram source for the Work OS preview', () => {
  assert.equal(telegramGroupSource({ username: 'x', title: 'X', invites: [] }), null);
  const source = telegramGroupSource({ username: 'espanolukraine', title: 'Українці в Іспанії', invites: [
    { link: 'https://chat.whatsapp.com/JTAo6UK2NfYKcrCV4pAVu9', text: 'Приєднуйтесь до нашої спільноти українців в Іспанії!' },
  ] }, { query: 'Українці Іспанія', place: 'Іспанія' });
  assert.equal(source.sourceUrl, 'https://t.me/espanolukraine');
  assert.equal(source.seedLabel, 'Іспанія');
  assert.match(source.text, /chat\.whatsapp\.com\/JTAo6UK2NfYKcrCV4pAVu9/);
});

async function discoveryRowCounts(db) {
  const [candidates, sources, chats] = await Promise.all([
    db.prepare('SELECT COUNT(*) n FROM chat_discovery_candidates').first('n'),
    db.prepare('SELECT COUNT(*) n FROM chat_discovery_sources').first('n'),
    db.prepare('SELECT COUNT(*) n FROM chats').first('n'),
  ]);
  return { candidates, sources, chats };
}

void test('searching Telegram sources reads D1 for dedupe but never writes it', async (t) => {
  const db = await localDatabase(t);
  const before = await discoveryRowCounts(db);
  const preview = await previewTelegramDiscoveryText(db, 'u', {
    text: 'Українці в Іспанії, чат WhatsApp: https://chat.whatsapp.com/JTAo6UK2NfYKcrCV4pAVu9',
    sourceUrl: 'https://t.me/espanolukraine', sourceTitle: 'Українці в Іспанії', query: 'Українці Іспанія', seedLabel: 'Іспанія',
  }, 1_800_000_000);
  assert.equal(preview.previews.length, 1);
  assert.equal(preview.previews[0].localOnly, true);
  assert.deepEqual(await discoveryRowCounts(db), before);
});

const nonTarget = (code, decision = 'rejected', reasons = ['too_few_members']) => ({
  platform: 'whatsapp', link: `https://chat.whatsapp.com/${code}`, name: code,
  sources: [{ kind: 'telegram_global', sourceUrl: 'https://t.me/espanolukraine', sourceTitle: 'Українці в Іспанії', query: 'q', seedLabel: 'Іспанія', seedKind: 'telegram_chat', context: '' }],
  outcome: { decision, reasonCodes: reasons, result: { status: 'inspected', memberCount: 120, chatType: 'group', accessible: true } },
});

void test('«Архівувати всі» writes every non-target in one D1 batch and refuses targets', async (t) => {
  const db = await localDatabase(t);
  let batches = 0;
  const counted = new Proxy(db, { get(target, property) {
    if (property === 'batch') return statements => { batches += 1; return target.batch(statements); };
    const value = target[property];
    return typeof value === 'function' ? value.bind(target) : value;
  } });
  const archived = await archiveLocalDiscoveryOutcomes(counted, 'u', { items: [
    nonTarget('AaaaaaaaaaaaaaaaaaaaA1'),
    nonTarget('AaaaaaaaaaaaaaaaaaaaA2', 'skipped', ['approval_required']),
    nonTarget('AaaaaaaaaaaaaaaaaaaaA3', 'unavailable', ['invalid_whatsapp_link']),
    nonTarget('AaaaaaaaaaaaaaaaaaaaA1'),
  ] }, 1_800_000_000);
  assert.equal(archived.archived, 3);
  assert.equal(batches, 1);
  const rows = (await db.prepare('SELECT link,decision,reason_codes_json FROM chat_discovery_candidates ORDER BY link').all()).results;
  assert.deepEqual(rows.map(row => row.decision), ['rejected', 'rejected', 'unavailable']);
  assert.equal(await db.prepare('SELECT COUNT(*) n FROM chat_discovery_sources').first('n'), 3);
  await assert.rejects(() => archiveLocalDiscoveryOutcomes(db, 'u', { items: [nonTarget('AaaaaaaaaaaaaaaaaaaaB1', 'target', [])] }, 1), /лише нецільові/u);
  await assert.rejects(() => archiveLocalDiscoveryOutcomes(db, 'u', { items: [nonTarget('AaaaaaaaaaaaaaaaaaaaB2', 'review', [])] }, 1), /лише нецільові/u);
  await assert.rejects(() => archiveLocalDiscoveryOutcomes(db, 'u', { items: Array.from({ length: 101 }, (_, i) => nonTarget(`Aaaaaaaaaaaaaaaaaaa${String(i).padStart(3, '0')}`)) }, 1), /до 100/u);
});

void test('archiving never overwrites a candidate the operator already imported', async (t) => {
  const db = await localDatabase(t);
  const link = 'https://chat.whatsapp.com/AaaaaaaaaaaaaaaaaaaaC1';
  await seedChat(db, { id: 'chat-1', platform: 'whatsapp', status: 'ready' });
  await db.prepare(`INSERT INTO chat_discovery_candidates(id,user_id,platform,name,link,normalized_link,discovered_at,created_at,updated_at,decision,imported_chat_id)
    VALUES ('kept','u','whatsapp','Kept',?1,?1,1,1,1,'target','chat-1')`).bind(link).run();
  await archiveLocalDiscoveryOutcomes(db, 'u', { items: [nonTarget('AaaaaaaaaaaaaaaaaaaaC1')] }, 2);
  assert.equal(await db.prepare("SELECT decision FROM chat_discovery_candidates WHERE id='kept'").first('decision'), 'target');
});

void test('joined Telegram groups of all accounts are read once per run, only live joined Telegram chats', async (t) => {
  const db = await localDatabase(t);
  await seedChat(db, { id: 'tg-ready', platform: 'telegram', status: 'ready', joined: 10 });
  await seedChat(db, { id: 'tg-waiting', platform: 'telegram', status: 'waiting', joined: 10 });
  await seedChat(db, { id: 'tg-not-joined', platform: 'telegram', status: 'waiting' });
  await seedChat(db, { id: 'tg-archived', platform: 'telegram', status: 'archived', joined: 10 });
  await seedChat(db, { id: 'wa-ready', platform: 'whatsapp', status: 'ready', joined: 10 });
  await seedChat(db, { id: 'tg-foreign', owner: 'other', platform: 'telegram', status: 'ready', joined: 10 });
  const { groups } = await readDiscoveryTelegramGroupSources(db, 'u');
  assert.deepEqual(groups.map(group => group.name).sort(), ['tg-ready', 'tg-waiting']);
});
