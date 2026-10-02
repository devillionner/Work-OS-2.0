#!/usr/bin/env node
import { execFile, execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
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
  readWorkOsLastActivityViaCdp,
  readWorkOsLocalDiscoveryTaskViaCdp,
  readWorkOsLocalDiscoverySeedDataViaCdp,
  readWorkOsLocalDiscoverySourceFeedbackViaCdp,
  updateWorkOsLocalDiscoverySourceFeedbackViaCdp,
  writeWorkOsLocalDiscoveryResultViaCdp,
  markWorkOsLocalDiscoveryCandidateViaCdp,
  applyWorkOsLocalDiscoverySourceBatchViaCdp,
  pauseWorkOsLocalDiscoveryRunViaCdp,
  sendWhatsappAutopostViaCdp,
  checkWhatsappWaitingInviteViaCdp,
  toWhatsAppWebInviteUrl,
} from './whatsapp-web-cdp.mjs';
import { recordDiscoverySourceOutcome, hydrateDiscoverySourceFeedback, telegramGroupDiscoveryPlan, telegramGroupSource } from './chat-discovery-source-crawl.mjs';
import { openTelegramWebSession, scanTelegramGroupForInvites, searchTelegramPublicGroups } from './telegram-web-cdp.mjs';

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
const LOCAL_SOURCE_MIN_MS=500;
const LOCAL_SOURCE_TARGET_QUEUE=12;
const SOURCE_ADVANCE_MS=20000;
const EXECUTOR_QUEUE_LIMIT=1;
const CLOUD_AUTOMATION_POLL_MS=15000;
// Every cloud poll reads D1 (the Discovery queue scans the owner's candidates), so an idle runner
// backs off to one poll a minute and returns to the base cadence as soon as work appears.
const CLOUD_AUTOMATION_IDLE_MAX_MS=60000;
// Work OS (and D1) is polled only while it is wanted: the operator used a Work OS tab recently, or the
// runner itself still had work a moment ago (a started Waiting check/autopost finishes on its own).
const USER_ACTIVE_WINDOW_MS=15*60_000;
const WORK_GRACE_MS=5*60_000;
const DEMAND_CHECK_MS=10_000;
const TASK_BLOCK_COOLDOWN_MS=300000;
const INCOMPLETE_QUALIFICATION_COOLDOWN_MS=15000;
const qualificationAttempts=new Map();
let localSourceSeedData=null;
let localSourceSeedVersion=0;
let localSourcePlan=null;
let localSourcePlanRunId='';
// Telegram groups already searched for WhatsApp invites; a repeated run skips them for a week.
const TELEGRAM_GROUP_RESCAN_MS=7*24*60*60*1000;
const SEARCH_GROUPS_PER_STEP=3;
let sourceFeedbackRefreshAt=0;
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
const WHATSAPP_RUNTIME_TRANSIENT_REASONS=new Set(['cdp_not_configured','cdp_not_local','cdp_websocket_not_local','whatsapp_not_authenticated','page_not_ready','whatsapp_messages_loading']);
// Discovery executor leases last 90 s; an inspect/leave that has to wait out a WhatsApp message sync
// (30–60 s after opening an invite on a large account) still has to finish inside that lease.
const DISCOVERY_WHATSAPP_TIMEOUT_MS=80000;
// WhatsApp Web home may legitimately sync for minutes; reloading it earlier restarts that sync.
const WHATSAPP_STUCK_LOADING_MS=180000;

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
  // A revoked or recreated executor token is re-read from the Work OS page instead of retrying it forever.
  if(response.status===401&&process.argv.includes('--token-from-work-os-page')){token='';nextTokenResolveAt=0;}
  if(!response.ok) throw new Error(body.error||`Work OS HTTP ${response.status}`);
  return body;
}
const statusFile=process.env.WORK_OS_RUNNER_STATUS_FILE
  ||join(process.env.XDG_STATE_HOME||join(homedir(),'.local','state'),'work-os','runner-status.json');
let lastStatusKey='';
// Read by the tray icon (scripts/work-os-runner-tray.py); written only when the state changes.
function setStatus(state,detail){
  const key=`${state}|${detail}`;
  if(key===lastStatusKey)return;
  lastStatusKey=key;
  try{
    mkdirSync(dirname(statusFile),{recursive:true});
    writeFileSync(`${statusFile}.tmp`,JSON.stringify({state,detail,pid:process.pid,updatedAt:Date.now()}));
    renameSync(`${statusFile}.tmp`,statusFile);
  }catch{}
}

