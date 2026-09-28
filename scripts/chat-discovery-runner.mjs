#!/usr/bin/env node
import { execFile, execFileSync } from 'node:child_process';
import process from 'node:process';
import readline from 'node:readline/promises';
import {
  inspectWhatsappTaskViaCdp,
  readWhatsappHomeHealthViaCdp,
  resetWhatsappPageViaCdp,
  queryWhatsappInviteViaCdp,
  joinWhatsappInviteViaRuntime,
  leaveWhatsappGroupViaRuntime,
  leaveWhatsappTaskViaCdp,
  readWorkOsExecutorTokenViaCdp,
  readWorkOsLocalDiscoveryTaskViaCdp,
  readWorkOsLocalDiscoverySeedDataViaCdp,
  writeWorkOsLocalDiscoveryResultViaCdp,
  applyWorkOsLocalDiscoverySourceBatchViaCdp,
  sendWhatsappAutopostViaCdp,
  toWhatsAppWebInviteUrl,
} from './whatsapp-web-cdp.mjs';
import { crawlLocalDiscoverySource } from './chat-discovery-source-crawl.mjs';

const baseUrl=(process.env.WORK_OS_URL||'').replace(/\/$/,'');
const whatsappCdp=(process.env.WORK_OS_WHATSAPP_CDP||'').replace(/\/$/,'');
let token=await resolveExecutorToken();
if(!baseUrl){console.error('Set WORK_OS_URL.');process.exit(2);}
if(!token)console.warn('No executor token yet: local WhatsApp preflight can run, but D1-backed post-confirmation tasks stay paused.');
if(!process.stdin.isTTY&&!whatsappCdp){
  console.error('Non-interactive Discovery runner requires WORK_OS_WHATSAPP_CDP; exiting before any Work OS/D1 polling.');
  process.exit(2);
}
const terminal=readline.createInterface({input:process.stdin,output:process.stdout});
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const TASK_POLL_MS=3000;
const LOCAL_PREFLIGHT_POLL_MS=1500;
const LOCAL_SOURCE_MIN_MS=2000;
const LOCAL_SOURCE_TARGET_QUEUE=30;
const SOURCE_ADVANCE_MS=20000;
const EXECUTOR_QUEUE_LIMIT=3;
const TASK_BLOCK_COOLDOWN_MS=300000;
const INCOMPLETE_QUALIFICATION_COOLDOWN_MS=15000;
const qualificationAttempts=new Map();
let localSourceSeedData=null;
let localSourceSeedVersion=0;
const PAGE_RECOVERY_COOLDOWN_MS=15000;
const WHATSAPP_LOADING_COOLDOWN_MS=10000;
const WHATSAPP_LOADING_RELOAD_AFTER=3;
const WHATSAPP_LOADING_RELOAD_COOLDOWN_MS=120000;
const WHATSAPP_INVITE_LOADING_COOLDOWN_MS=120000;
const METADATA_RETRY_COOLDOWN_MS=60000;
const METADATA_INCOMPLETE_COOLDOWN_MS=60000;
const WHATSAPP_RUNTIME_COOLDOWN_MS=300000;
const TOKEN_REFRESH_MS=60000;
const IDLE_POLL_MIN_MS=2000;
const IDLE_POLL_MAX_MS=5000;
const WHATSAPP_RUNTIME_TRANSIENT_REASONS=new Set(['cdp_not_configured','cdp_not_local','cdp_websocket_not_local','whatsapp_not_authenticated','page_not_ready']);

async function resolveExecutorToken(){
  const configured=process.env.WORK_OS_EXECUTOR_TOKEN||'';
  if(configured)return configured;
  if(process.argv.includes('--token-from-work-os-page')){
    if(!baseUrl||!whatsappCdp){
      console.error('--token-from-work-os-page requires WORK_OS_URL and local WORK_OS_WHATSAPP_CDP.');
      return '';
    }
    try{
      const result=await readWorkOsExecutorTokenViaCdp(baseUrl,{cdpBaseUrl:whatsappCdp});
      if(result.kind==='result'){
        console.log('Executor token loaded from the Work OS page through local CDP.');
        return result.token;
      }
      console.error(`Could not read executor token from the Work OS page (${result.reason}).`);
      return '';
    }catch{
      console.error('Could not read executor token from the Work OS page.');
      return '';
    }
  }
  if(!process.argv.includes('--token-from-clipboard'))return '';
  if(process.platform!=='linux'){
    console.error('--token-from-clipboard is supported only on Linux.');
    return '';
  }
  try{
    const value=execFileSync('wl-paste',['--no-newline'],{
      encoding:'utf8',
      stdio:['ignore','pipe','ignore'],
      maxBuffer:4096,
    }).trim();
    if(value.length<32||value.length>512){
      console.error('Executor token was not found in the clipboard.');
      return '';
    }
    try{execFileSync('wl-copy',['--clear'],{stdio:'ignore'});}catch{}
    console.log('Executor token loaded from clipboard; clipboard cleared when supported.');
    return value;
  }catch{
    console.error('Could not read executor token from the Wayland clipboard.');
    return '';
  }
}

