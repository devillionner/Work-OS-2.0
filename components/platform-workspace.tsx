'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createRefreshGate } from '@/lib/refresh-gate';
import { createActionGate } from '@/lib/action-gate';
import { ChatBulkDialog } from '@/components/chat-bulk-dialog';
import { ChatDuplicatesDialog } from '@/components/chat-duplicates-dialog';
import { ChatDiscoveryDialog } from '@/components/chat-discovery-dialog';
import { ChatProfileDialog } from '@/components/chat-profile-dialog';
import { ChatHistoryDialog } from '@/components/chat-history-dialog';
import { ChatPublishDialog } from '@/components/chat-publish-dialog';
import { TelegramSchedule } from '@/components/telegram-schedule';
import { CHAT_PLATFORM_NAMES, type ChatPlatform } from '@/lib/chats/bulk-input';
import type { BulkResult } from '@/lib/chats/bulk';
import type { ChatProfile } from '@/lib/chats/profile';
import { supportsChatLeaveChecklist } from '@/lib/chats/leave-policy';
import { shouldSuggestChatArchive } from '@/lib/chats/snooze-history';
import { Archive, Check, ChevronLeft, ChevronRight, Clock3, ExternalLink, History, Plus, RotateCcw, Search, Send, Settings2, Trash2, Undo2, UserRoundCheck, X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { handleTabKeyNavigation } from '@/lib/tab-navigation';
import { announceDataChange } from '@/lib/client-sync';
import { PlatformOverview, type PlatformLinkItem as LinkItem, type PublicationPace } from '@/components/platform-overview';
import { WorkspaceInitialLoading } from '@/components/workspace-load-state';

type Platform = 'telegram' | 'whatsapp' | 'viber' | 'facebook';
type Queue = 'to_join' | 'waiting' | 'ready' | 'archived';
type ProfileFilter = 'all' | 'needs_review';
type Chat = { id:string; name:string; link:string; platform:Platform; status:Queue; archiveReason:string|null; archivedAt:number|null; profileConfirmed:boolean; profile:ChatProfile; publishedToday:boolean; joinedAt:number|null; snoozedUntil:number|null; snoozeCount:number; leftAt:number|null; availableAt:number|null; availableNow:boolean; telegramAccountId:string|null; stateToken:string; discoveryDecision:'review'|'target'|'rejected'|'unavailable'|null };
type ProfileCounts = { confirmed:number; draft:number; empty:number; needsReview:number };
type PublicationState = { chatId:string; chatPublishedToday:boolean; publishedToday:LinkItem[]; availableToday:LinkItem[]; publicationPace:PublicationPace };
type ResponseData = { chats:Chat[]; total:number; offset:number; counts:Record<string,number>; profileCounts:Record<string,ProfileCounts>; accountId:string|null; joinedToday:LinkItem[]; publishedToday:LinkItem[]; availableToday:LinkItem[]; publicationPace:PublicationPace; requestKey?:string };
type UndoSpec = { action:'restore'|'unsnooze'|'undo_published'; label:string };
type UndoState = UndoSpec & { chat:Chat; expiresAt:number };
type ChatActionResult = { ok:true } | { ok:false; error:string; refresh:boolean };
type TelegramAccount = { id:string; number:number; name:string; enabled:boolean; selected:boolean; joinStreak:number; joinBatchSize:number; breakMinutes:number; breakUntil:number|null };
type PlatformConfirmation = { kind:'assign'; chat:Chat; nextId:string; currentName:string; nextName:string } | { kind:'return'; chat:Chat };

const platforms: Array<{key:Platform;label:string;color:string}> = [
  {key:'telegram',label:'Telegram',color:'#2563eb'}, {key:'whatsapp',label:'WhatsApp',color:'#16a34a'},
  {key:'viber',label:'Viber',color:'#7c3aed'}, {key:'facebook',label:'Facebook',color:'#1877f2'},
];
const MOBILE_LIST_CHUNK = 12;
const queues: Array<{key:Queue;label:string}> = [
  {key:'to_join',label:'Для приєднання'}, {key:'waiting',label:'Очікування'},
  {key:'ready',label:'Для публікації'}, {key:'archived',label:'Архів'},
];

export function PlatformWorkspace({ enabledPlatforms, syncRevision, businessDate }: { enabledPlatforms?: string[]; syncRevision?: number; businessDate?: string }) {
  const [platform,setPlatform] = useState<Platform>('telegram');
  const [queue,setQueue] = useState<Queue>('to_join');
  const [search,setSearch] = useState('');
  const [profileFilter,setProfileFilter] = useState<ProfileFilter>('all');
  const [mobileListState,setMobileListState] = useState({key:'',count:MOBILE_LIST_CHUNK});
  const [loadedData,setData] = useState<ResponseData|null>(null);
  const viewCache=useRef(new Map<string,ResponseData>());
  const prefetching=useRef(new Set<string>());
  const cacheEpoch=useRef(0);
  const [undo,setUndo] = useState<UndoState|null>(null);
  const [bulkOpen,setBulkOpen]=useState(false);
  const [discoveryOpen,setDiscoveryOpen]=useState(false);
  const [duplicatesOpen,setDuplicatesOpen]=useState(false);
  const [notice,setNotice]=useState('');
  const [profileChat,setProfileChat]=useState<Chat|null>(null);
  const [profileOpenKey,setProfileOpenKey]=useState(0);
  const profileTrigger=useRef<HTMLButtonElement|null>(null);
  const [historyChat,setHistoryChat]=useState<Chat|null>(null);
  const [historyOpenKey,setHistoryOpenKey]=useState(0);
  const historyTrigger=useRef<HTMLButtonElement|null>(null);
  const [publishChat,setPublishChat]=useState<Chat|null>(null);
  const [publishOpenKey,setPublishOpenKey]=useState(0);
  const publishTrigger=useRef<HTMLButtonElement|null>(null);
  const [quickPublishMode,setQuickPublishMode]=useState(false);
  const [quickAdvertisementId,setQuickAdvertisementId]=useState<string|null>(null);
  const [loading,setLoading] = useState(true);
  const [busy,setBusy] = useState<string|null>(null);
  const runAction=useRef(createActionGate());
  const activeLoad=useRef<AbortController|null>(null);
  const loadNumber=useRef(0);
  const reloadChats=useRef<(silent?:boolean) => Promise<void>>(async()=>{});
  const hasLoadedData=useRef(false);
  const lastSyncKey=useRef(`${syncRevision ?? ''}:${businessDate ?? ''}`);
  const cancelLoad=useCallback(()=>{ activeLoad.current?.abort(); loadNumber.current++; },[]);
  const [error,setError] = useState('');
  const [archiveId,setArchiveId] = useState<string|null>(null);
  const [customArchiveReason,setCustomArchiveReason] = useState('');
  const [offset,setOffset] = useState(0);
  const [accounts,setAccounts] = useState<TelegramAccount[]>([]);
  const [accountId,setAccountId] = useState<string|null>(null);
  const [manageAccounts,setManageAccounts] = useState(false);
  const [newAccountName,setNewAccountName] = useState('');
  const [clock,setClock] = useState(()=>Date.now());
  const [scheduleRefreshKey,setScheduleRefreshKey] = useState(0);
  const [confirmation,setConfirmation] = useState<PlatformConfirmation|null>(null);
  const [deleteChat,setDeleteChat] = useState<Chat|null>(null);
  const [lastOpenedByPlatform,setLastOpenedByPlatform] = useState<Record<string,string|null>>({});
  const restoredView=useRef(false);
  const restoreScroll=useRef<number|null>(null);
  const refreshExpiredBreak=useRef(createRefreshGate(120_000));
  const availablePlatforms = useMemo(() => platforms.filter((item) => !enabledPlatforms || enabledPlatforms.includes(item.key)), [enabledPlatforms]);
  const requestAccountId=platform==='telegram'?accountId:null;
  const requestKey=`${platform}:${queue}:${search}:${profileFilter}:${offset}:${requestAccountId||''}`;
  const cachedData=viewCache.current.get(requestKey)||null;
  const data=loadedData?.requestKey===requestKey?loadedData:cachedData;
  const switchingList=data===null&&loadedData!==null&&loadedData.requestKey!==requestKey;
  const filterKey=`${platform}:${queue}:${search}:${profileFilter}`;
  const mobileListKey=`${filterKey}:${offset}:${requestAccountId||''}`;
  const mobileVisibleChats=mobileListState.key===mobileListKey?mobileListState.count:MOBILE_LIST_CHUNK;
  const previousFilter=useRef(filterKey);

  useEffect(()=>{
    if(availablePlatforms.some((item)=>item.key===platform)||!availablePlatforms[0])return;
    const next=availablePlatforms[0].key;
    // Reconcile persisted navigation after settings change; cancel stale work
    // if the operator switches platforms before this callback runs.
    const timer=setTimeout(()=>{
      setPlatform(next);setQueue('to_join');setSearch('');setProfileFilter('all');setOffset(0);
      setQuickPublishMode(false);setQuickAdvertisementId(null);
      previousFilter.current=`${next}:to_join::all`;writeLastPlatform(next);
    },0);
    return()=>clearTimeout(timer);
  },[availablePlatforms,platform]);

  useEffect(()=>{
    if(previousFilter.current===filterKey)return;
    previousFilter.current=filterKey;
    setOffset(0);
  },[filterKey]);

  useEffect(()=>{
    if(restoredView.current||!availablePlatforms.length)return;
    restoredView.current=true;
    const savedPlatform=readLastPlatform();
    const target=availablePlatforms.some(item=>item.key===savedPlatform)?savedPlatform as Platform:platform;
    const saved=readPlatformView(target);
    queueMicrotask(()=>{
      if(target!==platform)setPlatform(target);
      if(saved){setQueue(saved.queue);setSearch(saved.search);setProfileFilter('all');setOffset(saved.offset);previousFilter.current=`${target}:${saved.queue}:${saved.search}:all`;restoreScroll.current=saved.scrollY;setLastOpenedByPlatform(current=>({...current,[target]:saved.lastChatId}));}
    });
  },[availablePlatforms,platform]);

  useEffect(()=>{
    if(loading||!data||restoreScroll.current===null)return;
    const scrollY=restoreScroll.current; restoreScroll.current=null;
    requestAnimationFrame(()=>window.scrollTo({top:scrollY,behavior:'auto'}));
  },[loading,data]);

  const loadAccounts=useCallback(async()=>{
    const response=await fetch('/api/telegram-accounts',{cache:'no-store'});
    const body=await response.json() as {accounts?:TelegramAccount[];error?:string};
    if(!response.ok) throw new Error(body.error||'Не вдалося завантажити Telegram-акаунти.');
    const next=body.accounts||[];
    setAccounts(next);
    setAccountId(current=>next.some(item=>item.id===current&&item.enabled)?current:(next.find(item=>item.selected&&item.enabled)||next.find(item=>item.enabled))?.id||null);
  },[]);

  useEffect(()=>{if(platform!=='telegram')return;const timer=setTimeout(()=>void loadAccounts().catch(reason=>setError(reason instanceof Error?reason.message:'Не вдалося завантажити акаунти.')),0);return()=>clearTimeout(timer);},[loadAccounts,platform]);
  useEffect(()=>{const timer=setInterval(()=>setClock(Date.now()),1000);return()=>clearInterval(timer);},[]);
  useEffect(()=>{void refreshExpiredBreak.current(clock,document.visibilityState==='visible'&&navigator.onLine&&activeBreakExpired(accounts,accountId,clock),loadAccounts).catch(()=>{});},[accounts,accountId,clock,loadAccounts]);

  const invalidateQueueCache=useCallback((target?:Platform)=>{
    cacheEpoch.current++;
    if(!target){viewCache.current.clear();return;}
    const prefix=`${target}:`;
    for(const key of viewCache.current.keys())if(key.startsWith(prefix))viewCache.current.delete(key);
  },[]);

  const load = useCallback(async (silent=false) => {
    activeLoad.current?.abort();
    const controller=new AbortController(); activeLoad.current=controller;
    const requestNumber=++loadNumber.current;
    const cached=viewCache.current.get(requestKey)||null;
    if(!silent&&!cached) setLoading(true);
    else if(!silent) setLoading(false);
    setError('');
    try {
      const params = new URLSearchParams({platform,status:queue,search,offset:String(offset),profile:profileFilter});
      if(requestAccountId) params.set('account',requestAccountId);
      const response = await fetch(`/api/chats?${params}`,{cache:'no-store',signal:controller.signal});
      const body = await response.json() as ResponseData & {error?:string};
      if(controller.signal.aborted || requestNumber!==loadNumber.current) return;
      if(!response.ok) throw new Error(body.error || 'Не вдалося завантажити чати.');
      const next={...body,requestKey};
      viewCache.current.set(requestKey,next);setData(next);hasLoadedData.current=true;
      if(!search&&profileFilter==='all'&&offset===0){
        const epoch=cacheEpoch.current;
        for(const item of queues){
          if(item.key===queue)continue;
          const nextKey=`${platform}:${item.key}::all:0:${requestAccountId||''}`;
          if(viewCache.current.has(nextKey)||prefetching.current.has(nextKey))continue;
          prefetching.current.add(nextKey);
          const nextParams=new URLSearchParams({platform,status:item.key,search:'',offset:'0',profile:'all'});
          if(requestAccountId)nextParams.set('account',requestAccountId);
          void fetch(`/api/chats?${nextParams}`,{cache:'no-store'}).then(async nextResponse=>{
            const nextBody=await nextResponse.json() as ResponseData & {error?:string};
            if(nextResponse.ok&&epoch===cacheEpoch.current)viewCache.current.set(nextKey,{...nextBody,requestKey:nextKey});
          }).catch(()=>{}).finally(()=>prefetching.current.delete(nextKey));
        }
      }
    } catch (reason) { if(!controller.signal.aborted && requestNumber===loadNumber.current) setError(reason instanceof Error ? reason.message : 'Не вдалося завантажити чати.'); }
    finally { if(!silent&&!controller.signal.aborted && requestNumber===loadNumber.current) setLoading(false); }
  },[platform,queue,search,profileFilter,offset,requestAccountId,requestKey]);

  useEffect(() => { reloadChats.current=load; const timer=setTimeout(()=>void load(false),search ? 250 : 0); return () => { clearTimeout(timer); cancelLoad(); }; },[load,search,cancelLoad]);

  useEffect(()=>{
    const nextSyncKey=`${syncRevision ?? ''}:${businessDate ?? ''}`;
    const previous=lastSyncKey.current;
    lastSyncKey.current=nextSyncKey;
    if(previous===nextSyncKey||!hasLoadedData.current)return;
    invalidateQueueCache();
    void reloadChats.current(true);
    if(platform==='telegram') queueMicrotask(()=>void loadAccounts().catch(()=>{}));
  },[syncRevision,businessDate,platform,loadAccounts,invalidateQueueCache]);

  useEffect(()=>{if(!notice)return;const delay=undo?Math.max(0,undo.expiresAt-Date.now()):8000;const timer=setTimeout(()=>{setNotice('');setUndo(null);},delay);return()=>clearTimeout(timer);},[notice,undo]);

  function addedChats(result:BulkResult) {
    invalidateQueueCache();
    const target=availablePlatforms.find(item=>(result.counts[item.key]||0)>0)?.key||platform;
    setQuickPublishMode(false); setQuickAdvertisementId(null);
    setNotice(`Додано ${result.added} чатів: ${Object.entries(result.counts).map(([key,count])=>`${CHAT_PLATFORM_NAMES[key as ChatPlatform]} — ${count}`).join(', ')}.`);
    const changesFilter=target!==platform||queue!=='to_join'||search!==''||offset!==0;
    setPlatform(target);setQueue('to_join');setSearch('');setProfileFilter('all');setOffset(0);
    if(!changesFilter) void reloadChats.current(true);
  }

  function savedProfile() {
    invalidateQueueCache(platform);
    setProfileChat(null); void reloadChats.current(true);
  }

  function importedDiscoveryChat(nextPlatform:'whatsapp'|'viber') {
    invalidateQueueCache(nextPlatform);
    const changesFilter=nextPlatform!==platform||queue!=='to_join'||search!==''||offset!==0;
    setQuickPublishMode(false); setQuickAdvertisementId(null);
    setNotice('Новий чат із пошуку додано в чергу «Для приєднання».');
    setPlatform(nextPlatform);setQueue('to_join');setSearch('');setProfileFilter('all');setOffset(0);
    if(!changesFilter) void reloadChats.current(true);
  }

  function selectPlatform(next:Platform) {
    if(next===platform)return;
    writePlatformView(platform,{queue,search,offset,scrollY:window.scrollY,lastChatId:lastOpenedByPlatform[platform]||null});
    const saved=readPlatformView(next);
    setQuickPublishMode(false); setQuickAdvertisementId(null);
    setPlatform(next); setQueue(saved?.queue||'to_join'); setSearch(saved?.search||''); setProfileFilter('all'); setOffset(saved?.offset||0);
    previousFilter.current=`${next}:${saved?.queue||'to_join'}:${saved?.search||''}:all`;
    setLastOpenedByPlatform(current=>({...current,[next]:saved?.lastChatId||null})); restoreScroll.current=saved?.scrollY??null;
    writeLastPlatform(next);
  }

  function openChat(chat:Chat) {
    setLastOpenedByPlatform(current=>({...current,[chat.platform]:chat.id}));
    writePlatformView(chat.platform,{queue,search,offset,scrollY:window.scrollY,lastChatId:chat.id});
    writeLastPlatform(chat.platform);
    openNativeChat(chat.platform,chat.link);
  }

  async function act(chat:Chat, action:string, extra:Record<string,unknown>={}, undoSpec?:UndoSpec): Promise<ChatActionResult> {
    let result:ChatActionResult={ok:false,error:'Інша дія вже виконується. Спробуйте ще раз після її завершення.',refresh:false};
    const accepted=await runAction.current(async()=>{
    setBusy(chat.id); setError(''); setNotice(''); setUndo(null);
    try {
      const response=await fetch('/api/chats',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:chat.id,action,stateToken:chat.stateToken,accountId:chat.platform==='telegram'?(chat.telegramAccountId||accountId):null,...extra})});
      const body=await response.json() as {error?:string;refresh?:boolean;availableAt?:number;stateToken?:string;snoozedUntil?:number|null;leftAt?:number|null;undoExpiresAt?:number;publicationState?:PublicationState};
      if(!response.ok) {
        const error=body.error || 'Не вдалося виконати дію.';
        if(response.status===409) await reloadChats.current(true);
        result={ok:false,error,refresh:body.refresh===true};
        if(action!=='published') setError(error);
        return;
      }
      if(undoSpec&&typeof body.stateToken==='string') {
        const expiresAt=typeof body.undoExpiresAt==='number'?body.undoExpiresAt*1000:Date.now()+8000;
        if(expiresAt>Date.now()) setUndo({chat:{...chat,stateToken:body.stateToken,snoozedUntil:body.snoozedUntil??chat.snoozedUntil},expiresAt,...undoSpec});
      }
      if((action==='published'||action==='undo_published')&&body.publicationState) {
        const publicationState=body.publicationState;
        setData(current=>{
          if(!current||current.requestKey!==requestKey)return current;
          const chats=current.chats.map(item=>item.id===publicationState.chatId
            ? {...item,publishedToday:publicationState.chatPublishedToday,stateToken:body.stateToken||item.stateToken}
            : item);
          if(queue==='ready') chats.sort((left,right)=>Number(left.publishedToday)-Number(right.publishedToday));
          return {...current,chats,publishedToday:publicationState.publishedToday,availableToday:publicationState.availableToday,publicationPace:publicationState.publicationPace};
        });
      }
      invalidateQueueCache(chat.platform);
      announceDataChange('all');
      setArchiveId(null); setCustomArchiveReason('');
      if(action==='published'||action==='undo_published') void reloadChats.current(true);
      else await reloadChats.current(true);
      if(undoSpec&&typeof body.stateToken==='string'&&(!body.undoExpiresAt||body.undoExpiresAt*1000>Date.now())) setNotice(undoSpec.label);
      if(chat.platform==='telegram') await loadAccounts();
      if(action==='published') {
        setNotice(undoSpec&&typeof body.stateToken==='string'&&(!body.undoExpiresAt||body.undoExpiresAt*1000>Date.now())
          ? 'Публікацію відмічено. Якщо це помилка, скасуйте її зараз; наступний доступний чат лишився перед очима.'
          : 'Публікацію відмічено. Чат переміщено нижче завершених на сьогодні, щоб наступний доступний лишався перед очима.');
      }
      if((action==='published'||action==='undo_published')&&chat.platform==='telegram') setScheduleRefreshKey(value=>value+1);
      result={ok:true};
    } catch(reason) {
      const error=reason instanceof Error ? reason.message : 'Не вдалося виконати дію.';
      const publicationAction=action==='published'||action==='undo_published';
      if(publicationAction) {
        // The server may have committed even if the response was lost. Re-read
        // canonical state before the operator can retry, so a timeout cannot
        // leave stale counters or encourage a duplicate manual action.
        await reloadChats.current(true);
        announceDataChange('all');
      }
      result={ok:false,error,refresh:publicationAction};
      if(action!=='published') setError(error);
    }
    finally { setBusy(null); }
    });
    return accepted?result:{ok:false,error:'Інша дія вже виконується. Спробуйте ще раз після її завершення.',refresh:false};
  }

  async function undoLast() {
    const item=undo;
    if(!item||busy!==null)return;
    if((await act(item.chat,item.action)).ok) setNotice('Дію скасовано.');
  }

  function toggleArchive(id:string) {
    setError('');
    setArchiveId(current=>{const next=current===id?null:id;if(next) setCustomArchiveReason('');return next;});
  }

  function assignAccount(chat:Chat,nextId:string) {
    if(busy!==null||nextId===chat.telegramAccountId)return;
    const currentName=accounts.find(item=>item.id===chat.telegramAccountId)?.name||'поточного акаунта';
    const nextName=accounts.find(item=>item.id===nextId)?.name||'іншого акаунта';
    setConfirmation({kind:'assign',chat,nextId,currentName,nextName});
  }
  function confirmPlatformAction() {
    const item=confirmation;if(!item)return;
    setConfirmation(null);
    if(item.kind==='assign') void act(item.chat,'assign_account',{accountId:item.nextId});
    else void act(item.chat,'return_to_join');
  }

  async function accountAction(action:string,id?:string,extra:Record<string,unknown>={}) {
    await runAction.current(async()=>{
    setBusy(id||'accounts'); setError('');
    try {
      const response=await fetch('/api/telegram-accounts',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,id,...extra})});
      const body=await response.json() as {error?:string;id?:string};
      if(!response.ok) throw new Error(body.error||'Не вдалося оновити акаунт.');
      if(action==='select'&&id) {
        // Account selection changes the chat request key. Do not invoke the stale
        // reload callback captured for the previous account; the load effect will
        // fetch the newly selected account after state reconciliation.
        setAccountId(id);
        await loadAccounts();
      } else {
        if(action==='create') setNewAccountName('');
        await loadAccounts();
        await reloadChats.current(true);
      }
    } catch(reason) { setError(reason instanceof Error?reason.message:'Не вдалося оновити акаунт.'); }
    finally { setBusy(null); }
    });
  }

  const selected = useMemo(() => platforms.find(item=>item.key===platform)!,[platform]);
  const activeAccount=accounts.find(item=>item.id===accountId);
  const profileSummary=data?.profileCounts[queue];
  const breakSeconds=activeAccount?.breakUntil?Math.max(0,activeAccount.breakUntil-Math.floor(clock/1000)):0;
  const publishQuickMode=quickPublishMode&&(publishChat?.platform==='whatsapp'||publishChat?.platform==='viber');
  const archiveChat=archiveId?data?.chats.find(chat=>chat.id===archiveId)||null:null;
  return <div className="platform-workspace" aria-busy={loading}>
    <ConfirmDialog open={confirmation!==null} title={confirmation?.kind==='assign'?'Перепризначити Telegram-акаунт?':'Повернути чат до приєднання?'} description={confirmation?.kind==='assign'?`Чат перейде з «${confirmation.currentName}» на «${confirmation.nextName}». Членство в самому Telegram потрібно змінити вручну.`:'Чат повернеться в чергу «Для приєднання». Історія чату не видаляється.'} confirmLabel={confirmation?.kind==='assign'?'Перепризначити':'Повернути'} busy={busy!==null} onCancel={()=>setConfirmation(null)} onConfirm={confirmPlatformAction}/>
    <ConfirmDialog open={deleteChat!==null} title="Остаточно видалити чат?" description={deleteChat?`«${deleteChat.name}» більше не блокуватиме повторне додавання. Дію не можна скасувати; вона доступна лише для неіснуючого чату без публікацій, лідів або активного розкладу.`:''} confirmLabel="Видалити назавжди" destructive busy={busy!==null} onCancel={()=>setDeleteChat(null)} onConfirm={()=>{const chat=deleteChat;setDeleteChat(null);if(chat)void act(chat,'permanent_delete',{confirmation:'PERMANENTLY_DELETE_NONEXISTENT_CHAT'});}}/>
    <Dialog open={archiveChat!==null} onOpenChange={(next)=>{if(!next&&busy===null){setArchiveId(null);setCustomArchiveReason('');setError('');}}}>
      <DialogContent className="archive-dialog" showCloseButton={false}>
        <DialogHeader><DialogTitle>Перенести чат в архів?</DialogTitle><DialogDescription>{archiveChat?`«${archiveChat.name}». Оберіть причину — чат зникне з поточної черги, але його можна буде відновити з «Архіву».`:'Оберіть причину архівації.'}</DialogDescription></DialogHeader>
        <fieldset className="archive-dialog-reasons">
          <legend className="sr-only">Причина архівації</legend>
          {['Забанено','Чат не існує','Чат не цільовий'].map(reason=><Button type="button" variant="outline" disabled={busy!==null} key={reason} onClick={()=>{if(archiveChat)void act(archiveChat,'archive',{reason},{action:'restore',label:'Архівацію можна скасувати протягом 8 секунд.'});}}>{reason}</Button>)}
        </fieldset>
        <div className="archive-dialog-custom"><Input value={customArchiveReason} maxLength={100} disabled={busy!==null} aria-label="Власна причина архівації" placeholder="Інша причина" onChange={event=>setCustomArchiveReason(event.target.value)}/><Button disabled={busy!==null||!customArchiveReason.trim()} onClick={()=>{const reason=customArchiveReason.trim();if(archiveChat&&reason)void act(archiveChat,'archive',{reason},{action:'restore',label:'Архівацію можна скасувати протягом 8 секунд.'});}}>Архівувати</Button></div>
        {error&&<p className="archive-dialog-error" role="alert">{error}</p>}
        <DialogFooter><Button type="button" variant="outline" disabled={busy!==null} onClick={()=>{setArchiveId(null);setCustomArchiveReason('');setError('');}}>Скасувати</Button></DialogFooter>
      </DialogContent>
    </Dialog>
    <ChatBulkDialog open={bulkOpen} onClose={()=>setBulkOpen(false)} onAdded={addedChats} enabledPlatforms={enabledPlatforms}/>
    <ChatDiscoveryDialog open={discoveryOpen} onClose={()=>setDiscoveryOpen(false)} onImported={importedDiscoveryChat}/>
    <ChatDuplicatesDialog open={duplicatesOpen} onClose={()=>setDuplicatesOpen(false)}/>
    <ChatProfileDialog key={profileOpenKey} open={profileChat!==null} chat={profileChat} onClose={()=>setProfileChat(null)} onSaved={savedProfile} onOpenChat={()=>{if(profileChat)openChat(profileChat);}} finalFocus={()=>profileTrigger.current}/>
    <ChatHistoryDialog key={historyOpenKey} open={historyChat!==null} chat={historyChat} onClose={()=>setHistoryChat(null)} finalFocus={()=>historyTrigger.current}/>
    <ChatPublishDialog key={publishOpenKey} open={publishChat!==null} chat={publishChat} onClose={()=>setPublishChat(null)} onPublished={async({advertisementId,language})=>{if(!publishChat)return false;const quick=quickPublishMode&&(publishChat.platform==='whatsapp'||publishChat.platform==='viber');const result=await act(publishChat,'published',{advertisementId,language,quick},{action:'undo_published',label:'Публікацію можна скасувати протягом 8 секунд.'});if(!result.ok){if(result.refresh){setPublishChat(null);setNotice(`${result.error} Список уже оновлено — відкрийте актуальний чат повторно.`);return false;}throw new Error(result.error);}if(quick&&advertisementId&&!quickAdvertisementId){setQuickAdvertisementId(advertisementId);setNotice('Матеріал швидкого режиму зафіксовано. Публікацію можна скасувати кнопкою поруч; матеріал серії залишиться обраним.');}return true;}} onOpenChat={()=>{if(publishChat)openChat(publishChat);}} finalFocus={()=>publishTrigger.current} quickMode={publishQuickMode} preferredAdvertisementId={quickAdvertisementId}/>
    {notice&&<output className="reports-notice"><span>{notice}</span>{undo&&<Button type="button" variant="outline" size="sm" disabled={busy!==null} onClick={()=>void undoLast()}>Скасувати</Button>}</output>}
    <section className="platform-header">
      <div className="platform-header-main">
        <div><p className="eyebrow">Робочі платформи</p><h2>Платформи</h2><p>Черги чатів, приєднання та підтверджені публікації — без зайвих проміжних екранів.</p></div>
        <div className="platform-header-actions">
          <Button variant="outline" disabled={busy!==null} onClick={()=>setDiscoveryOpen(true)}><Search data-icon="inline-start"/>Знайти чати</Button>
          <Button disabled={busy!==null} onClick={()=>setBulkOpen(true)}><Plus data-icon="inline-start"/>Додати чати</Button>
        </div>
      </div>
      <div className="platform-picker" role="tablist" aria-label="Платформа">
        {availablePlatforms.map(item=><button type="button" key={item.key} role="tab" aria-selected={platform===item.key} tabIndex={platform===item.key?0:-1} onKeyDown={handleTabKeyNavigation} onClick={()=>selectPlatform(item.key)}><i style={{background:item.color}} />{item.label}</button>)}
      </div>
    </section>

    {platform==='telegram'&&<section className="telegram-accounts" aria-label="Telegram-акаунти">
      <div className="telegram-account-tabs">
        <span>Робочий акаунт</span>
        {accounts.filter(item=>item.enabled).map(account=><button disabled={busy!==null} type="button" aria-pressed={account.id===accountId} key={account.id} onClick={()=>accountAction('select',account.id)}>{account.name}<small>#{account.number}</small></button>)}
        <Button variant="outline" size="sm" onClick={()=>setManageAccounts(value=>!value)}><Settings2 data-icon="inline-start"/>Керувати</Button>
      </div>
      {activeAccount&&<div className={`telegram-break ${activeAccount.joinStreak>=activeAccount.joinBatchSize?'is-due':''}`}>
        <div><strong>{breakSeconds?`Перерва ${formatDuration(breakSeconds)}`:`Приєднано ${activeAccount.joinStreak} із ${activeAccount.joinBatchSize}`}</strong><span>{breakSeconds?'Лічильник обнулиться автоматично після завершення.':activeAccount.joinStreak>=activeAccount.joinBatchSize?'Рекомендовано зробити перерву перед наступними приєднаннями.':'До рекомендованої перерви.'}</span></div>
        <div className="telegram-break-settings"><label>Після <select disabled={busy!==null} value={activeAccount.joinBatchSize} onChange={event=>accountAction('settings',activeAccount.id,{joinBatchSize:Number(event.target.value),breakMinutes:activeAccount.breakMinutes})}>{[3,5,7,10].map(value=><option value={value} key={value}>{value} чатів</option>)}</select></label><label>На <select disabled={busy!==null} value={activeAccount.breakMinutes} onChange={event=>accountAction('settings',activeAccount.id,{joinBatchSize:activeAccount.joinBatchSize,breakMinutes:Number(event.target.value)})}>{[5,10,15,20,30].map(value=><option value={value} key={value}>{value} хв</option>)}</select></label></div>
        {!breakSeconds&&activeAccount.joinStreak>=activeAccount.joinBatchSize&&<Button disabled={busy!==null} size="sm" onClick={()=>accountAction('start_break',activeAccount.id,{minutes:activeAccount.breakMinutes})}>Почати {activeAccount.breakMinutes} хв</Button>}
      </div>}
      {manageAccounts&&<div className="telegram-account-manager">
        {accounts.map(account=><div className="telegram-account-editor" key={account.id}><span>#{account.number}</span><Input disabled={busy!==null} defaultValue={account.name} aria-label={`Назва акаунта ${account.number}`} onBlur={event=>{const name=event.target.value.trim();if(name&&name!==account.name)void accountAction('rename',account.id,{name})}}/><Button disabled={busy!==null} variant="outline" size="sm" onClick={()=>accountAction('toggle',account.id)}>{account.enabled?'Вимкнути':'Увімкнути'}</Button></div>)}
        <div className="telegram-account-create"><Input value={newAccountName} onChange={event=>setNewAccountName(event.target.value)} placeholder="Назва нового акаунта" aria-label="Назва нового Telegram-акаунта"/><Button disabled={busy!==null} onClick={()=>accountAction('create',undefined,{name:newAccountName})}><Plus data-icon="inline-start"/>Додати</Button></div>
        <p>Вимкнення не видаляє історію. Чати можна перепризначити іншим акаунтам нижче.</p>
      </div>}
    </section>}

    {platform==='telegram'&&accountId&&<TelegramSchedule accountId={accountId} refreshKey={scheduleRefreshKey} />}

    {data&&<PlatformOverview pace={data.publicationPace} available={queue==='ready'?data.availableToday:undefined} joined={data.joinedToday} published={data.publishedToday}/>}

    <section className="platform-browser">
      <div className="queue-tabs" role="tablist" aria-label="Черга чатів">
        {queues.map(item=><button type="button" key={item.key} role="tab" aria-selected={queue===item.key} tabIndex={queue===item.key?0:-1} onKeyDown={handleTabKeyNavigation} onClick={()=>{if(item.key!=='ready'){setQuickPublishMode(false);setQuickAdvertisementId(null);}setQueue(item.key);setOffset(0)}}>{item.label}<span>{data?.counts[item.key] || 0}</span></button>)}
      </div>
      {queue==='ready'&&(platform==='whatsapp'||platform==='viber')&&<div className={`platform-queue-context ${quickPublishMode?'is-active':''}`}>
        <div><strong>{quickPublishMode?'Швидкий режим увімкнено':'Швидкий режим'}</strong><span>{quickPublishMode?(quickAdvertisementId?'Матеріал серії вже зафіксовано. Підтверджуйте тільки фактично зроблені публікації.':'Оберіть матеріал у першому чаті — далі він лишатиметься для серії.'):'Один матеріал для серії чатів, із ручним підтвердженням кожної фактичної публікації.'}</span></div>
        <Button type="button" size="sm" variant={quickPublishMode?'outline':'default'} disabled={busy!==null} onClick={()=>{setQuickPublishMode(value=>{const next=!value;if(!next)setQuickAdvertisementId(null);return next;});}}><Send data-icon="inline-start"/>{quickPublishMode?'Завершити':'Увімкнути'}</Button>
      </div>}
      <div className="chat-toolbar">
        <label htmlFor="chat-search"><Search/><Input id="chat-search" value={search} onChange={event=>setSearch(event.target.value)} placeholder="Пошук за назвою або посиланням"/><span className="sr-only">Пошук чатів</span></label>
        {(queue==='waiting'||queue==='ready')&&<><Button type="button" variant="outline" size="sm" title={profileSummary?`Підтверджені: ${profileSummary.confirmed}; чернетки: ${profileSummary.draft}; без профілю: ${profileSummary.empty}`:'Фільтр профілів'} aria-pressed={profileFilter==='needs_review'} onClick={()=>{setProfileFilter(value=>value==='all'?'needs_review':'all');setOffset(0);}}><UserRoundCheck data-icon="inline-start"/>{profileFilter==='needs_review'?`Усі профілі (${data?.counts[queue]||0})`:`Потребують правил (${profileSummary?.needsReview||0})`}</Button>{profileSummary&&<span className="profile-counts" aria-label={`Профілі: підтверджені ${profileSummary.confirmed}, чернетки ${profileSummary.draft}, без профілю ${profileSummary.empty}`}>✓ {profileSummary.confirmed} · чернетки {profileSummary.draft} · без профілю {profileSummary.empty}</span>}</>}
        <Button type="button" variant="outline" size="sm" disabled={busy!==null||platform==='telegram'&&!accountId} onClick={()=>setDuplicatesOpen(true)}>Дублікати</Button>
      </div>
      {error && <div className="workspace-error" role="alert">{error} <Button variant="outline" size="sm" disabled={loading||busy!==null} onClick={()=>void reloadChats.current()}>Оновити список</Button></div>}
      {!data&&(loading||switchingList) ? <WorkspaceInitialLoading compact label={`Завантажуємо ${selected.label}…`}/> : data?.chats.length ? <>
        <div className="chat-list">
        {data.chats.map((chat,index)=><article className={`chat-row ${chat.publishedToday?'is-published':''} ${lastOpenedByPlatform[platform]===chat.id?'is-last-opened':''} ${index>=mobileVisibleChats?'mobile-progressive-hidden':''}`} key={chat.id}>
          <div className="chat-main"><div className="chat-name-line"><strong>{chat.name}</strong>{lastOpenedByPlatform[platform]===chat.id&&<Badge variant="outline">Останній відкритий</Badge>}{!chat.profileConfirmed&&queue==='ready'&&<Badge variant="outline">Профіль пізніше</Badge>}{queue==='ready'&&chat.discoveryDecision&&chat.discoveryDecision!=='target'&&<Badge variant="outline">Потрібна кваліфікація</Badge>}{chat.publishedToday&&<Badge variant="secondary">Опубліковано сьогодні</Badge>}</div><button className="chat-native-link" type="button" title={chat.link} aria-label={`Відкрити ${selected.label}: ${chat.link}`} onClick={()=>openChat(chat)}>{compactChatLink(chat.link)}</button>{chat.archiveReason&&<small>Причина: {chat.archiveReason}</small>}{queue==='archived'&&chat.archivedAt&&<small>Архівовано {formatDateTime(chat.archivedAt)}</small>}{queue==='archived'&&supportsChatLeaveChecklist(platform)&&chat.joinedAt!==null&&<small>{chat.leftAt?`Вихід із чату підтверджено ${formatDateTime(chat.leftAt)}`:'Ще потрібно вручну вийти з чату й підтвердити це тут.'}</small>}{chat.snoozedUntil&&chat.snoozedUntil>clock/1000&&<small>Відкладено до {formatDateTime(chat.snoozedUntil)}</small>}{(queue==='waiting'||queue==='ready')&&shouldSuggestChatArchive(chat.snoozeCount)&&<div><small>Відкладали {chat.snoozeCount} рази. Якщо чат уже неактуальний, краще перенести його в архів.</small><Button type="button" variant="outline" size="sm" disabled={busy!==null} onClick={()=>toggleArchive(chat.id)}><Archive data-icon="inline-start"/>Архівувати</Button></div>}{queue==='ready'&&!canPublish(chat,clock)&&(chat.discoveryDecision&&chat.discoveryDecision!=='target'
  ? <small className="wait-note"><Clock3/>Публікація заблокована до завершення кваліфікації чату.</small>
  : <small className="wait-note"><Clock3/>Публікація буде доступна {formatDateTime(chat.availableAt!)}</small>)}</div>
          <div className="chat-actions">
            {platform==='telegram'&&queue!=='to_join'&&<select disabled={busy!==null} className="chat-account-select" value={chat.telegramAccountId||''} onChange={event=>assignAccount(chat,event.target.value)} aria-label="Telegram-акаунт чату">{accounts.filter(item=>item.enabled||item.id===chat.telegramAccountId).map(account=><option value={account.id} key={account.id}>{account.name} · #{account.number}</option>)}</select>}
            {queue==='to_join'&&<><Button size="icon" onClick={()=>act(chat,'joined')} disabled={busy!==null} aria-label="Успішно приєднано"><Check/></Button>{(platform==='telegram'||platform==='whatsapp')&&<Button variant="outline" size="icon" onClick={()=>act(chat,'waiting')} disabled={busy!==null} aria-label="Очікуємо запрошення"><Clock3/></Button>}<Button variant="outline" size="icon" onClick={()=>act(chat,'failed',{reason:'Не вдалося приєднатися'},{action:'restore',label:'Невдале приєднання можна скасувати протягом 8 секунд.'})} disabled={busy!==null} aria-label="Не вдалося приєднатися"><X/></Button></>}
            {queue==='waiting'&&<Button onClick={()=>act(chat,'approved')} disabled={busy!==null}><UserRoundCheck data-icon="inline-start"/>Прийняли</Button>}
            {queue==='ready'&&<>{!chat.publishedToday&&<Button onClick={(event)=>{publishTrigger.current=event.currentTarget;setPublishChat(chat);setPublishOpenKey(value=>value+1);}} disabled={busy!==null||!canPublish(chat,clock)}><Send data-icon="inline-start"/>{readyActionLabel(chat,clock)}</Button>}{platform==='whatsapp'&&<Button variant="outline" size="icon" onClick={()=>setConfirmation({kind:'return',chat})} disabled={busy!==null} aria-label="Повернути для приєднання"><Undo2/></Button>}</>}
            {(queue==='waiting'||queue==='ready')&&<Button variant="outline" onClick={(event)=>{profileTrigger.current=event.currentTarget;setProfileChat(chat);setProfileOpenKey(value=>value+1);}} disabled={busy!==null}><UserRoundCheck data-icon="inline-start"/>Профіль</Button>}
            {(queue==='waiting'||queue==='ready')&&<Button variant="outline" title={isSnoozed(chat,clock)?'Скасувати відкладення':'Відкласти на 3 календарні дні'} onClick={()=>{const snoozed=isSnoozed(chat,clock);return act(chat,snoozed?'unsnooze':'snooze',{},snoozed?undefined:{action:'unsnooze',label:'Відкладення можна скасувати протягом 8 секунд.'});}} disabled={busy!==null||chat.publishedToday}>{isSnoozed(chat,clock)?'Повернути зараз':'+3 дні'}</Button>}
            {queue==='archived'&&supportsChatLeaveChecklist(platform)&&chat.joinedAt!==null&&<Button variant="outline" onClick={()=>act(chat,chat.leftAt?'undo_leave':'confirm_leave')} disabled={busy!==null}>{chat.leftAt?<><Undo2 data-icon="inline-start"/>Скасувати вихід</>:<><Check data-icon="inline-start"/>Я вийшов</>}</Button>}
            {queue==='archived'&&<><Button variant="outline" onClick={()=>act(chat,'restore')} disabled={busy!==null}><RotateCcw data-icon="inline-start"/>Відновити</Button>{canPermanentlyDelete(chat)&&<Button variant="outline" onClick={()=>setDeleteChat(chat)} disabled={busy!==null}><Trash2 data-icon="inline-start"/>Видалити назавжди</Button>}</>}
            <div className="chat-action-utilities">
              <Button variant="outline" size="icon" type="button" onClick={()=>openChat(chat)} aria-label={`Відкрити чат у ${selected.label}`}><ExternalLink/></Button>
              <Button variant="ghost" size="icon" type="button" aria-label="Історія чату" title="Історія чату" onClick={(event)=>{historyTrigger.current=event.currentTarget;setHistoryChat(chat);setHistoryOpenKey(value=>value+1);}} disabled={busy!==null}><History/></Button>
              {queue!=='archived'&&<Button variant="ghost" size="icon" onClick={()=>toggleArchive(chat.id)} aria-label="Перенести в архів"><Archive/></Button>}
            </div>
          </div>
        </article>)}
        </div>
        {data.chats.length>mobileVisibleChats&&<div className="mobile-list-more"><Button type="button" variant="outline" onClick={()=>setMobileListState({key:mobileListKey,count:Math.min(mobileVisibleChats+MOBILE_LIST_CHUNK,data.chats.length)})}>Показати ще чати</Button></div>}
      </>:<div className="workspace-empty"><MessageSquareEmpty/><strong>У цій черзі нічого немає</strong><p>Зміни платформу, чергу або очисть пошук.</p></div>}
      {!loading&&data&&data.total>50&&<div className="chat-pagination"><Button variant="outline" size="sm" disabled={offset===0} onClick={()=>setOffset(Math.max(0,offset-50))}><ChevronLeft data-icon="inline-start"/>Назад</Button><span>{offset+1}–{Math.min(offset+50,data.total)} із {data.total}</span><Button variant="outline" size="sm" disabled={offset+50>=data.total} onClick={()=>setOffset(offset+50)}>Далі<ChevronRight data-icon="inline-end"/></Button></div>}
    </section>
  </div>;
}

function compactChatLink(link:string) {
  try {
    const url=new URL(link);
    const token=[...url.pathname.split('/').filter(Boolean),url.searchParams.get('g2')||''].filter(Boolean).at(-1)||'';
    const tail=token.length>12?`…${token.slice(-12)}`:token;
    return tail?`${url.hostname} · ${tail}`:url.hostname;
  } catch {
    return 'Посилання на чат';
  }
}

function readyActionLabel(chat:Chat,clock:number) {
  if(chat.discoveryDecision&&chat.discoveryDecision!=='target')return 'Кваліфікація';
  if(canPublish(chat,clock))return 'Підготувати';
  if(isSnoozed(chat,clock))return 'Відкладено';
  return 'Очікування 6 год';
}

function MessageSquareEmpty(){ return <Send aria-hidden="true"/>; }
type SavedPlatformView = { queue:Queue; search:string; offset:number; scrollY:number; lastChatId:string|null };
const platformViewPrefix='work-os:platform-view:';
const lastPlatformKey='work-os:last-platform';
function readPlatformView(platform:Platform):SavedPlatformView|null {
  if(typeof window==='undefined')return null;
  try {
    const value=JSON.parse(window.sessionStorage.getItem(`${platformViewPrefix}${platform}`)||'null') as Partial<SavedPlatformView>|null;
    const offset=value?.offset; const scrollY=value?.scrollY;
    if(!value||!queues.some(item=>item.key===value.queue)||typeof value.search!=='string'||typeof offset!=='number'||!Number.isInteger(offset)||offset<0||typeof scrollY!=='number'||!Number.isFinite(scrollY)||scrollY<0)return null;
    return {queue:value.queue as Queue,search:value.search.slice(0,150),offset:Math.min(offset,1_000_000),scrollY:Math.min(scrollY,10_000_000),lastChatId:typeof value.lastChatId==='string'?value.lastChatId.slice(0,100):null};
  } catch { return null; }
}
function writePlatformView(platform:Platform,value:SavedPlatformView) { try { window.sessionStorage.setItem(`${platformViewPrefix}${platform}`,JSON.stringify(value)); } catch {} }
function readLastPlatform():string|null { try { const value=window.sessionStorage.getItem(lastPlatformKey); return platforms.some(item=>item.key===value)?value:null; } catch { return null; } }
function writeLastPlatform(platform:Platform) { try { window.sessionStorage.setItem(lastPlatformKey,platform); } catch {} }
function formatDateTime(value:number){return new Intl.DateTimeFormat('uk-UA',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit',timeZone:'Europe/Kyiv'}).format(new Date(value*1000));}
function formatDuration(seconds:number){return `${String(Math.floor(seconds/60)).padStart(2,'0')}:${String(seconds%60).padStart(2,'0')}`;}
function activeBreakExpired(accounts:TelegramAccount[],accountId:string|null,clock:number){const account=accounts.find(item=>item.id===accountId);return Boolean(account?.breakUntil&&account.breakUntil*1000<=clock);}
function canPermanentlyDelete(chat:Chat){return chat.status==='archived'&&chat.archiveReason==='Чат не існує'&&(!supportsChatLeaveChecklist(chat.platform)||chat.joinedAt===null||chat.leftAt!==null);}

function openNativeChat(platform:Platform, link:string) {
  if(platform==='whatsapp') {
    let url:URL;
    try { url=new URL(link.trim()); } catch { return; }
    const host=url.hostname.toLowerCase().replace(/^www\./,'');
    if(url.protocol==='https:'&&host==='chat.whatsapp.com') {
      window.open(url.toString(),'_blank','noopener,noreferrer');
    }
    return;
  }
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

function canPublish(chat:Chat, clock:number){return chat.status==='ready'&&(!chat.discoveryDecision||chat.discoveryDecision==='target')&&(chat.availableAt===null||chat.availableAt<=clock/1000);}
function isSnoozed(chat:Chat, clock:number){return chat.snoozedUntil!==null&&chat.snoozedUntil>clock/1000;}
