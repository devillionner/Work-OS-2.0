'use client';

import { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, ExternalLink, LoaderCircle, Search, Square, X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { ChatDiscoveryExecutorPanel } from '@/components/chat-discovery-executor-panel';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import type { DiscoveryCandidate, DiscoveryDecision, DiscoveryRun } from '@/lib/chat-discovery/domain';
import type { DiscoveryPlatform, TelegramSearchPlan } from '@/lib/chat-discovery/public-web';
import type { LocalDiscoveryPreview } from '@/lib/chat-discovery/local-preview';
import { WorkspaceInlineLoading } from '@/components/workspace-load-state';
import { EMPTY_RUN, NON_TARGET_STATES, SOURCE_TARGET_QUEUE, canResume, queuedCount, runTargetCount, type DiscoveryRunState } from '@/lib/chat-discovery/run-state';
import { subscribeLiveMessages, subscribeLiveStatus } from '@/lib/live-channel';

type Workspace = {
  run: DiscoveryRun | null;
  telegramPlan: TelegramSearchPlan | null;
  counts: Record<DiscoveryDecision, number>;
  importedCount: number;
  waitingWhatsAppCount: number;
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

const EMPTY_COUNTS: Record<DiscoveryDecision, number> = {
  review: 0,
  target: 0,
  rejected: 0,
  unavailable: 0,
};
const ARCHIVE_CHUNK=100;
// Fallback refresh of the run while the live channel is down and the dialog is open.
const RUN_FALLBACK_POLL_MS=15_000;

export function ChatDiscoveryDialog({
  open,
  onClose,
  onImported,
}: {
  open: boolean;
  onClose: () => void;
  onImported: (platform: DiscoveryPlatform) => void;
}) {
  const [workspace, setWorkspace] = useState<Workspace>({ run: null, telegramPlan: null, counts: EMPTY_COUNTS, importedCount: 0, waitingWhatsAppCount: 0, candidates: [] });
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
  const willResume=canResume(localPreview)&&goal===localPreview.goal;

  async function startAutonomousSearch() {
    if(telegramBusy)return;
    setError('');
    setNotice('');
    setTelegramBusy(true);
    try{
      if(willResume){
        const resumed=await postRun({action:'resume'});
        setFilter('active');
        setNotice(resumed.completionReason===null&&localPreview.completionReason==='source_error'
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
  const emptyCopy=emptyCandidateCopy(filter,autonomousRunning,localQueued,localChecked);



  return <Dialog open={open} onOpenChange={next => { if (!next) close(); }}>
    <DialogContent
      className="h-[min(92dvh,920px)] !w-[calc(100dvw-20px)] !max-w-[1240px] !flex !flex-col gap-0 overflow-hidden !rounded-[20px] border-border/80 bg-background !p-0 shadow-xl sm:!w-[calc(100dvw-32px)]"
      overlayClassName="bg-black/45 supports-backdrop-filter:backdrop-blur-[2px]"
      showCloseButton={false}
    >
      <header className="relative border-b border-border/70 bg-background px-4 py-4 sm:px-6">
        <DialogHeader className="gap-1 pr-14">
          <div className="flex items-center gap-2">
            <DialogTitle className="text-lg font-semibold tracking-tight sm:text-xl">Автопошук WhatsApp-чатів</DialogTitle>
            {(autonomousRunning||pausing)&&<Badge variant="secondary">Працює</Badge>}
          </div>
          <DialogDescription className="text-xs leading-5 text-foreground/65 sm:text-sm">
            Шукає WhatsApp-запрошення в публічних Telegram-групах і перевіряє їх у WhatsApp. У Work OS нічого не записується, доки ти не натиснеш «Підтвердити» або «Архівувати всі».
          </DialogDescription>
        </DialogHeader>
        <Button className="absolute right-3 top-3 !size-11 rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground sm:right-4 sm:top-4 sm:!size-9" variant="ghost" size="icon" aria-label="Закрити" onClick={close}><X/></Button>

        <div className="mt-4 grid gap-3 rounded-2xl border border-border/70 bg-muted/15 p-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:p-5">
          <div className="min-w-0">
            <div className="flex items-baseline gap-2">
              <strong className="text-3xl font-semibold tracking-tight tabular-nums text-foreground">{displayedTargetCount}</strong>
              <span className="text-sm font-semibold text-foreground/55">із {displayedGoal} цільових чатів</span>
            </div>
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-background ring-1 ring-border/70">
              <div className="h-full rounded-full bg-primary transition-[width] duration-500" style={{width:`${progressPercent}%`}}/>
            </div>
            <div className="mt-2 flex items-start gap-2 text-sm font-medium text-foreground/80">
              {(autonomousRunning||pausing)?<LoaderCircle className="mt-0.5 size-4 shrink-0 animate-spin text-primary"/>:<span className="mt-1.5 size-2 shrink-0 rounded-full bg-muted-foreground/60"/>}
              <span className="min-w-0 break-words">{runActivity}</span>
            </div>
          </div>
          <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted-foreground sm:justify-end">
            <span>В роботі <strong className="text-foreground">{localQueued+localManualReview}</strong></span>
            <span>Готові підтвердити <strong className="text-foreground">{localTargets.length}</strong></span>
            <span>Нецільові <strong className="text-foreground">{localNonTargets.length}</strong></span>
          </div>
        </div>
      </header>

      {(error || notice) && <div className="border-b border-border/70 px-5 py-2.5 sm:px-6">
        {error && <div className="workspace-error" role="alert">{error}</div>}
        {notice && !error && <output className="reports-notice">{notice}</output>}
      </div>}

      <div className="grid min-h-0 flex-1 overflow-y-auto lg:grid-cols-[330px_minmax(0,1fr)] lg:overflow-hidden xl:grid-cols-[350px_minmax(0,1fr)]">
        <div className="border-b border-border/70 bg-muted/10 p-4 lg:min-h-0 lg:overflow-y-auto lg:border-b-0 lg:border-r">
          <div className="grid gap-3">
            <section className="rounded-2xl border border-border/70 bg-background p-4" aria-label="Параметри пошуку">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <h3 className="text-base font-semibold">{autonomousRunning?'Пошук працює':'Новий запуск'}</h3>
                  <p className="mt-1 text-xs leading-5 text-foreground/70">{autonomousRunning?'Можна закрити модалку чи вкладку й запустити з телефона — пошук іде, поки runner на ПК підключений.':'Обери мету й запусти. Решту Work OS зробить автоматично.'}</p>
                  {runnerConnected===false&&<p className="mt-1 text-xs leading-5 text-amber-700 dark:text-amber-400">Runner на ПК не підключений: пошук продовжиться, щойно він підключиться.</p>}
                </div>
                <Badge>WhatsApp</Badge>
              </div>

              <div className="mt-4 grid gap-3">
                <label htmlFor="discovery-goal" className="grid gap-1.5 text-xs font-medium">
                  Цільових чатів
                  <Input
                    className="h-10 bg-background text-base font-semibold"
                    id="discovery-goal"
                    type="number"
                    min={1}
                    max={100}
                    value={autonomousRunning?displayedGoal:goal}
                    disabled={telegramBusy||autonomousRunning}
                    onChange={event => setGoalOverride(clampNumber(event.target.value, 1, 100, 50))}
                  />
                </label>
                <details className="rounded-xl border border-border/70 bg-background">
                  <summary className="cursor-pointer select-none px-3 py-2.5 text-xs font-semibold text-foreground/75">Що вважаємо цільовим чатом</summary>
                  <div className="border-t border-border/60 px-3 py-2.5 text-xs leading-5 text-foreground/70">
                    WhatsApp-група (не спільнота) на 700–18 000 учасників з українською аудиторією, де можна писати. Реклама й активність не враховуються. Церкви, парафії, молитовні групи — нецільові. Джерела — лише публічні Telegram-групи: ті, де вже є твої акаунти, і відкриті для вступу; закриті (за запитом) пропускаються, у Telegram-групи runner не вступає.
                  </div>
                </details>
              </div>

              <div className="mt-4 grid gap-2">
                {autonomousRunning||pausing
                  ? <Button className="min-h-11 w-full justify-center sm:min-h-9" type="button" variant="outline" disabled={telegramBusy} onClick={() => void stopAutonomousSearch()}>
                      {pausing?<LoaderCircle data-icon="inline-start"/>:<Square data-icon="inline-start"/>}{pausing?'Зберігаємо паузу…':'Зупинити автопошук'}
                    </Button>
                  : <Button className="min-h-11 w-full justify-center sm:min-h-9" type="button" disabled={telegramBusy} onClick={() => void startAutonomousSearch()}>
                      {telegramBusy?<LoaderCircle data-icon="inline-start"/>:<Search data-icon="inline-start"/>}{telegramBusy?'Запускаємо…':willResume&&localPreview.pauseSummary&&!localPreview.done?'Продовжити автопошук':willResume&&localPreview.completionReason==='source_error'?'Продовжити пошук':'Запустити автопошук'}
                    </Button>}
              </div>

              {localPreview.completionReason==='sources_exhausted'&&<div className="mt-3 rounded-xl border border-border/70 bg-muted/20 px-3 py-2.5 text-xs leading-5 text-foreground/75">План пошуку завершено: знайдено {displayedTargetCount} із {localPreview.goal} цільових.</div>}
              {localPreview.completionReason==='goal_reached'&&<div className="mt-3 rounded-xl border border-emerald-500/30 bg-emerald-500/5 px-3 py-2.5 text-xs font-semibold leading-5 text-foreground">Готово: знайдено {displayedTargetCount} із {localPreview.goal}. Підтверди потрібні у списку «Цільові».</div>}
              {!autonomousRunning&&pauseSummary&&<div className="mt-3 rounded-xl bg-muted/25 px-3 py-2.5 text-xs leading-5 text-foreground/70">Пошук на паузі. Прогрес збережено — «Продовжити» почне з того ж кроку.</div>}
              {/* oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- TODO: потребує зміни розмітки (docs/TODO.md) */}
              {localPreview.sourceIssues.length>0&&<details role="status" className="mt-3 rounded-xl border border-amber-500/30 bg-amber-500/5">
                <summary className="cursor-pointer select-none px-3 py-2.5 text-xs font-semibold text-foreground">
                  {autonomousRunning?'Деякі джерела тимчасово недоступні':'Пошук зупинено: потрібна твоя дія'}
                </summary>
                <div className="border-t border-amber-500/20 px-3 py-2.5 text-xs leading-5 text-foreground/70">
                  {autonomousRunning?'Пошук продовжується за доступними джерелами. Нічого робити не потрібно.':'Виправ причину нижче й натисни «Продовжити пошук» — він почнеться з того ж кроку.'}
                  <details className="mt-2">
                    <summary className="cursor-pointer select-none text-[11px] text-muted-foreground">Технічні причини</summary>
                    <div className="mt-1 grid gap-1">
                      {localPreview.sourceIssues.map((issue,index)=><div key={index} className="break-words">{issue.query} · {reasonLabel(issue.reason)}</div>)}
                    </div>
                  </details>
                </div>
              </details>}
              <details className="mt-3 border-t border-border/60 pt-3">
                <summary className="cursor-pointer select-none text-xs font-medium text-muted-foreground">Дані пошуку</summary>
                <div className="mt-2 grid gap-1.5 text-xs text-foreground/70">
                  <p className="text-[11px] text-muted-foreground">Технічні деталі — для довідки, стежити не обов&apos;язково.</p>
                  <div className="flex items-center justify-between gap-3">
                    <span>Перевірено запитів пошуку <strong className="ml-1 text-foreground">{localPreview.telegramCursor}/{localPreview.sourceTotal||'—'}</strong></span>
                    <span>Дублі <strong className="ml-1 text-foreground">{localPreview.duplicates}</strong></span>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <span>Перевірено у WhatsApp <strong className="ml-1 text-foreground">{localChecked}</strong></span>
                    <span>Активність <strong className="ml-1 text-foreground">{formatActivityTime(localPreview.lastActivityAt)}</strong></span>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <span>У черзі на WhatsApp <strong className="ml-1 text-foreground">{queuedCount(localPreview,Date.now())}/{SOURCE_TARGET_QUEUE}</strong></span>
                  </div>
                </div>
              </details>
            </section>

            <details className="rounded-2xl border border-border/70 bg-background">
              <summary className="cursor-pointer select-none px-4 py-3 text-xs font-medium text-muted-foreground hover:text-foreground">Підключення WhatsApp</summary>
              <div className="border-t border-border/70 p-3"><ChatDiscoveryExecutorPanel /></div>
            </details>

          </div>
        </div>

        <section className="flex min-h-[480px] min-w-0 flex-col bg-background lg:min-h-0" aria-label="Кандидати">
          <div className="border-b border-border/70 bg-background px-4 py-3 sm:px-5 sm:py-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="text-base font-semibold">Результати пошуку</h3>
                <p className="mt-0.5 text-xs text-foreground/65">До «Підтвердити» та «Архівувати всі» результати живуть лише в цій вкладці браузера.</p>
              </div>
              {filter==='rejected'&&localNonTargets.length>0&&<Button type="button" size="sm" variant="outline" disabled={telegramBusy} onClick={()=>void archiveAllNonTargets()}>
                {telegramBusy?<LoaderCircle data-icon="inline-start"/>:null}Архівувати всі ({localNonTargets.length})
              </Button>}
            </div>
            <div className="mt-3 flex flex-wrap gap-1.5" role="tablist" aria-label="Фільтр кандидатів">
              {([
                ['active', 'В роботі', localQueued+localManualReview],
                ['target', 'Готові підтвердити', localTargets.length],
                ['rejected', 'Нецільові', localNonTargets.length],
                ['history', 'Історія Work OS', filter==='history'?workspace.candidates.length:null],
              ] as Array<[DecisionFilter, string, number|null]>).map(([key, label, count]) =>
                <button
                  key={key}
                  type="button"
                  role="tab"
                  aria-selected={filter === key}
                  disabled={loading}
                  onClick={() => changeFilter(key)}
                  className={`min-h-11 shrink-0 rounded-lg border px-2.5 py-1.5 text-xs font-semibold transition-colors sm:min-h-8 ${filter === key ? 'border-primary/40 bg-primary/10 text-primary' : 'border-border/70 bg-background text-foreground/70 hover:bg-muted/40 hover:text-foreground'}`}
                >
                  {label}{count!==null&&<span className="ml-1 tabular-nums">{count}</span>}
                </button>)}
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto bg-muted/10 p-3 sm:p-4">
            {loading&&displayCandidates.length>0?<WorkspaceInlineLoading label="Оновлюємо підтверджених кандидатів…"/>:null}
            {loading&&displayCandidates.length===0
              ? <WorkspaceInlineLoading label="Завантажуємо кандидатів…"/>
              : displayCandidates.length
                ? <div className="grid gap-3">
                  {displayCandidates.map(candidate => {
                    const criteria = candidateCriteria(candidate);
                    const status = candidateStatus(candidate);
                    const confirmedCriteria=criteria.filter(item=>item.state==='ok').length;
                    return <article key={candidate.id} className="min-w-0 rounded-2xl border border-border bg-background p-4 sm:p-5">
                      <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                        <div className="min-w-0">
                          <h4 className="break-words text-base font-semibold leading-snug">{candidateDisplayName(candidate)}</h4>
                          <p className="mt-1 text-sm leading-5 text-foreground/70">{status.detail}</p>
                          <div className="mt-2 flex flex-wrap items-center gap-1.5">
                            <Badge variant={candidate.decision==='target'?'default':'secondary'}>{status.label}</Badge>
                            {candidate.membershipState==='pending'&&<Badge variant="outline">Очікує вступу</Badge>}
                            {candidate.membershipState==='joined'&&<Badge variant="outline">Приєднано</Badge>}
                          </div>
                        </div>
                        {status.busy&&<LoaderCircle className="size-4 shrink-0 animate-spin text-primary"/>}
                      </div>

                      <details className="mt-3 rounded-xl border border-border/70 bg-muted/10">
                        <summary className="cursor-pointer select-none px-3 py-2.5 text-xs font-semibold text-foreground/75">
                          Деталі перевірки · {confirmedCriteria} із {criteria.length}
                        </summary>
                        <div className="border-t border-border/60 p-3">
                          <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
                            {criteria.map(item => <Criterion key={item.label} {...item} />)}
                          </div>
                        </div>
                      </details>

                      <div className="mt-3 flex flex-wrap items-center gap-2 [&>button]:min-h-11 sm:[&>button]:min-h-8">
                        <a className="inline-flex h-11 items-center gap-1.5 rounded-[9px] border border-border bg-background px-2.5 text-[0.8rem] font-semibold hover:bg-muted sm:h-8" href={candidate.link} target="_blank" rel="noreferrer">
                          Відкрити {platformLabel(candidate.platform)} <ExternalLink className="size-3.5"/>
                        </a>
                        {!candidate.importedChatId && isLocalPreview(candidate) && (candidate.decision==='rejected'
                          ||(candidate.decision==='unavailable'&&candidate.reasonCodes.some(reason=>['qualification_incomplete','paused_unverified','retry_exhausted'].includes(reason))))
                          &&<Button type="button" size="sm" variant="outline" disabled={localPreview.running||telegramBusy} onClick={()=>retryIncompleteCandidate(candidate)}>Повторити перевірку</Button>}
                        {!candidate.importedChatId && candidate.decision==='review' && !isLocalPreview(candidate) && <>
                          <Button type="button" size="sm" disabled={importingId !== null || inspectingId !== null} onClick={() => void importCandidate(candidate)}>
                            {importingId === candidate.id ? <LoaderCircle data-icon="inline-start"/> : null}
                            Додати на ручну перевірку
                          </Button>
                          <Button type="button" size="sm" variant="ghost" disabled={importingId !== null || inspectingId !== null} onClick={() => void archiveCandidate(candidate)}>
                            {inspectingId === candidate.id ? <LoaderCircle data-icon="inline-start"/> : null}
                            Відхилити
                          </Button>
                          <details>
                            <summary className="flex min-h-11 cursor-pointer select-none items-center rounded-lg px-2.5 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground sm:min-h-8">Ще</summary>
                            <div className="mt-2">
                              <Button type="button" size="sm" variant="outline" disabled={inspectingId !== null} onClick={() => void markInviteInvalid(candidate)}>
                                {inspectingId === candidate.id ? <LoaderCircle data-icon="inline-start"/> : null}
                                Invite недійсний
                              </Button>
                            </div>
                          </details>
                        </>}
                        {!candidate.importedChatId && isLocalPreview(candidate) && candidate.preflightState==='review' && <>
                          {isPendingApprovalCandidate(candidate) && <Button type="button" size="sm" disabled={importingId !== null || inspectingId !== null} title="Запит на вступ уже надіслано — чат піде в чергу «Очікування» до схвалення адміністратора." onClick={() => void importCandidate(candidate)}>
                            {importingId === candidate.id ? <LoaderCircle data-icon="inline-start"/> : null}
                            Підтвердити
                          </Button>}
                          <Button type="button" size="sm" variant="ghost" title="Перенесе чат у «Нецільові» лише в цій вкладці; у Work OS — після «Архівувати всі»." onClick={() => moveToNonTarget(candidate)}>
                            У нецільові
                          </Button>
                        </>}
                        {!candidate.importedChatId && candidate.decision==='target' && <>
                          <Button type="button" size="sm" disabled={importingId !== null || inspectingId !== null} onClick={() => void importCandidate(candidate)}>
                            {importingId === candidate.id ? <LoaderCircle data-icon="inline-start"/> : null}
                            {isLocalPreview(candidate)?'Підтвердити':'Лишити в роботі'}
                          </Button>
                          <Button type="button" size="sm" variant="outline" disabled={importingId !== null || inspectingId !== null} onClick={() => void archiveCandidate(candidate)}>
                            {inspectingId === candidate.id ? <LoaderCircle data-icon="inline-start"/> : null}
                            {isLocalPreview(candidate)?'У нецільові':'В архів'}
                          </Button>
                        </>}
                        {candidate.importedChatId && candidate.membershipState !== 'left' &&
                          <Button type="button" size="sm" variant="outline" onClick={() => toggleManualInspection(candidate)}>
                            {manualDraft?.candidateId === candidate.id ? 'Закрити кваліфікацію' : 'Кваліфікувати вручну'}
                          </Button>}
                      </div>

                      {manualDraft?.candidateId === candidate.id && candidate.importedChatId && candidate.membershipState !== 'left' && <div className="mt-3 grid gap-3 rounded-xl border border-border/70 bg-muted/20 p-3">
                        <div className="flex items-center gap-2">
                          <CheckCircle2 className="size-4 text-primary"/>
                          <strong className="text-sm">Ручна кваліфікація</strong>
                        </div>
                        <div className="grid gap-2 sm:grid-cols-2">
                          <label className="grid gap-1 text-xs font-medium">Учасники
                            <Input type="number" min={0} max={10_000_000} value={manualDraft.memberCount} onChange={event => setManualDraft({...manualDraft, memberCount:event.target.value})} placeholder="700–18000" />
                          </label>
                          <label className="grid gap-1 text-xs font-medium">Активність
                            <select className="h-9 rounded-md border border-input bg-background px-2" value={manualDraft.activityState} onChange={event => setManualDraft({...manualDraft, activityState:event.target.value as ManualInspectionDraft['activityState']})}>
                              <option value="unknown">Невідомо</option><option value="active">Активний</option><option value="dead">Неактивний</option>
                            </select>
                          </label>
                          <label className="grid gap-1 text-xs font-medium">Писати можуть учасники
                            <select className="h-9 rounded-md border border-input bg-background px-2" value={manualDraft.canWrite} onChange={event => setManualDraft({...manualDraft, canWrite:event.target.value as ManualInspectionDraft['canWrite']})}>
                              <option value="unknown">Невідомо</option><option value="yes">Так</option><option value="no">Ні</option>
                            </select>
                          </label>
                          <label className="grid gap-1 text-xs font-medium">Оголошення
                            <select className="h-9 rounded-md border border-input bg-background px-2" value={manualDraft.adsPolicy} onChange={event => setManualDraft({...manualDraft, adsPolicy:event.target.value as ManualInspectionDraft['adsPolicy']})}>
                              <option value="unknown">Невідомо</option><option value="operator_confirmed">Дозволені</option><option value="forbidden">Заборонені</option>
                            </select>
                          </label>
                          <label className="grid gap-1 text-xs font-medium">Аудиторія
                            <select className="h-9 rounded-md border border-input bg-background px-2" value={manualDraft.topicMatch} onChange={event => setManualDraft({...manualDraft, topicMatch:event.target.value as ManualInspectionDraft['topicMatch']})}>
                              <option value="unknown">Невідомо</option><option value="match">Цільова</option><option value="mismatch">Нецільова</option>
                            </select>
                          </label>
                          <label className="grid gap-1 text-xs font-medium">Вступ
                            <select className="h-9 rounded-md border border-input bg-background px-2" value={manualDraft.membershipState} onChange={event => setManualDraft({...manualDraft, membershipState:event.target.value as ManualInspectionDraft['membershipState']})}>
                              <option value="not_checked">Не перевірено</option><option value="pending">Очікує схвалення</option><option value="joined">Приєднано</option>
                            </select>
                          </label>
                          <label className="grid gap-1 text-xs font-medium">Тип чату
                            <select className="h-9 rounded-md border border-input bg-background px-2" value={manualDraft.chatType} onChange={event => setManualDraft({...manualDraft, chatType:event.target.value as ManualInspectionDraft['chatType']})}>
                              <option value="unknown">Невідомо</option><option value="group">Група</option><option value="community">Спільнота</option><option value="channel">Канал</option>
                            </select>
                          </label>
                        </div>
                        <Button type="button" size="sm" className="w-fit" disabled={inspectingId !== null} onClick={() => void submitManualInspection(candidate)}>
                          {inspectingId === candidate.id ? <LoaderCircle data-icon="inline-start"/> : null}
                          Зберегти кваліфікацію
                        </Button>
                      </div>}
                    </article>;
                  })}
                </div>
                : <div className="workspace-empty"><Search aria-hidden="true"/><strong>{emptyCopy.title}</strong><p>{emptyCopy.detail}</p></div>}
          </div>
        </section>
      </div>
    </DialogContent>
  </Dialog>;
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

function emptyCandidateCopy(filter:DecisionFilter,running:boolean,queued:number,checked:number){
  if(filter==='active')return running
    ?{title:'Шукаємо в Telegram-групах',detail:`У черзі ${queued}, уже перевірено ${checked}. Знайдені WhatsApp-запрошення з’являться тут.`}
    :{title:'Нічого не в роботі',detail:'Запусти або продовж автопошук.'};
  if(filter==='target')return {title:'Цільових чатів поки немає',detail:'Тут з’являться чати, де всі критерії підтверджені в WhatsApp.'};
  if(filter==='rejected')return {title:'Нецільових немає',detail:'Тут з’являться відсіяні чати з причинами.'};
  return {title:'Історія порожня',detail:'Підтверджені й архівовані чати Work OS з’являться тут.'};
}

type CriterionItem = { label: string; value: string; state: 'ok' | 'warn' | 'bad' };

function Criterion({ label, value, state }: CriterionItem) {
  const dot = state === 'ok'
    ? 'bg-emerald-500'
    : state === 'bad'
      ? 'bg-destructive'
      : 'bg-amber-500';
  return <div className="min-w-0 rounded-xl border border-border/80 bg-background px-3 py-2.5">
    <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wide text-foreground/65"><span className={`size-1.5 shrink-0 rounded-full ${dot}`}/><span className="truncate">{label}</span></div>
    <div className="mt-1 break-words text-sm font-semibold leading-4 text-foreground">{value}</div>
  </div>;
}

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
