'use client';

import { useState } from 'react';
import { ArrowDown, ArrowUp, Check, Pencil, Trash2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/dialog';
import { Ghost } from '@/components/ui/ghost';
import { humanError } from '@/components/ui/human-error';
import { Input } from '@/components/ui/input';
import { useToast } from '@/components/ui/toast';
import { useRemote } from '@/components/views/shared/use-remote';
import { announceDataChange } from '@/lib/client-sync';
import type { Dictionaries, DictionaryKind } from '@/lib/library-dictionaries';
import { Block, Group } from './ui';

type Payload = { dictionaries: Dictionaries; usage: Record<DictionaryKind, Record<string, number>>; leads: Record<string, number>; standard: string[] };

const SECTIONS: ReadonlyArray<{ kind: DictionaryKind; title: string; note: string; placeholder: string }> = [
  { kind: 'directions', title: 'Напрямки', note: 'Предмети, до яких належить матеріал. Стандартні предмети Work OS не перейменовуються: за ними підбираються оголошення чатам.', placeholder: 'Новий напрямок' },
  { kind: 'tags', title: 'Теги', note: 'Довільні мітки матеріалів: батьки, НМТ, 1–4 клас.', placeholder: 'Новий тег' },
  { kind: 'branches', title: 'Гілки скриптів', note: 'Інтерес ліда, за яким Бібліотека радить скрипт: екзамени, розмовна.', placeholder: 'Нова гілка' },
];

async function send(body: Record<string, unknown>): Promise<{ error?: string; usage?: { items: number; leads: number } }> {
  const response = await fetch('/api/library/dictionaries', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const value = await response.json().catch(() => ({})) as { error?: string; usage?: { items: number; leads: number } };
  if (!response.ok) throw Object.assign(new Error(value.error || 'Не вдалося зберегти довідник.'), { usage: value.usage });
  return value;
}

function Section({ meta, data, onChanged }: { meta: (typeof SECTIONS)[number]; data: Payload; onChanged: () => void }) {
  const toast = useToast();
  const names = data.dictionaries[meta.kind];
  const [adding, setAdding] = useState('');
  const [renaming, setRenaming] = useState<{ name: string; value: string } | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const usageOf = (name: string) => (data.usage[meta.kind][name] ?? 0) + (meta.kind === 'branches' ? data.leads[name] ?? 0 : 0);

  const run = async (body: Record<string, unknown>, fallback: string): Promise<boolean> => {
    setBusy(true);
    try {
      await send(body);
      announceDataChange('all');
      onChanged();
      return true;
    } catch (reason) {
      toast.push({ message: humanError(reason, fallback), tone: 'hot' });
      return false;
    } finally { setBusy(false); }
  };

  const move = (index: number, offset: number) => {
    const next = [...names];
    const [item] = next.splice(index, 1);
    next.splice(index + offset, 0, item);
    void run({ action: 'save', [meta.kind]: next }, 'Не вдалося змінити порядок.');
  };

  return (
    <Block>
      <div className="mb-3"><h3 className="m-0 text-sm font-medium">{meta.title}</h3><p className="m-0 mt-0.5 max-w-[60ch] text-[13px] text-ink-2">{meta.note}</p></div>
      {names.length === 0 ? <p className="m-0 mb-3 text-sm text-ink-2">Записів ще немає.</p> : (
        <ul aria-label={meta.title} className="m-0 mb-3 flex list-none flex-col gap-1.5 p-0">
          {names.map((name, index) => {
            const used = usageOf(name);
            const standard = meta.kind === 'directions' && data.standard.includes(name);
            return (
              <li key={name} className="flex items-center gap-2 rounded-inner border border-line bg-sunken px-3 py-1.5">
                {renaming?.name === name ? (
                  <form className="flex min-w-0 flex-1 items-center gap-2" onSubmit={(event) => { event.preventDefault(); if (renaming.value.trim()) void run({ action: 'rename', kind: meta.kind, name, to: renaming.value }, 'Не вдалося перейменувати.').then((ok) => { if (ok) setRenaming(null); }); }}>
                    <Input value={renaming.value} maxLength={50} ref={(node) => node?.focus()} aria-label={`Нова назва: ${name}`} className="h-9" onChange={(event) => setRenaming({ name, value: event.target.value })} onKeyDown={(event) => { if (event.key === 'Escape') setRenaming(null); }} />
                    <Button type="submit" variant="icon" size="sm" disabled={busy} aria-label="Зберегти назву"><Check aria-hidden="true" strokeWidth={1.5} /></Button>
                    <Button type="button" variant="icon" size="sm" aria-label="Скасувати" onClick={() => setRenaming(null)}><X aria-hidden="true" strokeWidth={1.5} /></Button>
                  </form>
                ) : (
                  <>
                    <span className="min-w-0 flex-1"><span className="block truncate text-sm">{name}</span><span className="block text-xs text-ink-2">{used ? `Використано: ${used}` : 'Не використовується'}{standard ? ' · стандартний' : ''}</span></span>
                    <Button variant="icon" size="sm" disabled={busy || index === 0} aria-label={`Вище: ${name}`} onClick={() => move(index, -1)}><ArrowUp aria-hidden="true" strokeWidth={1.5} /></Button>
                    <Button variant="icon" size="sm" disabled={busy || index === names.length - 1} aria-label={`Нижче: ${name}`} onClick={() => move(index, 1)}><ArrowDown aria-hidden="true" strokeWidth={1.5} /></Button>
                    {standard ? null : <Button variant="icon" size="sm" disabled={busy} aria-label={`Перейменувати: ${name}`} onClick={() => setRenaming({ name, value: name })}><Pencil aria-hidden="true" strokeWidth={1.5} /></Button>}
                    <Button variant="icon" size="sm" disabled={busy} aria-label={`Видалити: ${name}`} onClick={() => setRemoving(name)}><Trash2 aria-hidden="true" strokeWidth={1.5} /></Button>
                  </>
                )}
              </li>
            );
          })}
        </ul>
      )}
      <form className="flex items-center gap-2" onSubmit={(event) => { event.preventDefault(); const name = adding.trim(); if (name) void run({ action: 'save', [meta.kind]: [...names, name] }, 'Не вдалося додати запис.').then((ok) => { if (ok) setAdding(''); }); }}>
        <Input value={adding} maxLength={50} aria-label={meta.placeholder} placeholder={meta.placeholder} onChange={(event) => setAdding(event.target.value)} />
        <Button type="submit" variant="outline" size="md" disabled={busy || !adding.trim()}>Додати</Button>
      </form>
      <ConfirmDialog
        open={removing !== null}
        title={`Видалити «${removing ?? ''}»?`}
        description={removing && usageOf(removing) ? `Запис використовується: ${data.usage[meta.kind][removing] ?? 0} матеріалів${meta.kind === 'branches' && data.leads[removing] ? ` і ${data.leads[removing]} лідів` : ''}. Після видалення вони втратять цей запис.` : 'Запис ніде не використовується.'}
        confirmLabel="Видалити"
        destructive
        busy={busy}
        onCancel={() => setRemoving(null)}
        onConfirm={() => { if (removing) void run({ action: 'delete', kind: meta.kind, name: removing, force: true }, 'Не вдалося видалити запис.').then(() => setRemoving(null)); }}
      />
    </Block>
  );
}

/** «Налаштування → Довідники»: напрямки, теги й гілки скриптів Бібліотеки; перейменування, порядок, видалення з перевіркою, де вжито. */
export function DictionariesGroup() {
  const [refresh, setRefresh] = useState(0);
  const { data, error } = useRemote<Payload>('/api/library/dictionaries', { refresh, revalidateOnEnable: true, fallback: 'Не вдалося завантажити довідники.' });
  return (
    <Group id="dictionaries" title="Довідники" hint="Списки, з яких обираються напрямки, теги й гілки в редакторі матеріалів Бібліотеки. Перейменування змінює назву в усіх матеріалах; видалення показує, де запис ще вживається.">
      {error && !data ? <Block><p role="alert" className="m-0 text-sm text-hot">{error}</p></Block> : !data ? <Block><div aria-busy="true" className="flex flex-col gap-2"><Ghost className="h-10 rounded-inner" /><Ghost className="h-10 rounded-inner" /></div></Block> : SECTIONS.map((meta) => <Section key={meta.kind} meta={meta} data={data} onChanged={() => setRefresh((value) => value + 1)} />)}
    </Group>
  );
}
