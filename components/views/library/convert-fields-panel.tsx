'use client';

import { useMemo, useState } from 'react';
import { Panel } from '@/components/shell/panel';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Ghost } from '@/components/ui/ghost';
import { humanError } from '@/components/ui/human-error';
import { Checkbox } from '@/components/ui/toggle';
import { useToast } from '@/components/ui/toast';
import { useRemote } from '@/components/views/shared/use-remote';
import { announceDataChange } from '@/lib/client-sync';
import type { ScriptFieldKey } from '@/lib/script-fields';
import { Confirmation } from '@/components/views/leads/form';

type Preview = { items: Array<{ id: string; title: string; version: number; brackets: Array<{ token: string; field: ScriptFieldKey | null; replacement: string | null }> }>; scanned: number };

const key = (itemId: string, token: string) => `${itemId}\n${token}`;

/**
 * Перетворення старих позначок у дужках («[ім'я]», «[дата]») на поля-шаблони. Спершу перегляд: розпізнані відмічені, нерозпізнані
 * лишаються як є; застосовується лише підтверджене, кожен скрипт отримує нову версію.
 */
export default function ConvertFieldsPanel({ onClose, onChanged }: { onClose: () => void; onChanged: () => void }) {
  const toast = useToast();
  const [attempt, setAttempt] = useState(0);
  const { data, error } = useRemote<Preview>('/api/library/convert-fields', { refresh: attempt, fallback: 'Не вдалося переглянути скрипти.' });
  const [unpicked, setUnpicked] = useState<ReadonlySet<string>>(new Set());
  const [confirming, setConfirming] = useState(false);
  const changes = useMemo(() => (data?.items ?? []).flatMap((item) => item.brackets.flatMap((bracket) => (bracket.field && !unpicked.has(key(item.id, bracket.token)) ? [{ itemId: item.id, token: bracket.token, field: bracket.field }] : []))), [data, unpicked]);
  const recognized = (data?.items ?? []).reduce((sum, item) => sum + item.brackets.filter((bracket) => bracket.field).length, 0);

  const apply = async () => {
    const response = await fetch('/api/library/convert-fields', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ changes }) });
    const body = await response.json().catch(() => ({})) as { error?: string; updated?: number };
    if (!response.ok) throw new Error(body.error || 'Не вдалося перетворити позначки.');
    announceDataChange('all');
    toast.push({ message: `Перетворено скриптів: ${body.updated ?? 0}.`, tone: 'ok' });
    setUnpicked(new Set());
    setAttempt((value) => value + 1);
    onChanged();
  };

  return (
    <Panel open onOpenChange={(open) => { if (!open) onClose(); }} title="Поля в скриптах" subtitle="Перетворення позначок у дужках"
      footer={data && recognized ? (
        <div className="flex items-center justify-between gap-3">
          <span className="text-[13px] text-ink-2">Замін: <span className="font-mono text-ink">{changes.length}</span></span>
          <Button variant="action" size="sm" disabled={!changes.length} onClick={() => setConfirming(true)}>Перетворити вибране</Button>
        </div>
      ) : undefined}
    >
      {error && !data ? (
        <div className="flex flex-col items-start gap-3"><p role="alert" className="m-0 text-sm text-hot">{error}</p><Button variant="outline" size="sm" onClick={() => setAttempt((value) => value + 1)}>Спробувати ще раз</Button></div>
      ) : !data ? <div aria-busy="true" className="flex flex-col gap-2"><Ghost className="h-20 rounded-inner" /><Ghost className="h-20 rounded-inner" /></div> : data.items.length === 0 ? (
        <EmptyState text={`У ${data.scanned} скриптах немає старих позначок у дужках: усе вже перетворено або не використовується.`} />
      ) : (
        <div className="flex flex-col gap-4">
          <p className="m-0 text-[13px] text-ink-2">Знайдено позначок, які ще не є полями. Відмічені замінюються на поле з довідника; нерозпізнані лишаються як є й підкреслені пунктиром у редакторі.</p>
          <ul aria-label="Скрипти з позначками" className="m-0 flex list-none flex-col gap-3 p-0">
            {data.items.map((item) => (
              <li key={item.id} className="rounded-inner border border-line p-3">
                <p className="m-0 mb-2 truncate text-sm font-medium">{item.title}</p>
                <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
                  {item.brackets.map((bracket) => {
                    const id = key(item.id, bracket.token);
                    return (
                      <li key={bracket.token} className="flex items-center gap-3 text-[13px]">
                        <Checkbox checked={Boolean(bracket.field) && !unpicked.has(id)} disabled={!bracket.field} aria-label={`Замінити ${bracket.token}`} onCheckedChange={(checked) => setUnpicked((current) => { const next = new Set(current); if (checked) next.delete(id); else next.add(id); return next; })} />
                        <span className="font-mono">{bracket.token}</span>
                        <span aria-hidden="true" className="text-ink-3">→</span>
                        {bracket.replacement ? <span className="rounded-[5px] bg-raised px-1 font-mono">{bracket.replacement}</span> : <span className="text-ink-2">не розпізнано</span>}
                      </li>
                    );
                  })}
                </ul>
              </li>
            ))}
          </ul>
        </div>
      )}
      {confirming ? (
        <Confirmation
          title={`Перетворити ${changes.length} позначок?`}
          description="Кожен змінений скрипт отримає нову версію; попередню можна переглянути в «Історії» матеріалу."
          close={() => setConfirming(false)}
          run={apply}
        />
      ) : null}
    </Panel>
  );
}
