'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { CheckCircle2, LoaderCircle, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { APP_BUILD_ID } from '@/lib/build-id';

type BuildResponse = { buildId?: string; version?: string };
type UpdatePhase = 'idle' | 'available' | 'updating' | 'finishing' | 'error';

type UpdateState = {
  phase: UpdatePhase;
  targetBuildId: string;
  version: string;
  deferred: boolean;
  step: number;
};

const BUILD_POLL_MS = 30_000;
const UPDATE_CHANNEL = 'work-os-release';
const PENDING_BUILD_KEY = 'work-os:pending-build';
const UPDATE_SCROLL_KEY = 'work-os:update-scroll';
const UPDATE_VIEW_KEY = 'work-os:update-view';
const VIEW_LABELS = ['Сьогодні', 'Платформи', 'Ліди', 'Аналітика', 'Звіти', 'Бібліотека', 'Налаштування'] as const;

const initialState: UpdateState = {
  phase: 'idle',
  targetBuildId: '',
  version: '',
  deferred: false,
  step: 0,
};

export function PwaRegistration() {
  const [update, setUpdate] = useState<UpdateState>(initialState);
  const applying = useRef(false);
  const detectedAt = useRef(0);
  const targetBuildRef = useRef('');
  const channelRef = useRef<BroadcastChannel | null>(null);

  const markAvailable = useCallback((targetBuildId: string, version = '', broadcast = true) => {
    if (!targetBuildId || targetBuildId === APP_BUILD_ID || applying.current) return;
    targetBuildRef.current = targetBuildId;
    detectedAt.current = Date.now();
    setUpdate((current) => current.phase === 'updating' || current.phase === 'finishing'
      ? current
      : { phase: 'available', targetBuildId, version, deferred: isEditing(), step: 0 });
    if (broadcast) channelRef.current?.postMessage({ type: 'release-available', targetBuildId, version });
  }, []);

  const checkBuild = useCallback(async () => {
    if (applying.current || APP_BUILD_ID === 'development') return;
    try {
      const response = await fetch(`/api/build?t=${Date.now()}`, {
        cache: 'no-store',
        headers: { Accept: 'application/json' },
      });
      if (!response.ok) return;
      const result = await response.json() as BuildResponse;
      if (result.buildId && result.buildId !== APP_BUILD_ID) {
        markAvailable(result.buildId, result.version || '');
      }
    } catch {
      // Update discovery is best-effort; an offline client keeps working and retries later.
    }
  }, [markAvailable]);

  const applyUpdate = useCallback(async () => {
    const targetBuildId = targetBuildRef.current;
    if (!targetBuildId || applying.current) return;
    applying.current = true;
    setUpdate((current) => ({ ...current, phase: 'updating', deferred: false, step: 1 }));

    try {
      sessionStorage.setItem(PENDING_BUILD_KEY, targetBuildId);
      sessionStorage.setItem(UPDATE_SCROLL_KEY, JSON.stringify({ x: window.scrollX, y: window.scrollY }));
      const activeView = readActiveViewLabel();
      if (activeView) sessionStorage.setItem(UPDATE_VIEW_KEY, activeView);

      if ('serviceWorker' in navigator) {
        const registration = await navigator.serviceWorker.getRegistration('/');
        if (registration) await registration.update();
      }

      setUpdate((current) => ({ ...current, step: 2 }));
      await new Promise((resolve) => window.setTimeout(resolve, 350));
      setUpdate((current) => ({ ...current, step: 3 }));
      await new Promise((resolve) => window.setTimeout(resolve, 450));

      // A full document navigation is required to replace already-running JS/CSS.
      // It is automatic, stays on the same URL, and is hidden behind the update UI.
      window.location.reload();
    } catch {
      applying.current = false;
      setUpdate((current) => ({ ...current, phase: 'error', step: 0 }));
    }
  }, []);

  useEffect(() => {
    const pending = sessionStorage.getItem(PENDING_BUILD_KEY);
    if (!pending || pending !== APP_BUILD_ID) return;

    applying.current = true;
    targetBuildRef.current = pending;
    const scroll = readSavedScroll();
    const savedView = sessionStorage.getItem(UPDATE_VIEW_KEY);
    let cancelled = false;

    queueMicrotask(() => {
      if (!cancelled) setUpdate({ phase: 'finishing', targetBuildId: pending, version: '', deferred: false, step: 3 });
    });

    void restoreActiveView(savedView).then(() => {
      if (!cancelled && scroll) window.scrollTo({ left: scroll.x, top: scroll.y, behavior: 'auto' });
    });

    const timer = window.setTimeout(() => {
      sessionStorage.removeItem(PENDING_BUILD_KEY);
      sessionStorage.removeItem(UPDATE_SCROLL_KEY);
      sessionStorage.removeItem(UPDATE_VIEW_KEY);
      applying.current = false;
      targetBuildRef.current = '';
      setUpdate(initialState);
    }, 1_000);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, []);

  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    const register = () => {
      void navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => undefined);
    };
    if (document.readyState === 'complete') register();
    else window.addEventListener('load', register, { once: true });
    return () => window.removeEventListener('load', register);
  }, []);

  useEffect(() => {
    let channel: BroadcastChannel | null = null;
    if ('BroadcastChannel' in window) {
      channel = new BroadcastChannel(UPDATE_CHANNEL);
      channelRef.current = channel;
      channel.onmessage = (event: MessageEvent<unknown>) => {
        const data = event.data as { type?: string; targetBuildId?: string; version?: string } | null;
        if (data?.type === 'release-available' && data.targetBuildId) {
          markAvailable(data.targetBuildId, data.version || '', false);
        }
      };
    }

    void checkBuild();
    const onFocus = () => void checkBuild();
    const onVisibility = () => {
      if (document.visibilityState === 'visible') void checkBuild();
    };
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible' && navigator.onLine) void checkBuild();
    }, BUILD_POLL_MS);

    window.addEventListener('focus', onFocus);
    window.addEventListener('online', onFocus);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('online', onFocus);
      document.removeEventListener('visibilitychange', onVisibility);
      channel?.close();
      if (channelRef.current === channel) channelRef.current = null;
    };
  }, [checkBuild, markAvailable]);

  useEffect(() => {
    if (update.phase !== 'available') return;
    const attempt = () => {
      const deferred = isEditing();
      setUpdate((current) => current.phase === 'available' ? { ...current, deferred } : current);
      if (!deferred && Date.now() - detectedAt.current >= 1_200) void applyUpdate();
    };
    attempt();
    const timer = window.setInterval(attempt, 700);
    return () => window.clearInterval(timer);
  }, [applyUpdate, update.phase]);

  if (update.phase === 'idle') return null;

  const shortBuild = update.targetBuildId ? update.targetBuildId.slice(0, 7) : '';
  if (update.phase === 'available') {
    return (
      <output className="app-update-banner" aria-live="polite">
        <span className="app-update-pulse" aria-hidden="true" />
        <div>
          <strong>Доступне оновлення Work OS</strong>
          <span>{update.deferred ? 'Застосуємо одразу після завершення вводу.' : 'Оновлення застосовується автоматично…'}</span>
        </div>
        {shortBuild && <small>{update.version ? `v${update.version} · ` : ''}{shortBuild}</small>}
      </output>
    );
  }

  const isError = update.phase === 'error';
  const isFinishing = update.phase === 'finishing';
  const steps = ['Готуємо оновлення', 'Оновлюємо файли', 'Повертаємо до роботи'];

  return (
    <dialog open className="app-update-backdrop" aria-labelledby="app-update-title">
      <div className="app-update-card">
        <div className="app-update-brand" aria-hidden="true">W</div>
        <div className={`app-update-icon ${isFinishing ? 'is-complete' : ''}`} aria-hidden="true">
          {isFinishing ? <CheckCircle2 /> : isError ? <RefreshCw /> : <LoaderCircle className="is-spinning" />}
        </div>
        <p className="eyebrow">Work OS</p>
        <h2 id="app-update-title">{isError ? 'Не вдалося завершити оновлення' : isFinishing ? 'Work OS оновлено' : 'Оновлюємо Work OS'}</h2>
        <p className="app-update-description">
          {isError
            ? 'Поточна версія залишається доступною. Можна безпечно повторити спробу.'
            : isFinishing
              ? 'Відновлюємо ваш екран і актуальні дані…'
              : 'Підтягуємо нову версію та синхронізуємо дані. Нічого натискати не потрібно.'}
        </p>
        {!isError && (
          <div className="app-update-progress" aria-label="Прогрес оновлення">
            <span style={{ width: isFinishing ? '100%' : `${Math.max(18, update.step * 33)}%` }} />
          </div>
        )}
        {!isError && (
          <ol className="app-update-steps">
            {steps.map((label, index) => {
              const complete = isFinishing || update.step > index + 1;
              const current = !isFinishing && update.step === index + 1;
              return <li key={label} className={complete ? 'is-complete' : current ? 'is-current' : ''}><span>{complete ? '✓' : index + 1}</span>{label}</li>;
            })}
          </ol>
        )}
        {isError && <Button onClick={() => void applyUpdate()}><RefreshCw data-icon="inline-start" />Спробувати ще раз</Button>}
        <small className="app-update-note">Поточний розділ і позиція сторінки збережуться автоматично.</small>
      </div>
    </dialog>
  );
}