let lastCloudWorkAt=0;
let demandCheckedAt=0;
let cloudWanted=false;
async function cloudDemand(){
  if(Date.now()-demandCheckedAt<DEMAND_CHECK_MS)return cloudWanted;
  demandCheckedAt=Date.now();
  let wanted=false;
  try{
    const activity=await readWorkOsLastActivityViaCdp(baseUrl,{cdpBaseUrl:whatsappCdp});
    const userActive=activity.kind==='result'&&Date.now()-activity.lastActiveAt<USER_ACTIVE_WINDOW_MS;
    wanted=userActive||Date.now()-lastCloudWorkAt<WORK_GRACE_MS;
    if(!wanted)setStatus('paused',activity.kind==='result'&&activity.pageOpen
      ?'Сайтом зараз не користуються — база не опитується'
      :'Вкладка Work OS закрита — база не опитується');
  }catch{
    wanted=Date.now()-lastCloudWorkAt<WORK_GRACE_MS;
    if(!wanted)setStatus('no_browser','Браузер з портом 9222 не відкритий — база не опитується');
  }
  if(wanted!==cloudWanted)console.log(wanted?'Work OS is in use: cloud polling resumed.':'Work OS is not in use: cloud polling paused (no D1 reads).');
  cloudWanted=wanted;
  return wanted;
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
      const automated=await inspectWhatsappTaskViaCdp(task,{cdpBaseUrl:whatsappCdp,timeoutMs:DISCOVERY_WHATSAPP_TIMEOUT_MS});
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
let whatsappLoadingSince=0;
let whatsappHomeRecoveryPending=false;
let lastWhatsappReloadAt=0;
let nextSourceAdvanceAt=0;
let nextLocalSourceAt=0;
let nextCloudAutomationAt=0;
let cloudAutomationDelayMs=CLOUD_AUTOMATION_POLL_MS;
let preferAutopost=false;
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
  // A message sync ends on its own within a minute or two; other runtime problems need a longer pause.
  const cooldown=reason==='whatsapp_messages_loading'?WHATSAPP_LOADING_COOLDOWN_MS:WHATSAPP_RUNTIME_COOLDOWN_MS;
  whatsappRuntimeBlockedUntil=Math.max(whatsappRuntimeBlockedUntil,Date.now()+cooldown);
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
  // Target: a WhatsApp group (not a community) of 700–18,000 members with a Ukrainian audience where the
  // account can write. Ad rules and recent activity are not criteria (operator decision 2026-10-02).
  if(result.chatType==='community')reasons.push('community_not_supported');
  else if(result.chatType!=='group')reasons.push(result.chatType?'not_discussion_group':'unknown_chat_type');
  if(!Number.isFinite(result.memberCount))reasons.push('unknown_member_count');
  else if(result.memberCount<minMembers)reasons.push('too_few_members');
  else if(result.memberCount>maxMembers)reasons.push('too_many_members');
  if(topic!=='match')reasons.push(topic==='mismatch'?'topic_mismatch':'unknown_topic_match');
  if(result.canWrite!==true)reasons.push(result.canWrite===false?'cannot_write':'unknown_can_write');
  if(result.accessible!==true)reasons.push('access_unavailable');
  if(result.targetVerified!==true)reasons.push('target_not_verified');
  const incompleteReasons=new Set(['unknown_chat_type','unknown_member_count','unknown_topic_match','unknown_can_write']);
  const incomplete=reasons.length>0&&reasons.every(reason=>incompleteReasons.has(reason));
  return {decision:incomplete?'incomplete':reasons.length?'rejected':'target',reasonCodes:reasons,topicMatch:topic};
}

async function processLocalPreflightVisible(task){
  const checkpoint=task.checkpoint||{attempts:0,startedAt:Date.now()};
  task={...task,checkpoint:{...checkpoint,attempts:Number(checkpoint.attempts||0)+1}};
  const marked=await markWorkOsLocalDiscoveryCandidateViaCdp(baseUrl,task,{cdpBaseUrl:whatsappCdp});
  if(marked.kind!=='result')return 'local_wait';
  try{return await processLocalPreflight(task);}
  finally{await markWorkOsLocalDiscoveryCandidateViaCdp(baseUrl,null,{cdpBaseUrl:whatsappCdp}).catch(()=>{});}
}

function addDiscoveryStageTime(task,key,elapsedMs){
  const checkpoint=task.checkpoint||{};
  const stageMs={...checkpoint.stageMs};
  stageMs[key]=(Number(stageMs[key])||0)+Math.max(0,Number(elapsedMs)||0);
  return {...task,checkpoint:{...checkpoint,stageMs}};
}

