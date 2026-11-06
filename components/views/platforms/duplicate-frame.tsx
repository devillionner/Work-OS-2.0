'use client';

import { createContext, useContext, useState, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import type { ChatDupInfo, ChatDupMember } from '@/lib/chats/duplicates';

/** Дії над парою дублікатів: надає екран «Платформи» (стан і запити живуть у `use-platforms`). */
export type DuplicateActions = {
  /** Точний збіг: злити одразу (8 с на «Скасувати»); збіг за назвою зливається після підтвердження. */
  merge: (dup: ChatDupInfo) => void;
  /** «Це різні чати»: пара більше не пропонується за назвою. */
  apart: (dup: ChatDupInfo) => Promise<void>;
  /** Чати, які щойно прибрано (злиття чекає 8 с): у списку їх не видно. */
  hidden: ReadonlySet<string>;
  busy: boolean;
};

const DuplicateActionsContext = createContext<DuplicateActions | null>(null);
export const DuplicateActionsProvider = DuplicateActionsContext.Provider;

const QUEUE_NAMES: Record<string, string> = { to_join: 'для приєднання', ready: 'для публікації', waiting: 'очікування', failed: 'не вдалося', archived: 'архів' };

function shortLink(link: string) {
  return link.replace(/^https?:\/\/(?:www\.)?/i, '').replace(/\/$/, '');
}
function dayText(iso: string) {
  const [, month, day] = iso.split('-');
  return `${day}.${month}`;
}

/** Тихий рядок про те, чим пара різниться: посилання, акаунт, статус, остання публікація. */
export function dupMemberNote(member: ChatDupMember, group: ChatDupInfo): string {
  const parts: string[] = [];
  const links = new Set(group.members.map((item) => item.link));
  parts.push(links.size > 1 ? shortLink(member.link) : 'те саме посилання');
  if (member.accountName) parts.push(`акаунт ${member.accountName}`);
  const statuses = new Set(group.members.map((item) => item.status));
  parts.push(member.status === 'archived' && member.archiveReason ? `архів: ${member.archiveReason}` : `${statuses.size > 1 ? '' : 'обидва: '}${QUEUE_NAMES[member.status] ?? member.status}`.trim());
  parts.push(member.lastPublished ? `остання публікація ${dayText(member.lastPublished)}` : 'публікацій немає');
  return parts.join(' · ');
}

/** Один елемент списку (чат чи вибір гілки): `dup` — його група дублікатів, якщо є. */
type Item<T> = { value: T; id: string; dup: ChatDupInfo | null | undefined };

/**
 * Рядки списку з дублікатами: чати однієї групи стоять поруч в одній рамці з заголовком і кнопкою «Прибрати дублікати». Групи, чиї
 * інші члени лежать в іншій черзі чи на іншій сторінці, показують їх коротким рядком під рамкою. Порядок списку не змінюється:
 * рамка стоїть там, де перший її член.
 */
export function DuplicateRows<T>({ items, renderItem }: { items: ReadonlyArray<Item<T>>; renderItem: (value: T, note?: string) => ReactNode }) {
  const actions = useContext(DuplicateActionsContext);
  const hidden = actions?.hidden;
  const visible = items.filter((item) => !hidden?.has(item.id));
  const emitted = new Set<string>();
  const out: ReactNode[] = [];
  for (const item of visible) {
    const dup = item.dup;
    if (!dup || !actions) { out.push(renderItem(item.value)); continue; }
    if (emitted.has(dup.key)) continue;
    emitted.add(dup.key);
    const present = visible.filter((other) => other.dup?.key === dup.key);
    out.push(<DuplicateFrame key={`dup-${dup.key}`} dup={dup} present={present} renderItem={renderItem} actions={actions} />);
  }
  return <>{out}</>;
}

function DuplicateFrame<T>({ dup, present, renderItem, actions }: { dup: ChatDupInfo; present: ReadonlyArray<Item<T>>; renderItem: (value: T, note?: string) => ReactNode; actions: DuplicateActions }) {
  const [ask, setAsk] = useState(false);
  const [busy, setBusy] = useState(false);
  const presentIds = new Set(present.map((item) => item.id));
  const elsewhere = dup.members.filter((member) => !presentIds.has(member.id) && !actions.hidden.has(member.id));
  const count = present.length + elsewhere.length;
  const byId = new Map(dup.members.map((member) => [member.id, member]));
  const title = dup.exact ? `Дублікати · ${count}` : `Можливо, той самий чат · ${count}`;
  const remove = dup.members.length - 1;
  return (
    <li className="list-none">
      <section aria-label={title} className="flex flex-col gap-2 rounded-inner border border-line-strong p-2.5">
        <div className="flex flex-wrap items-center justify-between gap-2 px-1.5 pt-0.5">
          <h4 className="m-0 text-sm font-medium">{title}</h4>
          <Button variant="outline" size="sm" disabled={actions.busy} onClick={() => (dup.exact ? actions.merge(dup) : setAsk(true))}>Прибрати дублікати</Button>
        </div>
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          {present.map((item) => {
            const member = byId.get(item.id);
            return renderItem(item.value, member ? `${dup.keepId === item.id ? 'Лишиться · ' : 'Буде прибрано · '}${dupMemberNote(member, dup)}` : undefined);
          })}
        </ul>
        {elsewhere.length ? (
          <ul className="m-0 flex list-none flex-col gap-1 p-0 px-1.5">
            {elsewhere.map((member) => (
              <li key={member.id} className="text-xs text-ink-2"><span className="font-medium text-ink">{member.name}</span> · {dup.keepId === member.id ? 'лишиться' : 'буде прибрано'} · {dupMemberNote(member, dup)}</li>
            ))}
          </ul>
        ) : null}
      </section>
      <Dialog
        open={ask}
        onOpenChange={(next) => { if (!busy) setAsk(next); }}
        title="Це той самий чат?"
        description={`Збігається лише назва, посилання різні. Якщо це той самий чат, ${remove === 1 ? 'копію' : `${remove} копії`} буде видалено, а історія перейде на основний чат.`}
        footer={(
          <>
            <Button variant="ghost" disabled={busy} onClick={() => setAsk(false)}>Скасувати</Button>
            <Button variant="outline" disabled={busy} onClick={() => { setBusy(true); void actions.apart(dup).finally(() => { setBusy(false); setAsk(false); }); }}>Це різні чати</Button>
            <Button variant="action" disabled={busy} onClick={() => { setAsk(false); actions.merge(dup); }}>Злити й прибрати копії</Button>
          </>
        )}
      >
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          {dup.members.map((member) => (
            <li key={member.id} className="rounded-field border border-line px-3 py-2 text-sm">
              <p className="m-0 truncate font-medium" title={member.name}>{member.name}</p>
              <a className="m-0 block break-all font-mono text-xs text-ink-2 underline-offset-4 hover:underline" href={member.link} target="_blank" rel="noreferrer">{member.link}</a>
              <p className="m-0 mt-0.5 text-xs text-ink-3">{dup.keepId === member.id ? 'Лишиться · ' : 'Буде прибрано · '}{dupMemberNote(member, dup)}</p>
            </li>
          ))}
        </ul>
      </Dialog>
    </li>
  );
}
