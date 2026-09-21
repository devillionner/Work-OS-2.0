'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ExternalLink, LoaderCircle, Search, Square, X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import type { DiscoveryCandidate, DiscoveryDecision, DiscoveryRun } from '@/lib/chat-discovery/domain';
import type { DiscoveryPlatform } from '@/lib/chat-discovery/public-web';

type Workspace = {
  run: DiscoveryRun | null;
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
  const [workspace, setWorkspace] = useState<Workspace>({ run: null, counts: EMPTY_COUNTS, importedCount: 0, candidates: [] });
  const [platforms, setPlatforms] = useState<DiscoveryPlatform[]>(['whatsapp', 'viber']);
  const [goal, setGoal] = useState(30);
  const [minMembers, setMinMembers] = useState(700);
  const [filter, setFilter] = useState<DecisionFilter>('all');
  const [loading, setLoading] = useState(false);
  const [searching, setSearching] = useState(false);
  const [importingId, setImportingId] = useState<string | null>(null);
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

  function togglePlatform(platform: DiscoveryPlatform) {
    if (searching || workspace.run?.status === 'running') return;
    setPlatforms(current => current.includes(platform)
      ? current.filter(item => item !== platform)
      : [...current, platform]);
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

  async function startOrContinue() {
    if (searching) return;
    if (!workspace.run && !platforms.length) {
      setError('Виберіть WhatsApp або Viber.');
      return;
    }
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
          Публічний пошук WhatsApp/Viber з дедуплікацією та provenance. Невідомі критерії не вважаються підтвердженими:
          кандидат спочатку переходить у «Для приєднання», де проходить фактичну перевірку.
        </DialogDescription>
      </DialogHeader>
      <Button className="absolute right-3 top-3" variant="ghost" size="icon" aria-label="Закрити" onClick={close}><X/></Button>

      {error && <div className="workspace-error" role="alert">{error}</div>}
      {notice && <output className="reports-notice">{notice}</output>}

      <section className="grid gap-3 rounded-xl border border-border/70 p-3" aria-label="Параметри пошуку">
        <div className="flex flex-wrap items-center gap-2">
          <strong className="mr-1">Платформи</strong>
          {(['whatsapp', 'viber'] as DiscoveryPlatform[]).map(platform =>
            <Button
              key={platform}
              type="button"
              size="sm"
              variant={platforms.includes(platform) ? 'default' : 'outline'}
              aria-pressed={platforms.includes(platform)}
              disabled={searching || run?.status === 'running'}
              onClick={() => togglePlatform(platform)}
            >
              {platformLabel(platform)}
            </Button>)}
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
          {searching
            ? <><Button type="button" variant="outline" onClick={() => { stopRequested.current = true; }}><Square data-icon="inline-start"/>Зупинити</Button><Button disabled><LoaderCircle data-icon="inline-start"/>Шукаємо…</Button></>
            : <Button type="button" onClick={() => void startOrContinue()}><Search data-icon="inline-start"/>{run?.status === 'running' ? 'Продовжити пошук' : 'Почати пошук'}</Button>}
          {run && <span className="text-sm text-muted-foreground">
            Запитів: {run.searchedQueries} · знайдено: {run.foundCount} · дублі: {run.duplicateCount} · передано: {workspace.importedCount}
          </span>}
        </div>
        {run?.errorMessage && <small className="text-muted-foreground">{run.errorMessage}</small>}
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
    too_few_members: 'замало учасників',
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
