'use client';

import { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, ExternalLink, Search, Square } from 'lucide-react';
import { Panel } from '@/components/shell/panel';
import { Button } from '@/components/ui/button';
import { Chip } from '@/components/ui/chip';
import { Ghost } from '@/components/ui/ghost';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Surface } from '@/components/ui/surface';
import type { DiscoveryCandidate, DiscoveryDecision } from '@/lib/chat-discovery/domain';
import type { DiscoveryPlatform } from '@/lib/chat-discovery/public-web';
import type { LocalDiscoveryPreview } from '@/lib/chat-discovery/local-preview';
import { EMPTY_RUN, NON_TARGET_STATES, SOURCE_TARGET_QUEUE, canResume, queuedCount, runTargetCount, type DiscoveryRunState } from '@/lib/chat-discovery/run-state';
import { subscribeLiveMessages, subscribeLiveStatus } from '@/lib/live-channel';
import { cn } from '@/lib/utils';

type Workspace = {
  candidates: DiscoveryCandidate[];
  error?: string;
};
type ImportResponse = { chatId?: string; existing?: boolean; workflowStatus?: string; error?: string };
// The run lives in the owner Durable Object since 2026-10-04 (lib/chat-discovery/run-state.ts): this tab
// only shows it and sends commands, so closing the tab no longer stops it and every device sees it.
type LocalPreviewSession = DiscoveryRunState;
type SearchPreviewResponse={
  source:'telegram'|'public_web'|'idle';
  telegramCursor:number;
  sourceCursor:number;
  done:boolean;
  previews:LocalDiscoveryPreview[];
  batch:{searched:number;added:number;duplicates:number;errors:number};
};
type ManualInspectionDraft = {
  candidateId: string;
  memberCount: string;
  activityState: 'unknown' | 'active' | 'dead';
  canWrite: 'unknown' | 'yes' | 'no';
  adsPolicy: 'unknown' | 'operator_confirmed' | 'forbidden';
  topicMatch: 'unknown' | 'match' | 'mismatch';
  membershipState: 'not_checked' | 'pending' | 'joined';
  chatType: 'unknown' | 'group' | 'community' | 'channel';
};
// Three working lists of the local session plus the persisted Work OS history (loaded only on demand).
type DecisionFilter = 'active' | 'target' | 'rejected' | 'history';

const ARCHIVE_CHUNK=100;
// Fallback refresh of the run while the live channel is down and the dialog is open.
const RUN_FALLBACK_POLL_MS=15_000;

