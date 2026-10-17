'use client';

import { useState } from 'react';
import { Panel } from '@/components/shell/panel';
import { Button } from '@/components/ui/button';
import { humanError } from '@/components/ui/human-error';
import { Checkbox } from '@/components/ui/toggle';
import { useToast } from '@/components/ui/toast';
import { labels } from '@/components/views/leads/client';
import { Confirmation } from '@/components/views/leads/form';
import { announceDataChange } from '@/lib/client-sync';
import type { ChatLinkProposal } from '@/lib/leads/maintenance';

type Preview = { examined: number; proposals: ChatLinkProposal[]; ambiguous: number; unmatched: number; more: number };
type Placeholder = { leadId: string; name: string; telegramUsername: string; hasPhone: boolean };

const REASON: Record<ChatLinkProposal['reason'], string> = { link: 'те саме посилання', code: 'той самий код запрошення', name: 'збіг за назвою' };
const STATUS: Record<string, string> = { ready: 'приєднано', waiting: 'очікування', to_join: 'для приєднання', failed: 'не вдалося', archived: 'архів' };

async function call<T>(method: 'GET' | 'POST', query: string, body?: Record<string, unknown>): Promise<T> {
  const response = await fetch(`/api/leads/maintenance${query}`, { method, cache: 'no-store', ...(body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}) });
  const value = await response.json().catch(() => ({})) as T & { error?: string };
  if (!response.ok) throw new Error(value.error || 'Не вдалося виконати дію.');
  return value;
}

function Section({ title, note, children }: { title: string; note: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3" aria-label={title}>
      <div><h3 className="m-0 text-[15px] font-medium">{title}</h3><p className="m-0 mt-1 text-[13px] text-ink-2">{note}</p></div>
      {children}
    </section>
  );
}

/** Підтягнути чати лідам: пропозиції «лід → чат» власник підтверджує все разом або по одній. */
function ChatLinks() {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
  const [error, setError] = useState('');

  const find = async () => {
    setBusy(true); setError('');
    try {
      const result = await call<Preview>('GET', '?tool=chat-links');
      setPreview(result);
      // Точні збіги за посиланням і кодом відмічені одразу; за назвою — лише за явним вибором.
      setPicked(new Set(result.proposals.filter((item) => item.reason !== 'name').map((item) => item.leadId)));
    } catch (reason) { setError(humanError(reason, 'Не вдалося знайти збіги.')); } finally { setBusy(false); }
  };

  const apply = async (items: ChatLinkProposal[]) => {
    if (!items.length) return;
    setBusy(true); setError('');
    try {
      const result = await call<{ changed: number }>('POST', '', { tool: 'chat-links', items: items.map((item) => ({ leadId: item.leadId, chatId: item.chat.id })) });
      const done = new Set(items.map((item) => item.leadId));
      setPreview((current) => current && { ...current, proposals: current.proposals.filter((item) => !done.has(item.leadId)) });
      setPicked((current) => new Set([...current].filter((id) => !done.has(id))));
      announceDataChange('leads');
      toast.push({ message: `Чат пов’язано з ${result.changed} ${result.changed === 1 ? 'лідом' : 'лідами'}.`, tone: 'ok' });
    } catch (reason) { setError(humanError(reason, 'Не вдалося пов’язати ліди з чатами.')); } finally { setBusy(false); }
  };

  const chosen = preview?.proposals.filter((item) => picked.has(item.leadId)) ?? [];
  return (
    <Section title="Чати для лідів" note="Знаходить ліди, які ще не пов’язані з чатом Work OS, і пропонує чат за посиланням, кодом запрошення чи назвою. Нічого не змінюється без вашого підтвердження.">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" size="sm" busy={busy && !preview} disabled={busy} onClick={() => void find()}>{preview ? 'Знайти ще раз' : 'Знайти збіги'}</Button>
        {preview && preview.proposals.length > 1 ? <Button variant="action" size="sm" disabled={busy || !chosen.length} onClick={() => void apply(chosen)}>Підтвердити вибране ({chosen.length})</Button> : null}
      </div>
      {error ? <p role="alert" className="m-0 text-sm text-hot">{error}</p> : null}
      {preview ? (
        <>
          <p className="m-0 text-[13px] text-ink-2">Розглянуто {preview.examined} лідів без чату: пропозицій {preview.proposals.length + preview.more}, неоднозначних {preview.ambiguous}, без збігу {preview.unmatched}.{preview.more ? ' Показано перші 500, решту знайде наступний пошук.' : ''}</p>
          <ul aria-label="Пропозиції" className="m-0 flex list-none flex-col gap-2 p-0">
            {preview.proposals.map((item) => (
              <li key={item.leadId} className="flex items-start gap-3 rounded-inner border border-line bg-sunken px-3.5 py-3">
                <Checkbox className="mt-0.5" checked={picked.has(item.leadId)} disabled={busy} aria-label={`Вибрати: ${item.leadName}`} onCheckedChange={(checked) => setPicked((current) => { const next = new Set(current); if (checked) next.add(item.leadId); else next.delete(item.leadId); return next; })} />
                <div className="min-w-0 flex-1">
                  <p className="m-0 truncate text-sm font-medium">{item.leadName}</p>
                  <p className="m-0 truncate text-[13px] text-ink-2">→ {item.chat.name} · {labels[item.chat.platform] ?? item.chat.platform} · {STATUS[item.chat.status] ?? item.chat.status}</p>
                  <p className="m-0 truncate text-xs text-ink-3">{REASON[item.reason]}</p>
                </div>
                <Button variant="ghost" size="sm" disabled={busy} aria-label={`Підтвердити чат для ліда ${item.leadName}`} onClick={() => void apply([item])}>Підтвердити</Button>
              </li>
            ))}
          </ul>
          {preview.proposals.length === 0 ? <p className="m-0 text-sm text-ink-2">Нових пропозицій немає.</p> : null}
        </>
      ) : null}
    </Section>
  );
}

