'use client';

import { useRef, useState } from 'react';
import { Plus, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { createActionGate } from '@/lib/action-gate';
import { BULK_MAX_TEXT, CHAT_PLATFORM_NAMES, type BulkInput, type ChatPlatform } from '@/lib/chats/bulk-input';
import type { BulkPreview, BulkPreviewItem, BulkResult } from '@/lib/chats/bulk';

const statusNames: Record<BulkPreviewItem['status'],string> = {new:'Новий',existing:'Уже є',archived:'В архіві',duplicate:'Повтор у списку',invalid:'Нерозпізнане посилання'};
type Submission = { action:'add'; requestId:string; revision:number; items:BulkInput[] };

async function send(body: unknown) {
  const controller=new AbortController();
  const timeout=setTimeout(()=>controller.abort(),30_000);
  try {
    const response=await fetch('/api/chats/bulk',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:controller.signal});
    const value:unknown=await response.json();
    if(!value||typeof value!=='object'||Array.isArray(value)) throw new Error('Не вдалося прочитати відповідь. Спробуйте ще раз.');
    return {response,body:value as Partial<BulkPreview & BulkResult> & {error?:string}};
  } finally { clearTimeout(timeout); }
}

export function ChatBulkDialog({open,onClose,onAdded,enabledPlatforms}: {
  open:boolean; onClose:()=>void; onAdded:(result:BulkResult)=>void; enabledPlatforms?:string[];
}) {
  const [text,setText]=useState('');
  const [plan,setPlan]=useState<BulkPreview|null>(null);
  const [busy,setBusy]=useState<'preview'|'add'|null>(null);
  const [uncertain,setUncertain]=useState(false);
  const [error,setError]=useState('');
  const [visible,setVisible]=useState(50);
  const run=useRef(createActionGate());
  const submission=useRef<Submission|null>(null);
  const newItems=plan?.items.filter(item=>item.status==='new')||[];
  const locked=busy!==null||uncertain;

  async function preview() {
    await run.current(async()=>{
      setBusy('preview');setError('');
      try {
        const result=await send({action:'preview',text});
        if(!result.response.ok) throw new Error(result.body.error||'Не вдалося перевірити список.');
        if(!Array.isArray(result.body.items)||typeof result.body.revision!=='number') throw new Error('Не вдалося прочитати результат перевірки.');
        setPlan(result.body as BulkPreview);setVisible(50);
      } catch(reason) { setError(reason instanceof Error&&reason.name!=='AbortError'&&reason.name!=='TypeError'?reason.message:'Не вдалося перевірити список. Перевірте з’єднання та спробуйте ще раз.'); }
      finally { setBusy(null); }
    });
  }

  async function add() {
    if(!plan||!newItems.length) return;
    await run.current(async()=>{
      submission.current ??= {action:'add',requestId:crypto.randomUUID(),revision:plan.revision,items:newItems.map(({link,name})=>({link,name}))};
      setBusy('add');setUncertain(true);setError('');
      try {
        const result=await send(submission.current);
        if(!result.response.ok) {
          if(result.response.status<500) { setText(submission.current.items.map(item=>`${item.name} ${item.link}`).join('\n'));submission.current=null;setUncertain(false);setPlan(null); }
          throw new Error(result.body.error||'Не вдалося підтвердити результат. Спробуйте ще раз.');
        }
        if(typeof result.body.added!=='number'||!Number.isInteger(result.body.added)||result.body.added<1||!result.body.counts) throw new Error('Не вдалося підтвердити результат. Спробуйте ще раз.');
        submission.current=null;setUncertain(false);setPlan(null);setText('');
        onAdded(result.body as BulkResult);onClose();
      } catch(reason) { setError(reason instanceof Error&&reason.name!=='AbortError'&&reason.name!=='TypeError'?reason.message:'Не вдалося підтвердити результат. Спробуйте ще раз.'); }
      finally { setBusy(null); }
    });
  }

  function remove(index: number) { if(!locked) setPlan(current=>current?{...current,items:current.items.filter(item=>item.index!==index)}:current); }
  function rename(index: number,name: string) { if(!locked) setPlan(current=>current?{...current,items:current.items.map(item=>item.index===index?{...item,name}:item)}:current); }

  return <Dialog open={open} onOpenChange={next=>{if(!next&&!busy)onClose();}}>
    <DialogContent className="chat-bulk-dialog" showCloseButton={false}>
      <DialogHeader><DialogTitle>Додати чати</DialogTitle><DialogDescription>Вставте до 500 посилань Telegram, WhatsApp, Viber або Facebook. Назву можна написати поруч із посиланням.</DialogDescription></DialogHeader>
      <Button className="chat-bulk-close" variant="ghost" size="icon" aria-label="Закрити" disabled={busy!==null} onClick={onClose}><X/></Button>
      {error&&<div className="workspace-error" role="alert">{error}</div>}
      {!plan?<>
        <label className="chat-bulk-input" htmlFor="chat-bulk-text">Список чатів<Textarea id="chat-bulk-text" rows={10} maxLength={BULK_MAX_TEXT} value={text} disabled={busy!==null} onChange={event=>setText(event.target.value)} placeholder={'Батьки школярів https://t.me/school_parents\nhttps://chat.whatsapp.com/…'}/></label>
        <div className="dialog-actions"><Button variant="outline" disabled={busy!==null} onClick={onClose}>Закрити</Button><Button disabled={busy!==null||!text.trim()} onClick={()=>void preview()}>{busy==='preview'?'Перевіряємо…':'Перевірити список'}</Button></div>
      </>:<>
        <div className="chat-bulk-counts"><strong>Нових: {newItems.length}</strong><span>Уже є: {plan.items.filter(item=>item.status==='existing').length}</span><span>В архіві: {plan.items.filter(item=>item.status==='archived').length}</span><span>Повторів: {plan.items.filter(item=>item.status==='duplicate').length}</span><span>Не розпізнано: {plan.items.filter(item=>item.status==='invalid').length}</span></div>
        <div className="chat-bulk-platforms">{(Object.keys(CHAT_PLATFORM_NAMES) as ChatPlatform[]).map(platform=>{const count=newItems.filter(item=>item.platform===platform).length;return count?<span key={platform}>{CHAT_PLATFORM_NAMES[platform]}: {count}{enabledPlatforms&&!enabledPlatforms.includes(platform)?' · прихована в налаштуваннях':''}</span>:null;})}</div>
        <p className="muted-note">Нові чати потраплять у «Для приєднання». Збіги з базою та архівом залишаться у своїх поточних станах.</p>
        <div className="chat-bulk-items">{plan.items.slice(0,visible).map(item=><article className="chat-bulk-item" data-status={item.status} key={item.index}>
          <div className="chat-bulk-item-body"><span className="chat-bulk-status">{item.platform?`${CHAT_PLATFORM_NAMES[item.platform]} · `:''}{statusNames[item.status]}</span>
            {item.status==='new'?<Input value={item.name} maxLength={180} disabled={locked} aria-label={`Назва чату ${item.index+1}`} onChange={event=>rename(item.index,event.target.value)}/>:<strong>{item.existingName||item.name||'Перевірте посилання'}</strong>}
            <span className="chat-bulk-link">{item.link}</span></div>
          <Button variant="ghost" size="icon" disabled={locked} aria-label={`Прибрати посилання ${item.index+1}`} onClick={()=>remove(item.index)}><X/></Button>
        </article>)}</div>
        {plan.items.length>visible&&<Button variant="outline" disabled={busy!==null} onClick={()=>setVisible(value=>value+50)}>Показати ще {Math.min(50,plan.items.length-visible)}</Button>}
        <div className="dialog-actions"><Button variant="outline" disabled={locked} onClick={()=>{setText(plan.items.map(item=>`${item.name} ${item.link}`.trim()).join('\n'));setPlan(null);setError('');}}>Змінити список</Button><Button disabled={busy!==null||!newItems.length} onClick={()=>void add()}><Plus data-icon="inline-start"/>{busy==='add'?'Додаємо…':uncertain?'Спробувати ще раз':`Додати ${newItems.length}`}</Button></div>
      </>}
    </DialogContent>
  </Dialog>;
}