async function completeLocalPreflight(task,payload){
  const checkpoint=task.checkpoint||{};
  const final={...payload,runId:task.runId,completedAt:Date.now(),
    durationMs:Math.max(0,Date.now()-Number(checkpoint.startedAt||Date.now())),
    stageMs:{...checkpoint.stageMs}};
  // Keep the factual outcome in session storage before awaiting server persistence.
  // A failed write retries only persistence, never the external join/leave.
  await markWorkOsLocalDiscoveryCandidateViaCdp(baseUrl,{...task,checkpoint:{...checkpoint,final}},{cdpBaseUrl:whatsappCdp});
  const persistStartedAt=Date.now();
  const saved=await writeWorkOsLocalDiscoveryResultViaCdp(baseUrl,task.candidateId,final,{cdpBaseUrl:whatsappCdp});
  const persistMs=Math.max(0,Date.now()-persistStartedAt);
  if(saved.kind!=='result'){
    markTaskBlocked(task,saved.reason||'persist_failed',30000);
    return 'local_task';
  }
  clearTaskBlock(task);
  recordDiscoverySourceOutcome(task.sources,final.decision,final.reasonCodes,final.result);
  await updateWorkOsLocalDiscoverySourceFeedbackViaCdp(baseUrl,(task.sources||[]).map(source=>({
    sourceUrl:source.sourceUrl,decision:final.decision,reasonCodes:final.reasonCodes,
    memberCount:final.result?.memberCount,canWrite:final.result?.canWrite,
  })),{cdpBaseUrl:whatsappCdp}).catch(()=>{});
  sourceFeedbackRefreshAt=0;
  console.log('Discovery outcome '+JSON.stringify({candidateId:task.candidateId,name:final.result?.observedName||task.name,
    decision:final.decision,reasons:final.reasonCodes,attempts:checkpoint.attempts,durationMs:final.durationMs,
    stageMs:{...final.stageMs,persistMs}}));
  return 'local_task';
}

async function deferLocalPreflight(task,reason,result){
  const checkpoint={...task.checkpoint,...(result?{result}:{}),lastReason:reason};
  if(Number(checkpoint.attempts)>=3){
    return completeLocalPreflight({...task,checkpoint},{
      decision:'unavailable',reasonCodes:['retry_exhausted',reason],
      result:result||checkpoint.result||{status:'incomplete',reason},
    });
  }
  await markWorkOsLocalDiscoveryCandidateViaCdp(baseUrl,{...task,checkpoint},{cdpBaseUrl:whatsappCdp});
  markTaskBlocked(task,reason,15000);
  return 'local_task';
}

const FRESH_JOIN_MANUAL_REVIEW_REASONS=new Set(['unknown_topic_match']);
function needsFreshJoinManualReview(task,result,evaluated){
  const freshJoin=result?.joinedThisAttempt===true||task.checkpoint?.lastReason==='waiting_post_join_evidence';
  return freshJoin
    &&result?.membershipState==='joined'
    &&evaluated.reasonCodes.length>0
    &&evaluated.reasonCodes.every(reason=>FRESH_JOIN_MANUAL_REVIEW_REASONS.has(reason));
}
async function completeFreshJoinManualReview(task,result,evaluated){
  return completeLocalPreflight(task,{
    decision:'review',
    reasonCodes:['fresh_join_history_unavailable',...evaluated.reasonCodes],
    result:{...result,status:'manual_review',manualReviewReason:'fresh_join_history_unavailable'},
  });
}

async function qualifyLocalResult(task,result){
  const evaluated=evaluateLocalPreflight(task,result);
  if(needsFreshJoinManualReview(task,result,evaluated)){
    return completeFreshJoinManualReview(task,result,evaluated);
  }
  if(evaluated.decision==='incomplete'){
    if(Number(task.checkpoint?.attempts)<3){
      return deferLocalPreflight(task,'qualification_incomplete',result);
    }
    return completeLocalPreflight(task,{decision:'unavailable',
      reasonCodes:['qualification_incomplete',...evaluated.reasonCodes],
      result:{...result,status:'incomplete'}});
  }
  let leftAfterCheck=false,leaveReason=null;
  if(evaluated.decision!=='target'&&result.membershipState==='joined'){
    const left=await leaveWhatsappGroupViaRuntime(result.groupId,{cdpBaseUrl:whatsappCdp})
      .catch(()=>({kind:'blocked',reason:'direct_leave_failed'}));
    leftAfterCheck=left.kind==='result'&&left.result?.left===true;
    if(!leftAfterCheck)leaveReason=left.reason||'direct_leave_failed';
  }
  return completeLocalPreflight(task,{decision:evaluated.decision,reasonCodes:evaluated.reasonCodes,
    result:{...result,topicMatch:evaluated.topicMatch},leftAfterCheck,leaveReason});
}

async function localRunStillActive(task){
  const current=await readWorkOsLocalDiscoveryTaskViaCdp(baseUrl,{cdpBaseUrl:whatsappCdp});
  return current.kind==='result'&&current.active===true&&String(current.runId||'')===String(task.runId||'');
}

