'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Copy, RefreshCw, Shuffle, Trash2, Unlink } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { TelegramWarmup } from '@/components/telegram-warmup';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { WorkspaceInlineLoading } from '@/components/workspace-load-state';
import { businessDate, businessDateTime, lessonEpoch } from '@/lib/leads/domain/time';

type Settings = {
  intervalMinutes:number; baseAt:number; selectionMode:'auto'|'manual';
  manualChatIds:string[]; version:number;
};
type Chat = { id:string; name:string; link:string };
type Slot = {
  id:string; sequence:number; scheduledAt:number; chatId:string|null;
  chatName:string|null; chatLink:string|null; status:'pending'|'completed';
  completedAt:number|null; version:number;
};
type Snapshot = {
  accountId:string; settings:Settings; eligibleChats:Chat[]; slots:Slot[];
  pending:number; completed:number; nextSlot:Slot|null;
};

type Props = { accountId:string|null; refreshKey:number; disabled?:boolean };

export function TelegramSchedule({accountId,refreshKey,disabled=false}:Props) {
  const [data,setData]=useState<Snapshot|null>(null);
  const [loading,setLoading]=useState(false);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [search,setSearch]=useState('');
  const [intervalText,setIntervalText]=useState('');
  const [rateText,setRateText]=useState('');
  const [baseTime,setBaseTime]=useState('');
  const [mode,setMode]=useState<'auto'|'manual'>('auto');
  const [manualIds,setManualIds]=useState<string[]>([]);
  const [slotCount,setSlotCount]=useState(7);
  const [clearConfirm,setClearConfirm]=useState(false);

  const applySnapshot=useCallback((next:Snapshot)=>{
    setData(next);
    setIntervalText(formatNumber(next.settings.intervalMinutes));
    setRateText(formatNumber(60/next.settings.intervalMinutes));
    setBaseTime(businessDateTime(next.settings.baseAt).slice(11,16));
    setMode(next.settings.selectionMode);
    setManualIds(next.settings.manualChatIds);
  },[]);

  const load=useCallback(async()=>{
    if(!accountId){setData(null);return;}
    setLoading(true);setError('');
    try {
      const params=new URLSearchParams({account:accountId});
      const response=await fetch(`/api/telegram-schedule?${params}`,{cache:'no-store'});
      const body=await response.json() as Snapshot&{error?:string};
      if(!response.ok)throw new Error(body.error||'Не вдалося завантажити розклад.');
      applySnapshot(body);
    } catch(reason){setError(reason instanceof Error?reason.message:'Не вдалося завантажити розклад.');}
    finally{setLoading(false);}
  },[accountId,applySnapshot]);

  useEffect(()=>{const timer=window.setTimeout(()=>void load(),0);return()=>window.clearTimeout(timer);},[load,refreshKey]);

  async function post(body:Record<string,unknown>) {
    if(!accountId)return null;
    setBusy(true);setError('');
    try {
      const response=await fetch('/api/telegram-schedule',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({accountId,...body})});
      const next=await response.json() as Snapshot&{error?:string};
      if(!response.ok)throw new Error(next.error||'Не вдалося оновити розклад.');
      applySnapshot(next);return next;
    } catch(reason){setError(reason instanceof Error?reason.message:'Не вдалося оновити розклад.');return null;}
    finally{setBusy(false);}
  }
  function changeInterval(value:string) {
    setIntervalText(value);
    const interval=Number(value.replace(',','.'));
    if(Number.isFinite(interval)&&interval>0)setRateText(formatNumber(60/interval));
  }
  function changeRate(value:string) {
    setRateText(value);
    const rate=Number(value.replace(',','.'));
    if(Number.isFinite(rate)&&rate>0)setIntervalText(formatNumber(60/rate));
  }
  function resetBaseNow() {
    setBaseTime(businessDateTime(Math.floor(Date.now()/1000)).slice(11,16));
  }
  function currentBaseEpoch() {
    const day=businessDate(Math.floor(Date.now()/1000));
    return lessonEpoch(day,baseTime);
  }
  async function saveSettings() {
    if(!data)return null;
    const interval=Number(intervalText.replace(',','.'));
    const baseAt=currentBaseEpoch();
    if(!Number.isFinite(interval)||interval<=0){setError('Інтервал має бути більшим за нуль.');return null;}
    if(baseAt===null){setError('Введіть час у форматі HH:MM.');return null;}
    return post({action:'save',expectedVersion:data.settings.version,intervalMinutes:interval,baseAt,selectionMode:mode,manualChatIds:manualIds});
  }
  async function generate() {
    if(!data)return;
    const saved=await saveSettings();
    if(!saved)return;
    await post({action:'generate',count:slotCount});
  }
  async function clearPending() {
    if(!data?.pending)return;
    await post({action:'clear_pending'});
    setClearConfirm(false);
  }
  async function editSlot(slot:Slot,time?:string,chatId?:string|null) {
    const payload:Record<string,unknown>={action:'slot',slotId:slot.id,expectedVersion:slot.version};
    if(time!==undefined){
      const epoch=lessonEpoch(businessDate(slot.scheduledAt),time);
      if(epoch===null){setError('Введіть час слота у форматі HH:MM.');return;}
      payload.scheduledAt=epoch;
    }
    if(chatId!==undefined)payload.chatId=chatId;
    await post(payload);
  }
  const selectedSet=useMemo(()=>new Set(manualIds),[manualIds]);
  const visibleChats=useMemo(()=>{const q=search.trim().toLowerCase();return q?data?.eligibleChats.filter(chat=>chat.name.toLowerCase().includes(q)||chat.link.toLowerCase().includes(q))||[]:data?.eligibleChats||[];},[data,search]);
  const pendingChatIds=useMemo(()=>new Set((data?.slots||[]).filter(slot=>slot.status==='pending'&&slot.chatId).map(slot=>slot.chatId!)),[data]);
  const total=data?(data.pending+data.completed):0;
  const progress=total?Math.round(data!.completed/total*100):0;

  function toggleManual(id:string) {
    setManualIds(current=>current.includes(id)?current.filter(item=>item!==id):[...current,id]);
  }
  function selectAllVisible() {
    if(!data)return;
    setManualIds(current=>[...new Set([...current,...visibleChats.map(chat=>chat.id)])]);
    setMode('manual');
  }
  function randomForSlots() {
    if(!data)return;
    const pool=[...visibleChats];
    for(let i=pool.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[pool[i],pool[j]]=[pool[j],pool[i]];}
    setManualIds(pool.slice(0,Math.min(slotCount,pool.length)).map(chat=>chat.id));
    setMode('manual');
  }
  async function copyPlan() {
    if(!data)return;
    const lines=data.slots.map(slot=>`${slot.status==='completed'?'✓':'○'} ${formatTime(slot.scheduledAt)} — ${slot.chatName||'Без чату'}${slot.chatLink?` — ${slot.chatLink}`:''}`);
    await navigator.clipboard.writeText(lines.join('\n'));
  }

  if(!accountId)return null;
  return <><ConfirmDialog open={clearConfirm} title="Очистити невиконані слоти?" description={`Буде видалено ${data?.pending||0} невиконаних слотів лише цього Telegram-акаунта. Виконані слоти залишаться в історії.`} confirmLabel="Очистити слоти" destructive busy={busy} onCancel={()=>setClearConfirm(false)} onConfirm={()=>void clearPending()}/><TelegramWarmup accountId={accountId}/><details className="telegram-schedule" aria-label="Telegram-розклад">
    <summary className="telegram-disclosure-summary">
      <div><strong>План публікацій</strong><small>{data?.nextSlot?`Наступна: ${formatTime(data.nextSlot.scheduledAt)} · ${data.nextSlot.chatName||'призначити чат'}`:'Окремий розклад для поточного Telegram ID'}</small></div>
      <div className="telegram-schedule-summary"><Badge variant="secondary">{data?.completed||0}/{total}</Badge><span>{progress}%</span></div>
    </summary>
    <div className="telegram-disclosure-body">
    {error&&<div className="workspace-error" role="alert">{error}</div>}
    {loading&&!data?<WorkspaceInlineLoading label="Завантажуємо розклад…"/>:null}
    {data&&<>
      <div className="telegram-schedule-controls">
        <label htmlFor="telegram-rate">Публікацій/год</label><Input id="telegram-rate" inputMode="decimal" value={rateText} disabled={busy||disabled} onChange={event=>changeRate(event.target.value)}/>
        <label htmlFor="telegram-interval">Інтервал, хв</label><Input id="telegram-interval" inputMode="decimal" value={intervalText} disabled={busy||disabled} onChange={event=>changeInterval(event.target.value)}/>
        <label htmlFor="telegram-start">Старт HH:MM</label><Input id="telegram-start" inputMode="numeric" maxLength={5} value={baseTime} disabled={busy||disabled} onChange={event=>setBaseTime(normalizeTimeInput(event.target.value))}/>
        <Button variant="outline" disabled={busy||disabled} onClick={resetBaseNow}><RefreshCw data-icon="inline-start"/>Від зараз</Button>
      </div>
      <div className="telegram-schedule-mode">
        <Button type="button" variant={mode==='auto'?'default':'outline'} disabled={busy||disabled} onClick={()=>setMode('auto')}>Автоматично</Button>
        <Button type="button" variant={mode==='manual'?'default':'outline'} disabled={busy||disabled} onClick={()=>setMode('manual')}>Вручну</Button>
        <Input value={search} onChange={event=>setSearch(event.target.value)} placeholder="Пошук доступних чатів" aria-label="Пошук чатів для розкладу"/>
        <Button variant="outline" disabled={busy||disabled||!visibleChats.length} onClick={selectAllVisible}>Вибрати всі</Button>
        <Button variant="outline" disabled={busy||disabled||!visibleChats.length} onClick={randomForSlots}><Shuffle data-icon="inline-start"/>Випадково</Button>
      </div>
      {mode==='manual'&&<div className="telegram-schedule-chat-picker">
        <div><strong>Вибрано {manualIds.length}</strong><Button variant="ghost" size="sm" onClick={()=>setManualIds([])} disabled={busy||disabled||!manualIds.length}>Очистити вибір</Button></div>
        <div className="telegram-schedule-chat-list">
          {visibleChats.map(chat=><label key={chat.id} className="telegram-schedule-chat-option"><input aria-label={`Вибрати чат ${chat.name}`} type="checkbox" checked={selectedSet.has(chat.id)} disabled={busy||disabled} onChange={()=>toggleManual(chat.id)}/><span><strong>{chat.name}</strong><small>{chat.link}</small></span></label>)}
          {!visibleChats.length&&<p>За поточним пошуком доступних чатів немає.</p>}
        </div>
      </div>}
      <div className="telegram-schedule-create">
        <label htmlFor="telegram-slot-count">Слотів</label><Input id="telegram-slot-count" type="number" min={1} max={200} value={slotCount} disabled={busy||disabled} onChange={event=>setSlotCount(Math.max(1,Math.min(200,Number(event.target.value)||1)))}/>
        <Button disabled={busy||disabled} onClick={()=>void generate()}>Створити розклад</Button>
        <Button variant="outline" disabled={busy||disabled} onClick={()=>void saveSettings()}>Зберегти налаштування</Button>
        <Button variant="outline" disabled={busy||disabled||!data.pending} onClick={()=>setClearConfirm(true)}><Trash2 data-icon="inline-start"/>Очистити невиконані</Button>
        <Button variant="outline" disabled={busy||disabled||!data.slots.length} onClick={()=>void copyPlan()}><Copy data-icon="inline-start"/>Скопіювати план</Button>
      </div>
      {data.nextSlot&&<div className="telegram-schedule-next"><span>Наступна дія</span><strong>{formatTime(data.nextSlot.scheduledAt)} · {data.nextSlot.chatName||'Призначити чат'}</strong></div>}
      <div className="telegram-schedule-slots">
        {data.slots.map(slot=>{
          const candidates=data.eligibleChats.filter(chat=>!pendingChatIds.has(chat.id)||chat.id===slot.chatId);
          return <article key={slot.id} className={slot.status==='completed'?'is-done':''}>
            <div><Badge variant={slot.status==='completed'?'secondary':'outline'}>{slot.status==='completed'?'Готово':`#${slot.sequence}`}</Badge></div>
            <input className="telegram-slot-time" aria-label={`Час слота ${slot.sequence}`} defaultValue={formatTime(slot.scheduledAt)} disabled={busy||disabled||slot.status==='completed'} onBlur={event=>{const value=event.target.value;if(value!==formatTime(slot.scheduledAt))void editSlot(slot,value);}}/>
            <select aria-label={`Чат слота ${slot.sequence}`} value={slot.chatId||''} disabled={busy||disabled||slot.status==='completed'} onChange={event=>void editSlot(slot,undefined,event.target.value||null)}>
              <option value="">Без чату</option>
              {slot.chatId&&!candidates.some(chat=>chat.id===slot.chatId)&&<option value={slot.chatId}>{slot.chatName||slot.chatId}</option>}
              {candidates.map(chat=><option key={chat.id} value={chat.id}>{chat.name}</option>)}
            </select>
            <span className="telegram-slot-link">{slot.chatLink||'—'}</span>
            {slot.status==='pending'&&slot.chatId&&<Button variant="ghost" size="icon" aria-label="Відв’язати чат від слота" disabled={busy||disabled} onClick={()=>void editSlot(slot,undefined,null)}><Unlink/></Button>}
          </article>;
        })}
        {!data.slots.length&&<p className="muted-note">Розклад ще не створено.</p>}
      </div>
    </>}
    </div>
  </details></>;
}

function formatNumber(value:number){return Number(value.toFixed(6)).toString();}
function formatTime(epoch:number){return businessDateTime(epoch).slice(11,16);}
function normalizeTimeInput(value:string){
  const digits=value.replace(/\D/g,'').slice(0,4);
  return digits.length>2?`${digits.slice(0,2)}:${digits.slice(2)}`:digits;
}
