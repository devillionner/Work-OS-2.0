'use client';

import {
  Archive,
  Cable,
  Check,
  CheckCircle2,
  Clock3,
  ExternalLink,
  Loader2,
  Play,
  Radio,
  RotateCcw,
  Square,
  XCircle,
} from 'lucide-react';
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
export type WaitingCheckProblemAction = 'open' | 'approved' | 'snooze' | 'archive';
type Problem = WaitingCheckView['problems'][number];

const RECENT_SECONDS = 12 * 3600;

export function WhatsappWaitingCheckPanel({
  view,
  nowSeconds,
  busy,
  onAction,
  onConnect,
  onProblemAction,
}: {
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
  const progressPercent = view.total > 0 ? Math.min(100, Math.round((done / view.total) * 100)) : 0;

  return (
    <section className="waiting-check" aria-label="Перевірка заявок WhatsApp">
      <div className="waiting-check-head">
        <div className="waiting-check-title">
          <div className="flex items-center gap-2">
            <Radio className="size-4 text-primary animate-pulse" />
            <strong className="text-sm font-semibold text-foreground">Перевірка заявок WhatsApp</strong>
          </div>
          <span className={`waiting-check-runner ${runner.online ? 'is-online' : 'is-offline'}`}>
            <span className="runner-dot" aria-hidden="true" />
            {runner.label}
          </span>
        </div>

        <div className="waiting-check-actions">
          {view.active ? (
            <Button
              type="button"
              size="sm"
              variant="destructive"
              disabled={busy}
              onClick={() => onAction('stop')}
            >
              <Square data-icon="inline-start" className="size-3.5" aria-hidden="true" />
              Зупинити
            </Button>
          ) : (
            <>
              {recent && view.problems.length > 0 && (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  onClick={() => onAction('retry_problems')}
                  className="border-amber-500/30 text-amber-800 hover:bg-amber-50 dark:text-amber-400"
                >
                  <RotateCcw data-icon="inline-start" className="size-3.5" aria-hidden="true" />
                  Перевірити проблемні ({view.problems.length})
                </Button>
              )}
              <Button
                type="button"
                size="sm"
                disabled={busy}
                onClick={() => onAction('start')}
              >
                {busy ? (
                  <Loader2 data-icon="inline-start" className="size-3.5 animate-spin" aria-hidden="true" />
                ) : (
                  <Play data-icon="inline-start" className="size-3.5 fill-current" aria-hidden="true" />
                )}
                Перевірити зараз
              </Button>
            </>
          )}
        </div>
      </div>

      {view.active && (
        <div className="waiting-check-progress">
          <output className="waiting-check-progress-label">
            <span className="truncate">
              Перевірено <b>{done}</b> з {view.total}
              {view.currentName ? (
                <>
                  {' '}
                  · зараз: <b className="text-foreground">{view.currentName}</b>
                </>
              ) : null}
            </span>
            {eta !== null && <span className="font-semibold text-primary">≈ {eta} хв до кінця</span>}
          </output>
          <div className="waiting-check-track">
            <div
              className="waiting-check-fill"
              style={{ width: `${progressPercent}%` }}
              role="progressbar"
              aria-valuenow={done}
              aria-valuemin={0}
              aria-valuemax={view.total}
            />
          </div>
        </div>
      )}

      {showResults && (
        <dl className="waiting-check-counts">
          <div className="waiting-check-card is-joined">
            <dt className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <CheckCircle2 className="size-3.5 text-emerald-600 dark:text-emerald-400" /> Прийнято
            </dt>
            <dd>{joined}</dd>
          </div>
          <div className="waiting-check-card is-pending">
            <dt className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Clock3 className="size-3.5 text-amber-600 dark:text-amber-400" /> Відкладено на 3 дні
            </dt>
            <dd>
              {pending + requested}
              {requested > 0 && <small> · запит надіслано {requested}</small>}
            </dd>
          </div>
          <div className={`waiting-check-card ${failed > 0 ? 'is-problem' : ''}`}>
            <dt className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <XCircle className="size-3.5 text-destructive" /> Проблеми
            </dt>
            <dd>{failed}</dd>
          </div>
        </dl>
      )}

      {!view.active && !recent && (
        <p className="waiting-check-note">
          Прийняті чати переходять у «Для публікації», заявки без відповіді відкладаються на 3 дні, а якщо заявки ще немає — її буде надіслано автоматично.
        </p>
      )}

      {recent && view.stopReason && (
        <p className="waiting-check-note text-amber-800 dark:text-amber-400">
          Зупинено — {view.stopReason}. Решту чатів не змінено.
        </p>
      )}

      {(runnerStuck || (!runner.online && !view.active)) && (
        <div className="waiting-check-note is-warning waiting-check-connect">
          <p>
            {runnerStuck ? 'Runner не забирає чати. ' : ''}Runner запускається при вході в систему й працює з цим браузером: тримайте відкритими WhatsApp Web і цю сторінку. Якщо статус не оновиться протягом хвилини — підключіть браузер повторно.
          </p>
          <Button type="button" size="sm" variant="outline" disabled={busy} onClick={onConnect}>
            <Cable data-icon="inline-start" className="size-3.5" aria-hidden="true" />
            Підключити цей браузер
          </Button>
        </div>
      )}

      {recent && view.problems.length > 0 && (
        <div className="waiting-check-problems-wrap">
          <div className="flex items-center justify-between px-1 py-1">
            <strong className="text-xs font-semibold text-foreground">
              Чати, що потребують рішення ({view.problems.length})
            </strong>
          </div>
          <ul className="waiting-check-problems" aria-label="Чати, що потребують рішення">
            {view.problems.map((item) => (
              <li key={item.chatId} className="waiting-check-problem-item">
                <div className="waiting-check-problem-text">
                  <span className="font-semibold text-foreground">{item.name}</span>
                  <small className="font-medium text-destructive">{waitingCheckReasonLabel(item.reason)}</small>
                </div>
                {item.chat && (
                  <div className="waiting-check-problem-actions">
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      title="Відкрити в WhatsApp"
                      aria-label={`Відкрити ${item.name} у WhatsApp`}
                      onClick={() => onProblemAction(item, 'open')}
                    >
                      <ExternalLink className="size-3.5" aria-hidden="true" />
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={busy}
                      title="Вас прийняли — перенести в «Для публікації»"
                      onClick={() => onProblemAction(item, 'approved')}
                      className="border-emerald-500/30 text-emerald-800 hover:bg-emerald-50 dark:text-emerald-400"
                    >
                      <Check data-icon="inline-start" className="size-3.5" aria-hidden="true" />
                      Прийняли
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={busy}
                      title="Відкласти на 3 дні"
                      onClick={() => onProblemAction(item, 'snooze')}
                      className="border-amber-500/30 text-amber-800 hover:bg-amber-50 dark:text-amber-400"
                    >
                      <Clock3 data-icon="inline-start" className="size-3.5" aria-hidden="true" />
                      +3 дні
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      disabled={busy}
                      title="Перенести в архів"
                      onClick={() => onProblemAction(item, 'archive')}
                      className="text-muted-foreground hover:text-foreground"
                    >
                      <Archive data-icon="inline-start" className="size-3.5" aria-hidden="true" />
                      В архів
                    </Button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
