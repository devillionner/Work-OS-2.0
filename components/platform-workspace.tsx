'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Archive, Check, ChevronLeft, ChevronRight, Clock3, Copy, ExternalLink, LoaderCircle, RotateCcw, Search, Send, UserRoundCheck, X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

type Platform = 'telegram' | 'whatsapp' | 'viber' | 'facebook';
type Queue = 'to_join' | 'waiting' | 'ready' | 'archived';
type Chat = { id:string; name:string; link:string; platform:Platform; status:Queue; archiveReason:string|null; profileConfirmed:boolean; publishedToday:boolean; snoozedUntil:number|null; availableAt:number|null; availableNow:boolean };
type LinkItem = { name?:string; link?:string };
type ResponseData = { chats:Chat[]; total:number; offset:number; counts:Record<string,number>; joinedToday:LinkItem[]; publishedToday:LinkItem[] };

const platforms: Array<{key:Platform;label:string;color:string}> = [
  {key:'telegram',label:'Telegram',color:'#2563eb'}, {key:'whatsapp',label:'WhatsApp',color:'#16a34a'},
  {key:'viber',label:'Viber',color:'#7c3aed'}, {key:'facebook',label:'Facebook',color:'#1877f2'},
];
const queues: Array<{key:Queue;label:string}> = [
  {key:'to_join',label:'Для приєднання'}, {key:'waiting',label:'Очікування'},
  {key:'ready',label:'Для публікації'}, {key:'archived',label:'Архів'},
];