/** Ліди з нікoм-заглушкою NoUserName1, NoUserName2…: це ліди без відомого контакту. */
function PlaceholderContacts() {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [leads, setLeads] = useState<Placeholder[] | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState('');

  const find = async () => {
    setBusy(true); setError('');
    try { setLeads((await call<{ leads: Placeholder[] }>('GET', '?tool=placeholder-contacts')).leads); }
    catch (reason) { setError(humanError(reason, 'Не вдалося знайти ліди.')); } finally { setBusy(false); }
  };

  return (
    <Section title="Контакт невідомий" note="Ліди з ніком NoUserName1, NoUserName2… мають заглушку замість Telegram. Дія прибере заглушку з поля й позначить ліда «контакт невідомий», якщо в нього немає номера. Попередній нік лишиться в історії ліда.">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" size="sm" busy={busy} disabled={busy} onClick={() => void find()}>{leads ? 'Переглянути ще раз' : 'Переглянути список'}</Button>
        {leads && leads.length ? <Button variant="action" size="sm" disabled={busy} onClick={() => setConfirming(true)}>Позначити «контакт невідомий» ({leads.length})</Button> : null}
      </div>
      {error ? <p role="alert" className="m-0 text-sm text-hot">{error}</p> : null}
      {leads ? (leads.length === 0 ? <p className="m-0 text-sm text-ink-2">Лідів із заглушкою немає.</p> : (
        <ul aria-label="Ліди із заглушкою" className="m-0 flex list-none flex-col gap-1.5 p-0">
          {leads.map((lead) => (
            <li key={lead.leadId} className="flex items-baseline justify-between gap-3 rounded-inner border border-line px-3.5 py-2.5">
              <span className="min-w-0 truncate text-sm">{lead.name}</span>
              <span className="shrink-0 font-mono text-xs text-ink-2">{lead.telegramUsername}{lead.hasPhone ? ' · є номер' : ''}</span>
            </li>
          ))}
        </ul>
      )) : null}
      {confirming && leads ? (
        <Confirmation
          title={`Позначити ${leads.length} лідів?`}
          description="Заглушка NoUserName* зникне з поля Telegram. Ліди без номера отримають позначку «контакт невідомий» й потраплять у фільтр «Без контакту»."
          close={() => setConfirming(false)}
          run={async () => {
            const result = await call<{ changed: number }>('POST', '', { tool: 'placeholder-contacts', leadIds: leads.map((lead) => lead.leadId) });
            setLeads([]);
            announceDataChange('leads');
            toast.push({ message: `Оновлено ${result.changed} лідів.`, tone: 'ok' });
          }}
        />
      ) : null}
    </Section>
  );
}

/** «Налаштування → Сервіс → Ліди і чати»: чати для наявних лідів і позначка «контакт невідомий». */
export function LeadToolsPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Panel open={open} onOpenChange={(next) => { if (!next) onClose(); }} title="Ліди і чати" subtitle="Порядок у даних">
      <div className="flex flex-col gap-8">
        <ChatLinks />
        <PlaceholderContacts />
      </div>
    </Panel>
  );
}
