'use client';

import { useCallback, useEffect, useState } from 'react';
import { ExternalLink, LoaderCircle } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

type Platform='telegram'|'whatsapp'|'viber'|'facebook';
type Account={id:string;number:number;name:string;enabled:boolean;selected:boolean};
type Chat={id:string;name:string;link:string;normalizedLink:string;platform:string;status:string;archiveReason:string|null;archivedAt:number|null;telegramAccountId:string|null;stateToken:string};
type Group={key:string;match:'link'|'name';chats:Chat[]};

export function ChatDuplicatesDialog({open,onClose}:{open:boolean;onClose:()=>void}){
  const [platform,setPlatform]=useState<Platform>('telegram');
  const [accounts,setAccounts]=useState<Account[]>([]);
  const [accountId,setAccountId]=useState<string>('');
  const [groups,setGroups]=useState<Group[]>([]);
  const [names,setNames]=useState<Record<string,string>>({});
  const [loading,setLoading]=useState(false);
  const [busy,setBusy]=useState<string|null>(null);
  const [error,setError]=useState('');
  const [notice,setNotice]=useState('');

  const loadAccounts=useCallback(async()=>{
    const response=await fetch('/api/telegram-accounts',{cache:'no-store'});
    const body=await response.json() as {accounts?:Account[];error?:string};
    if(!response.ok)throw new Error(body.error||'Не вдалося завантажити Telegram-акаунти.');
    const next=(body.accounts||[]).filter(account=>account.enabled);
    setAccounts(next);
    setAccountId(current=>next.some(account=>account.id===current)?current:(next.find(account=>account.selected)||next[0])?.id||'');
  },[]);

  const load=useCallback(async()=>{
    if(!open)return;
    if(platform==='telegram'&&!accountId){setGroups([]);return;}
    setLoading(true);setError('');
    try{
      const params=new URLSearchParams({platform});
      if(platform==='telegram')params.set('account',accountId);
      const response=await fetch(`/api/chats/duplicates?${params}`,{cache:'no-store'});
      const body=await response.json() as {groups?:Group[];error?:string};
      if(!response.ok)throw new Error(body.error||'Не вдалося завантажити дублікати.');
      const next=body.groups||[];setGroups(next);
      setNames(Object.fromEntries(next.flatMap(group=>group.chats.map(chat=>[chat.id,chat.name]))));
    }catch(reason){setError(reason instanceof Error?reason.message:'Не вдалося завантажити дублікати.');}
    finally{setLoading(false);}
  },[open,platform,accountId]);

  useEffect(()=>{if(!open)return;const timer=setTimeout(()=>void loadAccounts().catch(reason=>setError(reason instanceof Error?reason.message:'Не вдалося завантажити акаунти.')),0);return()=>clearTimeout(timer);},[open,loadAccounts]);
  useEffect(()=>{if(!open)return;const timer=setTimeout(()=>void load(),0);return()=>clearTimeout(timer);},[open,load]);

  async function rename(chat:Chat){
    const name=(names[chat.id]||'').trim();if(!name||name===chat.name)return;
    setBusy(chat.id);setError('');setNotice('');
    try{
      const response=await fetch('/api/chats/duplicates',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'rename',id:chat.id,stateToken:chat.stateToken,name})});
      const body=await response.json() as {error?:string};
      if(!response.ok)throw new Error(body.error||'Не вдалося перейменувати чат.');
      setNotice('Назву збережено.');await load();
    }catch(reason){setError(reason instanceof Error?reason.message:'Не вдалося перейменувати чат.');}
    finally{setBusy(null);}
  }

  async function archive(chat:Chat){
    if(chat.status==='archived'||!window.confirm(`Перенести «${chat.name}» в архів як дублікат?`))return;
    setBusy(chat.id);setError('');setNotice('');
    try{
      const response=await fetch('/api/chats',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:chat.id,action:'archive',reason:'Дублікат',stateToken:chat.stateToken,accountId:platform==='telegram'?accountId:null})});
      const body=await response.json() as {error?:string};
      if(!response.ok)throw new Error(body.error||'Не вдалося архівувати чат.');
      setNotice('Чат перенесено в архів з причиною «Дублікат».');await load();
    }catch(reason){setError(reason instanceof Error?reason.message:'Не вдалося архівувати чат.');}
    finally{setBusy(null);}
  }

  if(!open)return null;
  return <div className="modal-backdrop" role="presentation" onMouseDown={(event)=>{if(event.target===event.currentTarget&&!busy)onClose();}}>
    <dialog open className="modal-card" aria-labelledby="duplicates-title">
      <div className="card-heading"><div><p className="eyebrow">Перевірка даних</p><h3 id="duplicates-title">Менеджер дублікатів чатів</h3><p>Точні посилання мають вищий пріоритет. Однакова назва з різними URL — лише кандидат для ручної перевірки.</p></div><Button variant="ghost" onClick={onClose} disabled={busy!==null}>Закрити</Button></div>
      <div className="lead-actions">
        {(['telegram','whatsapp','viber','facebook'] as Platform[]).map(value=><Button key={value} size="sm" variant={platform===value?'default':'outline'} disabled={busy!==null} onClick={()=>setPlatform(value)}>{value==='telegram'?'Telegram':value==='whatsapp'?'WhatsApp':value==='viber'?'Viber':'Facebook'}</Button>)}
        {platform==='telegram'&&<select aria-label="Telegram-акаунт для перевірки дублікатів" value={accountId} disabled={busy!==null} onChange={event=>setAccountId(event.target.value)}><option value="">Оберіть акаунт</option>{accounts.map(account=><option key={account.id} value={account.id}>{account.name} · #{account.number}</option>)}</select>}
        <Button variant="outline" size="sm" disabled={loading||busy!==null||(platform==='telegram'&&!accountId)} onClick={()=>void load()}>Оновити</Button>
      </div>
      {error&&<div className="workspace-error" role="alert">{error}</div>}
      {notice&&<output className="reports-notice">{notice}</output>}
      {loading?<div className="workspace-loading"><LoaderCircle/>Шукаємо дублікати…</div>:groups.length?<div className="chat-list">{groups.map(group=><section key={group.key} className="settings-panel"><div className="card-heading"><div><strong>{group.chats[0]?.name}</strong><p>{group.chats.length} записів для перевірки</p></div><Badge variant={group.match==='link'?'secondary':'outline'}>{group.match==='link'?'Точне посилання':'Однакова назва — перевірити'}</Badge></div>{group.chats.map(chat=><div key={chat.id} className="chat-row"><div className="chat-main"><Input aria-label={`Назва ${chat.name}`} value={names[chat.id]??chat.name} disabled={busy!==null} onChange={event=>setNames(current=>({...current,[chat.id]:event.target.value}))}/><a className="chat-native-link" href={chat.link} target="_blank" rel="noreferrer"><ExternalLink data-icon="inline-start"/>{chat.link}</a><small>{chat.status==='archived'?`Архів${chat.archiveReason?` · ${chat.archiveReason}`:''}`:chat.status}</small></div><div className="chat-actions"><Button variant="outline" size="sm" disabled={busy!==null||!(names[chat.id]||'').trim()||(names[chat.id]||'').trim()===chat.name} onClick={()=>void rename(chat)}>Зберегти назву</Button>{chat.status!=='archived'&&<Button variant="outline" size="sm" disabled={busy!==null} onClick={()=>void archive(chat)}>Архівувати як дублікат</Button>}</div></div>)}</section>)}</div>:<div className="workspace-empty"><strong>Кандидатів не знайдено</strong><p>На цій платформі немає повторів за нормалізованим посиланням або назвою.</p></div>}
    </dialog>
  </div>;
}
