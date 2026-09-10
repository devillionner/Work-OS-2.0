'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BellRing, Check, ChevronDown, Clock3, Plus, TimerReset, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { createRefreshGate } from '@/lib/refresh-gate';

type TimerItem={id:string;label:string;platform:string|null;telegramAccountId:string|null;durationSeconds:number;startedAt:number;endsAt:number;status:'running'|'completed';completedAt:number|null};
type Platform='telegram'|'whatsapp'|'viber'|'facebook'|'general';
const platformOptions:Array<{key:Platform;label:string}>=[{key:'telegram',label:'Telegram'},{key:'whatsapp',label:'WhatsApp'},{key:'viber',label:'Viber'},{key:'facebook',label:'Facebook'},{key:'general',label:'Загальний'}];

export function GlobalTimers({ enabledPlatforms }: { enabledPlatforms: string[] }) {
  const [open,setOpen]=useState(false);
  const [timers,setTimers]=useState<TimerItem[]>([]);
  const [selectedPlatform,setPlatform]=useState<Platform>('telegram');
  const [selectedDuration,setDuration]=useState(15);
  const [now,setNow]=useState(()=>Math.floor(Date.now()/1000));
  const [error,setError]=useState('');
  const [busy,setBusy]=useState(false);
  const announced=useRef(new Set<string>());
  const audioContext=useRef<AudioContext|null>(null);
  const refresh=useRef(createRefreshGate(120_000));
  const revision=useRef(0);
  const mutating=useRef(false);
  const clockOffset=useRef(0);
  const availablePlatformOptions=useMemo(
    ()=>platformOptions.filter(item=>item.key==='general'||enabledPlatforms.includes(item.key)),
    [enabledPlatforms],
  );

  const platform=availablePlatformOptions.some(item=>item.key===selectedPlatform)
    ?selectedPlatform:availablePlatformOptions[0]?.key||'general';
  const duration=platform==='telegram'?15:selectedDuration;

  const load=useCallback(async()=>{
    const expectedRevision=revision.current;
    const response=await fetch('/api/timers',{cache:'no-store',signal:AbortSignal.timeout(15_000)});
    const body=await response.json() as {timers?:TimerItem[];serverNow?:number;error?:string};
    if(!response.ok) throw new Error(body.error||'Не вдалося завантажити таймери.');
    if(expectedRevision!==revision.current)return;
    setTimers(body.timers||[]);
    if(body.serverNow){clockOffset.current=body.serverNow-Math.floor(Date.now()/1000);setNow(body.serverNow);}
  },[]);
  useEffect(()=>{
    const sync=()=>void refresh.current(Date.now(),document.visibilityState==='visible'&&navigator.onLine&&!mutating.current,load).catch(reason=>setError(message(reason)));
    const initial=window.setTimeout(sync,0);
    const tick=window.setInterval(()=>{setNow(Math.floor(Date.now()/1000)+clockOffset.current);sync();},1000);
    document.addEventListener('visibilitychange',sync);
    window.addEventListener('online',sync);
    return()=>{clearTimeout(initial);clearInterval(tick);document.removeEventListener('visibilitychange',sync);window.removeEventListener('online',sync);revision.current+=1;};
  },[load]);
  useEffect(()=>{
    const due=timers.filter(timer=>timer.status==='completed'||timer.endsAt<=now);
    for(const timer of due) if(!announced.current.has(timer.id)){announced.current.add(timer.id);playAlarm(audioContext.current);setOpen(true);}
  },[timers,now]);

  async function start(){
    if(mutating.current)return;
    mutating.current=true;revision.current+=1;
    setBusy(true);setError('');
    try{
      if(!audioContext.current)audioContext.current=new AudioContext();
      if(audioContext.current.state==='suspended')await audioContext.current.resume();
      const response=await fetch('/api/timers',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'start',platform,durationMinutes:duration})});
      const body=await response.json() as {timer?:TimerItem;error?:string};
      if(!response.ok||!body.timer)throw new Error(body.error||'Не вдалося запустити таймер.');
      setTimers(current=>[body.timer!,...current]);setOpen(true);
    }catch(reason){setError(message(reason));}finally{mutating.current=false;setBusy(false)}
  }
  async function toggleOpen(){
    if(!audioContext.current)audioContext.current=new AudioContext();
    if(audioContext.current.state==='suspended')await audioContext.current.resume().catch(()=>{});
    setOpen(value=>!value);
  }
  async function dismiss(id:string){
    if(mutating.current)return;
    mutating.current=true;revision.current+=1;
    setBusy(true);setError('');
    try{const response=await fetch('/api/timers',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'dismiss',id})});const body=await response.json() as {error?:string};if(!response.ok)throw new Error(body.error||'Не вдалося закрити таймер.');setTimers(current=>current.filter(timer=>timer.id!==id));}
    catch(reason){setError(message(reason));}finally{mutating.current=false;setBusy(false)}
  }
  const running=timers.filter(timer=>timer.status==='running'&&timer.endsAt>now);
  const completed=timers.filter(timer=>timer.status==='completed'||timer.endsAt<=now);
  const nearest=useMemo(()=>running.reduce<TimerItem|null>((best,timer)=>!best||timer.endsAt<best.endsAt?timer:best,null),[running]);
  return <div className="global-timers">
    <button className={`timer-trigger ${completed.length?'has-alert':''}`} type="button" aria-expanded={open} onClick={()=>void toggleOpen()}><Clock3/><span>{nearest?formatDuration(nearest.endsAt-now):'Таймери'}</span>{timers.length>0&&<b>{timers.length}</b>}<ChevronDown/></button>
    {open&&<section className="timer-popover" aria-label="Таймери">
      <header><div><p className="eyebrow">Завжди під рукою</p><h2>Таймери</h2></div><button type="button" aria-label="Закрити" onClick={()=>setOpen(false)}><X/></button></header>
      <div className="timer-create"><label>Для<select value={platform} onChange={event=>{const next=event.target.value as Platform;setPlatform(next);if(next==='telegram')setDuration(15)}}>{availablePlatformOptions.map(item=><option value={item.key} key={item.key}>{item.label}</option>)}</select></label><div className="timer-durations" aria-label="Тривалість">{[5,10,15].map(value=><button type="button" aria-pressed={duration===value} onClick={()=>setDuration(value)} disabled={platform==='telegram'&&value!==15} key={value}>{value} хв</button>)}</div><Button size="sm" onClick={start} disabled={busy}><Plus data-icon="inline-start"/>Запустити</Button></div>
      {error&&<p className="timer-error">{error}</p>}
      <div className="timer-list">{completed.map(timer=><TimerRow timer={timer} now={now} completed onDismiss={()=>dismiss(timer.id)} key={timer.id}/>)}{running.map(timer=><TimerRow timer={timer} now={now} onDismiss={()=>dismiss(timer.id)} key={timer.id}/>)}{!timers.length&&<div className="timer-empty"><TimerReset/><span>Активних таймерів немає</span></div>}</div>
      <footer>Працюють після переходів і перезавантаження сторінки. Звук — коли застосунок відкритий.</footer>
    </section>}
  </div>;
}

