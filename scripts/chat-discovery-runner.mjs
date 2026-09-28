#!/usr/bin/env node
import { execFile, execFileSync } from 'node:child_process';
import process from 'node:process';
import readline from 'node:readline/promises';
import {
  inspectWhatsappTaskViaCdp,
  queryWhatsappInviteViaCdp,
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
const SOURCE_ADVANCE_MS=20000;
const EXECUTOR_QUEUE_LIMIT=3;
const TASK_BLOCK_COOLDOWN_MS=300000;
const INCOMPLETE_QUALIFICATION_COOLDOWN_MS=15000;
const qualificationAttempts=new Map();
let localSourceSeedData=null;
let localSourceSeedVersion=0;
const PAGE_RECOVERY_COOLDOWN_MS=15000;
const WHATSAPP_RUNTIME_COOLDOWN_MS=300000;
const TOKEN_REFRESH_MS=60000;
const IDLE_POLL_MIN_MS=15000;
const IDLE_POLL_MAX_MS=60000;
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
    queried=await queryWhatsappInviteViaCdp(task,{cdpBaseUrl:whatsappCdp,timeoutMs:6_000});
  }catch(error){
    console.warn(`Invite metadata unavailable; using the exact-invite UI: ${error instanceof Error?error.message:String(error)}`);
  }
  // Internal WhatsApp modules are optional. Their failure is not evidence that a chat is unavailable.
  const pre=queried?.kind==='result'?{...queried.result}:{};
  if(pre.reason==='invalid_whatsapp_link'){
    await writeWorkOsLocalDiscoveryResultViaCdp(baseUrl,task.candidateId,{
      decision:'unavailable',reasonCodes:['invalid_whatsapp_link'],result:pre,completedAt:Date.now(),
    },{cdpBaseUrl:whatsappCdp});
    console.log(`Invite rejected before join: invalid link (${task.name})`);
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
    topicMatch:pre.topicMatch==='match'?'match':task.topicMatch,
    expectedTarget:{...task.expectedTarget,name:pre.observedName||task.expectedTarget?.name||task.name},
  };

  let inspected;
  try{
    inspected=await inspectWhatsappTaskViaCdp(task,{cdpBaseUrl:whatsappCdp,timeoutMs:28_000});
  }catch(error){
    console.warn(`Local WhatsApp preflight CDP unavailable: ${error instanceof Error?error.message:String(error)}`);
    return 'local_wait';
  }
  if(inspected.kind!=='result'){
    if(inspected.reason==='page_not_ready'){
      const attempts=(qualificationAttempts.get(task.candidateId)||0)+1;
      qualificationAttempts.set(task.candidateId,attempts);
      if(attempts<3)markTaskBlocked(task,'page_not_ready',PAGE_RECOVERY_COOLDOWN_MS);
      else{
        await writeWorkOsLocalDiscoveryResultViaCdp(baseUrl,task.candidateId,{
          decision:'unavailable',reasonCodes:['page_not_ready'],result:{status:'failed',reason:'page_not_ready'},completedAt:Date.now(),
        },{cdpBaseUrl:whatsappCdp});
        qualificationAttempts.delete(task.candidateId);
      }
      return 'local_task';
    }
    if(WHATSAPP_RUNTIME_TRANSIENT_REASONS.has(inspected.reason)){
      markWhatsappRuntimeBlocked(inspected.reason);
      return 'local_wait';
    }
    await writeWorkOsLocalDiscoveryResultViaCdp(baseUrl,task.candidateId,{
      decision:'unavailable',reasonCodes:[inspected.reason||'preflight_blocked'],
      result:{status:'failed',reason:inspected.reason||'preflight_blocked'},completedAt:Date.now(),
    },{cdpBaseUrl:whatsappCdp});
    return 'local_task';
  }

  const result={...inspected.result};
  if(result.targetVerified===true&&pre.targetVerified===true){
    if(!Number.isFinite(result.memberCount)&&Number.isFinite(pre.memberCount))result.memberCount=pre.memberCount;
    if(!result.chatType&&pre.chatType)result.chatType=pre.chatType;
    if((!result.topicMatch||result.topicMatch==='unknown')&&pre.topicMatch==='match')result.topicMatch='match';
    if((!result.adsPolicy||result.adsPolicy==='unknown')&&pre.adsPolicy)result.adsPolicy=pre.adsPolicy;
    if(typeof result.canWrite!=='boolean'&&typeof pre.canWrite==='boolean')result.canWrite=pre.canWrite;
    if(pre.groupId)result.groupId=pre.groupId;
  }
  if(result.reason==='whatsapp_join_retry_later'){
    await writeWorkOsLocalDiscoveryResultViaCdp(baseUrl,task.candidateId,{
      decision:'skipped',reasonCodes:['whatsapp_join_retry_later'],result,completedAt:Date.now(),
    },{cdpBaseUrl:whatsappCdp});
    console.warn('WhatsApp asked to retry this invite later; skipped for this run and continuing with the next candidate.');
    return 'local_task';
  }
  if(result.reason==='approval_required'||result.membershipState==='pending'){
    await writeWorkOsLocalDiscoveryResultViaCdp(baseUrl,task.candidateId,{
      decision:'skipped',reasonCodes:['approval_required'],result,completedAt:Date.now(),
    },{cdpBaseUrl:whatsappCdp});
    console.log(`Skipped approval-required WhatsApp candidate: ${result.observedName||task.name}`);
    return 'local_task';
  }
  if(result.membershipState!=='joined'){
    await writeWorkOsLocalDiscoveryResultViaCdp(baseUrl,task.candidateId,{
      decision:'unavailable',reasonCodes:[result.reason||'join_not_confirmed'],result,completedAt:Date.now(),
    },{cdpBaseUrl:whatsappCdp});
    return 'local_task';
  }

  const evaluated=evaluateLocalPreflight(task,result);
  if(evaluated.decision==='incomplete'){
    const attempt=(qualificationAttempts.get(task.candidateId)||0)+1;
    qualificationAttempts.set(task.candidateId,attempt);
    if(attempt<3){
      markTaskBlocked(task,'qualification_incomplete',INCOMPLETE_QUALIFICATION_COOLDOWN_MS);
      return 'local_task';
    }
    // Unknown facts never justify leaving a joined group.
    await writeWorkOsLocalDiscoveryResultViaCdp(baseUrl,task.candidateId,{
      decision:'unavailable',reasonCodes:['qualification_incomplete',...evaluated.reasonCodes],
      result:{...result,status:'incomplete'},completedAt:Date.now(),
    },{cdpBaseUrl:whatsappCdp});
    qualificationAttempts.delete(task.candidateId);
    return 'local_task';
  }
  qualificationAttempts.delete(task.candidateId);
  let leftAfterCheck=false;
  let leaveReason=null;
  if(evaluated.decision!=='target'){
    const leaveTask={
      ...task,action:'leave',name:result.observedName||task.name,
      expectedTarget:{name:result.observedName||task.name,link:task.link},
    };
    try{
      const left=await leaveWhatsappTaskViaCdp(leaveTask,{cdpBaseUrl:whatsappCdp,reuseCurrentVerified:true});
      leftAfterCheck=left.kind==='result'&&left.result.left===true;
      if(!leftAfterCheck)leaveReason=left.reason||'leave_not_confirmed';
    }catch(error){
      leaveReason='leave_cdp_unavailable';
    }
  }
  await writeWorkOsLocalDiscoveryResultViaCdp(baseUrl,task.candidateId,{
    decision:evaluated.decision,
    reasonCodes:evaluated.reasonCodes,
    result:{...result,topicMatch:evaluated.topicMatch},
    leftAfterCheck,leaveReason,completedAt:Date.now(),
  },{cdpBaseUrl:whatsappCdp});
  console.log(evaluated.decision==='target'
    ? `Local target verified: ${result.observedName||task.name}`
    : `Local candidate rejected after join: ${result.observedName||task.name}`);
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
  return {
    searched:batches.reduce((sum,item)=>sum+(Number(item?.searched)||0),0),
    nextCursor:errors.length?start:batches.reduce((max,item)=>Math.max(max,Number(item?.nextCursor)||start),start),
    done:errors.length===0&&batches.at(-1)?.done===true,
    totalTasks:batches.find(item=>Number.isFinite(item.totalTasks))?.totalTasks||0,
    errors,
    query:batches.map(item=>item?.query||'').filter(Boolean).join(' | '),
    sources:errors.length?[]:batches.flatMap(item=>Array.isArray(item?.sources)?item.sources:[]),
  };
}