export function DiscoveryPanel({
  open,
  onClose,
  onImported,
}: {
  open: boolean;
  onClose: () => void;
  onImported: (platform: DiscoveryPlatform) => void;
}) {
  const [workspace, setWorkspace] = useState<Workspace>({ candidates: [] });
  const [workspaceLoadedAt, setWorkspaceLoadedAt] = useState(0);
  const platforms: DiscoveryPlatform[] = ['whatsapp'];
  // null = no operator override yet: the field follows the current/paused run's own goal. Set only by the
  // operator editing the field, and cleared once a fresh run actually starts with it (see below).
  const [goalOverride, setGoalOverride] = useState<number | null>(null);
  const minMembers = 700;
  const [filter, setFilter] = useState<DecisionFilter>('active');
  const [loading, setLoading] = useState(false);
  const [importingId, setImportingId] = useState<string | null>(null);
  const [inspectingId, setInspectingId] = useState<string | null>(null);
  const [manualDraft, setManualDraft] = useState<ManualInspectionDraft | null>(null);
  const [telegramBusy, setTelegramBusy] = useState(false);
  const [pausing,setPausing]=useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [localPreview,setLocalPreview]=useState<LocalPreviewSession>(EMPTY_RUN);
  const goal=goalOverride??(localPreview.goal||50);
  const [runnerConnected,setRunnerConnected]=useState<boolean|null>(null);
  const [sourceActivity,setSourceActivity]=useState<string|null>(null);
  const [whatsappBlockedUntil,setWhatsappBlockedUntil]=useState(0);
  const [liveConnected,setLiveConnected]=useState(false);
  // The persisted Work OS history is a D1 read: it is loaded only when the operator opens «Історія».
  const load = useCallback(async (options: { silent?: boolean } = {}) => {
    const silent=options.silent===true;
    if(!silent){
      setLoading(true);
      setError('');
    }
    try {
      const params = new URLSearchParams({ limit: '60' });
      const response = await fetch(`/api/chat-discovery?${params}`, { cache: 'no-store' });
      const body = await response.json() as Workspace;
      if (!response.ok) throw new Error(body.error || 'Не вдалося завантажити пошук чатів.');
      setWorkspace(body);
      setWorkspaceLoadedAt(Date.now());
      return body;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Не вдалося завантажити пошук чатів.');
      return null;
    } finally {
      if(!silent)setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open || filter !== 'history') return;
    const timer = setTimeout(() => { void load(); }, 0);
    return () => clearTimeout(timer);
  }, [open, filter, load]);

  const loadRun=useCallback(async()=>{
    try{
      const response=await fetch('/api/chat-discovery/run',{cache:'no-store'});
      const body=await response.json() as {run?:LocalPreviewSession;runnerConnected?:boolean;discoverySourceActivity?:string|null;discoveryRunCandidatesBlockedUntil?:number;error?:string};
      if(!response.ok||!body.run)return;
      setLocalPreview(body.run);
      setRunnerConnected(body.runnerConnected===true);
      setSourceActivity(body.discoverySourceActivity||null);
      setWhatsappBlockedUntil(Number(body.discoveryRunCandidatesBlockedUntil)||0);
    }catch{}
  },[]);

  // The owner DO pushes a signal for every run change; the dialog re-reads the run (DO storage, no D1).
  useEffect(()=>{
    if(!open)return;
    const initial=setTimeout(()=>void loadRun(),0);
    let timer:ReturnType<typeof setTimeout>|null=null;
    const offMessages=subscribeLiveMessages(message=>{
      if(message.type==='runner_status'&&typeof message.connected==='boolean')setRunnerConnected(message.connected);
      if(message.type!=='process_state'||message.process!=='discovery_run')return;
      if(timer!==null)clearTimeout(timer);
      timer=setTimeout(()=>{timer=null;void loadRun();},300);
    });
    const offStatus=subscribeLiveStatus(status=>{
      setLiveConnected(status.connected);
      if(status.runnerConnected!==null)setRunnerConnected(status.runnerConnected);
    });
    return()=>{clearTimeout(initial);offMessages();offStatus();if(timer!==null)clearTimeout(timer);};
  },[open,loadRun]);

  useEffect(()=>{
    if(!open||liveConnected||!localPreview.running)return;
    const timer=window.setInterval(()=>void loadRun(),RUN_FALLBACK_POLL_MS);
    return()=>window.clearInterval(timer);
  },[open,liveConnected,localPreview.running,loadRun]);

  const runTargets=runTargetCount(localPreview);

  async function postRun(body:Record<string,unknown>){
    const response=await fetch('/api/chat-discovery/run',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    const payload=await response.json().catch(()=>({})) as {run?:LocalPreviewSession;runnerConnected?:boolean;discoverySourceActivity?:string|null;discoveryRunCandidatesBlockedUntil?:number;error?:string};
    if(!response.ok||!payload.run)throw new Error(payload.error||'Не вдалося змінити автопошук.');
    setLocalPreview(payload.run);
    setRunnerConnected(payload.runnerConnected===true);
    setSourceActivity(payload.discoverySourceActivity||null);
    setWhatsappBlockedUntil(Number(payload.discoveryRunCandidatesBlockedUntil)||0);
    return payload.run;
  }

  async function post(body: Record<string, unknown>) {
    const response = await fetch('/api/chat-discovery', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const payload = await response.json() as Record<string, unknown> & { error?: string };
    if (!response.ok) throw new Error(payload.error || 'Операцію пошуку не завершено.');
    return payload;
  }

  async function postPreview(body:Record<string,unknown>){
    const attempts=body.action==='search'?3:1;
    let lastError='Локальний preview пошуку не завершено.';
    for(let attempt=1;attempt<=attempts;attempt+=1){
      try{
        const response=await fetch('/api/chat-discovery/preview',{
          method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),
        });
        const raw=await response.text();
        let payload:Record<string,unknown>&{error?:string};
        try{
          payload=raw?JSON.parse(raw) as Record<string,unknown>&{error?:string}:{};
        }catch{
          lastError=`Preview API повернув не-JSON відповідь (HTTP ${response.status}).`;
          if(attempt<attempts){
            await new Promise(resolve=>window.setTimeout(resolve,750*attempt));
            continue;
          }
          throw new Error(lastError);
        }
        if(!response.ok){
          lastError=typeof payload.error==='string'&&payload.error?payload.error:`Preview API HTTP ${response.status}.`;
          if(body.action==='search'&&attempt<attempts&&response.status>=500){
            await new Promise(resolve=>window.setTimeout(resolve,750*attempt));
            continue;
          }
          throw new Error(lastError);
        }
        return payload;
      }catch(reason){
        lastError=reason instanceof Error?reason.message:lastError;
        if(body.action==='search'&&attempt<attempts){
          await new Promise(resolve=>window.setTimeout(resolve,750*attempt));
          continue;
        }
        throw new Error(lastError);
      }
    }
    throw new Error(lastError);
  }

  // A changed goal means the operator wants a fresh run, not a continuation of the paused one — even
  // though the button still reads «Продовжити» until they touch the field (see the sync effect above).
  const willResume=canResume(localPreview,Date.now())&&goal===localPreview.goal;

  async function startAutonomousSearch() {
    if(telegramBusy)return;
    setError('');
    setNotice('');
    setTelegramBusy(true);
    try{
      if(willResume){
        const replaying=localPreview.completionReason==='sources_exhausted';
        const resumed=await postRun({action:'resume'});
        setFilter('active');
        setNotice(replaying
          ?'Пошук за тим самим планом запущено знову. Чати, перевірені менше тижня тому, пропускаються — у списку з’являться лише нові запрошення.'
          :resumed.completionReason===null&&localPreview.completionReason==='source_error'
          ?'Продовжуємо з кроку, на якому зупинились.'
          :`Продовжуємо з кроку ${resumed.telegramCursor}. Уже перевірені запрошення й переглянуті Telegram-групи не повторюються.`);
        return;
      }
      await postRun({action:'start',goal});
      setFilter('active');
      setGoalOverride(null);
    }catch(reason){setError(reason instanceof Error?reason.message:'Не вдалося запустити автопошук.');}
    finally{setTelegramBusy(false);}
  }

  async function stopAutonomousSearch(){
    if(telegramBusy)return;
    setPausing(true);
    try{
      await postRun({action:'pause'});
      setNotice('Пошук зупинено. Неперевірені чати збережено в черзі; завершені результати не повторюються.');
    }catch(reason){setError(reason instanceof Error?reason.message:'Не вдалося зберегти паузу.');}
    finally{setPausing(false);}
  }

  async function retryIncompleteCandidate(candidate:DiscoveryCandidate){
    if(localPreview.running||telegramBusy)return;
    try{
      await postRun({action:'retry',candidateId:candidate.id});
      setNotice('Кандидат повернуто в чергу. Натисни «Продовжити автопошук». Уже приєднаний чат перевірятиметься без повторного вступу.');
    }catch(reason){setError(reason instanceof Error?reason.message:'Не вдалося відновити кандидата.');}
  }

  // «Архівувати всі»: the only way non-target results reach D1 — one request per 100 chats, one D1 batch each.
  async function archiveAllNonTargets(){
    const items=localPreview.candidates.filter(candidate=>NON_TARGET_STATES.has(String(candidate.preflightState)));
    if(telegramBusy||!items.length)return;
    setTelegramBusy(true);
    setError('');
    setNotice('');
    const archived=new Set<string>();
    try{
      for(let index=0;index<items.length;index+=ARCHIVE_CHUNK){
        const chunk=items.slice(index,index+ARCHIVE_CHUNK);
        await postPreview({action:'archive-outcomes',items:chunk.map(archiveItem)});
        for(const candidate of chunk)archived.add(candidate.id);
      }
      setNotice(`Архівовано ${archived.size} нецільових чатів. Автопошук більше їх не перевірятиме.`);
    }catch(reason){
      setError(reason instanceof Error?reason.message:'Не вдалося архівувати нецільові чати.');
    }finally{
      if(archived.size)await postRun({action:'archived',candidateIds:[...archived]}).catch(()=>loadRun());
      setTelegramBusy(false);
    }
  }

  // Local only: a target or a chat waiting for a decision moves to «Нецільові»; D1 is touched by «Архівувати всі».
  async function moveToNonTarget(candidate:LocalDiscoveryPreview){
    try{
      await postRun({action:'non-target',candidateId:candidate.id});
      setNotice('Чат перенесено в «Нецільові». У Work OS він потрапить лише після «Архівувати всі».');
    }catch(reason){setError(reason instanceof Error?reason.message:'Не вдалося перенести чат.');}
  }

  async function markInviteInvalid(candidate: DiscoveryCandidate) {
    if(isLocalPreview(candidate)){
      await archiveCandidate(candidate);
      return;
    }
    if (inspectingId) return;
    setInspectingId(candidate.id);
    setError('');
    try {
      await post({
        action: 'inspect',
        candidateId: candidate.id,
        version: candidate.version,
        result: { status:'failed', accessible:false, reason:candidate.platform === 'viber' ? 'invalid_viber_link' : 'invalid_whatsapp_link' },
      });
      setNotice('Invite недійсний або прострочений — кандидат відхилено без створення чату.');
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Не вдалося зафіксувати недійсний invite.');
    } finally {
      setInspectingId(null);
    }
  }

  function toggleManualInspection(candidate: DiscoveryCandidate) {
    if (manualDraft?.candidateId === candidate.id) {
      setManualDraft(null);
      return;
    }
    openManualInspection(candidate);
  }

  function openManualInspection(candidate: DiscoveryCandidate) {
    setManualDraft({
      candidateId: candidate.id,
      memberCount: candidate.memberCount === null ? '' : String(candidate.memberCount),
      activityState: candidate.activityState,
      canWrite: candidate.canWrite === null ? 'unknown' : candidate.canWrite ? 'yes' : 'no',
      adsPolicy: candidate.adsPolicy === 'forbidden' ? 'forbidden'
        : candidate.adsPolicy === 'allowed' || candidate.adsPolicy === 'operator_confirmed'
          ? 'operator_confirmed' : 'unknown',
      topicMatch: candidate.topicMatch,
      membershipState: candidate.membershipState === 'left' ? 'not_checked' : candidate.membershipState,
      chatType: candidate.chatType === 'group' || candidate.chatType === 'community' || candidate.chatType === 'channel' ? candidate.chatType : 'unknown',
    });
  }

  async function submitManualInspection(candidate: DiscoveryCandidate) {
    if (!manualDraft || manualDraft.candidateId !== candidate.id || inspectingId) return;
    const rawCount = manualDraft.memberCount.trim();
    const memberCount = rawCount === '' ? null : Number(rawCount);
    if (memberCount !== null && (!Number.isSafeInteger(memberCount) || memberCount < 0 || memberCount > 10_000_000)) {
      setError('Некоректна кількість учасників.');
      return;
    }
    setInspectingId(candidate.id);
    setError('');
    try {
      const payload = await post({
        action: 'inspect',
        candidateId: candidate.id,
        version: candidate.version,
        result: {
          status: 'inspected',
          accessible: true,
          membershipState: manualDraft.membershipState,
          observedName: candidate.name,
          chatType: manualDraft.chatType,
          memberCount,
          topicMatch: manualDraft.topicMatch,
          canWrite: manualDraft.canWrite === 'unknown' ? null : manualDraft.canWrite === 'yes',
          adsPolicy: manualDraft.adsPolicy,
          activityState: manualDraft.activityState,
        },
      }) as unknown as { decision?: DiscoveryDecision; needsExternalLeave?: boolean };
      setNotice(payload.needsExternalLeave
        ? `Кваліфікацію збережено. Чат нецільовий — після виходу з ${platformLabel(candidate.platform)} підтвердь leave у Work OS.`
        : `Кваліфікацію збережено: ${payload.decision ? decisionLabel(payload.decision) : 'оновлено'}.`);
      setManualDraft(null);
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Не вдалося зберегти кваліфікацію.');
      await load();
    } finally {
      setInspectingId(null);
    }
  }

  async function archiveCandidate(candidate:DiscoveryCandidate){
    if(isLocalPreview(candidate)){await moveToNonTarget(candidate);return;}
    if(inspectingId||importingId)return;
    setInspectingId(candidate.id);
    setError('');
    try{
      const payload=await post({action:'archive-candidate',candidateId:candidate.id,version:candidate.version}) as {needsExternalLeave?:boolean};
      setNotice(payload.needsExternalLeave===true
        ? 'Кандидат архівовано в Work OS і більше не потрапить в автопошук. Він був приєднаний — після ручного огляду вийди з цього чату у WhatsApp.'
        : 'Кандидат архівовано і більше не потрапить в автопошук.');
      await load({silent:true});
    }catch(reason){
      setError(reason instanceof Error?reason.message:'Не вдалося архівувати кандидата.');
      await load({silent:true});
    }finally{
      setInspectingId(null);
    }
  }

  async function importCandidate(candidate: DiscoveryCandidate) {
    if (importingId) return;
    setImportingId(candidate.id);
    setError('');
    try {
      // A join request was already sent and is awaiting admin approval (operator decision 2026-10-05):
      // every criterion that can be checked without joining already passed, so this is worth confirming
      // too — it lands in the Waiting queue, not "ready", via the same membershipState:'pending' path a
      // regular Waiting recheck uses.
      const pendingApproval=isPendingApprovalCandidate(candidate);
      if(isLocalPreview(candidate)&&candidate.preflightState!=='target'&&!pendingApproval)throw new Error('Спочатку дочекайся фактичної WhatsApp-перевірки цього чату.');
      const savedJoinedTarget=!isLocalPreview(candidate)
        &&candidate.decision==='target'&&!candidate.importedChatId&&candidate.membershipState==='joined';
      const useFactualConfirm=isLocalPreview(candidate)||savedJoinedTarget;
      const payload = useFactualConfirm
        ? await postPreview({
            action:'confirm',platform:candidate.platform,link:candidate.link,name:candidate.name,sources:candidate.sources,minMembers,
            preflight:{
              status:'inspected',accessible:true,targetVerified:true,membershipState:pendingApproval?'pending':'joined',observedName:candidate.name,
              chatType:candidate.chatType,memberCount:candidate.memberCount,topicMatch:candidate.topicMatch,canWrite:candidate.canWrite,
              adsPolicy:candidate.adsPolicy,activityState:candidate.activityState,
            },
          }) as unknown as ImportResponse
        : await post({action:'import',candidateId:candidate.id,version:candidate.version}) as unknown as ImportResponse;
      if(isLocalPreview(candidate))await postRun({action:'confirmed',candidateId:candidate.id}).catch(()=>loadRun());
      setNotice(payload.existing
        ? 'Чат уже був у Work OS — дубль не створено.'
        : useFactualConfirm
          ? 'Підтверджено: перевірений чат записано в Work OS як уже приєднаний і готовий до публікації.'
          : 'Підтверджено: чат записано в D1 і додано в чергу «Для приєднання».');
      onImported(candidate.platform as DiscoveryPlatform);
      if(filter==='history')await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Не вдалося підтвердити чат.');
    } finally {
      setImportingId(null);
    }
  }

  function changeFilter(next: DecisionFilter) {
    setFilter(next);
  }

  function close() {
    setGoalOverride(null);
    onClose();
  }

  const localTargets=localPreview.candidates.filter(candidate=>candidate.preflightState==='target');
  const localManualReview=localPreview.candidates.filter(candidate=>candidate.preflightState==='review').length;
  const localQueued=localPreview.candidates.filter(candidate=>candidate.preflightState==='queued').length;
  const localNonTargets=localPreview.candidates.filter(candidate=>NON_TARGET_STATES.has(String(candidate.preflightState)));
  const localChecked=localPreview.candidates.filter(candidate=>candidate.inspectionState==='inspected').length;
  const autonomousRunning=localPreview.running;
  const displayedTargetCount=runTargets;
  const displayedGoal=localPreview.running||localPreview.done?localPreview.goal:goal;
  const progressPercent=displayedGoal>0?Math.min(100,Math.round((displayedTargetCount/displayedGoal)*100)):0;
  const activeCandidateName=String(localPreview.activeCandidateName||'').trim();
  const pauseSummary=localPreview.pauseSummary;
  const whatsappBlocked=whatsappBlockedUntil>Date.now();
  const runActivity=pausing
    ? 'Зупиняємо пошук · зберігаємо прогрес'
    : autonomousRunning
    ? whatsappBlocked
      ? `WhatsApp тимчасово недоступний — автопошук продовжує Telegram-пошук, спробує WhatsApp знову о ${formatActivityTime(whatsappBlockedUntil)}`
      : activeCandidateName
      ? `Перевіряємо WhatsApp: ${activeCandidateName}`
      : localQueued>0
        ? `У черзі ${localQueued}: готуємо наступну WhatsApp-перевірку`
        : sourceActivity||'Шукаємо WhatsApp-запрошення в публічних Telegram-групах'
    : localPreview.completionReason==='goal_reached'
      ? 'Мету досягнуто — підтверди потрібні цільові чати'
      : localPreview.completionReason==='sources_exhausted'
        ? 'План пошуку завершено'
        : localPreview.completionReason==='source_error'?'Пошук зупинено: Telegram недоступний або обмежив пошук':'Автопошук зупинений';
  const visibleLocal=localCandidatesForFilter(localPreview.candidates,filter);
  const displayCandidates:DiscoveryCandidate[]=filter==='history'?workspace.candidates:visibleLocal;
  const emptyCopy=emptyCandidateCopy(filter,autonomousRunning,localQueued,localChecked,localTargets.length);


  const stateTone = (state: 'ok' | 'warn' | 'bad') => (state === 'ok' ? 'bg-ok' : state === 'bad' ? 'bg-hot' : 'bg-warn');

  return <Panel open={open} onOpenChange={(next) => { if (!next) close(); }} title="Автопошук WhatsApp-чатів" subtitle="Шукає WhatsApp-запрошення в публічних Telegram-групах і перевіряє їх у WhatsApp. У Work OS нічого не записується, доки ти не натиснеш «Підтвердити» або «Архівувати всі».">
    <div className="flex flex-col gap-5">
      <Surface variant="sunken" radius="inner" className="flex flex-col gap-3 p-4">
        <div className="flex items-baseline gap-2"><strong className="font-mono text-[32px] font-normal leading-none">{displayedTargetCount}</strong><span className="text-sm text-ink-2">із {displayedGoal} цільових чатів</span></div>
        <progress className="sr-only" max={100} value={progressPercent} aria-label="Прогрес до мети" />
        <div aria-hidden="true" className="h-1 overflow-hidden rounded-full bg-line"><div className="h-full origin-left rounded-full bg-ink" style={{ transform: `scaleX(${progressPercent / 100})`, transition: 'transform 0.5s var(--ease-out)' }} /></div>
        <p className="m-0 flex items-start gap-2 text-sm"><i aria-hidden="true" className={cn('mt-1.5 size-2 shrink-0 rounded-full', autonomousRunning || pausing ? 'bg-ok' : 'bg-line-strong')} /><span className="min-w-0 break-words">{runActivity}</span></p>
        <p className="m-0 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-2">
          <span>В роботі <b className="font-mono font-normal text-ink">{localQueued + localManualReview}</b></span>
          <span>Готові підтвердити <b className={cn('font-mono font-normal', localTargets.length > 0 ? 'text-ok' : 'text-ink')}>{localTargets.length}</b></span>
          <span>Нецільові <b className="font-mono font-normal text-ink">{localNonTargets.length}</b></span>
        </p>
      </Surface>

      {error ? <p role="alert" className="m-0 text-sm text-hot">{error}</p> : null}
      {notice && !error ? <output className="block text-sm text-ink-2">{notice}</output> : null}

      <section className="flex flex-col gap-4 rounded-inner border border-line p-4" aria-label="Параметри пошуку">
        <div>
          <h3 className="m-0 text-[15px] font-medium">{autonomousRunning ? 'Пошук працює' : 'Новий запуск'}</h3>
          <p className="m-0 mt-1 text-xs text-ink-2">{autonomousRunning ? 'Можна закрити панель чи вкладку й запустити з телефона — пошук іде, поки runner на ПК підключений.' : 'Обери мету й запусти. Решту Work OS зробить автоматично.'}</p>
          <p className="m-0 mt-1 flex items-center gap-2 text-xs text-ink-2"><i aria-hidden="true" className={cn('size-1.5 rounded-full', runnerConnected ? 'bg-ok' : 'bg-line-strong')} />{runnerConnected === true ? 'Runner на зв’язку' : runnerConnected === false ? 'Runner офлайн — пошук продовжиться, щойно він підключиться. Підключення — в «Налаштування → Сервіс».' : 'Стан runner уточнюється'}</p>
        </div>
        <label htmlFor="discovery-goal" className="flex flex-col gap-1.5 text-xs font-medium text-ink-2">Цільових чатів
          <Input id="discovery-goal" type="number" min={1} max={100} value={autonomousRunning ? displayedGoal : goal} disabled={telegramBusy || autonomousRunning} onChange={(event) => setGoalOverride(clampNumber(event.target.value, 1, 100, 50))} />
        </label>
        <details className="text-xs text-ink-2"><summary className="cursor-pointer select-none font-medium text-ink">Що вважаємо цільовим чатом</summary><p className="m-0 mt-2 leading-relaxed">WhatsApp-група (не спільнота) на 700–18 000 учасників з українською аудиторією, де можна писати. Реклама й активність не враховуються. Церкви, парафії, молитовні групи — нецільові. Джерела — лише публічні Telegram-групи: ті, де вже є твої акаунти, і відкриті для вступу; закриті (за запитом) пропускаються, у Telegram-групи runner не вступає.</p></details>
        {autonomousRunning || pausing
          ? <Button variant="outline" busy={pausing} disabled={telegramBusy} onClick={() => void stopAutonomousSearch()}><Square aria-hidden="true" strokeWidth={1.5} />{pausing ? 'Зберігаємо паузу…' : 'Зупинити автопошук'}</Button>
          : <Button variant="action" busy={telegramBusy} onClick={() => void startAutonomousSearch()}><Search aria-hidden="true" strokeWidth={1.5} />{telegramBusy ? 'Запускаємо…' : willResume && localPreview.pauseSummary && !localPreview.done ? 'Продовжити автопошук' : willResume && localPreview.completionReason === 'source_error' ? 'Продовжити пошук' : willResume && localPreview.completionReason === 'sources_exhausted' ? 'Шукати ще раз' : 'Запустити автопошук'}</Button>}
        {localPreview.completionReason === 'sources_exhausted' ? <p className="m-0 text-xs text-ink-2">План пошуку завершено: знайдено {displayedTargetCount} із {localPreview.goal} цільових. {willResume ? 'Минув тиждень — можна шукати знову: у тих самих Telegram-групах могли з’явитися нові запрошення.' : 'Повторний пошук за тим самим планом стане доступний через тиждень після завершення.'}</p> : null}
        {localPreview.completionReason === 'goal_reached' ? <p className="m-0 text-xs text-ok">Готово: знайдено {displayedTargetCount} із {localPreview.goal}. Підтверди потрібні у списку «Готові підтвердити».</p> : null}
        {!autonomousRunning && pauseSummary ? <p className="m-0 text-xs text-ink-2">Пошук на паузі. Прогрес збережено — «Продовжити» почне з того ж кроку.</p> : null}
        {localPreview.sourceIssues.length > 0 ? (
          <details className="rounded-inner border border-warn/40 text-xs">
            <summary className="cursor-pointer select-none px-3 py-2.5 font-medium">{autonomousRunning ? 'Деякі джерела тимчасово недоступні' : 'Пошук зупинено: потрібна твоя дія'}</summary>
            <div className="border-t border-line px-3 py-2.5 text-ink-2">
              {autonomousRunning ? 'Пошук продовжується за доступними джерелами. Нічого робити не потрібно.' : 'Виправ причину нижче й натисни «Продовжити пошук» — він почнеться з того ж кроку.'}
              <div className="mt-2 flex flex-col gap-1">{localPreview.sourceIssues.map((issue, index) => <span key={index} className="break-words">{issue.query} · {reasonLabel(issue.reason)}</span>)}</div>
            </div>
          </details>
        ) : null}
        <details className="text-xs text-ink-2">
          <summary className="cursor-pointer select-none font-medium text-ink">Дані пошуку</summary>
          <p className="m-0 mt-2 flex flex-col gap-1">
            <span>Перевірено запитів пошуку <b className="font-mono font-normal text-ink">{localPreview.telegramCursor}/{localPreview.sourceTotal || '—'}</b> · дублі <b className="font-mono font-normal text-ink">{localPreview.duplicates}</b></span>
            <span>Перевірено у WhatsApp <b className="font-mono font-normal text-ink">{localChecked}</b> · активність <b className="font-mono font-normal text-ink">{formatActivityTime(localPreview.lastActivityAt)}</b></span>
            <span>У черзі на WhatsApp <b className="font-mono font-normal text-ink">{queuedCount(localPreview, Date.now())}/{SOURCE_TARGET_QUEUE}</b></span>
          </p>
        </details>
      </section>

      <section className="flex flex-col gap-3" aria-label="Кандидати">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div><h3 className="m-0 text-[15px] font-medium">Результати пошуку</h3><p className="m-0 mt-0.5 text-xs text-ink-2">До «Підтвердити» та «Архівувати всі» результати живуть лише в цій вкладці браузера.</p></div>
          {filter === 'rejected' && localNonTargets.length > 0 ? <Button variant="outline" size="sm" busy={telegramBusy} onClick={() => void archiveAllNonTargets()}>Архівувати всі ({localNonTargets.length})</Button> : null}
        </div>
        <div className="flex flex-wrap gap-1.5">
          {([['active', 'В роботі', localQueued + localManualReview], ['target', 'Готові підтвердити', localTargets.length], ['rejected', 'Нецільові', localNonTargets.length], ['history', 'Історія Work OS', filter === 'history' ? workspace.candidates.length : null]] as Array<[DecisionFilter, string, number | null]>).map(([key, label, count]) =>
            <Chip key={key} pressed={filter === key} disabled={loading} count={count ?? undefined} onClick={() => changeFilter(key)}>{label}</Chip>)}
        </div>

        {loading && displayCandidates.length === 0 ? <div aria-busy="true" className="flex flex-col gap-2">{[0, 1, 2].map((item) => <Ghost key={item} className="h-28 rounded-inner" />)}</div> : displayCandidates.length ? (
          <ul className="m-0 flex list-none flex-col gap-3 p-0">
            {displayCandidates.map((candidate) => {
              const criteria = candidateCriteria(candidate);
              const status = candidateStatus(candidate);
              const confirmedCriteria = criteria.filter((item) => item.state === 'ok').length;
              return <li key={candidate.id} className="flex min-w-0 flex-col gap-3 rounded-inner border border-line bg-sunken p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h4 className="m-0 break-words text-sm font-medium leading-snug">{candidateDisplayName(candidate)}</h4>
                    <p className="m-0 mt-1 text-xs text-ink-2">{status.detail}</p>
                    <p className="m-0 mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs"><span className={cn('flex items-center gap-1.5', candidate.decision === 'target' && 'text-ok')}>{candidate.decision === 'target' ? <i aria-hidden="true" className="size-1.5 rounded-full bg-ok" /> : null}{status.label}</span>{candidate.membershipState === 'pending' ? <span className="text-ink-2">Очікує вступу</span> : null}{candidate.membershipState === 'joined' ? <span className="text-ink-2">Приєднано</span> : null}</p>
                  </div>
                  {status.busy ? <i aria-label="Виконується" className="mt-1 size-2 shrink-0 animate-pulse rounded-full bg-ink" /> : null}
                </div>
                <details className="text-xs">
                  <summary className="cursor-pointer select-none font-medium text-ink-2">Деталі перевірки · {confirmedCriteria} із {criteria.length}</summary>
                  <dl className="m-0 mt-2 grid grid-cols-2 gap-2">
                    {criteria.map((item) => <div key={item.label} className="rounded-lg border border-line px-3 py-2"><dt className="flex items-center gap-1.5 text-[11px] text-ink-2"><i aria-hidden="true" className={cn('size-1.5 rounded-full', stateTone(item.state))} />{item.label}</dt><dd className="m-0 mt-0.5 text-sm">{item.value}</dd></div>)}
                  </dl>
                </details>
                <div className="flex flex-wrap items-center gap-2">
                  <a className="inline-flex h-8 items-center gap-1.5 rounded-full border border-line-strong px-3.5 text-[13px] font-medium transition-colors hover:bg-raised" href={candidate.link} target="_blank" rel="noreferrer">Відкрити {platformLabel(candidate.platform)}<ExternalLink aria-hidden="true" strokeWidth={1.5} className="size-3.5" /></a>
                  {!candidate.importedChatId && isLocalPreview(candidate) && (candidate.decision === 'rejected' || (candidate.decision === 'unavailable' && candidate.reasonCodes.some((reason) => ['qualification_incomplete', 'paused_unverified', 'retry_exhausted'].includes(reason)))) ? <Button variant="outline" size="sm" disabled={localPreview.running || telegramBusy} onClick={() => retryIncompleteCandidate(candidate)}>Повторити перевірку</Button> : null}
                  {!candidate.importedChatId && candidate.decision === 'review' && !isLocalPreview(candidate) ? <>
                    <Button variant="action" size="sm" busy={importingId === candidate.id} disabled={importingId !== null || inspectingId !== null} onClick={() => void importCandidate(candidate)}>Додати на ручну перевірку</Button>
                    <Button variant="ghost" size="sm" busy={inspectingId === candidate.id} disabled={importingId !== null || inspectingId !== null} onClick={() => void archiveCandidate(candidate)}>Відхилити</Button>
                    <Button variant="ghost" size="sm" disabled={inspectingId !== null} onClick={() => void markInviteInvalid(candidate)}>Invite недійсний</Button>
                  </> : null}
                  {!candidate.importedChatId && isLocalPreview(candidate) && candidate.preflightState === 'review' ? <>
                    {isPendingApprovalCandidate(candidate) ? <Button variant="action" size="sm" busy={importingId === candidate.id} disabled={importingId !== null || inspectingId !== null} title="Запит на вступ уже надіслано — чат піде в чергу «Очікування» до схвалення адміністратора." onClick={() => void importCandidate(candidate)}>Підтвердити</Button> : null}
                    <Button variant="ghost" size="sm" title="Перенесе чат у «Нецільові» лише в цій вкладці; у Work OS — після «Архівувати всі»." onClick={() => moveToNonTarget(candidate)}>У нецільові</Button>
                  </> : null}
                  {!candidate.importedChatId && candidate.decision === 'target' ? <>
                    <Button variant="action" size="sm" busy={importingId === candidate.id} disabled={importingId !== null || inspectingId !== null} onClick={() => void importCandidate(candidate)}>{isLocalPreview(candidate) ? 'Підтвердити' : 'Лишити в роботі'}</Button>
                    <Button variant="outline" size="sm" busy={inspectingId === candidate.id} disabled={importingId !== null || inspectingId !== null} onClick={() => void archiveCandidate(candidate)}>{isLocalPreview(candidate) ? 'У нецільові' : 'В архів'}</Button>
                  </> : null}
                  {candidate.importedChatId && candidate.membershipState !== 'left' ? <Button variant="outline" size="sm" onClick={() => toggleManualInspection(candidate)}>{manualDraft?.candidateId === candidate.id ? 'Закрити кваліфікацію' : 'Кваліфікувати вручну'}</Button> : null}
                </div>
                {manualDraft?.candidateId === candidate.id && candidate.importedChatId && candidate.membershipState !== 'left' ? (
                  <div className="flex flex-col gap-3 rounded-inner border border-line bg-glass p-3">
                    <p className="m-0 flex items-center gap-2 text-sm font-medium"><CheckCircle2 aria-hidden="true" strokeWidth={1.5} className="size-4 text-ink-2" />Ручна кваліфікація</p>
                    <div className="grid gap-2 sm:grid-cols-2">
                      <label className="flex flex-col gap-1 text-xs font-medium text-ink-2">Учасники<Input type="number" min={0} max={10_000_000} value={manualDraft.memberCount} onChange={(event) => setManualDraft({ ...manualDraft, memberCount: event.target.value })} placeholder="700–18000" /></label>
                      <label className="flex flex-col gap-1 text-xs font-medium text-ink-2">Активність<Select value={manualDraft.activityState} onChange={(event) => setManualDraft({ ...manualDraft, activityState: event.target.value as ManualInspectionDraft['activityState'] })}><option value="unknown">Невідомо</option><option value="active">Активний</option><option value="dead">Неактивний</option></Select></label>
                      <label className="flex flex-col gap-1 text-xs font-medium text-ink-2">Писати можуть учасники<Select value={manualDraft.canWrite} onChange={(event) => setManualDraft({ ...manualDraft, canWrite: event.target.value as ManualInspectionDraft['canWrite'] })}><option value="unknown">Невідомо</option><option value="yes">Так</option><option value="no">Ні</option></Select></label>
                      <label className="flex flex-col gap-1 text-xs font-medium text-ink-2">Оголошення<Select value={manualDraft.adsPolicy} onChange={(event) => setManualDraft({ ...manualDraft, adsPolicy: event.target.value as ManualInspectionDraft['adsPolicy'] })}><option value="unknown">Невідомо</option><option value="operator_confirmed">Дозволені</option><option value="forbidden">Заборонені</option></Select></label>
                      <label className="flex flex-col gap-1 text-xs font-medium text-ink-2">Аудиторія<Select value={manualDraft.topicMatch} onChange={(event) => setManualDraft({ ...manualDraft, topicMatch: event.target.value as ManualInspectionDraft['topicMatch'] })}><option value="unknown">Невідомо</option><option value="match">Цільова</option><option value="mismatch">Нецільова</option></Select></label>
                      <label className="flex flex-col gap-1 text-xs font-medium text-ink-2">Вступ<Select value={manualDraft.membershipState} onChange={(event) => setManualDraft({ ...manualDraft, membershipState: event.target.value as ManualInspectionDraft['membershipState'] })}><option value="not_checked">Не перевірено</option><option value="pending">Очікує схвалення</option><option value="joined">Приєднано</option></Select></label>
                      <label className="flex flex-col gap-1 text-xs font-medium text-ink-2">Тип чату<Select value={manualDraft.chatType} onChange={(event) => setManualDraft({ ...manualDraft, chatType: event.target.value as ManualInspectionDraft['chatType'] })}><option value="unknown">Невідомо</option><option value="group">Група</option><option value="community">Спільнота</option><option value="channel">Канал</option></Select></label>
                    </div>
                    <Button variant="action" size="sm" className="self-start" busy={inspectingId === candidate.id} onClick={() => void submitManualInspection(candidate)}>Зберегти кваліфікацію</Button>
                  </div>
                ) : null}
              </li>;
            })}
          </ul>
        ) : <p className="m-0 rounded-inner border border-dashed border-line-strong px-4 py-5 text-sm text-ink-2"><strong className="block font-medium text-ink">{emptyCopy.title}</strong>{emptyCopy.detail}</p>}
      </section>
    </div>
  </Panel>;
}

function localCandidatesForFilter(candidates:LocalDiscoveryPreview[],filter:DecisionFilter){
  if(filter==='active'){
    // Chats waiting for an operator decision first, then the queue.
    return [...candidates.filter(candidate=>candidate.preflightState==='review'),...candidates.filter(candidate=>candidate.preflightState==='queued')];
  }
  return candidates.filter(candidate=>(filter==='target'&&candidate.preflightState==='target')
    ||(filter==='rejected'&&NON_TARGET_STATES.has(String(candidate.preflightState))));
}

function archiveItem(candidate:LocalDiscoveryPreview){
  return {
    platform:candidate.platform,link:candidate.link,name:candidate.name,sources:candidate.sources,
    outcome:{
      decision:candidate.preflightState,
      reasonCodes:candidate.preflightReasonCodes?.length?candidate.preflightReasonCodes:candidate.reasonCodes,
      leftAfterCheck:candidate.leftAfterCheck===true,
      result:{
        status:candidate.inspectionState==='inspected'?'inspected':candidate.preflightState==='unavailable'?'failed':'',
        accessible:candidate.accessState==='available'?true:candidate.accessState==='unavailable'?false:null,
        reason:candidate.linkState==='invalid'?'invalid_whatsapp_link':'',
        membershipState:candidate.membershipState,observedName:candidate.name,chatType:candidate.chatType,
        memberCount:candidate.memberCount,topicMatch:candidate.topicMatch,canWrite:candidate.canWrite,
        adsPolicy:candidate.adsPolicy,activityState:candidate.activityState,
      },
    },
  };
}

function formatActivityTime(value:number|null){
  if(!value)return '—';
  return new Intl.DateTimeFormat('uk-UA',{hour:'2-digit',minute:'2-digit'}).format(new Date(value));
}
function isLocalPreview(candidate:DiscoveryCandidate):candidate is LocalDiscoveryPreview{
  return (candidate as Partial<LocalDiscoveryPreview>).localOnly===true;
}

function isPendingApprovalCandidate(candidate:DiscoveryCandidate){
  // membershipState is 'pending' when a Request-to-join button was actually clicked, but stays
  // whatever the WhatsApp check last reported (e.g. 'not_checked') when the UI's text-only fallback
  // fired because no clickable button was found — the runner routes both through the same
  // decision:'review'+reasonCodes:['approval_required'] outcome (qualifyApprovalRequired), so this
  // check must not require membershipState==='pending' to find the second case too.
  return isLocalPreview(candidate)&&candidate.preflightState==='review'
    &&candidate.reasonCodes.includes('approval_required');
}

function emptyCandidateCopy(filter:DecisionFilter,running:boolean,queued:number,checked:number,targetCount:number){
  if(filter==='active'){
    if(running)return {title:'Шукаємо в Telegram-групах',detail:`У черзі ${queued}, уже перевірено ${checked}. Знайдені WhatsApp-запрошення з’являться тут.`};
    if(targetCount>0)return {title:'У черзі зараз нічого немає',detail:`Але ${targetCount===1?'є 1 чат, готовий':`є ${targetCount} готових`} до підтвердження — перейди на вкладку «Готові підтвердити».`};
    return {title:'Нічого не в роботі',detail:'Запусти або продовж автопошук.'};
  }
  if(filter==='target')return {title:'Цільових чатів поки немає',detail:'Тут з’являться чати, де всі критерії підтверджені в WhatsApp.'};
  if(filter==='rejected')return {title:'Нецільових немає',detail:'Тут з’являться відсіяні чати з причинами.'};
  return {title:'Історія порожня',detail:'Підтверджені й архівовані чати Work OS з’являться тут.'};
}

type CriterionItem = { label: string; value: string; state: 'ok' | 'warn' | 'bad' };

function candidateCriteria(candidate: DiscoveryCandidate): CriterionItem[] {
  const count = candidate.memberCount;
  const memberOk = count !== null && count >= 700 && count <= 18_000;
  // Communities are not targets; ad rules and activity are not criteria (operator decision 2026-10-02).
  const chatTypeOk = candidate.chatType === 'group';
  return [
    { label: 'Тип', value: chatTypeLabel(candidate.chatType), state: candidate.chatType === 'unknown' ? 'warn' : chatTypeOk ? 'ok' : 'bad' },
    { label: 'Учасники', value: count === null ? 'Невідомо' : String(count), state: count === null ? 'warn' : memberOk ? 'ok' : 'bad' },
    { label: 'Можна писати', value: candidate.canWrite === null ? 'Невідомо' : candidate.canWrite ? 'Так' : 'Ні', state: candidate.canWrite === true ? 'ok' : candidate.canWrite === false ? 'bad' : 'warn' },
    { label: 'Аудиторія', value: topicMatchLabel(candidate.topicMatch), state: candidate.topicMatch === 'match' ? 'ok' : candidate.topicMatch === 'mismatch' ? 'bad' : 'warn' },
  ];
}

function candidateDisplayName(candidate:DiscoveryCandidate){
  const source=String(candidate.name||'').replace(/<[^>]*>/g,' ').replace(/&[a-z]+;/giu,' ').replace(/https?:\/\/\S+/giu,' ').replace(/\s+/g,' ').trim();
  const noisy=/class=|style=|notion-|chat\.whatsapp\.com|t\.me\//iu.test(String(candidate.name||''));
  if(source&&!noisy&&source.length<=90)return source;
  const code=String(candidate.link||'').split('/').filter(Boolean).at(-1)||'invite';
  return `WhatsApp-кандидат · ${code.slice(0,7)}…`;
}

function candidateStatus(candidate:DiscoveryCandidate){
  if(isLocalPreview(candidate)){
    // decision diverges from preflightState for one transient window: retryCandidate() resets
    // preflightState to 'queued' (not yet re-checked) but leaves decision at a placeholder 'review' —
    // so every local-preview branch below must return based on preflightState, the authoritative
    // field everywhere else in this file (tabs, counts, archiving), never falling through to the
    // decision-based branches meant for server-tracked (non-local) candidates further down.
    const tone='border-border bg-muted/25 text-foreground/70';
    const reasons=(candidate.preflightReasonCodes?.length?candidate.preflightReasonCodes:candidate.reasonCodes).map(reasonLabel).join('; ');
    if(candidate.preflightState==='review')return {label:'Потрібне твоє рішення',detail:'Не всі критерії вдалося підтвердити автоматично: '+(reasons||'невідомо')+'. Відкрий чат у WhatsApp; якщо не підходить — «У нецільові». З групи автоматично не виходимо.',tone:'border-amber-500/30 bg-amber-500/5 text-foreground',busy:false};
    if(candidate.preflightState==='skipped')return {label:'Пропущено',detail:'Причина: '+(reasons||'невідомо'),tone,busy:false};
    if(candidate.preflightState==='unavailable')return {label:'Не вдалося перевірити',detail:'Причина: '+(reasons||'невідомо')+'. Це не висновок про нецільову аудиторію.',tone,busy:false};
    if(candidate.preflightState==='rejected')return {label:'Нецільовий',detail:'Причина: '+(reasons||'невідомо')+'. '+(candidate.leftAfterCheck?'Вихід із чату підтверджено.':candidate.membershipState==='joined'?'Вихід не підтверджено: '+reasonLabel(candidate.leaveReason||'leave_not_confirmed'):'Відсіяно до вступу.'),tone,busy:false};
    if(candidate.preflightState==='target')return {label:'Цільовий',detail:'Усі критерії підтверджені в WhatsApp. У Work OS ще не записано — натисни «Підтвердити».',tone:'border-emerald-500/30 bg-emerald-500/5 text-emerald-800 dark:text-emerald-300',busy:false};
    return {label:'У черзі на перевірку',detail:'Знайдено в Telegram: '+(candidate.sources?.[0]?.sourceTitle||'публічна група')+'. Runner перевірить запрошення в WhatsApp.',tone:'border-border bg-muted/20 text-foreground/70',busy:candidate.preflightState==='queued'};
  }
  if(candidate.membershipState==='left')return {label:'Чат уже покинуто',detail:'Для нової кваліфікації спочатку віднови його та підтвердь повторний вступ.',tone:'border-border bg-muted/25 text-foreground/70',busy:false};
  if(candidate.decision==='review')return {label:'На ручну перевірку',detail:candidate.reasonCodes.includes('fresh_join_history_unavailable')?'Чат пройшов доступні автоматичні перевірки, але старі повідомлення після вступу недоступні. Перевір активність і оголошення вручну.':'Потрібен твій погляд перед остаточним рішенням.',tone:'border-amber-500/30 bg-amber-500/5 text-foreground',busy:false};
  if(candidate.decision==='target')return {label:'Цільовий',detail:'Усі критерії підтверджені. Лиш у роботі або перенеси в архів.',tone:'border-emerald-500/30 bg-emerald-500/5 text-emerald-800 dark:text-emerald-300',busy:false};
  if(candidate.decision==='rejected')return {label:'Відхилено автоматично',detail:candidate.membershipState==='joined'?'Чат не відповідає критеріям. Work OS виходить із нього та архівує.':'Чат не відповідає критеріям і не буде зарахований у ціль.',tone:'border-border bg-muted/25 text-foreground/70',busy:false};
  if(candidate.decision==='unavailable')return {label:'Недоступний',detail:'Invite або сам чат недоступний. Work OS переходить до наступного кандидата.',tone:'border-border bg-muted/25 text-foreground/70',busy:false};
  if(candidate.membershipState==='pending')return {label:'Очікуємо схвалення в WhatsApp',detail:'Запит на вступ уже відправлено. Система перевірить його повторно сама.',tone:'border-primary/30 bg-primary/5 text-foreground',busy:true};
  if(candidate.membershipState==='joined')return {label:'Перевіряємо чат',detail:'Вступ підтверджено. Work OS збирає факти й перевіряє критерії.',tone:'border-primary/30 bg-primary/5 text-foreground',busy:true};
  if(candidate.inspectionState==='failed')return {label:'Спробуємо ще раз',detail:'Попередня перевірка не завершилась. Кандидат лишається в автоматичній черзі.',tone:'border-amber-500/30 bg-amber-500/5 text-foreground',busy:true};
  return {label:'У черзі',detail:'Work OS перевірить цей чат автоматично. Втручання не потрібне.',tone:'border-border bg-muted/15 text-foreground/75',busy:true};
}

function platformLabel(value: string) {
  return value === 'whatsapp' ? 'WhatsApp' : value === 'viber' ? 'Viber' : value;
}

function decisionLabel(value: DiscoveryDecision) {
  return value === 'target' ? 'Цільовий'
    : value === 'review' ? 'Потрібна перевірка'
      : value === 'rejected' ? 'Відхилений'
        : 'Недоступний';
}

function chatTypeLabel(value: DiscoveryCandidate['chatType']) {
  return value === 'group' ? 'Група'
    : value === 'community' ? 'Спільнота'
      : value === 'channel' ? 'Канал'
        : value === 'contact' ? 'Контакт'
          : value === 'bot' ? 'Бот'
            : 'Невідомо';
}

function activityLabel(value: DiscoveryCandidate['activityState']) {
  return value === 'active' ? 'активний' : value === 'dead' ? 'неактивний' : 'невідомо';
}

function adsPolicyLabel(value: DiscoveryCandidate['adsPolicy']) {
  return value === 'allowed' || value === 'operator_confirmed' ? 'можна'
    : value === 'inferred_allowed' ? 'є фактичні оголошення'
      : value === 'forbidden' ? 'заборонено'
        : 'невідомо';
}

function topicMatchLabel(value: DiscoveryCandidate['topicMatch']) {
  return value === 'match' ? 'цільова'
    : value === 'mismatch' ? 'нецільова'
      : 'невідомо';
}

function inspectionLabel(value: DiscoveryCandidate['inspectionState']) {
  return value === 'inspected' ? 'Перевірено'
    : value === 'failed' ? 'Перевірка не завершена'
      : 'Ще не перевірено';
}

function reasonLabel(value: string) {
  const labels: Record<string, string> = {
    all_required_confirmed: 'усі критерії підтверджені',
    approval_required:'потрібне схвалення адміністратора',
    whatsapp_join_retry_later:'WhatsApp просить спробувати вступ пізніше',
    retry_exhausted:'ліміт технічних спроб вичерпано; доступна повторна перевірка',
    paused_unverified:'перевірку раніше перервала пауза',
    qualification_incomplete:'після повторних спроб частина критеріїв лишилась невідомою',
    invite_query_failed:'не вдалося прочитати дані запрошення',
    page_not_ready:'WhatsApp не завершив завантаження',
    target_not_verified:'не підтверджено, що відкрито потрібний чат',
    join_not_confirmed:'вступ не підтверджено',
    invalid_whatsapp_link:'посилання недійсне або прострочене',
    source_event_specific:'посилання на окрему подію або сторонню соцмережу',
    leave_not_confirmed:'вихід із чату не підтверджено',
    leave_cdp_unavailable:'зв’язок із WhatsApp втрачено під час виходу',
    duplicate_joined_chat:'цей чат уже знайдено за іншим посиланням',
    unknown_chat_type: 'тип чату невідомий',
    unknown_member_count: 'кількість учасників невідома',
    unknown_topic_match: 'тематика не підтверджена',
    unknown_can_write: 'можливість писати не підтверджена',
    unknown_ads_allowed: 'дозвіл оголошень не підтверджено',
    unknown_activity: 'активність не підтверджена',
    unknown_membership: 'вступ до чату не підтверджено',
    unknown_inspection: 'після вступу чат ще не перевірено',
    unknown_invite_validity: 'invite потрібно перевірити повторно',
    unknown_access: 'доступ до чату не підтверджено',
    topic_mismatch: 'тематика не підходить',
    cannot_write: 'писати не можна',
    ads_forbidden: 'оголошення заборонені',
    too_few_members: 'менше 700 учасників',
    too_many_members: 'понад 18 000 учасників',
    invalid_invite: 'посилання недійсне або прострочене',
    inactive_chat: 'чат неактивний',
    not_discussion_group: 'не груповий чат',
    community_not_supported: 'це спільнота, а не група',
    access_unavailable: 'чат недоступний',
    qualification_unverified: 'не вдалося підтвердити всі критерії',
    fresh_join_history_unavailable: 'старі повідомлення недоступні після вступу — потрібна ручна перевірка',
    telegram_search_throttled: 'Telegram перестав повертати результати пошуку — схоже на тимчасове обмеження акаунта. Продовж за кілька годин, план лишився на цьому ж кроці.',
    telegram_flood_wait: 'Telegram тимчасово обмежив пошук — продовж пізніше',
    telegram_tab_missing: 'відкрий web.telegram.org/a в Opera з портом 9222 і натисни «Продовжити»',
    telegram_not_authenticated: 'потрібен вхід у Telegram Web (web.telegram.org/a)',
    telegram_tab_unavailable: 'вкладка Telegram стала недоступна',
    telegram_search_unavailable: 'пошук у Telegram тимчасово недоступний',
    cdp_unavailable: 'зв’язок із браузером runner-а втрачено',
    cdp_not_configured: 'runner не налаштовано для з’єднання з браузером',
  };
  return labels[value] || value;
}

function clampNumber(value: unknown, min: number, max: number, fallback: number) {
  const number = Number(value);
  if (!Number.isSafeInteger(number)) return fallback;
  return Math.max(min, Math.min(max, number));
}
