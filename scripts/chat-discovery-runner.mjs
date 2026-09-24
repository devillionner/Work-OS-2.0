#!/usr/bin/env node
import { execFile } from 'node:child_process';
import process from 'node:process';
import readline from 'node:readline/promises';

const baseUrl=(process.env.WORK_OS_URL||'').replace(/\/$/,'');
const token=process.env.WORK_OS_EXECUTOR_TOKEN||'';
if(!baseUrl||!token){console.error('Set WORK_OS_URL and WORK_OS_EXECUTOR_TOKEN.');process.exit(2);}
const terminal=readline.createInterface({input:process.stdin,output:process.stdout});
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));

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

async function inspect(task){
  openUrl(task.link);
  console.log(`\n[${task.platform}] ${task.name}\n${task.link}\nAction: ${task.action}`);
  console.log('Complete the requested messenger action manually, then record only what you actually observed.');
  const accessible=yes(await terminal.question('Chat accessible? [y/N] '));
  const membership=await terminal.question('Membership [joined/pending/not_checked/left]: ');
  const observedName=(await terminal.question('Observed name (blank keeps current): ')).trim()||task.name;
  const members=numberOrNull(await terminal.question('Member count (blank unknown): '));
  const topic=tri(await terminal.question('Topic matches? [y/n/blank unknown] '),'match','mismatch')||'unknown';
  const canWrite=tri(await terminal.question('Can write? [y/n/blank unknown] '),true,false);
  const ads=tri(await terminal.question('Ads allowed? [y/n/blank unknown] '),'allowed','forbidden')||'unknown';
  const active=tri(await terminal.question('Active recently? [y/n/blank unknown] '),'active','dead')||'unknown';
  return {status:'inspected',accessible,membershipState:membership||'not_checked',observedName,chatType:'group',memberCount:members,topicMatch:topic,canWrite,adsPolicy:ads,activityState:active};
}
async function runOnce(){
  const queue=await api('/api/chat-discovery/executor?limit=1');
  const task=queue.tasks?.[0]; if(!task)return false;
  if(task.action==='leave'){
    openUrl(task.link);
    console.log(`\nLeave requested: ${task.name}`);
    if(!yes(await terminal.question('Confirm only AFTER you actually left the chat [y/N]: '))) return true;
    await api('/api/chat-discovery/executor',{method:'POST',body:JSON.stringify({action:'executor-leave',candidateId:task.candidateId,version:task.candidateVersion,chatStateToken:task.chatStateToken})});
  }else{
    const result=await inspect(task);
    await api('/api/chat-discovery/executor',{method:'POST',body:JSON.stringify({action:'inspect',candidateId:task.candidateId,version:task.candidateVersion,minMembers:task.minMembers,result})});
  }
  console.log('Result accepted by Work OS.'); return true;
}
console.log('Work OS Discovery runner started. Ctrl+C to stop.');
while(true){await runOnce().catch(error=>console.error(error instanceof Error?error.message:String(error)));await sleep(3000);}