async function processLocalPreflight(task){
  if(task.checkpoint?.final)return completeLocalPreflight(task,task.checkpoint.final);
  const prior=task.checkpoint?.result;
  if(task.checkpoint?.lastReason==='waiting_post_join_evidence'&&prior?.membershipState==='joined'){
    return qualifyLocalResult(task,prior);
  }
  const joinedPrior=prior?.membershipState==='joined'?prior:null;
  const knownJoinedGroupId=String(joinedPrior?.groupId||task.groupId||'').trim();
  let pre=joinedPrior&&knownJoinedGroupId?{...joinedPrior,groupId:knownJoinedGroupId}:null;
  if(!pre){
    let queried;
    const metadataStartedAt=Date.now();
    try{queried=await queryWhatsappInviteViaCdp(task,{cdpBaseUrl:whatsappCdp,timeoutMs:4000});}
    catch(error){queried={kind:'blocked',reason:'metadata_query_error'};}
    task=addDiscoveryStageTime(task,'metadataMs',Date.now()-metadataStartedAt);
    if(queried.kind!=='result'){
      // Only the last bounded attempt uses the existing exact-invite UI adapter.
      if(Number(task.checkpoint?.attempts)>=3){
        if(!await localRunStillActive(task))return 'local_wait';
        const fallback=await inspectWhatsappTaskViaCdp(task,{cdpBaseUrl:whatsappCdp,timeoutMs:20000})
          .catch(()=>({kind:'blocked',reason:'ui_inspection_failed'}));
        if(fallback.kind==='result')return qualifyLocalResult(task,fallback.result);
      }
      return deferLocalPreflight(task,queried.reason||'metadata_query_unavailable');
    }
    pre=queried.result;
    if(joinedPrior){
      pre={
        ...pre,
        membershipState:'joined',
        groupId:pre.groupId||knownJoinedGroupId||task.groupId,
        ...(joinedPrior.joinedAt?{joinedAt:joinedPrior.joinedAt}:{}),
      };
    }
  }
  if(pre.reason==='invalid_whatsapp_link'){
    return completeLocalPreflight(task,{decision:'unavailable',reasonCodes:['invalid_whatsapp_link'],result:pre});
  }
  if(pre.approvalRequired===true){
    return completeLocalPreflight(task,{decision:'skipped',reasonCodes:['approval_required'],result:pre});
  }
  const minMembers=Math.max(700,Number(task.minMembers)||700);
  const reasons=[];
  if(Number.isFinite(pre.memberCount)&&pre.memberCount<minMembers)reasons.push('too_few_members');
  if(Number.isFinite(pre.memberCount)&&pre.memberCount>18000)reasons.push('too_many_members');
  if(pre.topicMatch==='mismatch')reasons.push('topic_mismatch');
  if(pre.canWrite===false)reasons.push('cannot_write');
  // Communities are screened out from invite metadata, before any join.
  if(pre.chatType==='community')reasons.push('community_not_supported');
  if(reasons.length){
    if(pre.membershipState==='joined')return qualifyLocalResult(task,pre);
    return completeLocalPreflight(task,{decision:'rejected',reasonCodes:reasons,result:pre,leftAfterCheck:false});
  }
  task={...task,name:pre.observedName||task.name,
    membershipState:pre.membershipState==='joined'?'joined':task.membershipState,
    groupId:pre.groupId||task.groupId,preflightFacts:pre,
    expectedTarget:{...task.expectedTarget,name:pre.observedName||task.name}};
  // Do not perform a second join after a timeout if WhatsApp may have accepted it.
  if(!await localRunStillActive(task))return 'local_wait';
  let joined;
  const joinStartedAt=Date.now();
  try{joined=await joinWhatsappInviteViaRuntime(task,{cdpBaseUrl:whatsappCdp,timeoutMs:15000});}
  catch(error){
    task=addDiscoveryStageTime(task,'joinAndInspectMs',Date.now()-joinStartedAt);
    return deferLocalPreflight(task,'direct_join_error',pre);
  }
  task=addDiscoveryStageTime(task,'joinAndInspectMs',Date.now()-joinStartedAt);
  if(joined.kind!=='result'){
    if(['direct_join_unavailable','joined_identity_missing'].includes(joined.reason)){
      if(!await localRunStillActive(task))return 'local_wait';
      console.warn('Direct invite module unavailable; checking exact invite through WhatsApp UI.');
      const fallback=await inspectWhatsappTaskViaCdp(task,{cdpBaseUrl:whatsappCdp,timeoutMs:30000})
        .catch(()=>({kind:'blocked',reason:'ui_inspection_failed'}));
      if(fallback.kind==='result'){
        const result={...pre,...fallback.result};
        if(!Number.isFinite(result.memberCount)&&Number.isFinite(pre.memberCount))result.memberCount=pre.memberCount;
        return qualifyLocalResult(task,result);
      }
      return deferLocalPreflight(task,fallback.reason||'ui_inspection_failed',pre);
    }
    if(['approval_required','invalid_whatsapp_link'].includes(joined.reason)){
      return completeLocalPreflight(task,{decision:joined.reason==='approval_required'?'skipped':'unavailable',
        reasonCodes:[joined.reason],result:{...pre,status:'failed',reason:joined.reason}});
    }
    if(joined.groupId){
      return deferLocalPreflight(task,joined.reason,{...pre,groupId:joined.groupId,membershipState:'joined'});
    }
    return deferLocalPreflight(task,joined.reason||'direct_join_failed',pre);
  }
  const result={...pre,...joined.result};
  return qualifyLocalResult(task,result);
}

