'use client';

import { useRef, useState } from 'react';
import { Plus, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { createActionGate } from '@/lib/action-gate';
import { BULK_IMPORT_MAX_TEXT, CHAT_PLATFORM_NAMES, parseBulkImportText, type BulkInput, type ChatPlatform } from '@/lib/chats/bulk-input';
import type { BulkPreview, BulkPreviewItem, BulkResult } from '@/lib/chats/bulk';
import { markCrossBatchDuplicates, mergeBulkResults, splitBulkBatches } from '@/lib/chats/bulk-client';

const statusNames: Record<BulkPreviewItem['status'],string> = {new:'Новий',existing:'Уже є',archived:'В архіві',duplicate:'Повтор у списку',invalid:'Нерозпізнане посилання'};
type Submission = { action:'add'; requestId:string; revision:number; items:BulkInput[]; skipped:number };
type ImportJob = { batches:BulkInput[][]; next:number; completed:number; failed:number; results:BulkResult[] };
type ImportProgress = { total:number; completed:number; failed:number; batches:number; finishedBatches:number; finished:boolean };

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
  const [progress,setProgress]=useState<ImportProgress|null>(null);
  const run=useRef(createActionGate());
  const submission=useRef<Submission|null>(null);
  const job=useRef<ImportJob|null>(null);
  const newItems=plan?.items.filter(item=>item.status==='new')||[];
  const locked=busy!==null||uncertain||Boolean(progress&&(progress.completed>0||progress.failed>0));

  async function preview() {
    await run.current(async()=>{
      setBusy('preview');setError('');
      try {
        const parsed=parseBulkImportText(text);
        const items:BulkPreviewItem[]=[];
        let revision=0;
        let offset=0;
        for(const batch of splitBulkBatches(parsed)) {
          const result=await send({action:'preview',items:batch});
          if(!result.response.ok) throw new Error(result.body.error||'Не вдалося перевірити список.');
          if(!Array.isArray(result.body.items)||typeof result.body.revision!=='number') throw new Error('Не вдалося прочитати результат перевірки.');
          revision=result.body.revision;
          items.push(...(result.body.items as BulkPreviewItem[]).map(item=>({...item,index:item.index+offset})));
          offset+=batch.length;
        }
        setPlan({revision,items:markCrossBatchDuplicates(items)});setVisible(50);setProgress(null);job.current=null;submission.current=null;
      } catch(reason) { setError(reason instanceof Error&&reason.name!=='AbortError'&&reason.name!=='TypeError'?reason.message:'Не вдалося перевірити список. Перевірте з’єднання та спробуйте ще раз.'); }
      finally { setBusy(null); }
    });
  }

  async function add() {
    if(!plan||!newItems.length) return;
    await run.current(async()=>{
      job.current ??= {batches:splitBulkBatches(newItems.map(({link,name})=>({link,name}))),next:0,completed:0,failed:0,results:[]};
      const currentJob=job.current;
      updateProgress(currentJob);
      setBusy('add');setUncertain(false);setError('');
      try {
        while(currentJob.next<currentJob.batches.length) {
          if(!submission.current) {
            const checked=await send({action:'preview',items:currentJob.batches[currentJob.next]});
            if(!checked.response.ok||!Array.isArray(checked.body.items)||typeof checked.body.revision!=='number') throw new Error(checked.body.error||'Не вдалося перевірити наступну порцію.');
            const addable=(checked.body.items as BulkPreviewItem[]).filter(item=>item.status==='new').map(({link,name})=>({link,name}));
            const skipped=currentJob.batches[currentJob.next].length-addable.length;
            if(!addable.length) { currentJob.failed+=skipped;currentJob.next+=1;updateProgress(currentJob);continue; }
            submission.current={action:'add',requestId:crypto.randomUUID(),revision:checked.body.revision,items:addable,skipped};
          }
          setUncertain(true);
          const result=await send(submission.current);
          if(!result.response.ok) {
            if(result.response.status<500) { submission.current=null;setUncertain(false); }
            throw new Error(result.body.error||'Не вдалося підтвердити результат. Спробуйте ще раз.');
          }
          if(typeof result.body.added!=='number'||!Number.isInteger(result.body.added)||result.body.added<1||!result.body.counts) throw new Error('Не вдалося підтвердити результат. Спробуйте ще раз.');
          currentJob.results.push(result.body as BulkResult);currentJob.completed+=result.body.added;currentJob.failed+=submission.current.skipped;currentJob.next+=1;
          submission.current=null;setUncertain(false);updateProgress(currentJob);
        }
        const result=mergeBulkResults(currentJob.results) as BulkResult;
        submission.current=null;job.current=null;setUncertain(false);
        if(result.added)onAdded(result);
        if(currentJob.failed) {
          updateProgress(currentJob,true);
          setError(`Імпорт завершено: додано ${currentJob.completed}, пропущено ${currentJob.failed}. Пропущені посилання вже були в базі або змінилися під час імпорту.`);
        } else { setPlan(null);setText('');setProgress(null);onClose(); }
      } catch(reason) { setError(reason instanceof Error&&reason.name!=='AbortError'&&reason.name!=='TypeError'?reason.message:'Не вдалося підтвердити результат. Спробуйте ще раз.'); }
      finally { setBusy(null); }
    });
  }

  function remove(index: number) { if(!locked) setPlan(current=>current?{...current,items:current.items.filter(item=>item.index!==index)}:current); }
  function rename(index: number,name: string) { if(!locked) setPlan(current=>current?{...current,items:current.items.map(item=>item.index===index?{...item,name}:item)}:current); }
  function updateProgress(current:ImportJob,finished=false) { setProgress({total:newItems.length,completed:current.completed,failed:current.failed,batches:current.batches.length,finishedBatches:current.next,finished}); }
  function closeDialog() { if(progress?.finished){setPlan(null);setText('');setProgress(null);setError('');}onClose(); }

  return <Dialog open={open} onOpenChange={next=>{if(!next&&!busy&&!uncertain)closeDialog();}}>
    <DialogContent className="chat-bulk-dialog" showCloseButton={false}>
      <DialogHeader><DialogTitle>Додати чати</DialogTitle><DialogDescription>Вставте великий список Telegram, WhatsApp, Viber або Facebook. Застосунок сам розділить його на безпечні порції до 500. Назву можна написати поруч із посиланням.</DialogDescription></DialogHeader>
      <Button className="chat-bulk-close" variant="ghost" size="icon" aria-label="Закрити" disabled={busy!==null||uncertain} onClick={closeDialog}><X/></Button>
      {error&&<div className="workspace-error" role="alert">{error}</div>}
      {!plan?<>
        <label className="chat-bulk-input" htmlFor="chat-bulk-text">Список чатів<Textarea id="chat-bulk-text" rows={10} maxLength={BULK_IMPORT_MAX_TEXT} value={text} disabled={busy!==null} onChange={event=>setText(event.target.value)} placeholder={'Батьки школярів https://t.me/school_parents\nhttps://chat.whatsapp.com/…'}/></label>
        <div className="dialog-actions"><Button variant="outline" disabled={busy!==null} onClick={closeDialog}>Закрити</Button><Button disabled={busy!==null||!text.trim()} onClick={()=>void preview()}>{busy==='preview'?'Перевіряємо…':'Перевірити список'}</Button></div>
      </>:<>
        <div className="chat-bulk-counts"><strong>Нових: {newItems.length}</strong><span>Уже є: {plan.items.filter(item=>item.status==='existing').length}</span><span>В архіві: {plan.items.filter(item=>item.status==='archived').length}</span><span>Повторів: {plan.items.filter(item=>item.status==='duplicate').length}</span><span>Не розпізнано: {plan.items.filter(item=>item.status==='invalid').length}</span></div>
        <div className="chat-bulk-platforms">{(Object.keys(CHAT_PLATFORM_NAMES) as ChatPlatform[]).map(platform=>{const count=newItems.filter(item=>item.platform===platform).length;return count?<span key={platform}>{CHAT_PLATFORM_NAMES[platform]}: {count}{enabledPlatforms&&!enabledPlatforms.includes(platform)?' · прихована в налаштуваннях':''}</span>:null;})}</div>
        <p className="muted-note">Нові чати потраплять у «Для приєднання». Збіги з базою та архівом залишаться у своїх поточних станах.</p>
        {progress&&<output className="chat-bulk-progress" aria-live="polite"><div><strong>Додано: {progress.completed} з {progress.total}</strong><span>Помилок / пропущено: {progress.failed}</span><span>Порцій: {progress.finishedBatches} з {progress.batches}</span></div><progress max={progress.total} value={progress.completed+progress.failed}/></output>}
        <div className="chat-bulk-items">{plan.items.slice(0,visible).map(item=><article className="chat-bulk-item" data-status={item.status} key={item.index}>
          <div className="chat-bulk-item-body"><span className="chat-bulk-status">{item.platform?`${CHAT_PLATFORM_NAMES[item.platform]} · `:''}{statusNames[item.status]}</span>
            {item.status==='new'?<Input value={item.name} maxLength={180} disabled={locked} aria-label={`Назва чату ${item.index+1}`} onChange={event=>rename(item.index,event.target.value)}/>:<strong>{item.existingName||item.name||'Перевірте посилання'}</strong>}
            <span className="chat-bulk-link">{item.link}</span></div>
          <Button variant="ghost" size="icon" disabled={locked} aria-label={`Прибрати посилання ${item.index+1}`} onClick={()=>remove(item.index)}><X/></Button>
        </article>)}</div>
        {plan.items.length>visible&&<Button variant="outline" disabled={busy!==null} onClick={()=>setVisible(value=>value+50)}>Показати ще {Math.min(50,plan.items.length-visible)}</Button>}
        <div className="dialog-actions">{progress?.finished?<Button onClick={closeDialog}>Готово</Button>:<><Button variant="outline" disabled={locked} onClick={()=>{setText(plan.items.map(item=>`${item.name} ${item.link}`.trim()).join('\n'));setPlan(null);setError('');setProgress(null);job.current=null;submission.current=null;}}>Змінити список</Button><Button disabled={busy!==null||!newItems.length} onClick={()=>void add()}><Plus data-icon="inline-start"/>{busy==='add'?'Додаємо…':uncertain?'Спробувати ще раз':progress?'Продовжити імпорт':`Додати ${newItems.length}`}</Button></>}</div>
      </>}
    </DialogContent>
  </Dialog>;
}
