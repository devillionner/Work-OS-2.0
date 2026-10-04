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
// How long a Discovery check waits for WhatsApp Web's home to finish loading before the owner DO is told
// to give the turn to a Telegram step instead.
const WHATSAPP_HOME_NOT_READY_MS=20_000;
// Commit 3e: waiting_check/autopost/discovery no longer poll D1 over HTTP on a timer — the owner
// Durable Object pushes one task per process over this WebSocket the instant the runner is ready for
// it, and an idle connection costs nothing. Only the reconnect backoff is a timer now.
const WS_RECONNECT_MIN_MS=1000;
const WS_RECONNECT_MAX_MS=30000;
// Cloudflare closes a WebSocket after 100 s without traffic, and an idle runner sends nothing — without
// a keepalive it would drop and reconnect (token check + dispatch reads in D1, an offline/online flap
// for every open browser) every couple of minutes. This exact string is the owner DO's hibernation
// auto-response pair, so a ping never wakes the DO or runs any of its code.
const WS_KEEPALIVE_MS=30000;
const WS_PING=JSON.stringify({type:'ping'});
const WS_PONG=JSON.stringify({type:'pong'});
const TASK_BLOCK_COOLDOWN_MS=300000;
const INCOMPLETE_QUALIFICATION_COOLDOWN_MS=15000;
const qualificationAttempts=new Map();
let localSourcePlan=null;
let localSourcePlanRunId='';
// Telegram groups already searched for WhatsApp invites; a repeated run skips them for a week.
const TELEGRAM_GROUP_RESCAN_MS=7*24*60*60*1000;
const SEARCH_GROUPS_PER_STEP=3;
const PAGE_RECOVERY_COOLDOWN_MS=15000;
const WHATSAPP_LOADING_COOLDOWN_MS=10000;
const WHATSAPP_LOADING_RELOAD_AFTER=3;
const WHATSAPP_LOADING_RELOAD_COOLDOWN_MS=120000;
const WHATSAPP_INVITE_LOADING_COOLDOWN_MS=120000;
const METADATA_RETRY_COOLDOWN_MS=60000;
const METADATA_INCOMPLETE_COOLDOWN_MS=60000;
const WHATSAPP_RUNTIME_COOLDOWN_MS=300000;
const TOKEN_REFRESH_MS=60000;
const IDLE_POLL_MAX_MS=5000;
const WHATSAPP_RUNTIME_TRANSIENT_REASONS=new Set(['cdp_not_configured','cdp_not_local','cdp_websocket_not_local','whatsapp_not_authenticated','page_not_ready','whatsapp_messages_loading']);
// An inspect/leave sometimes has to wait out a WhatsApp message sync (30–60 s after opening an
// invite on a large account); this just bounds how long one candidate holds up the next.
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
// Source discovery stays local-first (the browser-driven Telegram/web crawl below): this never
// becomes true again without touching this exact line, a deliberate tripwire against reintroducing
// the server-side source advance that commit 2026-10-02 retired.
function canAdvanceDiscoverySource(){
  return false;
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
  const marked=markRunCandidate(task);
  if(marked.kind!=='result')return 'local_wait';
  return processLocalPreflight(task);
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
  // The factual outcome goes to the owner DO as a checkpoint first, so a lost result message retries only
  // the reporting, never the external join/leave (the next dispatch carries checkpoint.final back).
  markRunCandidate({...task,checkpoint:{...checkpoint,final}});
  const persistStartedAt=Date.now();
  const saved=writeRunResult(task,final);
  const persistMs=Math.max(0,Date.now()-persistStartedAt);
  if(saved.kind!=='result'){
    markTaskBlocked(task,saved.reason||'persist_failed',30000);
    return 'local_task';
  }
  clearTaskBlock(task);
  // Local source ranking for this runner; the DO keeps the durable source feedback from the same result.
  recordDiscoverySourceOutcome(task.sources,final.decision,final.reasonCodes,final.result);
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
  markRunCandidate({...task,checkpoint});
  markTaskBlocked(task,reason,15000);
  releaseRunCandidate(task,Date.now()+15000);
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

// The owner DO pushes run_control on start/resume/pause and run_plan on every (re)connect; a paused or
// replaced run, or a dropped channel, stops the check before its next external WhatsApp/Telegram action.
function localRunStillActive(task){
  return Boolean(liveWs&&liveWs.readyState===WebSocket.OPEN&&runControl.active&&runControl.runId&&runControl.runId===String(task.runId||''));
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

function resolveRunSourcePlan(runId){
  if(localSourcePlan&&localSourcePlanRunId===runId)return localSourcePlan;
  if(!runPlan||runPlan.runId!==runId)throw new Error('source_plan_unavailable');
  localSourcePlan=telegramGroupDiscoveryPlan(runPlan.seedData,runPlan.telegramGroups||[]);
  localSourcePlanRunId=runId;
  console.log(`Discovery source plan received from Work OS: ${localSourcePlan.length} Telegram steps, ${(runPlan.telegramGroups||[]).length} joined Telegram chats.`);
  return localSourcePlan;
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
// `onGroupSource` (optional) receives each group's invites as soon as that group is scanned, so results show
// up while the step is still running and a Stop never throws away what was already found.
async function crawlTelegramGroupStep(step,local,onGroupSource=null){
  const startedAt=Date.now();
  const query=step.kind==='search'?step.query:'Приєднані Telegram-групи';
  const outcome={query,sources:[],scannedGroups:[],warnings:[],blockedReason:null,interrupted:false};
  // Stop is checked inside every wait of the Telegram session, not only between groups (live report
  // 2026-10-04: a paused run kept scrolling Telegram for up to a minute).
  const opened=await openTelegramWebSession({cdpBaseUrl:whatsappCdp,shouldStop:()=>!localRunStillActive(local)});
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
      if(source){
        if(onGroupSource){onGroupSource(source,group.username);outcome.streamedGroups=(outcome.streamedGroups||0)+1;}
        else outcome.sources.push(source);
      }
    }
  }catch(error){
    if(error?.name==='TelegramStopped'){outcome.interrupted=true;console.log('Telegram step stopped mid-group: the run was paused.');}
    else outcome.warnings.push({query,reason:'telegram_step_failed · '+(error instanceof Error?error.message:String(error))});
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

// --- Discovery autonomous run over the live channel (2026-10-04) -----------------------------------
// The run's state lives in the owner Durable Object (lib/chat-discovery/run-state.ts), not in the Work OS
// tab any more: the DO pushes run_plan (seeds + joined Telegram groups, once per run/connection),
// run_control (active or not), and one item at a time — run_task (check one WhatsApp invite) or
// run_source (one Telegram plan step). The runner answers with progress/result/release/source_result/
// pause. The WhatsApp/Telegram work below is unchanged; only where its state goes changed.
let runPlan=null;
let runControl={runId:'',active:false};
let runTaskAnswered=false;

function liveOpen(){return Boolean(liveWs&&liveWs.readyState===WebSocket.OPEN);}

function markRunCandidate(task){
  if(!liveOpen())return {kind:'blocked',reason:'live_channel_down'};
  sendLive(liveWs,{type:'progress',process:'discovery_run',candidateId:task.candidateId,runId:task.runId,
    name:task.name,link:task.link,checkpoint:task.checkpoint||null});
  return {kind:'result'};
}

function writeRunResult(task,final){
  if(!liveOpen())return {kind:'blocked',reason:'live_channel_down'};
  sendLive(liveWs,{type:'result',process:'discovery_run',candidateId:task.candidateId,payload:final});
  runTaskAnswered=true;
  return {kind:'result'};
}

// Keeps the candidate queued but tells the DO not to hand it out before `untilMs`; a WhatsApp-runtime
// cooldown also gives Telegram steps the turn meanwhile.
function releaseRunCandidate(task,untilMs,runtimeUntilMs=whatsappRuntimeBlockedUntil){
  runTaskAnswered=true;
  sendLive(liveWs,{type:'release',process:'discovery_run',candidateId:task.candidateId,until:untilMs,
    runtimeBlockedUntil:runtimeUntilMs>Date.now()?runtimeUntilMs:0});
}

// WhatsApp Web home must be authenticated and finished loading before a Discovery check (same rules the
// old local loop applied before every candidate, including the bounded self-heal reload).
async function whatsappHomeReady(){
  try{
    const health=await readWhatsappHomeHealthViaCdp({cdpBaseUrl:whatsappCdp});
    if(health.kind!=='result'||health.home!==true)return true;
    if(health.authenticated!==true){markWhatsappRuntimeBlocked('whatsapp_not_authenticated');return false;}
    if(health.ready!==true){
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
      return false;
    }
    if(whatsappHomeRecoveryPending||whatsappLoadingSignals>0){
      whatsappHomeRecoveryPending=false;
      whatsappLoadingSignals=0;
      whatsappLoadingSince=0;
      console.log('WhatsApp Web home is ready again; resuming queued Discovery candidates.');
    }
  }catch{}
  return true;
}

async function handleRunCandidateTask(task){
  if(!localRunStillActive(task))return; // paused/replaced: the DO already abandoned this item
  runTaskAnswered=false;
  if(!whatsappCdp){releaseRunCandidate(task,Date.now()+WHATSAPP_RUNTIME_COOLDOWN_MS,Date.now()+WHATSAPP_RUNTIME_COOLDOWN_MS);return;}
  if(Date.now()<whatsappRuntimeBlockedUntil||taskIsLocallyBlocked(task)){
    releaseRunCandidate(task,Math.max(whatsappRuntimeBlockedUntil,Number(taskBlockedUntil.get(task.candidateId)||0),Date.now()+1000));
    return;
  }
  if(!await whatsappHomeReady()){
    const runtimeUntil=Math.max(whatsappRuntimeBlockedUntil,Date.now()+WHATSAPP_HOME_NOT_READY_MS);
    releaseRunCandidate(task,runtimeUntil,runtimeUntil);
    return;
  }
  setStatus('working',`WhatsApp: перевіряємо ${task.name}`);
  try{await processLocalPreflightVisible(task);}
  catch(error){console.warn('Discovery check failed: '+(error instanceof Error?error.message:String(error)));}
  // Every dispatched item gets an answer while the run is active, or the DO would wait for it forever.
  if(!runTaskAnswered&&localRunStillActive(task))releaseRunCandidate(task,Date.now()+15000);
}

function sendSourceResult(job,batch,sources=[],scannedGroups=[]){
  sendLive(liveWs,{type:'source_result',process:'discovery_run',runId:job.runId,batch,sources,scannedGroups});
}

async function handleRunSourceStep(job){
  if(!runControl.active||runControl.runId!==job.runId)return;
  hydrateDiscoverySourceFeedback(job.feedback||{});
  const cursor=Number(job.cursor)||0;
  let plan;
  try{plan=resolveRunSourcePlan(job.runId);}
  catch(error){
    sendSourceResult(job,{nextCursor:cursor,searched:0,done:false,totalTasks:0,
      errors:[{query:'План пошуку Work OS',reason:error instanceof Error?error.message:String(error)}]});
    return;
  }
  if(cursor>=plan.length){sendSourceResult(job,{nextCursor:cursor,searched:0,done:true,totalTasks:plan.length});return;}
  const step=plan[cursor];
  setStatus('working',step.kind==='search'?`Telegram: шукаємо групи «${step.query}»`:'Telegram: перевіряємо приєднані групи');
  // Each group's invites go to the DO right away (partial: cursor unchanged, the step stays in flight).
  const streamed=new Set();
  const crawled=await crawlTelegramGroupStep(step,{runId:job.runId},(source,username)=>{
    streamed.add(String(username).toLowerCase());
    sendLive(liveWs,{type:'source_result',process:'discovery_run',runId:job.runId,partial:true,
      batch:{nextCursor:cursor,searched:1,done:false,totalTasks:plan.length},sources:[source],scannedGroups:[username]});
  });
  const unstreamedGroups=crawled.scannedGroups.filter(username=>!streamed.has(String(username).toLowerCase()));
  if(crawled.blockedReason){
    // Stop instead of hammering Telegram; the cursor stays on this step, so «Продовжити» resumes it.
    console.warn(`Telegram source stopped: ${crawled.blockedReason}`);
    setStatus('attention',TELEGRAM_BLOCK_LABELS[crawled.blockedReason]||`Telegram: ${crawled.blockedReason}`);
    if(unstreamedGroups.length||crawled.sources.length){
      sendSourceResult(job,{nextCursor:cursor,searched:unstreamedGroups.length,done:false,totalTasks:plan.length},crawled.sources,unstreamedGroups);
    }
    sendLive(liveWs,{type:'pause',process:'discovery_run',runId:job.runId,reason:crawled.blockedReason,query:crawled.query});
    return;
  }
  // Paused mid-step: what was found is already in the DO (streamed); the step resumes from its start.
  if(crawled.interrupted)return;
  const batch={
    nextCursor:cursor+1,
    searched:unstreamedGroups.length,
    done:cursor+1>=plan.length,
    totalTasks:plan.length,
    errors:[],
    warnings:crawled.warnings,
  };
  for(const warning of batch.warnings.slice(0,4))console.warn('Discovery source warning: '+String(warning?.query||'source')+' · '+String(warning?.reason||'unavailable'));
  sendSourceResult(job,batch,crawled.sources,unstreamedGroups);
  console.log('Telegram source step: cursor '+batch.nextCursor+'/'+plan.length+', groups '+crawled.scannedGroups.length+', sources '+(crawled.sources.length+streamed.size)+', sourceMs '+(crawled.durationMs||0));
}

// --- Live channel (commit 3e): one WebSocket to the owner Durable Object replaces the three HTTP
// executor endpoints above. The DO pushes at most one task per process (waiting_check/autopost/
// discovery) the instant this runner is ready for it; the runner answers with 'result' (applies and
// advances), 'release' (a technical problem unrelated to this one item — the DO will not redispatch
// until an explicit 'ready') or implicitly does nothing but 'release' for anything it cannot act on.
// A lost connection is itself the DO's signal that whatever was in flight needs to be retried; there
// is nothing here to reconcile on reconnect beyond reopening the socket.

let liveWs=null;
let wsReconnectDelayMs=WS_RECONNECT_MIN_MS;

function sendLive(ws,message){
  if(ws&&ws.readyState===WebSocket.OPEN)ws.send(JSON.stringify(message));
}

// The per-process backoff before asking the DO for the next task after a release: at least as long as
// any global WhatsApp-runtime cooldown just set, and at least as long as a given candidate's own local
// cooldown (Discovery only) — otherwise the DO would immediately redispatch the same blocked item.
function scheduleReady(taskProcess,candidateUntilMs=0){
  const delay=Math.max(0,whatsappRuntimeBlockedUntil-Date.now(),candidateUntilMs-Date.now());
  setTimeout(()=>sendLive(liveWs,{type:'ready',process:taskProcess}),delay);
}

function releaseTask(ws,taskProcess,task,candidateUntilMs=0){
  if(taskProcess==='waiting_check')sendLive(ws,{type:'release',process:taskProcess,batchId:task.batchId,chatId:task.chatId});
  else if(taskProcess==='autopost')sendLive(ws,{type:'release',process:taskProcess,jobId:task.jobId});
  else if(taskProcess==='discovery')sendLive(ws,{type:'release',process:taskProcess,candidateId:task.candidateId});
  scheduleReady(taskProcess,candidateUntilMs);
}

// The Waiting check in progress, so the operator's Stop (a 'cancel' pushed by the owner DO) can abort
// it before anything is pressed in WhatsApp instead of letting it run to the end.
let currentWaitingCheck=null;
function cancelWaitingCheck(batchId){
  for(let index=incomingTaskQueue.length-1;index>=0;index-=1){
    const queued=incomingTaskQueue[index];
    if(queued.taskProcess==='waiting_check'&&queued.task?.batchId===batchId)incomingTaskQueue.splice(index,1);
  }
  if(currentWaitingCheck&&currentWaitingCheck.batchId===batchId){
    console.log(`WhatsApp waiting check cancelled by the operator: ${currentWaitingCheck.name}`);
    currentWaitingCheck.controller.abort();
  }
}

async function handleWaitingCheckTask(ws,task){
  if(!whatsappCdp||Date.now()<whatsappRuntimeBlockedUntil){releaseTask(ws,'waiting_check',task);return;}
  console.log(`WhatsApp waiting check: ${task.name}`);
  setStatus('working',`Перевірка «Очікування»: ${task.name}`);
  const controller=new AbortController();
  currentWaitingCheck={batchId:task.batchId,name:task.name,controller};
  let outcome;
  try{outcome=await checkWhatsappWaitingInviteViaCdp(task,{cdpBaseUrl:whatsappCdp,signal:controller.signal});}
  catch(error){
    console.warn(`WhatsApp waiting check CDP unavailable: ${error instanceof Error?error.message:String(error)}`);
    outcome={kind:'blocked',reason:'cdp_unavailable'};
  }finally{
    if(currentWaitingCheck?.controller===controller)currentWaitingCheck=null;
  }
  // Stopped by the operator: the DO already fenced this batch, so there is nothing to report or release,
  // and it is not a WhatsApp runtime problem (no cooldown).
  if(controller.signal.aborted)return;
  if(outcome.kind==='blocked'){
    if(outcome.reason==='whatsapp_messages_loading'){
      whatsappRuntimeBlockedUntil=Math.max(whatsappRuntimeBlockedUntil,Date.now()+WHATSAPP_LOADING_COOLDOWN_MS);
      console.warn('WhatsApp Web is still loading; waiting check will retry the same chat shortly.');
    }else{
      markWhatsappRuntimeBlocked(outcome.reason);
    }
    releaseTask(ws,'waiting_check',task);
    return;
  }
  clearWhatsappRuntimeBlock();
  sendLive(ws,{type:'result',process:'waiting_check',batchId:task.batchId,chatId:task.chatId,
    status:outcome.status,reason:outcome.reason,observedName:outcome.observedName});
  console.log(`WhatsApp waiting check result: ${outcome.status}${outcome.reason?` (${outcome.reason})`:''}`);
  if(outcome.diagnostic)console.log('WhatsApp waiting check diagnostic: '+JSON.stringify(outcome.diagnostic));
}

async function handleAutopostTask(ws,job){
  if(!whatsappCdp){
    console.warn('WhatsApp autopost requires WORK_OS_WHATSAPP_CDP; releasing until the browser adapter is available.');
    releaseTask(ws,'autopost',job,Date.now()+WHATSAPP_RUNTIME_COOLDOWN_MS);
    return;
  }
  if(Date.now()<whatsappRuntimeBlockedUntil){releaseTask(ws,'autopost',job);return;}
  let automated;
  try{automated=await sendWhatsappAutopostViaCdp(job,{cdpBaseUrl:whatsappCdp});}
  catch(error){
    markWhatsappRuntimeBlocked('cdp_unavailable');
    console.warn(`WhatsApp autopost CDP unavailable; no callback sent: ${error instanceof Error?error.message:String(error)}`);
    releaseTask(ws,'autopost',job);
    return;
  }
  if(automated.kind==='result'&&automated.result.sendConfirmed===true){
    clearWhatsappRuntimeBlock();
    sendLive(ws,{type:'result',process:'autopost',jobId:job.jobId,status:'sent',
      observedTarget:automated.result.observedTarget,targetVerified:true,sendConfirmed:true});
    console.log(`Confirmed WhatsApp autopost accepted by Work OS for ${automated.result.observedTarget}.`);
    return;
  }
  console.warn(`WhatsApp autopost stopped fail-closed: ${automated.reason}`);
  if(WHATSAPP_RUNTIME_TRANSIENT_REASONS.has(automated.reason)){
    markWhatsappRuntimeBlocked(automated.reason);
    releaseTask(ws,'autopost',job);
    return;
  }
  sendLive(ws,{type:'result',process:'autopost',jobId:job.jobId,status:'failed',
    observedTarget:job.target.expectedName,targetVerified:false,sendConfirmed:false,errorCode:automated.reason});
}

async function handleDiscoveryTask(ws,task){
  if(taskIsLocallyBlocked(task)){
    // This exact candidate failed ambiguously a moment ago (see markTaskBlocked below); D1 never
    // learned that, so without this local cooldown the DO would just hand it straight back on the
    // very next 'ready'. Nothing else is queued behind it in the push model, so this is a real pause
    // on Discovery dispatch, not merely a skip to another candidate — an accepted, narrow tradeoff of
    // the single-task push protocol for a fail-closed safety path that should be rare in practice.
    releaseTask(ws,'discovery',task,Number(taskBlockedUntil.get(task.candidateId)||0));
    return;
  }
  if(Date.now()<whatsappRuntimeBlockedUntil){releaseTask(ws,'discovery',task);return;}
  if(task.action==='leave'){
    if(task.runtime==='whatsapp_web'&&whatsappCdp){
      try{
        const automated=await leaveWhatsappTaskViaCdp(task,{cdpBaseUrl:whatsappCdp,timeoutMs:DISCOVERY_WHATSAPP_TIMEOUT_MS});
        if(automated.kind==='result'&&automated.result.left===true){
          clearWhatsappRuntimeBlock();
          clearTaskBlock(task);
          sendLive(ws,{type:'result',process:'discovery',candidateId:task.candidateId,chatStateToken:task.chatStateToken,targetVerified:true});
          console.log('Verified WhatsApp leave accepted by Work OS.');
          return;
        }
        if(WHATSAPP_RUNTIME_TRANSIENT_REASONS.has(automated.reason))markWhatsappRuntimeBlocked(automated.reason);
        console.warn(`WhatsApp leave automation stopped fail-closed: ${automated.reason}`);
        markTaskBlocked(task,automated.reason);
      }catch(error){
        markWhatsappRuntimeBlocked('cdp_unavailable');
        console.warn(`WhatsApp leave CDP unavailable; no callback sent: ${error instanceof Error?error.message:String(error)}`);
      }
      if(!process.stdin.isTTY){releaseTask(ws,'discovery',task,Number(taskBlockedUntil.get(task.candidateId)||0));return;}
      console.log('Falling back to operator-confirmed leave; no callback was sent for the ambiguous browser state.');
    }
    openUrl(task.link);
    console.log(`\nLeave requested: ${task.name}`);
    const targetVerified=yes(await terminal.question(`Exact target verified as "${task.expectedTarget?.name||task.name}"? [y/N] `));
    if(!targetVerified){console.log('Target was not verified; leave skipped fail-closed.');releaseTask(ws,'discovery',task);return;}
    if(!yes(await terminal.question('Confirm only AFTER you actually left the chat [y/N]: '))){releaseTask(ws,'discovery',task);return;}
    sendLive(ws,{type:'result',process:'discovery',candidateId:task.candidateId,chatStateToken:task.chatStateToken,targetVerified:true});
  }else{
    const inspection=await inspectTask(task);
    if(inspection.kind==='blocked'){
      markTaskBlocked(task,inspection.reason);
      releaseTask(ws,'discovery',task,Number(taskBlockedUntil.get(task.candidateId)||0));
      return;
    }
    sendLive(ws,{type:'result',process:'discovery',candidateId:task.candidateId,result:inspection.result});
  }
  clearTaskBlock(task);
  console.log('Result accepted by Work OS.');
}

// Waiting_check/autopost/discovery all ultimately drive the one shared WhatsApp/Telegram browser tab
// through whatsappCdp, same as the local preflight loop below — withCdpLock (further down) serializes
// every one of them so two never run at once just because the DO happened to push more than one task.
const incomingTaskQueue=[];
let processingTask=false;
function enqueueTask(ws,taskProcess,task){
  incomingTaskQueue.push({ws,taskProcess,task});
  pumpTaskQueue();
}
async function pumpTaskQueue(){
  if(processingTask)return;
  const next=incomingTaskQueue.shift();
  if(!next)return;
  processingTask=true;
  try{
    await withCdpLock(()=>{
      if(next.taskProcess==='waiting_check')return handleWaitingCheckTask(next.ws,next.task);
      if(next.taskProcess==='autopost')return handleAutopostTask(next.ws,next.task);
      if(next.taskProcess==='discovery')return handleDiscoveryTask(next.ws,next.task);
      if(next.taskProcess==='discovery_run_task')return handleRunCandidateTask(next.task);
      if(next.taskProcess==='discovery_run_source')return handleRunSourceStep(next.task);
    });
  }catch(error){
    console.error(`Live channel task handler (${next.taskProcess}) failed: ${error instanceof Error?error.message:String(error)}`);
  }finally{
    processingTask=false;
    // Once the pushed queue is drained (e.g. the operator pressed Stop and the DO sends nothing more),
    // the tray must not keep showing the last task as if it were still running.
    if(!incomingTaskQueue.length&&liveWs&&liveWs.readyState===WebSocket.OPEN)setStatus('ready','Готовий: підключено до Work OS');
    pumpTaskQueue();
  }
}

function onLiveMessage(ws,raw){
  let message;
  try{message=JSON.parse(raw);}catch{return;}
  if(message.type==='task'&&['waiting_check','autopost','discovery'].includes(message.process)){
    enqueueTask(ws,message.process,message.task);
    return;
  }
  if(message.type==='cancel'&&message.process==='waiting_check'){
    cancelWaitingCheck(message.batchId);
    return;
  }
  if(message.process==='discovery_run'){
    if(message.type==='run_plan'){
      runPlan={runId:String(message.runId||''),seedData:message.seedData,telegramGroups:Array.isArray(message.telegramGroups)?message.telegramGroups:[]};
      localSourcePlan=null;localSourcePlanRunId='';
      runControl={runId:runPlan.runId,active:true};
    }else if(message.type==='run_control'){
      runControl={runId:String(message.runId||''),active:message.active===true};
      if(!runControl.active){
        for(let index=incomingTaskQueue.length-1;index>=0;index-=1){
          if(String(incomingTaskQueue[index].taskProcess).startsWith('discovery_run'))incomingTaskQueue.splice(index,1);
        }
        console.log('Discovery autonomous run paused from Work OS.');
      }
    }else if(message.type==='run_task'&&message.task){
      enqueueTask(ws,'discovery_run_task',message.task);
    }else if(message.type==='run_source'){
      enqueueTask(ws,'discovery_run_source',{runId:String(message.runId||''),cursor:Number(message.cursor)||0,feedback:message.feedback||{}});
    }else if(message.type==='run_source_applied'){
      markGroupsScanned(Array.isArray(message.scannedGroups)?message.scannedGroups.map(String):[]);
      console.log('Discovery source applied: extracted '+(Number(message.extracted)||0)+', added '+(Number(message.added)||0)+', duplicates '+(Number(message.duplicates)||0)
        +(Number(message.errors)?', errors '+Number(message.errors)+' ('+String(message.error||'unknown')+')':''));
    }
    return;
  }
  // 'pong'/'hello' need no action; 'command'/'progress'/'process_state'/'runner_status' are either
  // browser-facing broadcasts the runner never receives or not-yet-used generic relay (the Discovery
  // autonomous run) — ignore anything else instead of crashing on it.
}

function liveChannelUrl(){
  const url=new URL(baseUrl);
  url.protocol=url.protocol==='https:'?'wss:':'ws:';
  url.pathname='/api/live';
  url.search='';
  url.searchParams.set('kind','runner');
  url.searchParams.set('token',token);
  return url.toString();
}

function connectLiveChannel(){
  if(!token){setTimeout(connectLiveChannel,2000);return;}
  let ws;
  try{ws=new WebSocket(liveChannelUrl());}
  catch(error){console.error(`Live channel connect failed: ${error instanceof Error?error.message:String(error)}`);scheduleReconnect();return;}
  liveWs=ws;
  // A rejected handshake (wrong/expired token, unreachable host) fires only 'error' on this runtime's
  // WebSocket, never 'close' — readyState is left stuck at CONNECTING. A later drop of an
  // already-open connection fires 'close' (sometimes preceded by 'error'). Reconnecting from both,
  // guarded so a connection that fires both only reconnects once, covers both cases.
  let settled=false;
  let keepalive=null;
  let awaitingPong=false;
  const onDown=()=>{
    if(settled)return;
    settled=true;
    if(keepalive)clearInterval(keepalive);
    if(liveWs===ws)liveWs=null;
    try{ws.close();}catch{}
    console.warn('Work OS live channel disconnected; reconnecting…');
    setStatus('reconnecting','З’єднання з Work OS перервано — перепідключення…');
    // A revoked or rotated token is re-read from the Work OS page instead of retrying it forever; a
    // fixed env/clipboard token is left as-is (nothing here could refresh it).
    if(process.argv.includes('--token-from-work-os-page')){token='';nextTokenResolveAt=0;}
    scheduleReconnect();
  };
  ws.addEventListener('open',()=>{
    wsReconnectDelayMs=WS_RECONNECT_MIN_MS;
    console.log('Connected to the Work OS live channel.');
    setStatus('ready','Готовий: підключено до Work OS');
    keepalive=setInterval(()=>{
      // A ping still unanswered a whole interval later means a half-open socket (sleep, network
      // switch) that would otherwise look connected forever while no task can arrive.
      if(awaitingPong){console.warn('Work OS live channel stopped answering pings.');onDown();return;}
      awaitingPong=true;
      try{ws.send(WS_PING);}catch{onDown();}
    },WS_KEEPALIVE_MS);
  });
  ws.addEventListener('message',(event)=>{
    if(event.data===WS_PONG){awaitingPong=false;return;}
    onLiveMessage(ws,event.data);
  });
  ws.addEventListener('close',onDown);
  ws.addEventListener('error',onDown);
}
function scheduleReconnect(){
  const delay=wsReconnectDelayMs;
  wsReconnectDelayMs=Math.min(WS_RECONNECT_MAX_MS,wsReconnectDelayMs*2);
  setTimeout(async()=>{await refreshExecutorTokenIfNeeded();connectLiveChannel();},delay);
}

// Serializes local preflight's runOnce() iterations with live-channel task handling: both ultimately
// drive the one shared whatsappCdp browser tab and must never run concurrently.
let cdpLockChain=Promise.resolve();
function withCdpLock(fn){
  const run=cdpLockChain.then(fn,fn);
  cdpLockChain=run.then(()=>{},()=>{});
  return run;
}

console.log('Work OS Discovery runner started. Ctrl+C to stop.');
setStatus('starting','Запускається…');
for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>{setStatus('stopped','Runner зупинено');process.exit(0);});
connectLiveChannel();
// Everything (Waiting check, autopost, Discovery executor and the autonomous run) now arrives pushed over
// the live channel; this loop only keeps the executor token available until the channel can connect.
while(true){
  if(!token){
    await refreshExecutorTokenIfNeeded();
    if(!token)setStatus('no_token','Немає підключення: на сайті натисніть «Підключити цей браузер»');
  }
  await sleep(IDLE_POLL_MAX_MS);
}
