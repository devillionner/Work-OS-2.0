'use client';

import { useEffect, useRef, useState } from 'react';
import { ExternalLink, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { createActionGate } from '@/lib/action-gate';
import { PROFILE_CADENCES, type ChatProfile, type ProfileCadence } from '@/lib/chats/profile';

type ProfileChat = { id:string; name:string; link:string; platform:string; stateToken:string; profile:ChatProfile };
type ChatProfileDialogProps = {open:boolean;chat:ProfileChat|null;onClose:()=>void;onSaved:(chatId:string,profile:ChatProfile)=>void;onOpenChat:()=>void;finalFocus?:()=>HTMLElement|null};
const cadenceNames:Record<string,string>={any:'Без обмежень',daily:'Раз на день',several_week:'Кілька разів на тиждень',weekly:'Раз на тиждень',monthly:'Раз на місяць',custom:'Власний інтервал'};
const weekdays=['Пн','Вт','Ср','Чт','Пт','Сб','Нд'];

export function ChatProfileDialog({open,chat,onClose,onSaved,onOpenChat,finalFocus}:ChatProfileDialogProps) {
  const [name,setName]=useState(chat?.name||''); const [language,setLanguage]=useState<'uk'|'ru'|''>(chat?.profile.language||''); const [cadence,setCadence]=useState<ProfileCadence>(chat?.profile.cadence||'any');
  const [weekdaysSelected,setWeekdaysSelected]=useState<number[]>(chat?.profile.weekdays||[]); const [customIntervalDays,setCustomIntervalDays]=useState(chat?.profile.customIntervalDays?String(chat.profile.customIntervalDays):''); const [nextAllowedOn,setNextAllowedOn]=useState(chat?.profile.nextAllowedOn||''); const [directions,setDirections]=useState(chat?.profile.directions.join('\n')||''); const [note,setNote]=useState(chat?.profile.note||''); const [reviewStatus,setReviewStatus]=useState<'draft'|'confirmed'>(chat?.profile.reviewStatus||'draft');
  const [busy,setBusy]=useState(false); const [error,setError]=useState(''); const gate=useRef(createActionGate());
  useEffect(()=>{
    if(!open||!chat)return;
    setName(chat.name);
    setLanguage(chat.profile.language||'');
    setCadence(chat.profile.cadence||'any');
    setWeekdaysSelected(chat.profile.weekdays||[]);
    setCustomIntervalDays(chat.profile.customIntervalDays?String(chat.profile.customIntervalDays):'');
    setNextAllowedOn(chat.profile.nextAllowedOn||'');
    setDirections(chat.profile.directions.join('\n'));
    setNote(chat.profile.note||'');
    setReviewStatus(chat.profile.reviewStatus||'draft');
    setError('');
  },[open,chat?.id,chat?.stateToken]);
  async function save() {
    if(!chat)return;
    await gate.current(async()=>{setBusy(true);setError('');const controller=new AbortController();const timeout=setTimeout(()=>controller.abort(),30_000);
      try {
        const response=await fetch('/api/chats',{method:'POST',headers:{'Content-Type':'application/json'},signal:controller.signal,body:JSON.stringify({id:chat.id,action:'profile',stateToken:chat.stateToken,profile:{name,language:language||null,cadence,weekdays:weekdaysSelected,customIntervalDays:cadence==='custom'?Number(customIntervalDays):null,nextAllowedOn:nextAllowedOn||null,directions:directions.split(/\r?\n|,/).map(value=>value.trim()).filter(Boolean),note,reviewStatus}})});
        const value:unknown=await response.json();
        if(!response.ok||!value||typeof value!=='object'||!('profile' in value)) throw new Error(value&&typeof value==='object'&&'error' in value&&typeof value.error==='string'?value.error:'Не вдалося зберегти профіль. Оновіть список і спробуйте ще раз.');
        onSaved(chat.id,(value as {profile:ChatProfile}).profile);onClose();
      } catch(reason) { setError(reason instanceof Error&&reason.name!=='AbortError'&&reason.name!=='TypeError'?reason.message:'Не вдалося зберегти профіль. Перевірте з’єднання та спробуйте ще раз.'); }
      finally {clearTimeout(timeout);setBusy(false);}
    });
  }
  return <Dialog open={open} onOpenChange={next=>{if(!next&&!busy)onClose();}}>
    <DialogContent className="chat-profile-dialog" showCloseButton={false} finalFocus={finalFocus}>
      <DialogHeader><DialogTitle>Профіль чату</DialogTitle><DialogDescription>Налаштуйте правила для ручної роботи та майбутнього підбору оголошень.</DialogDescription></DialogHeader>
      <Button className="chat-profile-close" variant="ghost" size="icon" aria-label="Закрити" disabled={busy} onClick={onClose}><X/></Button>
      {error&&<div className="workspace-error" role="alert">{error}</div>}
      {chat&&<>
        <div className="chat-profile-chat"><strong>{chat.name}</strong><span>{chat.link}</span><Button type="button" variant="outline" size="sm" disabled={busy} onClick={onOpenChat}><ExternalLink data-icon="inline-start"/>Відкрити чат</Button></div>
        <label htmlFor="chat-profile-name">Назва чату<Input id="chat-profile-name" value={name} maxLength={180} disabled={busy} onChange={event=>setName(event.target.value)}/></label>
        <div className="chat-profile-grid">
          <label htmlFor="chat-profile-language">Мова публікації<select id="chat-profile-language" value={language} disabled={busy} onChange={event=>setLanguage(event.target.value as 'uk'|'ru'|'')}><option value="">Не визначено</option><option value="uk">Українська</option><option value="ru">Російська</option></select></label>
          <label htmlFor="chat-profile-cadence">Частота<select id="chat-profile-cadence" value={cadence} disabled={busy} onChange={event=>setCadence(event.target.value as ProfileCadence)}>{PROFILE_CADENCES.map(value=><option key={value} value={value}>{cadenceNames[value]}</option>)}</select></label>
          {cadence==='custom'&&<label htmlFor="chat-profile-custom-interval">Інтервал, днів<Input id="chat-profile-custom-interval" type="number" min={1} max={3650} value={customIntervalDays} disabled={busy} onChange={event=>setCustomIntervalDays(event.target.value)}/></label>}
          <label htmlFor="chat-profile-next-allowed">Наступна дозволена дата<Input id="chat-profile-next-allowed" type="date" value={nextAllowedOn} disabled={busy} onChange={event=>setNextAllowedOn(event.target.value)}/></label>
        </div>
        <fieldset disabled={busy}><legend>Дозволені дні</legend><div className="chat-profile-days">{weekdays.map((day,index)=><label key={day}><input type="checkbox" checked={weekdaysSelected.includes(index+1)} onChange={event=>setWeekdaysSelected(current=>event.target.checked?[...current,index+1]:current.filter(value=>value!==index+1))}/>{day}</label>)}</div></fieldset>
        <label htmlFor="chat-profile-directions">Напрямки <span className="muted-note">по одному в рядку</span><Textarea id="chat-profile-directions" rows={3} maxLength={1000} value={directions} disabled={busy} onChange={event=>setDirections(event.target.value)} placeholder="Математика\nАнглійська"/></label>
        <label htmlFor="chat-profile-note">Нотатка про правила<Textarea id="chat-profile-note" rows={4} maxLength={1000} value={note} disabled={busy} onChange={event=>setNote(event.target.value)} placeholder="Коли краще публікувати, що врахувати…"/></label>
        <label className="chat-profile-confirm"><input type="checkbox" checked={reviewStatus==='confirmed'} disabled={busy} onChange={event=>setReviewStatus(event.target.checked?'confirmed':'draft')}/>Правила перевірені</label>
        <div className="dialog-actions"><Button type="button" variant="outline" disabled={busy} onClick={onClose}>Скасувати</Button><Button type="button" disabled={busy||!name.trim()} onClick={()=>void save()}>{busy?'Зберігаємо…':'Зберегти профіль'}</Button></div>
      </>}
    </DialogContent>
  </Dialog>;
}
