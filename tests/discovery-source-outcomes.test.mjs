import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { crawlLocalDiscoverySource, workbookSearchPlan } from '../scripts/chat-discovery-source-crawl.mjs';

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

void test('HTTP failure retains the cursor and is not exhaustion',async()=>{
  const result=await crawlLocalDiscoverySource(0,{seedData,fetcher:async()=>response('unavailable',503)});
  assert.equal(result.nextCursor,0);
  assert.equal(result.done,false);
  assert.match(result.errors[0].reason,/source_http_503/);
});

void test('search challenge is an error, never empty success',async()=>{
  const result=await crawlLocalDiscoverySource(15,{seedData,fetcher:async()=>response('<title>Verify you are human</title>')});
  assert.equal(result.nextCursor,15);
  assert.equal(result.done,false);
  assert.match(result.errors[0].reason,/search_blocked/);
});

void test('canonical query falls back to Latin spelling and Telegram history',async()=>{
  const urls=[];
  const result=await crawlLocalDiscoverySource(15,{seedData,fetcher:async(url)=>{
    urls.push(String(url));
    if(String(url).includes('search.brave.com')){
      const q=new URL(url).searchParams.get('q');
      return response(q.includes('Berlin')?'<a href="https://t.me/test_history_ua">Українці Berlin chat.whatsapp.com</a>':'<title>No results</title>');
    }
    if(String(url).includes('before=123'))return response(page);
    return response('<title>Українці</title><a href="/s/test_history_ua?before=123">Older</a>');
  }});
  assert.equal(result.errors.length,0);
  assert.equal(result.nextCursor,16);
  assert.equal(result.sources.length,1);
  assert.match(result.sources[0].text,/chat.whatsapp.com/);
  assert.ok(urls.some(url=>url.includes('before=123')));
});

async function preflightHarness() {
  const source=await readFile(new URL('../scripts/chat-discovery-runner.mjs',import.meta.url),'utf8');
  const evaluate=source.slice(source.indexOf('function evaluateLocalPreflight'),source.indexOf('async function processLocalPreflight'));
  const process=source.slice(source.indexOf('async function processLocalPreflight'),source.indexOf('async function crawlLocalDiscoveryBatch'));
  const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
  return new AsyncFunction('queryWhatsappInviteViaCdp','inspectWhatsappTaskViaCdp','writeWorkOsLocalDiscoveryResultViaCdp','leaveWhatsappTaskViaCdp','repeats',[
    "const whatsappCdp='http://127.0.0.1:9222',baseUrl='https://staging.example';",
    "const qualificationAttempts=new Map(),INCOMPLETE_QUALIFICATION_COOLDOWN_MS=15000,markTaskBlocked=()=>{};",
    evaluate,process,
    "for(let i=0;i<repeats;i++)await processLocalPreflight({candidateId:'candidate',minMembers:700});",
  ].join('\n'));
}

void test('metadata failure falls back to exact-invite UI and can yield a target',async()=>{
  const run=await preflightHarness();
  const outcomes=[];let inspected=0,left=0;
  await run(async()=>({kind:'blocked',reason:'page_not_ready'}),async()=>{inspected++;return {kind:'result',result:{
    status:'inspected',membershipState:'joined',chatType:'group',memberCount:800,topicMatch:'match',canWrite:true,
    adsPolicy:'allowed',activityState:'active',accessible:true,targetVerified:true,
  }};},async(_url,_id,payload)=>outcomes.push(payload),async()=>{left++;},1);
  assert.equal(inspected,1);
  assert.equal(left,0);
  assert.equal(outcomes[0].decision,'target');
});

void test('unknown qualification has bounded retries and never leaves a joined chat',async()=>{
  const run=await preflightHarness();
  const outcomes=[];let left=0;
  await run(async()=>({kind:'blocked',reason:'page_not_ready'}),async()=>({kind:'result',result:{
    status:'inspected',membershipState:'joined',chatType:'group',memberCount:800,topicMatch:'match',canWrite:true,
    adsPolicy:'unknown',activityState:'unknown',accessible:true,targetVerified:true,
  }}),async(_url,_id,payload)=>outcomes.push(payload),async()=>{left++;},3);
  assert.equal(left,0);
  assert.equal(outcomes.length,1);
  assert.equal(outcomes[0].decision,'unavailable');
  assert.ok(outcomes[0].reasonCodes.includes('unknown_activity'));
  assert.equal(outcomes[0].result.status,'incomplete');
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