async function resolveLocalSourcePlan(runId){
  if(localSourcePlan&&localSourcePlanRunId===runId)return localSourcePlan;
  const result=await readWorkOsLocalDiscoverySeedDataViaCdp(baseUrl,{cdpBaseUrl:whatsappCdp});
  if(result.kind!=='result')throw new Error(result.reason||'source_plan_unavailable');
  localSourceSeedData=result.seedData;
  localSourceSeedVersion=Number(result.version)||0;
  localSourcePlan=telegramGroupDiscoveryPlan(localSourceSeedData,result.telegramGroups||[]);
  localSourcePlanRunId=runId;
  console.log(`Discovery source plan loaded from authorized Work OS page${localSourceSeedVersion?` (v${localSourceSeedVersion})`:''}: ${localSourcePlan.length} Telegram steps, ${(result.telegramGroups||[]).length} joined Telegram chats.`);
  return localSourcePlan;
}

async function refreshLocalSourceFeedback(){
  if(Date.now()<sourceFeedbackRefreshAt)return;
  sourceFeedbackRefreshAt=Date.now()+5000;
  const result=await readWorkOsLocalDiscoverySourceFeedbackViaCdp(baseUrl,{cdpBaseUrl:whatsappCdp});
  if(result.kind==='result')hydrateDiscoverySourceFeedback(result.feedback||{});
}

const scannedGroupsFile=join(dirname(statusFile),'telegram-scanned-groups.json');
function readScannedGroups(){
  try{return JSON.parse(readFileSync(scannedGroupsFile,'utf8'))||{};}catch{return {};}
}
function markGroupsScanned(usernames){
  if(!usernames.length)return;
  const now=Date.now();
  const entries=Object.entries(readScannedGroups()).filter(([,at])=>now-Number(at)<TELEGRAM_GROUP_RESCAN_MS);
  for(const username of usernames)entries.push([username.toLowerCase(),now]);
  try{
    mkdirSync(dirname(scannedGroupsFile),{recursive:true});
    writeFileSync(`${scannedGroupsFile}.tmp`,JSON.stringify(Object.fromEntries(entries.slice(-20000))));
    renameSync(`${scannedGroupsFile}.tmp`,scannedGroupsFile);
  }catch{}
}
function groupRecentlyScanned(scanned,username){
  return Date.now()-Number(scanned[String(username).toLowerCase()]||0)<TELEGRAM_GROUP_RESCAN_MS;
}

// One plan step in the operator's Telegram Web tab: public groups only, never joins, never writes D1.
// Returns the WhatsApp-invite sources plus the groups that were fully searched.
async function crawlTelegramGroupStep(step,local){
  const startedAt=Date.now();
  const query=step.kind==='search'?step.query:'Приєднані Telegram-групи';
  const outcome={query,sources:[],scannedGroups:[],warnings:[],blockedReason:null,interrupted:false};
  const opened=await openTelegramWebSession({cdpBaseUrl:whatsappCdp});
  if(opened.kind!=='result'){outcome.blockedReason=opened.reason;return outcome;}
  const session=opened.session;
  try{
    const scanned=readScannedGroups();
    let groups;
    if(step.kind==='search'){
      const found=await searchTelegramPublicGroups(session,step.query,{limit:8});
      if(found.kind!=='result'){outcome.blockedReason=found.reason;return outcome;}
      groups=found.groups.filter(group=>!groupRecentlyScanned(scanned,group.username)).slice(0,SEARCH_GROUPS_PER_STEP);
    }else{
      groups=(step.groups||[]).filter(group=>!groupRecentlyScanned(scanned,group.username));
    }
    for(const group of groups){
      if(!await localRunStillActive(local)){outcome.interrupted=true;break;}
      await session.pause();
      const scan=await scanTelegramGroupForInvites(session,group);
      if(scan.kind!=='result'){outcome.blockedReason=scan.reason;break;}
      outcome.scannedGroups.push(group.username);
      if(scan.status!=='scanned'){
        console.log(`Telegram group @${group.username}: ${scan.status}`);
        continue;
      }
      console.log(`Telegram group @${group.username} (${scan.memberCount??'?'} members): ${scan.invites.length} WhatsApp invites`);
      const source=telegramGroupSource(scan,{query,place:step.place||''});
      if(source)outcome.sources.push(source);
    }
  }catch(error){
    outcome.warnings.push({query,reason:'telegram_step_failed · '+(error instanceof Error?error.message:String(error))});
  }finally{
    session.close();
    outcome.durationMs=Date.now()-startedAt;
  }
  return outcome;
}

