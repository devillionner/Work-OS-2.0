'use client';

import { useRef } from 'react';
import { CheckCircle2, ImagePlus, RotateCcw, Send, Square, Trash2, UploadCloud, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Ring } from '@/components/ui/ring';
import { Textarea } from '@/components/ui/input';
import { Surface } from '@/components/ui/surface';

export type WhatsAppAutopostImage = { fileName: string; contentType: string; sizeBytes: number; sha256: string; updatedAt: number };
export type WhatsAppAutopostProgress = { total: number; done: number; pending: number; claimed: number; sent: number; failed: number; cancelled: number; running: boolean };

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} Б`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} КБ`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} МБ`;
}

/** Картка-редактор WhatsApp-автопоста: фото й підпис, статус черги кільцем, старт / стоп / скидання черги. */
export function AutopostCard({ image, imageLoaded, caption, captionLoaded, busy, queueSize, progress, onCaptionChange, onUploadImage, onRemoveImage, onSaveCaption, onClearCaption, onStart, onStop, onReset }: {
  image: WhatsAppAutopostImage | null;
  imageLoaded: boolean;
  caption: string;
  captionLoaded: boolean;
  busy: boolean;
  queueSize: number;
  progress: WhatsAppAutopostProgress | null;
  onCaptionChange: (value: string) => void;
  onUploadImage: (file: File) => void;
  onRemoveImage: () => void;
  onSaveCaption: () => void;
  onClearCaption: () => void;
  onStart: () => void;
  onStop: () => void;
  onReset: () => void;
}) {
  const fileInput = useRef<HTMLInputElement | null>(null);
  const ready = imageLoaded && Boolean(image) && captionLoaded;
  const running = progress?.running === true;
  const hasQueue = Boolean(progress && (progress.total > 0 || progress.cancelled > 0));
  const ratio = progress && progress.total > 0 ? Math.min(1, progress.done / progress.total) : 0;

  return (
    <Surface variant="glass" radius="card" className="flex flex-col gap-6 p-5 sm:p-6" aria-labelledby="autopost-title">
      <div>
        <h2 id="autopost-title" className="m-0 text-[17px] font-medium">Автопублікація черги</h2>
        <p className="m-0 mt-1 max-w-[62ch] text-sm text-ink-2">До 30 чатів із черги «Для публікації» по черзі, з підтвердженням кожної відправки.</p>
      </div>

      {progress && progress.total > 0 ? (
        <section className="flex items-center gap-5 rounded-inner border border-line bg-sunken p-4" aria-label="Прогрес автопоста">
          <Ring value={ratio} tone={progress.failed > 0 ? 'warn' : ratio >= 1 ? 'ok' : 'ink'} size={72} stroke={5} label={`Автопост: ${progress.done} з ${progress.total}`}>{Math.round(ratio * 100)}%</Ring>
          <div className="min-w-0 flex-1">
            <p className="m-0 flex items-center gap-2 text-sm font-medium">
              {running ? <i aria-hidden="true" className="size-2 rounded-full bg-ok" /> : <CheckCircle2 aria-hidden="true" strokeWidth={1.5} className="size-4 text-ok" />}
              {running ? 'Автопост виконується' : 'Автопост завершено'}
              <span className="ml-auto font-mono text-sm font-normal">{progress.done} з {progress.total}</span>
            </p>
            <p className="m-0 mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-2">
              <span>Відправлено <b className="font-mono font-normal text-ink">{progress.sent}</b></span>
              {progress.failed > 0 ? <span className="inline-flex items-center gap-1 text-hot"><XCircle aria-hidden="true" strokeWidth={1.5} className="size-3.5" />Помилок <b className="font-mono font-normal">{progress.failed}</b></span> : null}
              {progress.pending + progress.claimed > 0 ? <span>Лишилось <b className="font-mono font-normal text-ink">{progress.pending + progress.claimed}</b></span> : null}
              {progress.cancelled > 0 ? <span>Скасовано <b className="font-mono font-normal text-ink">{progress.cancelled}</b></span> : null}
            </p>
            {running ? null : <p className="m-0 mt-1.5 text-xs text-ink-2">{progress.failed > 0 ? `Автопост завершено з помилками (${progress.failed}). Перевір проблемні чати у списку.` : 'Усі чати в черзі опрацьовано й підтверджено.'}</p>}
          </div>
        </section>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="flex flex-col gap-3" aria-label="Зображення для публікації">
          <div className="flex items-center justify-between"><h3 className="m-0 text-sm font-medium">Зображення</h3><span className="text-xs text-ink-2">обов’язкове для старту</span></div>
          <input ref={fileInput} className="sr-only" type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ''; if (file) onUploadImage(file); }} />
          {image ? (
            <div className="flex flex-col gap-3 rounded-inner border border-line bg-sunken p-4">
              <div className="min-w-0"><p className="m-0 truncate text-sm font-medium" title={image.fileName}>{image.fileName}</p><p className="m-0 text-xs text-ink-2">{formatBytes(image.sizeBytes)}</p></div>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" disabled={busy} onClick={() => fileInput.current?.click()}><ImagePlus aria-hidden="true" strokeWidth={1.5} />Замінити фото</Button>
                <Button variant="ghost" size="sm" tone="danger" disabled={busy} onClick={onRemoveImage}><Trash2 aria-hidden="true" strokeWidth={1.5} />Прибрати</Button>
              </div>
            </div>
          ) : (
            <button type="button" disabled={busy} onClick={() => fileInput.current?.click()} className="flex flex-col items-center gap-2 rounded-inner border border-dashed border-line-strong px-4 py-8 text-center transition-colors hover:bg-raised disabled:opacity-45">
              <UploadCloud aria-hidden="true" strokeWidth={1.5} className="size-6 text-ink-2" />
              <span className="text-sm font-medium">Додати фото</span>
              <span className="text-xs text-ink-2">JPG, PNG або WebP</span>
            </button>
          )}
        </section>

        <section className="flex flex-col gap-3" aria-label="Текст автопоста">
          <div className="flex items-center justify-between"><label htmlFor="whatsapp-autopost-caption" className="text-sm font-medium">Текст автопоста</label><span className="font-mono text-[11px] text-ink-2">{caption.length} / 4000</span></div>
          <Textarea id="whatsapp-autopost-caption" rows={6} maxLength={4000} disabled={busy || !captionLoaded} value={caption} onChange={(event) => onCaptionChange(event.target.value)} placeholder="Встав текст, який піде під фото. Залиш порожнім, щоб Work OS підставила текст із Бібліотеки для кожного чату." />
          <div className="flex flex-wrap items-center justify-between gap-2">
            <small className="text-xs text-ink-2">{caption.trim() ? 'Власний текст використовується як підпис до фото' : 'Текст із Бібліотеки підставляється окремо для кожного напрямку чату'}</small>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" disabled={busy || !captionLoaded} onClick={onSaveCaption}>Зберегти текст</Button>
              {caption ? <Button variant="ghost" size="sm" disabled={busy} onClick={onClearCaption}>Очистити</Button> : null}
            </div>
          </div>
        </section>
      </div>

      <div className="flex flex-wrap justify-end gap-2">
        {hasQueue && !running ? <Button variant="outline" disabled={busy} title="Почати постинг спочатку: сьогоднішня черга очиститься, уже відправлені чати лишаться" onClick={onReset}><RotateCcw aria-hidden="true" strokeWidth={1.5} />Скинути чергу</Button> : null}
        {running ? (
          <Button variant="outline" tone="danger" disabled={busy} onClick={onStop}><Square aria-hidden="true" strokeWidth={1.5} />Зупинити автопост</Button>
        ) : (
          <Button variant="action" busy={busy} disabled={!ready} onClick={onStart}><Send aria-hidden="true" strokeWidth={1.5} />{busy ? 'Ставимо в чергу…' : queueSize ? `Автопост черги (${queueSize})` : 'Автопост черги'}</Button>
        )}
      </div>
    </Surface>
  );
}
