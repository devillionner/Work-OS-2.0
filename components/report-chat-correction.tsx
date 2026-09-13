'use client';

import { useEffect, useState } from 'react';
import { Link2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';

type Account={id:string;number:number;name:string;enabled:boolean};
type AccountPayload={accounts:Account[];error?:string};

export function ReportChatCorrection({date}:{date:string}){
  const [open,setOpen]=useState(false);
  const [accounts,setAccounts]=useState<Account[]>([]);
  const [name,setName]=useState('');
  const [link,setLink]=useState('');
  const [accountId,setAccountId]=useState('');
  const [requestId,setRequestId]=useState('');
  const [loading,setLoading]=useState(false);
  const [saving,setSaving]=useState(false);
  const [error,setError]=useState('');
  const [notice,setNotice]=useState('');
  const telegram=/(?:^|\/\/)(?:www\.)?(?:t\.me|telegram\.me|telegram\.dog)(?:\/|$)/i.test(link.trim());

  useEffect(()=>{
    if(!open)return;
    const controller=new AbortController();
    setLoading(true);setError('');
    fetch('/api/reports/chat-correction',{cache:'no-store',signal:controller.signal}).then(async response=>{
      const body=await response.json() as AccountPayload;
      if(!response.ok)throw new Error(body.error||'Не вдалося завантажити Telegram-акаунти.');
      if(!controller.signal.aborted)setAccounts(body.accounts);
    }).catch(reason=>{if(!controller.signal.aborted)setError(reason instanceof Error?reason.message:'Не вдалося завантажити Telegram-акаунти.');}).finally(()=>{if(!controller.signal.aborted)setLoading(false);});
    return()=>controller.abort();
  },[open]);

  function start(){
    setName('');setLink('');setAccountId('');setError('');setNotice('');setRequestId(crypto.randomUUID());setOpen(true);
  }

  async function save(){
    if(!link.trim()||saving)return;
    if(telegram&&!accountId){setError('Оберіть Telegram-акаунт.');return;}
    setSaving(true);setError('');
    try{
      const response=await fetch('/api/reports/chat-correction',{
        method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({requestId,date,name,link,telegramAccountId:telegram?accountId:null}),
      });
      const body=await response.json() as {error?:string;name?:string;platform?:string};
      if(!response.ok)throw new Error(body.error||'Не вдалося додати історичний чат.');
      setNotice(`${body.name||'Чат'} додано до звіту за ${formatDate(date)}. Точний час приєднання лишився невідомим; поточні Telegram-ліміти не змінено.`);
      setOpen(false);
    }catch(reason){setError(reason instanceof Error?reason.message:'Не вдалося додати історичний чат.');}
    finally{setSaving(false);}
  }

  return <section className="report-corrections" aria-label="Історичний чат">
    <div className="report-checkpoints-head"><div><p className="eyebrow">Новий чат</p><h4>Додати за вибрану дату</h4></div><Button type="button" size="sm" variant="outline" onClick={start}><Link2 data-icon="inline-start"/>Додати чат</Button></div>
    <p className="muted-note">Work OS збереже дату приєднання для звіту, але не вигадуватиме точний історичний час і не змінюватиме поточний Telegram join-streak/break.</p>
    {notice&&<output className="reports-notice">{notice}</output>}
    <Dialog open={open} onOpenChange={next=>{if(!saving)setOpen(next);}}><DialogContent><DialogHeader><DialogTitle>Історичний чат</DialogTitle><DialogDescription>Дата обліку: {formatDate(date)}. Додавайте чат лише якщо він реально був приєднаний у цей день.</DialogDescription></DialogHeader>
      {error&&<div className="workspace-error" role="alert">{error}</div>}
      <div className="report-correction-fields"><label>Посилання<Input value={link} onChange={event=>{setLink(event.target.value);setError('');}} maxLength={2048} placeholder="https://t.me/..." autoComplete="off"/></label><label>Назва<Input value={name} onChange={event=>setName(event.target.value)} maxLength={1000} placeholder="Необов’язково — можна визначити з посилання"/></label>{telegram&&<label>Telegram-акаунт<select value={accountId} disabled={loading} onChange={event=>setAccountId(event.target.value)}><option value="">Оберіть акаунт</option>{accounts.map(account=><option key={account.id} value={account.id}>#{account.number} {account.name}{account.enabled?'':' · вимкнений'}</option>)}</select></label>}</div>
      <p className="muted-note">Новий запис створюється у стані ready з невідомим `joined_at`; історична дата зберігається в події `chat_joined`.</p>
      <div className="dialog-actions"><Button type="button" variant="outline" disabled={saving} onClick={()=>setOpen(false)}>Скасувати</Button><Button type="button" disabled={!link.trim()||saving||(telegram&&!accountId)} onClick={()=>void save()}>{saving?'Зберігаємо…':'Додати чат'}</Button></div>
    </DialogContent></Dialog>
  </section>;
}

function formatDate(date:string){return new Intl.DateTimeFormat('uk-UA',{timeZone:'Europe/Kyiv',day:'2-digit',month:'2-digit',year:'numeric'}).format(new Date(`${date}T12:00:00Z`));}
