'use client';

import { useCallback, useEffect, useState } from 'react';
import { Archive, ExternalLink, RefreshCw } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import type { ChatDuplicateGroup, DuplicateChat } from '@/lib/chats/duplicates';
import type { ChatPlatform } from '@/lib/chats/bulk-input';

export function ChatDuplicatesDialog({
  open,platform,accountId,onClose,onChanged,
}:{
  open:boolean;platform:ChatPlatform;accountId:string|null;onClose:()=>void;onChanged:()=>void;
}) {
  const [groups,setGroups]=useState<ChatDuplicateGroup[]>([]);
  const [loading,setLoading]=useState(false);
  const [busy,setBusy]=useState<string|null>(null);
  const [error,setError]=useState('');

  const load=useCallback(async()=>{
    if(!open)return;
    if(platform==='telegram'&&!accountId){setGroups([]);setError('Оберіть Telegram-акаунт.');return;}
    setLoading(true);setError('');
    try {
      const params=new URLSearchParams({platform});
      if(accountId)params.set('account',accountId);
      const response=await fetch(`/api/chats/duplicates?${params}`,{cache:'no-store'});
      const body=await response.json() as {groups?:ChatDuplicateGroup[];error?:string};
      if(!response.ok)throw new Error(body.error||'Не вдалося перевірити дублікати.');
      setGroups(body.groups||[]);
    } catch(reason){setError(reason instanceof Error?reason.message:'Не вдалося перевірити дублікати.');}
    finally{setLoading(false);}
  },[open,platform,accountId]);

  useEffect(()=>{if(!open)return;const timer=setTimeout(()=>void load(),0);return()=>clearTimeout(timer);},[open,load]);

  async function rename(chat:DuplicateChat,name:string) {
    const next=name.trim();
    if(!next||next===chat.name)return;
    setBusy(chat.id);setError('');
    try {
      const response=await fetch('/api/chats/duplicates',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'rename',id:chat.id,name:next,stateToken:chat.stateToken})});
      const body=await response.json() as {error?:string};
      if(!response.ok)throw new Error(body.error||'Не вдалося перейменувати чат.');
      await load();onChanged();
    } catch(reason){setError(reason instanceof Error?reason.message:'Не вдалося перейменувати чат.');}
    finally{setBusy(null);}
  }

  async function archive(chat:DuplicateChat) {
    if(chat.status==='archived'||!window.confirm(`Перенести «${chat.name}» в архів як дублікат?`))return;
    setBusy(chat.id);setError('');
    try {
      const response=await fetch('/api/chats',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:chat.id,action:'archive',reason:'Дублікат',stateToken:chat.stateToken,accountId:platform==='telegram'?accountId:null})});
      const body=await response.json() as {error?:string};
      if(!response.ok)throw new Error(body.error||'Не вдалося архівувати чат.');
      await load();onChanged();
    } catch(reason){setError(reason instanceof Error?reason.message:'Не вдалося архівувати чат.');}
    finally{setBusy(null);}
  }

  return <Dialog open={open} onOpenChange={next=>{if(!next&&!busy)onClose();}}><DialogContent className="chat-history-dialog" showCloseButton={false}>
    <DialogHeader><DialogTitle>Менеджер дублікатів</DialogTitle><DialogDescription>Точний збіг посилання — сильний дублікат. Однакова назва з різними URL — лише кандидат для ручної перевірки.</DialogDescription></DialogHeader>
    <Button className="chat-history-close" variant="ghost" size="icon" aria-label="Закрити" disabled={Boolean(busy)} onClick={onClose}>×</Button>
    {error&&<div className="workspace-error" role="alert">{error}</div>}
    <div className="dialog-actions"><Button variant="outline" size="sm" disabled={loading||Boolean(busy)} onClick={()=>void load()}><RefreshCw data-icon="inline-start"/>Оновити</Button><Badge variant="secondary">{groups.length} груп</Badge></div>
    {loading?<p className="workspace-loading">Шукаємо дублікати…</p>:groups.length?<div className="chat-list">{groups.map(group=><section className="chat-row" key={`${group.kind}:${group.key}`}><div className="chat-main"><strong>{group.kind==='link'?'Однакове посилання':'Однакова назва'}</strong><small>{group.kind==='link'?'Перевірте й залиште один актуальний запис.':'Різні посилання не видаляються автоматично.'}</small></div>{group.chats.map(chat=><div className="chat-actions" key={chat.id}><Input aria-label={`Назва ${chat.name}`} defaultValue={chat.name} disabled={Boolean(busy)} onBlur={event=>void rename(chat,event.target.value)}/><Badge variant="outline">{statusName(chat.status)}</Badge><Button variant="outline" size="sm" disabled={Boolean(busy)} onClick={()=>window.open(chat.link,'_blank','noopener,noreferrer')}><ExternalLink data-icon="inline-start"/>Відкрити</Button>{chat.status!=='archived'?<Button variant="outline" size="sm" disabled={Boolean(busy)} onClick={()=>void archive(chat)}><Archive data-icon="inline-start"/>Дублікат</Button>:<Badge variant="secondary">Архів · {chat.archiveReason||'без причини'}</Badge>}</div>)}</section>)}</div>:<p className="muted-note">Потенційних дублікатів не знайдено.</p>}
    <div className="dialog-actions"><Button variant="outline" disabled={Boolean(busy)} onClick={onClose}>Закрити</Button></div>
  </DialogContent></Dialog>;
}

function statusName(status:string) {
  return ({to_join:'Для приєднання',waiting:'Очікування',ready:'Для публікації',archived:'Архів'} as Record<string,string>)[status]||status;
}
