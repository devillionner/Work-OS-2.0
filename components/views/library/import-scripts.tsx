'use client';

import { useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Chip } from '@/components/ui/chip';
import { Ghost } from '@/components/ui/ghost';
import { humanError } from '@/components/ui/human-error';
import { Surface } from '@/components/ui/surface';
import { Checkbox } from '@/components/ui/toggle';
import { useToast } from '@/components/ui/toast';
import { Confirmation } from '@/components/views/leads/form';
import { useRemote } from '@/components/views/shared/use-remote';
import { ScriptText } from './script-editor';
import { announceDataChange } from '@/lib/client-sync';
import { IMPORT_CHUNK, entryTitle, parseImportPackage, type ImportEntry, type ImportGroup, type ImportPackage, type ImportVersion } from '@/lib/script-import';
import { TEMPLATE_SCRIPTS } from '@/lib/script-fields';
import { cn } from '@/lib/utils';

const STAGE_LABELS: Record<string, string> = { response: 'Відгук', clarification: 'Уточнення', booked: 'Записано', reminder: 'Нагадування', lesson: 'Урок', result: 'Результат' };
type ExistingItem = { title: string; templateKey: string | null };
type Summary = { created: number; skipped: number; replaced: number };

const NO_GROUPS: ImportGroup[] = [];
const isConflict = (group: ImportGroup) => group.versions.length > 1 || group.versions.some((version) => version.templateKey);

/** Версії групи, відмічені за замовчуванням: рекомендація, крім скриптів, назва яких уже є в «Офіційних скриптах». */
function defaultSelection(pack: ImportPackage, existing: ReadonlySet<string>): Set<string> {
  const picked = new Set<string>();
  for (const group of pack.groups) {
    for (const version of group.versions) {
      if (group.recommended.includes(version.id) && (version.templateKey || !existing.has(version.title))) picked.add(version.id);
    }
  }
  return picked;
}

function VersionBody({ version }: { version: ImportVersion }) {
  return (
    <div className="flex min-w-0 flex-col gap-2">
      {version.question ? (
        <div className="flex flex-col gap-1">
          <span className="text-xs font-medium text-ink-2">Спочатку питання</span>
          <ScriptText text={version.question} className="text-[13px] leading-relaxed text-ink-2" />
        </div>
      ) : null}
      <ScriptText text={version.text} className="max-h-72 overflow-y-auto pr-1 text-[13px] leading-relaxed" />
      {version.note ? <p className="m-0 whitespace-pre-line text-xs text-ink-2">{version.note}</p> : null}
    </div>
  );
}

function Marking({ version }: { version: ImportVersion }) {
  const chips = [version.stage ? STAGE_LABELS[version.stage] ?? version.stage : 'Будь-який етап', ...(version.branch ? [`Гілка: ${version.branch}`] : []), ...version.tags];
  return <p className="m-0 flex flex-wrap gap-1 text-[11px] text-ink-2">{chips.map((chip) => <span key={chip} className="rounded-full border border-line px-2 py-0.5">{chip}</span>)}</p>;
}

