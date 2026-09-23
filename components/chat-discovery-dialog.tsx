'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { CheckCircle2, CircleAlert, ExternalLink, LoaderCircle, Search, Square, X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { ChatDiscoveryExecutorPanel } from '@/components/chat-discovery-executor-panel';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import type { DiscoveryCandidate, DiscoveryDecision, DiscoveryRun } from '@/lib/chat-discovery/domain';
import type { DiscoveryPlatform, TelegramSearchPlan } from '@/lib/chat-discovery/public-web';

type Workspace = {
  run: DiscoveryRun | null;
  telegramPlan: TelegramSearchPlan | null;
  counts: Record<DiscoveryDecision, number>;
  importedCount: number;
  candidates: DiscoveryCandidate[];
  error?: string;
};
type ContinueResponse = {
  run: DiscoveryRun;
  batch: { searched: number; added: number; duplicates: number; errors: number };
  error?: string;
};
type ImportResponse = { chatId?: string; existing?: boolean; workflowStatus?: string; error?: string };
type TelegramIngestResponse = { run: DiscoveryRun; queryCompleted: boolean; batch: { extracted: number; added: number; duplicates: number }; error?: string };
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
type DecisionFilter = 'all' | DiscoveryDecision;

const EMPTY_COUNTS: Record<DiscoveryDecision, number> = {
  review: 0,
  target: 0,
  rejected: 0,
  unavailable: 0,
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
  const [workspace, setWorkspace] = useState<Workspace>({ run: null, telegramPlan: null, counts: EMPTY_COUNTS, importedCount: 0, candidates: [] });
  const platforms: DiscoveryPlatform[] = ['whatsapp', 'viber'];
  const [goal, setGoal] = useState(30);
  const [minMembers, setMinMembers] = useState(700);
  const [filter, setFilter] = useState<DecisionFilter>('all');
  const [loading, setLoading] = useState(false);
  const [searching, setSearching] = useState(false);
  const [importingId, setImportingId] = useState<string | null>(null);
  const [inspectingId, setInspectingId] = useState<string | null>(null);
  const [manualDraft, setManualDraft] = useState<ManualInspectionDraft | null>(null);
  const [telegramBusy, setTelegramBusy] = useState(false);
  const [telegramText, setTelegramText] = useState('');
  const [telegramSourceTitle, setTelegramSourceTitle] = useState('');
  const [telegramSourceUrl, setTelegramSourceUrl] = useState('');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const stopRequested = useRef(false);
  const telegramHasInvite = /(?:https?:\/\/)?chat\.whatsapp\.com\//iu.test(telegramText.replaceAll('\\/', '/'));

  const load = useCallback(async (decision: DecisionFilter = filter) => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams({ limit: '60' });
      if (decision !== 'all') params.set('decision', decision);
      const response = await fetch(`/api/chat-discovery?${params}`, { cache: 'no-store' });
      const body = await response.json() as Workspace;
      if (!response.ok) throw new Error(body.error || 'Не вдалося завантажити пошук чатів.');
      setWorkspace(body);
      return body;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Не вдалося завантажити пошук чатів.');
      return null;
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => {
    if (!open) return;
    const timer = setTimeout(() => { void load(); }, 0);
    return () => clearTimeout(timer);
  }, [open, load]);



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

  async function ensureTelegramRun() {
    let run = workspace.run?.status === 'running' ? workspace.run : null;
    if (run) return run;
    const payload = await post({ action: 'start', platforms, goal, minMembers });
    run = payload.run as DiscoveryRun;
    setWorkspace(current => ({ ...current, run }));
    return run;
  }

  async function startTelegramSearch() {
    if (telegramBusy) return;
    setTelegramBusy(true);
    setError('');
    try {
      const run = await ensureTelegramRun();
      const fresh = await load(filter);
      const query = fresh?.telegramPlan?.tasks[0]?.query || '';
      setNotice(query
        ? `Telegram-план готовий. Запит №${run.telegramCursor + 1}: ${query}`
        : 'Telegram keyword plan завершено.');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Не вдалося запустити Telegram-пошук.');
    } finally {
      setTelegramBusy(false);
    }
  }

  async function startOrContinue() {
    if (searching) return;
    stopRequested.current = false;
    setSearching(true);
    setError('');
    setNotice('');
    try {
      let run = workspace.run?.status === 'running' ? workspace.run : null;
      if (!run) {
        const payload = await post({ action: 'start', platforms, goal, minMembers });
        run = payload.run as DiscoveryRun;
        setWorkspace(current => ({ ...current, run }));
      }

      while (run.status === 'running' && !stopRequested.current) {
        const payload = await post({ action: 'continue', runId: run.id }) as unknown as ContinueResponse;
        run = payload.run;
        setNotice(batchLabel(payload.batch));
        await load(filter);
      }

      if (run.status === 'running' && stopRequested.current) {
        await post({ action: 'cancel', runId: run.id, version: run.version });
        setNotice('Пошук зупинено після поточної порції.');
      } else if (run.status === 'completed') {
        setNotice('Пошук завершено. Кандидати нижче готові до перевірки.');
      }
      await load(filter);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Пошук чатів не завершено.');
      await load(filter);
    } finally {
      setSearching(false);
      stopRequested.current = false;
    }
  }

  async function ingestTelegramScan(completeQuery: boolean) {
    if (telegramBusy || !telegramText.trim()) return;
    const displayedQuery = workspace.telegramPlan?.tasks[0]?.query || '';
    if (!displayedQuery) {
      setError('Поточний Telegram-запит не знайдений. Оновіть пошук.');
      return;
    }
    setTelegramBusy(true);
    setError('');
    setNotice('');
    try {
      const run = await ensureTelegramRun();
      const fresh = await load(filter);
      const freshQuery = fresh?.run?.id === run.id ? fresh.telegramPlan?.tasks[0]?.query || '' : '';
      if (freshQuery !== displayedQuery) {
        throw new Error('Telegram-запит уже змінився в іншій вкладці. Скан не передано — оновіть поточний query.');
      }
      const query = displayedQuery;
      const payload = await post({
        action: 'ingest-telegram',
        runId: run.id,
        text: telegramText,
        sourceUrl: telegramSourceUrl,
        sourceTitle: telegramSourceTitle,
        query,
        seedLabel: telegramSourceTitle || query || 'Telegram',
        context: query,
        completeQuery,
      }) as unknown as TelegramIngestResponse;
      setWorkspace(current => ({ ...current, run: payload.run }));
      setNotice(payload.queryCompleted
        ? `Telegram: витягнуто ${payload.batch.extracted}, нових ${payload.batch.added}, дублів ${payload.batch.duplicates}. Поточний запит завершено, план перейшов далі.`
        : `Telegram: витягнуто ${payload.batch.extracted}, нових ${payload.batch.added}, дублів ${payload.batch.duplicates}. Джерело збережено, поточний query ще активний.`);
      setTelegramSourceTitle('');
      setTelegramSourceUrl('');
      setTelegramText('');
      await load(filter);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Не вдалося передати Telegram-результати в пошук.');
    } finally {
      setTelegramBusy(false);
    }
  }

  async function markInviteInvalid(candidate: DiscoveryCandidate) {
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

  async function importCandidate(candidate: DiscoveryCandidate) {
    if (importingId) return;
    setImportingId(candidate.id);
    setError('');
    try {
      const payload = await post({
        action: 'import',
        candidateId: candidate.id,
        version: candidate.version,
      }) as unknown as ImportResponse;
      setNotice(payload.existing
        ? 'Чат уже був у Work OS — кандидат зв’язаний з ним.'
        : 'Чат додано в чергу «Для приєднання».');
      onImported(candidate.platform as DiscoveryPlatform);
      await load(filter);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Не вдалося додати чат на перевірку.');
    } finally {
      setImportingId(null);
    }
  }

  async function changeFilter(next: DecisionFilter) {
    setFilter(next);
    await load(next);
  }

  function close() {
    if (searching) {
      stopRequested.current = true;
      setNotice('Зупиняємо після поточної порції…');
      return;
    }
    onClose();
  }

  const run = workspace.run;
  const total = Object.values(workspace.counts).reduce((sum, value) => sum + value, 0);

  const currentTask = workspace.telegramPlan?.tasks[0] ?? null;
  const telegramProgress = workspace.telegramPlan
    ? Math.min(100, Math.round((workspace.telegramPlan.cursor / Math.max(1, workspace.telegramPlan.totalTasks)) * 100))
    : 0;

  return <Dialog open={open} onOpenChange={next => { if (!next) close(); }}>
    <DialogContent
      className="h-[min(92dvh,940px)] w-[calc(100vw-24px)] !max-w-[1180px] !flex !flex-col gap-0 overflow-hidden !rounded-2xl !p-0 sm:!max-w-[1180px]"
      overlayClassName="bg-black/25 supports-backdrop-filter:backdrop-blur-sm"
      showCloseButton={false}
    >
      <header className="relative border-b border-border/70 bg-background/95 px-5 py-4 backdrop-blur sm:px-6">
        <DialogHeader className="gap-1 pr-12">
          <div className="flex flex-wrap items-center gap-2">
            <DialogTitle className="text-lg font-semibold">Пошук нових чатів</DialogTitle>
            <Badge variant="secondary">WhatsApp discovery</Badge>
          </div>
          <DialogDescription className="max-w-3xl text-xs sm:text-sm">
            Telegram — основне джерело. Кандидат стає цільовим тільки після фактичного вступу та повної перевірки критеріїв. Невідомі критерії не зараховуються.
          </DialogDescription>
        </DialogHeader>
        <Button className="absolute right-4 top-4" variant="ghost" size="icon" aria-label="Закрити" onClick={close}><X/></Button>

        <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <StatTile label="Query" value={workspace.telegramPlan ? `${workspace.telegramPlan.cursor} / ${workspace.telegramPlan.totalTasks}` : '—'} />
          <StatTile label="Знайдено" value={String(run?.foundCount ?? total)} />
          <StatTile label="На перевірку" value={String(workspace.counts.review)} />
          <StatTile label="У Work OS" value={String(workspace.importedCount)} />
        </div>
      </header>

      {(error || notice) && <div className="border-b border-border/70 px-5 py-2.5 sm:px-6">
        {error && <div className="workspace-error" role="alert">{error}</div>}
        {notice && !error && <output className="reports-notice">{notice}</output>}
      </div>}

      <div className="grid min-h-0 flex-1 overflow-y-auto lg:grid-cols-[minmax(0,0.92fr)_minmax(460px,1.08fr)] lg:overflow-hidden">
        <div className="border-b border-border/70 bg-muted/10 p-4 sm:p-5 lg:min-h-0 lg:overflow-y-auto lg:border-b-0 lg:border-r">
          <div className="grid gap-4">
            <ChatDiscoveryExecutorPanel />
            <section className="rounded-2xl border border-border/70 bg-background p-4 shadow-sm" aria-label="Параметри пошуку">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <h3 className="font-semibold">Запуск пошуку</h3>
                  <p className="mt-1 text-xs text-muted-foreground">Ціль: українські активні групи, 700–18 000 учасників.</p>
                </div>
                <Badge>WhatsApp</Badge>
              </div>

              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <label htmlFor="discovery-goal" className="grid gap-1.5 text-xs font-medium">
                  Нових кандидатів
                  <Input
                    id="discovery-goal"
                    type="number"
                    min={1}
                    max={100}
                    value={goal}
                    disabled={searching || run?.status === 'running'}
                    onChange={event => setGoal(clampNumber(event.target.value, 1, 100, 30))}
                  />
                </label>
                <label htmlFor="discovery-min-members" className="grid gap-1.5 text-xs font-medium">
                  Мінімум учасників
                  <Input
                    id="discovery-min-members"
                    type="number"
                    min={700}
                    max={18_000}
                    value={minMembers}
                    disabled={searching || run?.status === 'running'}
                    onChange={event => setMinMembers(clampNumber(event.target.value, 700, 18_000, 700))}
                  />
                </label>
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                <Button type="button" disabled={telegramBusy || searching || run?.status === 'running'} onClick={() => void startTelegramSearch()}>
                  {telegramBusy ? <LoaderCircle data-icon="inline-start"/> : <Search data-icon="inline-start"/>}
                  {run?.status === 'running' ? 'Telegram-план активний' : 'Почати Telegram-пошук'}
                </Button>
                {searching
                  ? <Button type="button" variant="outline" onClick={() => { stopRequested.current = true; }}><Square data-icon="inline-start"/>Зупинити fallback</Button>
                  : <Button type="button" variant="outline" onClick={() => void startOrContinue()}>Web fallback</Button>}
              </div>

              {run && <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                <span>Опрацьовано: <strong className="text-foreground">{run.searchedQueries}</strong></span>
                <span>Знайдено: <strong className="text-foreground">{run.foundCount}</strong></span>
                <span>Дублі: <strong className="text-foreground">{run.duplicateCount}</strong></span>
              </div>}
              {run?.errorMessage && <p className="mt-2 text-xs text-destructive">{run.errorMessage}</p>}
            </section>

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

              {telegramHasInvite && (!telegramSourceTitle.trim() || !telegramSourceUrl.trim()) && <div className="mt-2 flex items-center gap-2 text-xs text-amber-700 dark:text-amber-300">
                <CircleAlert className="size-3.5"/> Для invite вкажи назву Telegram-чату та посилання на джерело.
              </div>}

              <div className="mt-4 grid gap-2 sm:grid-cols-2">
                <Button type="button" variant="outline" disabled={telegramBusy || searching || !telegramText.trim() || (telegramHasInvite && (!telegramSourceTitle.trim() || !telegramSourceUrl.trim())) || workspace.run?.status !== 'running' || !currentTask?.query} onClick={() => void ingestTelegramScan(false)}>
                  {telegramBusy ? <LoaderCircle data-icon="inline-start"/> : <ExternalLink data-icon="inline-start"/>}
                  {telegramBusy ? 'Обробляємо…' : 'Зберегти джерело'}
                </Button>
                <Button type="button" disabled={telegramBusy || searching || !telegramText.trim() || (telegramHasInvite && (!telegramSourceTitle.trim() || !telegramSourceUrl.trim())) || workspace.run?.status !== 'running' || !currentTask?.query} onClick={() => void ingestTelegramScan(true)}>
                  Завершити query → наступний
                </Button>
              </div>
              <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
                «Зберегти джерело» не рухає план. «Завершити query» просуває cursor рівно на один крок.
              </p>
            </section>
          </div>
        </div>

        <section className="flex min-h-[480px] min-w-0 flex-col bg-background lg:min-h-0" aria-label="Кандидати">
          <div className="border-b border-border/70 px-4 py-3 sm:px-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="font-semibold">Кандидати</h3>
                <p className="text-xs text-muted-foreground">{total} знайдено · {workspace.importedCount} уже в Work OS</p>
              </div>
              <Badge variant="secondary">{filter === 'all' ? 'Усі' : decisionLabel(filter)} · {filter === 'all' ? total : workspace.counts[filter]}</Badge>
            </div>
            <div className="mt-3 flex gap-1 overflow-x-auto rounded-xl bg-muted/50 p-1" role="tablist" aria-label="Фільтр кандидатів">
              {([
                ['all', 'Усі', total],
                ['review', 'Перевірка', workspace.counts.review],
                ['target', 'Цільові', workspace.counts.target],
                ['rejected', 'Відхилені', workspace.counts.rejected],
                ['unavailable', 'Недоступні', workspace.counts.unavailable],
              ] as Array<[DecisionFilter, string, number]>).map(([key, label, count]) =>
                <button
                  key={key}
                  type="button"
                  role="tab"
                  aria-selected={filter === key}
                  disabled={loading}
                  onClick={() => void changeFilter(key)}
                  className={`shrink-0 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors ${filter === key ? 'bg-background text-foreground shadow-sm ring-1 ring-border/60' : 'text-muted-foreground hover:text-foreground'}`}
                >
                  {label} <span className="ml-1 tabular-nums">{count}</span>
                </button>)}
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto p-3 sm:p-4">
            {loading
              ? <div className="workspace-loading"><LoaderCircle/>Завантажуємо кандидатів…</div>
              : workspace.candidates.length
                ? <div className="grid gap-3">
                  {workspace.candidates.map(candidate => {
                    const criteria = candidateCriteria(candidate);
                    return <article key={candidate.id} className="min-w-0 rounded-2xl border border-border/70 bg-background p-4 shadow-sm">
                      <div className="flex min-w-0 items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <Badge variant={candidate.decision === 'target' ? 'default' : candidate.decision === 'review' ? 'secondary' : 'outline'}>{decisionLabel(candidate.decision)}</Badge>
                            <Badge variant="outline">{platformLabel(candidate.platform)}</Badge>
                            {candidate.importedChatId && <Badge variant="outline">{membershipLabel(candidate.membershipState)}</Badge>}
                          </div>
                          <h4 className="mt-2 break-words font-semibold leading-snug">{candidate.name || candidate.link}</h4>
                          <div className="mt-1 break-all text-[11px] text-muted-foreground">{candidate.link}</div>
                        </div>
                        {candidate.importedChatId && <span className="shrink-0 text-[11px] text-muted-foreground">У Work OS</span>}
                      </div>

                      <div className="mt-3 grid grid-cols-2 gap-1.5 sm:grid-cols-3">
                        {criteria.map(item => <Criterion key={item.label} {...item} />)}
                      </div>

                      {candidate.reasonCodes.length > 0 && <details className="mt-3 rounded-xl bg-muted/30 px-3 py-2">
                        <summary className="cursor-pointer select-none text-xs font-medium">
                          Що потребує уваги · {candidate.reasonCodes.length}
                        </summary>
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {candidate.reasonCodes.map(code => <span key={code} className="rounded-md bg-background px-2 py-1 text-[11px] text-muted-foreground ring-1 ring-border/60">{reasonLabel(code)}</span>)}
                        </div>
                      </details>}

                      <div className="mt-3 flex flex-wrap gap-2">
                        <a className="inline-flex h-8 items-center gap-1.5 rounded-[9px] border border-border bg-background px-2.5 text-[0.8rem] font-semibold hover:bg-muted" href={candidate.link} target="_blank" rel="noreferrer">
                          Відкрити {platformLabel(candidate.platform)} <ExternalLink className="size-3.5"/>
                        </a>
                        {!candidate.importedChatId && candidate.decision === 'review' &&
                          <Button type="button" size="sm" variant="outline" disabled={inspectingId !== null} onClick={() => void markInviteInvalid(candidate)}>
                            {inspectingId === candidate.id ? <LoaderCircle data-icon="inline-start"/> : null}
                            Invite недійсний
                          </Button>}
                        {!candidate.importedChatId && (candidate.decision === 'review' || candidate.decision === 'target') &&
                          <Button type="button" size="sm" disabled={importingId !== null || inspectingId !== null} onClick={() => void importCandidate(candidate)}>
                            {importingId === candidate.id ? <LoaderCircle data-icon="inline-start"/> : null}
                            Додати на перевірку
                          </Button>}
                        {candidate.importedChatId && candidate.membershipState !== 'left' &&
                          <Button type="button" size="sm" variant="outline" onClick={() => toggleManualInspection(candidate)}>
                            {manualDraft?.candidateId === candidate.id ? 'Закрити кваліфікацію' : 'Кваліфікувати'}
                          </Button>}
                      </div>

                      {candidate.importedChatId && candidate.membershipState === 'left' &&
                        <div className="mt-3 rounded-xl border border-border/70 bg-muted/30 px-3 py-2 text-xs text-muted-foreground">Чат уже покинуто. Для нової кваліфікації спочатку віднови його та підтвердь повторний вступ.</div>}
                      {candidate.importedChatId && candidate.membershipState === 'joined' && candidate.decision === 'review' &&
                        <div className="mt-3 rounded-xl border border-amber-500/25 bg-amber-500/5 px-3 py-2 text-xs text-amber-800 dark:text-amber-200">Приєднано, але бракує підтверджених фактів. Заповни кваліфікацію нижче.</div>}
                      {candidate.importedChatId && candidate.membershipState === 'joined' && (candidate.decision === 'rejected' || candidate.decision === 'unavailable') &&
                        <div className="workspace-error mt-3">Чат уже приєднаний, але не відповідає критеріям. Потрібен підтверджений вихід із месенджера.</div>}

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

                      {candidate.sources.length > 0 && <details className="mt-3 border-t border-border/60 pt-3">
                        <summary className="cursor-pointer select-none text-xs font-medium text-muted-foreground">Звідки знайдено · {candidate.sources.length}</summary>
                        <div className="mt-2 grid gap-2">
                          {candidate.sources.slice(0, 4).map((source, index) =>
                            <div key={`${source.sourceUrl}:${source.query}:${index}`} className="rounded-lg bg-muted/30 p-2 text-xs">
                              <div className="flex flex-wrap items-center gap-2">
                                <strong>{source.sourceTitle || source.seedLabel || source.kind}</strong>
                                {source.sourceUrl && <a className="inline-flex items-center gap-1 underline" href={source.sourceUrl} target="_blank" rel="noreferrer">джерело <ExternalLink className="size-3"/></a>}
                              </div>
                              {source.query && <div className="mt-1 text-muted-foreground">Запит: {source.query}</div>}
                              {source.context && <div className="mt-1 text-muted-foreground">{source.context}</div>}
                            </div>)}
                        </div>
                      </details>}
                    </article>;
                  })}
                </div>
                : <div className="workspace-empty"><Search aria-hidden="true"/><strong>Кандидатів ще немає</strong><p>Запусти Telegram-пошук або зміни фільтр.</p></div>}
          </div>
        </section>
      </div>
    </DialogContent>
  </Dialog>;
}

function StatTile({ label, value }: { label: string; value: string }) {
  return <div className="min-w-0 rounded-xl border border-border/70 bg-muted/20 px-3 py-2">
    <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{label}</div>
    <div className="mt-0.5 truncate text-sm font-semibold tabular-nums">{value}</div>
  </div>;
}

type CriterionItem = { label: string; value: string; state: 'ok' | 'warn' | 'bad' };

function Criterion({ label, value, state }: CriterionItem) {
  const tone = state === 'ok'
    ? 'border-emerald-500/20 bg-emerald-500/5 text-emerald-800 dark:text-emerald-200'
    : state === 'bad'
      ? 'border-destructive/20 bg-destructive/5 text-destructive'
      : 'border-border/70 bg-muted/25 text-muted-foreground';
  return <div className={`min-w-0 rounded-lg border px-2.5 py-2 ${tone}`}>
    <div className="truncate text-[10px] font-medium uppercase tracking-wide opacity-75">{label}</div>
    <div className="mt-0.5 truncate text-xs font-semibold">{value}</div>
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
    { label: 'Оголошення', value: adsPolicyLabel(candidate.adsPolicy), state: candidate.adsPolicy === 'allowed' || candidate.adsPolicy === 'operator_confirmed' ? 'ok' : candidate.adsPolicy === 'forbidden' ? 'bad' : 'warn' },
    { label: 'Аудиторія', value: topicMatchLabel(candidate.topicMatch), state: candidate.topicMatch === 'match' ? 'ok' : candidate.topicMatch === 'mismatch' ? 'bad' : 'warn' },
    { label: 'Вступ', value: membershipLabel(candidate.membershipState), state: candidate.membershipState === 'joined' ? 'ok' : candidate.membershipState === 'left' ? 'bad' : 'warn' },
    { label: 'Перевірка', value: inspectionLabel(candidate.inspectionState), state: candidate.inspectionState === 'inspected' ? 'ok' : candidate.inspectionState === 'failed' ? 'bad' : 'warn' },
    { label: 'Invite', value: linkStateLabel(candidate.linkState), state: candidate.linkState === 'valid' ? 'ok' : candidate.linkState === 'invalid' ? 'bad' : 'warn' },
    { label: 'Доступ', value: accessStateLabel(candidate.accessState), state: candidate.accessState === 'available' ? 'ok' : candidate.accessState === 'unavailable' ? 'bad' : 'warn' },
  ];
}

function batchLabel(batch: ContinueResponse['batch']) {
  return `Порція: запитів ${batch.searched}, нових ${batch.added}, дублів ${batch.duplicates}, помилок джерел ${batch.errors}.`;
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
    : value === 'inferred_allowed' ? 'ймовірно можна — перевірити'
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
  };
  return labels[value] || value;
}

function clampNumber(value: string, min: number, max: number, fallback: number) {
  const number = Number(value);
  if (!Number.isSafeInteger(number)) return fallback;
  return Math.max(min, Math.min(max, number));
}
