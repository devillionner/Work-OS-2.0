import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { workbookSearchPlan } from '../scripts/chat-discovery-source-crawl.mjs';
import { shouldDeferForGlobalWhatsAppLoading } from '../scripts/whatsapp-web-cdp.mjs';

const realSeedSource=await readFile(new URL('../lib/chat-discovery/seeds.ts',import.meta.url),'utf8');
const realSeed=JSON.parse(realSeedSource.replace(/^export default\s*/u,'').replace(/\s+as const;\s*$/u,''));

const seedData={keywords:['Українці в місті (назва міста)','Батьки + назва міста','Перевезення + назва міста або країни','Українці в країні (назва країни)','Назва села чат'],cities:[
  {country:'Німеччина',name:'Berlin',uk:'Берлін',population:10},
  {country:'Польща',name:'Warsaw',uk:'Варшава',population:9},
  {country:'Німеччина',name:'Hamburg',uk:'Гамбург',population:8},
]};

void test('workbook plan includes compatible keywords, countries and city aliases',()=>{
  const plan=workbookSearchPlan(seedData);
  assert.ok(plan.some(item=>item.query==='Батьки Берлін'));
  assert.ok(plan.some(item=>item.query==='Перевезення Гамбург'));
  // Queries read as natural search phrases: «Українці Польща», not the ungrammatical «Українці в Польща».
  assert.ok(plan.some(item=>item.query==='Українці Польща'));
  assert.ok(plan.some(item=>item.alias==='Українці Berlin'));
  assert.ok(plan.findIndex(item=>item.place==='Варшава')<plan.findIndex(item=>item.place==='Гамбург'));
  assert.ok(plan.every(item=>!item.query.includes('назва села')));
});

void test('workbook plan eventually covers every valid city/template pair beyond the priority tiers',()=>{
  const cities=Array.from({length:60},(_,index)=>({
    country:'Тестова країна',name:'City'+index,uk:'Місто'+index,population:6000-index,
  }));
  const exhaustiveSeed={
    keywords:['Назва міста чат','Українці в місті (назва міста)','Батьки + назва міста'],
    cities,
  };
  const plan=workbookSearchPlan(exhaustiveSeed);
  assert.ok(plan.some(item=>item.query==='Батьки Місто59'),'deep-tail city/template pair must be searchable');
  assert.ok(plan.some(item=>item.alias==='Батьки City59'),'deep-tail Latin alias must be searchable');
});

void test('retries on the same WhatsApp invite do not restart deep-link loading',async()=>{
  const adapter=await readFile(new URL('../scripts/whatsapp-web-cdp.mjs',import.meta.url),'utf8');
  // Invite navigation lives in one sync-aware helper used by inspect, leave and autopost.
  const start=adapter.indexOf('async function openWhatsappInviteWhenSynced');
  const end=adapter.indexOf('export async function inspectWhatsappTaskViaCdp',start);
  const block=adapter.slice(start,end);
  assert.ok(start>0);
  assert.match(block,/current\.searchParams\.get\('code'\) === target\.searchParams\.get\('code'\)\) return \{ kind:'ok', navigated:false \}/u);
  assert.match(block,/lastInviteNavigation\.url === targetUrl/u);
  const inspect=adapter.slice(end,adapter.indexOf('async function findOrCreateWhatsappPage',end));
  assert.match(inspect,/await openWhatsappInviteWhenSynced\(client, page, targetUrl, operationDeadline(, signal)?\)/u);
  assert.doesNotMatch(inspect,/Page\.navigate/u);
});

void test('Discovery waits for a healthy WhatsApp home before reopening invite deep links',async()=>{
  const runner=await readFile(new URL('../scripts/chat-discovery-runner.mjs',import.meta.url),'utf8');
  assert.match(runner,/readWhatsappHomeHealthViaCdp/u);
  assert.match(runner,/async function whatsappHomeReady\(\)/u);
  assert.match(runner,/health\.ready!==true/u);
  assert.match(runner,/WhatsApp Web home is ready again/u);
  const handler=runner.slice(runner.indexOf('async function handleRunCandidateTask'),runner.indexOf('function sendSourceResult'));
  assert.ok(handler.indexOf('await whatsappHomeReady()')<handler.indexOf('await processLocalPreflightVisible(task)'));
  const adapter=await readFile(new URL('../scripts/whatsapp-web-cdp.mjs',import.meta.url),'utf8');
  const start=adapter.indexOf('export async function readWhatsappHomeHealthViaCdp');
  const end=adapter.indexOf('export async function resetWhatsappPageViaCdp',start);
  const block=adapter.slice(start,end);
  assert.match(block,/messagesLoadingPattern\.test/u);
  assert.match(block,/authenticated/u);
  assert.match(block,/ready:home&&authenticated&&!loading/u);
});