function GroupCard({ group, selected, toggle, existing }: { group: ImportGroup; selected: ReadonlySet<string>; toggle: (id: string, on: boolean) => void; existing: ReadonlySet<string> }) {
  const builtIn = group.versions.find((version) => version.templateKey) ? TEMPLATE_SCRIPTS.find((template) => template.key === group.versions.find((version) => version.templateKey)?.templateKey) : null;
  const columns = group.versions.length + (builtIn ? 1 : 0);
  return (
    <Surface variant="glass" radius="inner" className="flex flex-col gap-3 p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="m-0 text-sm font-medium">{group.title}</h3>
        {isConflict(group) ? <span className="text-xs text-ink-2">{builtIn ? 'Шаблон Work OS і таблиця' : `Версій: ${group.versions.length}`}</span> : null}
      </div>
      <div className={cn('grid gap-3', columns > 1 ? '@2xl:grid-cols-2 @5xl:grid-cols-3' : '')}>
        {builtIn ? (
          <div className="flex min-w-0 flex-col gap-2 rounded-inner border border-line p-3">
            <span className="text-sm font-medium">Шаблон Work OS</span>
            <p className="m-0 text-xs text-ink-2">Вбудований шаблон: лишиться, якщо не обирати текст таблиці.</p>
            <ScriptText text={builtIn.ukText} className="max-h-72 overflow-y-auto pr-1 text-[13px] leading-relaxed" />
          </div>
        ) : null}
        {group.versions.map((version) => {
          const duplicate = !version.templateKey && existing.has(version.title);
          const recommended = group.recommended.includes(version.id);
          return (
            <div key={version.id} className={cn('flex min-w-0 flex-col gap-2 rounded-inner border p-3', selected.has(version.id) ? 'border-line-strong' : 'border-line')}>
              <label className="flex items-center gap-2 text-sm">
                <Checkbox checked={selected.has(version.id)} disabled={duplicate} aria-label={`Взяти: ${group.title}, ${version.label}`} onCheckedChange={(checked) => toggle(version.id, checked)} />
                <span className="font-medium">{builtIn ? 'Текст таблиці' : version.label}</span>
                {recommended ? <span className="rounded-full bg-raised px-2 py-0.5 text-[11px] text-ink-2">Рекомендовано</span> : null}
              </label>
              {duplicate ? <p className="m-0 text-xs text-warn">Скрипт із такою назвою вже є в «Офіційних скриптах».</p> : null}
              <Marking version={version} />
              <VersionBody version={version} />
            </div>
          );
        })}
      </div>
      {group.why && isConflict(group) ? <p className="m-0 text-xs text-ink-2">{group.why}</p> : null}
    </Surface>
  );
}

/**
 * Імпорт скриптів із таблиць: файл пакета → перегляд (різні версії одного скрипту поруч із рекомендацією) → підтвердження → створення
 * в «Офіційних скриптах» порціями. Пакет збирається поза репозиторієм (там ціни й робочі тексти); на сервер нічого не йде до підтвердження.
 */
