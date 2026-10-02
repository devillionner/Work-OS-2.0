import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const source=readFileSync(new URL('../scripts/chat-discovery-source-crawl.mjs',import.meta.url),'utf8');
const runner=readFileSync(new URL('../scripts/chat-discovery-runner.mjs',import.meta.url),'utf8');
const adapter=readFileSync(new URL('../scripts/whatsapp-web-cdp.mjs',import.meta.url),'utf8');
const loadModule=code=>import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));
const seedData={cities:[{country:'Німеччина',uk:'Берлін',name:'Berlin'}],keywords:['назва міста чат']};
test('empty successful directory falls back to web search',async()=>{
  const m=await loadModule(source+'\n// empty directory test');
  const calls=[];
  const result=await m.crawlLocalDiscoverySource(15,{seedData,fetcher:async url=>{
    calls.push(url);return new Response('<html>No matches</html>');
  }});
  assert.ok(calls.some(url=>url.includes('search.brave.com')));
  assert.equal(result.nextCursor,16);
});
test('failed graph sources are not permanently consumed',async()=>{
  const m=await loadModule(source+'\n// graph failure test');
  const calls=[];
  const fetcher=async url=>{
    calls.push(url);
    if(url.includes('t.me/s/'))throw Error('temporary failure');
    return new Response('<html>No matches</html>');
  };
  await m.crawlLocalDiscoverySource(15,{seedData,fetcher});
  const first=calls.filter(url=>url.includes('t.me/s/'));
  calls.length=0;
  await m.crawlLocalDiscoverySource(16,{seedData,fetcher});
  assert.ok(calls.some(url=>first.includes(url)));
});
function harness({metadataFailure=false,persistFailure=false,joinUnavailable=false,postJoinEvidenceGap=false}={}){
  let checkpoint=null;
  const writes=[],joins=[];
  const deps={
    baseUrl:'test',whatsappCdp:'test',console:{log(){},warn(){}},
    markWorkOsLocalDiscoveryCandidateViaCdp:async(_url,task)=>{if(task?.checkpoint)checkpoint=task.checkpoint;return {kind:'result'};},
    writeWorkOsLocalDiscoveryResultViaCdp:async(_url,id,payload)=>{writes.push(payload);return {kind:persistFailure?'blocked':'result'};},
    readWorkOsLocalDiscoveryTaskViaCdp:async()=>({kind:'result',active:true,runId:'r'}),
    updateWorkOsLocalDiscoverySourceFeedbackViaCdp:async()=>({kind:'result'}),
    sourceFeedbackRefreshAt:0,
    recordDiscoverySourceOutcome(){},clearTaskBlock(){},markTaskBlocked(){},
    queryWhatsappInviteViaCdp:async()=>metadataFailure?{kind:'blocked',reason:'page_not_ready'}:{kind:'result',result:{memberCount:900,groupId:'group@g.us',topicMatch:'match',chatType:'group',canWrite:true}},
    inspectWhatsappTaskViaCdp:async()=>joinUnavailable?{kind:'result',result:{membershipState:'joined',chatType:'group',memberCount:900,topicMatch:'match',canWrite:true,adsPolicy:'allowed',activityState:'active',targetVerified:true,accessible:true}}:{kind:'blocked',reason:'page_not_ready'},
    leaveWhatsappGroupViaRuntime:async()=>{throw Error('must not leave unknown chat');},
    joinWhatsappInviteViaRuntime:async task=>{
      joins.push(task);
      if(joinUnavailable)return {kind:'blocked',reason:'direct_join_unavailable'};
      return {kind:'result',result:{memberCount:900,groupId:'group@g.us',topicMatch:'match',chatType:'group',
        canWrite:true,membershipState:'joined',accessible:true,targetVerified:true,status:'inspected',
        ...(postJoinEvidenceGap?{joinedThisAttempt:true}:joins.length>1?{activityState:'active',adsPolicy:'allowed'}:{})}};
    },
  };
  const code=runner.slice(runner.indexOf('function evaluateLocalPreflight'),runner.indexOf('async function resolveLocalSourceSeedData'));
  const ctx=vm.createContext({...deps,Date});
  vm.runInContext(code+';globalThis.run=processLocalPreflightVisible;',ctx);
  return {writes,joins,get checkpoint(){return checkpoint;},run:()=>ctx.run({candidateId:'a',runId:'r',name:'test',checkpoint})};
}
test('metadata retries terminate after three attempts',async()=>{
  const h=harness({metadataFailure:true});
  await h.run();await h.run();await h.run();
  assert.equal(h.writes.length,1);
  assert.ok(h.writes[0].reasonCodes.includes('retry_exhausted'));
});
test('incomplete joined chat is re-inspected without another join',async()=>{
  const h=harness();
  await h.run();
  assert.equal(h.writes.length,0);
  await h.run();
  assert.equal(h.joins[1].membershipState,'joined');
  assert.equal(h.joins[1].groupId,'group@g.us');
  assert.equal(h.writes[0].decision,'target');
});
test('failed persistence retries only the saved outcome',async()=>{
  const h=harness({persistFailure:true});
  await h.run();await h.run();await h.run();
  assert.equal(h.joins.length,2);
  assert.equal(h.writes.length,2);
});
test('activity uses today/yesterday in Kyiv and rejects future dates',async()=>{
  const m=await loadModule(adapter);
  const now=Date.parse('2026-09-29T04:00:00Z');
  assert.equal(m.isDiscoveryRecentTimestamp(Date.parse('2026-09-27T21:10:00Z'),now),true);
  assert.equal(m.isDiscoveryRecentTimestamp(Date.parse('2026-09-27T20:59:00Z'),now),false);
  assert.equal(m.isDiscoveryRecentTimestamp(now+3600000,now),false);
});
test('result persistence merges a concurrent pause and source batch',async()=>{
  const m=await loadModule(adapter);
  const key='work-os:chat-discovery-local-preview:v3';
  const storage=new Map([[key,JSON.stringify({runId:'r',running:true,candidates:[{id:'a',platform:'whatsapp',link:'https://chat.whatsapp.com/abcdefgh',name:'a'}]})]]);
  const sandbox={
    sessionStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v)},
    window:{dispatchEvent(){}},CustomEvent:class {},Date,
    fetch:async()=>{
      const latest=JSON.parse(storage.get(key));
      latest.running=false;latest.telegramCursor=99;latest.candidates.push({id:'b'});
      storage.set(key,JSON.stringify(latest));
      return {ok:true,json:async()=>({persisted:true})};
    },
  };
  const oldFetch=globalThis.fetch,oldSocket=globalThis.WebSocket;
  globalThis.fetch=async()=>({ok:true,json:async()=>[{type:'page',url:'https://work.example/',webSocketDebuggerUrl:'ws://127.0.0.1:9222/test'}]});
  globalThis.WebSocket=class extends EventTarget{
    constructor(){super();queueMicrotask(()=>this.dispatchEvent(new Event('open')));}
    send(raw){
      const message=JSON.parse(raw);
      Promise.resolve(vm.runInNewContext(message.params.expression,sandbox)).then(value=>{
        const event=new Event('message');event.data=JSON.stringify({id:message.id,result:{result:{value}}});this.dispatchEvent(event);
      });
    }
    close(){}
  };
  try{
    await m.writeWorkOsLocalDiscoveryResultViaCdp('https://work.example','a',{runId:'r',decision:'rejected',reasonCodes:['too_few_members'],result:{}},{cdpBaseUrl:'http://127.0.0.1:9222'});
    const result=JSON.parse(storage.get(key));
    assert.equal(result.running,false);
    assert.equal(result.telegramCursor,99);
    assert.equal(result.candidates.length,2);
  }finally{globalThis.fetch=oldFetch;globalThis.WebSocket=oldSocket;}
});


