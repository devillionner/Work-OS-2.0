'use client';

import { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, CircleAlert, ExternalLink, LoaderCircle, Search, Square, X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { ChatDiscoveryExecutorPanel } from '@/components/chat-discovery-executor-panel';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import type { DiscoveryCandidate, DiscoveryDecision, DiscoveryRun } from '@/lib/chat-discovery/domain';
import type { DiscoveryPlatform, TelegramSearchPlan } from '@/lib/chat-discovery/public-web';
import type { LocalDiscoveryPreview } from '@/lib/chat-discovery/local-preview';
import chatDiscoverySeeds from '@/lib/chat-discovery/seeds';
import { WorkspaceInlineLoading } from '@/components/workspace-load-state';

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
type PreviewTelegramResponse = { previews:LocalDiscoveryPreview[]; batch:{extracted:number;added:number;duplicates:number}; error?:string };
type LocalPreviewSession = {
  runId?:string;
  sourceTotal:number;
  sourceErrors:number;
  sourceFailures:number;
  sourceIssues:Array<{reason:string;query:string}>;
  telegramCursor:number;
  discoveryMetrics?:{completed:number;targets:number;totalCheckMs:number;reasons:Record<string,number>};
  sourceCursor:number;
  searched:number;
  processed:number;
  duplicates:number;
  rejected:number;
  emptySourceBatches:number;
  done:boolean;
  running:boolean;
  sourceExhausted:boolean;
  goal:number;
  lastActivityAt:number|null;
  completionReason:'goal_reached'|'sources_exhausted'|'source_error'|null;
  candidates:LocalDiscoveryPreview[];
  activeCandidateId?:string|null;
  activeCandidateName?:string|null;
  activeCandidateLink?:string|null;
  activeCandidateStartedAt?:number|null;
  lastCheckedName?:string|null;
  lastCheckedDecision?:'target'|'rejected'|'skipped'|'unavailable'|null;
  lastCheckedAt?:number|null;
  lastCheckedReasonCodes?:string[];
  pauseSummary?:{
    at:number;
    cursor:number;
    targets:number;
    rejected:number;
    skipped:number;
    unavailable:number;
    unverified:number;
    archiveFailed:number;
  }|null;
};
type LocalPreflightPayload={
  decision:'target'|'rejected'|'skipped'|'unavailable';
  reasonCodes:string[];
  result:Record<string,unknown>;
  leftAfterCheck?:boolean;
  leaveReason?:string|null;
  completedAt:number;
};
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
type DecisionFilter = 'all' | 'waiting-whatsapp' | DiscoveryDecision;

const EMPTY_COUNTS: Record<DiscoveryDecision, number> = {
  review: 0,
  target: 0,
  rejected: 0,
  unavailable: 0,
};
const LOCAL_PREVIEW_KEY='work-os:chat-discovery-local-preview:v3';
const LOCAL_PREFLIGHT_RESULTS_KEY='work-os:chat-discovery-local-preflight-results:v1';
const LOCAL_SOURCE_SEEDS_KEY='work-os:chat-discovery-source-seeds:v1';
const LOCAL_SOURCE_START_CURSOR=15;
const EMPTY_LOCAL_PREVIEW:LocalPreviewSession={
  sourceTotal:0,sourceErrors:0,sourceFailures:0,sourceIssues:[],
  telegramCursor:0,sourceCursor:0,searched:0,processed:0,duplicates:0,rejected:0,emptySourceBatches:0,
  done:false,running:false,sourceExhausted:false,goal:50,lastActivityAt:null,completionReason:null,candidates:[],
};

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
  const platforms: DiscoveryPlatform[] = ['whatsapp'];
  const [goal, setGoal] = useState(50);
  const minMembers = 700;
  const [filter, setFilter] = useState<DecisionFilter>('review');
  const [clockMs,setClockMs]=useState(()=>Date.now());
  const [loading, setLoading] = useState(false);
  const [importingId, setImportingId] = useState<string | null>(null);
  const [inspectingId, setInspectingId] = useState<string | null>(null);
  const [manualDraft, setManualDraft] = useState<ManualInspectionDraft | null>(null);
  const [telegramBusy, setTelegramBusy] = useState(false);
  const [pausing,setPausing]=useState(false);
  const [telegramText, setTelegramText] = useState('');
  const [telegramSourceTitle, setTelegramSourceTitle] = useState('');
  const [telegramSourceUrl, setTelegramSourceUrl] = useState('');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [localPreview,setLocalPreview]=useState<LocalPreviewSession>(EMPTY_LOCAL_PREVIEW);
  const [localPreviewHydrated,setLocalPreviewHydrated]=useState(false);
  const telegramHasInvite = /(?:https?:\/\/)?chat\.whatsapp\.com\//iu.test(telegramText.replaceAll('\\/', '/'));

  const load = useCallback(async (decision: DecisionFilter = filter, options: { silent?: boolean } = {}) => {
    const silent=options.silent===true;
    if(!silent){
      setLoading(true);
      setError('');
    }
    try {
      const params = new URLSearchParams({ limit: '60' });
      if (decision === 'waiting-whatsapp') params.set('waitingWhatsApp', '1');
      else if (decision !== 'all') params.set('decision', decision);
      const response = await fetch(`/api/chat-discovery?${params}`, { cache: 'no-store' });
      const body = await response.json() as Workspace;
      if (!response.ok) throw new Error(body.error || 'Не вдалося завантажити пошук чатів.');
      setWorkspace(body);
      return body;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Не вдалося завантажити пошук чатів.');
      return null;
    } finally {
      if(!silent)setLoading(false);
    }
  }, [filter]);

  useEffect(() => {
    if (!open) return;
    const timer = setTimeout(() => { void load(); }, 0);
    return () => clearTimeout(timer);
  }, [open, load]);

  useEffect(()=>{
    if(!open)return;
    const timer=window.setInterval(()=>setClockMs(Date.now()),1000);
    return()=>window.clearInterval(timer);
  },[open]);

  useEffect(()=>{
    setLocalPreview(readLocalPreviewSession());
    setLocalPreviewHydrated(true);
  },[]);

  useEffect(()=>{
    if(!localPreviewHydrated)return;
    try{window.sessionStorage.setItem(LOCAL_PREVIEW_KEY,JSON.stringify(localPreview));}catch{}
  },[localPreviewHydrated,localPreview]);

  useEffect(()=>{
    if(!localPreviewHydrated)return;
    const timer=window.setInterval(()=>{
      let results:Record<string,LocalPreflightPayload>={};
      try{results=JSON.parse(window.sessionStorage.getItem(LOCAL_PREFLIGHT_RESULTS_KEY)||'{}') as Record<string,LocalPreflightPayload>;}catch{}
      if(!Object.keys(results).length)return;
      setLocalPreview(current=>applyLocalPreflightResults(current,results));
    },750);
    return()=>window.clearInterval(timer);
  },[localPreviewHydrated]);

  useEffect(()=>{
    if(!localPreviewHydrated||!localPreview.running)return;
    const targetCount=localPreview.candidates.filter(candidate=>candidate.preflightState==='target').length;
    if(targetCount>=localPreview.goal){
      setLocalPreview(current=>({...current,running:false,done:true,completionReason:'goal_reached',lastActivityAt:Date.now()}));
      return;
    }
    const queuedCount=localPreview.candidates.filter(candidate=>candidate.preflightState==='queued').length;
    if(localPreview.sourceExhausted&&queuedCount===0){
      setLocalPreview(current=>({...current,running:false,done:true,completionReason:'sources_exhausted',lastActivityAt:Date.now()}));
    }
  },[localPreviewHydrated,localPreview.running,localPreview.goal,localPreview.sourceExhausted,localPreview.candidates]);

  useEffect(()=>{
    if(!localPreviewHydrated)return;
    // Keep the private source plan browser-local and refresh it after F5/deploy so an
    // already-running local Discovery session can continue without any D1/API read.
    try{window.sessionStorage.setItem(LOCAL_SOURCE_SEEDS_KEY,JSON.stringify(chatDiscoverySeeds));}
    catch{}
  },[localPreviewHydrated]);

  useEffect(()=>{
    if(!localPreviewHydrated)return;
    const sync=()=>setLocalPreview(readLocalPreviewSession());
    window.addEventListener('work-os:chat-discovery-local-update',sync);
    return()=>window.removeEventListener('work-os:chat-discovery-local-update',sync);
  },[localPreviewHydrated]);

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

  async function startAutonomousSearch() {
    if(telegramBusy)return;
    setError('');
    setNotice('');
    try{window.sessionStorage.setItem(LOCAL_SOURCE_SEEDS_KEY,JSON.stringify(chatDiscoverySeeds));}
    catch{setError('Не вдалося підготувати локальний план пошуку в цій вкладці.');return;}
    if(localPreview.completionReason==='source_error'){
      setLocalPreview(current=>({...current,running:true,done:false,sourceFailures:0,sourceIssues:[],completionReason:null,pauseSummary:null,lastActivityAt:Date.now()}));
      setNotice('Продовжуємо з запиту, який не вдалося виконати.');
      return;
    }
    if(localPreview.pauseSummary&&!localPreview.done){
      try{window.sessionStorage.removeItem(LOCAL_PREFLIGHT_RESULTS_KEY);}catch{}
      const resumed:LocalPreviewSession={
        ...localPreview,
        runId:crypto.randomUUID(),
        running:true,
        done:false,
        completionReason:null,
        pauseSummary:null,
        activeCandidateId:null,
        activeCandidateName:null,
        activeCandidateLink:null,
        activeCandidateStartedAt:null,
        lastActivityAt:Date.now(),
      };
      try{window.sessionStorage.setItem(LOCAL_PREVIEW_KEY,JSON.stringify(resumed));}
      catch{setError('Не вдалося відновити локальний автопошук у браузерній сесії.');return;}
      setLocalPreview(resumed);
      window.dispatchEvent(new CustomEvent('work-os:chat-discovery-local-update'));
      setFilter('all');
      setNotice(`Продовжуємо з позиції ${resumed.telegramCursor}. Уже відомі invite повторно не перевіряються.`);
      return;
    }
    setFilter('all');
    try{window.sessionStorage.removeItem(LOCAL_PREFLIGHT_RESULTS_KEY);}catch{}
    const nextRun:LocalPreviewSession={
      ...EMPTY_LOCAL_PREVIEW,
      runId:crypto.randomUUID(),
      running:true,
      goal,
      telegramCursor:LOCAL_SOURCE_START_CURSOR,
      sourceCursor:LOCAL_SOURCE_START_CURSOR,
      lastActivityAt:Date.now(),
    };
    // The external runner reads sessionStorage directly through CDP. Persist the
    // run synchronously before React scheduling so the UI cannot show "running"
    // while the runner still sees the previous stopped state.
    try{window.sessionStorage.setItem(LOCAL_PREVIEW_KEY,JSON.stringify(nextRun));}
    catch{setError('Не вдалося записати стан автопошуку в браузерну сесію.');return;}
    setLocalPreview(nextRun);
    window.dispatchEvent(new CustomEvent('work-os:chat-discovery-local-update'));
    setNotice('');
  }

  async function stopAutonomousSearch(){
    if(telegramBusy)return;
    setPausing(true);
    const current=readLocalPreviewSession();
    const candidates=current.candidates;
    const stopped:LocalPreviewSession={
      ...current,running:false,activeCandidateId:null,activeCandidateName:null,
      activeCandidateLink:null,activeCandidateStartedAt:null,lastActivityAt:Date.now(),
      pauseSummary:{
        at:Date.now(),cursor:current.telegramCursor,
        targets:candidates.filter(c=>c.preflightState==='target').length,
        rejected:candidates.filter(c=>c.preflightState==='rejected').length,
        skipped:candidates.filter(c=>c.preflightState==='skipped').length,
        unavailable:candidates.filter(c=>c.preflightState==='unavailable').length,
        unverified:candidates.filter(c=>c.preflightState==='queued').length,
        archiveFailed:0,
      },
    };
    try{
      window.sessionStorage.setItem(LOCAL_PREVIEW_KEY,JSON.stringify(stopped));
      setLocalPreview(stopped);
      window.dispatchEvent(new CustomEvent('work-os:chat-discovery-local-update'));
      setNotice('Пошук зупинено. Неперевірені чати збережено в черзі; завершені результати не повторюються.');
    }catch{setError('Не вдалося зберегти паузу.');}
    finally{setPausing(false);}
  }

  function retryIncompleteCandidate(candidate:DiscoveryCandidate){
    if(localPreview.running||telegramBusy)return;
    const recovered:LocalDiscoveryPreview={
      ...candidate,localOnly:true,preflightState:'queued',preflightReasonCodes:[],
      decision:'review',reasonCodes:[],
    };
    const current=readLocalPreviewSession();
    const next:LocalPreviewSession={
      ...current,done:false,completionReason:null,
      candidates:[...current.candidates.filter(c=>c.id!==candidate.id),recovered],
      pauseSummary:{at:Date.now(),cursor:current.telegramCursor,targets:0,rejected:0,
        skipped:0,unavailable:0,unverified:1,archiveFailed:0},
    };
    try{
      const results=JSON.parse(window.sessionStorage.getItem(LOCAL_PREFLIGHT_RESULTS_KEY)||'{}');
      delete results[candidate.id];
      window.sessionStorage.setItem(LOCAL_PREFLIGHT_RESULTS_KEY,JSON.stringify(results));
      window.sessionStorage.setItem(LOCAL_PREVIEW_KEY,JSON.stringify(next));
      setLocalPreview(next);
      setNotice('Кандидат повернуто в чергу. Натисни «Продовжити автопошук». Уже приєднаний чат перевірятиметься без повторного вступу.');
    }catch{setError('Не вдалося відновити кандидата.');}
  }

  async function addLocalTargetsToJoin(){
    const targets=localPreview.candidates.filter(candidate=>candidate.preflightState==='target');
    if(telegramBusy||localPreview.running||!targets.length)return;
    setTelegramBusy(true);
    setError('');
    setNotice('');
    const imported=new Set<string>();
    let existing=0;
    let failed=0;
    try{
      for(const candidate of targets){
        try{
          const payload=await postPreview({
            action:'confirm',
            platform:candidate.platform,
            link:candidate.link,
            name:candidate.name,
            sources:candidate.sources,
            minMembers,
            preflight:{
              status:'inspected',accessible:true,targetVerified:true,
              membershipState:'joined',observedName:candidate.name,chatType:candidate.chatType,
              memberCount:candidate.memberCount,topicMatch:candidate.topicMatch,canWrite:candidate.canWrite,
              adsPolicy:candidate.adsPolicy,activityState:candidate.activityState,
            },
          }) as unknown as ImportResponse;
          imported.add(candidate.id);
          if(payload.existing)existing+=1;
          onImported(candidate.platform as DiscoveryPlatform);
        }catch{
          failed+=1;
        }
      }
      setLocalPreview(current=>({
        ...current,
        candidates:current.candidates.filter(candidate=>!imported.has(candidate.id)),
        running:false,
      }));
      await load(filter,{silent:true});
      const added=Math.max(0,imported.size-existing);
      setNotice(`Підтверджено: ${added} фактично перевірених чатів записано в Work OS. Вони вже приєднані, тому повторний вступ не потрібен.${existing?` Уже відомих: ${existing}.`:''}${failed?` Не додано через помилку: ${failed}.`:''}`);
    }finally{
      setTelegramBusy(false);
    }
  }

  async function ingestTelegramScan(clearAfter: boolean) {
    if (telegramBusy || !telegramText.trim()) return;
    setTelegramBusy(true);
    setError('');
    setNotice('');
    try {
      const query=workspace.telegramPlan?.tasks[0]?.query||telegramSourceTitle.trim()||'Ручне Telegram-джерело';
      const payload=await postPreview({
        action:'telegram',text:telegramText,sourceUrl:telegramSourceUrl,sourceTitle:telegramSourceTitle,
        query,seedLabel:telegramSourceTitle||query,context:query,
        knownLinks:localPreview.candidates.map(candidate=>candidate.link),minMembers,
      }) as unknown as PreviewTelegramResponse;
      const merged=mergeLocalTelegramPreview(localPreview,payload);
      setLocalPreview(merged);
      setNotice(`Telegram preview: витягнуто ${payload.batch.extracted}, локально нових ${payload.batch.added}, дублів/відомих ${payload.batch.duplicates}. D1 не змінено.`);
      if(clearAfter){
        setTelegramSourceTitle('');
        setTelegramSourceUrl('');
        setTelegramText('');
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Не вдалося додати Telegram-результати в локальний preview.');
    } finally {
      setTelegramBusy(false);
    }
  }

  async function markInviteInvalid(candidate: DiscoveryCandidate) {
    if(isLocalPreview(candidate)){
      removeLocalPreview(candidate.id);
      setNotice('Локальний кандидат відкинуто. У D1 нічого не записувалось.');
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
      await load(filter);
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
      await load(filter);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Не вдалося зберегти кваліфікацію.');
      await load(filter);
    } finally {
      setInspectingId(null);
    }
  }

  async function archiveCandidate(candidate:DiscoveryCandidate){
    if(inspectingId||importingId)return;
    setInspectingId(candidate.id);
    setError('');
    try{
      let needsExternalLeave=candidate.membershipState==='joined';
      if(isLocalPreview(candidate)){
        await postPreview({
          action:'persist-outcome',
          platform:candidate.platform,
          link:candidate.link,
          name:candidate.name,
          sources:candidate.sources,
          minMembers,
          outcome:{
            decision:'rejected',
            reasonCodes:['operator_rejected'],
            result:{
              status:'inspected',
              accessible:candidate.accessState!=='unavailable',
              targetVerified:true,
              membershipState:candidate.membershipState,
              observedName:candidate.name,
              chatType:candidate.chatType,
              memberCount:candidate.memberCount,
              topicMatch:candidate.topicMatch,
              canWrite:candidate.canWrite,
              adsPolicy:candidate.adsPolicy,
              activityState:candidate.activityState,
            },
          },
        });
        removeLocalPreview(candidate.id);
      }else{
        const payload=await post({action:'archive-candidate',candidateId:candidate.id,version:candidate.version}) as {needsExternalLeave?:boolean};
        needsExternalLeave=payload.needsExternalLeave===true;
      }
      setNotice(needsExternalLeave
        ? 'Кандидат архівовано в Work OS і більше не потрапить в автопошук. Він був приєднаний — після ручного огляду вийди з цього чату у WhatsApp.'
        : 'Кандидат архівовано і більше не потрапить в автопошук.');
      await load(filter,{silent:true});
    }catch(reason){
      setError(reason instanceof Error?reason.message:'Не вдалося архівувати кандидата.');
      await load(filter,{silent:true});
    }finally{
      setInspectingId(null);
    }
  }

  async function importCandidate(candidate: DiscoveryCandidate) {
    if (importingId) return;
    setImportingId(candidate.id);
    setError('');
    try {
      if(isLocalPreview(candidate)&&candidate.preflightState!=='target')throw new Error('Спочатку дочекайся фактичної WhatsApp-перевірки цього чату.');
      const savedJoinedTarget=!isLocalPreview(candidate)
        &&candidate.decision==='target'&&!candidate.importedChatId&&candidate.membershipState==='joined';
      const useFactualConfirm=isLocalPreview(candidate)||savedJoinedTarget;
      const payload = useFactualConfirm
        ? await postPreview({
            action:'confirm',platform:candidate.platform,link:candidate.link,name:candidate.name,sources:candidate.sources,minMembers,
            preflight:{
              status:'inspected',accessible:true,targetVerified:true,membershipState:'joined',observedName:candidate.name,
              chatType:candidate.chatType,memberCount:candidate.memberCount,topicMatch:candidate.topicMatch,canWrite:candidate.canWrite,
              adsPolicy:candidate.adsPolicy,activityState:candidate.activityState,
            },
          }) as unknown as ImportResponse
        : await post({action:'import',candidateId:candidate.id,version:candidate.version}) as unknown as ImportResponse;
      if(isLocalPreview(candidate))removeLocalPreview(candidate.id);
      setNotice(payload.existing
        ? 'Чат уже був у Work OS — дубль не створено.'
        : useFactualConfirm
          ? 'Лишено в роботі: фактично перевірений чат записано як уже приєднаний і готовий.'
          : 'Підтверджено: чат записано в D1 і додано в чергу «Для приєднання».');
      onImported(candidate.platform as DiscoveryPlatform);
      await load(filter);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Не вдалося підтвердити чат.');
    } finally {
      setImportingId(null);
    }
  }

  function removeLocalPreview(id:string){
    setLocalPreview(current=>({...current,candidates:current.candidates.filter(candidate=>candidate.id!==id)}));
  }

  async function changeFilter(next: DecisionFilter) {
    setFilter(next);
    await load(next);
  }

  function close() {
    onClose();
  }

  const localTargets=localPreview.candidates.filter(candidate=>candidate.preflightState==='target');
  const localQueued=localPreview.candidates.filter(candidate=>candidate.preflightState==='queued').length;
  const localSkipped=localPreview.candidates.filter(candidate=>candidate.preflightState==='skipped').length;
  const localRejected=localPreview.candidates.filter(candidate=>candidate.preflightState==='rejected'||candidate.preflightState==='unavailable').length;
  const localChecked=localPreview.candidates.filter(candidate=>candidate.inspectionState==='inspected').length;
  const localProcessed=localPreview.candidates.length-localQueued;
  const localUnavailable=localPreview.candidates.filter(candidate=>candidate.preflightState==='unavailable').length;
  const localFailed=localPreview.candidates.filter(candidate=>candidate.preflightState==='rejected').length;
  const persistedTotal = Object.values(workspace.counts).reduce((sum, value) => sum + value, 0);
  const total = persistedTotal + localPreview.candidates.length;
  const reviewCount=workspace.counts.review+localQueued;
  const autonomousRunning=localPreview.running;
  const displayedTargetCount=localTargets.length;
  const displayedGoal=localPreview.running||localPreview.done?localPreview.goal:goal;
  const displayedQueries=localPreview.searched;
  const discardedCount=localRejected+localSkipped;
  const progressPercent=displayedGoal>0?Math.min(100,Math.round((displayedTargetCount/displayedGoal)*100)):0;
  const lastRunActivitySeconds=localPreview.lastActivityAt?Math.max(0,Math.floor((clockMs-localPreview.lastActivityAt)/1000)):null;
  const activeCandidateName=String(localPreview.activeCandidateName||'').trim();
  const pauseSummary=localPreview.pauseSummary;
  const pauseArchivedTotal=pauseSummary
    ? pauseSummary.rejected+pauseSummary.skipped+pauseSummary.unavailable
    : 0;
  const lastCheckedDecisionLabel=localPreview.lastCheckedDecision==='target'?'цільовий'
    :localPreview.lastCheckedDecision==='rejected'?'відхилений'
      :localPreview.lastCheckedDecision==='skipped'?'пропущений'
        :localPreview.lastCheckedDecision==='unavailable'?'недоступний':'';
  const runActivity=pausing
    ? 'Зупиняємо пошук · зберігаємо прогрес і архівуємо незавершені чати'
    : autonomousRunning
    ? activeCandidateName
      ? `Перевіряємо WhatsApp: ${activeCandidateName}`
      : localQueued>0
        ? `У черзі ${localQueued}: готуємо наступну WhatsApp-перевірку`
        : 'Шукаємо нові WhatsApp invite в Telegram'
    : localPreview.completionReason==='goal_reached'
      ? 'Потрібну кількість фактично перевірено — переглянь список перед записом у Work OS'
      : localPreview.completionReason==='sources_exhausted'
        ? 'План пошуку завершено'
        : localPreview.completionReason==='source_error'?'Пошук призупинено: джерело не відповідає':'Автопошук зупинений';
  const visibleLocal=localCandidatesForFilter(localPreview.candidates,filter);
  const displayCandidates:DiscoveryCandidate[]=[...visibleLocal,...workspace.candidates];

  const currentTask = workspace.telegramPlan?.tasks[0] ?? null;
  const telegramProgress = workspace.telegramPlan
    ? Math.min(100, Math.round((workspace.telegramPlan.cursor / Math.max(1, workspace.telegramPlan.totalTasks)) * 100))
    : 0;

  return <Dialog open={open} onOpenChange={next => { if (!next) close(); }}>
    <DialogContent
      className="h-[min(92dvh,920px)] w-[calc(100vw-20px)] !max-w-[1240px] !flex !flex-col gap-0 overflow-hidden !rounded-[20px] border-border/80 bg-background !p-0 shadow-xl sm:w-[calc(100vw-32px)] sm:!max-w-[1240px]"
      overlayClassName="bg-black/45 supports-backdrop-filter:backdrop-blur-[2px]"
      showCloseButton={false}
    >
      <header className="relative border-b border-border/70 bg-background px-4 py-4 sm:px-6">
        <DialogHeader className="gap-1 pr-14">
          <div className="flex flex-wrap items-center gap-2">
            <DialogTitle className="text-lg font-semibold tracking-tight sm:text-xl">Пошук нових чатів</DialogTitle>
            <Badge variant="secondary">WhatsApp discovery</Badge>
          </div>
          <DialogDescription className="max-w-3xl text-xs leading-5 text-foreground/70 sm:text-sm">
            Пошук і сирі invite працюють локально. Після фактичної WhatsApp-перевірки результат зберігається, щоб те саме посилання більше не перевіряти.
          </DialogDescription>
        </DialogHeader>
        <Button className="absolute right-3 top-3 rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground sm:right-4 sm:top-4" variant="ghost" size="icon" aria-label="Закрити" onClick={close}><X/></Button>

        <div className="mt-4 rounded-2xl border border-border/70 bg-muted/20 p-4 sm:p-5">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
            <div className="min-w-[180px]">
              <div className="flex items-center gap-2 text-xs font-semibold text-foreground/70">
                {(autonomousRunning||pausing)&&<span className="relative flex size-2">
                  <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-500 opacity-50"/>
                  <span className="relative inline-flex size-2 rounded-full bg-emerald-500"/>
                </span>}
                {pausing?'Зберігаємо паузу':autonomousRunning?'Автопошук працює':'Автопошук'}
              </div>
              <div className="mt-1 flex items-end gap-2">
                <strong className="text-3xl font-semibold tracking-tight tabular-nums text-foreground">{displayedTargetCount}</strong>
                <span className="pb-1 text-sm font-semibold text-foreground/55">із {displayedGoal} підтверджених цільових</span>
              </div>
            </div>
            <div className="min-w-0 flex-1">
              <div className="h-2.5 overflow-hidden rounded-full bg-background ring-1 ring-border/70">
                <div className="h-full rounded-full bg-primary transition-[width] duration-500" style={{width:`${progressPercent}%`}}/>
              </div>
              <div className="mt-2 flex items-start gap-2 text-sm font-medium text-foreground/80">
                {(autonomousRunning||pausing)?<LoaderCircle className="mt-0.5 size-4 shrink-0 animate-spin text-primary"/>:<CheckCircle2 className="mt-0.5 size-4 shrink-0 text-muted-foreground"/>}
                <span className="min-w-0 break-words">{runActivity}</span>
              </div>
              {autonomousRunning&&<div className="mt-1 text-xs tabular-nums text-muted-foreground">
                Пошукових запитів: <strong className="text-foreground/80">{displayedQueries}</strong>
                {' · '}короткими пакетами
                {lastRunActivitySeconds!==null&&<>{' · '}остання активність {lastRunActivitySeconds<5?'щойно':`${lastRunActivitySeconds} с тому`}</>}
              </div>}
              {localPreview.discoveryMetrics&&localPreview.discoveryMetrics.completed>0&&<div className="mt-1 text-xs text-muted-foreground">
                Завершено {localPreview.discoveryMetrics.completed} перевірок · середній час з повторними спробами {Math.round(localPreview.discoveryMetrics.totalCheckMs/localPreview.discoveryMetrics.completed/1000)} с · цільових {localPreview.discoveryMetrics.targets}
              </div>}
              {localPreview.lastCheckedName&&<div className="mt-1 text-xs text-muted-foreground">
                Остання WhatsApp-перевірка: <strong className="text-foreground/80">{localPreview.lastCheckedName}</strong>
                {lastCheckedDecisionLabel&&<>{' · '}<span className="font-semibold text-foreground/70">{lastCheckedDecisionLabel}</span></>}
              </div>}
              {!autonomousRunning&&pauseSummary&&<div key={pauseSummary.at} className="mt-3 animate-in fade-in slide-in-from-top-1 duration-300 rounded-xl border border-emerald-500/20 bg-emerald-500/5 px-3 py-2.5">
                <div className="flex items-start gap-2">
                  <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-600"/>
                  <div className="min-w-0">
                    <div className="text-xs font-semibold text-foreground">Автопошук зупинено · прогрес збережено</div>
                    <div className="mt-1 text-xs leading-5 text-muted-foreground">
                      В архіві <strong className="text-foreground/80">{pauseArchivedTotal}</strong>
                      {' · '}нецільові {pauseSummary.rejected}
                      {' · '}недоступні/пропущені {pauseSummary.unavailable+pauseSummary.skipped}
                      {pauseSummary.unverified>0&&<>{' · '}збережено в черзі {pauseSummary.unverified}</>}
                      {pauseSummary.targets>0&&<>{' · '}цільові лишились {pauseSummary.targets}</>}
                    </div>
                    <div className="mt-0.5 text-[11px] text-muted-foreground/80">
                      Наступний запуск продовжить з позиції {pauseSummary.cursor}; відомі invite повторно не перевіряються.
                    </div>
                    {pauseSummary.archiveFailed>0&&<div className="mt-1 text-[11px] font-medium text-amber-700 dark:text-amber-400">
                      Не вдалося заархівувати: {pauseSummary.archiveFailed} — вони можуть повернутися в чергу.
                    </div>}
                  </div>
                </div>
              </div>}
            </div>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-5">
            <StatTile label="Знайдено invite" value={String(localPreview.processed)} />
            <StatTile label="Повністю перевірено" value={String(localChecked)} />
            <StatTile label="Оброблено кандидатів" value={String(localProcessed)} />
            <StatTile label="Цільові" value={String(localTargets.length)} />
            <StatTile label="Відсіяно / пропущено" value={String(discardedCount)} />
            <StatTile label="Дублі / відомі" value={String(localPreview.duplicates)} />
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
                  <h3 className="text-base font-semibold">Керування</h3>
                  <p className="mt-1 text-xs leading-5 text-foreground/70">{autonomousRunning?'Пошук джерел локальний; фінальні outcomes зберігаються як dedupe-історія.':'Вкажи, скільки фактично цільових чатів потрібно знайти й перевірити.'}</p>
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
                    onChange={event => setGoal(clampNumber(event.target.value, 1, 100, 50))}
                  />
                </label>
                <details className="rounded-xl border border-border/70 bg-background">
                  <summary className="cursor-pointer select-none px-3 py-2.5 text-xs font-semibold text-foreground/75">Що вважаємо цільовим чатом</summary>
                  <div className="border-t border-border/60 px-3 py-2.5 text-xs leading-5 text-foreground/70">
                    Work OS відсіює дублі й невалідні invite, відкриває потенційні чати у WhatsApp та вступає лише коли доступний прямий вступ. Чати з approval/request-to-join пропускаються. Після вступу система підтверджує 700–18 000 учасників, українську аудиторію, активність, можливість писати й правила оголошень.
                  </div>
                </details>
              </div>

              <div className="mt-4 grid gap-2">
                {autonomousRunning||pausing
                  ? <Button className="w-full justify-center" type="button" variant="outline" disabled={telegramBusy} onClick={() => void stopAutonomousSearch()}>
                      {pausing?<LoaderCircle data-icon="inline-start"/>:<Square data-icon="inline-start"/>}{pausing?'Зберігаємо паузу…':'Зупинити автопошук'}
                    </Button>
                  : <Button className="w-full justify-center" type="button" disabled={telegramBusy} onClick={() => void startAutonomousSearch()}>
                      {telegramBusy?<LoaderCircle data-icon="inline-start"/>:<Search data-icon="inline-start"/>}{telegramBusy?'Запускаємо…':localPreview.pauseSummary&&!localPreview.done?'Продовжити автопошук':localPreview.completionReason==='source_error'?'Продовжити пошук':'Запустити автопошук'}
                    </Button>}
                {!autonomousRunning&&localTargets.length>0&&<Button className="w-full justify-center" type="button" disabled={telegramBusy} onClick={()=>void addLocalTargetsToJoin()}>
                  {telegramBusy?<LoaderCircle data-icon="inline-start"/>:<CheckCircle2 data-icon="inline-start"/>}{telegramBusy?'Записуємо…':`Додати ${localTargets.length} цільових у Work OS`}
                </Button>}
                {localPreview.candidates.length>0&&<Button className="w-full" type="button" size="sm" variant="ghost" disabled={telegramBusy} onClick={()=>setLocalPreview({...EMPTY_LOCAL_PREVIEW,goal})}>Очистити локальні результати</Button>}
              </div>

              {autonomousRunning&&<div className="mt-3 rounded-xl border border-primary/20 bg-primary/5 px-3 py-2.5 text-xs font-medium leading-5 text-foreground/80">
                Система сама перевіряє потенційні invite. Target зберігається для твого ручного огляду; нецільові й недоступні — у постійний архів. Сирі invite в D1 не пишуться.
              </div>}
              {localPreview.completionReason==='sources_exhausted'&&<div className="mt-3 rounded-xl border border-border/70 bg-muted/20 px-3 py-2.5 text-xs leading-5 text-foreground/75">План пошуку завершено: фактично підтверджено {localTargets.length} із {localPreview.goal}. Фінальні outcomes уже збережені для dedupe.</div>}
              {localPreview.completionReason==='goal_reached'&&<div className="mt-3 rounded-xl border border-emerald-500/30 bg-emerald-500/5 px-3 py-2.5 text-xs font-semibold leading-5 text-foreground">Готово: фактично підтверджено {localTargets.length}/{localPreview.goal} цільових чатів. Вони збережені для ручного огляду — виріши, які лишити в роботі.</div>}
              {localPreview.sourceIssues.length>0&&<div role="status" className="mt-3 rounded-xl border border-amber-500/30 bg-amber-500/5 p-3 text-xs leading-5">
                <strong>Не вдалося прочитати джерело. Цей запит не пропущено.</strong>
                <p>{localPreview.running?'Повторимо зі затримкою. Перевірка вже знайдених чатів продовжується.':'Натисни «Продовжити пошук», щоб повторити з цього місця.'}</p>
                {localPreview.sourceIssues.map((issue,index)=><div key={index} className="mt-1 break-words">{issue.query} · {reasonLabel(issue.reason)}</div>)}
              </div>}
              <details className="mt-3 border-t border-border/60 pt-3">
                <summary className="cursor-pointer select-none text-xs font-medium text-muted-foreground">Технічні деталі</summary>
                <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
                  <span>Пошукових запитів <strong className="ml-1 text-foreground">{displayedQueries}</strong></span>
                  <span>Пройдено плану <strong>{localPreview.telegramCursor} / {localPreview.sourceTotal||'—'}</strong></span>
                  <span>Помилок джерел <strong>{localPreview.sourceErrors}</strong></span>
                  <span>Дублів <strong className="ml-1 text-foreground">{localPreview.duplicates}</strong></span>
                  <span>У локальній черзі WhatsApp <strong className="ml-1 text-foreground">{localQueued}</strong></span>
                  <span>Persistent dedupe <strong className="ml-1 text-foreground">увімкнено</strong></span>
                </div>
              </details>
            </section>

            <details className="rounded-2xl border border-border/70 bg-background">
              <summary className="cursor-pointer select-none px-4 py-3 text-xs font-medium text-muted-foreground hover:text-foreground">Локальний WhatsApp executor</summary>
              <div className="border-t border-border/70 p-3"><ChatDiscoveryExecutorPanel /></div>
            </details>

            <details className="rounded-2xl border border-border/70 bg-background">
              <summary className="cursor-pointer select-none px-4 py-3 text-xs font-medium text-muted-foreground hover:text-foreground">Ручне джерело з Telegram</summary>
              <div className="border-t border-border/70 p-4">
                <section className="rounded-2xl border border-border/70 bg-background p-4 shadow-sm" aria-label="Telegram джерело WhatsApp">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h3 className="font-semibold">Telegram → WhatsApp</h3>
                      <p className="mt-1 text-xs text-muted-foreground">Працюй по одному query. Для нього можна зберегти кілька Telegram-джерел.</p>
                    </div>
                    {workspace.telegramPlan && <Badge variant="outline">{workspace.telegramPlan.cursor} / {workspace.telegramPlan.totalTasks}</Badge>}
                  </div>

                  {workspace.telegramPlan && <div className="mt-4 rounded-xl border border-border/70 bg-muted/25 p-3">
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <span className="text-xs font-semibold">Черга Telegram-запитів</span>
                      <span className="text-[11px] tabular-nums text-muted-foreground">{workspace.telegramPlan.cursor} / {workspace.telegramPlan.totalTasks}</span>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                      <div className="h-full rounded-full bg-primary transition-[width]" style={{ width: `${telegramProgress}%` }} />
                    </div>
                    {currentTask ? <div className="mt-3">
                      <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Поточний query · {currentTask.cursor + 1}</div>
                      <div className="mt-1 break-words text-base font-semibold">{currentTask.query}</div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        {currentTask.seedKind === 'city' ? currentTask.city : currentTask.country} · {currentTask.template}
                      </div>
                      {workspace.telegramPlan.tasks.length > 1 && <details className="mt-3">
                        <summary className="cursor-pointer select-none text-xs font-medium text-muted-foreground">Наступні query · {workspace.telegramPlan.tasks.length - 1}</summary>
                        <div className="mt-2 grid gap-1.5 border-l border-border pl-3 text-xs text-muted-foreground">
                          {workspace.telegramPlan.tasks.slice(1).map(task => <div key={task.cursor}>{task.cursor + 1}. {task.query}</div>)}
                        </div>
                      </details>}
                    </div> : <p className="mt-3 text-sm text-muted-foreground">Keyword plan завершено.</p>}
                  </div>}

                  <div className="mt-4 grid gap-3 sm:grid-cols-2">
                    <label className="grid gap-1.5 text-xs font-medium" htmlFor="telegram-source-title">
                      Telegram-чат
                      <Input id="telegram-source-title" required={telegramHasInvite} value={telegramSourceTitle} disabled={telegramBusy} onChange={event => setTelegramSourceTitle(event.target.value)} placeholder="Українці в Берліні" />
                    </label>
                    <label className="grid gap-1.5 text-xs font-medium" htmlFor="telegram-source-url">
                      Посилання на джерело
                      <Input id="telegram-source-url" type="url" required={telegramHasInvite} value={telegramSourceUrl} disabled={telegramBusy} onChange={event => setTelegramSourceUrl(event.target.value)} placeholder="https://t.me/…" />
                    </label>
                  </div>

                  <label className="mt-3 grid gap-1.5 text-xs font-medium" htmlFor="telegram-query">
                    Поточний query
                    <Input id="telegram-query" value={currentTask?.query || ''} readOnly aria-readonly="true" disabled={telegramBusy} placeholder="Спочатку запусти Telegram-пошук" />
                  </label>

                  <label className="mt-3 grid gap-1.5 text-xs font-medium" htmlFor="telegram-scan">
                    Результати пошуку Telegram
                    <Textarea id="telegram-scan" rows={5} value={telegramText} disabled={telegramBusy} onChange={event => setTelegramText(event.target.value)} placeholder="Встав текст повідомлень або результатів пошуку з chat.whatsapp.com…" />
                  </label>

                  {telegramHasInvite && (!telegramSourceTitle.trim() || !telegramSourceUrl.trim()) && <div className="mt-2 flex items-center gap-2 text-xs font-semibold text-foreground">
                    <CircleAlert className="size-3.5"/> Для invite вкажи назву Telegram-чату та посилання на джерело.
                  </div>}

                  <div className="mt-4 grid gap-2 sm:grid-cols-2">
                    <Button type="button" variant="outline" disabled={telegramBusy || !telegramText.trim() || (telegramHasInvite && (!telegramSourceTitle.trim() || !telegramSourceUrl.trim()))} onClick={() => void ingestTelegramScan(false)}>
                      {telegramBusy ? <LoaderCircle data-icon="inline-start"/> : <ExternalLink data-icon="inline-start"/>}
                      {telegramBusy ? 'Обробляємо…' : 'Додати локально'}
                    </Button>
                    <Button type="button" disabled={telegramBusy || !telegramText.trim() || (telegramHasInvite && (!telegramSourceTitle.trim() || !telegramSourceUrl.trim()))} onClick={() => void ingestTelegramScan(true)}>
                      Додати локально й очистити
                    </Button>
                  </div>
                  <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
                    Обидві дії додають знайдені invite лише в sessionStorage. Друга також очищає поля ручного джерела.
                  </p>
                </section>
              </div>
            </details>
          </div>
        </div>

        <section className="flex min-h-[480px] min-w-0 flex-col bg-background lg:min-h-0" aria-label="Кандидати">
          <div className="border-b border-border/70 bg-background px-4 py-3 sm:px-5 sm:py-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="text-base font-semibold">Автоматична перевірка</h3>
                <p className="mt-0.5 text-xs text-foreground/65">{autonomousRunning?'Work OS обробляє чергу сам. Відкривати або кваліфікувати кожен чат вручну не потрібно.':'Тут видно результати останньої перевірки.'}</p>
              </div>

            </div>
            <div className="mt-3 flex flex-wrap gap-1.5" role="tablist" aria-label="Фільтр кандидатів">
              {([
                ['review', 'У роботі', reviewCount],
                ['waiting-whatsapp', 'Очікує WhatsApp', workspace.waitingWhatsAppCount],
                ['target', 'Цільові · ручна перевірка', workspace.counts.target+localTargets.length],
                ['rejected', 'Відхилені / пропущені', workspace.counts.rejected+localFailed+localSkipped],
                ['unavailable', 'Не вдалося перевірити', workspace.counts.unavailable+localUnavailable],
                ['all', 'Усі', total],
              ] as Array<[DecisionFilter, string, number]>).map(([key, label, count]) =>
                <button
                  key={key}
                  type="button"
                  role="tab"
                  aria-selected={filter === key}
                  disabled={loading}
                  onClick={() => void changeFilter(key)}
                  className={`shrink-0 rounded-lg border px-2.5 py-1.5 text-xs font-semibold transition-colors ${filter === key ? 'border-primary/40 bg-primary/10 text-primary' : 'border-border/70 bg-background text-foreground/70 hover:bg-muted/40 hover:text-foreground'}`}
                >
                  {label} <span className="ml-1 tabular-nums">{count}</span>
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
                    return <article key={candidate.id} className="min-w-0 rounded-2xl border border-border bg-background p-4 shadow-sm sm:p-5">
                      <div className={`rounded-xl border px-3 py-2.5 ${status.tone}`}>
                        <div className="flex items-start gap-2">
                          {status.busy?<LoaderCircle className="mt-0.5 size-4 shrink-0 animate-spin"/>:<span className="mt-1 size-2 shrink-0 rounded-full bg-current opacity-70"/>}
                          <div className="min-w-0">
                            <div className="text-xs font-bold uppercase tracking-wide">{status.label}</div>
                            <div className="mt-0.5 text-xs leading-5 opacity-80">{status.detail}</div>
                          </div>
                        </div>
                      </div>

                      <div className="mt-3 flex min-w-0 items-start justify-between gap-3">
                        <div className="min-w-0">
                          <h4 className="break-words text-base font-semibold leading-snug">{candidateDisplayName(candidate)}</h4>
                          <div className="mt-1 flex flex-wrap items-center gap-1.5">
                            <Badge variant="outline">{platformLabel(candidate.platform)}</Badge>
                            {candidate.membershipState==='pending'&&<Badge variant="secondary">Очікує вступу</Badge>}
                            {candidate.membershipState==='joined'&&<Badge variant="secondary">Приєднано</Badge>}
                            {isLocalPreview(candidate)&&<Badge variant="outline">Результат автопошуку</Badge>}
                          </div>
                        </div>
                        {candidate.decision==='target'&&<Badge>Цільовий · ручна перевірка</Badge>}
                      </div>

                      {candidate.reasonCodes.length>0&&candidate.decision!=='target'&&<div className="mt-3 flex flex-wrap gap-1.5">
                        {candidate.reasonCodes.slice(0,3).map(code=><span key={code} className="rounded-lg bg-muted/50 px-2 py-1 text-[11px] font-medium text-foreground/70">{reasonLabel(code)}</span>)}
                        {candidate.reasonCodes.length>3&&<span className="rounded-lg bg-muted/50 px-2 py-1 text-[11px] font-medium text-muted-foreground">+{candidate.reasonCodes.length-3}</span>}
                      </div>}

                      <details className="mt-3 rounded-xl border border-border/70 bg-muted/10">
                        <summary className="cursor-pointer select-none px-3 py-2.5 text-xs font-semibold text-foreground/75">
                          Деталі перевірки · підтверджено {confirmedCriteria} з {criteria.length}
                        </summary>
                        <div className="border-t border-border/60 p-3">
                          <div className="grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-4">
                            {criteria.map(item => <Criterion key={item.label} {...item} />)}
                          </div>
                          <div className="mt-3 truncate font-mono text-[11px] font-medium text-foreground/50">{candidate.link}</div>
                          {candidate.sources.length > 0 && <details className="mt-3">
                            <summary className="cursor-pointer select-none text-xs font-medium text-muted-foreground">Звідки знайдено · {candidate.sources.length}</summary>
                            <div className="mt-2 grid gap-2">
                              {candidate.sources.slice(0, 4).map((source, index) =>
                                <div key={`${source.sourceUrl}:${source.query}:${index}`} className="rounded-lg bg-background p-2 text-xs">
                                  <div className="flex flex-wrap items-center gap-2">
                                    <strong>{source.sourceTitle || source.seedLabel || source.kind}</strong>
                                    {source.sourceUrl && <a className="inline-flex items-center gap-1 underline" href={source.sourceUrl} target="_blank" rel="noreferrer">джерело <ExternalLink className="size-3"/></a>}
                                  </div>
                                  {source.query && <div className="mt-1 text-muted-foreground">Запит: {source.query}</div>}
                                </div>)}
                            </div>
                          </details>}
                        </div>
                      </details>

                      <div className="mt-3 flex flex-wrap items-center gap-2">
                        <a className="inline-flex h-8 items-center gap-1.5 rounded-[9px] border border-border bg-background px-2.5 text-[0.8rem] font-semibold hover:bg-muted" href={candidate.link} target="_blank" rel="noreferrer">
                          Відкрити {platformLabel(candidate.platform)} <ExternalLink className="size-3.5"/>
                        </a>
                        <details className="group">
                          <summary className="cursor-pointer select-none rounded-lg px-2.5 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground">Ручні дії</summary>
                          <div className="mt-2 flex flex-wrap gap-2">
                            {!candidate.importedChatId && candidate.decision==='unavailable'
                              &&candidate.reasonCodes.some(reason=>['qualification_incomplete','paused_unverified','retry_exhausted'].includes(reason))
                              &&<Button type="button" variant="outline" disabled={localPreview.running||telegramBusy} onClick={()=>retryIncompleteCandidate(candidate)}>Повторити перевірку</Button>}
                            {!candidate.importedChatId && candidate.decision === 'review' &&
                              <Button type="button" size="sm" variant="outline" disabled={inspectingId !== null} onClick={() => void markInviteInvalid(candidate)}>
                                {inspectingId === candidate.id ? <LoaderCircle data-icon="inline-start"/> : null}
                                {isLocalPreview(candidate)?'Відкинути preview':'Invite недійсний'}
                              </Button>}
                            {!candidate.importedChatId && candidate.decision === 'target' &&
                              <Button type="button" size="sm" variant="outline" disabled={importingId !== null || inspectingId !== null} onClick={() => void archiveCandidate(candidate)}>
                                {inspectingId === candidate.id ? <LoaderCircle data-icon="inline-start"/> : null}
                                В архів
                              </Button>}
                            {!candidate.importedChatId && (candidate.decision === 'review' || candidate.decision === 'target') &&
                              <Button type="button" size="sm" disabled={importingId !== null || inspectingId !== null} onClick={() => void importCandidate(candidate)}>
                                {importingId === candidate.id ? <LoaderCircle data-icon="inline-start"/> : null}
                                {candidate.decision==='target'?'Лишити в роботі':isLocalPreview(candidate)?'Підходить → додати':'Додати на перевірку'}
                              </Button>}
                            {candidate.importedChatId && candidate.membershipState !== 'left' &&
                              <Button type="button" size="sm" variant="outline" onClick={() => toggleManualInspection(candidate)}>
                                {manualDraft?.candidateId === candidate.id ? 'Закрити кваліфікацію' : 'Кваліфікувати вручну'}
                              </Button>}
                          </div>
                        </details>
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
                : <div className="workspace-empty"><Search aria-hidden="true"/><strong>Тут поки порожньо</strong><p>{autonomousRunning?`Перевіряємо WhatsApp: у черзі ${localQueued}, вже перевірено ${localChecked}. Тут з'являються тільки підтверджені цільові чати.`:'Запусти автопошук або зміни фільтр.'}</p></div>}
          </div>
        </section>
      </div>
    </DialogContent>
  </Dialog>;
}

function applyLocalPreflightResults(current:LocalPreviewSession,results:Record<string,LocalPreflightPayload>):LocalPreviewSession{
  let changed=false;
  let duplicates=current.duplicates;
  const seenTargets=new Map<string,string>();
  const candidates=current.candidates.map(candidate=>{
    if(candidate.preflightState==='target'){
      const identity=localTargetIdentity(candidate);
      if(identity)seenTargets.set(identity,candidate.id);
    }
    return candidate;
  }).map((candidate):LocalDiscoveryPreview=>{
    if(candidate.preflightState!=='queued')return candidate;
    const payload=results[candidate.id];
    if(!payload)return candidate;
    changed=true;
    const result=payload.result||{};
    const observedName=typeof result.observedName==='string'&&result.observedName.trim()?result.observedName.trim():candidate.name;
    const memberCount=typeof result.memberCount==='number'&&Number.isFinite(result.memberCount)?result.memberCount:null;
    const next:LocalDiscoveryPreview={
      ...candidate,
      name:observedName,
      checkedAt:Number.isFinite(payload.completedAt)?Math.floor(payload.completedAt/1000):candidate.checkedAt,
      memberCount,
      groupId:typeof result.groupId==='string'?result.groupId:candidate.groupId,
      leaveReason:payload.leaveReason||null,
      chatType:result.chatType==='community'?'community':result.chatType==='group'?'group':candidate.chatType,
      activityState:result.activityState==='active'||result.activityState==='dead'?result.activityState:candidate.activityState,
      topicMatch:result.topicMatch==='match'||result.topicMatch==='mismatch'?result.topicMatch:candidate.topicMatch,
      canWrite:typeof result.canWrite==='boolean'?result.canWrite:candidate.canWrite,
      adsPolicy:['allowed','forbidden','operator_confirmed','inferred_allowed'].includes(String(result.adsPolicy))?result.adsPolicy as LocalDiscoveryPreview['adsPolicy']:candidate.adsPolicy,
      membershipState:payload.leftAfterCheck?'left':result.membershipState==='joined'?'joined':result.membershipState==='pending'?'pending':candidate.membershipState,
      accessState:result.accessible===true?'available':result.accessible===false?'unavailable':candidate.accessState,
      linkState:result.reason==='invalid_whatsapp_link'?'invalid':result.targetVerified===true?'valid':candidate.linkState,
      inspectionState:result.status==='inspected'?'inspected':'failed',
      decision:payload.decision==='target'?'target':payload.decision==='unavailable'?'unavailable':'rejected',
      reasonCodes:Array.isArray(payload.reasonCodes)?payload.reasonCodes:[],
      preflightState:payload.decision,
      preflightReasonCodes:Array.isArray(payload.reasonCodes)?payload.reasonCodes:[],
      leftAfterCheck:payload.leftAfterCheck===true,
      updatedAt:Number.isFinite(payload.completedAt)?Math.floor(payload.completedAt/1000):candidate.updatedAt,
    };
    if(next.preflightState==='target'){
      const identity=localTargetIdentity(next);
      const existing=identity?seenTargets.get(identity):null;
      if(existing&&existing!==next.id){
        duplicates+=1;
        return {...next,decision:'rejected',preflightState:'rejected',preflightReasonCodes:['duplicate_joined_chat'],reasonCodes:['duplicate_joined_chat']};
      }
      if(identity)seenTargets.set(identity,next.id);
    }
    return next;
  });
  if(!changed)return current;
  const targetCount=candidates.filter(candidate=>candidate.preflightState==='target').length;
  const queuedCount=candidates.filter(candidate=>candidate.preflightState==='queued').length;
  const reached=targetCount>=current.goal;
  const exhausted=current.sourceExhausted&&queuedCount===0&&!reached;
  return {
    ...current,
    candidates,
    duplicates,
    running:current.running&&!(reached||exhausted),
    done:reached||exhausted,
    completionReason:reached?'goal_reached':exhausted?'sources_exhausted':current.completionReason,
    lastActivityAt:Date.now(),
  };
}

function localCandidatesForFilter(candidates:LocalDiscoveryPreview[],filter:DecisionFilter){
  return candidates.filter(candidate=>filter==='all'
    ||(filter==='target'&&candidate.preflightState==='target')
    ||(filter==='review'&&candidate.preflightState==='queued')
    ||(filter==='rejected'&&(candidate.preflightState==='rejected'||candidate.preflightState==='skipped'))
    ||(filter==='unavailable'&&candidate.preflightState==='unavailable'));
}

function localTargetIdentity(candidate:LocalDiscoveryPreview){
  return candidate.groupId? `group:${candidate.groupId}` : `invite:${candidate.link}`;
}

function readLocalPreviewSession():LocalPreviewSession{
  try{
    const raw=window.sessionStorage.getItem(LOCAL_PREVIEW_KEY);
    if(!raw)return EMPTY_LOCAL_PREVIEW;
    const value=JSON.parse(raw) as Partial<LocalPreviewSession>;
    const candidates=Array.isArray(value.candidates)?value.candidates
      .filter((item):item is LocalDiscoveryPreview=>Boolean(item&&typeof item==='object'&&(item as LocalDiscoveryPreview).localOnly===true&&typeof (item as LocalDiscoveryPreview).link==='string'))
      .map<LocalDiscoveryPreview>(item=>({...item,preflightState:item.preflightState||'queued',preflightReasonCodes:Array.isArray(item.preflightReasonCodes)?item.preflightReasonCodes:[],leftAfterCheck:item.leftAfterCheck===true}))
      :[];
    return {
      runId:typeof value.runId==='string'?value.runId:undefined,
      discoveryMetrics:value.discoveryMetrics,
      sourceTotal:safeNonNegativeInt(value.sourceTotal),
      sourceErrors:safeNonNegativeInt(value.sourceErrors),
      sourceFailures:safeNonNegativeInt(value.sourceFailures),
      sourceIssues:Array.isArray(value.sourceIssues)?value.sourceIssues.filter(item=>item&&typeof item.reason==='string'&&typeof item.query==='string').slice(0,8):[],
      telegramCursor:safeNonNegativeInt(value.telegramCursor),
      sourceCursor:safeNonNegativeInt(value.sourceCursor),
      searched:safeNonNegativeInt(value.searched),
      processed:safeNonNegativeInt(value.processed),
      duplicates:safeNonNegativeInt(value.duplicates),
      rejected:safeNonNegativeInt(value.rejected),
      emptySourceBatches:safeNonNegativeInt(value.emptySourceBatches),
      done:value.done===true,
      running:value.running===true,
      sourceExhausted:value.sourceExhausted===true,
      goal:clampNumber(value.goal,1,100,50),
      lastActivityAt:Number.isFinite(Number(value.lastActivityAt))?Number(value.lastActivityAt):null,
      completionReason:value.completionReason==='goal_reached'||value.completionReason==='sources_exhausted'||value.completionReason==='source_error'?value.completionReason:null,
      activeCandidateId:typeof value.activeCandidateId==='string'?value.activeCandidateId:null,
      activeCandidateName:typeof value.activeCandidateName==='string'?value.activeCandidateName:null,
      activeCandidateLink:typeof value.activeCandidateLink==='string'?value.activeCandidateLink:null,
      activeCandidateStartedAt:Number.isFinite(Number(value.activeCandidateStartedAt))?Number(value.activeCandidateStartedAt):null,
      lastCheckedName:typeof value.lastCheckedName==='string'?value.lastCheckedName:null,
      lastCheckedDecision:value.lastCheckedDecision==='target'||value.lastCheckedDecision==='rejected'||value.lastCheckedDecision==='skipped'||value.lastCheckedDecision==='unavailable'?value.lastCheckedDecision:null,
      lastCheckedAt:Number.isFinite(Number(value.lastCheckedAt))?Number(value.lastCheckedAt):null,
      lastCheckedReasonCodes:Array.isArray(value.lastCheckedReasonCodes)?value.lastCheckedReasonCodes.filter((item):item is string=>typeof item==='string').slice(0,8):[],
      pauseSummary:value.pauseSummary&&typeof value.pauseSummary==='object'?{
        at:Number.isFinite(Number(value.pauseSummary.at))?Number(value.pauseSummary.at):Date.now(),
        cursor:safeNonNegativeInt(value.pauseSummary.cursor),
        targets:safeNonNegativeInt(value.pauseSummary.targets),
        rejected:safeNonNegativeInt(value.pauseSummary.rejected),
        skipped:safeNonNegativeInt(value.pauseSummary.skipped),
        unavailable:safeNonNegativeInt(value.pauseSummary.unavailable),
        unverified:safeNonNegativeInt(value.pauseSummary.unverified),
        archiveFailed:safeNonNegativeInt(value.pauseSummary.archiveFailed),
      }:null,
      candidates,
    };
  }catch{return EMPTY_LOCAL_PREVIEW;}
}
function mergeLocalTelegramPreview(current:LocalPreviewSession,payload:PreviewTelegramResponse):LocalPreviewSession{
  const byKey=new Map(current.candidates.map(candidate=>[`${candidate.platform}|${candidate.link}`,candidate]));
  for(const candidate of payload.previews)byKey.set(`${candidate.platform}|${candidate.link}`,candidate);
  return {
    ...current,
    processed:current.processed+safeNonNegativeInt(payload.batch.added)+safeNonNegativeInt(payload.batch.duplicates),
    duplicates:current.duplicates+safeNonNegativeInt(payload.batch.duplicates),
    candidates:[...byKey.values()],
    lastActivityAt:Date.now(),
  };
}
function safeNonNegativeInt(value:unknown){const number=Number(value);return Number.isSafeInteger(number)&&number>=0?number:0;}
function isLocalPreview(candidate:DiscoveryCandidate):candidate is LocalDiscoveryPreview{
  return (candidate as Partial<LocalDiscoveryPreview>).localOnly===true;
}

function StatTile({ label, value }: { label: string; value: string }) {
  return <div className="flex min-w-[132px] shrink-0 items-baseline justify-between gap-3 rounded-xl border border-border/70 bg-background px-3 py-2">
    <div className="truncate text-[11px] font-semibold text-foreground/65">{label}</div>
    <div className="shrink-0 text-sm font-semibold tabular-nums text-foreground">{value}</div>
  </div>;
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
  const chatTypeOk = candidate.chatType === 'group' || candidate.chatType === 'community';
  return [
    { label: 'Тип', value: chatTypeLabel(candidate.chatType), state: candidate.chatType === 'unknown' ? 'warn' : chatTypeOk ? 'ok' : 'bad' },
    { label: 'Учасники', value: count === null ? 'Невідомо' : String(count), state: count === null ? 'warn' : memberOk ? 'ok' : 'bad' },
    { label: 'Активність', value: activityLabel(candidate.activityState), state: candidate.activityState === 'active' ? 'ok' : candidate.activityState === 'dead' ? 'bad' : 'warn' },
    { label: 'Можна писати', value: candidate.canWrite === null ? 'Невідомо' : candidate.canWrite ? 'Так' : 'Ні', state: candidate.canWrite === true ? 'ok' : candidate.canWrite === false ? 'bad' : 'warn' },
    { label: 'Оголошення', value: adsPolicyLabel(candidate.adsPolicy), state: candidate.adsPolicy === 'allowed' || candidate.adsPolicy === 'operator_confirmed' || candidate.adsPolicy === 'inferred_allowed' ? 'ok' : candidate.adsPolicy === 'forbidden' ? 'bad' : 'warn' },
    { label: 'Аудиторія', value: topicMatchLabel(candidate.topicMatch), state: candidate.topicMatch === 'match' ? 'ok' : candidate.topicMatch === 'mismatch' ? 'bad' : 'warn' },
    { label: 'Вступ', value: membershipLabel(candidate.membershipState), state: candidate.membershipState === 'joined' ? 'ok' : candidate.membershipState === 'left' ? 'bad' : 'warn' },
    { label: 'Перевірка', value: inspectionLabel(candidate.inspectionState), state: candidate.inspectionState === 'inspected' ? 'ok' : candidate.inspectionState === 'failed' ? 'bad' : 'warn' },
    { label: 'Invite', value: linkStateLabel(candidate.linkState), state: candidate.linkState === 'valid' ? 'ok' : candidate.linkState === 'invalid' ? 'bad' : 'warn' },
    { label: 'Доступ', value: accessStateLabel(candidate.accessState), state: candidate.accessState === 'available' ? 'ok' : candidate.accessState === 'unavailable' ? 'bad' : 'warn' },
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
    const tone='border-border bg-muted/25 text-foreground/70';
    if(candidate.preflightState==='skipped')return {label:'Пропущено в цьому запуску',detail:(candidate.preflightReasonCodes||candidate.reasonCodes).map(reasonLabel).join('; '),tone,busy:false};
    if(candidate.preflightState==='unavailable')return {label:'Не вдалося перевірити',detail:'Це не висновок про нецільову аудиторію. Причини перевірки наведено нижче.',tone,busy:false};
    if(candidate.preflightState==='rejected')return {label:'Не відповідає критеріям',detail:candidate.leftAfterCheck?'Вихід із чату підтверджено.':candidate.membershipState==='joined'?'Вихід не підтверджено: '+reasonLabel(candidate.leaveReason||'leave_not_confirmed'):'Відхилено до вступу.',tone,busy:false};
  }
  if(candidate.membershipState==='left')return {label:'Чат уже покинуто',detail:'Для нової кваліфікації спочатку віднови його та підтвердь повторний вступ.',tone:'border-border bg-muted/25 text-foreground/70',busy:false};
  if(candidate.decision==='target')return {label:'Цільовий · ручна перевірка',detail:'Критерії підтверджені й чат збережено. Переглянь вручну: залишити в роботі чи відхилити.',tone:'border-emerald-500/30 bg-emerald-500/5 text-emerald-800 dark:text-emerald-300',busy:false};
  if(candidate.decision==='rejected')return {label:'Відхилено автоматично',detail:candidate.membershipState==='joined'?'Чат не відповідає критеріям. Work OS виходить із нього та архівує.':'Чат не відповідає критеріям і не буде зарахований у ціль.',tone:'border-border bg-muted/25 text-foreground/70',busy:false};
  if(candidate.decision==='unavailable')return {label:'Недоступний',detail:'Invite або сам чат недоступний. Work OS переходить до наступного кандидата.',tone:'border-border bg-muted/25 text-foreground/70',busy:false};
  if(candidate.membershipState==='pending')return {label:'Очікуємо схвалення в WhatsApp',detail:'Запит на вступ уже відправлено. Система перевірить його повторно сама.',tone:'border-primary/30 bg-primary/5 text-foreground',busy:true};
  if(candidate.membershipState==='joined')return {label:'Перевіряємо чат',detail:'Вступ підтверджено. Work OS збирає факти й перевіряє критерії.',tone:'border-primary/30 bg-primary/5 text-foreground',busy:true};
  if(candidate.inspectionState==='failed')return {label:'Спробуємо ще раз',detail:'Попередня перевірка не завершилась. Кандидат лишається в автоматичній черзі.',tone:'border-amber-500/30 bg-amber-500/5 text-foreground',busy:true};
  if(isLocalPreview(candidate)&&candidate.preflightState==='target')return {label:'Фактично цільовий',detail:'Work OS автоматично вступив у чат і підтвердив усі потрібні критерії. D1 ще не змінено.',tone:'border-emerald-500/30 bg-emerald-500/5 text-emerald-800 dark:text-emerald-300',busy:false};
  if(isLocalPreview(candidate))return {label:'Локальна перевірка',detail:'Кандидат ще не підтверджений як цільовий.',tone:'border-border bg-muted/20 text-foreground/70',busy:candidate.preflightState==='queued'};
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

function linkStateLabel(value: DiscoveryCandidate['linkState']) {
  return value === 'valid' ? 'Дійсний' : value === 'invalid' ? 'Недійсний' : 'Невідомо';
}

function accessStateLabel(value: DiscoveryCandidate['accessState']) {
  return value === 'available' ? 'Є' : value === 'unavailable' ? 'Немає' : 'Невідомо';
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

function membershipLabel(value: DiscoveryCandidate['membershipState']) {
  return value === 'joined' ? 'Приєднано'
    : value === 'pending' ? 'Очікує схвалення'
      : value === 'left' ? 'Вийшли з чату'
        : 'Вступ не перевірено';
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
    access_unavailable: 'чат недоступний',
    qualification_unverified: 'не вдалося підтвердити всі критерії',
  };
  return labels[value] || value;
}

function clampNumber(value: unknown, min: number, max: number, fallback: number) {
  const number = Number(value);
  if (!Number.isSafeInteger(number)) return fallback;
  return Math.max(min, Math.min(max, number));
}
