'use client';

import { useDeferredValue, useMemo, useState } from 'react';
import { X } from 'lucide-react';
import { Panel } from '@/components/shell/panel';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { useToast } from '@/components/ui/toast';
import { AUDIENCE_NAMES, savePoolList } from '@/components/views/platforms/pool-types';
import { POOL_DIRECTIONS, parsePoolList, poolAdText, poolSnippet, type ParsedPoolAd, type PoolAudience, type PoolLanguage, type PoolRejected } from '@/lib/telegram-pool/parse';
import { businessDate } from '@/lib/business-time';

type Edit = Partial<Pick<ParsedPoolAd, 'direction' | 'audience' | 'language' | 'until'>>;
const REJECT_LABEL: Record<PoolRejected['kind'], string> = {
  heading: 'службовий заголовок', duplicate: 'точний дубль', near_duplicate: 'майже дубль (≥ 90 %)', too_long: 'довше за 4096 символів', empty: 'порожнє після прибирання', existing: 'уже є в пулі',
};
const chip = 'min-h-8 rounded-full border border-line px-2.5 text-xs [@media(pointer:coarse)]:min-h-11';

function dateLabel(value: string): string {
  const [year, month, day] = value.split('-');
  return `${day}.${month}.${year}`;
}

/** Один розпізнаний текст: перші слова, розмітка чіпами (її можна виправити), повний текст зі закресленими закликами Instagram. */
function AdRow({ ad, edit, restored, onEdit, onRestore, onRemove }: { ad: ParsedPoolAd; edit: Edit; restored: ReadonlySet<number>; onEdit: (patch: Edit) => void; onRestore: (line: number) => void; onRemove: () => void }) {
  const direction = edit.direction ?? ad.direction;
  const audience = edit.audience ?? ad.audience;
  const language = edit.language ?? ad.language;
  const until = edit.until !== undefined ? edit.until : ad.until;
  const text = poolAdText(ad, restored);
  return (
    <li className="flex flex-col gap-2 rounded-inner border border-line p-3">
      <div className="flex items-start gap-2">
        <p className="m-0 min-w-0 flex-1 text-sm font-medium">{poolSnippet(text, 90)}</p>
        <button type="button" aria-label="Не додавати це оголошення" title="Не додавати" onClick={onRemove} className="inline-flex size-7 shrink-0 items-center justify-center rounded-full text-ink-3 hover:bg-raised hover:text-ink"><X aria-hidden="true" strokeWidth={1.5} className="size-4" /></button>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <Select aria-label="Напрям" wrapperClassName="w-auto" className={chip} value={direction} onChange={(event) => onEdit({ direction: event.target.value })}>
          <option value="">Без напряму</option>
          {POOL_DIRECTIONS.map((name) => <option key={name} value={name}>{name}</option>)}
          {direction && !(POOL_DIRECTIONS as readonly string[]).includes(direction) ? <option value={direction}>{direction}</option> : null}
        </Select>
        <Select aria-label="Аудиторія" wrapperClassName="w-auto" className={chip} value={audience} onChange={(event) => onEdit({ audience: event.target.value as PoolAudience })}>
          {(Object.keys(AUDIENCE_NAMES) as PoolAudience[]).map((key) => <option key={key} value={key}>{AUDIENCE_NAMES[key]}</option>)}
        </Select>
        <Select aria-label="Мова" wrapperClassName="w-auto" className={chip} value={language} onChange={(event) => onEdit({ language: event.target.value as PoolLanguage })}>
          <option value="uk">UA</option><option value="ru">RU</option>
        </Select>
        <label className="inline-flex items-center gap-1.5 text-xs text-ink-2">
          <span>{until ? 'до' : 'без терміну'}</span>
          <input type="date" aria-label="Актуальне до" value={until ?? ''} onChange={(event) => onEdit({ until: event.target.value || null })} className={`${chip} bg-transparent font-mono tabular-nums`} />
        </label>
        <span className="ml-auto font-mono text-[11px] tabular-nums text-ink-3">{ad.author ? `${ad.author} · ` : ''}{Array.from(text).length}</span>
      </div>
      <details className="group">
        <summary className="cursor-pointer list-none text-xs text-ink-2 [&::-webkit-details-marker]:hidden"><span className="underline decoration-line-strong underline-offset-4">Текст{ad.drop.length ? ` · прибрано заклики: ${ad.drop.length - ad.drop.filter((line) => restored.has(line)).length}` : ''}</span></summary>
        <div className="mt-2 whitespace-pre-wrap break-words text-[13px] text-ink-2">
          {ad.lines.map((line, index) => (ad.drop.includes(index)
            ? (
              <span key={index} className="flex items-start gap-2">
                <span className={restored.has(index) ? '' : 'line-through decoration-ink-3'}>{line}</span>
                <button type="button" onClick={() => onRestore(index)} className="shrink-0 text-xs text-ink underline decoration-line-strong underline-offset-4">{restored.has(index) ? 'Прибрати' : 'Повернути'}</button>
              </span>
            )
            : <span key={index} className="block min-h-[1.2em]">{line}</span>))}
        </div>
      </details>
    </li>
  );
}

