'use client';

import { useCallback, useEffect, useState } from 'react';
import { CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { WorkspaceInlineLoading } from '@/components/workspace-load-state';

type Lesson={lessonId:string;leadId:string;leadName:string;studentName:string;subject:string;lessonTime:string;status:string};
type Payload={date:string;lessons:Lesson[];error?:string};
type ResultStatus='completed'|'cancelled'|'no-show';

export function ReportLessonResultCorrection({date}:{date:string}){
  const [open,setOpen]=useState(false);
  const [loading,setLoading]=useState(false);
  const [loaded,setLoaded]=useState(false);
  const [saving,setSaving]=useState(false);
  const [lessons,setLessons]=useState<Lesson[]>([]);
  const [lessonId,setLessonId]=useState('');
  const [status,setStatus]=useState<ResultStatus>('completed');
  const [reason,setReason]=useState('');
  const [requestId,setRequestId]=useState('');
  const [error,setError]=useState('');
  const [notice,setNotice]=useState('');

  const load=useCallback(async(signal?:AbortSignal)=>{
    setLoading(true);setError('');
    try{
      const response=await fetch(`/api/reports/lesson-result-correction?date=${encodeURIComponent(date)}`,{cache:'no-store',signal});
      const body=await response.json() as Payload;
      if(!response.ok)throw new Error(body.error||'Не вдалося завантажити уроки.');
      if(signal?.aborted)return;
      setLessons(body.lessons);setLoaded(true);
      setLessonId(current=>body.lessons.some(lesson=>lesson.lessonId===current)?current:'');
    }catch(reasonValue){if(!signal?.aborted)setError(reasonValue instanceof Error?reasonValue.message:'Не вдалося завантажити уроки.');}
    finally{if(!signal?.aborted)setLoading(false);}
  },[date]);

  useEffect(()=>{setLoaded(false);setLessons([]);setLessonId('');},[date]);
  useEffect(()=>{
    if(!open)return;
    const controller=new AbortController();
    void load(controller.signal);
    return()=>controller.abort();
  },[load,open]);

  function start(){
    setNotice('');setError('');setLessonId('');setStatus('completed');setReason('');setRequestId(crypto.randomUUID());setOpen(true);
  }

  async function save(){
    if(!lessonId||saving)return;
    if(status!=='completed'&&!reason.trim()){setError('Для скасування або неявки вкажіть причину.');return;}
    setSaving(true);setError('');
    try{
      const response=await fetch('/api/reports/lesson-result-correction',{
        method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({requestId,date,lessonId,status,reason}),
      });
      const body=await response.json() as {error?:string};
      if(!response.ok)throw new Error(body.error||'Не вдалося зберегти результат уроку.');
      setNotice(`Результат уроку за ${formatDate(date)} збережено. Оновіть звіт, щоб побачити новий підсумок.`);
      setOpen(false);
    }catch(reasonValue){setError(reasonValue instanceof Error?reasonValue.message:'Не вдалося зберегти результат уроку.');}
    finally{setSaving(false);}
  }

  return <section className="report-corrections" aria-label="Історичний результат уроку">
    <div className="report-checkpoints-head"><div><p className="eyebrow">Результат уроку</p><h4>Зафіксувати за вибрану дату</h4></div><Button type="button" size="sm" variant="outline" onClick={start}><CheckCircle2 data-icon="inline-start"/>Додати результат</Button></div>
    <p className="muted-note">Доступні лише незавершені уроки, заплановані на {formatDate(date)}. Фактичний час внесення зберігається окремо від дати обліку.</p>
    {notice&&<output className="reports-notice">{notice}</output>}
    <Dialog open={open} onOpenChange={next=>{if(!saving)setOpen(next);}}><DialogContent className="report-correction-dialog"><DialogHeader><DialogTitle>Результат уроку</DialogTitle><DialogDescription>Дата обліку: {formatDate(date)}. Зміна зберігається в історії ліда та захищена від перезапису застарілими даними.</DialogDescription></DialogHeader>
      {error&&<div className="workspace-error" role="alert">{error}</div>}
      {loading&&!loaded?<WorkspaceInlineLoading label="Завантажуємо уроки…"/>:lessons.length?<div className="chat-publish-items" aria-label="Уроки">{lessons.map(lesson=><button type="button" key={lesson.lessonId} aria-pressed={lesson.lessonId===lessonId} className={lesson.lessonId===lessonId?'is-selected':''} onClick={()=>{setLessonId(lesson.lessonId);setError('');}}><strong>{lesson.studentName||lesson.leadName} · {lesson.subject}</strong><small>{lesson.lessonTime||'час не вказано'} · лід: {lesson.leadName}</small></button>)}</div>:<p className="muted-note">Незавершених уроків на цю дату немає.</p>}
      {lessonId&&<div className="report-correction-fields"><label>Результат<select value={status} onChange={event=>setStatus(event.target.value as ResultStatus)}><option value="completed">Проведено</option><option value="cancelled">Скасовано</option><option value="no-show">Не з’явився</option></select></label><label>Причина<Input value={reason} onChange={event=>setReason(event.target.value)} maxLength={2000} placeholder={status==='completed'?'Необов’язково':'Обов’язково'}/></label></div>}
      <div className="dialog-actions"><Button type="button" variant="outline" disabled={saving} onClick={()=>setOpen(false)}>Скасувати</Button><Button type="button" disabled={!lessonId||saving||(status!=='completed'&&!reason.trim())} onClick={()=>void save()}>{saving?'Зберігаємо…':'Зберегти результат'}</Button></div>
    </DialogContent></Dialog>
  </section>;
}

function formatDate(date:string){return new Intl.DateTimeFormat('uk-UA',{timeZone:'Europe/Kyiv',day:'2-digit',month:'2-digit',year:'numeric'}).format(new Date(`${date}T12:00:00Z`));}
