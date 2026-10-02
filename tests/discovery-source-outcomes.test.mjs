import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { crawlLocalDiscoverySource, workbookSearchPlan, discoverRelatedTelegramSources, telegramWhatsAppSearchPreview, extractRelevantInviteSnippets, rankTelegramDirectoryResults, rankLyzemTelegramSources } from '../scripts/chat-discovery-source-crawl.mjs';
import { shouldDeferForGlobalWhatsAppLoading } from '../scripts/whatsapp-web-cdp.mjs';

const realSeedSource=await readFile(new URL('../lib/chat-discovery/seeds.ts',import.meta.url),'utf8');
const realSeed=JSON.parse(realSeedSource.replace(/^export default\s*/u,'').replace(/\s+as const;\s*$/u,''));

const seedData={keywords:['Українці в місті (назва міста)','Батьки + назва міста','Перевезення + назва міста або країни','Українці в країні (назва країни)','Назва села чат'],cities:[
  {country:'Німеччина',name:'Berlin',uk:'Берлін',population:10},
  {country:'Польща',name:'Warsaw',uk:'Варшава',population:9},
  {country:'Німеччина',name:'Hamburg',uk:'Гамбург',population:8},
]};
const invite='https://chat.whatsapp.com/AbCdEfGh123456';
const page='<title>Українці · тест</title><p>Українці батьки оголошення '+invite+'</p>';
const response=(text,status=200)=>new Response(text,{status});

void test('workbook plan includes compatible keywords, countries and city aliases',()=>{
  const plan=workbookSearchPlan(seedData);
  assert.ok(plan.some(item=>item.query==='Батьки Берлін'));
  assert.ok(plan.some(item=>item.query==='Перевезення Гамбург'));
  assert.ok(plan.some(item=>item.query==='Українці в Польща'));
  assert.ok(plan.some(item=>item.alias==='Українці в Berlin'));
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
  assert.match(inspect,/await openWhatsappInviteWhenSynced\(client, page, targetUrl, operationDeadline\)/u);
  assert.doesNotMatch(inspect,/Page\.navigate/u);
});

