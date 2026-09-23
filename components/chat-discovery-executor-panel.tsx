'use client';

import { useCallback, useEffect, useState } from 'react';
import { Cable, Copy, LoaderCircle, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

type Device = { id:string; name:string; createdAt:number; lastSeenAt:number|null };

export function ChatDiscoveryExecutorPanel() {
  const [devices,setDevices]=useState<Device[]>([]);
  const [name,setName]=useState('Цей браузер');
  const [token,setToken]=useState('');
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');

  const load=useCallback(async()=>{
    try {
      const response=await fetch('/api/chat-discovery?executorDevices=1',{cache:'no-store'});
      const body=await response.json() as {devices?:Device[];error?:string};
      if(!response.ok) throw new Error(body.error||'Не вдалося завантажити executor.');
      setDevices(body.devices||[]);
    } catch(reason) {
      setError(reason instanceof Error?reason.message:'Не вдалося завантажити executor.');
    }
  },[]);

  useEffect(()=>{void load();},[load]);

  async function mutate(body:Record<string,unknown>){
    const response=await fetch('/api/chat-discovery',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    const payload=await response.json() as {token?:string;error?:string};
    if(!response.ok) throw new Error(payload.error||'Операцію executor не завершено.');
    return payload;
  }

  async function pair(){
    if(busy||!name.trim()) return;
    setBusy(true);setError('');setToken('');
    try {
      const payload=await mutate({action:'pair-executor',name});
      setToken(payload.token||'');
      await load();
    } catch(reason){setError(reason instanceof Error?reason.message:'Не вдалося підключити executor.');}
    finally{setBusy(false);}
  }

  async function revoke(deviceId:string){
    if(busy) return;
    setBusy(true);setError('');
    try {await mutate({action:'revoke-executor',deviceId});await load();}
    catch(reason){setError(reason instanceof Error?reason.message:'Не вдалося відключити executor.');}
    finally{setBusy(false);}
  }

  return <section className="rounded-2xl border border-border/70 bg-background p-4 shadow-sm" aria-label="Executor пошуку чатів">
    <div className="flex items-start gap-3">
      <Cable className="mt-0.5 size-4 shrink-0"/>
      <div className="min-w-0 flex-1">
        <h3 className="font-semibold">Executor</h3>
        <p className="mt-1 text-xs text-muted-foreground">Окреме підключення для runner, який виконує реальні дії у WhatsApp/Viber. Token показується один раз.</p>
      </div>
    </div>
    <div className="mt-3 flex flex-col gap-2 sm:flex-row">
      <Input aria-label="Назва executor" value={name} onChange={event=>setName(event.target.value)} maxLength={80}/>
      <Button type="button" variant="outline" disabled={busy||!name.trim()} onClick={()=>void pair()}>
        {busy?<LoaderCircle className="animate-spin"/>:<Cable/>}Підключити
      </Button>
    </div>
    {token&&<div className="mt-3 rounded-xl border bg-muted/35 p-3">
      <p className="text-xs font-medium">Скопіюйте token зараз — повторно він не показується.</p>
      <div className="mt-2 flex items-center gap-2">
        <code className="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-xs">{token}</code>
        <Button type="button" variant="outline" size="icon" aria-label="Скопіювати executor token" onClick={()=>void navigator.clipboard.writeText(token)}><Copy/></Button>
      </div>
    </div>}
    {error&&<div className="workspace-error mt-3" role="alert">{error}</div>}
    {devices.length>0&&<div className="mt-3 grid gap-2">
      {devices.map(device=><div key={device.id} className="flex min-w-0 items-center gap-2 rounded-xl border px-3 py-2">
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium">{device.name}</div>
          <div className="text-xs text-muted-foreground">{device.lastSeenAt?'Онлайн був '+formatTime(device.lastSeenAt):'Ще не підключався'}</div>
        </div>
        <Button type="button" variant="ghost" size="icon" disabled={busy} aria-label={'Відключити '+device.name} onClick={()=>void revoke(device.id)}><Trash2/></Button>
      </div>)}
    </div>}
  </section>;
}

function formatTime(value:number){
  return new Intl.DateTimeFormat('uk-UA',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'}).format(new Date(value*1000));
}