test('runner records source, metadata, join and persistence timing stages',()=>{
  assert.match(runner,/sourceMs/);
  assert.match(runner,/metadataMs/);
  assert.match(runner,/joinAndInspectMs/);
  assert.match(runner,/persistMs/);
  assert.match(runner,/stageMs/);
});


test('runner hydrates source feedback from browser localStorage without a D1/API scan',()=>{
  assert.match(runner,/readWorkOsLocalDiscoverySourceFeedbackViaCdp/);
  assert.match(runner,/hydrateDiscoverySourceFeedback/);
  assert.match(runner,/updateWorkOsLocalDiscoverySourceFeedbackViaCdp/);
  const start=adapter.indexOf('export async function readWorkOsLocalDiscoverySourceFeedbackViaCdp');
  const end=adapter.indexOf('export async function updateWorkOsLocalDiscoverySourceFeedbackViaCdp',start);
  const block=adapter.slice(start,end);
  assert.match(block,/localStorage\.getItem/);
  assert.doesNotMatch(block,/fetch\s*\(/u);
});

test('missing direct-join module falls back to factual UI inspection',async()=>{
  const h=harness({joinUnavailable:true});
  await h.run();
  assert.equal(h.writes.length,1);
  assert.equal(h.writes[0].decision,'target');
  assert.equal(h.joins.length,1);
});


test('retry checkpoint drops stale final while preserving joined identity',async()=>{
  const {resetDiscoveryRetryCheckpoint}=await import('../lib/chat-discovery/retry-state.ts?retry='+Date.now());
  const checkpoint=resetDiscoveryRetryCheckpoint({
    membershipState:'joined',
    groupId:'120363401562375830@g.us',
    discoveryCheckpoint:{
      attempts:3,
      lastReason:'whatsapp_messages_loading',
      result:{memberCount:702,topicMatch:'match',canWrite:true},
      final:{decision:'unavailable',result:{
        membershipState:'joined',groupId:'old@g.us',memberCount:702,topicMatch:'match',
        canWrite:true,adsPolicy:'unknown',activityState:'unknown',
      }},
    },
  },123456);
  assert.equal(checkpoint.attempts,0);
  assert.equal(checkpoint.startedAt,123456);
  assert.deepEqual(checkpoint.stageMs,{});
  assert.equal(checkpoint.result.membershipState,'joined');
  assert.equal(checkpoint.result.groupId,'120363401562375830@g.us');
  assert.equal(checkpoint.result.memberCount,702);
  assert.equal('final' in checkpoint,false);
  assert.equal('lastReason' in checkpoint,false);
});

test('UI retry uses the reset checkpoint instead of replaying a saved final outcome',()=>{
  const ui=readFileSync(new URL('../components/chat-discovery-dialog.tsx',import.meta.url),'utf8');
  const start=ui.indexOf('function retryIncompleteCandidate');
  const end=ui.indexOf('async function addLocalTargetsToJoin',start);
  const block=ui.slice(start,end);
  assert.match(block,/storedCandidate=current\.candidates\.find/);
  assert.match(block,/resetDiscoveryRetryCheckpoint\(storedCandidate\)/);
  assert.match(block,/delete results\[candidate\.id\]/);
});


test('joined WhatsApp qualification opens the existing chat and uses object-form message loaders',()=>{
  const block=adapter.slice(adapter.indexOf('export async function joinWhatsappInviteViaRuntime'),adapter.indexOf('export async function leaveWhatsappGroupViaRuntime'));
  assert.match(block,/openChatBottom\(\{chat\}\)/);
  assert.match(block,/loadRecentMsgs\(\{chat\}\)/);
  assert.match(block,/loadEarlierMsgs\(\{chat\}\)/);
  assert.match(block,/stepRace/);
  assert.doesNotMatch(block,/loadRecentMsgs\(chat\)/);
  assert.doesNotMatch(block,/loadEarlierMsgs\(chat\)/);
});


test('freshly joined WhatsApp chat never loads invisible pre-join history',()=>{
  const block=adapter.slice(adapter.indexOf('export async function joinWhatsappInviteViaRuntime'),adapter.indexOf('export async function leaveWhatsappGroupViaRuntime'));
  assert.match(block,/if\(alreadyJoined&&loader\?\.loadEarlierMsgs\)/);
  assert.match(block,/const joinedAt=alreadyJoined\?knownJoinedAt:Date\.now\(\)/);
  assert.match(block,/joinedThisAttempt:!alreadyJoined/);
  assert.match(block,/timestamp\*1000>=joinedAt-60_000/);
});

test('fresh join without visible history finishes as manual review and never waits for future messages',async()=>{
  const h=harness({postJoinEvidenceGap:true});
  await h.run();
  assert.equal(h.writes.length,1);
  assert.equal(h.writes[0].decision,'review');
  assert.ok(h.writes[0].reasonCodes.includes('fresh_join_history_unavailable'));
  assert.equal(h.writes[0].result.status,'manual_review');
});

test('legacy waiting-post-join candidate is immediately selectable for migration',()=>{
  const start=adapter.indexOf('export async function readWorkOsLocalDiscoveryTaskViaCdp');
  const end=adapter.indexOf('export async function readWorkOsLocalDiscoverySeedDataViaCdp',start);
  const block=adapter.slice(start,end);
  assert.doesNotMatch(block,/evidenceReady\(item\)/);
  assert.doesNotMatch(block,/nextEvidenceCheckAt/);
  assert.match(runner,/task\.checkpoint\?\.lastReason==='waiting_post_join_evidence'/);
});

test('visible message older than today-or-yesterday is factual inactivity',()=>{
  const start=adapter.indexOf('const latestTimestamp=Math.max');
  const end=adapter.indexOf('const recentTexts=',start);
  const block=adapter.slice(start,end);
  assert.match(block,/else if\(latestTimestamp>0\)activityState='dead'/);
  assert.doesNotMatch(block,/14\*24\*60\*60/);
});


test('joined recovery without groupId refreshes invite metadata before inspection and never rejoins',async()=>{
  let checkpoint={attempts:0,startedAt:Date.now(),result:{
    membershipState:'joined',memberCount:702,topicMatch:'match',canWrite:true,
    adsPolicy:'unknown',activityState:'unknown',joinedAt:Date.now()-60000,
  }};
  const joins=[],queries=[];
  const deps={
    POST_JOIN_EVIDENCE_RECHECK_MS:300000,
    baseUrl:'test',whatsappCdp:'test',console:{log(){},warn(){}},
    markWorkOsLocalDiscoveryCandidateViaCdp:async(_url,task)=>{if(task?.checkpoint)checkpoint=task.checkpoint;return {kind:'result'};},
    writeWorkOsLocalDiscoveryResultViaCdp:async()=>({kind:'result'}),
    readWorkOsLocalDiscoveryTaskViaCdp:async()=>({kind:'result',active:true,runId:'r'}),
    updateWorkOsLocalDiscoverySourceFeedbackViaCdp:async()=>({kind:'result'}),
    sourceFeedbackRefreshAt:0,
    recordDiscoverySourceOutcome(){},clearTaskBlock(){},markTaskBlocked(){},
    queryWhatsappInviteViaCdp:async task=>{queries.push(task);return {kind:'result',result:{
      groupId:'recovered@g.us',memberCount:702,topicMatch:'match',chatType:'group',canWrite:true,
      observedName:'Загальний',accessible:true,targetVerified:true,
    }};},
    inspectWhatsappTaskViaCdp:async()=>({kind:'blocked',reason:'should_not_fallback'}),
    leaveWhatsappGroupViaRuntime:async()=>{throw Error('must not leave waiting joined chat');},
    joinWhatsappInviteViaRuntime:async task=>{joins.push(task);return {kind:'result',result:{
      membershipState:'joined',groupId:task.groupId,memberCount:702,topicMatch:'match',
      chatType:'group',canWrite:true,accessible:true,targetVerified:true,status:'inspected',
      joinedAt:task.preflightFacts?.joinedAt||Date.now(),recentMessageCount:0,
    }};},
  };
  const code=runner.slice(runner.indexOf('function evaluateLocalPreflight'),runner.indexOf('async function resolveLocalSourceSeedData'));
  const ctx=vm.createContext({...deps,Date});
  vm.runInContext(code+';globalThis.run=processLocalPreflightVisible;',ctx);
  await ctx.run({candidateId:'joined-no-gid',runId:'r',name:'Загальний',membershipState:'joined',checkpoint});
  assert.equal(queries.length,1);
  assert.equal(joins.length,1);
  assert.equal(joins[0].membershipState,'joined');
  assert.equal(joins[0].groupId,'recovered@g.us');
  // Timed post-join evidence waiting was removed (see the manual-review migration test below): unknown
  // ads/activity on an already joined chat is a bounded qualification deferral, counted as an attempt.
  assert.equal(checkpoint.lastReason,'qualification_incomplete');
  assert.equal(checkpoint.attempts,1);
});


test('manual-review migration preserves real joinedAt and removes timed evidence waiting',()=>{
  assert.doesNotMatch(adapter,/joinedAt:joinedAt\|\|Date\.now\(\)/);
  assert.match(adapter,/evidenceScope:joinedAt>0\?'post_join_timestamped':'visible_since_join'/);
  assert.match(runner,/decision:'review'/);
  assert.match(runner,/fresh_join_history_unavailable/);
  assert.doesNotMatch(runner,/POST_JOIN_EVIDENCE_RECHECK_MS/);
});
