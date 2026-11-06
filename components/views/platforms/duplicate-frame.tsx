'use client';

import { createContext, Fragment, useContext, useState, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import type { ChatDupInfo, ChatDupMember } from '@/lib/chats/duplicates';

/** Дії над парою дублікатів: надає екран «Платформи» (стан і запити живуть у `use-platforms`). */
export type DuplicateActions = {
  /** Злити, лишивши `keepId` (8 с на «Скасувати»). Точний збіг без застережень зливається одразу, решта — після підтвердження в рамці. */
  merge: (dup: ChatDupInfo, keepId: string) => void;
  /** «Це різні чати»: пара більше не пропонується за назвою. */
  apart: (dup: ChatDupInfo) => Promise<void>;
  /** Чати, які щойно прибрано (злиття чекає 8 с): у списку їх не видно. */
  hidden: ReadonlySet<string>;
  busy: boolean;
};

const DuplicateActionsContext = createContext<DuplicateActions | null>(null);
export const DuplicateActionsProvider = DuplicateActionsContext.Provider;

const QUEUE_NAMES: Record<string, string> = { to_join: 'для приєднання', ready: 'для публікації', waiting: 'очікування', failed: 'не вдалося', archived: 'архів' };

const REASON_LABEL: Record<string, string> = { irrelevant: 'Чат не цільовий' };
const reasonLabel = (reason: string) => REASON_LABEL[reason] ?? reason;
/** Причина архіву в знахідному відмінку для «було позначено як …»; «Дублікат» від старого менеджера причиною не вважається. */
export function flaggedAs(reason: string | null): string | null {
  if (!reason || reason === 'Дублікат') return null;
  if (reason === 'irrelevant' || reason === 'Чат не цільовий') return 'нецільову';
  if (reason === 'Забанено') return 'забанену';
  if (reason === 'Чат не існує') return 'таку, що не існує';
  return `«${reason}»`;
}
const accountOf = (member: ChatDupMember) => (member.accountName ? ` на акаунті ${member.accountName}` : '');
const statusText = (member: ChatDupMember) => (member.status === 'archived' && member.archiveReason ? `архів: ${reasonLabel(member.archiveReason)}` : QUEUE_NAMES[member.status] ?? member.status);
const publicationsText = (member: ChatDupMember) => (member.publications ? `${member.publications} ${member.publications === 1 ? 'публікація' : 'публікацій'}${member.lastPublished ? `, остання ${dayText(member.lastPublished)}` : ''}` : 'публікацій немає');

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
  parts.push(member.status === 'archived' && member.archiveReason ? `архів: ${reasonLabel(member.archiveReason)}` : `${statuses.size > 1 ? '' : 'обидва: '}${QUEUE_NAMES[member.status] ?? member.status}`.trim());
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
  const [picked, setPicked] = useState<string | null>(null);
  const presentIds = new Set(present.map((item) => item.id));
  const elsewhere = dup.members.filter((member) => !presentIds.has(member.id) && !actions.hidden.has(member.id));
  const count = present.length + elsewhere.length;
  const byId = new Map(dup.members.map((member) => [member.id, member]));
  const keepId = picked && byId.has(picked) ? picked : dup.keepId;
  const keep = byId.get(keepId) ?? dup.members[0];
  const copies = dup.members.filter((member) => member.id !== keepId);
  const title = dup.exact ? `Дублікати · ${count}` : `Можливо, той самий чат · ${count}`;
  // Питання «лишити основний у публікаціях?»: копія була позначена нецільовою чи забаненою, а основний працює.
  const flagged = keep.status === 'archived' ? [] : copies.filter((member) => member.status === 'archived' && flaggedAs(member.archiveReason));
  const keepArchived = keep.status === 'archived' && dup.members.some((member) => member.status !== 'archived');
  const manual = keepId !== dup.keepId;
  const needsAsk = !dup.exact || manual || flagged.length > 0 || keepArchived;
  const merge = () => { setAsk(false); actions.merge(dup, keepId); };
  const roleOf = (id: string) => (id === keepId ? 'Лишиться · ' : 'Буде прибрано · ');
  const chooser = (member: ChatDupMember) => (
    <button type="button" disabled={actions.busy} onClick={() => setPicked(member.id)} className="inline-flex min-h-8 items-center rounded-full px-2 text-xs text-ink-2 underline-offset-4 hover:text-ink hover:underline disabled:opacity-50">Лишити цей</button>
  );
  return (
    <li className="list-none">
      <section aria-label={title} className="flex flex-col gap-2 rounded-inner border border-line-strong p-2.5">
        <div className="flex flex-wrap items-center justify-between gap-2 px-1.5 pt-0.5">
          <h4 className="m-0 text-sm font-medium">{title}</h4>
          <Button variant="outline" size="sm" disabled={actions.busy} onClick={() => (needsAsk ? setAsk(true) : actions.merge(dup, keepId))}>Прибрати дублікати</Button>
        </div>
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          {present.map((item) => {
            const member = byId.get(item.id);
            return (
              <Fragment key={item.id}>
                {renderItem(item.value, member ? `${roleOf(item.id)}${dupMemberNote(member, dup)}` : undefined)}
                {member && member.id !== keepId ? <li className="-mt-1 flex list-none justify-end px-1">{chooser(member)}</li> : null}
              </Fragment>
            );
          })}
        </ul>
        {elsewhere.length ? (
          <ul className="m-0 flex list-none flex-col gap-1 p-0 px-1.5">
            {elsewhere.map((member) => (
              <li key={member.id} className="flex flex-wrap items-center gap-x-2 text-xs text-ink-2">
                <span><span className="font-medium text-ink">{member.name}</span> · {member.id === keepId ? 'лишиться' : 'буде прибрано'} · {dupMemberNote(member, dup)}</span>
                {member.id !== keepId ? chooser(member) : null}
              </li>
            ))}
          </ul>
        ) : null}
      </section>
      <Dialog
        open={ask}
        onOpenChange={(next) => { if (!busy) setAsk(next); }}
        title={dup.exact ? 'Прибрати дублікати?' : 'Це той самий чат?'}
        description={dup.exact
          ? `${copies.length === 1 ? 'Копію' : `${copies.length} копії`} буде видалено, а історія перейде на чат, що лишиться.`
          : `Збігається лише назва, посилання різні. Якщо це той самий чат, ${copies.length === 1 ? 'копію' : `${copies.length} копії`} буде видалено, а історія перейде на чат, що лишиться.`}
        footer={(
          <>
            <Button variant="ghost" disabled={busy} onClick={() => setAsk(false)}>Скасувати</Button>
            {!dup.exact ? <Button variant="outline" disabled={busy} onClick={() => { setBusy(true); void actions.apart(dup).finally(() => { setBusy(false); setAsk(false); }); }}>Це різні чати</Button> : null}
            <Button variant="action" disabled={busy} onClick={merge}>{flagged.length ? 'Лишити основний і злити' : 'Злити й прибрати копії'}</Button>
          </>
        )}
      >
        <div className="flex flex-col gap-3">
          <div>
            <p className="m-0 mb-1 text-xs text-ink-2">Лишиться</p>
            <div className="rounded-field border border-line px-3 py-2 text-sm">
              <p className="m-0 truncate font-medium" title={keep.name}>{keep.name}</p>
              <a className="m-0 block break-all font-mono text-xs text-ink-2 underline-offset-4 hover:underline" href={keep.link} target="_blank" rel="noreferrer">{keep.link}</a>
              <p className="m-0 mt-0.5 text-xs text-ink-3">{[keep.accountName ? `акаунт ${keep.accountName}` : null, statusText(keep), publicationsText(keep)].filter(Boolean).join(' · ')}</p>
            </div>
          </div>
          <div>
            <p className="m-0 mb-1 text-xs text-ink-2">Піде в історію основного</p>
            <ul className="m-0 flex list-none flex-col gap-2 p-0">
              {copies.map((member) => (
                <li key={member.id} className="rounded-field border border-line px-3 py-2 text-sm">
                  <a className="m-0 block break-all font-mono text-xs underline-offset-4 hover:underline" href={member.link} target="_blank" rel="noreferrer">{member.link}</a>
                  <p className="m-0 mt-0.5 text-xs text-ink-3">{[member.accountName ? `акаунт ${member.accountName}` : null, statusText(member), publicationsText(member)].filter(Boolean).join(' · ')}</p>
                </li>
              ))}
            </ul>
            <p className="m-0 mt-1 text-xs text-ink-2">Статус і причина архіву копії на чат, що лишається, не переносяться.</p>
          </div>
          {flagged.map((member) => (
            <p key={member.id} role="note" className="m-0 rounded-field border border-line-strong px-3 py-2 text-sm">Копію{accountOf(member)} було позначено як {flaggedAs(member.archiveReason)}. Лишити основний у публікаціях?</p>
          ))}
          {keepArchived ? <p role="note" className="m-0 rounded-field border border-line-strong px-3 py-2 text-sm">Лишається чат в архіві, а робочий буде видалено. Якщо це не так, закрий вікно й обери «Лишити цей» на робочому чаті.</p> : null}
        </div>
      </Dialog>
    </li>
  );
}