export function PlatformWorkspace() {
  const router = useRouter();
  const [platform,setPlatform] = useState<Platform>('telegram');
  const [queue,setQueue] = useState<Queue>('to_join');
  const [search,setSearch] = useState('');
  const [data,setData] = useState<ResponseData|null>(null);
  const [loading,setLoading] = useState(true);
  const [busy,setBusy] = useState<string|null>(null);
  const [error,setError] = useState('');
  const [archiveId,setArchiveId] = useState<string|null>(null);
  const [offset,setOffset] = useState(0);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const params = new URLSearchParams({platform,status:queue,search,offset:String(offset)});
      const response = await fetch(`/api/chats?${params}`,{cache:'no-store'});
      const body = await response.json() as ResponseData & {error?:string};
      if(!response.ok) throw new Error(body.error || 'Не вдалося завантажити чати.');
      setData(body);
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Не вдалося завантажити чати.'); }
    finally { setLoading(false); }
  },[platform,queue,search,offset]);

  useEffect(() => { const timer=setTimeout(load,search ? 250 : 0); return () => clearTimeout(timer); },[load,search]);
  useEffect(() => { setOffset(0); },[platform,queue,search]);

  async function act(chat:Chat, action:string, extra:Record<string,unknown>={}) {
    setBusy(chat.id); setError('');
    try {
      const response=await fetch('/api/chats',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:chat.id,action,...extra})});
      const body=await response.json() as {error?:string;availableAt?:number};
      if(!response.ok) throw new Error(body.error || 'Не вдалося виконати дію.');
      setArchiveId(null); await load(); router.refresh();
    } catch(reason) { setError(reason instanceof Error ? reason.message : 'Не вдалося виконати дію.'); }
    finally { setBusy(null); }
  }

  const selected = useMemo(() => platforms.find(item=>item.key===platform)!,[platform]);
  return <div className="platform-workspace">
    <section className="platform-hero">
      <div><p className="eyebrow">Робочі платформи</p><h2>Чати без зайвих переходів</h2><p>Приєднуйся, перевіряй очікування та відмічай публікації в одному стабільному процесі.</p></div>
      <div className="platform-picker" role="tablist" aria-label="Платформа">
        {platforms.map(item=><button key={item.key} role="tab" aria-selected={platform===item.key} onClick={()=>{setPlatform(item.key);setQueue('to_join');setOffset(0)}}><i style={{background:item.color}} />{item.label}</button>)}
      </div>
    </section>

    <section className="today-links">
      <TodayLinks title="Приєднано сьогодні" items={data?.joinedToday || []} />
      <TodayLinks title="Опубліковано сьогодні" items={data?.publishedToday || []} />
    </section>

    <section className="platform-browser">
      <div className="queue-tabs" role="tablist" aria-label="Черга чатів">
        {queues.map(item=><button key={item.key} role="tab" aria-selected={queue===item.key} onClick={()=>{setQueue(item.key);setOffset(0)}}>{item.label}<span>{data?.counts[item.key] || 0}</span></button>)}
      </div>
      <div className="chat-toolbar">
        <label><Search/><Input value={search} onChange={event=>setSearch(event.target.value)} placeholder="Пошук за назвою або посиланням"/><span className="sr-only">Пошук чатів</span></label>
        <Badge variant="secondary">{data?.total || 0} у черзі</Badge>
      </div>
      {error && <div className="workspace-error">{error}</div>}
      {loading ? <div className="workspace-loading"><LoaderCircle/>Завантажуємо {selected.label}…</div> : data?.chats.length ? <div className="chat-list">
        {data.chats.map(chat=><article className="chat-row" key={chat.id}>
          <div className="chat-main"><div className="chat-name-line"><strong>{chat.name}</strong>{!chat.profileConfirmed&&queue==='ready'&&<Badge variant="outline">Профіль пізніше</Badge>}{chat.publishedToday&&<Badge variant="secondary">Опубліковано сьогодні</Badge>}</div><a href={chat.link} target="_blank" rel="noreferrer">{chat.link}</a>{chat.archiveReason&&<small>Причина: {chat.archiveReason}</small>}{chat.snoozedUntil&&chat.snoozedUntil>Date.now()/1000&&<small>Відкладено до {formatDateTime(chat.snoozedUntil)}</small>}{queue==='ready'&&!chat.availableNow&&<small className="wait-note"><Clock3/>Telegram буде доступний {formatDateTime(chat.availableAt!)}</small>}</div>
          <div className="chat-actions">
            <Button variant="outline" size="icon" asChild><a href={chat.link} target="_blank" rel="noreferrer" aria-label="Відкрити чат"><ExternalLink/></a></Button>
            {queue==='to_join'&&<><Button size="icon" onClick={()=>act(chat,'joined')} disabled={busy===chat.id} aria-label="Успішно приєднано"><Check/></Button>{(platform==='telegram'||platform==='whatsapp')&&<Button variant="outline" size="icon" onClick={()=>act(chat,'waiting')} disabled={busy===chat.id} aria-label="Очікуємо запрошення"><Clock3/></Button>}<Button variant="outline" size="icon" onClick={()=>act(chat,'failed',{reason:'Не вдалося приєднатися'})} disabled={busy===chat.id} aria-label="Не вдалося приєднатися"><X/></Button></>}
            {queue==='waiting'&&<><Button onClick={()=>act(chat,'approved')} disabled={busy===chat.id}><UserRoundCheck data-icon="inline-start"/>Прийняли</Button><Button variant="outline" onClick={()=>act(chat,'snooze')} disabled={busy===chat.id}>+3 дні</Button></>}
            {queue==='ready'&&<Button onClick={()=>act(chat,'published',{force:!chat.availableNow})} disabled={busy===chat.id||chat.publishedToday}><Send data-icon="inline-start"/>{chat.publishedToday?'Готово':chat.availableNow?'Опубліковано':'Все одно опублікувати'}</Button>}
            {queue==='archived'?<Button variant="outline" onClick={()=>act(chat,'restore')} disabled={busy===chat.id}><RotateCcw data-icon="inline-start"/>Відновити</Button>:<Button variant="ghost" size="icon" onClick={()=>setArchiveId(archiveId===chat.id?null:chat.id)} aria-label="Перенести в архів"><Archive/></Button>}
          </div>
          {archiveId===chat.id&&<div className="archive-reasons"><span>Чому в архів?</span>{['Забанено','Чат не існує','Чат не цільовий'].map(reason=><button key={reason} onClick={()=>act(chat,'archive',{reason})}>{reason}</button>)}</div>}
        </article>)}
      </div>:<div className="workspace-empty"><MessageSquareEmpty/><strong>У цій черзі нічого немає</strong><p>Зміни платформу, чергу або очисть пошук.</p></div>}
      {!loading&&data&&data.total>50&&<div className="chat-pagination"><Button variant="outline" size="sm" disabled={offset===0} onClick={()=>setOffset(Math.max(0,offset-50))}><ChevronLeft data-icon="inline-start"/>Назад</Button><span>{offset+1}–{Math.min(offset+50,data.total)} із {data.total}</span><Button variant="outline" size="sm" disabled={offset+50>=data.total} onClick={()=>setOffset(offset+50)}>Далі<ChevronRight data-icon="inline-end"/></Button></div>}
    </section>
  </div>;
}

function TodayLinks({title,items}:{title:string;items:LinkItem[]}) {
  async function copy(names:boolean) {
    const lines=items.flatMap((item,index)=>[`${names&&item.name?`${item.name} — `:''}${item.link||''}`, ...((index+1)%5===0&&index<items.length-1?['']:[])]);
    await navigator.clipboard.writeText(lines.join('\n'));
  }
  return <div><div><span>{title}</span><strong>{items.length}</strong></div><div className="today-link-actions"><Button variant="outline" size="sm" onClick={()=>copy(false)} disabled={!items.length}><Copy data-icon="inline-start"/>Посилання</Button><Button variant="outline" size="sm" onClick={()=>copy(true)} disabled={!items.length}>Назва + посилання</Button></div></div>;
}

function MessageSquareEmpty(){ return <Send aria-hidden="true"/>; }
function formatDateTime(value:number){return new Intl.DateTimeFormat('uk-UA',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit',timeZone:'Europe/Kyiv'}).format(new Date(value*1000));}
