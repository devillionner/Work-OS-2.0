'use client';

import { useEffect, useRef, useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { WorkspaceInlineLoading } from '@/components/workspace-load-state';

export type AnalyticsMetricKey = 'publications' | 'responses' | 'bookings' | 'completed';

type MetricEvent = {
  id:string;
  eventType:string;
  platform:string|null;
  eventDate:string;
  occurredAt:number;
  chatName:string|null;
  leadName:string|null;
  lessonSubject:string|null;
};

type Payload = {
  metric:AnalyticsMetricKey;
  label:string;
  definition:string;
  formula:string;
  range:{from:string;to:string};
  total:number;
  events:MetricEvent[];
};

export function AnalyticsMetricDialog({ open, metric, query, onClose }: { open:boolean; metric:AnalyticsMetricKey|null; query:string; onClose:()=>void }) {
  const [data,setData]=useState<Payload|null>(null);
  const [loading,setLoading]=useState(false);
  const [error,setError]=useState('');
  const cache=useRef(new Map<string,Payload>());

  useEffect(() => {
    if (!open || !metric) return;
    const controller=new AbortController();
    const key=`${metric}:${query}`;
    const cached=cache.current.get(key);
    queueMicrotask(()=>{setLoading(true);setError('');setData(cached||null);});
    const params=new URLSearchParams(query);
    params.set('metric',metric);
    fetch('/api/analytics/events?'+params.toString(),{cache:'no-store',signal:controller.signal})
      .then(async response => {
        const body=await response.json() as Payload & {error?:string};
        if(!response.ok) throw new Error(body.error||'Не вдалося завантажити події.');
        cache.current.set(key,body);setData(body);
      })
      .catch(reason => {
        if(!controller.signal.aborted) setError(reason instanceof Error?reason.message:'Не вдалося завантажити події.');
      })
      .finally(()=>{if(!controller.signal.aborted)setLoading(false);});
    return()=>controller.abort();
  },[open,metric,query]);

  return <Dialog open={open} onOpenChange={(next)=>{if(!next&&!loading)onClose();}}>
    <DialogContent className="analytics-metric-dialog" showCloseButton={!loading}>
      <DialogHeader>
        <DialogTitle>{data?.label || 'Деталі показника'}</DialogTitle>
        <DialogDescription>{data ? formatRange(data.range.from,data.range.to) : 'Формула та події вибраного періоду'}</DialogDescription>
      </DialogHeader>
      {error?<p className="workspace-error" role="alert">{error}</p>:null}
      {loading&&!data?<WorkspaceInlineLoading label="Завантажуємо події…"/>:data?<>{loading?<WorkspaceInlineLoading label="Оновлюємо події…"/>:null}
        <section className="analytics-metric-explainer">
          <div><span>Що рахуємо</span><p>{data.definition}</p></div>
          <div><span>Формула</span><p>{data.formula}</p></div>
          <div><span>Період</span><p>{formatRange(data.range.from,data.range.to)}</p></div>
        </section>
        <div className="analytics-metric-event-head"><strong>Події</strong><span>{data.total > data.events.length ? `Показано ${data.events.length} із ${data.total}` : `${data.total} подій`}</span></div>
        {data.events.length?<ol className="analytics-metric-events">{data.events.map(event=><li key={event.id}>
          <div><strong>{eventLabel(event.eventType)}</strong><span>{event.platform || 'Без платформи'} · {formatDate(event.eventDate)}</span></div>
          <p>{[event.chatName,event.leadName,event.lessonSubject].filter(Boolean).join(' · ') || 'Без додаткових деталей'}</p>
        </li>)}</ol>:<p className="muted-note">У вибраному періоді немає подій для цього показника.</p>}
      </>:null}
      <div className="dialog-actions"><Button variant="outline" onClick={onClose} disabled={loading}>Закрити</Button></div>
    </DialogContent>
  </Dialog>;
}

function eventLabel(type:string){
  return type==='publication'?'Публікація':type==='lead_created'?'Відгук':type==='lesson_booked'?'Запис':type==='curator_booking_pending'?'Запит куратору':type==='lesson_completed'?'Проведений урок':type;
}
function formatRange(from:string,to:string){return from===to?formatDate(from):`${formatDate(from)} — ${formatDate(to)}`;}
function formatDate(value:string){const [year,month,day]=value.split('-');return `${day}.${month}.${year}`;}