void test('WhatsApp page selection keeps one controlled tab and closes duplicates',async()=>{
  const source=await readFile(new URL('../scripts/whatsapp-web-cdp.mjs',import.meta.url),'utf8');
  const start=source.indexOf('async function findOrCreateWhatsappPage');
  const end=source.indexOf('export function shouldDeferForGlobalWhatsAppLoading',start);
  const block=source.slice(start,end);
  assert.match(block,/whatsappPages\.find\(\(page\)=>page\.url==='https:\/\/web\.whatsapp\.com\/'/u);
  assert.match(block,/json\/close\//u);
  assert.match(block,/Promise\.allSettled/u);
});

void test('repeated global WhatsApp loading triggers a bounded self-heal reload',async()=>{
  const runner=await readFile(new URL('../scripts/chat-discovery-runner.mjs',import.meta.url),'utf8');
  assert.match(runner,/WHATSAPP_LOADING_RELOAD_AFTER=3/u);
  assert.match(runner,/WHATSAPP_LOADING_RELOAD_COOLDOWN_MS=120000/u);
  assert.match(runner,/resetWhatsappPageViaCdp/u);
  assert.match(runner,/whatsappLoadingSignals>=WHATSAPP_LOADING_RELOAD_AFTER/u);
  assert.match(runner,/stayed on message loading; reloaded home and will resume after cooldown/u);
  const adapter=await readFile(new URL('../scripts/whatsapp-web-cdp.mjs',import.meta.url),'utf8');
  const start=adapter.indexOf('export async function resetWhatsappPageViaCdp');
  const end=adapter.indexOf('export async function inspectWhatsappTaskViaCdp',start);
  const block=adapter.slice(start,end);
  assert.match(block,/Page\.navigate/u);
  assert.match(block,/https:\/\/web\.whatsapp\.com\//u);
});

void test('global WhatsApp message loading is deferred without burning the full invite timeout',async()=>{
  assert.equal(shouldDeferForGlobalWhatsAppLoading({
    bodyText:'WhatsApp — Messages are loading. Keep this window open.',composer:false,headerNames:[],targetHeadings:[],
  }),true);
  assert.equal(shouldDeferForGlobalWhatsAppLoading({
    bodyText:'Messages are loading',composer:true,headerNames:['Українці Berlin'],targetHeadings:[],
  }),false);
  const adapter=await readFile(new URL('../scripts/whatsapp-web-cdp.mjs',import.meta.url),'utf8');
  assert.match(adapter,/reason:'whatsapp_messages_loading'/u);
  const runner=await readFile(new URL('../scripts/chat-discovery-runner.mjs',import.meta.url),'utf8');
  assert.match(runner,/WHATSAPP_LOADING_COOLDOWN_MS=10000/u);
  // The short 10s cooldown applies only to this reason; every other transient reason waits the full 5 min.
  assert.match(runner,/reason==='whatsapp_messages_loading'\?WHATSAPP_LOADING_COOLDOWN_MS:WHATSAPP_RUNTIME_COOLDOWN_MS/u);
});

void test('real workbook plan is bounded around high-yield intents instead of the 84k brute-force tail',()=>{
  const plan=workbookSearchPlan(realSeed);
  assert.ok(plan.length>=500,'plan must keep broad diaspora coverage');
  assert.ok(plan.length<5000,'plan must stay bounded enough for outcome-driven runs');
  assert.ok(plan.slice(0,40).some(item=>item.query.includes('Німеччина')));
  assert.ok(plan.slice(0,40).some(item=>item.query.includes('Польща')));
  assert.ok(plan.some(item=>/Батьки|Мамочки/iu.test(item.query)));
  assert.ok(plan.some(item=>/Перевізники|Перевезення/iu.test(item.query)));
});

void test('WhatsApp topic matcher includes local-language Ukrainian identity roots',async()=>{
  const adapter=await readFile(new URL('../scripts/whatsapp-web-cdp.mjs',import.meta.url),'utf8');
  const identity=adapter.match(/const ukrainianAudiencePattern = ([^;]+);/u)?.[1]||'';
  for(const root of ['ukraiń','ukrajin','ucrain','oekra'])assert.ok(identity.includes(root),root);
});

void test('runner passes invite metadata into joined qualification to avoid redundant info opening',async()=>{
  const source=await readFile(new URL('../scripts/chat-discovery-runner.mjs',import.meta.url),'utf8');
  assert.match(source,/preflightFacts:pre/u);
  const adapter=await readFile(new URL('../scripts/whatsapp-web-cdp.mjs',import.meta.url),'utf8');
  const start=adapter.indexOf('async function enrichJoinedQualification');
  const end=adapter.indexOf('async function focusAndClearComposer',start);
  const enrich=adapter.slice(start,end);
  // The invite metadata (preflightFacts) is spread first so the live snapshot only fills gaps.
  assert.match(enrich,/\.\.\.preflightFacts/u);
  assert.match(enrich,/const needsInfo=!Number\.isFinite\(combined\.memberCount\)\|\|!combined\.adsPolicy\|\|!combined\.topicMatch/u);
  assert.match(enrich,/if\(!needsInfo\)return/u);
  assert.match(adapter,/waitForJoinedChatReady\(client, timeoutMs=8_000\)/u);
});

void test('metadata failure defers candidate without opening the heavy WhatsApp UI',async()=>{
  const source=await readFile(new URL('../scripts/chat-discovery-runner.mjs',import.meta.url),'utf8');
  const start=source.indexOf('async function processLocalPreflight');
  const end=source.indexOf('async function resolveRunSourcePlan',start);
  const process=source.slice(start,end);
  const metadataFailure=process.indexOf("queried.kind!=='result'");
  assert.ok(metadataFailure>=0);
  const block=process.slice(metadataFailure,process.indexOf('pre=queried.result',metadataFailure));
  // The heavy exact-invite UI fallback only runs on the last bounded attempt; every earlier
  // attempt (and a failed/skipped fallback) falls straight through to the bounded local defer.
  const attemptGate=block.indexOf('Number(task.checkpoint?.attempts)>=3');
  const heavyUi=block.indexOf('inspectWhatsappTaskViaCdp');
  const deferCall=block.lastIndexOf('return deferLocalPreflight(task,queried.reason');
  assert.ok(attemptGate>=0&&heavyUi>attemptGate&&deferCall>heavyUi);
});

void test('the source plan travels from the owner DO to the runner with every run and reconnect',async()=>{
  const channel=await readFile(new URL('../workers/owner-channel.js',import.meta.url),'utf8');
  assert.match(channel,/import chatDiscoverySeeds from '\.\.\/lib\/chat-discovery\/seeds\.ts';/u);
  assert.match(channel,/type: 'run_plan', process: 'discovery_run', runId, seedData: chatDiscoverySeeds, telegramGroups: await loadTelegramGroups\(this\.ctx\.storage\)/u);
  assert.match(channel,/if \(run\.running && run\.runId\) \{\s*server\.send\(JSON\.stringify\(await this\.runPlanMessage\(run\.runId\)\)\);/u);
});

void test('source bridge keeps cursor on preview failure and reports a resumable stop',async()=>{
  // The tab bridge became lib/chat-discovery/run-state.ts#applySourceBatch (2026-10-04).
  const { EMPTY_RUN, applySourceBatch, canResume } = await import('../lib/chat-discovery/run-state.ts');
  const { state, errors } = applySourceBatch({ ...EMPTY_RUN, runId:'run', running:true, telegramCursor:15, sourceFailures:2 },
    { searched:1, nextCursor:16, totalTasks:100, done:true },
    [{ ok:false, sourceUrl:'https://t.me/s/test', query:'test', reason:'preview_http_503' }], Date.now());
  assert.equal(errors,1);
  assert.equal(state.telegramCursor,15);
  assert.equal(state.sourceExhausted,false);
  assert.equal(state.running,false);
  assert.equal(state.completionReason,'source_error');
  assert.equal(state.sourceIssues[0].reason,'preview_http_503');
  assert.equal(canResume(state),true);
});

void test('local lists split work, targets and non-targets while the target list stays strict',async()=>{
  const source=await readFile(new URL('../components/chat-discovery-dialog.tsx',import.meta.url),'utf8');
  const {stripTypeScriptTypes}=await import('node:module');
  const fn=source.slice(source.indexOf('function localCandidatesForFilter'),source.indexOf('function archiveItem'));
  const filter=new Function('NON_TARGET_STATES',stripTypeScriptTypes(fn)+'\nreturn localCandidatesForFilter;')(new Set(['rejected','skipped','unavailable']));
  const candidates=[{preflightState:'target'},{preflightState:'queued'},{preflightState:'rejected'},{preflightState:'skipped'},{preflightState:'unavailable'},{preflightState:'review'}];
  assert.deepEqual(filter(candidates,'active'),[candidates[5],candidates[1]]);
  assert.deepEqual(filter(candidates,'target'),[candidates[0]]);
  assert.deepEqual(filter(candidates,'rejected'),[candidates[2],candidates[3],candidates[4]]);
});

void test('WhatsApp metadata maps bad-request and gone invite responses to invalid links',async()=>{
  const adapter=await readFile(new URL('../scripts/whatsapp-web-cdp.mjs',import.meta.url),'utf8');
  const start=adapter.indexOf('export async function queryWhatsappInviteViaCdp');
  const end=adapter.indexOf('export async function joinWhatsappInviteViaRuntime',start);
  const query=adapter.slice(start,end);
  assert.match(query,/bad\[- \]request\|gone/);
  assert.match(query,/reason:'invalid_whatsapp_link'/);
});

void test('real workbook fast lane prioritizes large diaspora markets before bounded fallback',()=>{
  const plan=workbookSearchPlan(realSeed);
  const first80=plan.slice(0,80);
  assert.ok(first80.some(item=>item.query==='Українці Німеччина'));
  assert.ok(first80.some(item=>item.query==='Оголошення Польща українці'));
  assert.ok(first80.some(item=>item.query==='Берлін чат'));
  assert.ok(first80.some(item=>item.query==='Батьки Варшава'));
  assert.ok(first80.some(item=>item.query==='Перевізники Гамбург'));
  assert.ok(plan.filter(item=>item.place==='Берлін').length>=4);
});

void test('fast lane favors writable community intents over duplicate English variants',()=>{
  const plan=workbookSearchPlan(realSeed);
  const berlin=plan.filter(item=>item.place==='Берлін').slice(0,7).map(item=>item.query);
  assert.ok(berlin.some(query=>/Мамочки/iu.test(query)));
  assert.ok(berlin.some(query=>/Батьки/iu.test(query)));
  assert.ok(berlin.some(query=>/Барахолка/iu.test(query)));
  assert.ok(berlin.some(query=>/Перевізники|Перевезення/iu.test(query)));
  assert.equal(berlin.some(query=>/^Ukrainian in |^Ukrainians /iu.test(query)),false);
});

void test('direct qualification ignores WhatsApp service events for activity',async()=>{
  const source=await readFile(new URL('../scripts/whatsapp-web-cdp.mjs',import.meta.url),'utf8');
  const start=source.indexOf('export async function joinWhatsappInviteViaRuntime');
  const end=source.indexOf('export async function leaveWhatsappGroupViaRuntime',start);
  const block=source.slice(start,end);
  assert.match(block,/userMessages=messages\.filter/);
  assert.match(block,/gp2\|e2e_notification\|notification\|protocol\|ciphertext/);
  // Activity is derived from evidenceMessages (userMessages further bounded to after the join time).
  assert.match(block,/latestTimestamp=Math\.max\(0,\.\.\.evidenceMessages/);
});

void test('joined community subgroup inherits factual parent topic evidence',async()=>{
  const source=await readFile(new URL('../scripts/whatsapp-web-cdp.mjs',import.meta.url),'utf8');
  const start=source.indexOf('export async function joinWhatsappInviteViaRuntime');
  const end=source.indexOf('export async function leaveWhatsappGroupViaRuntime',start);
  const block=source.slice(start,end);
  assert.match(block,/parentCommunityTitle/);
  assert.match(block,/parentCommunityDescription/);
  assert.match(block,/value\.parentTitle/);
  assert.match(block,/sourceWasCommunity:value\.preIsParentGroup===true\|\|Boolean\(value\.parentId\)/);
});

void test('fresh UI and CDP discovery runs start the Telegram group plan at its first step',async()=>{
  const { EMPTY_RUN, startRun } = await import('../lib/chat-discovery/run-state.ts');
  const started=startRun({ ...EMPTY_RUN, telegramCursor:57, candidates:[] },{ runId:'new', goal:10, now:1 });
  assert.equal(started.telegramCursor,0);
  assert.equal(EMPTY_RUN.telegramCursor,0);
});

void test('joined qualification reads a deeper factual history without relaxing criteria',async()=>{
  const adapter=await readFile(new URL('../scripts/whatsapp-web-cdp.mjs',import.meta.url),'utf8');
  const start=adapter.indexOf('export async function joinWhatsappInviteViaRuntime');
  const end=adapter.indexOf('export async function leaveWhatsappGroupViaRuntime',start);
  const block=adapter.slice(start,end);
  assert.match(block,/loadEarlierMsgs/);
  assert.match(block,/historyPage<2/);
  assert.match(block,/models\.slice\(-100\)/);
  assert.match(block,/slice\(-80\)/);
  assert.match(block,/ukrainianMessages>=2\?'match':'unknown'/);
  assert.match(block,/adLikeMessagePattern\.test\(text\)\)\.length>=2/);
});

void test('source feedback storage is bounded, local-only, and only receives successful preview stats',async()=>{
  const runState=await readFile(new URL('../lib/chat-discovery/run-state.ts',import.meta.url),'utf8');
  assert.match(runState,/now \+ 6 \* 60 \* 60 \* 1000/);
  assert.match(runState,/\.slice\(-500\)/);
  const batch=runState.slice(runState.indexOf('export function applySourceBatch'),runState.indexOf('export function markConfirmed'));
  const failureGuard=batch.indexOf('if (!outcome.ok)');
  const statsWrite=batch.indexOf('sourceStats.push');
  assert.ok(failureGuard>0&&statsWrite>failureGuard,'failed previews never produce feedback stats');
});
