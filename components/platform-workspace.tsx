'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createRefreshGate } from '@/lib/refresh-gate';
import { useRouter } from 'next/navigation';
import { Archive, Check, ChevronLeft, ChevronRight, Clock3, Copy, ExternalLink, LoaderCircle, Plus, RotateCcw, Search, Send, Settings2, Undo2, UserRoundCheck, X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

type Platform = 'telegram' | 'whatsapp' | 'viber' | 'facebook';
type Queue = 'to_join' | 'waiting' | 'ready' | 'archived';
type Chat = { id:string; name:string; link:string; platform:Platform; status:Queue; archiveReason:string|null; profileConfirmed:boolean; publishedToday:boolean; snoozedUntil:number|null; availableAt:number|null; availableNow:boolean; telegramAccountId:string|null };
type LinkItem = { name?:string; link?:string };
type ResponseData = { chats:Chat[]; total:number; offset:number; counts:Record<string,number>; accountId:string|null; joinedToday:LinkItem[]; publishedToday:LinkItem[] };
type TelegramAccount = { id:string; number:number; name:string; enabled:boolean; selected:boolean; joinStreak:number; joinBatchSize:number; breakMinutes:number; breakUntil:number|null };

const platforms: Array<{key:Platform;label:string;color:string}> = [
  {key:'telegram',label:'Telegram',color:'#2563eb'}, {key:'whatsapp',label:'WhatsApp',color:'#16a34a'},
  {key:'viber',label:'Viber',color:'#7c3aed'}, {key:'facebook',label:'Facebook',color:'#1877f2'},
];
const queues: Array<{key:Queue;label:string}> = [
  {key:'to_join',label:'Для приєднання'}, {key:'waiting',label:'Очікування'},
  {key:'ready',label:'Для публікації'}, {key:'archived',label:'Архів'},
];

export function PlatformWorkspace({ enabledPlatforms }: { enabledPlatforms?: string[] }) {
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
  const [accounts,setAccounts] = useState<TelegramAccount[]>([]);
  const [accountId,setAccountId] = useState<string|null>(null);
  const [manageAccounts,setManageAccounts] = useState(false);
  const [newAccountName,setNewAccountName] = useState('');
  const [clock,setClock] = useState(()=>Date.now());
  const refreshExpiredBreak=useRef(createRefreshGate(120_000));
  const availablePlatforms = useMemo(() => platforms.filter((item) => !enabledPlatforms || enabledPlatforms.includes(item.key)), [enabledPlatforms]);
  if (!availablePlatforms.some((item) => item.key === platform) && availablePlatforms[0]) { setPlatform(availablePlatforms[0].key); setQueue('to_join'); setOffset(0); }
  const filterKey=`${platform}:${queue}:${search}`;
  const [previousFilter,setPreviousFilter]=useState(filterKey);
  if(previousFilter!==filterKey){setPreviousFilter(filterKey);setOffset(0);}

  const loadAccounts=useCallback(async()=>{
    const response=await fetch('/api/telegram-accounts',{cache:'no-store'});
    const body=await response.json() as {accounts?:TelegramAccount[];error?:string};
    if(!response.ok) throw new Error(body.error||'Не вдалося завантажити Telegram-акаунти.');
    const next=body.accounts||[];
    setAccounts(next);
    setAccountId(current=>next.some(item=>item.id===current&&item.enabled)?current:(next.find(item=>item.selected&&item.enabled)||next.find(item=>item.enabled))?.id||null);
  },[]);

  useEffect(()=>{const timer=setTimeout(()=>void loadAccounts().catch(reason=>setError(reason instanceof Error?reason.message:'Не вдалося завантажити акаунти.')),0);return()=>clearTimeout(timer);},[loadAccounts]);
  useEffect(()=>{const timer=setInterval(()=>setClock(Date.now()),1000);return()=>clearInterval(timer);},[]);
  useEffect(()=>{void refreshExpiredBreak.current(clock,document.visibilityState==='visible'&&navigator.onLine&&activeBreakExpired(accounts,accountId,clock),loadAccounts).catch(()=>{});},[accounts,accountId,clock,loadAccounts]);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const params = new URLSearchParams({platform,status:queue,search,offset:String(offset)});
      if(platform==='telegram'&&accountId) params.set('account',accountId);
      const response = await fetch(`/api/chats?${params}`,{cache:'no-store'});
      const body = await response.json() as ResponseData & {error?:string};
      if(!response.ok) throw new Error(body.error || 'Не вдалося завантажити чати.');
      setData(body);
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Не вдалося завантажити чати.'); }
    finally { setLoading(false); }
  },[platform,queue,search,offset,accountId]);

  useEffect(() => { const timer=setTimeout(load,search ? 250 : 0); return () => clearTimeout(timer); },[load,search]);

  async function act(chat:Chat, action:string, extra:Record<string,unknown>={}) {
    setBusy(chat.id); setError('');
    try {
      const response=await fetch('/api/chats',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:chat.id,action,accountId:platform==='telegram'?accountId:null,...extra})});
      const body=await response.json() as {error?:string;availableAt?:number};
      if(!response.ok) throw new Error(body.error || 'Не вдалося виконати дію.');
      setArchiveId(null); await load(); router.refresh();
    } catch(reason) { setError(reason instanceof Error ? reason.message : 'Не вдалося виконати дію.'); }
    finally { setBusy(null); }
  }

  function assignAccount(chat:Chat,nextId:string) {
    if(nextId===chat.telegramAccountId)return;
    const current=accounts.find(item=>item.id===chat.telegramAccountId)?.name||'поточного акаунта';
    const next=accounts.find(item=>item.id===nextId)?.name||'іншого акаунта';
    if(window.confirm(`Перепризначити чат з «${current}» на «${next}»?\n\nУ самому Telegram членство потрібно змінити вручну.`)) void act(chat,'assign_account',{accountId:nextId});
  }

  async function accountAction(action:string,id?:string,extra:Record<string,unknown>={}) {
    setBusy(id||'accounts'); setError('');
    try {
      const response=await fetch('/api/telegram-accounts',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,id,...extra})});
      const body=await response.json() as {error?:string;id?:string};
      if(!response.ok) throw new Error(body.error||'Не вдалося оновити акаунт.');
      if(action==='select'&&id) setAccountId(id);
      if(action==='create') setNewAccountName('');
      await loadAccounts(); await load();
    } catch(reason) { setError(reason instanceof Error?reason.message:'Не вдалося оновити акаунт.'); }
    finally { setBusy(null); }
  }

  const selected = useMemo(() => platforms.find(item=>item.key===platform)!,[platform]);
  const activeAccount=accounts.find(item=>item.id===accountId);
  const breakSeconds=activeAccount?.breakUntil?Math.max(0,activeAccount.breakUntil-Math.floor(clock/1000)):0;
  return <div className="platform-workspace">
    <section className="platform-hero">
      <div><p className="eyebrow">Робочі платформи</p><h2>Чати без зайвих переходів</h2><p>Приєднуйся, перевіряй очікування та відмічай публікації в одному стабільному процесі.</p></div>
      <div className="platform-picker" role="tablist" aria-label="Платформа">
        {availablePlatforms.map(item=><button key={item.key} role="tab" aria-selected={platform===item.key} onClick={()=>{setPlatform(item.key);setQueue('to_join');setOffset(0)}}><i style={{background:item.color}} />{item.label}</button>)}
      </div>
    </section>

    {platform==='telegram'&&<section className="telegram-accounts" aria-label="Telegram-акаунти">
      <div className="telegram-account-tabs">
        <span>Робочий акаунт</span>
        {accounts.filter(item=>item.enabled).map(account=><button type="button" aria-pressed={account.id===accountId} key={account.id} onClick={()=>accountAction('select',account.id)}>{account.name}<small>#{account.number}</small></button>)}
        <Button variant="outline" size="sm" onClick={()=>setManageAccounts(value=>!value)}><Settings2 data-icon="inline-start"/>Керувати</Button>
      </div>
      {activeAccount&&<div className={`telegram-break ${activeAccount.joinStreak>=activeAccount.joinBatchSize?'is-due':''}`}>
        <div><strong>{breakSeconds?`Перерва ${formatDuration(breakSeconds)}`:`Приєднано ${activeAccount.joinStreak} із ${activeAccount.joinBatchSize}`}</strong><span>{breakSeconds?'Лічильник обнулиться автоматично після завершення.':activeAccount.joinStreak>=activeAccount.joinBatchSize?'Рекомендовано зробити перерву перед наступними приєднаннями.':'До рекомендованої перерви.'}</span></div>
        <div className="telegram-break-settings"><label>Після <select value={activeAccount.joinBatchSize} onChange={event=>accountAction('settings',activeAccount.id,{joinBatchSize:Number(event.target.value),breakMinutes:activeAccount.breakMinutes})}>{[3,5,7,10].map(value=><option value={value} key={value}>{value} чатів</option>)}</select></label><label>На <select value={activeAccount.breakMinutes} onChange={event=>accountAction('settings',activeAccount.id,{joinBatchSize:activeAccount.joinBatchSize,breakMinutes:Number(event.target.value)})}>{[5,10,15,20,30].map(value=><option value={value} key={value}>{value} хв</option>)}</select></label></div>
        {!breakSeconds&&activeAccount.joinStreak>=activeAccount.joinBatchSize&&<Button size="sm" onClick={()=>accountAction('start_break',activeAccount.id,{minutes:activeAccount.breakMinutes})}>Почати {activeAccount.breakMinutes} хв</Button>}
      </div>}
      {manageAccounts&&<div className="telegram-account-manager">
        {accounts.map(account=><div className="telegram-account-editor" key={account.id}><span>#{account.number}</span><Input defaultValue={account.name} aria-label={`Назва акаунта ${account.number}`} onBlur={event=>{const name=event.target.value.trim();if(name&&name!==account.name)void accountAction('rename',account.id,{name})}}/><Button variant="outline" size="sm" onClick={()=>accountAction('toggle',account.id)}>{account.enabled?'Вимкнути':'Увімкнути'}</Button></div>)}
        <div className="telegram-account-create"><Input value={newAccountName} onChange={event=>setNewAccountName(event.target.value)} placeholder="Назва нового акаунта"/><Button onClick={()=>accountAction('create',undefined,{name:newAccountName})}><Plus data-icon="inline-start"/>Додати</Button></div>
        <p>Вимкнення не видаляє історію. Чати можна перепризначити іншим акаунтам нижче.</p>
      </div>}
    </section>}

    <section className="today-links">
      <TodayLinks title="Приєднано сьогодні" items={data?.joinedToday || []} />
      <TodayLinks title="Опубліковано сьогодні" items={data?.publishedToday || []} />
    </section>

    <section className="platform-browser">
      <div className="queue-tabs" role="tablist" aria-label="Черга чатів">
        {queues.map(item=><button key={item.key} role="tab" aria-selected={queue===item.key} onClick={()=>{setQueue(item.key);setOffset(0)}}>{item.label}<span>{data?.counts[item.key] || 0}</span></button>)}
      </div>
      <div className="chat-toolbar">
        <label htmlFor="chat-search"><Search/><Input id="chat-search" value={search} onChange={event=>setSearch(event.target.value)} placeholder="Пошук за назвою або посиланням"/><span className="sr-only">Пошук чатів</span></label>
        <Badge variant="secondary">{data?.total || 0} у черзі</Badge>
      </div>
      {error && <div className="workspace-error">{error}</div>}
      {loading ? <div className="workspace-loading"><LoaderCircle/>Завантажуємо {selected.label}…</div> : data?.chats.length ? <div className="chat-list">
        {data.chats.map(chat=><article className="chat-row" key={chat.id}>
          <div className="chat-main"><div className="chat-name-line"><strong>{chat.name}</strong>{!chat.profileConfirmed&&queue==='ready'&&<Badge variant="outline">Профіль пізніше</Badge>}{chat.publishedToday&&<Badge variant="secondary">Опубліковано сьогодні</Badge>}</div><button className="chat-native-link" type="button" onClick={()=>openNativeChat(chat.platform,chat.link)}>{chat.link}</button>{chat.archiveReason&&<small>Причина: {chat.archiveReason}</small>}{chat.snoozedUntil&&chat.snoozedUntil>clock/1000&&<small>Відкладено до {formatDateTime(chat.snoozedUntil)}</small>}{queue==='ready'&&!chat.availableNow&&<small className="wait-note"><Clock3/>Telegram буде доступний {formatDateTime(chat.availableAt!)}</small>}</div>
          <div className="chat-actions">
            {platform==='telegram'&&queue!=='to_join'&&<select className="chat-account-select" value={chat.telegramAccountId||''} onChange={event=>assignAccount(chat,event.target.value)} aria-label="Telegram-акаунт чату">{accounts.filter(item=>item.enabled||item.id===chat.telegramAccountId).map(account=><option value={account.id} key={account.id}>{account.name} · #{account.number}</option>)}</select>}
            <Button variant="outline" size="icon" type="button" onClick={()=>openNativeChat(chat.platform,chat.link)} aria-label={`Відкрити чат у ${selected.label}`}><ExternalLink/></Button>
            {queue==='to_join'&&<><Button size="icon" onClick={()=>act(chat,'joined')} disabled={busy===chat.id} aria-label="Успішно приєднано"><Check/></Button>{(platform==='telegram'||platform==='whatsapp')&&<Button variant="outline" size="icon" onClick={()=>act(chat,'waiting')} disabled={busy===chat.id} aria-label="Очікуємо запрошення"><Clock3/></Button>}<Button variant="outline" size="icon" onClick={()=>act(chat,'failed',{reason:'Не вдалося приєднатися'})} disabled={busy===chat.id} aria-label="Не вдалося приєднатися"><X/></Button></>}
            {queue==='waiting'&&<><Button onClick={()=>act(chat,'approved')} disabled={busy===chat.id}><UserRoundCheck data-icon="inline-start"/>Прийняли</Button><Button variant="outline" onClick={()=>act(chat,'snooze')} disabled={busy===chat.id}>+3 дні</Button></>}
            {queue==='ready'&&<><Button onClick={()=>act(chat,'published')} disabled={busy===chat.id||chat.publishedToday||!chat.availableNow}><Send data-icon="inline-start"/>{chat.publishedToday?'Готово':chat.availableNow?'Опубліковано':'Очікування 6 год'}</Button>{platform==='whatsapp'&&<Button variant="outline" size="icon" onClick={()=>window.confirm('Повернути цей чат у «Для приєднання»?')&&act(chat,'return_to_join')} disabled={busy===chat.id} aria-label="Повернути для приєднання"><Undo2/></Button>}</>}
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
function formatDuration(seconds:number){return `${String(Math.floor(seconds/60)).padStart(2,'0')}:${String(seconds%60).padStart(2,'0')}`;}
function activeBreakExpired(accounts:TelegramAccount[],accountId:string|null,clock:number){const account=accounts.find(item=>item.id===accountId);return Boolean(account?.breakUntil&&account.breakUntil*1000<=clock);}

function openNativeChat(platform:Platform, link:string) {
  const nativeLink=nativeChatLink(platform,link);
  if(nativeLink) window.location.assign(nativeLink);
}

function nativeChatLink(platform:Platform, link:string) {
  let url:URL;
  try { url=new URL(link.trim()); } catch { return ''; }
  const host=url.hostname.toLowerCase().replace(/^www\./,'');
  const parts=url.pathname.split('/').filter(Boolean);
  if(platform==='telegram'&&['t.me','telegram.me','telegram.dog'].includes(host)) {
    if(parts[0]?.startsWith('+')) return `tg://join?invite=${encodeURIComponent(parts[0].slice(1))}`;
    if(parts[0]?.toLowerCase()==='joinchat'&&parts[1]) return `tg://join?invite=${encodeURIComponent(parts[1])}`;
    return parts[0] ? `tg://resolve?domain=${encodeURIComponent(parts[0])}` : '';
  }
  if(platform==='whatsapp'&&host==='chat.whatsapp.com') {
    const code=parts[0]?.toLowerCase()==='invite'?parts[1]:parts[0];
    return code ? `whatsapp://chat?code=${encodeURIComponent(safeDecode(code))}` : '';
  }
  if(platform==='viber'&&['invite.viber.com','chats.viber.com'].includes(host)) {
    const token=/[?&]g2=([^&#]+)/i.exec(link)?.[1];
    return token ? `viber://community_invite?data=${encodeURIComponent(safeDecode(token))}` : '';
  }
  if(platform==='facebook'&&['facebook.com','m.facebook.com','fb.com'].includes(host)) {
    return `fb://facewebmodal/f?href=${encodeURIComponent(url.toString())}`;
  }
  return '';
}

function safeDecode(value:string) {
  try { return decodeURIComponent(value); } catch { return value; }
}