const TELEGRAM_BLOCK_LABELS={
  telegram_flood_wait:'Telegram тимчасово обмежив пошук — автопошук зупинено, продовж пізніше',
  telegram_tab_missing:'Відкрий web.telegram.org/a в Opera з портом 9222 і продовж автопошук',
  telegram_not_authenticated:'Увійди в Telegram Web (web.telegram.org/a) і продовж автопошук',
};

async function refillLocalSourceOnce(local){
  if(local?.active!==true||local.sourceExhausted===true||Number(local.queuedCount||0)>=LOCAL_SOURCE_TARGET_QUEUE)return 'local_wait';
  if(Date.now()<nextLocalSourceAt)return 'local_wait';
  const cursor=Number(local.sourceCursor)||0;
  let plan;
  try{
    plan=await resolveLocalSourcePlan(String(local.runId||''));
    await refreshLocalSourceFeedback();
  }catch(error){
    const reason=error instanceof Error?error.message:String(error);
    await applyWorkOsLocalDiscoverySourceBatchViaCdp(baseUrl,{nextCursor:cursor,searched:0,done:false,totalTasks:0,
      errors:[{cursor,query:'План пошуку Work OS',reason}],sources:[]},{cdpBaseUrl:whatsappCdp,expectedRunId:String(local.runId||'')});
    nextLocalSourceAt=Date.now()+10_000;
    return 'local_wait';
  }
  if(cursor>=plan.length){
    await applyWorkOsLocalDiscoverySourceBatchViaCdp(baseUrl,{nextCursor:cursor,searched:0,done:true,totalTasks:plan.length,sources:[]},
      {cdpBaseUrl:whatsappCdp,expectedRunId:String(local.runId||'')});
    return 'local_wait';
  }
  const step=plan[cursor];
  setStatus('working',step.kind==='search'?`Telegram: шукаємо групи «${step.query}»`:'Telegram: перевіряємо приєднані групи');
  const crawled=await crawlTelegramGroupStep(step,local);
  if(crawled.blockedReason){
    // Stop instead of hammering Telegram; the cursor stays on this step, so «Продовжити» resumes it.
    console.warn(`Telegram source stopped: ${crawled.blockedReason}`);
    setStatus('attention',TELEGRAM_BLOCK_LABELS[crawled.blockedReason]||`Telegram: ${crawled.blockedReason}`);
    if(crawled.scannedGroups.length||crawled.sources.length){
      const partial=await applyWorkOsLocalDiscoverySourceBatchViaCdp(baseUrl,{nextCursor:cursor,searched:crawled.scannedGroups.length,
        done:false,totalTasks:plan.length,sources:crawled.sources},{cdpBaseUrl:whatsappCdp,expectedRunId:String(local.runId||'')});
      if(partial.kind==='result')markGroupsScanned(crawled.scannedGroups);
    }
    await pauseWorkOsLocalDiscoveryRunViaCdp(baseUrl,{reason:crawled.blockedReason,query:crawled.query},{cdpBaseUrl:whatsappCdp,expectedRunId:String(local.runId||'')});
    return 'local_wait';
  }
  if(crawled.interrupted&&!crawled.sources.length)return 'local_wait';
  const batch={
    nextCursor:crawled.interrupted?cursor:cursor+1,
    searched:crawled.scannedGroups.length,
    done:!crawled.interrupted&&cursor+1>=plan.length,
    totalTasks:plan.length,
    errors:[],
    warnings:crawled.warnings,
    query:crawled.query,
    sources:crawled.sources,
  };
  for(const warning of batch.warnings.slice(0,4))console.warn('Discovery source warning: '+String(warning?.query||'source')+' · '+String(warning?.reason||'unavailable'));
  const applied=await applyWorkOsLocalDiscoverySourceBatchViaCdp(baseUrl,batch,{cdpBaseUrl:whatsappCdp,expectedRunId:String(local.runId||'')});
  nextLocalSourceAt=Date.now()+(applied.errors?10_000:LOCAL_SOURCE_MIN_MS);
  if(applied.kind!=='result')return 'local_wait';
  markGroupsScanned(crawled.scannedGroups);
  if(Array.isArray(applied.sourceStats)&&applied.sourceStats.length){
    await updateWorkOsLocalDiscoverySourceFeedbackViaCdp(baseUrl,applied.sourceStats,{cdpBaseUrl:whatsappCdp}).catch(()=>{});
    sourceFeedbackRefreshAt=0;
  }
  console.log('Telegram source step: cursor '+batch.nextCursor+'/'+plan.length+', groups '+crawled.scannedGroups.length+', sources '+batch.sources.length+', added '+(applied.added||0)+', duplicates '+(applied.duplicates||0)+', sourceMs '+(crawled.durationMs||0));
  return (applied.added||0)>0?'source_added':'local_task';
}