function TimerRow({timer,now,completed=false,onDismiss}:{timer:TimerItem;now:number;completed?:boolean;onDismiss:()=>void}){
  const left=Math.max(0,timer.endsAt-now);const elapsed=Math.min(timer.durationSeconds,Math.max(0,now-timer.startedAt));const progress=Math.round(elapsed/timer.durationSeconds*100);
  return <article className={`timer-row ${completed?'is-complete':''}`}><div className="timer-row-icon">{completed?<BellRing/>:<Clock3/>}</div><div><strong>{timer.label}</strong><span>{completed?'Час завершився':formatDuration(left)}</span><i><b style={{width:`${completed?100:progress}%`}}/></i></div><button type="button" onClick={onDismiss} aria-label={completed?'Підтвердити завершення':'Скасувати таймер'}>{completed?<Check/>:<X/>}</button></article>;
}
function formatDuration(seconds:number){const minutes=Math.floor(seconds/60);return `${String(minutes).padStart(2,'0')}:${String(seconds%60).padStart(2,'0')}`;}
function message(reason:unknown){return reason instanceof Error?reason.message:'Сталася помилка.';}
function playAlarm(context:AudioContext|null){if(!context||context.state!=='running')return;const start=context.currentTime;[0,0.28,0.56].forEach(delay=>{const oscillator=context.createOscillator();const gain=context.createGain();oscillator.frequency.value=880;gain.gain.setValueAtTime(.0001,start+delay);gain.gain.exponentialRampToValueAtTime(.16,start+delay+.015);gain.gain.exponentialRampToValueAtTime(.0001,start+delay+.18);oscillator.connect(gain).connect(context.destination);oscillator.start(start+delay);oscillator.stop(start+delay+.2);});}
