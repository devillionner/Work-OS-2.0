import assert from 'node:assert/strict';
import test from 'node:test';

import {
  advanceAutonomousDiscoveryRun,
  cancelDiscoveryRun,
  continueDiscoveryRun,
  evaluateDiscoveryCandidate,
  handoffDiscoveryCandidate,
  ingestTelegramDiscovery,
  readDiscoveryWorkspace,
  readTelegramDiscoveryPlan,
  resetDiscoveryWorkspace,
  startDiscoveryRun,
} from '../lib/chat-discovery/domain.ts';
import { applyDiscoveryInspection } from '../lib/chat-discovery/inspection.ts';
import { assertDiscoveryExecutorLease, claimDiscoveryExecutorQueue, completeDiscoveryExternalLeave, readDiscoveryExecutorQueue } from '../lib/chat-discovery/executor.ts';
import { createWaitingCheckBatch, isWaitingCheckBatchActive, readEligibleWaitingChats, stopWaitingCheckBatch, waitingCheckStatusFromBatch } from '../lib/chats/whatsapp-waiting-check.ts';
import { buildTelegramSearchPlan, discoverPublicWeb, discoverTelegramPublic, extractInviteRecords, isLikelyUkrainianCommunity, safePublicUrl, telegramOlderPreviewUrl, telegramPublicChannelKey, telegramPublicPreviewUrl, telegramPublicSearchQueries } from '../lib/chat-discovery/public-web.ts';
import { inferLocalPreviewTopicMatch } from '../lib/chat-discovery/local-preview.ts';
import { changeChatLeave } from '../lib/chats/leave.ts';
import { readChatState } from '../lib/chats/state.ts';
import { transitionChat } from '../lib/chats/transitions.ts';
import { localDatabase } from './helpers/local-d1.mjs';

