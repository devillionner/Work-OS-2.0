'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import type { ChatHistoryItem } from '@/lib/chats/history';
import type { ChatAnalyticsEvent, ChatAnalyticsPeriod, ChatAnalyticsSnapshot } from '@/lib/chats/analytics';

type HistoryChat = { id:string; name:string; link:string };
const eventNames:Record<string,string>={
  chat_state_changed:'Зміна стану',chat_joined:'Приєднання',publication:'Публікація',
  chat_profile_changed:'Профіль оновлено',lead_created:'Відгук',lesson_booked:'Запис',
  curator_booking_pending:'Запит на запис',lesson_completed:'Проведений урок',
};
const actionNames:Record<string,string>={
  joined:'Приєднано',waiting:'Очікування запрошення',approved:'Запрошення підтверджено',
  failed:'Невдале приєднання',archive:'Перенесено в архів',restore:'Відновлено',
  return_to_join:'Повернуто для приєднання',assign_account:'Перепризначено акаунт',
  confirm_leave:'Вихід із чату підтверджено',undo_leave:'Підтвердження виходу скасовано',rename:'Чат перейменовано',
};

export function ChatHistoryDialog({open,chat,onClose,finalFocus}:{
  open:boolean;chat:HistoryChat|null;onClose:()=>void;finalFocus?:()=>HTMLElement|null;
}) {
  const [events,setEvents]=useState<ChatHistoryItem[]>([]);
  const [analytics,setAnalytics]=useState<ChatAnalyticsSnapshot|null>(null);
  const [period,setPeriod]=useState<ChatAnalyticsPeriod>('30');
  const [metric,setMetric]=useState<string>('all');
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');

  useEffect(()=>{
    if(!open||!chat)return;
    let cancelled=false;
    queueMicrotask(()=>{
      if(!cancelled){setEvents([]);setAnalytics(null);setBusy(true);setError('');}
    });
    fetch(`/api/chats/history?id=${encodeURIComponent(chat.id)}&period=${period}`,{cache:'no-store'})
      .then(async response=>{
        const value:unknown=await response.json();
        if(!response.ok)throw new Error(readError(value));
        if(!cancelled&&value&&typeof value==='object'){
          setEvents(Array.isArray((value as {events?:unknown}).events)?(value as {events:ChatHistoryItem[]}).events:[]);
          setAnalytics((value as {analytics?:ChatAnalyticsSnapshot}).analytics||null);
        }
      })
      .catch(reason=>{if(!cancelled)setError(reason instanceof Error?reason.message:'Не вдалося завантажити історію.');})
      .finally(()=>{if(!cancelled)setBusy(false);});
    return()=>{cancelled=true;};
  },[open,chat,period]);
  const resultEvents=filterAnalyticsEvents(analytics?.events||[],metric);
  return <Dialog open={open} onOpenChange={next=>{if(!next&&!busy)onClose();}}>
    <DialogContent className="chat-history-dialog" showCloseButton={false} finalFocus={finalFocus}>
      <DialogHeader><DialogTitle>Історія чату</DialogTitle><DialogDescription>{chat?.name} · {chat?.link}</DialogDescription></DialogHeader>
      <Button className="chat-history-close" variant="ghost" size="icon" aria-label="Закрити" disabled={busy} onClick={onClose}>×</Button>
      {error&&<div className="workspace-error" role="alert">{error}</div>}
      <section className="chat-result-panel" aria-label="Результат чату">
        <div className="chat-result-head"><div><strong>Результат чату</strong><small>{formatRange(analytics)}</small></div>
          <fieldset className="chat-result-periods" aria-label="Період результату">
            {([['7','7 днів'],['30','30 днів'],['all','Весь час']] as const).map(([value,label])=>
              <Button key={value} type="button" size="sm" variant={period===value?'secondary':'outline'} aria-pressed={period===value} disabled={busy} onClick={()=>{setMetric('all');setPeriod(value);}}>{label}</Button>)}
          </fieldset>
        </div>
        {analytics?<ChatResultMetrics analytics={analytics} metric={metric} setMetric={setMetric}/>:null}
        {metric!=='all'&&<AnalyticsEvents events={resultEvents}/>}
      </section>
      {busy?<p className="workspace-loading">Завантажуємо історію…</p>:events.length?<HistoryList events={events}/>:<p className="muted-note">Історія ще порожня.</p>}
      <div className="dialog-actions"><Button variant="outline" onClick={onClose}>Закрити</Button></div>
    </DialogContent>
  </Dialog>;
}
function ChatResultMetrics({analytics,metric,setMetric}:{
  analytics:ChatAnalyticsSnapshot;metric:string;setMetric:(value:string)=>void;
}) {
  const s=analytics.summary;
  const rows=[
    ['publication','Оголошення',s.publications],
    ['response','Відгуки',s.responses],
    ['booking','Записи',s.bookings],
    ['completed','Проведені',s.completed],
  ] as const;
  return <><div className="chat-result-metrics">{rows.map(([key,label,value])=>
    <button type="button" key={key} aria-pressed={metric===key} onClick={()=>setMetric(metric===key?'all':key)}>
      <span>{label}</span><strong>{value}</strong>
    </button>)}</div>
    <div className="chat-result-rates">
      <span>Відгук / публікація <strong>{s.responseRate}%</strong></span>
      <span>Запис / відгук <strong>{s.bookingRate}%</strong></span>
      <span>Проведено / запис <strong>{s.completionRate}%</strong></span>
    </div></>;
}

