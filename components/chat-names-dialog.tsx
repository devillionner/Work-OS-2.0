'use client';

import { useRef, useState } from 'react';
import { Check, LoaderCircle, RefreshCw, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';

type ScanStatus = 'updated' | 'unchanged' | 'confirm' | 'error';
type ScanItem = {
  id: string;
  platform: string;
  currentName: string;
  suggestedName: string | null;
  status: ScanStatus;
  updatedAt: number;
  error: string | null;
};
type PlatformCounts = { checked:number; updated:number; unchanged:number; confirm:number; error:number };
type ScanResponse = { items:ScanItem[]; counts:Record<string,PlatformCounts>; nextCursor:string|null; error?:string };
type Totals = PlatformCounts & { platforms:Record<string,PlatformCounts> };

const EMPTY = ():Totals => ({checked:0,updated:0,unchanged:0,confirm:0,error:0,platforms:{}});

export function ChatNamesDialog({ open, onClose, onChanged }: { open:boolean; onClose:()=>void; onChanged:()=>void }) {
  const [busy,setBusy]=useState(false);
  const [totals,setTotals]=useState<Totals>(EMPTY);
  const [problems,setProblems]=useState<ScanItem[]>([]);
  const [notice,setNotice]=useState('');
  const [error,setError]=useState('');
  const [done,setDone]=useState(false);
  const [resumeCursor,setResumeCursor]=useState<string|null>(null);
  const stopRef=useRef(false);

  async function scanAll() {
    const continuing=Boolean(resumeCursor)&&!done;
    setBusy(true);if(!continuing){setTotals(EMPTY());setProblems([]);}setNotice('');setError('');setDone(false);stopRef.current=false;
    let cursor:string|null=continuing?resumeCursor:null;
    let changed=false;
    try {
      do {
        const response=await fetch('/api/chats/names',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'scan',cursor,limit:12})});
        const body=await response.json() as ScanResponse;
        if(!response.ok)throw new Error(body.error||'Не вдалося перевірити назви чатів.');
        setTotals(current=>mergeTotals(current,body.counts));
        setProblems(current=>[...current,...body.items.filter(item=>item.status==='confirm'||item.status==='error')].slice(-300));
        if(body.items.some(item=>item.status==='updated'))changed=true;
        cursor=body.nextCursor;
        if(stopRef.current)break;
      } while(cursor);
      setResumeCursor(cursor);
      setDone(!cursor);
      setNotice(stopRef.current?'Перевірку зупинено після поточної порції. Можна продовжити з цього місця.':'Перевірку завершено.');
      if(changed)onChanged();
    } catch(reason) {
      setError(reason instanceof Error?reason.message:'Не вдалося перевірити назви чатів.');
    } finally { setBusy(false); }
  }

  async function confirm(item:ScanItem) {
    if(!item.suggestedName)return;
    setError('');
    try {
      const response=await fetch('/api/chats/names',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'confirm',id:item.id,name:item.suggestedName,expectedUpdatedAt:item.updatedAt})});
      const body=await response.json() as {error?:string};
      if(!response.ok)throw new Error(body.error||'Не вдалося підтвердити назву.');
      setProblems(current=>current.filter(row=>row.id!==item.id));
      setTotals(current=>{
        const platform=current.platforms[item.platform];
        return {
          ...current,
          confirm:Math.max(0,current.confirm-1),
          updated:current.updated+1,
          platforms:platform?{...current.platforms,[item.platform]:{...platform,confirm:Math.max(0,platform.confirm-1),updated:platform.updated+1}}:current.platforms,
        };
      });
      onChanged();
    } catch(reason) { setError(reason instanceof Error?reason.message:'Не вдалося підтвердити назву.'); }
  }

  function close() {
    if(busy){stopRef.current=true;setNotice('Зупиняємо після поточної порції…');return;}
    onClose();
  }

  return <Dialog open={open} onOpenChange={next=>{if(!next)close();}}>
    <DialogContent className="chat-names-dialog" showCloseButton={false}>
      <DialogHeader>
        <DialogTitle>Перевірити назви всіх чатів</DialogTitle>
        <DialogDescription>Work OS читає публічні сторінки Telegram, WhatsApp і Viber порціями. Помилка одного посилання не зупиняє решту, а надійна ручна назва не перезаписується без вашого підтвердження.</DialogDescription>
      </DialogHeader>
      <Button className="chat-publish-close" variant="ghost" size="icon" aria-label="Закрити" onClick={close}><X/></Button>
      {error&&<div className="workspace-error" role="alert">{error}</div>}
      {notice&&<output className="reports-notice">{notice}</output>}
      <section className="chat-names-summary" aria-live="polite">
        <div><span>Перевірено</span><strong>{totals.checked}</strong></div>
        <div><span>Оновлено</span><strong>{totals.updated}</strong></div>
        <div><span>Без змін</span><strong>{totals.unchanged}</strong></div>
        <div><span>Потрібне підтвердження</span><strong>{totals.confirm}</strong></div>
        <div><span>Помилки</span><strong>{totals.error}</strong></div>
      </section>
      {Object.keys(totals.platforms).length>0&&<div className="chat-names-platforms">{Object.entries(totals.platforms).map(([platform,count])=><span key={platform}>{platformLabel(platform)}: {count.checked} · оновлено {count.updated} · помилок {count.error}</span>)}</div>}
      {problems.length>0&&<div className="chat-names-problems">
        {problems.map(item=><article key={item.id} className="chat-names-problem" data-status={item.status}>
          <div><strong>{item.currentName}</strong><small>{platformLabel(item.platform)}</small>{item.status==='confirm'&&item.suggestedName?<span>Знайдено: <b>{item.suggestedName}</b></span>:<span>{item.error||'Назву не вдалося визначити.'}</span>}</div>
          {item.status==='confirm'&&item.suggestedName&&<Button size="sm" variant="outline" disabled={busy} onClick={()=>void confirm(item)}><Check data-icon="inline-start"/>Замінити</Button>}
        </article>)}
      </div>}
      {!busy&&done&&totals.checked===0&&<p className="muted-note">Telegram, WhatsApp або Viber чатів для перевірки не знайдено.</p>}
      <div className="dialog-actions">
        {busy?<><Button variant="outline" onClick={()=>{stopRef.current=true;}}>Зупинити</Button><Button disabled><LoaderCircle data-icon="inline-start"/>Перевіряємо…</Button></>:<><Button variant="outline" onClick={onClose}>Закрити</Button><Button onClick={()=>void scanAll()}><RefreshCw data-icon="inline-start"/>{resumeCursor&&!done?'Продовжити перевірку':done?'Перевірити ще раз':'Почати перевірку'}</Button></>}
      </div>
    </DialogContent>
  </Dialog>;
}

function mergeTotals(current:Totals, next:Record<string,PlatformCounts>):Totals {
  const result:Totals={...current,platforms:{...current.platforms}};
  for(const [platform,value] of Object.entries(next)) {
    const existing=result.platforms[platform]||{checked:0,updated:0,unchanged:0,confirm:0,error:0};
    result.platforms[platform]={
      checked:existing.checked+value.checked,
      updated:existing.updated+value.updated,
      unchanged:existing.unchanged+value.unchanged,
      confirm:existing.confirm+value.confirm,
      error:existing.error+value.error,
    };
    result.checked+=value.checked;result.updated+=value.updated;result.unchanged+=value.unchanged;result.confirm+=value.confirm;result.error+=value.error;
  }
  return result;
}

function platformLabel(value:string) {
  return value==='telegram'?'Telegram':value==='whatsapp'?'WhatsApp':value==='viber'?'Viber':value;
}