function html(body) {
  return new Response(body, { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}

void test('local preview falls back to a clean source label when extracted HTML name is noisy', async (t) => {
  const { searchLocalDiscoveryPreview } = await import('../lib/chat-discovery/local-preview.ts');
  const db = await localDatabase(t);
  const result = await searchLocalDiscoveryPreview(db,'u',{
    platforms:['whatsapp'],telegramCursor:0,sourceCursor:0,knownLinks:[],minMembers:700,
  },100,async (url) => {
    if(String(url).includes('uahelp.wiki/german-city-chats')) {
      return html('<li class="notion-list-item">ngen <a href="https://chat.whatsapp.com/CleanSourceName123">WhatsApp</a></li>');
    }
    return html('');
  });
  const item=result.previews.find(candidate=>candidate.link==='https://chat.whatsapp.com/CleanSourceName123');
  assert.ok(item);
  assert.doesNotMatch(item.name,/notion|ngen/i);
  assert.match(item.name,/Німеччина|UAHELP|WhatsApp/i);
});

void test('local preview relevance ignores the search query itself as evidence', () => {
  const noisySource = {
    kind:'telegram_global',
    sourceUrl:'https://search.brave.com/search?q=test',
    sourceTitle:'Telegram search · Париж',
    query:'Українці в Париж',
    seedLabel:'Париж',
    seedKind:'city',
    context:'Українці в Париж · Париж · Франція · Telegram · NOTÍCIAS E INFORMAÇÕES mercado financeiro. Whatsapp Grupo 14',
  };
  assert.equal(inferLocalPreviewTopicMatch('Telegram NOTÍCIAS mercado financeiro Whatsapp Grupo 14', [noisySource]), 'unknown');
  assert.equal(inferLocalPreviewTopicMatch('Українці Париж · барахолка та допомога', [noisySource]), 'match');
});

void test('public discovery extracts canonical WhatsApp/Viber invites and keeps provenance', async () => {
  const source = {
    sourceUrl: 'https://example.org/list',
    sourceTitle: 'Українці в Берліні',
    query: '"Berlin" українці',
    seedLabel: 'Берлін',
    seedKind: 'city',
    context: 'Українці Німеччина',
  };
  const records = extractInviteRecords(
    '<p>Українці Берлін · Барахолка https://chat.whatsapp.com/AbCdEf123</p>' +
      '<p>Допомога українцям https://invite.viber.com/?g2=Zm9vYmFy</p>',
    ['whatsapp', 'viber'],
    source,
  );
  assert.equal(records.length, 2);
  assert.equal(records[0].platform, 'whatsapp');
  assert.equal(records[0].link, 'https://chat.whatsapp.com/AbCdEf123');
  assert.match(records[0].source.context, /Українц/i);
  assert.equal(records[1].platform, 'viber');
  assert.match(records[1].link, /^https:\/\/invite\.viber\.com\/\?g2=/);
});

void test('search instructions cannot make unrelated WhatsApp invites look Ukrainian', () => {
  const syntheticSource = {
    kind:'telegram_global',
    sourceUrl:'https://search.brave.com/search?q=site%3At.me+Ukrainians+Berlin',
    sourceTitle:'Telegram search · Берлін',
    query:'Українці Берлін чат',
    seedLabel:'Берлін',
    seedKind:'city',
    context:'Українці Берлін · Німеччина · Telegram',
  };
  assert.equal(extractInviteRecords(
    '<article>روابط مجموعات واتساب https://chat.whatsapp.com/ArabicCatalog123</article>',
    ['whatsapp'],
    syntheticSource,
  ).length,0);
  assert.equal(extractInviteRecords(
    '<article>Українці Берлін · допомога та оголошення https://chat.whatsapp.com/UkrainianBerlin123</article>',
    ['whatsapp'],
    syntheticSource,
  ).length,1);
});

void test('Telegram discovery accepts only factual Ukrainian invite snippets from Brave and rejects unrelated catalogues', async () => {
  const calls=[];
  const result=await discoverTelegramPublic({cursor:0,maxQueries:1,pageLimit:1},async(url)=>{
    calls.push(String(url));
    if(String(url).includes('search.brave.com'))return html([
      '<section>روابط مجموعات واتساب https://chat.whatsapp.com/SearchArabicMustNotEmit123</section>',
      '<section>Українці Прага · зробили групу у WhatsApp https://chat.whatsapp.com/SearchUkrainianEmit123 <a href="https://t.me/s/prahaPD?before=10161">ДП Документ Прага</a></section>',
    ].join(''));
    if(String(url)==='https://t.me/s/prahaPD?before=10161')return html(
      '<article>Українці Прага · група https://chat.whatsapp.com/SearchUkrainianEmit123</article>'
    );
    return html('');
  });
  assert.equal(result.records.some(item=>item.link==='https://chat.whatsapp.com/SearchArabicMustNotEmit123'),false);
  assert.equal(result.records.some(item=>item.link==='https://chat.whatsapp.com/SearchUkrainianEmit123'),true);
  assert.ok(calls.includes('https://t.me/s/prahaPD?before=10161'));
});
void test('public discovery rejects generic and spam WhatsApp groups before persistence', () => {
  assert.equal(isLikelyUkrainianCommunity('Українці Berlin батьки community'), true);
  assert.equal(isLikelyUkrainianCommunity('Berlin expats international community'), false);
  assert.equal(isLikelyUkrainianCommunity('Українці Berlin crypto signals bitcoin'), false);

  const base = { sourceUrl:'https://example.org/list', sourceTitle:'Directory', query:'Berlin', seedLabel:'Berlin', seedKind:'city', context:'' };
  assert.equal(extractInviteRecords('International dating https://chat.whatsapp.com/Spam123', ['whatsapp'], base).length, 0);
  assert.equal(extractInviteRecords('Українці Berlin crypto signals https://chat.whatsapp.com/Spam456', ['whatsapp'], base).length, 0);
  assert.equal(extractInviteRecords('Українці Berlin батьки https://chat.whatsapp.com/Good123', ['whatsapp'], base).length, 1);
  assert.equal(extractInviteRecords('Українці Berlin батьки chat.whatsapp.com/Good456', ['whatsapp'], base)[0].link, 'https://chat.whatsapp.com/Good456');
});

void test('factual recent ad evidence can complete target qualification without manual ads confirmation', () => {
  assert.deepEqual(evaluateDiscoveryCandidate({
    chatType:'group',
    memberCount:1200,
    topicMatch:'match',
    canWrite:true,
    adsPolicy:'inferred_allowed',
    activityState:'active',
    membershipState:'joined',
    inspectionState:'inspected',
    accessState:'available',
    linkState:'valid',
  }), { decision:'target', reasonCodes:['all_required_confirmed'] });
});

void test('public discovery rejects local/literal hosts and searches a bounded seed batch', async () => {
  assert.equal(safePublicUrl('http://127.0.0.1/test'), false);
  assert.equal(safePublicUrl('http://localhost/test'), false);
  assert.equal(safePublicUrl('https://example.org/test'), true);

  const calls = [];
  const result = await discoverPublicWeb({
    platforms: ['whatsapp'],
    cursor: 0,
    maxQueries: 2,
    pageLimit: 0,
    includeCurated: false,
  }, async (url) => {
    calls.push(url);
    return html('<div>Українці Berlin барахолка https://chat.whatsapp.com/TestInvite123</div>');
  });
  assert.equal(result.searched, 2);
  assert.equal(calls.length, 2);
  assert.ok(result.totalTasks > 100);
  assert.equal(result.records.length, 2);
  assert.ok(result.records.every((item) => item.link === 'https://chat.whatsapp.com/TestInvite123'));
  assert.ok(result.records.every((item) => item.source.query.includes('українці')));
});

void test('local-first discovery starts with bounded Telegram batches and avoids the heavy curated bootstrap', async (t) => {
  const { searchLocalDiscoveryPreview } = await import('../lib/chat-discovery/local-preview.ts');
  const db = await localDatabase(t);
  const calls = [];
  const result = await searchLocalDiscoveryPreview(db,'u',{
    platforms:['whatsapp'],telegramCursor:0,sourceCursor:0,knownLinks:[],minMembers:700,
  },100,async (url) => {
    calls.push(String(url));
    if(String(url).includes('search.brave.com')) {
      return html('<a href="https://t.me/ua_bounded_source/42">source</a>');
    }
    if(String(url)==='https://t.me/s/ua_bounded_source/42') {
      return html('<p>Українці Berlin https://chat.whatsapp.com/TelegramBootstrap123</p>');
    }
    return html('');
  });
  assert.equal(result.source,'telegram');
  assert.ok(result.telegramCursor>0&&result.telegramCursor<=3);
  assert.equal(result.sourceCursor,0);
  assert.equal(calls.some(url=>url.includes('uahelp.wiki')||url.includes('deutschportal.info')),false);
  assert.equal(result.previews.some(item=>item.link==='https://chat.whatsapp.com/TelegramBootstrap123'),true);
});
void test('Telegram keyword plan is deterministic, bounded and resolves workbook placeholders', () => {
  const first = buildTelegramSearchPlan(0, 6);
  assert.equal(first.cursor, 0);
  assert.equal(first.tasks.length, 6);
  assert.ok(first.totalTasks > 1000);
  assert.equal(first.nextCursor, 6);
  assert.equal(first.done, false);
  assert.ok(first.tasks.every(task => task.query.length > 0));
  assert.ok(first.tasks.every(task => !/назва |\(назва| або країни| або міста/iu.test(task.query)));
  assert.equal(first.tasks[0].seedKind, 'city');
  assert.ok(first.tasks.some(task => task.cityLatin && task.cityLatin !== task.city));
  assert.ok(new Set(first.tasks.map(task => task.city)).size >= 2);
  const all = buildTelegramSearchPlan(0, 20);
  assert.ok(all.totalTasks > 1000);
  const sample = [
    ...buildTelegramSearchPlan(0, 20).tasks,
    ...buildTelegramSearchPlan(Math.floor(all.totalTasks / 2), 20).tasks,
    ...buildTelegramSearchPlan(Math.max(0, all.totalTasks - 20), 20).tasks,
  ];
  const seen = new Set();
  for (const task of sample) {
    const key = `${task.seedKind}|${task.country}|${task.city}|${task.template}`;
    assert.equal(seen.has(key), false, `duplicate Telegram task: ${key}`);
    seen.add(key);
  }

  const repeated = buildTelegramSearchPlan(0, 6);
  assert.deepEqual(repeated, first);
  const next = buildTelegramSearchPlan(first.nextCursor, 3);
  assert.equal(next.cursor, first.nextCursor);
  assert.ok(next.tasks.every(task => task.cursor >= first.nextCursor));
});

void test('Telegram public discovery broadens search only when the strict result lacks enough public sources', async () => {
  const task = buildTelegramSearchPlan(0,1).tasks[0];
  const queries=telegramPublicSearchQueries(task);
  assert.ok(queries.length>=2&&queries.length<=3);
  assert.match(queries[0],/site:t\.me\/s/);
  assert.match(queries[0],/chat\.whatsapp\.com/);
  assert.ok(queries.some(query=>query.includes(task.city)));
  if(task.cityLatin&&task.cityLatin!==task.city)assert.ok(queries.some(query=>query.includes(task.cityLatin)));
  assert.ok(queries.some(query=>/WhatsApp/i.test(query)));

  const calls = [];
  const result = await discoverTelegramPublic({cursor:0,maxQueries:1,pageLimit:2}, async (url) => {
    calls.push(String(url));
    if (String(url).includes('search.brave.com')) {
      const decoded=decodeURIComponent(String(url));
      if (decoded.includes('chat.whatsapp.com')) {
        return html('<a href="https://t.me/ua_source_one/42">one</a>');
      }
      return html('<a href="https://telegram.me/ua_source_two">two</a>');
    }
    if (String(url)==='https://t.me/s/ua_source_one/42') {
      return html('<article>Українці Berlin батьки https://chat.whatsapp.com/TelegramCoverageA123</article>');
    }
    if (String(url)==='https://t.me/s/ua_source_two') {
      return html('<article>Українці Berlin допомога https://chat.whatsapp.com/TelegramCoverageB123</article>');
    }
    return html('');
  });

  assert.equal(result.searched,1);
  assert.equal(result.errors,0);
  assert.ok(calls.filter(url=>url.includes('search.brave.com')).length>=2);
  assert.ok(calls.filter(url=>url.includes('search.brave.com')).length<=3);
  assert.ok(calls.includes('https://t.me/s/ua_source_one/42'));
  assert.ok(calls.includes('https://t.me/s/ua_source_two'));
  assert.deepEqual(new Set(result.records.map(item=>item.link)),new Set([
    'https://chat.whatsapp.com/TelegramCoverageA123',
    'https://chat.whatsapp.com/TelegramCoverageB123',
  ]));
});

void test('Telegram source ranking compares all query variants before fetching the single best source', async () => {
  const calls=[];
  let searchCall=0;
  const result=await discoverTelegramPublic({cursor:0,maxQueries:1,pageLimit:1},async(url)=>{
    calls.push(String(url));
    if(String(url).includes('search.brave.com')){
      searchCall+=1;
      if(searchCall===1)return html('<section><a href="https://t.me/s/ua_generic">Українці Berlin community</a></section>');
      if(searchCall===2)return html('<section><a href="https://t.me/s/ua_best?before=77">Українці Berlin 🇺🇦</a> WhatsApp chat.whatsapp.com</section>');
      return html('');
    }
    if(String(url)==='https://t.me/s/ua_best?before=77')return html(
      '<article>Українці Berlin · допомога https://chat.whatsapp.com/UkrainianBestSource123</article>'
    );
    throw new Error('lower-ranked Telegram source should not be fetched: '+url);
  });
  assert.ok(result.records.some(item=>item.link==='https://chat.whatsapp.com/UkrainianBestSource123'));
  assert.equal(calls.some(url=>url==='https://t.me/s/ua_generic'),false);
  assert.ok(calls.includes('https://t.me/s/ua_best?before=77'));
  assert.ok(searchCall>=2);
});
void test('high-intent Ukrainian templates outrank the bare-city Telegram query', () => {
  const first=buildTelegramSearchPlan(0,5).tasks;
  assert.equal(first.some(task=>task.template==='Просто назва міста'),false);
  assert.ok(first.some(task=>/Українці в місті/u.test(task.template)));
  assert.ok(first.some(task=>/Допомога українцям|Помощь украинцам/u.test(task.template)));
});

void test('Telegram public source budget is channel-deduplicated before page fetch', async () => {
  assert.equal(telegramPublicChannelKey('https://t.me/UA_Berlin/12'),'ua_berlin');
  assert.equal(telegramPublicChannelKey('https://telegram.me/ua_berlin/99'),'ua_berlin');
  assert.equal(telegramPublicChannelKey('https://t.me/+private'),null);

  const calls=[];
  const result=await discoverTelegramPublic({cursor:0,maxQueries:1,pageLimit:2},async(url)=>{
    calls.push(String(url));
    if(String(url).includes('search.brave.com'))return html([
      '<a href="https://t.me/ua_same/10">first same channel post</a>',
      '<a href="https://t.me/ua_same/20">second same channel post</a>',
      '<a href="https://t.me/ua_other/30">other channel post</a>',
    ].join(''));
    if(String(url)==='https://t.me/s/ua_same/10')return html('<article>Українці Berlin https://chat.whatsapp.com/SameChannel123</article>');
    if(String(url)==='https://t.me/s/ua_other/30')return html('<article>Українці Berlin https://chat.whatsapp.com/OtherChannel123</article>');
    throw new Error('duplicate channel should not consume page budget: '+url);
  });

  assert.deepEqual(new Set(result.records.map(item=>item.link)),new Set([
    'https://chat.whatsapp.com/SameChannel123',
    'https://chat.whatsapp.com/OtherChannel123',
  ]));
  assert.equal(calls.includes('https://t.me/s/ua_same/20'),false);
  assert.equal(calls.filter(url=>url.startsWith('https://t.me/s/')).length,2);
});

void test('Telegram public history follow-up is same-channel, before-only and bounded to one extra page per task', async () => {
  assert.equal(
    telegramOlderPreviewUrl('<a href="/s/ua_history?before=77">older</a>','https://t.me/s/ua_history'),
    'https://t.me/s/ua_history?before=77',
  );
  assert.equal(
    telegramOlderPreviewUrl('<a href="/s/other?before=77">other</a>','https://t.me/s/ua_history'),
    null,
  );
  assert.equal(
    telegramOlderPreviewUrl('<a href="/s/ua_history?after=77">newer</a>','https://t.me/s/ua_history'),
    null,
  );

  const calls=[];
  const result=await discoverTelegramPublic({cursor:0,maxQueries:1,pageLimit:1},async(url)=>{
    calls.push(String(url));
    if(String(url).includes('search.brave.com'))return html('<a href="https://t.me/ua_history">source</a>');
    if(String(url)==='https://t.me/s/ua_history')return html('<a href="/s/ua_history?before=77">older</a><article>Українці Berlin без invite</article>');
    if(String(url)==='https://t.me/s/ua_history?before=77')return html('<article>Українці Berlin батьки https://chat.whatsapp.com/HistoryInvite123</article>');
    throw new Error('unexpected extra history fetch: '+url);
  });
  assert.ok(result.records.some(item=>item.link==='https://chat.whatsapp.com/HistoryInvite123'));
  assert.equal(calls.filter(url=>url.includes('t.me/s/ua_history?before=')).length,1);
});

void test('Telegram public history does not paginate when the first preview already contains an invite', async () => {
  const calls=[];
  const result=await discoverTelegramPublic({cursor:0,maxQueries:1,pageLimit:1},async(url)=>{
    calls.push(String(url));
    if(String(url).includes('search.brave.com'))return html('<a href="https://t.me/ua_history_hit">source</a>');
    if(String(url)==='https://t.me/s/ua_history_hit')return html('<a href="/s/ua_history_hit?before=55">older</a><article>Українці Berlin https://chat.whatsapp.com/CurrentPreview123</article>');
    throw new Error('older page should not be fetched');
  });
  assert.ok(result.records.some(item=>item.link==='https://chat.whatsapp.com/CurrentPreview123'));
  assert.equal(calls.some(url=>url.includes('before=55')),false);
});

void test('Telegram public discovery prefers bounded history previews and rejects non-public Telegram targets', () => {
  assert.equal(telegramPublicPreviewUrl('https://t.me/ua_berlin_public'),'https://t.me/s/ua_berlin_public');
  assert.equal(telegramPublicPreviewUrl('https://telegram.me/ua_berlin_public/123'),'https://t.me/s/ua_berlin_public/123');
  assert.equal(telegramPublicPreviewUrl('https://t.me/s/ua_berlin_public?before=99'),'https://t.me/s/ua_berlin_public?before=99');
  assert.equal(telegramPublicPreviewUrl('https://t.me/+PrivateInvite'),null);
  assert.equal(telegramPublicPreviewUrl('https://t.me/joinchat/PrivateInvite'),null);
  assert.equal(telegramPublicPreviewUrl('https://t.me/c/123456/7'),null);
  assert.equal(telegramPublicPreviewUrl('https://example.org/ua_berlin_public'),null);
});

void test('discovery run clamps target member threshold to the required 700-18000 range', async (t) => {
  const db = await localDatabase(t);
  const low = await startDiscoveryRun(db, 'u', { platforms: ['whatsapp'], goal: 30, minMembers: 1 }, 100);
  assert.equal(low.minMembers, 700);
  const high = await startDiscoveryRun(db, 'other', { platforms: ['whatsapp'], goal: 30, minMembers: 99_999 }, 100);
  assert.equal(high.minMembers, 18_000);
});

void test('Discovery reset removes only discovery workspace state and preserves linked chats for dedupe', async (t) => {
  const db = await localDatabase(t);
  const run = await startDiscoveryRun(db, 'u', { platforms:['whatsapp'], goal:10, minMembers:700 }, 100);
  await continueDiscoveryRun(db, 'u', run.id, 101, async (url) =>
    String(url).includes('search.brave.com')
      ? html('<div>Українці Berlin батьки https://chat.whatsapp.com/ResetKeepsChat123</div>')
      : html('<html></html>'));
  const before = await readDiscoveryWorkspace(db, 'u');
  assert.ok(before.candidates.length > 0);
  const linkedChatId = before.candidates[0].importedChatId;
  assert.ok(linkedChatId);

  const reset = await resetDiscoveryWorkspace(db, 'u');
  assert.equal(reset.reset, true);
  assert.ok(reset.removedCandidates > 0);
  assert.ok(reset.removedRuns > 0);
  assert.equal(reset.preservedChats, 1);

  const after = await readDiscoveryWorkspace(db, 'u');
  assert.equal(after.run, null);
  assert.equal(after.candidates.length, 0);
  assert.deepEqual(after.counts, { review:0, target:0, rejected:0, unavailable:0 });
  const chat = await db.prepare('SELECT id FROM chats WHERE id=?1 AND user_id=?2').bind(linkedChatId,'u').first();
  assert.equal(chat?.id, linkedChatId);

  const fresh = await startDiscoveryRun(db, 'u', { platforms:['whatsapp'], goal:10, minMembers:700 }, 102);
  assert.equal(fresh.telegramCursor, 0);
  assert.equal(fresh.cursor, 0);
  assert.equal(fresh.searchedQueries, 0);
});

void test('Telegram plan cursor persists independently from public web cursor', async (t) => {
  const db = await localDatabase(t);
  const run = await startDiscoveryRun(db, 'u', { platforms: ['whatsapp'], goal: 30, minMembers: 700 }, 100);
  const initial = await readTelegramDiscoveryPlan(db, 'u', run.id, 2);
  assert.equal(initial.plan.cursor, 0);
  assert.equal(initial.run.telegramCursor, 0);

  const advanced = await ingestTelegramDiscovery(db, 'u', run.id, {
    text: 'Telegram search completed without WhatsApp invites',
    query: initial.plan.tasks[0].query,
    sourceUrl: 'https://t.me/example',
    sourceTitle: 'Telegram Web',
    completeQuery: true,
  }, 101);
  assert.equal(advanced.run.telegramCursor, 1);
  assert.equal(advanced.run.cursor, 0);
  assert.equal((await readTelegramDiscoveryPlan(db, 'u', run.id, 1)).plan.cursor, 1);

  const web = await continueDiscoveryRun(db, 'u', run.id, 102, async () =>
    html('<div>Українці Berlin батьки https://chat.whatsapp.com/IndependentCursor123</div>'));
  assert.equal(web.run.telegramCursor, 1);
  assert.ok(web.run.cursor > 0);
});

void test('partial Telegram source ingestion survives restart without skipping the unfinished query', async (t) => {
  const db = await localDatabase(t);
  const first = await startDiscoveryRun(db, 'u', { platforms: ['whatsapp'], goal: 30, minMembers: 700 }, 100);
  const firstPlan = await readTelegramDiscoveryPlan(db, 'u', first.id, 1);
  const query = firstPlan.plan.tasks[0].query;

  const partial = await ingestTelegramDiscovery(db, 'u', first.id, {
    text: 'Українці Berlin батьки https://chat.whatsapp.com/PartialRestart123',
    sourceUrl: 'https://t.me/partial_restart',
    sourceTitle: 'Українці Berlin',
    query,
    context: 'українська спільнота',
    completeQuery: false,
  }, 101);
  assert.equal(partial.queryCompleted, false);
  assert.equal(partial.run.telegramCursor, 0);
  assert.equal((await readDiscoveryWorkspace(db, 'u')).candidates.length, 1);

  await cancelDiscoveryRun(db, 'u', first.id, partial.run.version, 102);
  const second = await startDiscoveryRun(db, 'u', { platforms: ['whatsapp'], goal: 30, minMembers: 700 }, 103);
  const resumed = await readTelegramDiscoveryPlan(db, 'u', second.id, 1);
  assert.equal(second.telegramCursor, 0);
  assert.equal(resumed.plan.tasks[0].query, query);

  const completed = await ingestTelegramDiscovery(db, 'u', second.id, {
    text: 'Telegram search completed: no more WhatsApp invites found',
    query,
    completeQuery: true,
  }, 104);
  assert.equal(completed.queryCompleted, true);
  assert.equal(completed.run.telegramCursor, 1);
});

void test('new discovery run resumes the Telegram keyword cursor instead of restarting', async (t) => {
  const db = await localDatabase(t);
  const first = await startDiscoveryRun(db, 'u', { platforms: ['whatsapp'], goal: 30, minMembers: 700 }, 100);
  const current = await readTelegramDiscoveryPlan(db, 'u', first.id, 1);
  const advanced = await ingestTelegramDiscovery(db, 'u', first.id, {
    text: 'Telegram search completed without WhatsApp invites',
    query: current.plan.tasks[0].query,
    sourceUrl: 'https://t.me/example',
    sourceTitle: 'Telegram Web',
    completeQuery: true,
  }, 101);
  assert.equal(advanced.run.telegramCursor, 1);
  await cancelDiscoveryRun(db, 'u', first.id, advanced.run.version, 102);

  const second = await startDiscoveryRun(db, 'u', { platforms: ['whatsapp'], goal: 30, minMembers: 700 }, 103);
  assert.notEqual(second.id, first.id);
  assert.equal(second.telegramCursor, 1);
  assert.equal((await readTelegramDiscoveryPlan(db, 'u', second.id, 1)).plan.cursor, 1);
});

void test('Telegram plan refuses a receipt for a different query', async (t) => {
  const db = await localDatabase(t);
  const run = await startDiscoveryRun(db, 'u', { platforms: ['whatsapp'], goal: 30, minMembers: 700 }, 100);
  await assert.rejects(
    () => ingestTelegramDiscovery(db, 'u', run.id, {
      text: 'Telegram search completed',
      query: 'wrong query',
      sourceUrl: 'https://t.me/example',
    sourceTitle: 'Telegram Web',
    }, 101),
    error => error?.status === 409,
  );
  const unchanged = await readTelegramDiscoveryPlan(db, 'u', run.id, 1);
  assert.equal(unchanged.run.telegramCursor, 0);
});

void test('Telegram ingestion requires source title and Telegram URL provenance', async (t) => {
  const db = await localDatabase(t);
  const run = await startDiscoveryRun(db, 'u', { platforms: ['whatsapp'], goal: 30, minMembers: 700 }, 100);
  const plan = await readTelegramDiscoveryPlan(db, 'u', run.id, 1);

  await assert.rejects(
    () => ingestTelegramDiscovery(db, 'u', run.id, {
      text: 'Українці Berlin https://chat.whatsapp.com/NeedsProvenance123',
      query: plan.plan.tasks[0].query,
      sourceTitle: 'Telegram source',
      sourceUrl: 'https://example.org/not-telegram',
    }, 101),
    /потрібні назва чату та коректне посилання/i,
  );

  const unchanged = await readTelegramDiscoveryPlan(db, 'u', run.id, 1);
  assert.equal(unchanged.run.telegramCursor, 0);
});

void test('Telegram ingestion recognizes escaped WhatsApp invite URLs and still requires provenance', async (t) => {
  const db = await localDatabase(t);
  const run = await startDiscoveryRun(db, 'u', { platforms: ['whatsapp'], goal: 30, minMembers: 700 }, 100);
  const plan = await readTelegramDiscoveryPlan(db, 'u', run.id, 1);

  await assert.rejects(
    () => ingestTelegramDiscovery(db, 'u', run.id, {
      text: 'Українці Berlin https:\\/\\/chat.whatsapp.com\\/EscapedInvite123',
      query: plan.plan.tasks[0].query,
      completeQuery: true,
    }, 101),
    /потрібні назва чату та коректне посилання/i,
  );
  assert.equal((await readTelegramDiscoveryPlan(db, 'u', run.id, 1)).run.telegramCursor, 0);
});

void test('Telegram query with no invites advances without invented source provenance', async (t) => {
  const db = await localDatabase(t);
  const run = await startDiscoveryRun(db, 'u', { platforms: ['whatsapp'], goal: 30, minMembers: 700 }, 100);
  const plan = await readTelegramDiscoveryPlan(db, 'u', run.id, 1);

  const result = await ingestTelegramDiscovery(db, 'u', run.id, {
    text: 'Telegram search completed: no WhatsApp invites found',
    query: plan.plan.tasks[0].query,
    completeQuery: true,
  }, 101);

  assert.equal(result.batch.extracted, 0);
  assert.equal(result.batch.added, 0);
  assert.equal(result.run.telegramCursor, 1);
  assert.equal((await readDiscoveryWorkspace(db, 'u')).candidates.length, 0);
});

void test('Telegram ingestion extracts WhatsApp only, keeps provenance and deduplicates repeats', async (t) => {
  const db = await localDatabase(t);
  const run = await startDiscoveryRun(db, 'u', { platforms: ['whatsapp'], goal: 30, minMembers: 700 }, 100);
  const plan = await readTelegramDiscoveryPlan(db, 'u', run.id, 1);
  const input = {
    text: [
      'Українці Berlin батьки https://chat.whatsapp.com/TelegramInvite123',
      'дублікат https://chat.whatsapp.com/TelegramInvite123',
      'Viber https://invite.viber.com/?g2=Zm9vYmFy',
    ].join('\n'),
    sourceUrl: 'https://t.me/example',
    sourceTitle: 'Українці в Берліні',
    query: plan.plan.tasks[0].query,
    seedLabel: 'Берлін',
    context: 'Українці Німеччина',
    completeQuery: true,
  };

  const first = await ingestTelegramDiscovery(db, 'u', run.id, input, 101);
  assert.equal(first.batch.extracted, 2);
  assert.equal(first.batch.added, 1);
  assert.equal(first.batch.duplicates, 0);

  const workspace = await readDiscoveryWorkspace(db, 'u');
  assert.equal(workspace.candidates.length, 1);
  assert.equal(workspace.candidates[0].platform, 'whatsapp');
  assert.equal(workspace.candidates[0].sources[0].kind, 'telegram_global');
  assert.equal(workspace.candidates[0].sources[0].sourceUrl, 'https://t.me/example');
  assert.equal(workspace.candidates[0].sources[0].query, plan.plan.tasks[0].query);

  assert.equal(first.run.telegramCursor, 1);
  const nextPlan = await readTelegramDiscoveryPlan(db, 'u', first.run.id, 1);
  const second = await ingestTelegramDiscovery(db, 'u', first.run.id, {
    ...input,
    query: nextPlan.plan.tasks[0].query,
  }, 102);
  assert.equal(second.batch.added, 0);
  assert.equal(second.batch.duplicates, 1);
  assert.equal(second.run.telegramCursor, 2);
  assert.equal((await readDiscoveryWorkspace(db, 'u')).candidates.length, 1);
});

void test('Telegram query can ingest multiple source chats before one persisted completion', async (t) => {
  const db = await localDatabase(t);
  const run = await startDiscoveryRun(db, 'u', { platforms: ['whatsapp'], goal: 30, minMembers: 700 }, 100);
  const plan = await readTelegramDiscoveryPlan(db, 'u', run.id, 1);
  const query = plan.plan.tasks[0].query;

  const first = await ingestTelegramDiscovery(db, 'u', run.id, {
    text: 'Українці Berlin батьки https://chat.whatsapp.com/MultiSourceA123',
    sourceUrl: 'https://t.me/source_a',
    sourceTitle: 'Українці Berlin A',
    query,
    context: 'українська спільнота',
    completeQuery: false,
  }, 101);
  assert.equal(first.queryCompleted, false);
  assert.equal(first.run.telegramCursor, 0);

  const second = await ingestTelegramDiscovery(db, 'u', run.id, {
    text: 'Українці Berlin родини https://chat.whatsapp.com/MultiSourceB123',
    sourceUrl: 'https://t.me/source_b',
    sourceTitle: 'Українці Berlin B',
    query,
    context: 'українська спільнота',
    completeQuery: true,
  }, 102);
  assert.equal(second.queryCompleted, true);
  assert.equal(second.run.telegramCursor, 1);

  const workspace = await readDiscoveryWorkspace(db, 'u');
  assert.equal(workspace.candidates.length, 2);
  assert.deepEqual(new Set(workspace.candidates.flatMap(item => item.sources.map(source => source.sourceUrl))),
    new Set(['https://t.me/source_a', 'https://t.me/source_b']));
});

void test('Telegram ingestion rejects results from a stale or different plan query', async (t) => {
  const db = await localDatabase(t);
  const run = await startDiscoveryRun(db, 'u', { platforms: ['whatsapp'], goal: 30, minMembers: 700 }, 100);
  await assert.rejects(
    () => ingestTelegramDiscovery(db, 'u', run.id, {
      text: 'https://chat.whatsapp.com/StaleQueryInvite123',
      sourceUrl: 'https://t.me/example',
      sourceTitle: 'Telegram source',
      query: 'not the current query',
    }, 101),
    error => error?.status === 409,
  );
  assert.equal((await readDiscoveryWorkspace(db, 'u')).candidates.length, 0);
});

void test('qualification is fail-closed until every target criterion is confirmed', () => {
  assert.deepEqual(evaluateDiscoveryCandidate({
    chatType: 'group',
    memberCount: 900,
    topicMatch: 'match',
    canWrite: true,
    adsPolicy: 'allowed',
    activityState: 'active',
    membershipState: 'joined',
    inspectionState: 'inspected',
    accessState: 'available',
    linkState: 'valid',
  }), { decision: 'target', reasonCodes: ['all_required_confirmed'] });

  assert.deepEqual(evaluateDiscoveryCandidate({
    chatType: 'group',
    memberCount: 900,
    topicMatch: 'match',
    canWrite: true,
    adsPolicy: 'inferred_allowed',
    activityState: 'active',
    membershipState: 'joined',
    inspectionState: 'inspected',
    accessState: 'available',
    linkState: 'valid',
  }), { decision: 'review', reasonCodes: ['unknown_ads_allowed'] });

  const notJoined = evaluateDiscoveryCandidate({
    chatType: 'group',
    memberCount: 900,
    topicMatch: 'match',
    canWrite: true,
    adsPolicy: 'allowed',
    activityState: 'active',
    membershipState: 'not_checked',
    inspectionState: 'inspected',
    accessState: 'available',
    linkState: 'valid',
  });
  assert.equal(notJoined.decision, 'review');
  assert.deepEqual(notJoined.reasonCodes, ['unknown_membership']);

  const notInspected = evaluateDiscoveryCandidate({
    chatType: 'group',
    memberCount: 900,
    topicMatch: 'match',
    canWrite: true,
    adsPolicy: 'allowed',
    activityState: 'active',
    membershipState: 'joined',
    inspectionState: 'not_checked',
    accessState: 'available',
    linkState: 'valid',
  });
  assert.equal(notInspected.decision, 'review');
  assert.deepEqual(notInspected.reasonCodes, ['unknown_inspection']);

  const review = evaluateDiscoveryCandidate({
    chatType: 'group',
    memberCount: 900,
    topicMatch: 'match',
    canWrite: null,
    adsPolicy: 'unknown',
    activityState: 'unknown',
    accessState: 'available',
    linkState: 'valid',
  });
  assert.equal(review.decision, 'review');
  assert.ok(review.reasonCodes.includes('unknown_can_write'));
  assert.ok(review.reasonCodes.includes('unknown_ads_allowed'));
  assert.ok(review.reasonCodes.includes('unknown_activity'));

  const rejected = evaluateDiscoveryCandidate({
    chatType: 'group',
    memberCount: 699,
    topicMatch: 'match',
    canWrite: true,
    adsPolicy: 'allowed',
    activityState: 'active',
  }, 700);
  assert.equal(rejected.decision, 'rejected');
  assert.ok(rejected.reasonCodes.includes('too_few_members'));

  const tooLarge = evaluateDiscoveryCandidate({
    chatType: 'group',
    memberCount: 18_001,
    topicMatch: 'match',
    canWrite: true,
    adsPolicy: 'allowed',
    activityState: 'active',
    accessState: 'available',
    linkState: 'valid',
  });
  assert.equal(tooLarge.decision, 'rejected');
  assert.ok(tooLarge.reasonCodes.includes('too_many_members'));

  assert.deepEqual(evaluateDiscoveryCandidate({
    linkState: 'invalid',
    accessState: 'unavailable',
  }), { decision: 'unavailable', reasonCodes: ['invalid_invite'] });
});

void test('autonomous Discovery advances the seed matrix through public Telegram pages without operator query input', async (t) => {
  const db = await localDatabase(t);
  const run = await startDiscoveryRun(db, 'u', { platforms:['whatsapp'], goal:50, minMembers:700 }, 100);
  const calls = [];
  const result = await advanceAutonomousDiscoveryRun(db, 'u', 'device-source', 101, async (url) => {
    calls.push(String(url));
    if (String(url).includes('search.brave.com')) {
      return html('<a href="https://t.me/ua_berlin_public">Telegram result</a>');
    }
    if (String(url) === 'https://t.me/s/ua_berlin_public') {
      return html('<article>Українці Berlin батьки · https://chat.whatsapp.com/AutonomousTelegram123</article>');
    }
    return html('');
  });

  assert.equal(result.advanced, true);
  assert.equal(result.source, 'telegram');
  assert.equal(result.batch.searched, 6);
  assert.ok(calls.some(url => url.includes('site%3At.me') || url.includes('site%3At.me'.toLowerCase()) || decodeURIComponent(url).includes('site:t.me')));
  const workspace = await readDiscoveryWorkspace(db, 'u');
  const candidate = workspace.candidates.find(item => item.link === 'https://chat.whatsapp.com/AutonomousTelegram123');
  assert.ok(candidate);
  assert.ok(candidate.importedChatId);
  assert.equal(candidate.decision, 'review');
  assert.equal(workspace.run?.targetCount, 0);
  assert.equal(workspace.run?.status, 'running');
  const queue = await readDiscoveryExecutorQueue(db, 'u', 10);
  assert.equal(queue.tasks.find(item => item.candidateId === candidate.id)?.action, 'join_and_inspect');
  assert.ok(workspace.run?.telegramCursor > run.telegramCursor);
});

void test('Discovery goal counts only new confirmed targets, never raw invite yield', async (t) => {
  const db = await localDatabase(t);
  await startDiscoveryRun(db, 'u', { platforms:['whatsapp'], goal:2, minMembers:700 }, 100);
  await advanceAutonomousDiscoveryRun(db, 'u', 'device-source', 101, async (url) => {
    if (String(url).includes('search.brave.com')) {
      return html('<a href="https://t.me/ua_goal">Telegram result</a>');
    }
    if (String(url) === 'https://t.me/s/ua_goal') {
      return html(
        '<p>Українці Berlin батьки https://chat.whatsapp.com/GoalTargetOne123</p>' +
        '<p>Українці Berlin community https://chat.whatsapp.com/GoalTargetTwo123</p>'
      );
    }
    return html('');
  });
  let workspace = await readDiscoveryWorkspace(db, 'u');
  const candidates = workspace.candidates.filter(item => item.link.includes('GoalTarget'));
  assert.equal(candidates.length, 2);
  assert.equal(workspace.run?.foundCount, 2);
  assert.equal(workspace.run?.targetCount, 0);
  assert.equal(workspace.run?.status, 'running');

  for (let index = 0; index < candidates.length; index += 1) {
    const current = (await readDiscoveryWorkspace(db, 'u')).candidates.find(item => item.id === candidates[index].id);
    assert.ok(current);
    await applyDiscoveryInspection(db, 'u', {
      candidateId:current.id,
      expectedVersion:current.version,
      result:{
        status:'inspected', targetVerified:true, accessible:true, membershipState:'joined',
        observedName:`Українці Berlin target ${index + 1}`, chatType:'group', memberCount:900,
        topicMatch:'match', canWrite:true, adsPolicy:'allowed', activityState:'active',
      },
    }, 110 + index);
    workspace = await readDiscoveryWorkspace(db, 'u');
    assert.equal(workspace.run?.targetCount, index + 1);
    assert.equal(workspace.run?.status, index === candidates.length - 1 ? 'completed' : 'running');
  }
  assert.equal(workspace.run?.completionReason, 'goal_reached');
});

void test('archived unavailable WhatsApp history suppresses rediscovery and automatic rejoin in later runs', async (t) => {
  const db = await localDatabase(t);
  const firstRun = await startDiscoveryRun(db, 'u', { platforms:['whatsapp'], goal:5, minMembers:700 }, 100);
  const fetcher = async (url) => {
    if (String(url).includes('search.brave.com')) return html('<a href="https://t.me/ua_suppression">Telegram result</a>');
    if (String(url) === 'https://t.me/s/ua_suppression') {
      return html('<p>Українці Berlin https://chat.whatsapp.com/NeverRejoinArchived123</p>');
    }
    return html('');
  };
  await advanceAutonomousDiscoveryRun(db, 'u', 'device-source', 101, fetcher);
  let workspace = await readDiscoveryWorkspace(db, 'u');
  const candidate = workspace.candidates.find(item => item.link.endsWith('NeverRejoinArchived123'));
  assert.ok(candidate?.importedChatId);
  const rejected = await applyDiscoveryInspection(db, 'u', {
    candidateId:candidate.id,
    expectedVersion:candidate.version,
    result:{status:'failed',accessible:false,reason:'invalid_whatsapp_link'},
  }, 102);
  assert.equal(rejected.workflowStatus, 'archived');
  assert.equal(rejected.autoArchived, true);

  workspace = await readDiscoveryWorkspace(db, 'u');
  assert.ok(workspace.run);
  await cancelDiscoveryRun(db, 'u', firstRun.id, workspace.run.version, 103);
  const secondRun = await startDiscoveryRun(db, 'u', { platforms:['whatsapp'], goal:5, minMembers:700 }, 104);
  const second = await advanceAutonomousDiscoveryRun(db, 'u', 'device-source', 105, fetcher);
  assert.equal(second.advanced, true);
  assert.equal(second.batch.added, 0);
  assert.ok(second.batch.duplicates >= 1);

  workspace = await readDiscoveryWorkspace(db, 'u');
  assert.equal(workspace.candidates.filter(item => item.link.endsWith('NeverRejoinArchived123')).length, 1);
  assert.notEqual(workspace.candidates.find(item => item.id === candidate.id)?.decision, 'target');
  assert.equal(workspace.run?.id, secondRun.id);
  assert.equal(workspace.run?.targetCount, 0);
  const queue = await readDiscoveryExecutorQueue(db, 'u', 20);
  assert.equal(queue.tasks.some(item => item.candidateId === candidate.id), false);
});

void test('autonomous source advancement has a shared cooldown after a source batch', async (t) => {
  const db = await localDatabase(t);
  await startDiscoveryRun(db,'u',{platforms:['whatsapp'],goal:50,minMembers:700},100);
  const fetcher = async () => html('');
  const first = await advanceAutonomousDiscoveryRun(db,'u','device-a',101,fetcher);
  assert.equal(first.advanced,true);
  const immediate = await advanceAutonomousDiscoveryRun(db,'u','device-b',102,fetcher);
  assert.equal(immediate.advanced,false);
  assert.equal(immediate.source,'busy');
  const afterCooldown = await advanceAutonomousDiscoveryRun(db,'u','device-b',116,fetcher);
  assert.equal(afterCooldown.advanced,true);
  assert.equal(first.batch.searched,6);
});

void test('discovery run persists one canonical candidate, provenance and owner isolation', async (t) => {
  const db = await localDatabase(t);
  const run = await startDiscoveryRun(db, 'u', { platforms: ['whatsapp'], goal: 30, minMembers: 700 }, 100);
  assert.equal(run.status, 'running');

  const fetcher = async (url) => {
    if (url.includes('search.brave.com')) {
      return html('<article>Українці Berlin · Барахолка https://chat.whatsapp.com/PersistInvite123</article>');
    }
    return html('<html><title>Directory</title></html>');
  };
  const step = await continueDiscoveryRun(db, 'u', run.id, 101, fetcher);
  assert.equal(step.batch.searched, 6);
  assert.equal(step.batch.added, 1);
  assert.equal(step.run.foundCount, 1);

  const workspace = await readDiscoveryWorkspace(db, 'u');
  assert.equal(workspace.candidates.length, 1);
  assert.equal(workspace.importedCount, 1);
  assert.equal(workspace.candidates[0].platform, 'whatsapp');
  assert.equal(workspace.candidates[0].decision, 'review');
  assert.ok(workspace.candidates[0].reasonCodes.includes('unknown_member_count'));
  assert.ok(workspace.candidates[0].importedChatId);
  assert.ok(workspace.candidates[0].sources.length >= 1);
  const queued = await readDiscoveryExecutorQueue(db, 'u', 10);
  assert.equal(queued.tasks[0]?.action, 'join_and_inspect');

  const foreign = await readDiscoveryWorkspace(db, 'other');
  assert.equal(foreign.candidates.length, 0);
  assert.equal(foreign.run, null);
});

void test('discovery membership follows real chat transitions and ignores stale attempts', async (t) => {
  const db = await localDatabase(t);
  const run = await startDiscoveryRun(db, 'u', { platforms: ['whatsapp'], goal: 30, minMembers: 700 }, 100);
  const fetcher = async (url) => url.includes('search.brave.com')
    ? html('<div>Українці Praha допомога https://chat.whatsapp.com/MembershipInvite123</div>')
    : html('<html></html>');
  await continueDiscoveryRun(db, 'u', run.id, 101, fetcher);
  const candidate = (await readDiscoveryWorkspace(db, 'u')).candidates[0];
  assert.ok(candidate);
  const handed = await handoffDiscoveryCandidate(db, 'u', candidate.id, candidate.version, 102);

  const initial = await readChatState(db, 'u', handed.chatId);
  assert.ok(initial);
  assert.equal((await readDiscoveryWorkspace(db, 'u')).candidates[0].membershipState, 'not_checked');

  assert.equal((await transitionChat(db, { userId:'u', chat:initial, action:'waiting', accountId:null, now:103 })).ok, true);
  let linked = (await readDiscoveryWorkspace(db, 'u')).candidates[0];
  assert.equal(linked.membershipState, 'pending');
  const pendingVersion = linked.version;

  assert.equal((await transitionChat(db, { userId:'u', chat:initial, action:'waiting', accountId:null, now:104 })).ok, false);
  linked = (await readDiscoveryWorkspace(db, 'u')).candidates[0];
  assert.equal(linked.membershipState, 'pending');
  assert.equal(linked.version, pendingVersion);

  const waiting = await readChatState(db, 'u', handed.chatId);
  assert.ok(waiting);
  assert.equal((await transitionChat(db, { userId:'u', chat:waiting, action:'approved', accountId:null, now:105 })).ok, true);
  assert.equal((await readDiscoveryWorkspace(db, 'u')).candidates[0].membershipState, 'joined');

  const ready = await readChatState(db, 'u', handed.chatId);
  assert.ok(ready);
  assert.equal((await transitionChat(db, { userId:'u', chat:ready, action:'archive', accountId:null, now:106, reason:'Не підходить' })).ok, true);
  assert.equal((await readDiscoveryWorkspace(db, 'u')).candidates[0].membershipState, 'joined');

  const archived = await readChatState(db, 'u', handed.chatId);
  assert.ok(archived);
  assert.equal((await changeChatLeave(db, { userId:'u', chat:archived, now:107, confirm:true })).ok, true);
  assert.equal((await readDiscoveryWorkspace(db, 'u')).candidates[0].membershipState, 'left');

  const left = await readChatState(db, 'u', handed.chatId);
  assert.ok(left);
  assert.equal((await changeChatLeave(db, { userId:'u', chat:left, now:108, confirm:false })).ok, true);
  assert.equal((await readDiscoveryWorkspace(db, 'u')).candidates[0].membershipState, 'joined');
});

void test('invalid auto-imported WhatsApp invite is archived safely without claiming a join', async (t) => {
  const db = await localDatabase(t);
  const run = await startDiscoveryRun(db, 'u', { platforms: ['whatsapp'], goal: 30, minMembers: 700 }, 100);
  await ingestTelegramDiscovery(db, 'u', run.id, {
    text:'Українці Berlin батьки https://chat.whatsapp.com/ExpiredBeforeJoin123',
    sourceUrl:'https://t.me/source',
    sourceTitle:'Українці Berlin',
    query:(await readTelegramDiscoveryPlan(db, 'u', run.id, 1)).plan.tasks[0].query,
    context:'українська спільнота',
  }, 101);
  const candidate = (await readDiscoveryWorkspace(db, 'u')).candidates[0];
  assert.ok(candidate?.importedChatId);

  const outcome = await applyDiscoveryInspection(db, 'u', {
    candidateId:candidate.id,
    expectedVersion:candidate.version,
    result:{status:'failed',accessible:false,reason:'invalid_whatsapp_link'},
  }, 102);
  assert.equal(outcome.chatId, candidate.importedChatId);
  assert.equal(outcome.workflowStatus, 'archived');
  assert.equal(outcome.decision, 'unavailable');
  assert.equal(outcome.autoArchived, true);
  assert.equal(outcome.needsExternalLeave, false);
  assert.ok(outcome.reasonCodes.includes('invalid_invite'));

  const stored = (await readDiscoveryWorkspace(db, 'u')).candidates.find(item => item.id === candidate.id);
  assert.equal(stored.importedChatId, candidate.importedChatId);
  assert.equal(stored.linkState, 'invalid');
  assert.equal((await readChatState(db, 'u', candidate.importedChatId)).workflow_status, 'archived');
});

void test('new WhatsApp discovery auto-handoffs to one to-join chat and manual handoff stays idempotent', async (t) => {
  const db = await localDatabase(t);
  const run = await startDiscoveryRun(db, 'u', { platforms: ['whatsapp'], goal: 30, minMembers: 700 }, 100);
  const fetcher = async (url) => url.includes('search.brave.com')
    ? html('<div>Українці Warszawa допомога https://chat.whatsapp.com/HandoffInvite123</div>')
    : html('<html></html>');
  await continueDiscoveryRun(db, 'u', run.id, 101, fetcher);
  const before = await readDiscoveryWorkspace(db, 'u');
  const candidate = before.candidates[0];
  assert.ok(candidate);

  assert.ok(candidate.importedChatId);
  const first = await handoffDiscoveryCandidate(db, 'u', candidate.id, candidate.version, 102);
  assert.equal(first.existing, true);
  assert.equal(first.workflowStatus, 'to_join');

  const chat = await db.prepare(`SELECT id,user_id,platform,workflow_status,normalized_link
    FROM chats WHERE id=?1`).bind(first.chatId).first();
  assert.deepEqual(
    [chat.user_id, chat.platform, chat.workflow_status, chat.normalized_link],
    ['u', 'whatsapp', 'to_join', 'https://chat.whatsapp.com/HandoffInvite123'],
  );
  const event = await db.prepare(`SELECT event_type,chat_id,source_key FROM activity_events
    WHERE user_id='u' AND source_key=?1`).bind(`chat-discovery-import:${candidate.id}`).first();
  assert.equal(event.event_type, 'chat_discovery_imported');
  assert.equal(event.chat_id, first.chatId);

  const after = await readDiscoveryWorkspace(db, 'u');
  const imported = after.candidates.find((item) => item.id === candidate.id);
  assert.equal(imported.importedChatId, first.chatId);
  assert.equal(after.importedCount, 1);
  const again = await handoffDiscoveryCandidate(db, 'u', candidate.id, candidate.version, 103);
  assert.equal(again.chatId, first.chatId);
  assert.equal(again.existing, true);

  const count = await db.prepare(`SELECT COUNT(*) AS count FROM chats
    WHERE user_id='u' AND normalized_link='https://chat.whatsapp.com/HandoffInvite123'`).first();
  assert.equal(Number(count.count), 1);
});


async function importedCandidate(t, suffix) {
  const db = await localDatabase(t);
  const run = await startDiscoveryRun(db, 'u', { platforms: ['whatsapp'], goal: 30, minMembers: 700 }, 100);
  const link = `https://chat.whatsapp.com/${suffix}`;
  const fetcher = async (url) => url.includes('search.brave.com')
    ? html(`<div>Українці Praha допомога ${link}</div>`)
    : html('<html></html>');
  await continueDiscoveryRun(db, 'u', run.id, 101, fetcher);
  const candidate = (await readDiscoveryWorkspace(db, 'u')).candidates[0];
  assert.ok(candidate);
  const handed = await handoffDiscoveryCandidate(db, 'u', candidate.id, candidate.version, 102);
  const fresh = (await readDiscoveryWorkspace(db, 'u')).candidates.find(item => item.id === candidate.id);
  assert.ok(fresh);
  return { db, candidate: fresh, chatId: handed.chatId };
}

void test('verified WhatsApp UI name replaces an approximate discovery source name', async (t) => {
  const { db, candidate } = await importedCandidate(t, 'ObservedName123');
  const outcome = await applyDiscoveryInspection(db, 'u', {
    candidateId:candidate.id,
    expectedVersion:candidate.version,
    requireTargetVerification:true,
    result:{
      status:'inspected',targetVerified:true,accessible:true,membershipState:'joined',
      observedName:'Українці Прага — офіційний чат',chatType:'group',
    },
  }, 110);
  assert.equal(outcome.membershipState,'joined');
  const stored = (await readDiscoveryWorkspace(db,'u')).candidates.find(item => item.id === candidate.id);
  assert.equal(stored.name,'Українці Прага — офіційний чат');
});

void test('executor queue exposes only the next safe external action and clears completed targets', async (t) => {
  const { db, candidate, chatId } = await importedCandidate(t, 'ExecutorQueue123');
  const initial = await readDiscoveryExecutorQueue(db, 'u', 10);
  assert.equal(initial.tasks.length, 1);
  assert.deepEqual(
    [initial.tasks[0].candidateId, initial.tasks[0].chatId, initial.tasks[0].action, initial.tasks[0].resultAction],
    [candidate.id, chatId, 'join_and_inspect', 'inspect'],
  );
  assert.equal(initial.tasks[0].minMembers, 700);

  const inspected = await applyDiscoveryInspection(db, 'u', {
    candidateId: candidate.id,
    expectedVersion: candidate.version,
    result: {
      status:'inspected', targetVerified:true, accessible:true, membershipState:'joined',
      observedName:'Українці Praha', chatType:'group', memberCount:900,
      topicMatch:'match', canWrite:true, adsPolicy:'allowed', activityState:'active',
    },
  }, 110);
  assert.equal(inspected.decision, 'target');
  assert.equal((await readDiscoveryExecutorQueue(db, 'u', 10)).tasks.length, 0);
  assert.equal((await readDiscoveryExecutorQueue(db, 'other', 10)).tasks.length, 0);
});


void test('WhatsApp pending checks wait three days and require another explicit batch start', async (t) => {
  const { db, candidate } = await importedCandidate(t, 'PendingRecheck123');
  const first = await claimDiscoveryExecutorQueue(db, 'u', 'device-a', 1, 200);
  assert.equal(first.tasks.length, 1);

  const pending = await applyDiscoveryInspection(db, 'u', {
    candidateId:candidate.id, expectedVersion:first.tasks[0].candidateVersion,
    executorDeviceId:'device-a', requireTargetVerification:true,
    result:{status:'inspected',targetVerified:true,accessible:true,membershipState:'pending',observedName:'Українці Praha'},
  }, 201);
  assert.equal(pending.membershipState, 'pending');
  assert.equal(pending.workflowStatus, 'waiting');

  const stored = await db.prepare(`SELECT dc.checked_at,c.snoozed_until
    FROM chat_discovery_candidates dc JOIN chats c ON c.id=dc.imported_chat_id
    WHERE dc.id=?1`).bind(candidate.id).first();
  assert.equal(stored.checked_at,201);
  assert.ok(stored.snoozed_until>201);
  assert.equal((await claimDiscoveryExecutorQueue(db,'u','device-a',1,stored.snoozed_until+1)).tasks.length,0);

  // Waiting-check batch state itself (start/claim/stop over the owner Durable Object) moved to
  // commit 3b — see tests/owner-channel.test.mjs. What stays a Discovery-side contract is that the
  // snoozed chat is simply absent from the eligible-chat snapshot until its deadline passes.
  const items = await readEligibleWaitingChats(db, 'u', stored.snoozed_until + 1);
  assert.equal(items.length, 1);
  assert.equal(items[0].id, candidate.importedChatId);
});

void test('legacy waiting chats are enrolled only by the operator batch and create no Discovery candidates', async (t) => {
  const db=await localDatabase(t);
  await db.prepare(`INSERT INTO chats(
    id,user_id,platform,name,link,normalized_link,workflow_status,is_private,created_at,updated_at
  ) VALUES ('legacy-waiting','u','whatsapp','Українці Австрія',
    'https://chat.whatsapp.com/LegacyWaiting123','https://chat.whatsapp.com/LegacyWaiting123',
    'waiting',0,100,100)`).run();

  assert.equal((await claimDiscoveryExecutorQueue(db,'u','device-a',1,200)).tasks.length,0);
  const items = await readEligibleWaitingChats(db, 'u', 200);
  const batch = createWaitingCheckBatch(items, 200);
  assert.equal(batch.total,1);
  assert.equal(isWaitingCheckBatchActive(batch),true);

  const stopped=stopWaitingCheckBatch(batch,201);
  const status=waitingCheckStatusFromBatch(stopped);
  assert.equal(status.active,false);
  assert.equal(status.remaining,0);
  assert.equal((await claimDiscoveryExecutorQueue(db,'u','device-a',1,202)).tasks.length,0);
  assert.equal((await db.prepare(`SELECT COUNT(*) AS n FROM chat_discovery_candidates`).first()).n,0);
});

void test('executor claims are exclusive per device and recover after a bounded lease', async (t) => {
  const { db, candidate } = await importedCandidate(t, 'ExecutorLease123');
  const first = await claimDiscoveryExecutorQueue(db, 'u', 'device-a', 10, 200);
  assert.equal(first.tasks.length, 1);
  assert.equal(first.leaseSeconds, 90);
  assert.equal(first.tasks[0].leaseExpiresAt, 290);

  const competing = await claimDiscoveryExecutorQueue(db, 'u', 'device-b', 10, 201);
  assert.equal(competing.tasks.length, 0);
  await assert.rejects(
    assertDiscoveryExecutorLease(db, 'u', 'device-b', candidate.id, first.tasks[0].candidateVersion, 201),
    /більше не належить цьому пристрою/,
  );
  await assert.doesNotReject(
    assertDiscoveryExecutorLease(db, 'u', 'device-a', candidate.id, first.tasks[0].candidateVersion, 201),
  );

  const recovered = await claimDiscoveryExecutorQueue(db, 'u', 'device-b', 10, 291);
  assert.equal(recovered.tasks.length, 1);
  assert.equal(recovered.tasks[0].candidateId, candidate.id);
  assert.ok(recovered.tasks[0].candidateVersion>first.tasks[0].candidateVersion);
  await assert.rejects(
    assertDiscoveryExecutorLease(db, 'u', 'device-a', candidate.id, first.tasks[0].candidateVersion, 291),
    /більше не належить цьому пристрою/,
  );
});

void test('reclaimed executor lease fences stale join callback before chat state changes', async (t) => {
  const { db, candidate, chatId } = await importedCandidate(t, 'ExecutorFence123');
  const first = await claimDiscoveryExecutorQueue(db, 'u', 'device-a', 1, 200);
  assert.equal(first.tasks.length, 1);
  const recovered = await claimDiscoveryExecutorQueue(db, 'u', 'device-b', 1, 291);
  assert.equal(recovered.tasks.length, 1);
  await assert.rejects(
    applyDiscoveryInspection(db, 'u', {
      candidateId:candidate.id, expectedVersion:first.tasks[0].candidateVersion,
      executorDeviceId:'device-a', requireTargetVerification:true,
      result:{status:'inspected',targetVerified:true,accessible:true,membershipState:'joined',observedName:'Українці Praha'},
    }, 291),
    /Кандидат уже змінився|Стан чату вже змінився/,
  );
  const chat = await readChatState(db, 'u', chatId);
  assert.equal(chat.workflow_status, 'to_join');
  assert.equal(chat.joined_at, null);
});

void test('executor leave result archives a rejected joined WhatsApp chat and confirms the real external leave', async (t) => {
  const { db, candidate, chatId } = await importedCandidate(t, 'ExecutorLeave123');
  await applyDiscoveryInspection(db, 'u', {
    candidateId: candidate.id,
    expectedVersion: candidate.version,
    result: {
      status:'inspected', targetVerified:true, accessible:true, membershipState:'joined',
      observedName:'Random chat', chatType:'group', memberCount:900,
      topicMatch:'mismatch', canWrite:true, adsPolicy:'allowed', activityState:'active',
    },
  }, 110);

  const queue = await readDiscoveryExecutorQueue(db, 'u', 10);
  assert.equal(queue.tasks.length, 1);
  const task = queue.tasks[0];
  assert.equal(task.action, 'leave');
  assert.equal(task.resultAction, 'executor-leave');
  assert.equal(task.runtime, 'whatsapp_web');
  assert.deepEqual(task.expectedTarget, {name:candidate.name,link:candidate.link});
  assert.deepEqual(task.safety, {requiresTargetVerification:true,unknownState:'fail_closed'});
  assert.equal(task.chatId, chatId);

  await assert.rejects(
    completeDiscoveryExternalLeave(db, 'u', {
      candidateId: task.candidateId,
      expectedVersion: task.candidateVersion,
      chatStateToken: 'stale-token',
      targetVerified: true,
    }, 111),
    /Чат уже змінився/,
  );

  const completed = await completeDiscoveryExternalLeave(db, 'u', {
    candidateId: task.candidateId,
    expectedVersion: task.candidateVersion,
    chatStateToken: task.chatStateToken,
    targetVerified: true,
  }, 112);
  assert.equal(completed.ok, true);
  const chat = await readChatState(db, 'u', chatId);
  assert.equal(chat.workflow_status, 'archived');
  assert.equal(chat.left_at, 112);
  const stored = (await readDiscoveryWorkspace(db, 'u')).candidates.find(item => item.id === candidate.id);
  assert.equal(stored.membershipState, 'left');
  assert.equal((await readDiscoveryExecutorQueue(db, 'u', 10)).tasks.length, 0);
});

void test('inspection promotes an accepted WhatsApp target into ready workflow', async (t) => {
  const { db, candidate, chatId } = await importedCandidate(t, 'InspectTarget123');
  const outcome = await applyDiscoveryInspection(db, 'u', {
    candidateId: candidate.id,
    expectedVersion: candidate.version,
    result: {
      status:'inspected', targetVerified:true, accessible:true, membershipState:'joined',
      observedName:'Українці Praha допомога', chatType:'group', memberCount:900,
      topicMatch:'match', canWrite:true, adsPolicy:'allowed', activityState:'active',
    },
  }, 110);
  assert.equal(outcome.decision, 'target');
  assert.equal(outcome.workflowStatus, 'ready');
  assert.equal(outcome.membershipState, 'joined');
  assert.equal(outcome.needsQualification, false);
  assert.equal(outcome.needsExternalLeave, false);
  assert.equal(outcome.autoArchived, false);
  const chat = await readChatState(db, 'u', chatId);
  assert.equal(chat.workflow_status, 'ready');
  const stored = (await readDiscoveryWorkspace(db, 'u')).candidates.find(item => item.id === candidate.id);
  assert.equal(stored.decision, 'target');
  assert.equal(stored.inspectionState, 'inspected');
  assert.equal(stored.memberCount, 900);
});

void test('confirmed leave adds the membership blocker to an already-review candidate and undo removes only it', async (t) => {
  const { db, candidate, chatId } = await importedCandidate(t, 'ReviewLeaveReasons123');
  const reviewed = await applyDiscoveryInspection(db, 'u', {
    candidateId: candidate.id,
    expectedVersion: candidate.version,
    result: {
      status:'inspected', targetVerified:true, accessible:true, membershipState:'joined',
      observedName:'Українці Brno батьки', chatType:'group', memberCount:900,
      topicMatch:'match', canWrite:null, adsPolicy:'unknown', activityState:'active',
    },
  }, 110);
  assert.equal(reviewed.decision, 'review');
  assert.deepEqual(reviewed.reasonCodes, ['unknown_can_write']);

  const ready = await readChatState(db, 'u', chatId);
  assert.ok(ready);
  assert.equal((await transitionChat(db, { userId:'u', chat:ready, action:'archive', accountId:null, now:111, reason:'Пауза' })).ok, true);
  const archived = await readChatState(db, 'u', chatId);
  assert.ok(archived);
  assert.equal((await changeChatLeave(db, { userId:'u', chat:archived, now:112, confirm:true })).ok, true);

  let stored = (await readDiscoveryWorkspace(db, 'u')).candidates.find(item => item.id === candidate.id);
  assert.equal(stored.membershipState, 'left');
  assert.equal(stored.decision, 'review');
  assert.deepEqual(stored.reasonCodes, ['unknown_can_write','unknown_membership']);

  const left = await readChatState(db, 'u', chatId);
  assert.ok(left);
  assert.equal((await changeChatLeave(db, { userId:'u', chat:left, now:113, confirm:false })).ok, true);
  stored = (await readDiscoveryWorkspace(db, 'u')).candidates.find(item => item.id === candidate.id);
  assert.equal(stored.membershipState, 'joined');
  assert.equal(stored.decision, 'review');
  assert.deepEqual(stored.reasonCodes, ['unknown_can_write']);
});

void test('executor inspection fails closed when the exact target chat was not verified', async (t) => {
  const { db, candidate, chatId } = await importedCandidate(t, 'InspectTargetVerification123');
  await assert.rejects(() => applyDiscoveryInspection(db, 'u', {
    candidateId:candidate.id, expectedVersion:candidate.version, requireTargetVerification:true,
    result:{status:'inspected', accessible:true, membershipState:'joined', observedName:'Wrong or unknown chat', chatType:'group', memberCount:900, topicMatch:'match', canWrite:true, adsPolicy:'allowed', activityState:'active'},
  }, 110), error => error?.status === 409 && /цільовий чат/i.test(error.message));
  assert.equal((await readChatState(db, 'u', chatId)).workflow_status, 'to_join');
  const stored = (await readDiscoveryWorkspace(db, 'u')).candidates.find(item => item.id === candidate.id);
  assert.equal(stored.membershipState, 'not_checked');
});

void test('inspection cannot overwrite canonical joined membership with a stale manual state', async (t) => {
  const { db, candidate, chatId } = await importedCandidate(t, 'InspectMembershipCanonical123');
  const joined = await applyDiscoveryInspection(db, 'u', {
    candidateId: candidate.id,
    expectedVersion: candidate.version,
    result: {
      status:'inspected', targetVerified:true, accessible:true, membershipState:'joined',
      observedName:'Українці Graz батьки', chatType:'group', memberCount:900,
      topicMatch:'match', canWrite:true, adsPolicy:'allowed', activityState:'active',
    },
  }, 110);
  assert.equal(joined.decision, 'target');

  const stored = (await readDiscoveryWorkspace(db, 'u')).candidates.find(item => item.id === candidate.id);
  await assert.rejects(
    () => applyDiscoveryInspection(db, 'u', {
      candidateId: stored.id,
      expectedVersion: stored.version,
      result: { status:'inspected', targetVerified:true, membershipState:'not_checked' },
    }, 111),
    error => error?.status === 409 && /фактичному стану чату/i.test(error.message),
  );

  const after = (await readDiscoveryWorkspace(db, 'u')).candidates.find(item => item.id === candidate.id);
  assert.equal(after.membershipState, 'joined');
  assert.equal(after.decision, 'target');
  assert.equal((await readChatState(db, 'u', chatId)).workflow_status, 'ready');
});

void test('inspection cannot fake an external leave for an imported chat', async (t) => {
  const { db, candidate, chatId } = await importedCandidate(t, 'InspectCannotFakeLeave123');
  const joined = await applyDiscoveryInspection(db, 'u', {
    candidateId: candidate.id,
    expectedVersion: candidate.version,
    result: {
      status:'inspected', targetVerified:true, accessible:true, membershipState:'joined',
      observedName:'Українці Wien батьки', chatType:'group', memberCount:900,
      topicMatch:'match', canWrite:true, adsPolicy:'allowed', activityState:'active',
    },
  }, 110);
  assert.equal(joined.decision, 'target');

  let stored = (await readDiscoveryWorkspace(db, 'u')).candidates.find(item => item.id === candidate.id);
  await assert.rejects(
    () => applyDiscoveryInspection(db, 'u', {
      candidateId: stored.id,
      expectedVersion: stored.version,
      result: { status:'inspected', targetVerified:true, membershipState:'left' },
    }, 111),
    error => error?.status === 409 && /leave-checklist/i.test(error.message),
  );

  stored = (await readDiscoveryWorkspace(db, 'u')).candidates.find(item => item.id === candidate.id);
  assert.equal(stored.membershipState, 'joined');
  assert.equal(stored.decision, 'target');
  assert.equal((await readChatState(db, 'u', chatId)).workflow_status, 'ready');
});

void test('confirmed external leave downgrades a target back to review', async (t) => {
  const { db, candidate, chatId } = await importedCandidate(t, 'InspectTargetLeave123');
  const outcome = await applyDiscoveryInspection(db, 'u', {
    candidateId: candidate.id,
    expectedVersion: candidate.version,
    result: {
      status:'inspected', targetVerified:true, accessible:true, membershipState:'joined',
      observedName:'Українці Praha допомога', chatType:'group', memberCount:900,
      topicMatch:'match', canWrite:true, adsPolicy:'allowed', activityState:'active',
    },
  }, 110);
  assert.equal(outcome.decision, 'target');

  const ready = await readChatState(db, 'u', chatId);
  assert.ok(ready);
  assert.equal((await transitionChat(db, { userId:'u', chat:ready, action:'archive', accountId:null, now:111, reason:'Завершено' })).ok, true);
  const archived = await readChatState(db, 'u', chatId);
  assert.ok(archived);
  assert.equal((await changeChatLeave(db, { userId:'u', chat:archived, now:112, confirm:true })).ok, true);

  let stored = (await readDiscoveryWorkspace(db, 'u')).candidates.find(item => item.id === candidate.id);
  assert.equal(stored.membershipState, 'left');
  assert.equal(stored.decision, 'review');
  assert.deepEqual(stored.reasonCodes, ['unknown_membership']);

  const left = await readChatState(db, 'u', chatId);
  assert.ok(left);
  assert.equal((await changeChatLeave(db, { userId:'u', chat:left, now:113, confirm:false })).ok, true);
  stored = (await readDiscoveryWorkspace(db, 'u')).candidates.find(item => item.id === candidate.id);
  assert.equal(stored.membershipState, 'joined');
  assert.equal(stored.decision, 'target');
  assert.deepEqual(stored.reasonCodes, ['all_required_confirmed']);
});

void test('joining removes only the membership blocker and preserves other qualification gaps', async (t) => {
  const db = await localDatabase(t);
  const run = await startDiscoveryRun(db, 'u', { platforms: ['whatsapp'], goal: 30, minMembers: 700 }, 100);
  await ingestTelegramDiscovery(db, 'u', run.id, {
    text:'Українці Berlin батьки https://chat.whatsapp.com/JoinKeepsOtherGaps123',
    sourceUrl:'https://t.me/source',
    sourceTitle:'Українці Berlin',
    query:(await readTelegramDiscoveryPlan(db, 'u', run.id, 1)).plan.tasks[0].query,
    context:'українська спільнота',
    completeQuery:true,
  }, 101);
  let candidate = (await readDiscoveryWorkspace(db, 'u')).candidates[0];
  const inspected = await applyDiscoveryInspection(db, 'u', {
    candidateId: candidate.id,
    expectedVersion: candidate.version,
    result: {
      status:'inspected', accessible:true,
      observedName:'Українці Berlin батьки', chatType:'group', memberCount:900,
      topicMatch:'match', canWrite:null, adsPolicy:'unknown', activityState:'active',
    },
  }, 102);
  assert.equal(inspected.decision, 'review');
  assert.deepEqual(inspected.reasonCodes, ['unknown_can_write','unknown_membership']);

  candidate = (await readDiscoveryWorkspace(db, 'u')).candidates[0];
  const imported = await handoffDiscoveryCandidate(db, 'u', candidate.id, candidate.version, 103);
  const toJoin = await readChatState(db, 'u', imported.chatId);
  assert.ok(toJoin);
  assert.equal((await transitionChat(db, { userId:'u', chat:toJoin, action:'joined', accountId:null, now:104 })).ok, true);

  candidate = (await readDiscoveryWorkspace(db, 'u')).candidates[0];
  assert.equal(candidate.membershipState, 'joined');
  assert.equal(candidate.decision, 'review');
  assert.deepEqual(candidate.reasonCodes, ['unknown_can_write']);
});

void test('restoring an archived discovery chat resets membership instead of reviving target status', async (t) => {
  const { db, candidate, chatId } = await importedCandidate(t, 'InspectRestoreMembership123');
  const outcome = await applyDiscoveryInspection(db, 'u', {
    candidateId: candidate.id,
    expectedVersion: candidate.version,
    result: {
      status:'inspected', targetVerified:true, accessible:true, membershipState:'joined',
      observedName:'Українці Praha допомога', chatType:'group', memberCount:900,
      topicMatch:'match', canWrite:true, adsPolicy:'allowed', activityState:'active',
    },
  }, 110);
  assert.equal(outcome.decision, 'target');

  const ready = await readChatState(db, 'u', chatId);
  assert.ok(ready);
  assert.equal((await transitionChat(db, { userId:'u', chat:ready, action:'archive', accountId:null, now:111, reason:'Пауза' })).ok, true);
  const archived = await readChatState(db, 'u', chatId);
  assert.ok(archived);
  assert.equal((await changeChatLeave(db, { userId:'u', chat:archived, now:112, confirm:true })).ok, true);

  const left = await readChatState(db, 'u', chatId);
  assert.ok(left);
  assert.equal((await transitionChat(db, { userId:'u', chat:left, action:'restore', accountId:null, now:113 })).ok, true);

  let stored = (await readDiscoveryWorkspace(db, 'u')).candidates.find(item => item.id === candidate.id);
  assert.equal(stored.membershipState, 'not_checked');
  assert.equal(stored.inspectionState, 'not_checked');
  assert.equal(stored.linkState, 'unknown');
  assert.equal(stored.accessState, 'unknown');
  assert.equal(stored.memberCount, null);
  assert.equal(stored.decision, 'review');
  assert.ok(stored.reasonCodes.includes('unknown_membership'));
  assert.ok(stored.reasonCodes.includes('unknown_inspection'));
  assert.ok(stored.reasonCodes.includes('unknown_invite_validity'));
  assert.ok(stored.reasonCodes.includes('unknown_access'));
  assert.equal((await readChatState(db, 'u', chatId)).workflow_status, 'to_join');

  const toJoin = await readChatState(db, 'u', chatId);
  assert.ok(toJoin);
  assert.equal((await transitionChat(db, { userId:'u', chat:toJoin, action:'joined', accountId:null, now:114 })).ok, true);
  stored = (await readDiscoveryWorkspace(db, 'u')).candidates.find(item => item.id === candidate.id);
  assert.equal(stored.membershipState, 'joined');
  assert.equal(stored.decision, 'review');
  assert.equal(stored.reasonCodes.includes('unknown_membership'), false);
  assert.ok(stored.reasonCodes.includes('unknown_inspection'));

  const inspected = await applyDiscoveryInspection(db, 'u', {
    candidateId: stored.id,
    expectedVersion: stored.version,
    result: {
      status:'inspected', targetVerified:true, accessible:true, membershipState:'joined',
      observedName:'Українці Praha допомога', chatType:'group', memberCount:900,
      topicMatch:'match', canWrite:true, adsPolicy:'allowed', activityState:'active',
    },
  }, 115);
  assert.equal(inspected.decision, 'target');
});

void test('joined inspection with unknown rules stays ready but explicitly needs qualification', async (t) => {
  const { db, candidate } = await importedCandidate(t, 'InspectReview123');
  const outcome = await applyDiscoveryInspection(db, 'u', {
    candidateId: candidate.id,
    expectedVersion: candidate.version,
    result: {
      status:'inspected', targetVerified:true, accessible:true, membershipState:'joined',
      observedName:'Українці Praha допомога', chatType:'group', memberCount:900,
      canWrite:null, adsPolicy:'unknown', activityState:'unknown',
    },
  }, 110);
  assert.equal(outcome.decision, 'review');
  assert.equal(outcome.workflowStatus, 'ready');
  assert.equal(outcome.needsQualification, true);
  assert.equal(outcome.needsExternalLeave, false);
  // The imported fixture already carries topicMatch 'match' and the inspection reports no topic, so the
  // topic stays known; the remaining unknown criteria still keep the chat in review.
  assert.ok(!outcome.reasonCodes.includes('unknown_topic_match'));
  assert.ok(outcome.reasonCodes.includes('unknown_can_write'));
  // Ad rules and activity are not criteria any more (operator decision 2026-10-02).
  assert.ok(!outcome.reasonCodes.includes('unknown_ads_allowed'));
  assert.ok(!outcome.reasonCodes.includes('unknown_activity'));
});

void test('verified executor inspection keeps unverified joined chats in review for the operator instead of leaving', async (t) => {
  const { db, candidate } = await importedCandidate(t, 'StrictAutonomousReview123');
  assert.equal(candidate.topicMatch, 'match');

  const outcome = await applyDiscoveryInspection(db, 'u', {
    candidateId: candidate.id,
    expectedVersion: candidate.version,
    requireTargetVerification: true,
    result: {
      status:'inspected', targetVerified:true, accessible:true, membershipState:'joined',
      observedName:'G22 ADMISSION PROCESS 2025', chatType:'group',
      canWrite:true, activityState:'active',
    },
  }, 110);

  // Unknown facts never trigger an automatic leave (operator decision 2026-10-02); the operator decides.
  assert.equal(outcome.decision, 'review');
  assert.equal(outcome.needsExternalLeave, false);
  assert.ok(outcome.reasonCodes.includes('unknown_member_count'));
  assert.ok(outcome.reasonCodes.includes('unknown_topic_match'));
  assert.ok(!outcome.reasonCodes.includes('unknown_ads_allowed'));
  assert.ok(outcome.reasonCodes.includes('qualification_unverified'));

  const stored = (await readDiscoveryWorkspace(db, 'u')).candidates.find(item => item.id === candidate.id);
  assert.equal(stored.topicMatch, 'unknown');
  const queue = await readDiscoveryExecutorQueue(db, 'u', 10);
  assert.notEqual(queue.tasks.find(item => item.candidateId === candidate.id)?.action, 'leave');
});

void test('inspection can record observed audience mismatch instead of trusting source inference', async (t) => {
  const { db, candidate } = await importedCandidate(t, 'InspectAudienceMismatch123');
  const outcome = await applyDiscoveryInspection(db, 'u', {
    candidateId: candidate.id,
    expectedVersion: candidate.version,
    result: {
      status:'inspected', targetVerified:true, accessible:true, membershipState:'joined',
      observedName:'Прага community', chatType:'group', memberCount:900,
      topicMatch:'mismatch', canWrite:true, adsPolicy:'allowed', activityState:'active',
    },
  }, 110);
  assert.equal(outcome.decision, 'rejected');
  assert.ok(outcome.reasonCodes.includes('topic_mismatch'));
  assert.equal(outcome.needsExternalLeave, true);
  const stored = (await readDiscoveryWorkspace(db, 'u')).candidates.find(item => item.id === candidate.id);
  assert.equal(stored.topicMatch, 'mismatch');
});

void test('joined rejected chat is not hidden before external leave succeeds', async (t) => {
  const { db, candidate, chatId } = await importedCandidate(t, 'InspectReject123');
  const outcome = await applyDiscoveryInspection(db, 'u', {
    candidateId: candidate.id,
    expectedVersion: candidate.version,
    result: {
      status:'inspected', targetVerified:true, accessible:true, membershipState:'joined',
      observedName:'Українці Praha допомога', chatType:'group', memberCount:500,
      canWrite:true, adsPolicy:'allowed', activityState:'active',
    },
  }, 110);
  assert.equal(outcome.decision, 'rejected');
  assert.equal(outcome.workflowStatus, 'ready');
  assert.equal(outcome.needsExternalLeave, true);
  assert.equal(outcome.autoArchived, false);
  assert.ok(outcome.reasonCodes.includes('too_few_members'));
  assert.equal((await readChatState(db, 'u', chatId)).workflow_status, 'ready');
});

void test('joined rejected Viber candidate can complete the canonical external-leave checklist', async (t) => {
  const db = await localDatabase(t);
  const run = await startDiscoveryRun(db, 'u', { platforms: ['viber'], goal: 30, minMembers: 700 }, 100);
  await continueDiscoveryRun(db, 'u', run.id, 101, async () =>
    html('<div>Українці Praha допомога https://invite.viber.com/?g2=ViberReject123</div>'));
  let candidate = (await readDiscoveryWorkspace(db, 'u')).candidates[0];
  assert.ok(candidate);
  assert.equal(candidate.platform, 'viber');
  const handed = await handoffDiscoveryCandidate(db, 'u', candidate.id, candidate.version, 102);
  candidate = (await readDiscoveryWorkspace(db, 'u')).candidates.find(item => item.id === candidate.id);
  const outcome = await applyDiscoveryInspection(db, 'u', {
    candidateId: candidate.id,
    expectedVersion: candidate.version,
    result: {
      status:'inspected', targetVerified:true, accessible:true, membershipState:'joined',
      observedName:'Українці Praha допомога', chatType:'group', memberCount:500,
      topicMatch:'match', canWrite:true, adsPolicy:'allowed', activityState:'active',
    },
  }, 110);
  assert.equal(outcome.decision, 'rejected');
  assert.equal(outcome.needsExternalLeave, true);

  const ready = await readChatState(db, 'u', handed.chatId);
  assert.equal(ready.workflow_status, 'ready');
  const queue = await readDiscoveryExecutorQueue(db, 'u', 10);
  const task = queue.tasks.find(item => item.candidateId === candidate.id);
  assert.equal(task?.action, 'leave');
  assert.equal(task?.platform, 'viber');
  assert.equal(task?.resultAction, 'executor-leave');
  assert.ok(task);
  const completed = await completeDiscoveryExternalLeave(db, 'u', {
    candidateId: task.candidateId,
    expectedVersion: task.candidateVersion,
    chatStateToken: task.chatStateToken,
    targetVerified: true,
  }, 112);
  assert.equal(completed.ok, true);

  const left = await readChatState(db, 'u', handed.chatId);
  assert.equal(left.workflow_status, 'archived');
  assert.equal(left.left_at, 112);
  const stored = (await readDiscoveryWorkspace(db, 'u')).candidates.find(item => item.id === candidate.id);
  assert.equal(stored.membershipState, 'left');
  assert.equal(stored.decision, 'rejected');
});

void test('external leave refuses an unverified target even with a fresh state token', async (t) => {
  const { db, candidate, chatId } = await importedCandidate(t, 'LeaveTargetVerification123');
  const joined = await applyDiscoveryInspection(db, 'u', {
    candidateId:candidate.id, expectedVersion:candidate.version,
    result:{status:'inspected', targetVerified:true, accessible:true, membershipState:'joined', observedName:'Українці Praha допомога', chatType:'group', memberCount:500, topicMatch:'match', canWrite:true, adsPolicy:'allowed', activityState:'active'},
  }, 110);
  assert.equal(joined.needsExternalLeave, true);
  const task = (await readDiscoveryExecutorQueue(db, 'u', 10)).tasks.find(item => item.candidateId === candidate.id);
  assert.ok(task);
  await assert.rejects(() => completeDiscoveryExternalLeave(db, 'u', {candidateId:task.candidateId, expectedVersion:task.candidateVersion, chatStateToken:task.chatStateToken, targetVerified:false}, 111), error => error?.status === 409 && /цільовий чат/i.test(error.message));
  assert.equal((await readChatState(db, 'u', chatId)).workflow_status, 'ready');
});

void test('known invalid invite before join is safely archived without claiming an external leave', async (t) => {
  const { db, candidate, chatId } = await importedCandidate(t, 'InspectMissing123');
  const outcome = await applyDiscoveryInspection(db, 'u', {
    candidateId: candidate.id,
    expectedVersion: candidate.version,
    result: { status:'failed', accessible:false, reason:'whatsapp_chat_missing' },
  }, 110);
  assert.equal(outcome.decision, 'unavailable');
  assert.equal(outcome.workflowStatus, 'archived');
  assert.equal(outcome.autoArchived, true);
  assert.equal(outcome.needsExternalLeave, false);
  assert.equal((await readChatState(db, 'u', chatId)).workflow_status, 'archived');
  const stored = (await readDiscoveryWorkspace(db, 'u')).candidates.find(item => item.id === candidate.id);
  assert.equal(stored.decision, 'unavailable');
  assert.equal(stored.inspectionState, 'failed');
  assert.equal(stored.linkState, 'invalid');
});

void test('inspection is owner scoped and optimistic', async (t) => {
  const { db, candidate } = await importedCandidate(t, 'InspectGuard123');
  await assert.rejects(
    applyDiscoveryInspection(db, 'other', {
      candidateId:candidate.id, expectedVersion:candidate.version,
      result:{status:'pending',targetVerified:true,accessible:true,membershipState:'pending'},
    }, 110),
    /Кандидат не знайдений/,
  );
  await assert.rejects(
    applyDiscoveryInspection(db, 'u', {
      candidateId:candidate.id, expectedVersion:candidate.version + 1,
      result:{status:'pending',targetVerified:true,accessible:true,membershipState:'pending'},
    }, 110),
    /Кандидат уже змінився/,
  );
});


void test('local source search interleaves public-web batches before exhausting the long Telegram plan', async (t) => {
  const { searchLocalDiscoveryPreview } = await import('../lib/chat-discovery/local-preview.ts');
  const db = await localDatabase(t);
  const calls=[];
  const result=await searchLocalDiscoveryPreview(db,'u',{
    platforms:['whatsapp'],telegramCursor:2,sourceCursor:0,knownLinks:[],minMembers:700,
  },100,async(url)=>{
    calls.push(String(url));
    return html('<p>Українці Berlin https://chat.whatsapp.com/InterleavePublic123</p>');
  });
  assert.equal(result.source,'public_web');
  assert.equal(result.telegramCursor,2);
  assert.equal(result.sourceCursor,1);
  assert.ok(calls.some(url=>url.includes('search.brave.com')));
});
