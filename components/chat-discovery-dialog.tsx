'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ExternalLink, LoaderCircle, Search, Square, X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
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
type TelegramIngestResponse = { run: DiscoveryRun; batch: { extracted: number; added: number; duplicates: number }; error?: string };
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
  const platforms: DiscoveryPlatform[] = ['whatsapp'];
  const [goal, setGoal] = useState(30);
  const [minMembers, setMinMembers] = useState(700);
  const [filter, setFilter] = useState<DecisionFilter>('all');
  const [loading, setLoading] = useState(false);
  const [searching, setSearching] = useState(false);
  const [importingId, setImportingId] = useState<string | null>(null);
  const [telegramBusy, setTelegramBusy] = useState(false);
  const [telegramText, setTelegramText] = useState('');
  const [telegramSourceTitle, setTelegramSourceTitle] = useState('');
  const [telegramSourceUrl, setTelegramSourceUrl] = useState('');
  const [telegramQuery, setTelegramQuery] = useState('');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const stopRequested = useRef(false);

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
      if (query) setTelegramQuery(query);
      setNotice(`Telegram-план готовий. Починаємо із запиту №${run.telegramCursor + 1}.`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Не вдалося запустити Telegram-пошук.');
    } finally {
      setTelegramBusy(false);
    }
  }

  async function advanceTelegramTask() {
    const run = workspace.run;
    if (!run || run.status !== 'running' || telegramBusy) return;
    setTelegramBusy(true);
    setError('');
    try {
      const payload = await post({
        action: 'advance-telegram-plan',
        runId: run.id,
        version: run.version,
        processed: 1,
      }) as unknown as { run: DiscoveryRun; plan: TelegramSearchPlan };
      setWorkspace(current => ({ ...current, run: payload.run, telegramPlan: payload.plan }));
      setTelegramQuery(payload.plan.tasks[0]?.query || '');
      setTelegramSourceTitle('');
      setTelegramSourceUrl('');
      setTelegramText('');
      setNotice(payload.plan.done ? 'Telegram keyword plan завершено.' : 'Перейшли до наступного Telegram-запиту.');
      await load(filter);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Не вдалося перейти до наступного Telegram-запиту.');
      await load(filter);
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

  async function ingestTelegramScan() {
    if (telegramBusy || !telegramText.trim()) return;
    setTelegramBusy(true);
    setError('');
    setNotice('');
    try {
      const run = await ensureTelegramRun();
      const payload = await post({
        action: 'ingest-telegram',
        runId: run.id,
        text: telegramText,
        sourceUrl: telegramSourceUrl,
        sourceTitle: telegramSourceTitle || 'Telegram Web',
        query: telegramQuery,
        seedLabel: telegramSourceTitle || telegramQuery || 'Telegram',
        context: telegramQuery,
      }) as unknown as TelegramIngestResponse;
      setNotice(`Telegram: витягнуто ${payload.batch.extracted}, нових ${payload.batch.added}, дублів ${payload.batch.duplicates}.`);
      setTelegramText('');
      await load(filter);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Не вдалося передати Telegram-результати в пошук.');
    } finally {
      setTelegramBusy(false);
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

  return <Dialog open={open} onOpenChange={next => { if (!next) close(); }}>
    <DialogContent className="w-[min(980px,calc(100vw-24px))] max-w-[980px] max-h-[90dvh] overflow-y-auto gap-4" showCloseButton={false}>
      <DialogHeader className="pr-10">
        <DialogTitle>Пошук нових чатів</DialogTitle>
        <DialogDescription>
          Пошук WhatsApp-кандидатів з дедуплікацією та provenance. Цільовий діапазон — 700–18 000 учасників.
          Невідомі критерії не вважаються підтвердженими: кандидат спочатку проходить фактичну перевірку.
        </DialogDescription>
      </DialogHeader>
      <Button className="absolute right-3 top-3" variant="ghost" size="icon" aria-label="Закрити" onClick={close}><X/></Button>

      {error && <div className="workspace-error" role="alert">{error}</div>}
      {notice && <output className="reports-notice">{notice}</output>}

      <section className="grid gap-3 rounded-xl border border-border/70 p-3" aria-label="Параметри пошуку">
        <div className="flex flex-wrap items-center gap-2">
          <strong className="mr-1">Платформа</strong>
          <Badge>WhatsApp</Badge>
          <span className="text-xs text-muted-foreground">Фокус: якісні українські спільноти; Viber/Telegram тимчасово вимкнені.</span>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <label htmlFor="discovery-goal" className="grid gap-1 text-sm font-medium">
            Нових кандидатів за запуск
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
          <label htmlFor="discovery-min-members" className="grid gap-1 text-sm font-medium">
            Мінімум учасників для target
            <Input
              id="discovery-min-members"
              type="number"
              min={1}
              max={10_000_000}
              value={minMembers}
              disabled={searching || run?.status === 'running'}
              onChange={event => setMinMembers(clampNumber(event.target.value, 1, 10_000_000, 700))}
            />
          </label>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" disabled={telegramBusy || searching || run?.status === 'running'} onClick={() => void startTelegramSearch()}>
            {telegramBusy ? <LoaderCircle data-icon="inline-start"/> : <Search data-icon="inline-start"/>}
            {run?.status === 'running' ? 'Telegram-план активний' : 'Почати Telegram-пошук'}
          </Button>
          {searching
            ? <><Button type="button" variant="outline" onClick={() => { stopRequested.current = true; }}><Square data-icon="inline-start"/>Зупинити fallback</Button><Button disabled><LoaderCircle data-icon="inline-start"/>Web fallback…</Button></>
            : <Button type="button" variant="outline" onClick={() => void startOrContinue()}>Додатковий web-пошук</Button>}
          {run && <span className="text-sm text-muted-foreground">
            Telegram: {run.telegramCursor} · опрацьовано запитів: {run.searchedQueries} · знайдено: {run.foundCount} · дублі: {run.duplicateCount} · передано: {workspace.importedCount}
          </span>}
        </div>
        {run?.errorMessage && <small className="text-muted-foreground">{run.errorMessage}</small>}
      </section>

      <section className="grid gap-3 rounded-xl border border-border/70 p-3" aria-label="Telegram джерело WhatsApp">
        <div className="grid gap-1">
          <strong>Telegram → WhatsApp</strong>
          <span className="text-xs text-muted-foreground">
            Основний канал discovery: Work OS бере наступний запит із твоєї keyword matrix, Telegram шукає джерела, а знайдені chat.whatsapp.com проходять dedupe та qualification.
          </span>
        </div>
        {workspace.telegramPlan && <div className="grid gap-2 rounded-lg border border-border/70 bg-muted/20 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <strong>Черга Telegram-запитів</strong>
            <span className="text-xs text-muted-foreground">{workspace.telegramPlan.cursor} / {workspace.telegramPlan.totalTasks}</span>
          </div>
          {workspace.telegramPlan.tasks.length ? <>
            <div className="rounded-lg bg-background p-3">
              <div className="text-xs text-muted-foreground">Поточний · {workspace.telegramPlan.tasks[0].seedKind === 'city' ? workspace.telegramPlan.tasks[0].city : workspace.telegramPlan.tasks[0].country}</div>
              <div className="mt-1 font-medium">{workspace.telegramPlan.tasks[0].query}</div>
              <div className="mt-1 text-xs text-muted-foreground">Шаблон: {workspace.telegramPlan.tasks[0].template}</div>
            </div>
            {workspace.telegramPlan.tasks.length > 1 && <details>
              <summary className="cursor-pointer text-sm font-medium">Наступні запити · {workspace.telegramPlan.tasks.length - 1}</summary>
              <div className="mt-2 grid gap-1 text-xs text-muted-foreground">
                {workspace.telegramPlan.tasks.slice(1).map(task => <div key={task.cursor}>{task.cursor + 1}. {task.query}</div>)}
              </div>
            </details>}
            <Button type="button" variant="outline" disabled={telegramBusy || searching || workspace.run?.status !== 'running'} onClick={() => void advanceTelegramTask()}>
              Опрацьовано → наступний
            </Button>
          </> : <span className="text-sm text-muted-foreground">Keyword plan завершено.</span>}
        </div>}
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="grid gap-1 text-sm font-medium" htmlFor="telegram-source-title">
            Telegram-чат
            <Input id="telegram-source-title" value={telegramSourceTitle} disabled={telegramBusy} onChange={event => setTelegramSourceTitle(event.target.value)} placeholder="Українці в Берліні" />
          </label>
          <label className="grid gap-1 text-sm font-medium" htmlFor="telegram-source-url">
            Посилання на джерело
            <Input id="telegram-source-url" value={telegramSourceUrl} disabled={telegramBusy} onChange={event => setTelegramSourceUrl(event.target.value)} placeholder="https://t.me/…" />
          </label>
        </div>
        <label className="grid gap-1 text-sm font-medium" htmlFor="telegram-query">
          Ключове слово / запит
          <Input id="telegram-query" value={telegramQuery} disabled={telegramBusy} onChange={event => setTelegramQuery(event.target.value)} placeholder="Українці Берлін / WhatsApp" />
        </label>
        <label className="grid gap-1 text-sm font-medium" htmlFor="telegram-scan">
          Результати пошуку Telegram
          <Textarea id="telegram-scan" rows={6} value={telegramText} disabled={telegramBusy} onChange={event => setTelegramText(event.target.value)} placeholder="Текст повідомлень або результатів пошуку з посиланнями chat.whatsapp.com…" />
        </label>
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="outline" disabled={telegramBusy || searching || !telegramText.trim()} onClick={() => void ingestTelegramScan()}>
            {telegramBusy ? <LoaderCircle data-icon="inline-start"/> : <ExternalLink data-icon="inline-start"/>}
            {telegramBusy ? 'Обробляємо…' : 'Передати Telegram-скан'}
          </Button>
          <span className="text-xs text-muted-foreground">Цей вхід також використовується браузерною автоматизацією; вручну копіювати результати не обов’язково.</span>
        </div>
      </section>

      <section className="grid gap-3" aria-label="Кандидати">
        <div className="flex flex-wrap items-center gap-2">
          <strong>Кандидати</strong>
          {([
            ['all', 'Усі', total],
            ['review', 'На перевірку', workspace.counts.review],
            ['target', 'Цільові', workspace.counts.target],
            ['rejected', 'Відхилені', workspace.counts.rejected],
            ['unavailable', 'Недоступні', workspace.counts.unavailable],
          ] as Array<[DecisionFilter, string, number]>).map(([key, label, count]) =>
            <Button key={key} type="button" size="sm" variant={filter === key ? 'default' : 'outline'} disabled={loading} onClick={() => void changeFilter(key)}>
              {label} · {count}
            </Button>)}
        </div>

        {loading
          ? <div className="workspace-loading"><LoaderCircle/>Завантажуємо кандидатів…</div>
          : workspace.candidates.length
            ? <div className="grid max-h-[48dvh] gap-2 overflow-y-auto pr-1">
              {workspace.candidates.map(candidate =>
                <article key={candidate.id} className="grid gap-2 rounded-xl border border-border/70 p-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <strong className="break-words">{candidate.name || candidate.link}</strong>
                        <Badge variant={candidate.decision === 'target' ? 'default' : 'outline'}>{decisionLabel(candidate.decision)}</Badge>
                        <Badge variant="secondary">{platformLabel(candidate.platform)}</Badge>
                      </div>
                      <div className="mt-1 break-all text-xs text-muted-foreground">{candidate.link}</div>
                      {candidate.importedChatId && <div className="mt-2 flex flex-wrap gap-1.5">
                        <Badge variant="secondary">{membershipLabel(candidate.membershipState)}</Badge>
                        <Badge variant="outline">{inspectionLabel(candidate.inspectionState)}</Badge>
                      </div>}
                    </div>
                    {candidate.importedChatId
                      ? <Badge variant="secondary">У Work OS</Badge>
                      : (candidate.decision === 'review' || candidate.decision === 'target') &&
                        <Button type="button" size="sm" disabled={importingId !== null} onClick={() => void importCandidate(candidate)}>
                          {importingId === candidate.id ? <LoaderCircle data-icon="inline-start"/> : null}
                          Додати на перевірку
                        </Button>}
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {candidate.reasonCodes.map(code => <span key={code} className="rounded-md bg-muted px-2 py-1 text-xs text-muted-foreground">{reasonLabel(code)}</span>)}
                  </div>
                  {candidate.importedChatId && candidate.membershipState === 'joined' && candidate.decision === 'review' &&
                    <div className="rounded-lg border border-border/70 bg-muted/30 px-3 py-2 text-xs text-muted-foreground">Приєднано. Автоперевірці ще бракує фактів для цільового статусу — потрібна кваліфікація.</div>}
                  {candidate.importedChatId && candidate.membershipState === 'joined' && (candidate.decision === 'rejected' || candidate.decision === 'unavailable') &&
                    <div className="workspace-error">Чат уже приєднаний, але після перевірки не відповідає критеріям. Потрібен підтверджений вихід із месенджера — до цього Work OS не ховає чат автоматично.</div>}
                  <div className="grid gap-1 text-xs text-muted-foreground sm:grid-cols-3">
                    <span>Учасники: {candidate.memberCount ?? 'невідомо'}</span>
                    <span>Активність: {activityLabel(candidate.activityState)}</span>
                    <span>Писати: {candidate.canWrite === null ? 'невідомо' : candidate.canWrite ? 'так' : 'ні'}</span>
                  </div>
                  {candidate.sources.length > 0 && <details>
                    <summary className="cursor-pointer text-sm font-medium">Звідки знайдено · {candidate.sources.length}</summary>
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
                </article>)}
            </div>
            : <div className="workspace-empty"><Search aria-hidden="true"/><strong>Кандидатів ще немає</strong><p>Запусти пошук або зміни фільтр.</p></div>}
      </section>
    </DialogContent>
  </Dialog>;
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

function activityLabel(value: DiscoveryCandidate['activityState']) {
  return value === 'active' ? 'активний' : value === 'dead' ? 'неактивний' : 'невідомо';
}

function membershipLabel(value: DiscoveryCandidate['membershipState']) {
  return value === 'joined' ? 'Приєднано'
    : value === 'pending' ? 'Очікує схвалення'
      : value === 'left' ? 'Вийшли з чату'
        : 'Вступ не перевірено';
}

function inspectionLabel(value: DiscoveryCandidate['inspectionState']) {
  return value === 'inspected' ? 'Автоперевірено'
    : value === 'failed' ? 'Автоперевірка не завершена'
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