void test('Discovery waits for a healthy WhatsApp home before reopening invite deep links',async()=>{
  const runner=await readFile(new URL('../scripts/chat-discovery-runner.mjs',import.meta.url),'utf8');
  assert.match(runner,/readWhatsappHomeHealthViaCdp/u);
  assert.match(runner,/health\.home===true/u);
  assert.match(runner,/health\.ready!==true/u);
  assert.match(runner,/WhatsApp Web home is ready again/u);
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
  assert.match(runner,/WHATSAPP_INVITE_LOADING_COOLDOWN_MS=120000/u);
  assert.match(runner,/resetWhatsappPageViaCdp/u);
  assert.match(runner,/markTaskBlocked\(task,'whatsapp_invite_loading',WHATSAPP_INVITE_LOADING_COOLDOWN_MS\)/u);
  assert.match(runner,/returned home, paused this invite locally, and kept it queued for a later retry/u);
  const adapter=await readFile(new URL('../scripts/whatsapp-web-cdp.mjs',import.meta.url),'utf8');
  const start=adapter.indexOf('export async function resetWhatsappPageViaCdp');
  const end=adapter.indexOf('export async function inspectWhatsappTaskViaCdp',start);
  const block=adapter.slice(start,end);
  assert.match(block,/Page\.navigate/u);
  assert.match(block,/https:\/\/web\.whatsapp\.com\//u);
});

void test('legacy target_not_verified outcomes are requeued only once',async()=>{
  const source=await readFile(new URL('../scripts/whatsapp-web-cdp.mjs',import.meta.url),'utf8');
  const start=source.indexOf('const legacyReasons=');
  const end=source.indexOf('if(resultsChanged)',start);
  const block=source.slice(start,end);
  assert.match(block,/preflightState==='unavailable'/u);
  assert.match(block,/legacyReasons\.length===1/u);
  assert.match(block,/legacyReasons\[0\]==='target_not_verified'/u);
  assert.match(block,/!Number\.isFinite\(item\?\.memberCount\)/u);
  assert.match(block,/revalidationVersion!=='target-verification-v2'/u);
  assert.match(block,/preflightState='queued'/u);
  assert.match(block,/delete results\[item\.id\]/u);
});

void test('legacy Brave rate-limit source stop is narrowly recoverable',async()=>{
  const source=await readFile(new URL('../scripts/whatsapp-web-cdp.mjs',import.meta.url),'utf8');
  const start=source.indexOf('const recoverableLegacySearchStop=');
  const end=source.indexOf('const resultRaw=',start);
  const block=source.slice(start,end);
  assert.match(block,/completionReason==='source_error'/u);
  assert.match(block,/search\\\\\.brave\\\\\.com/u);
  assert.match(block,/source_http_429/u);
  assert.match(block,/running:true/u);
  assert.match(block,/sourceFailures:0/u);
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
  assert.match(runner,/without penalizing the candidate/u);
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

void test('discovered Telegram sources use channel-level WhatsApp search',()=>{
  assert.equal(
    telegramWhatsAppSearchPreview('https://t.me/refugeesbremen'),
    'https://t.me/s/refugeesbremen?q=chat.whatsapp.com'
  );
  assert.equal(
    telegramWhatsAppSearchPreview('https://t.me/s/refugeesbremen?before=123'),
    'https://t.me/s/refugeesbremen?before=123'
  );
});

void test('Telegram source graph discovers relevant neighboring channels without web search',()=>{
  const added=discoverRelatedTelegramSources(
    '<title>Українці Бремен</title><p>Допомога українцям: https://t.me/refugeesbremen</p><p>bot https://t.me/uahelp_FAQ_bot</p>',
    'https://t.me/s/ukrainebremen','Бремен','Українці Бремен'
  );
  assert.equal(added,1);
});

void test('web-search 429 does not fail the source step when Telegram graph fallback exists',async()=>{
  const graphPage='<title>Українці Бремен</title><p>Українці: https://t.me/refugeesbremen</p>';
  discoverRelatedTelegramSources(graphPage,'https://t.me/s/ukrainebremen','Бремен','Українці Бремен');
  const result=await crawlLocalDiscoverySource(15,{seedData,fetcher:async(url)=>{
    if(String(url).includes('refugeesbremen'))return response(page);
    if(String(url).includes('search.brave.com'))return response('rate limited',429);
    return response('<title>Українці</title>');
  }});
  assert.equal(result.errors.length,0);
  assert.equal(result.nextCursor,16);
  assert.ok(result.sources.some(source=>source.text.includes(invite)));
});

void test('search advances with a warning when all optional search sources are unavailable',async()=>{
  const result=await crawlLocalDiscoverySource(15,{seedData,fetcher:async(url)=>{
    if(String(url).includes('tg.me/search'))return response('directory down',503);
    if(String(url).includes('search.brave.com'))return response('Too many requests',429);
    return response('<title>Українці</title>');
  }});
  assert.equal(result.errors.length,0);
  assert.equal(result.deferred,false);
  assert.equal(result.nextCursor,16);
  assert.ok(result.warnings.some(item=>String(item.reason).includes('optional_search_sources_unavailable')));
});


void test('TG.ME directory ranks concrete Ukrainian Telegram posts',()=>{
  const html='<a href="/news/1">noise</a><div>Українці Берлін допомога <a href="/berlinlife_ua/4912">post</a></div>';
  const ranked=rankTelegramDirectoryResults(html,'Берлін');
  assert.equal(ranked[0],'https://tg.me/berlinlife_ua/4912');
});

void test('TG.ME answer lets cursor advance even when optional Brave search is rate-limited',async()=>{
  const result=await crawlLocalDiscoverySource(15,{seedData,fetcher:async(url)=>{
    const value=String(url);
    if(value.includes('tg.me/search'))return response('<a href="/berlinlife_ua/4912">Українці Берлін WhatsApp</a>');
    if(value.includes('tg.me/berlinlife_ua/4912'))return response('<title>Українці Берлін</title><p>Без актуального invite у цьому пості</p>');
    if(value.includes('search.brave.com'))return response('Too many requests',429);
    return response('<title>Українці</title>');
  }});
  assert.equal(result.errors.length,0);
  assert.equal(result.deferred,false);
  assert.equal(result.nextCursor,16);
  assert.ok(result.warnings.some(item=>String(item.reason).includes('optional_web_search_deferred')));
});

void test('TG.ME post result can feed a WhatsApp invite directly into local preview source',async()=>{
  const result=await crawlLocalDiscoverySource(15,{seedData,fetcher:async(url)=>{
    const value=String(url);
    if(value.includes('tg.me/search'))return response('<div>Українці Берлін WhatsApp <a href="/berlinlife_ua/4912">post</a></div>');
    if(value.includes('tg.me/berlinlife_ua/4912'))return response('<title>Українці Берлін</title><p>Українці батьки оголошення '+invite+'</p>');
    if(value.includes('search.brave.com'))return response('Too many requests',429);
    return response('<title>Українці</title>');
  }});
  assert.equal(result.errors.length,0);
  assert.equal(result.nextCursor,16);
  assert.ok(result.sources.some(source=>source.text.includes(invite)));
});

void test('directory channel result is searched inside Telegram for group invites',async()=>{
  const calls=[];
  const result=await crawlLocalDiscoverySource(15,{seedData,fetcher:async(url)=>{
    const value=String(url); calls.push(value);
    if(value.includes('tg.me/search'))return response('<div>Українці Берлін <a href="/berlin_ua2">channel</a></div>');
    if(value.includes('t.me/s/berlin_ua2')&&value.includes('chat.whatsapp.com'))return response('<title>Українці Берлін</title><p>Чат громади '+invite+'</p>');
    if(value.includes('search.brave.com'))return response('Too many requests',429);
    return response('<title>Українці</title>');
  }});
  assert.ok(calls.some(url=>url.includes('t.me/s/berlin_ua2')&&url.includes('chat.whatsapp.com')));
  assert.ok(result.sources.some(source=>source.text.includes(invite)));
  assert.equal(result.nextCursor,16);
});

void test('directory discovery still runs when Telegram graph already returns known-style sources',async()=>{
  const source=await readFile(new URL('../scripts/chat-discovery-source-crawl.mjs',import.meta.url),'utf8');
  assert.match(source,/if\(sources\.length<8\)/);
  assert.doesNotMatch(source,/if\(!sources\.length\)\{\n\s+const directoryQueries/);
});

void test('local-language Ukrainian identities keep WhatsApp invites in Telegram extraction',()=>{
  for(const title of [
    'Ucranianos en Valencia',
    'Ucraini in Italia',
    'Ukraińcy w Warszawie',
    'Ukrajinci v Praze',
    'Oekraïners in Nederland',
  ]){
    const found=extractRelevantInviteSnippets('<p>'+title+' спільнота '+invite+'</p>',title);
    assert.ok(found.some(item=>item.includes(invite)),title);
  }
});

void test('WhatsApp topic matcher includes local-language Ukrainian identity roots',async()=>{
  const adapter=await readFile(new URL('../scripts/whatsapp-web-cdp.mjs',import.meta.url),'utf8');
  const identity=adapter.match(/const ukrainianIdentityPattern = ([^;]+);/u)?.[1]||'';
  for(const root of ['ukraiń','ukrajin','ucrain','ucran','oekra'])assert.ok(identity.includes(root),root);
});
void test('runtime crawl requires the source plan instead of private raw GitHub',async()=>{
  const source=await readFile(new URL('../scripts/chat-discovery-source-crawl.mjs',import.meta.url),'utf8');
  assert.doesNotMatch(source,/raw\.githubusercontent\.com/iu);
  const result=await crawlLocalDiscoverySource(15);
  assert.equal(result.nextCursor,15);
  assert.equal(result.done,false);
  assert.match(result.errors[0].reason,/source_plan_missing/);
});

void test('dead bootstrap source is warned and skipped instead of freezing the cursor',async()=>{
  const result=await crawlLocalDiscoverySource(0,{seedData,fetcher:async()=>response('unavailable',503)});
  assert.equal(result.nextCursor,1);
  assert.equal(result.done,false);
  assert.equal(result.errors.length,0);
  assert.match(result.warnings[0].reason,/source_http_503/);
});

void test('search challenge skips the exact query when Telegram directory also fails',async()=>{
  const result=await crawlLocalDiscoverySource(15,{seedData,fetcher:async(url)=>{
    if(String(url).includes('tg.me/search'))return response('directory down',503);
    return response('<title>Verify you are human</title>');
  }});
  assert.equal(result.nextCursor,16);
  assert.equal(result.done,false);
  assert.equal(result.errors.length,0);
  assert.equal(result.deferred,false);
  assert.ok(result.warnings.some(item=>String(item.reason).includes('optional_search_sources_unavailable')));
});

void test('temporary external search failure warns and advances when Telegram directory also fails',async()=>{
  const result=await crawlLocalDiscoverySource(15,{seedData,fetcher:async(url)=>{
    if(String(url).includes('tg.me/search'))return response('directory down',503);
    if(String(url).includes('search.brave.com'))return response('temporary',503);
    return response('<title>Українці</title>');
  }});
  assert.equal(result.nextCursor,16);
  assert.equal(result.deferred,false);
  assert.ok(result.warnings.some(item=>String(item.reason).includes('optional_search_sources_unavailable')));
});

void test('curl HTTP status trailer has no escaped-newline parsing ambiguity',async()=>{
  const source=await readFile(new URL('../scripts/chat-discovery-source-crawl.mjs',import.meta.url),'utf8');
  assert.match(source,/'-w',marker\+'%\{http_code\}'/u);
  assert.match(source,/raw\.lastIndexOf\(marker\)/u);
  assert.doesNotMatch(source,/lastIndexOf\('\\\\n'\+marker\)/u);
});

void test('source crawl keeps scanning Telegram history even after a current-page invite',async()=>{
  const urls=[];
  const invite2='https://chat.whatsapp.com/ZyXwVuTs987654';
  const result=await crawlLocalDiscoverySource(15,{seedData,fetcher:async(url)=>{
    urls.push(String(url));
    if(String(url).includes('search.brave.com')){
      return response('<a href="https://t.me/test_history_ua">Українці Berlin chat.whatsapp.com</a>');
    }
    if(String(url).includes('before=123')){
      return response('<title>Українці</title><p>Українці батьки оголошення '+invite2+'</p>');
    }
    return response('<title>Українці</title><p>Українці чат оголошення '+invite+'</p><a href="/s/test_history_ua?before=123">Older</a>');
  }});
  assert.equal(result.errors.length,0);
  assert.equal(result.nextCursor,16);
  assert.equal(result.sources.length,1);
  assert.ok(result.sources[0].text.includes(invite));
  assert.ok(result.sources[0].text.includes(invite2));
  assert.ok(urls.some(url=>url.includes('before=123')));
});

async function preflightHarness() {
  const source=await readFile(new URL('../scripts/chat-discovery-runner.mjs',import.meta.url),'utf8');
  const evaluate=source.slice(source.indexOf('function evaluateLocalPreflight'),source.indexOf('async function processLocalPreflight'));
  const process=source.slice(source.indexOf('async function processLocalPreflight'),source.indexOf('async function crawlLocalDiscoveryBatch'));
  const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
  return new AsyncFunction('queryWhatsappInviteViaCdp','inspectWhatsappTaskViaCdp','writeWorkOsLocalDiscoveryResultViaCdp','leaveWhatsappTaskViaCdp','repeats',[
    "const whatsappCdp='http://127.0.0.1:9222',baseUrl='https://staging.example';",
    "const qualificationAttempts=new Map(),INCOMPLETE_QUALIFICATION_COOLDOWN_MS=15000,METADATA_RETRY_COOLDOWN_MS=60000,METADATA_INCOMPLETE_COOLDOWN_MS=60000,markTaskBlocked=()=>{};",
    evaluate,process,
    "for(let i=0;i<repeats;i++)await processLocalPreflight({candidateId:'candidate',minMembers:700});",
  ].join('\n'));
}

void test('runner passes invite metadata into joined qualification to avoid redundant info opening',async()=>{
  const source=await readFile(new URL('../scripts/chat-discovery-runner.mjs',import.meta.url),'utf8');
  assert.match(source,/preflightFacts:/u);
  assert.match(source,/memberCount:pre\.memberCount/u);
  assert.match(source,/adsPolicy:pre\.adsPolicy/u);
  const adapter=await readFile(new URL('../scripts/whatsapp-web-cdp.mjs',import.meta.url),'utf8');
  const start=adapter.indexOf('async function enrichJoinedQualification');
  const end=adapter.indexOf('async function focusAndClearComposer',start);
  const enrich=adapter.slice(start,end);
  assert.match(enrich,/const needsInfo=!Number\.isFinite\(combined\.memberCount\)\|\|!combined\.adsPolicy\|\|!combined\.topicMatch/u);
  assert.match(enrich,/if\(!needsInfo\)return/u);
  assert.match(adapter,/waitForJoinedChatReady\(client, timeoutMs=8_000\)/u);
});

void test('metadata failure defers candidate without opening the heavy WhatsApp UI',async()=>{
  const source=await readFile(new URL('../scripts/chat-discovery-runner.mjs',import.meta.url),'utf8');
  const start=source.indexOf('async function processLocalPreflight');
  const end=source.indexOf('async function resolveLocalSourceSeedData',start);
  const process=source.slice(start,end);
  assert.match(process,/queried\?\.kind!=='result'/u);
  assert.match(process,/METADATA_RETRY_COOLDOWN_MS/u);
  assert.match(process,/deferred so another candidate can continue/u);
  const metadataFailure=process.indexOf("queried?.kind!=='result'");
  const heavyUi=process.indexOf('inspectWhatsappTaskViaCdp');
  assert.ok(metadataFailure>=0&&heavyUi>metadataFailure);
  assert.match(process.slice(metadataFailure,heavyUi),/return 'local_task'/u);
});

void test('unknown qualification has bounded retries and never leaves a joined chat',async()=>{
  const run=await preflightHarness();
  const outcomes=[];let left=0;
  await run(async()=>({kind:'result',result:{
    status:'invite_queried',targetVerified:true,accessible:true,observedName:'candidate',chatType:'group',
    memberCount:800,topicMatch:'match',canWrite:true,approvalRequired:false,description:'',groupId:'group',
  }}),async()=>({kind:'result',result:{
    status:'inspected',membershipState:'joined',chatType:'group',memberCount:800,topicMatch:'match',canWrite:true,
    adsPolicy:'unknown',activityState:'unknown',accessible:true,targetVerified:true,
  }}),async(_url,_id,payload)=>outcomes.push(payload),async()=>{left++;},3);
  assert.equal(left,0);
  assert.equal(outcomes.length,1);
  assert.equal(outcomes[0].decision,'unavailable');
  assert.ok(outcomes[0].reasonCodes.includes('unknown_activity'));
  assert.equal(outcomes[0].result.status,'incomplete');
});

void test('source plan is read from the authorized Work OS browser session without HTTP',async()=>{
  const source=await readFile(new URL('../scripts/whatsapp-web-cdp.mjs',import.meta.url),'utf8');
  const fn=source.slice(source.indexOf('export async function readWorkOsLocalDiscoverySeedDataViaCdp'),source.indexOf('export async function applyWorkOsLocalDiscoverySourceBatchViaCdp')).replace('export ','');
  assert.doesNotMatch(fn,/fetch\s*\(/u);
  const {runInNewContext}=await import('node:vm');
  const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
  const store=new Map([['work-os:chat-discovery-source-seeds:v1',JSON.stringify({...seedData,version:7})]]);
  const sandbox={sessionStorage:{getItem:key=>store.get(key)||null}};
  const run=new AsyncFunction('listWorkOsPagesForCdp','createCdpClient','sandbox','runInNewContext',
    fn+'\nreturn readWorkOsLocalDiscoverySeedDataViaCdp(\'https://staging.example\',{});');
  const result=await run(async()=>({pages:[{webSocketDebuggerUrl:'local'}]}),async()=>({
    send:async(_method,args)=>({result:{value:await runInNewContext(args.expression,sandbox)}}),close:()=>{},
  }),sandbox,runInNewContext);
  assert.equal(result.kind,'result');
  assert.equal(result.version,7);
  assert.equal(result.seedData.cities[0].name,'Berlin');
});

void test('hydration restores the browser-local source plan after F5 or deploy',async()=>{
  const source=await readFile(new URL('../components/chat-discovery-dialog.tsx',import.meta.url),'utf8');
  const writes=[...source.matchAll(/sessionStorage\.setItem\(LOCAL_SOURCE_SEEDS_KEY,JSON\.stringify\(chatDiscoverySeeds\)\)/gu)];
  assert.ok(writes.length>=2,'plan should be written on hydration and explicit start');
  assert.match(source,/if\(!localPreviewHydrated\)return;[\s\S]{0,500}LOCAL_SOURCE_SEEDS_KEY/u);
});

void test('autonomous search writes the source plan into browser session storage',async()=>{
  const source=await readFile(new URL('../components/chat-discovery-dialog.tsx',import.meta.url),'utf8');
  assert.match(source,/sessionStorage\.setItem\(LOCAL_SOURCE_SEEDS_KEY,JSON\.stringify\(chatDiscoverySeeds\)\)/u);
});

void test('source bridge keeps cursor on preview failure and reports a resumable stop',async()=>{
  const source=await readFile(new URL('../scripts/whatsapp-web-cdp.mjs',import.meta.url),'utf8');
  const fn=source.slice(source.indexOf('export async function applyWorkOsLocalDiscoverySourceBatchViaCdp'),source.indexOf('export async function writeWorkOsLocalDiscoveryResultViaCdp')).replace('export ','');
  const {runInNewContext}=await import('node:vm');
  const key='preview';
  const store=new Map([[key,JSON.stringify({runId:'run',running:true,telegramCursor:15,sourceFailures:2,candidates:[]})]]);
  const sandbox={
    sessionStorage:{getItem:key=>store.get(key),setItem:(key,value)=>store.set(key,value)},
    window:{dispatchEvent:()=>{}},CustomEvent:class {},
    fetch:async()=>new Response('busy',{status:503}),
  };
  const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
  const run=new AsyncFunction('listWorkOsPagesForCdp','createCdpClient','batch',
    "const WORK_OS_LOCAL_PREVIEW_KEY='preview';\n"+fn+"\nreturn applyWorkOsLocalDiscoverySourceBatchViaCdp('https://staging.example',batch,{});");
  const result=await run(async()=>({pages:[{webSocketDebuggerUrl:'local'}]}),async()=>({
    send:async(_method,args)=>({result:{value:await runInNewContext(args.expression,sandbox)}}),close:()=>{},
  }),{searched:1,nextCursor:16,totalTasks:100,done:true,sources:[{sourceUrl:'https://t.me/s/test',text:'invite',query:'test'}],errors:[]});
  const state=JSON.parse(store.get(key));
  assert.equal(result.errors,1);
  assert.equal(state.telegramCursor,15);
  assert.equal(state.sourceExhausted,false);
  assert.equal(state.running,false);
  assert.equal(state.completionReason,'source_error');
  assert.equal(state.sourceIssues[0].reason,'preview_http_503');
});

void test('local filters expose every failed outcome while target view stays strict',async()=>{
  const source=await readFile(new URL('../components/chat-discovery-dialog.tsx',import.meta.url),'utf8');
  const {stripTypeScriptTypes}=await import('node:module');
  const fn=source.slice(source.indexOf('function localCandidatesForFilter'),source.indexOf('function localTargetIdentity'));
  const filter=new Function(stripTypeScriptTypes(fn)+'\nreturn localCandidatesForFilter;')();
  const candidates=[{preflightState:'target'},{preflightState:'queued'},{preflightState:'rejected'},{preflightState:'skipped'},{preflightState:'unavailable'}];
  assert.equal(filter(candidates,'all').length,5);
  assert.deepEqual(filter(candidates,'target'),[candidates[0]]);
  assert.deepEqual(filter(candidates,'rejected'),[candidates[2],candidates[3]]);
  assert.deepEqual(filter(candidates,'unavailable'),[candidates[4]]);
});

void test('WhatsApp invite metadata and UI inspection foreground the WhatsApp tab first',async()=>{
  const adapter=await readFile(new URL('../scripts/whatsapp-web-cdp.mjs',import.meta.url),'utf8');
  const queryStart=adapter.indexOf('export async function queryWhatsappInviteViaCdp');
  const queryEnd=adapter.indexOf('export function normalizeLocalCdpBaseUrl',queryStart);
  assert.match(adapter.slice(queryStart,queryEnd),/Page\.bringToFront/u);
  const inspectStart=adapter.indexOf('export async function inspectWhatsappTaskViaCdp');
  const inspectEnd=adapter.indexOf('async function findOrCreateWhatsappPage',inspectStart);
  assert.match(adapter.slice(inspectStart,inspectEnd),/Page\.bringToFront/u);
});

void test('WhatsApp metadata maps bad-request and gone invite responses to invalid links',async()=>{
  const adapter=await readFile(new URL('../scripts/whatsapp-web-cdp.mjs',import.meta.url),'utf8');
  const start=adapter.indexOf('export async function queryWhatsappInviteViaCdp');
  const end=adapter.indexOf('export async function joinWhatsappInviteViaRuntime',start);
  const query=adapter.slice(start,end);
  assert.match(query,/bad\[- \]request\|gone/);
  assert.match(query,/reason:'invalid_whatsapp_link'/);
});

void test('Telegram source crawl avoids repeated expensive directory work',async()=>{
  const source=await readFile(new URL('../scripts/chat-discovery-source-crawl.mjs',import.meta.url),'utf8');
  assert.match(source,/const MAX_TELEGRAM_HISTORY_PAGES=2/);
  assert.match(source,/const MAX_GRAPH_SOURCES_PER_STEP=2/);
  assert.match(source,/const MAX_DIRECTORY_RESULTS=6/);
  assert.match(source,/const directorySearchCache=new Map\(\)/);
  assert.match(source,/const directoryResultVisited=new Set\(\)/);
  assert.match(source,/Promise\.allSettled\(directoryQueries\.map/);
  assert.match(source,/task\.query\+' WhatsApp'/);
  assert.match(source,/!sources\.length&&Date\.now\(\)>=searchBlockedUntil/);
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

void test('proven WhatsApp source clusters are seeded at high priority',async()=>{
  const source=await readFile(new URL('../scripts/chat-discovery-source-crawl.mjs',import.meta.url),'utf8');
  assert.match(source,/PRODUCTIVE_TELEGRAM_SOURCES/);
  assert.match(source,/donetskaoda/);
  assert.match(source,/novocava/);
  assert.match(source,/Help_Ukraine_NRW/);
  assert.match(source,/score:140/);
  assert.match(source,/searchParams\.set\('q','chat\.whatsapp\.com'\)/);
});

void test('direct qualification ignores WhatsApp service events for activity',async()=>{
  const source=await readFile(new URL('../scripts/whatsapp-web-cdp.mjs',import.meta.url),'utf8');
  const start=source.indexOf('export async function joinWhatsappInviteViaRuntime');
  const end=source.indexOf('export async function leaveWhatsappGroupViaRuntime',start);
  const block=source.slice(start,end);
  assert.match(block,/userMessages=messages\.filter/);
  assert.match(block,/gp2\|e2e_notification\|notification\|protocol\|ciphertext/);
  assert.match(block,/latestTimestamp=Math\.max\(0,\.\.\.userMessages/);
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


void test('Telegram directory prioritizes Ukrainian WhatsApp-aware sources and drops unrelated city noise',()=>{
  const html=[
    '<div class="snippet"><a href="/real_madrid_en/1">Real Madrid WhatsApp Madrid</a></div>',
    '<div class="snippet"><a href="/munchen_ukraine_doch">Українці Мюнхен WhatsApp</a></div>',
    '<div class="snippet"><a href="/infohelpbcn/7">Українці Барселона chat.whatsapp.com</a></div>',
  ].join('');
  const ranked=rankTelegramDirectoryResults(html,'Мюнхен');
  assert.equal(ranked.some(url=>url.includes('real_madrid_en')),false);
  assert.ok(ranked.some(url=>url.includes('munchen_ukraine_doch')));
  assert.ok(ranked.some(url=>url.includes('infohelpbcn')));
});

void test('source feedback rewards viable-size writable supply even while factual qualification is incomplete',async()=>{
  const crawlModule=await import('../scripts/chat-discovery-source-crawl.mjs?feedback='+Date.now());
  const sourceUrl='https://t.me/s/viable_feedback_test';
  crawlModule.discoverRelatedTelegramSources('<a href="https://t.me/viable_feedback_test">Українці community</a>','https://t.me/s/root','Test','Українці');
  assert.doesNotThrow(()=>crawlModule.recordDiscoverySourceOutcome(
    [{sourceUrl}], 'unavailable', ['qualification_incomplete','unknown_ads_allowed'],
    {memberCount:900,canWrite:true,topicMatch:'match',activityState:'active'}
  ));
});


void test('fresh UI and CDP discovery runs skip the repeatedly exhausted bootstrap cursor band',async()=>{
  const ui=await readFile(new URL('../components/chat-discovery-dialog.tsx',import.meta.url),'utf8');
  const adapter=await readFile(new URL('../scripts/whatsapp-web-cdp.mjs',import.meta.url),'utf8');
  assert.match(ui,/const LOCAL_SOURCE_START_CURSOR=15/);
  assert.match(ui,/telegramCursor:LOCAL_SOURCE_START_CURSOR/);
  assert.match(ui,/sourceCursor:LOCAL_SOURCE_START_CURSOR/);
  assert.match(adapter,/telegramCursor:15,sourceCursor:15/);
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

void test('source outcome feedback propagates to discovered graph children',async()=>{
  const source=await readFile(new URL('../scripts/chat-discovery-source-crawl.mjs',import.meta.url),'utf8');
  assert.match(source,/const sourceChildren=new Map\(\)/);
  assert.match(source,/for\(const child of sourceChildren\.get\(key\)\|\|\[\]\)adjustSourceScore/);
  assert.match(source,/sourceOutcomeScores\.get\(item\.sourceUrl\)/);
});


void test('browser-local feedback suppresses recently saturated Telegram sources across runner restarts',async()=>{
  const source=await readFile(new URL('../scripts/chat-discovery-source-crawl.mjs',import.meta.url),'utf8');
  assert.match(source,/hydrateDiscoverySourceFeedback/);
  assert.match(source,/sourceSaturatedUntil/);
  assert.match(source,/sourceIsTemporarilySaturated/);
  assert.match(source,/luhanskavtsa/);
  assert.match(source,/munchen_ukraine_doch/);
});

void test('source feedback storage is bounded, local-only, and only receives successful preview stats',async()=>{
  const adapter=await readFile(new URL('../scripts/whatsapp-web-cdp.mjs',import.meta.url),'utf8');
  assert.match(adapter,/work-os:chat-discovery-source-feedback:v1/);
  assert.match(adapter,/now\+6\*60\*60\*1000/);
  assert.match(adapter,/\.slice\(-500\)/);
  assert.match(adapter,/sourceStats\.push\(\{sourceUrl:source\.sourceUrl,added:sourceAdded,duplicates:sourceDuplicates\}\)/);
  const failureGuard=adapter.indexOf('if(!res.ok||!payload)');
  const statsWrite=adapter.indexOf('sourceStats.push');
  assert.ok(statsWrite>failureGuard);
});


void test('TG.ME directory keeps Ukrainian group-invite preview pages that can contain WhatsApp links',()=>{
  const html='<div>Українці у Віттені WhatsApp <a href="/+wtHNHSdaFIxmYjA6">group</a></div>';
  const ranked=rankTelegramDirectoryResults(html,'Віттен');
  assert.equal(ranked[0],'https://tg.me/+wtHNHSdaFIxmYjA6');
});

void test('TG.ME group-invite preview can feed a WhatsApp invite directly',async()=>{
  const groupInvite='https://chat.whatsapp.com/D0wMdlrW1du8hYI83iTl7Z';
  const result=await crawlLocalDiscoverySource(15,{seedData,fetcher:async(url)=>{
    const value=String(url);
    if(value.includes('tg.me/search'))return response('<div>Українці Віттен WhatsApp <a href="/+wtHNHSdaFIxmYjA6">group</a></div>');
    if(value.includes('tg.me/+wtHNHSdaFIxmYjA6'))return response('<title>Українці у Віттені 🇺🇦</title><p>WhatsApp чат української громади '+groupInvite+'</p>');
    if(value.includes('search.brave.com'))return response('Too many requests',429);
    return response('<title>Українці</title>');
  }});
  assert.equal(result.errors.length,0);
  assert.ok(result.sources.some(item=>item.text.includes(groupInvite)));
});


void test('Lyzem source discovery keeps Ukrainian Telegram sources and drops bots or spam',()=>{
  const html=[
    '<li class="search-result"><div title="group"></div><a href="https://t.me/berlin_ua_family">Українці Берлін community</a></li>',
    '<li class="search-result"><div title="bot"></div><a href="https://t.me/ukraine_helper_bot">Українці Берлін bot</a></li>',
    '<li class="search-result"><div title="channel"></div><a href="https://t.me/crypto_ukr">Українці crypto casino signals</a></li>',
    '<li class="search-result"><div title="channel"></div><a href="https://t.me/randomberlin">Berlin local news</a></li>',
  ].join('');
  const ranked=rankLyzemTelegramSources(html,'Берлін');
  assert.deepEqual(ranked,['https://t.me/berlin_ua_family']);
});

void test('empty TG.ME supply can use Lyzem to discover a Telegram source before Brave',async()=>{
  const crawlModule=await import('../scripts/chat-discovery-source-crawl.mjs?lyzem='+Date.now());
  const foundInvite='https://chat.whatsapp.com/LyzemUaBerlin12345';
  let braveCalls=0,lyzemCalls=0;
  const result=await crawlModule.crawlLocalDiscoverySource(15,{seedData,fetcher:async url=>{
    const value=String(url);
    if(value.includes('tg.me/search'))return response('<html>No directory matches</html>');
    if(value.includes('lyzem.com/search')){
      lyzemCalls++;
      return response('<li class="search-result"><div title="group"></div><a href="https://t.me/lyzem_berlin_ua">Українці Берлін громада</a></li>');
    }
    if(value.includes('t.me/s/lyzem_berlin_ua'))return response('<title>Українці Берлін 🇺🇦</title><p>Українська громада оголошення '+foundInvite+'</p>');
    if(value.includes('search.brave.com')){braveCalls++;return response('<html>No results</html>');}
    if(value.includes('t.me/s/'))return response('<title>Українці</title>');
    return response('<html></html>');
  }});
  assert.equal(result.errors.length,0);
  assert.ok(lyzemCalls>=1);
  assert.equal(braveCalls,0,'Brave should stay unused when Lyzem already yielded verified Telegram supply');
  assert.ok(result.sources.some(item=>item.text.includes(foundInvite)));
});

void test('empty Lyzem remains non-fatal and preserves Brave as final fallback',async()=>{
  const crawlModule=await import('../scripts/chat-discovery-source-crawl.mjs?lyzem-empty='+Date.now());
  let braveCalls=0,lyzemCalls=0;
  const result=await crawlModule.crawlLocalDiscoverySource(15,{seedData,fetcher:async url=>{
    const value=String(url);
    if(value.includes('tg.me/search'))return response('<html>No directory matches</html>');
    if(value.includes('lyzem.com/search')){lyzemCalls++;return response('<html>No Lyzem matches</html>');}
    if(value.includes('search.brave.com')){braveCalls++;return response('<html>No Brave matches</html>');}
    if(value.includes('t.me/s/'))return response('<title>Українці</title>');
    return response('<html></html>');
  }});
  assert.equal(result.errors.length,0);
  assert.ok(lyzemCalls>=1);
  assert.ok(braveCalls>=1,'Brave must remain reachable after an empty Lyzem response');
});

void test('Lyzem WhatsApp URLs are never ingested directly without a verified Telegram source read',async()=>{
  const crawlModule=await import('../scripts/chat-discovery-source-crawl.mjs?lyzem-direct='+Date.now());
  const noisyInvite='https://chat.whatsapp.com/NoisyDirectLyzem99';
  const result=await crawlModule.crawlLocalDiscoverySource(15,{seedData,fetcher:async url=>{
    const value=String(url);
    if(value.includes('tg.me/search'))return response('<html>No directory matches</html>');
    if(value.includes('lyzem.com/search'))return response(
      '<li class="search-result"><div title="group"></div><a href="https://t.me/ua_no_invites">Українці Берлін '+noisyInvite+'</a></li>'
    );
    if(value.includes('t.me/s/ua_no_invites'))return response('<title>Українці Берлін 🇺🇦</title><p>Без WhatsApp посилань</p>');
    if(value.includes('search.brave.com'))return response('<html>No results</html>');
    if(value.includes('t.me/s/'))return response('<title>Українці</title>');
    return response('<html></html>');
  }});
  assert.equal(result.sources.some(item=>item.text.includes(noisyInvite)),false);
});
