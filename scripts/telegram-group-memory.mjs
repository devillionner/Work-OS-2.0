// Memory of which public Telegram groups were already searched for WhatsApp invites, and when each one is
// worth opening again. It lives in the runner's own state directory (telegram-scanned-groups.json) — never
// in D1 — so nothing here costs a row read.
//
// Until 2026-10-06 every scanned group was skipped for a flat week, which turned the autonomous run into a
// one-shot sweep: the few groups that actually post WhatsApp invites were frozen out exactly as long as the
// many that never post any. Measured on the operator's own runner log (11.5 h of Telegram steps): 865 groups
// scanned, only 101 of them held a single invite. Those 101 are the only place a NEW invite can show up
// tomorrow, so they come back after a day while the barren ones keep the week-long cooldown.

/** A group that posted invites is worth reopening the next day — that is where a daily find comes from. */
export const PRODUCTIVE_RESCAN_MS=24*60*60*1000;
/** A group that held no invite at all keeps the original week-long cooldown. */
export const BARREN_RESCAN_MS=7*24*60*60*1000;
/** Entries are kept well past their cooldown so a group's productive history survives a quiet week. */
export const SCAN_MEMORY_RETENTION_MS=30*24*60*60*1000;
export const MAX_SCAN_MEMORY=20000;
/** Upper bound on the revisit steps one run starts with, so a daily sweep stays a known cost. */
export const MAX_REVISIT_GROUPS=60;

/** @typedef {{at:number,invites:number}} ScanMemoryEntry */
/** @typedef {Record<string,ScanMemoryEntry>} ScanMemory */

function normalizeUsername(value){
  return String(value??'').trim().toLowerCase();
}

/** Tolerates the pre-2026-10-06 file, whose value was the scan timestamp alone. */
function readEntry(value){
  if(typeof value==='number')return Number.isFinite(value)?{at:value,invites:0}:null;
  if(!value||typeof value!=='object')return null;
  const at=Number(value.at);
  if(!Number.isFinite(at))return null;
  const invites=Number(value.invites);
  return {at,invites:Number.isFinite(invites)?Math.max(0,Math.round(invites)):0};
}

/** @returns {ScanMemory} */
export function parseScanMemory(raw){
  const memory={};
  if(!raw||typeof raw!=='object')return memory;
  for(const [username,value] of Object.entries(raw)){
    const key=normalizeUsername(username);
    const entry=readEntry(value);
    if(key&&entry)memory[key]=entry;
  }
  return memory;
}

/** When this group may be opened again: a day after a scan that found invites, a week after one that did not. */
export function groupRescanDueAt(entry){
  return entry.at+(entry.invites>0?PRODUCTIVE_RESCAN_MS:BARREN_RESCAN_MS);
}

export function isGroupScanDue(memory,username,now){
  const entry=memory[normalizeUsername(username)];
  return !entry||groupRescanDueAt(entry)<=now;
}

/**
 * Records one step's scans. The invite count is the one just observed, so a group that stops posting falls
 * back to the week-long cooldown by itself and never holds a daily slot forever.
 * @returns {ScanMemory}
 */
export function rememberScannedGroups(memory,scans,now){
  const next={};
  for(const [username,entry] of Object.entries(memory)){
    if(now-entry.at<SCAN_MEMORY_RETENTION_MS)next[username]=entry;
  }
  for(const scan of scans||[]){
    const key=normalizeUsername(scan?.username);
    if(!key)continue;
    const invites=Number(scan?.invites);
    next[key]={at:now,invites:Number.isFinite(invites)?Math.max(0,Math.round(invites)):0};
  }
  const keys=Object.keys(next);
  if(keys.length<=MAX_SCAN_MEMORY)return next;
  // Over the cap the oldest scans go first: they are the ones closest to being searched again anyway.
  for(const key of keys.sort((a,b)=>next[a].at-next[b].at).slice(0,keys.length-MAX_SCAN_MEMORY))delete next[key];
  return next;
}

/** The groups a daily run should reopen first: known invite sources whose cooldown has passed, oldest first. */
export function productiveGroupsDue(memory,now,limit=MAX_REVISIT_GROUPS){
  return Object.entries(memory)
    .filter(([,entry])=>entry.invites>0&&groupRescanDueAt(entry)<=now)
    .sort((a,b)=>a[1].at-b[1].at)
    .slice(0,Math.max(0,limit))
    .map(([username])=>username);
}