function isEditing(): boolean {
  const element = document.activeElement;
  if (!element) return false;
  if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement) return true;
  return element instanceof HTMLElement && element.isContentEditable;
}

function readActiveViewLabel(): string | null {
  const current = document.querySelector<HTMLElement>('.nav-item[aria-current="page"]');
  if (!current) return null;
  const title = current.getAttribute('title') || '';
  const text = `${title} ${current.textContent || ''}`;
  return VIEW_LABELS.find((label) => text.includes(label)) || null;
}

async function restoreActiveView(savedView: string | null): Promise<void> {
  if (!savedView || savedView === 'Сьогодні') return;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const buttons = Array.from(document.querySelectorAll<HTMLButtonElement>('.nav-item'));
    const target = buttons.find((button) => {
      const text = `${button.getAttribute('title') || ''} ${button.textContent || ''}`;
      return text.includes(savedView);
    });
    if (target) {
      target.click();
      await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));
      return;
    }
    await new Promise((resolve) => window.setTimeout(resolve, 50));
  }
}

function readSavedScroll(): { x: number; y: number } | null {
  try {
    const raw = sessionStorage.getItem(UPDATE_SCROLL_KEY);
    if (!raw) return null;
    const value = JSON.parse(raw) as { x?: unknown; y?: unknown };
    return typeof value.x === 'number' && typeof value.y === 'number' ? { x: value.x, y: value.y } : null;
  } catch {
    return null;
  }
}