function startLocalSourceRefill(initialLocal){
  if(localSourceInFlight||initialLocal?.sourceExhausted===true||Number(initialLocal?.queuedCount||0)>=8)return;
  localSourceInFlight=(async()=>{
    let local=initialLocal;
    try{
      while(local?.active===true&&local.sourceExhausted!==true&&Number(local.queuedCount||0)<8){
        const wait=Math.max(0,nextLocalSourceAt-Date.now());
        if(wait>0)await sleep(wait);
        const cursor=Number(local.sourceCursor)||0;
        const batch=await crawlLocalDiscoveryBatch(cursor);
        const applied=await applyWorkOsLocalDiscoverySourceBatchViaCdp(baseUrl,batch,{cdpBaseUrl:whatsappCdp});
        nextLocalSourceAt=Date.now()+(applied.errors?60_000:LOCAL_SOURCE_MIN_MS);
        if(applied.kind!=='result'||applied.errors)break;
        console.log('Local source crawl: cursor '+batch.nextCursor+', sources '+batch.sources.length+', added '+(applied.added||0)+', duplicates '+(applied.duplicates||0));
        if(batch.done===true)break;
        const refreshed=await readWorkOsLocalDiscoveryTaskViaCdp(baseUrl,{cdpBaseUrl:whatsappCdp,skipCandidateIds:[]});
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
        if(local.task)return processLocalPreflight(local.task);
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
