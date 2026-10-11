'use client';

import { Archive, Cable, Check, ExternalLink, Play, RotateCcw, Square } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Ring } from '@/components/ui/ring';
import { Surface } from '@/components/ui/surface';
import { waitingCheckDone, waitingCheckEtaMinutes, waitingCheckReasonLabel, waitingCheckRunnerOffline, waitingCheckRunnerState, type WaitingCheckView } from '@/lib/chats/whatsapp-waiting-check-copy';

export type WaitingCheckAction = 'start' | 'stop' | 'retry_problems';
export type WaitingCheckProblemAction = 'open' | 'approved' | 'snooze' | 'archive';
type Problem = WaitingCheckView['problems'][number];
const RECENT_SECONDS = 12 * 3600;

/** Перевірка заявок WhatsApp у черзі «Очікування»: запуск, прогрес, проблемні чати й стан runner. */
export function WaitingCheckCard({ view, nowSeconds, busy, onAction, onConnect, onProblemAction }: {
  view: WaitingCheckView;
  nowSeconds: number;
  busy: boolean;
  onAction: (action: WaitingCheckAction) => void;
  onConnect: () => void;
  onProblemAction: (problem: Problem, action: WaitingCheckProblemAction) => void;
}) {
  const runner = waitingCheckRunnerState(view, nowSeconds);
  const runnerStuck = waitingCheckRunnerOffline(view, nowSeconds);
  const recent = !view.active && view.finishedAt !== null && nowSeconds - view.finishedAt < RECENT_SECONDS;
  const showResults = view.active || recent;
  const done = waitingCheckDone(view);
  const eta = waitingCheckEtaMinutes(view);
  const { joined, pending, requested, failed } = view.counts;
  const ratio = view.total > 0 ? Math.min(1, done / view.total) : 0;

  return (
    <Surface variant="glass" radius="card" className="flex flex-col gap-4 p-5" aria-labelledby="waiting-check-title">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="waiting-check-title" className="m-0 text-[15px] font-medium">Перевірка заявок WhatsApp</h2>
          <p className="m-0 mt-1 flex items-center gap-2 text-xs text-ink-2"><i aria-hidden="true" className={`size-1.5 rounded-full ${runner.online ? 'bg-ok' : 'bg-line-strong'}`} />{runner.label}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {view.active ? (
            <Button variant="outline" tone="danger" size="sm" disabled={busy} onClick={() => onAction('stop')}><Square aria-hidden="true" strokeWidth={1.5} />Зупинити</Button>
          ) : (
            <>
              {recent && view.problems.length > 0 ? <Button variant="outline" size="sm" disabled={busy} onClick={() => onAction('retry_problems')}><RotateCcw aria-hidden="true" strokeWidth={1.5} />Перевірити проблемні ({view.problems.length})</Button> : null}
              <Button variant="action" size="sm" busy={busy} onClick={() => onAction('start')}><Play aria-hidden="true" strokeWidth={1.5} />Перевірити зараз</Button>
            </>
          )}
        </div>
      </div>

      {view.active ? (
        <output className="flex items-center gap-4">
          <Ring value={ratio} size={52} stroke={4} label={`Перевірено ${done} з ${view.total}`}>{Math.round(ratio * 100)}%</Ring>
          <span className="min-w-0 text-sm">Перевірено <b className="font-mono font-normal">{done}</b> з {view.total}{view.currentName ? <> · зараз: <b className="font-medium">{view.currentName}</b></> : null}{eta !== null ? <span className="block text-xs text-ink-2">≈ {eta} хв до кінця</span> : null}</span>
        </output>
      ) : null}

      {showResults ? (
        <dl className="m-0 grid grid-cols-3 gap-2 text-center">
          <div className="rounded-inner border border-line bg-sunken px-2 py-2.5"><dt className="text-[11px] text-ink-2">Прийнято</dt><dd className="m-0 font-mono text-xl">{joined}</dd></div>
          <div className="rounded-inner border border-line bg-sunken px-2 py-2.5"><dt className="text-[11px] text-ink-2">Відкладено на 3 дні</dt><dd className="m-0 font-mono text-xl">{pending + requested}{requested > 0 ? <small className="block font-sans text-[11px] text-ink-2">запит надіслано {requested}</small> : null}</dd></div>
          <div className={`rounded-inner border px-2 py-2.5 ${failed > 0 ? 'border-hot/50' : 'border-line bg-sunken'}`}><dt className="text-[11px] text-ink-2">Проблеми</dt><dd className="m-0 font-mono text-xl">{failed}</dd></div>
        </dl>
      ) : null}

      {!view.active && !recent ? <p className="m-0 text-xs text-ink-2">Прийняті чати переходять у «Для публікації», решта відкладається на 3 дні.</p> : null}
      {recent && view.stopReason ? <p className="m-0 text-xs text-warn">Зупинено — {view.stopReason}. Решту чатів не змінено.</p> : null}

      {runnerStuck || (!runner.online && !view.active) ? (
        <div className="flex flex-col items-start gap-3 rounded-inner border border-warn/40 px-4 py-3">
          <p className="m-0 text-xs text-ink-2">{runnerStuck ? 'Перевірка не стартує. ' : ''}Вона працює через браузер із відкритим WhatsApp Web. Якщо статус не оновився за хвилину, підключи браузер повторно.</p>
          <Button variant="outline" size="sm" disabled={busy} onClick={onConnect}><Cable aria-hidden="true" strokeWidth={1.5} />Підключити цей браузер</Button>
        </div>
      ) : null}

      {recent && view.problems.length > 0 ? (
        <section className="flex flex-col gap-2" aria-label="Чати, що потребують рішення">
          <h3 className="m-0 text-sm font-medium">Потребують рішення ({view.problems.length})</h3>
          <ul className="m-0 flex list-none flex-col gap-2 p-0">
            {view.problems.map((item) => (
              <li key={item.chatId} className="flex flex-col gap-2 rounded-inner border border-line bg-sunken px-4 py-3">
                <div className="min-w-0"><p className="m-0 truncate text-sm font-medium">{item.name}</p><p className="m-0 text-xs text-hot">{waitingCheckReasonLabel(item.reason)}</p></div>
                {item.chat ? (
                  <div className="flex flex-wrap gap-1.5">
                    <Button variant="icon" size="sm" aria-label={`Відкрити ${item.name} у WhatsApp`} title="Відкрити в WhatsApp" onClick={() => onProblemAction(item, 'open')}><ExternalLink aria-hidden="true" strokeWidth={1.5} /></Button>
                    <Button variant="outline" size="sm" disabled={busy} title="Вас прийняли — перенести в «Для публікації»" onClick={() => onProblemAction(item, 'approved')}><Check aria-hidden="true" strokeWidth={1.5} />Прийняли</Button>
                    <Button variant="outline" size="sm" disabled={busy} title="Відкласти на 3 дні" onClick={() => onProblemAction(item, 'snooze')}>+3 дні</Button>
                    <Button variant="ghost" size="sm" disabled={busy} title="Перенести в архів" onClick={() => onProblemAction(item, 'archive')}><Archive aria-hidden="true" strokeWidth={1.5} />В архів</Button>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </Surface>
  );
}
