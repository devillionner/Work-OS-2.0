#!/usr/bin/env node
import { execFile, execFileSync } from 'node:child_process';
import process from 'node:process';
import readline from 'node:readline/promises';
import { inspectWhatsappTaskViaCdp, leaveWhatsappTaskViaCdp, readWorkOsExecutorTokenViaCdp, sendWhatsappAutopostViaCdp, toWhatsAppWebInviteUrl } from './whatsapp-web-cdp.mjs';

const baseUrl=(process.env.WORK_OS_URL||'').replace(/\/$/,'');
const whatsappCdp=(process.env.WORK_OS_WHATSAPP_CDP||'').replace(/\/$/,'');
const token=await resolveExecutorToken();
if(!baseUrl||!token){console.error('Set WORK_OS_URL and WORK_OS_EXECUTOR_TOKEN, or use a supported local pairing flag.');process.exit(2);}
if(!process.stdin.isTTY&&!whatsappCdp){
  console.error('Non-interactive Discovery runner requires WORK_OS_WHATSAPP_CDP; exiting before any Work OS/D1 polling.');
  process.exit(2);
}
const terminal=readline.createInterface({input:process.stdin,output:process.stdout});
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const TASK_POLL_MS=3000;
const WHATSAPP_RUNTIME_COOLDOWN_MS=300000;
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
        return automated.result;
      }
      if(WHATSAPP_RUNTIME_TRANSIENT_REASONS.has(automated.reason))markWhatsappRuntimeBlocked(automated.reason);
      console.warn(`WhatsApp Web automation stopped fail-closed: ${automated.reason}`);
    }catch(error){
      markWhatsappRuntimeBlocked('cdp_unavailable');
      console.warn(`WhatsApp Web CDP unavailable; no callback sent: ${error instanceof Error?error.message:String(error)}`);
    }
    if(!process.stdin.isTTY)return null;
    console.log('Falling back to operator-confirmed inspection; no callback was sent for the ambiguous browser state.');
  }
  return inspect(task);
}

let whatsappRuntimeBlockedUntil=0;
function markWhatsappRuntimeBlocked(reason){
  whatsappRuntimeBlockedUntil=Math.max(whatsappRuntimeBlockedUntil,Date.now()+WHATSAPP_RUNTIME_COOLDOWN_MS);
  console.warn(`WhatsApp runtime temporarily blocks automated WhatsApp actions (${reason}); retry after cooldown.`);
}
function clearWhatsappRuntimeBlock(){whatsappRuntimeBlockedUntil=0;}

async function runOnce(){
  const queue=await api('/api/chat-discovery/executor?limit=1');
  const task=queue.tasks?.[0];
  if(!task){
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
    const result=await inspectTask(task);
    if(!result)return 'idle';
    await api('/api/chat-discovery/executor',{method:'POST',body:JSON.stringify({action:'inspect',candidateId:task.candidateId,version:task.candidateVersion,minMembers:task.minMembers,result})});
  }
  console.log('Result accepted by Work OS.'); return 'task';
}
console.log('Work OS Discovery runner started. Ctrl+C to stop.');
let idleDelayMs=IDLE_POLL_MIN_MS;
while(true){
  let outcome='idle';
  try{outcome=await runOnce();}
  catch(error){console.error(error instanceof Error?error.message:String(error));}
  let waitMs=idleDelayMs;
  if(outcome==='task'){
    waitMs=TASK_POLL_MS;
    idleDelayMs=IDLE_POLL_MIN_MS;
  }else{
    idleDelayMs=Math.min(IDLE_POLL_MAX_MS,idleDelayMs*2);
  }
  await sleep(waitMs);
}