let nextTokenResolveAt=0;
async function refreshExecutorTokenIfNeeded(){
  if(token||!process.argv.includes('--token-from-work-os-page')||Date.now()<nextTokenResolveAt)return;
  nextTokenResolveAt=Date.now()+TOKEN_REFRESH_MS;
  const resolved=await resolveExecutorToken();
  if(resolved)token=resolved;
}

async function api(path,init={}){
  const response=await fetch(baseUrl+path,{...init,headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json',...init.headers}});
  const body=await response.json().catch(()=>({}));
  if(!response.ok) throw new Error(body.error||`Work OS HTTP ${response.status}`);
  return body;
}
function openUrl(url){
  const command=process.platform==='darwin'?'open':process.platform==='win32'?'cmd':'xdg-open';
  const args=process.platform==='win32'?['/c','start','',url]:[url];
  execFile(command,args,{windowsHide:true},()=>{});
}
function yes(value){return /^(y|так|т|yes)$/i.test(value.trim());}
function tri(value,yesValue,noValue){const v=value.trim().toLowerCase();if(['y','yes','так','т'].includes(v))return yesValue;if(['n','no','ні','н'].includes(v))return noValue;return null;}
function numberOrNull(value){const n=Number(value.replace(/\s/g,''));return Number.isFinite(n)&&n>=0?n:null;}
function membershipState(value){const v=value.trim().toLowerCase();return ['joined','pending','not_checked','left'].includes(v)?v:null;}

async function inspect(task){
  const manualUrl=task.runtime==='whatsapp_web'?(toWhatsAppWebInviteUrl(task.link)||task.link):task.link;
  openUrl(manualUrl);
  console.log(`\n[${task.platform}] ${task.name}\n${task.link}\nAction: ${task.action}`);
  console.log('Complete the requested messenger action manually, then record only what you actually observed.');
  const targetVerified=yes(await terminal.question(`Exact target verified as "${task.expectedTarget?.name||task.name}"? [y/N] `));
  if(!targetVerified)return {status:'failed',targetVerified:false,reason:'target_not_verified'};
  const accessible=yes(await terminal.question('Chat accessible? [y/N] '));
  const membership=membershipState(await terminal.question('Membership [joined/pending/not_checked/left]: '));
  if(!membership)return {status:'failed',targetVerified:true,reason:'membership_not_confirmed'};
  if(task.action==='join_and_inspect'&&membership!=='joined')return {status:'failed',targetVerified:true,reason:'join_not_confirmed'};
  const observedName=(await terminal.question('Observed name (blank keeps current): ')).trim()||task.name;
  const members=numberOrNull(await terminal.question('Member count (blank unknown): '));
  const topic=tri(await terminal.question('Topic matches? [y/n/blank unknown] '),'match','mismatch')||'unknown';
  const canWrite=tri(await terminal.question('Can write? [y/n/blank unknown] '),true,false);
  const ads=tri(await terminal.question('Ads allowed? [y/n/blank unknown] '),'allowed','forbidden')||'unknown';
  const active=tri(await terminal.question('Active recently? [y/n/blank unknown] '),'active','dead')||'unknown';
  return {status:'inspected',targetVerified:true,accessible,membershipState:membership,observedName,chatType:'group',memberCount:members,topicMatch:topic,canWrite,adsPolicy:ads,activityState:active};
}
async function inspectTask(task){
  if(task.runtime==='whatsapp_web'&&whatsappCdp){
    try{
      const automated=await inspectWhatsappTaskViaCdp(task,{cdpBaseUrl:whatsappCdp});
      if(automated.kind==='result'){
        clearWhatsappRuntimeBlock();
        console.log(`WhatsApp Web observed safely: ${automated.result.membershipState||automated.result.reason||automated.result.status}`);
        return {kind:'result',result:automated.result};
      }
      if(WHATSAPP_RUNTIME_TRANSIENT_REASONS.has(automated.reason))markWhatsappRuntimeBlocked(automated.reason);
      console.warn(`WhatsApp Web automation stopped fail-closed: ${automated.reason}`);
      if(!process.stdin.isTTY)return {kind:'blocked',reason:automated.reason};
    }catch(error){
      markWhatsappRuntimeBlocked('cdp_unavailable');
      console.warn(`WhatsApp Web CDP unavailable; no callback sent: ${error instanceof Error?error.message:String(error)}`);
      if(!process.stdin.isTTY)return {kind:'blocked',reason:'cdp_unavailable'};
    }
    console.log('Falling back to operator-confirmed inspection; no callback was sent for the ambiguous browser state.');
  }
  return {kind:'result',result:await inspect(task)};
}

let whatsappRuntimeBlockedUntil=0;
let whatsappLoadingSignals=0;
let whatsappHomeRecoveryPending=false;
let lastWhatsappReloadAt=0;
let nextSourceAdvanceAt=0;
let nextLocalSourceAt=0;
let localSourceInFlight=null;
const taskBlockedUntil=new Map();
function markTaskBlocked(task,reason,cooldownMs=TASK_BLOCK_COOLDOWN_MS){
  taskBlockedUntil.set(task.candidateId,Date.now()+cooldownMs);
  console.warn(`Discovery task paused locally after fail-closed ${reason}; another candidate may continue.`);
}
function taskIsLocallyBlocked(task){
  const until=Number(taskBlockedUntil.get(task.candidateId)||0);
  if(!until)return false;
  if(until<=Date.now()){taskBlockedUntil.delete(task.candidateId);return false;}
  return true;
}
function clearTaskBlock(task){taskBlockedUntil.delete(task.candidateId);}
function markWhatsappRuntimeBlocked(reason){
  whatsappRuntimeBlockedUntil=Math.max(whatsappRuntimeBlockedUntil,Date.now()+WHATSAPP_RUNTIME_COOLDOWN_MS);
  console.warn(`WhatsApp runtime temporarily blocks automated WhatsApp actions (${reason}); retry after cooldown.`);
}
function clearWhatsappRuntimeBlock(){whatsappRuntimeBlockedUntil=0;}
function canAdvanceDiscoverySource(){
  return false;
}
async function advanceDiscoverySource(){
  nextSourceAdvanceAt=Date.now()+SOURCE_ADVANCE_MS;
  const source=await api('/api/chat-discovery/executor',{method:'POST',body:JSON.stringify({action:'advance-discovery'})});
  if(!source.advanced)return null;
  const added=Math.max(0,Number(source.batch?.added)||0);
  console.log(`Discovery source advanced via ${source.source}: searched ${source.batch?.searched||0}, added ${added}, duplicates ${source.batch?.duplicates||0}; qualified targets ${source.run?.targetCount||0}/${source.run?.goal||0}`);
  return added>0?'source_added':'source_advanced';
}

function evaluateLocalPreflight(task,result){
  const reasons=[];
  const minMembers=Math.max(700,Number(task.minMembers)||700);
  const maxMembers=18000;
  const topic=result.topicMatch||'unknown';
  if(result.membershipState!=='joined')reasons.push(result.reason==='approval_required'?'approval_required':'join_not_confirmed');
  if(result.chatType!=='group'&&result.chatType!=='community')reasons.push(result.chatType?'not_discussion_group':'unknown_chat_type');
  if(!Number.isFinite(result.memberCount))reasons.push('unknown_member_count');
  else if(result.memberCount<minMembers)reasons.push('too_few_members');
  else if(result.memberCount>maxMembers)reasons.push('too_many_members');
  if(topic!=='match')reasons.push(topic==='mismatch'?'topic_mismatch':'unknown_topic_match');
  if(result.canWrite!==true)reasons.push(result.canWrite===false?'cannot_write':'unknown_can_write');
  if(!['allowed','inferred_allowed','operator_confirmed'].includes(result.adsPolicy||''))reasons.push(result.adsPolicy==='forbidden'?'ads_forbidden':'unknown_ads_allowed');
  if(result.activityState!=='active')reasons.push(result.activityState==='dead'?'inactive_chat':'unknown_activity');
  if(result.accessible!==true)reasons.push('access_unavailable');
  if(result.targetVerified!==true)reasons.push('target_not_verified');
  const incompleteReasons=new Set(['unknown_chat_type','unknown_member_count','unknown_topic_match','unknown_can_write','unknown_ads_allowed','unknown_activity']);
  const incomplete=reasons.length>0&&reasons.every(reason=>incompleteReasons.has(reason));
  return {decision:incomplete?'incomplete':reasons.length?'rejected':'target',reasonCodes:reasons,topicMatch:topic};
}

async function processLocalPreflight(task){
  let queried;
  try{
    queried=await queryWhatsappInviteViaCdp(task,{cdpBaseUrl:whatsappCdp,timeoutMs:4_000});
  }catch(error){
    markTaskBlocked(task,'metadata_query_error',METADATA_RETRY_COOLDOWN_MS);
    console.warn(`Invite metadata query failed; deferred without opening WhatsApp UI: ${error instanceof Error?error.message:String(error)}`);
    return 'local_task';
  }
  if(queried?.kind!=='result'){
    const reason=queried?.reason||'metadata_query_unavailable';
    markTaskBlocked(task,reason,METADATA_RETRY_COOLDOWN_MS);
    console.warn(`Invite metadata unavailable (${reason}); deferred so another candidate can continue.`);
    return 'local_task';
  }
  const pre={...queried.result};
  if(pre.reason==='invalid_whatsapp_link'){
    await writeWorkOsLocalDiscoveryResultViaCdp(baseUrl,task.candidateId,{
      decision:'unavailable',reasonCodes:['invalid_whatsapp_link'],result:pre,completedAt:Date.now(),
    },{cdpBaseUrl:whatsappCdp});
    return 'local_task';
  }
  if(pre.approvalRequired===true){
    await writeWorkOsLocalDiscoveryResultViaCdp(baseUrl,task.candidateId,{
      decision:'skipped',reasonCodes:['approval_required'],result:{...pre,reason:'approval_required'},completedAt:Date.now(),
    },{cdpBaseUrl:whatsappCdp});
    console.log(`Invite skipped before join: approval required (${pre.observedName||task.name})`);
    return 'local_task';
  }

  const minMembers=Math.max(700,Number(task.minMembers)||700);
  const isCommunity=pre.chatType==='community';
  if(!Number.isFinite(pre.memberCount)&&!isCommunity){
    markTaskBlocked(task,'metadata_member_count_unknown',METADATA_INCOMPLETE_COOLDOWN_MS);
    console.warn(`Invite metadata has no member count; deferred without opening WhatsApp UI (${pre.observedName||task.name}).`);
    return 'local_task';
  }
  const preReasons=[];
  if(Number.isFinite(pre.memberCount)&&pre.memberCount<minMembers)preReasons.push('too_few_members');
  else if(Number.isFinite(pre.memberCount)&&pre.memberCount>18000)preReasons.push('too_many_members');
  if(pre.topicMatch==='mismatch')preReasons.push('topic_mismatch');
  if(pre.canWrite===false)preReasons.push('cannot_write');
  if(pre.adsPolicy==='forbidden')preReasons.push('ads_forbidden');
  if(preReasons.length){
    await writeWorkOsLocalDiscoveryResultViaCdp(baseUrl,task.candidateId,{
      decision:'rejected',reasonCodes:preReasons,result:pre,leftAfterCheck:false,completedAt:Date.now(),
    },{cdpBaseUrl:whatsappCdp});
    console.log(`Invite rejected before join: ${pre.observedName||task.name} (${preReasons.join(', ')})`);
    return 'local_task';
  }

  task={
    ...task,
    name:pre.observedName||task.name,
    expectedTarget:{...task.expectedTarget,name:pre.observedName||task.expectedTarget?.name||task.name},
    preflightFacts:{
      ...(Number.isFinite(pre.memberCount)?{memberCount:pre.memberCount}:{}),
      ...(pre.chatType?{chatType:pre.chatType}:{}),
      ...(pre.topicMatch&&pre.topicMatch!=='unknown'?{topicMatch:pre.topicMatch}:{}),
      ...(pre.adsPolicy&&pre.adsPolicy!=='unknown'?{adsPolicy:pre.adsPolicy}:{}),
    },
  };

  let joined;
  try{
    joined=await joinWhatsappInviteViaRuntime(task,{cdpBaseUrl:whatsappCdp,timeoutMs:10_000});
  }catch(error){
    markTaskBlocked(task,'direct_join_error',METADATA_RETRY_COOLDOWN_MS);
    console.warn(`Direct WhatsApp join failed without UI navigation: ${error instanceof Error?error.message:String(error)}`);
    return 'local_task';
  }
  if(joined.kind!=='result'){
    if(joined.reason==='approval_required'){
      await writeWorkOsLocalDiscoveryResultViaCdp(baseUrl,task.candidateId,{
        decision:'skipped',reasonCodes:['approval_required'],result:{status:'failed',reason:'approval_required'},completedAt:Date.now(),
      },{cdpBaseUrl:whatsappCdp});
      return 'local_task';
    }
    if(joined.reason==='invalid_whatsapp_link'){
      await writeWorkOsLocalDiscoveryResultViaCdp(baseUrl,task.candidateId,{
        decision:'unavailable',reasonCodes:['invalid_whatsapp_link'],result:{status:'failed',reason:'invalid_whatsapp_link'},completedAt:Date.now(),
      },{cdpBaseUrl:whatsappCdp});
      return 'local_task';
    }
    markTaskBlocked(task,joined.reason||'direct_join_failed',METADATA_RETRY_COOLDOWN_MS);
    console.warn(`Direct WhatsApp join deferred: ${joined.reason||'direct_join_failed'}`);
    return 'local_task';
  }

  const result={...pre,...joined.result};
  if(!result.topicMatch||result.topicMatch==='unknown'){
    if(pre.topicMatch&&pre.topicMatch!=='unknown')result.topicMatch=pre.topicMatch;
  }
  if(!result.adsPolicy&&pre.adsPolicy)result.adsPolicy=pre.adsPolicy;
  if(typeof result.canWrite!=='boolean'&&typeof pre.canWrite==='boolean')result.canWrite=pre.canWrite;

  const evaluated=evaluateLocalPreflight(task,result);
  if(evaluated.decision==='incomplete'){
    await writeWorkOsLocalDiscoveryResultViaCdp(baseUrl,task.candidateId,{
      decision:'unavailable',
      reasonCodes:['qualification_incomplete',...evaluated.reasonCodes],
      result:{...result,status:'incomplete'},
      completedAt:Date.now(),
    },{cdpBaseUrl:whatsappCdp});
    console.warn(`Joined chat has incomplete factual qualification; kept joined and marked unavailable (${result.observedName||task.name}).`);
    return 'local_task';
  }

  let leftAfterCheck=false;
  let leaveReason=null;
  if(evaluated.decision!=='target'){
    const left=await leaveWhatsappGroupViaRuntime(result.groupId,{cdpBaseUrl:whatsappCdp}).catch(()=>({kind:'blocked',reason:'direct_leave_failed'}));
    leftAfterCheck=left.kind==='result'&&left.result?.left===true;
    if(!leftAfterCheck)leaveReason=left.reason||'direct_leave_failed';
  }
  await writeWorkOsLocalDiscoveryResultViaCdp(baseUrl,task.candidateId,{
    decision:evaluated.decision,
    reasonCodes:evaluated.reasonCodes,
    result:{...result,topicMatch:evaluated.topicMatch},
    leftAfterCheck,leaveReason,completedAt:Date.now(),
  },{cdpBaseUrl:whatsappCdp});
  console.log(evaluated.decision==='target'
    ? `Local target verified via direct WhatsApp runtime: ${result.observedName||task.name}`
    : `Local candidate rejected after direct join: ${result.observedName||task.name}`);
  return 'local_task';
}

async function resolveLocalSourceSeedData(){
  if(localSourceSeedData)return localSourceSeedData;
  const result=await readWorkOsLocalDiscoverySeedDataViaCdp(baseUrl,{cdpBaseUrl:whatsappCdp});
  if(result.kind!=='result')throw new Error(result.reason||'source_plan_unavailable');
  localSourceSeedData=result.seedData;
  localSourceSeedVersion=Number(result.version)||0;
  console.log(`Discovery source plan loaded from authorized Work OS page${localSourceSeedVersion?` (v${localSourceSeedVersion})`:''}.`);
  return localSourceSeedData;
}

async function crawlLocalDiscoveryBatch(cursor){
  const start=Math.max(0,Number(cursor)||0);
  let seedData;
  try{
    seedData=await resolveLocalSourceSeedData();
  }catch(error){
    const reason=error instanceof Error?error.message:String(error);
    return {searched:0,nextCursor:start,done:false,totalTasks:0,errors:[{cursor:start,query:'План пошуку Work OS',reason}],query:'План пошуку Work OS',sources:[]};
  }
  const width=start>=15?2:1;
  const batches=await Promise.all(Array.from({length:width},(_,index)=>crawlLocalDiscoverySource(start+index,{seedData})));
  const errors=batches.flatMap(item=>item.errors||[]);
  const warnings=batches.flatMap(item=>item.warnings||[]);
  const deferredIndex=batches.findIndex(item=>item?.deferred===true);
  const usable=deferredIndex>=0?batches.slice(0,deferredIndex):batches;
  const retryAfterMs=deferredIndex>=0?Math.max(1000,Number(batches[deferredIndex]?.retryAfterMs)||1000):0;
  return {
    searched:usable.reduce((sum,item)=>sum+(Number(item?.searched)||0),0),
    nextCursor:errors.length?start:usable.reduce((max,item)=>Math.max(max,Number(item?.nextCursor)||start),start),
    done:errors.length===0&&deferredIndex<0&&batches.at(-1)?.done===true,
    deferred:deferredIndex>=0,
    retryAfterMs,
    totalTasks:batches.find(item=>Number.isFinite(item.totalTasks))?.totalTasks||0,
    errors,warnings,
    query:batches.map(item=>item?.query||'').filter(Boolean).join(' | '),
    sources:errors.length?[]:usable.flatMap(item=>Array.isArray(item?.sources)?item.sources:[]),
  };
}

function startLocalSourceRefill(initialLocal){
  if(localSourceInFlight||initialLocal?.sourceExhausted===true||Number(initialLocal?.queuedCount||0)>=LOCAL_SOURCE_TARGET_QUEUE)return;
  localSourceInFlight=(async()=>{
    let local=initialLocal;
    try{
      while(local?.active===true&&local.sourceExhausted!==true&&Number(local.queuedCount||0)<LOCAL_SOURCE_TARGET_QUEUE){
        const wait=Math.max(0,nextLocalSourceAt-Date.now());
        if(wait>0)await sleep(wait);
        const cursor=Number(local.sourceCursor)||0;
        const batch=await crawlLocalDiscoveryBatch(cursor);
        if(Array.isArray(batch.warnings)&&batch.warnings.length){
          for(const warning of batch.warnings.slice(0,4))console.warn('Discovery source warning: '+String(warning?.query||'source')+' · '+String(warning?.reason||'unavailable'));
        }
        if(batch.deferred===true){
          nextLocalSourceAt=Date.now()+Math.max(1000,Number(batch.retryAfterMs)||LOCAL_SOURCE_MIN_MS);
          console.warn('Discovery source query deferred without advancing cursor because the external search attempt did not complete.');
          break;
        }
        const applied=await applyWorkOsLocalDiscoverySourceBatchViaCdp(baseUrl,batch,{cdpBaseUrl:whatsappCdp});
        nextLocalSourceAt=Date.now()+(applied.errors?60_000:LOCAL_SOURCE_MIN_MS);
        if(applied.kind!=='result'||applied.errors)break;
        console.log('Local source crawl: cursor '+batch.nextCursor+', sources '+batch.sources.length+', added '+(applied.added||0)+', duplicates '+(applied.duplicates||0));
        if(batch.done===true)break;
        const refillSkipCandidateIds=[...taskBlockedUntil.entries()]
          .filter(([,until])=>until>Date.now())
          .map(([candidateId])=>candidateId);
        const refreshed=await readWorkOsLocalDiscoveryTaskViaCdp(baseUrl,{cdpBaseUrl:whatsappCdp,skipCandidateIds:refillSkipCandidateIds});
        if(refreshed.kind!=='result')break;
        local=refreshed;
      }
    }catch(error){
      console.warn('Local source refill failed: '+(error instanceof Error?error.message:String(error)));
    }finally{
      localSourceInFlight=null;
    }
  })();
}

async function runOnce(){
  if(whatsappCdp){
    try{
      const skipCandidateIds=[...taskBlockedUntil.entries()]
        .filter(([,until])=>until>Date.now())
        .map(([candidateId])=>candidateId);
      const local=await readWorkOsLocalDiscoveryTaskViaCdp(baseUrl,{cdpBaseUrl:whatsappCdp,skipCandidateIds});
      if(local.kind==='result'&&local.active===true){
        startLocalSourceRefill(local);
        if(Date.now()<whatsappRuntimeBlockedUntil)return 'local_wait';
        if(local.task){
          try{
            const health=await readWhatsappHomeHealthViaCdp({cdpBaseUrl:whatsappCdp});
            if(health.kind==='result'&&health.home===true){
              if(health.authenticated!==true){
                markWhatsappRuntimeBlocked('whatsapp_not_authenticated');
                return 'local_wait';
              }
              if(health.ready!==true){
                if(health.loading===true){
                  whatsappLoadingSignals+=1;
                  if(whatsappLoadingSignals===1)console.warn('WhatsApp Web home is still loading; waiting before metadata qualification.');
                  const canReload=whatsappLoadingSignals>=WHATSAPP_LOADING_RELOAD_AFTER
                    &&Date.now()-lastWhatsappReloadAt>=WHATSAPP_LOADING_RELOAD_COOLDOWN_MS;
                  if(canReload){
                    try{
                      const reset=await resetWhatsappPageViaCdp({cdpBaseUrl:whatsappCdp});
                      if(reset.kind==='result'){
                        lastWhatsappReloadAt=Date.now();
                        whatsappLoadingSignals=0;
                        whatsappHomeRecoveryPending=true;
                        whatsappRuntimeBlockedUntil=Math.max(whatsappRuntimeBlockedUntil,Date.now()+WHATSAPP_LOADING_COOLDOWN_MS);
                        console.warn('WhatsApp Web stayed on message loading; reloaded home and will resume after cooldown.');
                      }
                    }catch(error){
                      console.warn('WhatsApp Web recovery reload failed: '+(error instanceof Error?error.message:String(error)));
                    }
                  }
                }
                return 'local_wait';
              }
              if(whatsappHomeRecoveryPending||whatsappLoadingSignals>0){
                whatsappHomeRecoveryPending=false;
                whatsappLoadingSignals=0;
                console.log('WhatsApp Web home is ready again; resuming queued Discovery candidates.');
              }
            }
          }catch{}
          return processLocalPreflight(local.task);
        }
        return 'local_wait';
      }
    }catch(error){
      console.warn(`Local Discovery bridge unavailable: ${error instanceof Error?error.message:String(error)}`);
    }
  }
  if(!token){
    await refreshExecutorTokenIfNeeded();
    if(!token)return 'idle';
  }
  const queue=await api(`/api/chat-discovery/executor?limit=${EXECUTOR_QUEUE_LIMIT}`);
  const queuedTasks=Array.isArray(queue.tasks)?queue.tasks:[];
  const task=queuedTasks.find(item=>!taskIsLocallyBlocked(item));
  if(!task){
    if(queuedTasks.length)return 'idle';

    if(canAdvanceDiscoverySource(queue)){
      const sourceOutcome=await advanceDiscoverySource();
      if(sourceOutcome)return sourceOutcome;
    }

    const automation=await api('/api/messenger-automation/executor?platform=whatsapp');
    if(automation.task?.kind==='whatsapp_autopost'){
      const job=automation.task;
      if(!whatsappCdp){
        console.warn('WhatsApp autopost requires WORK_OS_WHATSAPP_CDP; backing off until the browser adapter is available.');
        return 'idle';
      }
      let automated;
      try{automated=await sendWhatsappAutopostViaCdp(job,{cdpBaseUrl:whatsappCdp});}
      catch(error){
        markWhatsappRuntimeBlocked('cdp_unavailable');
        console.warn(`WhatsApp autopost CDP unavailable; no callback sent: ${error instanceof Error?error.message:String(error)}`);
        return 'idle';
      }
      if(automated.kind==='result'&&automated.result.sendConfirmed===true){
        clearWhatsappRuntimeBlock();
        await api('/api/messenger-automation/executor',{method:'POST',body:JSON.stringify({
          action:'complete-whatsapp-autopost',jobId:job.jobId,status:'sent',
          observedTarget:automated.result.observedTarget,targetVerified:true,sendConfirmed:true,
        })});
        console.log(`Confirmed WhatsApp autopost accepted by Work OS for ${automated.result.observedTarget}.`);
        return 'task';
      }
      console.warn(`WhatsApp autopost stopped fail-closed: ${automated.reason}`);
      if(WHATSAPP_RUNTIME_TRANSIENT_REASONS.has(automated.reason)){
        markWhatsappRuntimeBlocked(automated.reason);
        return 'idle';
      }
      await api('/api/messenger-automation/executor',{method:'POST',body:JSON.stringify({
        action:'complete-whatsapp-autopost',jobId:job.jobId,status:'failed',
        observedTarget:job.target.expectedName,targetVerified:false,sendConfirmed:false,errorCode:automated.reason,
      })});
      return 'task';
    }
    return 'idle';
  }
  if(task.action==='leave'){
    if(task.runtime==='whatsapp_web'&&whatsappCdp){
      try{
        const automated=await leaveWhatsappTaskViaCdp(task,{cdpBaseUrl:whatsappCdp});
        if(automated.kind==='result'&&automated.result.left===true){
          clearWhatsappRuntimeBlock();
          await api('/api/chat-discovery/executor',{method:'POST',body:JSON.stringify({action:'executor-leave',candidateId:task.candidateId,version:task.candidateVersion,chatStateToken:task.chatStateToken,targetVerified:true})});
          console.log('Verified WhatsApp leave accepted by Work OS.');
          return 'task';
        }
        if(WHATSAPP_RUNTIME_TRANSIENT_REASONS.has(automated.reason))markWhatsappRuntimeBlocked(automated.reason);
        console.warn(`WhatsApp leave automation stopped fail-closed: ${automated.reason}`);
        markTaskBlocked(task,automated.reason);
      }catch(error){
        markWhatsappRuntimeBlocked('cdp_unavailable');
        console.warn(`WhatsApp leave CDP unavailable; no callback sent: ${error instanceof Error?error.message:String(error)}`);
      }
      if(!process.stdin.isTTY)return 'idle';
      console.log('Falling back to operator-confirmed leave; no callback was sent for the ambiguous browser state.');
    }
    openUrl(task.link);
    console.log(`\nLeave requested: ${task.name}`);
    const targetVerified=yes(await terminal.question(`Exact target verified as "${task.expectedTarget?.name||task.name}"? [y/N] `));
    if(!targetVerified){console.log('Target was not verified; leave skipped fail-closed.');return 'idle';}
    if(!yes(await terminal.question('Confirm only AFTER you actually left the chat [y/N]: '))) return 'idle';
    await api('/api/chat-discovery/executor',{method:'POST',body:JSON.stringify({action:'executor-leave',candidateId:task.candidateId,version:task.candidateVersion,chatStateToken:task.chatStateToken,targetVerified:true})});
  }else{
    const inspection=await inspectTask(task);
    if(inspection.kind==='blocked'){
      markTaskBlocked(task,inspection.reason);
      return 'idle';
    }
    await api('/api/chat-discovery/executor',{method:'POST',body:JSON.stringify({action:'inspect',candidateId:task.candidateId,version:task.candidateVersion,minMembers:task.minMembers,result:inspection.result})});
  }
  clearTaskBlock(task);
  console.log('Result accepted by Work OS.');
  if(queuedTasks.length<=1&&canAdvanceDiscoverySource(queue)){
    try{await advanceDiscoverySource();}
    catch(error){console.warn(`Discovery source refill deferred: ${error instanceof Error?error.message:String(error)}`);}
  }
  return 'task';
}
console.log('Work OS Discovery runner started. Ctrl+C to stop.');
let idleDelayMs=IDLE_POLL_MIN_MS;
while(true){
  let outcome='idle';
  try{outcome=await runOnce();}
  catch(error){console.error(error instanceof Error?error.message:String(error));}
  let waitMs=idleDelayMs;
  if(outcome==='local_task'||outcome==='local_wait'){
    waitMs=LOCAL_PREFLIGHT_POLL_MS;
    idleDelayMs=IDLE_POLL_MIN_MS;
  }else if(outcome==='task'||outcome==='source_added'){
    waitMs=TASK_POLL_MS;
    idleDelayMs=IDLE_POLL_MIN_MS;
  }else if(outcome==='source_advanced'){
    waitMs=SOURCE_ADVANCE_MS;
    idleDelayMs=IDLE_POLL_MIN_MS;
  }else{
    idleDelayMs=Math.min(IDLE_POLL_MAX_MS,idleDelayMs*2);
  }
  await sleep(waitMs);
}
