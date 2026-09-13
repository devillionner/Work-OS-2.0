'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { LoaderCircle, Plus, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';

type Chat = { id:string; name:string; link:string; platform:string; status:string; telegramAccountId:string|null };
type Account = { id:string; number:number; name:string; enabled:boolean };
type Advertisement = { id:string; title:string };
type Options = { chats:Chat[]; accounts:Account[]; advertisements:Advertisement[]; error?:string };

const PLATFORM_LABELS:Record<string,string>={telegram:'Telegram',whatsapp:'WhatsApp',viber:'Viber',facebook:'Facebook'};

export function ReportPublicationCorrection({date}:{date:string}) {
  const [open,setOpen]=useState(false);
  const [loading,setLoading]=useState(false);
  const [saving,setSaving]=useState(false);
  const [error,setError]=useState('');
  const [notice,setNotice]=useState('');
  const [search,setSearch]=useState('');
  const [platform,setPlatform]=useState('');
  const [options,setOptions]=useState<Options>({chats:[],accounts:[],advertisements:[]});
  const [chatId,setChatId]=useState('');
  const [accountId,setAccountId]=useState('');
  const [advertisementId,setAdvertisementId]=useState('');
  const [language,setLanguage]=useState('');

  const selectedChat=useMemo(()=>options.chats.find(chat=>chat.id===chatId)||null,[chatId,options.chats]);

  const load=useCallback(async (signal?:AbortSignal)=>{
    setLoading(true); setError('');
    try{
      const params=new URLSearchParams({date});
      if(search.trim())params.set('search',search.trim());
      if(platform)params.set('platform',platform);
      const response=await fetch(`/api/reports/publication-correction?${params}`,{cache:'no-store',signal});
      const body=await response.json() as Options;
      if(!response.ok)throw new Error(body.error||'Не вдалося завантажити чати для корекції.');
      if(signal?.aborted)return;
      setOptions(body);
      setChatId(current=>body.chats.some(chat=>chat.id===current)?current:'');
    }catch(reason){if(!signal?.aborted)setError(reason instanceof Error?reason.message:'Не вдалося завантажити чати для корекції.');}
    finally{if(!signal?.aborted)setLoading(false);}
  },[date,platform,search]);

  useEffect(()=>{
    if(!open)return;
    const controller=new AbortController();
    void load(controller.signal);
    return()=>controller.abort();
  },[open,load]);

  function selectChat(chat:Chat){
    setChatId(chat.id);
    setError('');
    if(chat.platform==='telegram'){
      const fallback=options.accounts.find(account=>account.enabled)?.id||options.accounts[0]?.id||'';
      setAccountId(chat.telegramAccountId||fallback);
    }else setAccountId('');
  }

  async function save(){
    if(!selectedChat||saving)return;
    if(selectedChat.platform==='telegram'&&!accountId){setError('Оберіть Telegram-акаунт.');return;}
    setSaving(true); setError('');
    try{
      const response=await fetch('/api/reports/publication-correction',{
        method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({date,chatId:selectedChat.id,telegramAccountId:accountId||null,advertisementId:advertisementId||null,language:language||null}),
      });
      const body=await response.json() as {error?:string};
      if(!response.ok)throw new Error(body.error||'Не вдалося додати історичну публікацію.');
      setNotice(`Публікацію за ${formatDate(date)} додано. Оновіть звіт, щоб побачити новий підсумок.`);
      setOpen(false); setChatId(''); setAdvertisementId(''); setLanguage('');
    }catch(reason){setError(reason instanceof Error?reason.message:'Не вдалося додати історичну публікацію.');}
    finally{setSaving(false);}
  }

  return <section className="report-corrections" aria-label="Коригування історичного звіту">
    <div className="report-checkpoints-head"><div><p className="eyebrow">Історична дата</p><h4>Коригування подій</h4></div><Button type="button" size="sm" variant="outline" onClick={()=>{setNotice('');setOpen(true);}}><Plus data-icon="inline-start"/>Додати публікацію</Button></div>
    <p className="muted-note">Корекція записує факт на обрану дату й не змінює сьогоднішній Telegram-розклад або частоту публікацій.</p>
    {notice&&<output className="reports-notice">{notice}</output>}
    <Dialog open={open} onOpenChange={next=>{if(!saving)setOpen(next);}}><DialogContent><DialogHeader><DialogTitle>Історична публікація</DialogTitle><DialogDescription>Дата обліку: {formatDate(date)}. Оберіть чат, у якому публікація реально була цього дня.</DialogDescription></DialogHeader>
      {error&&<div className="workspace-error" role="alert">{error}</div>}
      <form onSubmit={event=>{event.preventDefault();void load();}} className="reports-editor-actions"><Input value={search} onChange={event=>setSearch(event.target.value)} placeholder="Назва або посилання чату" aria-label="Пошук чату"/><select value={platform} onChange={event=>setPlatform(event.target.value)} aria-label="Платформа"><option value="">Усі платформи</option>{Object.entries(PLATFORM_LABELS).map(([value,label])=><option value={value} key={value}>{label}</option>)}</select><Button type="submit" size="sm" variant="outline" disabled={loading}><Search data-icon="inline-start"/>Знайти</Button></form>
      {loading?<p className="workspace-loading"><LoaderCircle/>Завантажуємо чати…</p>:options.chats.length?<div className="chat-publish-items" aria-label="Чати для корекції">{options.chats.map(chat=><button type="button" key={chat.id} aria-pressed={chat.id===chatId} className={chat.id===chatId?'is-selected':''} onClick={()=>selectChat(chat)}><strong>{chat.name}</strong><small>{PLATFORM_LABELS[chat.platform]||chat.platform} · {chat.status} · {chat.link}</small></button>)}</div>:<p className="muted-note">Чатів без уже зафіксованої публікації на цю дату не знайдено.</p>}
      {selectedChat&&<div className="report-correction-fields">{selectedChat.platform==='telegram'&&<label>Telegram-акаунт<select value={accountId} onChange={event=>setAccountId(event.target.value)}><option value="">Оберіть акаунт</option>{options.accounts.map(account=><option value={account.id} key={account.id}>#{account.number} {account.name}{account.enabled?'':' · вимкнений'}</option>)}</select></label>}<label>Оголошення<select value={advertisementId} onChange={event=>setAdvertisementId(event.target.value)}><option value="">Без прив’язаного матеріалу</option>{options.advertisements.map(item=><option value={item.id} key={item.id}>{item.title}</option>)}</select></label><label>Мова<select value={language} onChange={event=>setLanguage(event.target.value)}><option value="">Не вказувати</option><option value="uk">Українська</option><option value="ru">Російська</option></select></label></div>}
      <div className="dialog-actions"><Button type="button" variant="outline" disabled={saving} onClick={()=>setOpen(false)}>Скасувати</Button><Button type="button" disabled={!selectedChat||saving} onClick={()=>void save()}>{saving?'Зберігаємо…':'Додати до звіту'}</Button></div>
    </DialogContent></Dialog>
  </section>;
}

function formatDate(date:string){return new Intl.DateTimeFormat('uk-UA',{timeZone:'Europe/Kyiv',day:'2-digit',month:'2-digit',year:'numeric'}).format(new Date(`${date}T12:00:00Z`));}