/**
 * Вставка списку оголошень у пул Telegram: розбір у браузері звичайними правилами, перегляд розпізнаного (розмітку можна виправити,
 * заклики для Instagram закреслені й повертаються), «Замінити пул» (попередній архівується) чи «Додати до пулу».
 */
export function PoolPanel({ open, onOpenChange, total, onSaved }: { open: boolean; onOpenChange: (open: boolean) => void; /** Скільки текстів у пулі зараз. */ total: number; onSaved: () => void }) {
  const toast = useToast();
  const [raw, setRaw] = useState('');
  const deferred = useDeferredValue(raw);
  const [today] = useState(() => businessDate(Math.floor(Date.now() / 1000)));
  const [edits, setEdits] = useState<Record<number, Edit>>({});
  const [restored, setRestored] = useState<Record<number, number[]>>({});
  const [removed, setRemoved] = useState<number[]>([]);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const parsed = useMemo(() => parsePoolList(deferred, { today }), [deferred, today]);
  const ads = parsed.ads.filter((ad) => !removed.includes(ad.index));
  const counts = useMemo(() => {
    const map = new Map<string, number>();
    for (const ad of ads) { const key = edits[ad.index]?.direction ?? ad.direction; map.set(key || 'Без напряму', (map.get(key || 'Без напряму') ?? 0) + 1); }
    return [...map];
  }, [ads, edits]);
  const rejectedBy = useMemo(() => {
    const map = new Map<PoolRejected['kind'], number>();
    for (const item of parsed.rejected) map.set(item.kind, (map.get(item.kind) ?? 0) + 1);
    return [...map];
  }, [parsed.rejected]);
  const dropped = ads.reduce((sum, ad) => sum + ad.drop.length - ad.drop.filter((line) => restored[ad.index]?.includes(line)).length, 0);

  const reset = () => { setRaw(''); setEdits({}); setRestored({}); setRemoved([]); setError(null); };
  const items = () => ads.map((ad) => {
    const edit = edits[ad.index] ?? {};
    return { text: poolAdText(ad, new Set(restored[ad.index] ?? [])), direction: edit.direction ?? ad.direction, audience: edit.audience ?? ad.audience, language: edit.language ?? ad.language, until: edit.until !== undefined ? edit.until : ad.until, author: ad.author };
  });
  const save = async (mode: 'replace' | 'add') => {
    setBusy(true); setError(null);
    try {
      const result = await savePoolList(mode, items());
      onSaved();
      toast.push({ message: mode === 'replace'
        ? `Пул замінено: ${result.saved} текстів${result.kept ? `, з них ${result.kept} уже були` : ''}${result.archived ? `, ${result.archived} старих в архіві` : ''}.`
        : `Додано до пулу ${result.saved}${result.skipped ? `, ${result.skipped} уже були або схожі` : ''}. У пулі тепер ${result.pool.summary.total}.` });
      reset(); onOpenChange(false);
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Не вдалося зберегти пул.'); }
    finally { setBusy(false); setConfirm(false); }
  };

  const footer = (
    <div className="grid grid-cols-2 gap-2">
      <Button variant="outline" disabled={busy || ads.length === 0} onClick={() => void save('add')}>Додати до пулу</Button>
      <Button variant="action" busy={busy} disabled={busy || ads.length === 0} onClick={() => (total ? setConfirm(true) : void save('replace'))}>Замінити пул</Button>
    </div>
  );
  return (
    <>
      <Panel open={open} onOpenChange={(next) => { if (!next) setError(null); onOpenChange(next); }} title="Список оголошень" subtitle={total ? `Зараз у пулі ${total}` : 'Пул ще порожній'} footer={footer}>
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <label htmlFor="pool-raw" className="text-sm font-medium">Вставте оголошення</label>
            <Textarea id="pool-raw" rows={8} value={raw} onChange={(event) => { setRaw(event.target.value); setEdits({}); setRestored({}); setRemoved([]); }} placeholder={'Автор:\nТекст оголошення…\n\nАвтор:\nІнший текст…'} />
            <p className="m-0 text-xs text-ink-2">Автор — рядок «Ім’я:» перед текстом. Без авторів розділяйте оголошення двома порожніми рядками. Один порожній рядок лишається всередині оголошення.</p>
          </div>
          {raw.trim() ? (
            <section className="flex flex-col gap-3" aria-label="Що розпізнано">
              <p className="m-0 text-sm">
                Розпізнано <b className="font-mono font-medium tabular-nums">{ads.length}</b>
                {counts.length ? <span className="text-ink-2"> · {counts.map(([name, count]) => `${name} ${count}`).join(' · ')}</span> : null}
              </p>
              {parsed.authors.length ? <p className="m-0 text-xs text-ink-2">Автори: {parsed.authors.join(', ')}</p> : null}
              {rejectedBy.length || dropped || parsed.broken ? (
                <p className="m-0 text-xs text-ink-2">
                  {[...rejectedBy.map(([kind, count]) => `${REJECT_LABEL[kind]}: ${count}`), dropped ? `заклики для Instagram прибрано: ${dropped}` : '', parsed.broken ? `зламаних символів прибрано: ${parsed.broken}` : ''].filter(Boolean).join(' · ')}
                </p>
              ) : null}
              {parsed.rejected.length ? (
                <details className="group rounded-inner border border-line">
                  <summary className="cursor-pointer list-none px-3 py-2 text-xs text-ink-2 [&::-webkit-details-marker]:hidden">Що відкинуто ({parsed.rejected.length})</summary>
                  <ul className="m-0 flex list-none flex-col gap-1 p-3 pt-0 text-xs">
                    {parsed.rejected.map((item, index) => <li key={index} className="flex gap-2"><span className="shrink-0 text-ink-3">{REJECT_LABEL[item.kind]}</span><span className="min-w-0 truncate" title={item.text}>{poolSnippet(item.text, 70)}</span></li>)}
                  </ul>
                </details>
              ) : null}
              <ul className="m-0 flex list-none flex-col gap-2 p-0">
                {ads.map((ad) => (
                  <AdRow key={ad.index} ad={ad} edit={edits[ad.index] ?? {}} restored={new Set(restored[ad.index] ?? [])}
                    onEdit={(patch) => setEdits((current) => ({ ...current, [ad.index]: { ...current[ad.index], ...patch } }))}
                    onRestore={(line) => setRestored((current) => { const set = new Set(current[ad.index] ?? []); if (set.has(line)) set.delete(line); else set.add(line); return { ...current, [ad.index]: [...set] }; })}
                    onRemove={() => setRemoved((current) => [...current, ad.index])} />
                ))}
              </ul>
            </section>
          ) : null}
          {error ? <p className="m-0 text-sm text-hot" role="alert">{error}</p> : null}
        </div>
      </Panel>
      <ConfirmDialog open={confirm} title="Замінити пул" description={`Тексти поточного пулу (${total}), яких немає в новому списку, потраплять в архів. Тексти, що збігаються, лишаються як були, тож ті, що вже виходили сьогодні, повторно сьогодні не видаватимуться.`} confirmLabel="Замінити" busy={busy} onCancel={() => setConfirm(false)} onConfirm={() => void save('replace')} />
    </>
  );
}
