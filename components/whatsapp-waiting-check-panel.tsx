'use client';

import { Cable, RotateCcw, Square, Play } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  waitingCheckDone,
  waitingCheckEtaMinutes,
  waitingCheckReasonLabel,
  waitingCheckRunnerOffline,
  waitingCheckRunnerState,
  type WaitingCheckView,
} from '@/lib/chats/whatsapp-waiting-check-copy';

export type WaitingCheckAction = 'start' | 'stop' | 'retry_problems';

const RECENT_SECONDS = 12 * 3600;

export function WhatsappWaitingCheckPanel({ view, nowSeconds, busy, onAction, onConnect }: {
  view: WaitingCheckView;
  nowSeconds: number;
  busy: boolean;
  onAction: (action: WaitingCheckAction) => void;
  onConnect: () => void;
}) {
  const runner = waitingCheckRunnerState(view, nowSeconds);
  const runnerStuck = waitingCheckRunnerOffline(view, nowSeconds);
  const recent = !view.active && view.finishedAt !== null && nowSeconds - view.finishedAt < RECENT_SECONDS;
  const showResults = view.active || recent;
  const done = waitingCheckDone(view);
  const eta = waitingCheckEtaMinutes(view);
  const { joined, pending, requested, failed } = view.counts;

  return (
    <section className="waiting-check" aria-label="Перевірка заявок WhatsApp">
      <div className="waiting-check-head">
        <div className="waiting-check-title">
          <strong>Перевірка заявок WhatsApp</strong>
          <span className={'waiting-check-runner ' + (runner.online ? 'is-online' : 'is-offline')}>
            <i aria-hidden="true" />{runner.label}
          </span>
        </div>
        <div className="waiting-check-actions">
          {view.active
            ? <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => onAction('stop')}>
                <Square aria-hidden="true" />Зупинити
              </Button>
            : <>
                {recent && view.problems.length > 0 && <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => onAction('retry_problems')}>
                  <RotateCcw aria-hidden="true" />Перевірити проблемні ({view.problems.length})
                </Button>}
                <Button type="button" size="sm" disabled={busy} onClick={() => onAction('start')}>
                  <Play aria-hidden="true" />Перевірити зараз
                </Button>
              </>}
        </div>
      </div>

      {view.active && <div className="waiting-check-progress">
        <output className="waiting-check-progress-label">
          <span>Перевірено <b>{done}</b> з {view.total}{view.currentName ? <> · зараз: <b>{view.currentName}</b></> : null}</span>
          {eta !== null && <span>≈ {eta} хв до кінця</span>}
        </output>
        <progress className="waiting-check-bar" max={Math.max(1, view.total)} value={done} aria-label="Прогрес перевірки" />
      </div>}

      {showResults && <dl className="waiting-check-counts">
        <div className="is-joined"><dt>Прийнято</dt><dd>{joined}</dd></div>
        <div><dt>Відкладено на 3 дні</dt><dd>{pending + requested}{requested > 0 && <small> · запит надіслано {requested}</small>}</dd></div>
        <div className={failed ? 'is-problem' : ''}><dt>Проблеми</dt><dd>{failed}</dd></div>
      </dl>}

      {!view.active && !recent && <p className="waiting-check-note">
        Прийняті чати перейдуть у «Для публікації», заявки без відповіді відкладаються на 3 дні, а якщо заявки ще немає — її буде надіслано.
      </p>}
      {recent && view.stopReason && <p className="waiting-check-note">Зупинено — {view.stopReason}. Решту чатів не змінено.</p>}
      {(runnerStuck || (!runner.online && !view.active)) && <div className="waiting-check-note is-warning waiting-check-connect">
        <p>{runnerStuck ? 'Runner не забирає чати. ' : ''}Runner запускається сам при вході в систему й працює з цим браузером: тримайте відкритими WhatsApp Web і цю сторінку. Якщо статус не зміниться за хвилину — підключіть цей браузер ще раз.</p>
        <Button type="button" size="sm" variant="outline" disabled={busy} onClick={onConnect}><Cable aria-hidden="true" />Підключити цей браузер</Button>
      </div>}

      {recent && view.problems.length > 0 && <ul className="waiting-check-problems" aria-label="Чати, що потребують уваги">
        {view.problems.map(item => <li key={item.chatId}><span>{item.name}</span><small>{waitingCheckReasonLabel(item.reason)}</small></li>)}
      </ul>}
    </section>
  );
}