function AnalyticsEvents({events}:{events:ChatAnalyticsEvent[]}) {
  return events.length?<ol className="chat-result-events">{events.map(event=><li key={event.id}>
    <div><strong>{eventNames[event.eventType]||event.eventType}</strong>{event.leadName&&<small> · {event.leadName}</small>}</div>
    <time dateTime={new Date(event.occurredAt*1000).toISOString()}>{formatTime(event.occurredAt)}</time>
  </li>)}</ol>:<p className="muted-note">За цей період пов’язаних подій немає.</p>;
}
function HistoryList({events}:{events:ChatHistoryItem[]}) {
  return <ol className="chat-history-list">{events.map(event=><li key={event.id}>
    <div><strong>{eventNames[event.eventType]||event.eventType}</strong>
      {event.eventType==='chat_state_changed'&&typeof event.metadata.action==='string'&&<span> · {actionNames[event.metadata.action]||event.metadata.action}</span>}
      {event.eventType==='publication'&&event.advertisementTitle&&<small className="chat-history-material"> · {event.advertisementTitle}</small>}
      {event.eventType==='publication'&&(event.metadata.language==='uk'||event.metadata.language==='ru')&&<small className="chat-history-material"> · {event.metadata.language==='uk'?'UA':'RU'}</small>}
    </div><time dateTime={new Date(event.occurredAt*1000).toISOString()}>{formatTime(event.occurredAt)}</time>
  </li>)}</ol>;
}

function filterAnalyticsEvents(events:ChatAnalyticsEvent[],metric:string) {
  if(metric==='publication')return events.filter(event=>event.eventType==='publication');
  if(metric==='response')return events.filter(event=>event.eventType==='lead_created');
  if(metric==='booking')return events.filter(event=>event.eventType==='lesson_booked'||event.eventType==='curator_booking_pending');
  if(metric==='completed')return events.filter(event=>event.eventType==='lesson_completed');
  return events;
}
function readError(value:unknown){return value&&typeof value==='object'&&'error' in value&&typeof value.error==='string'?value.error:'Не вдалося завантажити історію.';}
function formatTime(value:number){return new Intl.DateTimeFormat('uk-UA',{dateStyle:'medium',timeStyle:'short',timeZone:'Europe/Kyiv'}).format(new Date(value*1000));}
function formatRange(value:ChatAnalyticsSnapshot|null){if(!value)return 'Оберіть період';return value.from?value.from+' — '+value.to:'До '+value.to;}