export default function ImportScripts({ onClose, onChanged }: { onClose: () => void; onChanged: () => void }) {
  const toast = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [pack, setPack] = useState<ImportPackage | null>(null);
  const [fileName, setFileName] = useState('');
  const [fileError, setFileError] = useState('');
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [reviewed, setReviewed] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const existingRemote = useRemote<{ items?: ExistingItem[] }>('/api/library?kind=script&collection=official_script', { fallback: 'Не вдалося перевірити наявні скрипти.' });
  const existing = useMemo(() => new Set((existingRemote.data?.items ?? []).filter((item) => !item.templateKey).map((item) => item.title)), [existingRemote.data]);

  const groups = pack ? pack.groups : NO_GROUPS;
  const conflicts = useMemo(() => groups.filter(isConflict), [groups]);
  const singles = useMemo(() => groups.filter((group) => !isConflict(group)), [groups]);
  const sections = useMemo(() => {
    const map = new Map<string, ImportGroup[]>();
    for (const group of singles) map.set(group.section || 'Інше', [...(map.get(group.section || 'Інше') ?? []), group]);
    return [...map.entries()];
  }, [singles]);
  const duplicates = useMemo(() => groups.reduce((sum, group) => sum + (group.versions.some((version) => !version.templateKey && existing.has(version.title)) ? 1 : 0), 0), [groups, existing]);

  const chosen = useMemo(() => groups.flatMap((group) => {
    const versions = group.versions.filter((version) => selected.has(version.id));
    return versions.map((version, index) => ({ group, version, index, count: versions.length }));
  }), [groups, selected]);

  const load = async (file: File | undefined) => {
    if (!file) return;
    setFileError('');
    try {
      const parsed = parseImportPackage(await file.text());
      setPack(parsed);
      setFileName(file.name);
      setSelected(defaultSelection(parsed, existing));
      setReviewed(false);
      setSummary(null);
    } catch (reason) {
      setPack(null);
      setFileError(humanError(reason, 'Не вдалося прочитати файл.'));
    }
  };

  const toggle = (id: string, on: boolean) => setSelected((current) => { const next = new Set(current); if (on) next.add(id); else next.delete(id); return next; });

  const run = async () => {
    const entries: ImportEntry[] = chosen.map(({ group, version, index, count }) => ({
      title: entryTitle(group, version, count), text: version.text, question: version.question, note: version.note, stage: version.stage,
      tags: version.tags, branch: version.branch, templateKey: version.templateKey ?? null, rank: group.order * 10 + index,
    }));
    const stamp = Math.floor(Date.now() / 1000);
    const total: Summary = { created: 0, skipped: 0, replaced: 0 };
    setProgress({ done: 0, total: entries.length });
    try {
      for (let start = 0; start < entries.length; start += IMPORT_CHUNK) {
        const part = entries.slice(start, start + IMPORT_CHUNK);
        const response = await fetch('/api/library/import-scripts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ stamp, entries: part }) });
        const body = await response.json().catch(() => ({})) as { error?: string; created?: number; skipped?: string[]; replaced?: number };
        if (!response.ok) throw new Error(body.error || 'Не вдалося імпортувати скрипти.');
        total.created += body.created ?? 0;
        total.skipped += body.skipped?.length ?? 0;
        total.replaced += body.replaced ?? 0;
        setProgress({ done: Math.min(entries.length, start + part.length), total: entries.length });
      }
    } catch (reason) {
      // Уже створене лишається; повторний імпорт пропустить скрипти з однаковою назвою й дойде до решти.
      setSummary(total);
      setProgress(null);
      announceDataChange('all');
      onChanged();
      throw reason;
    }
    setSummary(total);
    setProgress(null);
    announceDataChange('all');
    onChanged();
    toast.push({ message: `Імпортовано: ${total.created}, шаблонів замінено: ${total.replaced}, пропущено: ${total.skipped}.`, tone: 'ok' });
  };

  const canImport = chosen.length > 0 && (reviewed || conflicts.length === 0) && !progress;

  return (
    <section aria-label="Імпорт скриптів з таблиць" className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="m-0 text-base font-medium">Імпорт скриптів з таблиць</h2>
          <p className="m-0 max-w-[70ch] text-[13px] text-ink-2">Основа — «Оновлені скрипти», зі старої таблиці береться те, чого в новій немає. Якщо один скрипт є в обох і тексти різні, версії стоять поруч із рекомендацією: вибираєш ти. Нічого не створюється, доки не підтвердиш.</p>
        </div>
        <Button variant="outline" size="sm" onClick={onClose}>До Бібліотеки</Button>
      </div>

      {!pack ? (
        <Surface variant="glass" radius="card" className="flex flex-col items-start gap-3 p-4">
          <p className="m-0 max-w-[70ch] text-sm text-ink-2">Вибери файл пакета (JSON), який підготовлено з двох таблиць. Він лежить поза репозиторієм: у ньому ціни й робочі тексти. Файл читається в браузері, на сервер нічого не йде до підтвердження.</p>
          <input ref={input} type="file" accept=".json,application/json" aria-label="Файл пакета скриптів" className="sr-only" onChange={(event) => { void load(event.target.files?.[0]); event.target.value = ''; }} />
          <Button variant="action" size="sm" onClick={() => input.current?.click()}>Вибрати файл пакета</Button>
          {fileError ? <p role="alert" className="m-0 text-sm text-hot">{fileError}</p> : null}
        </Surface>
      ) : summary && !progress ? (
        <Surface variant="glass" radius="card" className="flex flex-col items-start gap-3 p-4">
          <p className="m-0 text-sm">Створено скриптів: <span className="font-mono">{summary.created}</span>, шаблонів замінено: <span className="font-mono">{summary.replaced}</span>, пропущено (така назва вже є): <span className="font-mono">{summary.skipped}</span>.</p>
          <div className="flex gap-2"><Button variant="action" size="sm" onClick={onClose}>До Бібліотеки</Button><Button variant="outline" size="sm" onClick={() => { setSummary(null); setSelected(defaultSelection(pack, existing)); }}>Ще раз переглянути</Button></div>
        </Surface>
      ) : (
        <>
          <Surface variant="glass" radius="card" className="flex flex-col gap-3 p-4">
            <p className="m-0 text-sm text-ink-2">Файл «{fileName}»: скриптів <span className="font-mono text-ink">{groups.length}</span>, з різними версіями <span className="font-mono text-ink">{conflicts.length}</span>{duplicates ? <>, уже є в Бібліотеці <span className="font-mono text-ink">{duplicates}</span></> : null}.</p>
            <div className="flex flex-wrap items-center gap-2">
              <Chip onClick={() => setSelected(defaultSelection(pack, existing))}>Рекомендації</Chip>
              <Chip onClick={() => setSelected(new Set(singles.flatMap((group) => group.versions.filter((version) => !existing.has(version.title)).map((version) => version.id))))}>Лише без різних версій</Chip>
              <Chip onClick={() => setSelected(new Set())}>Зняти все</Chip>
              <Button variant="ghost" size="sm" onClick={() => { setPack(null); setSelected(new Set()); }}>Інший файл</Button>
            </div>
          </Surface>

          {conflicts.length ? (
            <div className="flex flex-col gap-3">
              <h2 className="m-0 text-base font-medium">Різні версії · {conflicts.length}</h2>
              <p className="m-0 max-w-[70ch] text-[13px] text-ink-2">Тут скрипт є в обох таблицях і тексти різні, або текст таблиці замінює вбудований шаблон. Позначено мою рекомендацію; можна взяти кілька версій (тоді до назви додається підпис версії) або жодної.</p>
              {existingRemote.loading && !existingRemote.data ? <Ghost className="h-24 rounded-inner" /> : conflicts.map((group) => <GroupCard key={group.id} group={group} selected={selected} toggle={toggle} existing={existing} />)}
            </div>
          ) : null}

          {sections.map(([section, list]) => (
            <details key={section} className="flex flex-col gap-3">
              <summary className="cursor-pointer text-base font-medium">{section} · {list.length}</summary>
              <div className="mt-3 flex flex-col gap-3">{list.map((group) => <GroupCard key={group.id} group={group} selected={selected} toggle={toggle} existing={existing} />)}</div>
            </details>
          ))}

          <div className="sticky bottom-0 z-10 flex flex-wrap items-center justify-between gap-3 rounded-card border border-line bg-field p-3">
            <div className="flex min-w-0 flex-col gap-1">
              <span className="text-sm">Буде створено: <span className="font-mono">{chosen.length}</span></span>
              {conflicts.length ? (
                <label className="flex items-center gap-2 text-[13px] text-ink-2">
                  <Checkbox checked={reviewed} aria-label="Я переглянув різні версії" onCheckedChange={setReviewed} />
                  Переглянув різні версії ({conflicts.length})
                </label>
              ) : null}
            </div>
            <div className="flex items-center gap-3">
              {progress ? <span className="font-mono text-[13px] text-ink-2">{progress.done} / {progress.total}</span> : null}
              <Button variant="action" size="sm" disabled={!canImport} onClick={() => setConfirming(true)}>Імпортувати вибране</Button>
            </div>
          </div>
        </>
      )}
      {confirming ? (
        <Confirmation
          title={`Створити ${chosen.length} скриптів?`}
          description="Скрипти з назвою, яка вже є в «Офіційних скриптах», пропускаються. Текст вбудованих шаблонів, який вибрано з таблиці, замінюється (нова версія, попередню видно в історії)."
          close={() => setConfirming(false)}
          run={run}
        />
      ) : null}
    </section>
  );
}
