'use client';

import { useCallback, useEffect, useState } from 'react';
import { Check, RefreshCw } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import type { TelegramWarmupSnapshot } from '@/lib/chats/telegram-warmup';
import { WorkspaceInlineLoading } from '@/components/workspace-load-state';

export function TelegramWarmup({accountId}:{accountId:string}) {
  const [data,setData]=useState<TelegramWarmupSnapshot|null>(null);
  const [loading,setLoading]=useState(true);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');

  const load=useCallback(async()=>{
    setLoading(true);setError('');
    try {
      const response=await fetch(`/api/telegram-accounts/warmup?account=${encodeURIComponent(accountId)}`,{cache:'no-store'});
      const body=await response.json() as {warmup?:TelegramWarmupSnapshot;error?:string};
      if(!response.ok||!body.warmup)throw new Error(body.error||'Не вдалося завантажити план прогріву.');
      setData(body.warmup);
    } catch(reason){setError(reason instanceof Error?reason.message:'Не вдалося завантажити план прогріву.');}
    finally{setLoading(false);}
  },[accountId]);

  useEffect(()=>{const timer=setTimeout(()=>void load(),0);return()=>clearTimeout(timer);},[load]);

  async function setReady(ready:boolean) {
    setBusy(true);setError('');
    try {
      const response=await fetch('/api/telegram-accounts/warmup',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({accountId,action:ready?'complete':'reopen'})});
      const body=await response.json() as {warmup?:TelegramWarmupSnapshot;error?:string};
      if(!response.ok||!body.warmup)throw new Error(body.error||'Не вдалося оновити план прогріву.');
      setData(body.warmup);
    } catch(reason){setError(reason instanceof Error?reason.message:'Не вдалося оновити план прогріву.');}
    finally{setBusy(false);}
  }

  return <details className="telegram-warmup" aria-label="План прогріву Telegram-акаунта">
    <summary className="telegram-disclosure-summary"><div><strong>План прогріву</strong><small>Ручний чекліст для нового Telegram-акаунта</small></div><Badge variant={data?.ready?'secondary':'outline'}>{data?.ready?'Готовий':'У процесі'}</Badge></summary>
    <div className="telegram-disclosure-body">
      <div className="telegram-disclosure-actions"><Button type="button" variant="ghost" size="sm" disabled={busy||loading} onClick={()=>void load()}><RefreshCw data-icon="inline-start"/>Оновити</Button></div>
      {error&&<div className="workspace-error" role="alert">{error}</div>}
      <p className="muted-note">Це ручний чекліст. Він не запускає автопостинг і не накладає прихованих лімітів.</p>
      {loading&&!data?<WorkspaceInlineLoading label="Завантажуємо стан акаунта…"/>:null}
      {loading&&data?<WorkspaceInlineLoading label="Оновлюємо стан акаунта…"/>:null}
      {data&&<ol className="telegram-warmup-steps">{data.steps.map(step=><li key={step.id} className={step.done?'is-done':''}><span>{step.done?<Check aria-hidden="true"/>:null}</span><div><strong>{step.label}</strong><p>{step.instruction}</p>{step.id==='joined'&&<small>Зафіксовано приєднань: {data.joinedCount}</small>}{step.id==='published'&&<small>Зафіксовано публікацій: {data.publicationCount}</small>}</div></li>)}</ol>}
      {data&&<div className="dialog-actions">{data.ready?<Button variant="outline" disabled={busy} onClick={()=>void setReady(false)}>Повернути в прогрів</Button>:<Button disabled={busy||data.joinedCount<1||data.publicationCount<1} onClick={()=>void setReady(true)}>Позначити готовим</Button>}</div>}
    </div>
  </details>;
}