async function runWhatsAppAutopostOnce(){
  const automation=await api('/api/messenger-automation/executor?platform=whatsapp');
  if(automation.task?.kind!=='whatsapp_autopost')return null;
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

// Operator-started Waiting check (Platforms → WhatsApp → Очікування). The server owns the batch:
// it hands out one chat at a time and stops the batch on fatal or repeated failures.
async function runWaitingCheckOnce(){
  if(!whatsappCdp)return null;
  const claimed=await api('/api/chat-discovery/waiting-check/executor');
  const task=claimed?.task;
  if(task?.kind!=='whatsapp_waiting_check')return null;
  const target={batchId:task.batchId,chatId:task.chatId};
  console.log(`WhatsApp waiting check: ${task.name}`);
  setStatus('working',`Перевірка «Очікування»: ${task.name}`);
  let outcome;
  try{outcome=await checkWhatsappWaitingInviteViaCdp(task,{cdpBaseUrl:whatsappCdp});}
  catch(error){
    console.warn(`WhatsApp waiting check CDP unavailable: ${error instanceof Error?error.message:String(error)}`);
    outcome={kind:'blocked',reason:'cdp_unavailable'};
  }
  if(outcome.kind==='blocked'){
    if(outcome.reason==='whatsapp_messages_loading'){
      whatsappRuntimeBlockedUntil=Math.max(whatsappRuntimeBlockedUntil,Date.now()+WHATSAPP_LOADING_COOLDOWN_MS);
      console.warn('WhatsApp Web is still loading; waiting check will retry the same chat shortly.');
    }else{
      markWhatsappRuntimeBlocked(outcome.reason);
    }
    await api('/api/chat-discovery/waiting-check/executor',{method:'POST',body:JSON.stringify({action:'release',...target})});
    return 'idle';
  }
  clearWhatsappRuntimeBlock();
  await api('/api/chat-discovery/waiting-check/executor',{method:'POST',body:JSON.stringify({
    action:'complete',...target,status:outcome.status,reason:outcome.reason,observedName:outcome.observedName,
  })});
  console.log(`WhatsApp waiting check result: ${outcome.status}${outcome.reason?` (${outcome.reason})`:''}`);
  if(outcome.diagnostic)console.log('WhatsApp waiting check diagnostic: '+JSON.stringify(outcome.diagnostic));
  nextCloudAutomationAt=0;
  return 'task';
}

async function runDiscoveryExecutorOnce(){
  const queue=await api(`/api/chat-discovery/executor?limit=${EXECUTOR_QUEUE_LIMIT}`);
  const queuedTasks=Array.isArray(queue.tasks)?queue.tasks:[];
  const task=queuedTasks.find(item=>!taskIsLocallyBlocked(item));
  if(!task){
    if(queuedTasks.length)return 'idle';
    if(canAdvanceDiscoverySource(queue)){
      const sourceOutcome=await advanceDiscoverySource();
      if(sourceOutcome)return sourceOutcome;
    }
    return null;
  }
  if(task.action==='leave'){
    if(task.runtime==='whatsapp_web'&&whatsappCdp){
      try{
        const automated=await leaveWhatsappTaskViaCdp(task,{cdpBaseUrl:whatsappCdp,timeoutMs:DISCOVERY_WHATSAPP_TIMEOUT_MS});
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
  return 'task';
}

async function runD1BackedTaskOnce(){
  const waiting=await runWaitingCheckOnce();
  if(waiting)return waiting;
  const autopostFirst=preferAutopost;
  preferAutopost=!preferAutopost;
  if(autopostFirst){
    const autopost=await runWhatsAppAutopostOnce();
    if(autopost)return autopost;
  }
  const discovery=await runDiscoveryExecutorOnce();
  if(discovery)return discovery;
  return autopostFirst?null:runWhatsAppAutopostOnce();
}

async function runOnce(){
  if(!token)await refreshExecutorTokenIfNeeded();
  let cloudPolled=false;
  if(!token)setStatus('no_token','Немає підключення: на сайті натисніть «Підключити цей браузер»');
  if(token&&Date.now()>=nextCloudAutomationAt&&Date.now()>=whatsappRuntimeBlockedUntil&&await cloudDemand()){
    cloudPolled=true;
    nextCloudAutomationAt=Date.now()+CLOUD_AUTOMATION_POLL_MS;
    const cloudOutcome=await runD1BackedTaskOnce();
    if(cloudOutcome){
      lastCloudWorkAt=Date.now();
      cloudAutomationDelayMs=CLOUD_AUTOMATION_POLL_MS;
      return cloudOutcome;
    }
    setStatus('ready','Готовий: чекає на завдання з Work OS');
    cloudAutomationDelayMs=Math.min(CLOUD_AUTOMATION_IDLE_MAX_MS,cloudAutomationDelayMs*2);
    nextCloudAutomationAt=Date.now()+cloudAutomationDelayMs;
  }
  if(whatsappCdp){
    try{
      const skipCandidateIds=[...taskBlockedUntil.entries()]
        .filter(([,until])=>until>Date.now())
        .map(([candidateId])=>candidateId);
      const local=await readWorkOsLocalDiscoveryTaskViaCdp(baseUrl,{cdpBaseUrl:whatsappCdp,skipCandidateIds});
      if(local.kind==='result'&&local.active===true){
        // Telegram Web and WhatsApp Web both need their tab in the foreground, so source search and
        // WhatsApp qualification take turns: a queued invite is checked first, otherwise one Telegram step runs.
        if(local.task&&Date.now()>=whatsappRuntimeBlockedUntil){
          let whatsappReady=true;
          try{
            const health=await readWhatsappHomeHealthViaCdp({cdpBaseUrl:whatsappCdp});
            if(health.kind==='result'&&health.home===true){
              if(health.authenticated!==true){
                markWhatsappRuntimeBlocked('whatsapp_not_authenticated');
                whatsappReady=false;
              }else if(health.ready!==true){
                whatsappReady=false;
                if(health.loading===true){
                  whatsappLoadingSignals+=1;
                  if(!whatsappLoadingSince)whatsappLoadingSince=Date.now();
                  if(whatsappLoadingSignals===1)console.warn('WhatsApp Web home is still loading; waiting before metadata qualification.');
                  const canReload=whatsappLoadingSignals>=WHATSAPP_LOADING_RELOAD_AFTER
                    &&Date.now()-whatsappLoadingSince>=WHATSAPP_STUCK_LOADING_MS
                    &&Date.now()-lastWhatsappReloadAt>=WHATSAPP_LOADING_RELOAD_COOLDOWN_MS;
                  if(canReload){
                    try{
                      const reset=await resetWhatsappPageViaCdp({cdpBaseUrl:whatsappCdp});
                      if(reset.kind==='result'){
                        lastWhatsappReloadAt=Date.now();
                        whatsappLoadingSignals=0;
                        whatsappLoadingSince=0;
                        whatsappHomeRecoveryPending=true;
                        whatsappRuntimeBlockedUntil=Math.max(whatsappRuntimeBlockedUntil,Date.now()+WHATSAPP_LOADING_COOLDOWN_MS);
                        console.warn('WhatsApp Web stayed on message loading; reloaded home and will resume after cooldown.');
                      }
                    }catch(error){
                      console.warn('WhatsApp Web recovery reload failed: '+(error instanceof Error?error.message:String(error)));
                    }
                  }
                }
              }else if(whatsappHomeRecoveryPending||whatsappLoadingSignals>0){
                whatsappHomeRecoveryPending=false;
                whatsappLoadingSignals=0;
                whatsappLoadingSince=0;
                console.log('WhatsApp Web home is ready again; resuming queued Discovery candidates.');
              }
            }
          }catch{}
          if(whatsappReady){
            setStatus('working',`WhatsApp: перевіряємо ${local.task.name}`);
            return processLocalPreflightVisible(local.task);
          }
        }
        return refillLocalSourceOnce(local);
      }
    }catch(error){
      console.warn(`Local Discovery bridge unavailable: ${error instanceof Error?error.message:String(error)}`);
    }
  }
  // D1-backed work runs only on the cloud cadence above; polling it on every local loop burned D1 reads.
  return 'idle';
}

console.log('Work OS Discovery runner started. Ctrl+C to stop.');
setStatus('starting','Запускається…');
for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>{setStatus('stopped','Runner зупинено');process.exit(0);});
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
