'use client';

import { useRef } from 'react';
import {
  CheckCircle2,
  FileImage,
  ImagePlus,
  Loader2,
  RotateCcw,
  Send,
  Sparkles,
  Square,
  Trash2,
  UploadCloud,
  XCircle,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';

export type WhatsAppAutopostImage = {
  fileName: string;
  contentType: string;
  sizeBytes: number;
  sha256: string;
  updatedAt: number;
};
export type WhatsAppAutopostProgress = {
  total: number;
  done: number;
  pending: number;
  claimed: number;
  sent: number;
  failed: number;
  cancelled: number;
  running: boolean;
};

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} Б`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} КБ`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} МБ`;
}

export function WhatsappAutopostDialog({
  open,
  onClose,
  image,
  imageLoaded,
  caption,
  captionLoaded,
  busy,
  queueSize,
  progress,
  onCaptionChange,
  onUploadImage,
  onRemoveImage,
  onSaveCaption,
  onClearCaption,
  onStart,
  onStop,
  onReset,
  finalFocus,
}: {
  open: boolean;
  onClose: () => void;
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
  finalFocus?: () => HTMLElement | null;
}) {
  const fileInput = useRef<HTMLInputElement | null>(null);
  const ready = imageLoaded && Boolean(image) && captionLoaded;
  const running = progress?.running === true;
  const hasQueue = Boolean(progress && (progress.total > 0 || progress.cancelled > 0));
  const progressPercent =
    progress && progress.total > 0
      ? Math.min(100, Math.round((progress.done / Math.max(1, progress.total)) * 100))
      : 0;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && !busy) onClose();
      }}
    >
      <DialogContent className="whatsapp-autopost-dialog" finalFocus={finalFocus}>
        <DialogHeader>
          <div className="flex items-center gap-2">
            <DialogTitle>Автопублікація черги WhatsApp</DialogTitle>
            <Badge variant="outline" className="border-emerald-600/30 bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-400">
              WhatsApp
            </Badge>
          </div>
          <DialogDescription>
            Work OS автоматично підбере матеріали й виконає безпечну відправку до 30 чатів у черзі з підтвердженням відправки на кожному кроці.
          </DialogDescription>
        </DialogHeader>

        {progress && progress.total > 0 && (
          <section className="whatsapp-autopost-progress" aria-label="Прогрес автопоста">
            <div className="whatsapp-autopost-progress-head">
              <div className="flex items-center gap-2">
                {running ? (
                  <span className="relative flex size-2.5">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                    <span className="relative inline-flex size-2.5 rounded-full bg-emerald-600" />
                  </span>
                ) : (
                  <CheckCircle2 className="size-4 text-emerald-600" />
                )}
                <strong className="text-sm font-semibold">{running ? 'Автопост виконується' : 'Автопост завершено'}</strong>
              </div>
              <span className="text-sm font-bold tabular-nums text-foreground">
                {progress.done} з {progress.total} ({progressPercent}%)
              </span>
            </div>

            <div className="whatsapp-autopost-progress-track">
              <div
                className="whatsapp-autopost-progress-fill"
                style={{ width: `${progressPercent}%` }}
                role="progressbar"
                aria-valuenow={progress.done}
                aria-valuemin={0}
                aria-valuemax={progress.total}
              />
            </div>

            <div className="whatsapp-autopost-stats-grid">
              <span className="stat-pill is-sent">
                <CheckCircle2 className="size-3 text-emerald-600 dark:text-emerald-400" /> Відправлено: <b>{progress.sent}</b>
              </span>
              {progress.failed > 0 && (
                <span className="stat-pill is-failed">
                  <XCircle className="size-3 text-destructive" /> Помилка: <b>{progress.failed}</b>
                </span>
              )}
              {progress.pending + progress.claimed > 0 && (
                <span className="stat-pill is-pending">
                  <Loader2 className="size-3 animate-spin text-amber-600 dark:text-amber-400" /> Лишилось: <b>{progress.pending + progress.claimed}</b>
                </span>
              )}
              {progress.cancelled > 0 && (
                <span className="stat-pill is-cancelled">
                  Скасовано: <b>{progress.cancelled}</b>
                </span>
              )}
            </div>

            <div className="whatsapp-autopost-log-note">
              {running ? (
                <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Loader2 className="size-3.5 animate-spin text-primary shrink-0" />
                  Executor відправляє повідомлення по черзі з підтвердженням доставки для кожного чату.
                </span>
              ) : progress.failed > 0 ? (
                <span className="flex items-center gap-1.5 text-xs text-destructive font-medium">
                  <XCircle className="size-3.5 shrink-0" />
                  Автопост завершено із {progress.failed} помилками. Перевірте проблемні чати у списку.
                </span>
              ) : (
                <span className="flex items-center gap-1.5 text-xs text-emerald-600 dark:text-emerald-400 font-medium">
                  <CheckCircle2 className="size-3.5 shrink-0" />
                  Усі чати в черзі успішно опрацьовано та підтверджено.
                </span>
              )}
            </div>
          </section>
        )}

        <div className="whatsapp-autopost-photo">
          <div className="flex items-center justify-between">
            <strong className="text-sm font-semibold text-foreground">Зображення для публікації</strong>
            <span className="text-xs text-muted-foreground">Обов&apos;язкове для старту</span>
          </div>

          <input
            ref={fileInput}
            className="sr-only"
            type="file"
            accept="image/jpeg,image/png,image/webp"
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = '';
              if (file) onUploadImage(file);
            }}
          />

          {image ? (
            <div className="whatsapp-autopost-image-card">
              <div className="whatsapp-autopost-image-info">
                <div className="whatsapp-autopost-image-icon">
                  <FileImage className="size-6 text-primary" />
                </div>
                <div className="min-w-0">
                  <span className="whatsapp-autopost-image-name" title={image.fileName}>
                    {image.fileName}
                  </span>
                  <span className="whatsapp-autopost-image-meta">
                    {formatBytes(image.sizeBytes)} · JPG оптимізовано для WhatsApp
                  </span>
                </div>
              </div>
              <div className="whatsapp-autopost-image-actions">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  onClick={() => fileInput.current?.click()}
                  title="Обрати інше фото"
                >
                  <ImagePlus className="size-3.5" data-icon="inline-start" />
                  Замінити
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  disabled={busy}
                  onClick={onRemoveImage}
                  title="Видалити зображення"
                  className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                >
                  <Trash2 className="size-3.5" data-icon="inline-start" />
                  Прибрати
                </Button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              className="whatsapp-autopost-dropzone"
              disabled={busy}
              onClick={() => fileInput.current?.click()}
            >
              <div className="whatsapp-autopost-dropzone-icon">
                <UploadCloud className="size-6 text-primary" />
              </div>
              <div className="text-center">
                <strong className="block text-xs font-semibold text-foreground">Натисніть для завантаження фото</strong>
                <span className="block text-[11px] text-muted-foreground">JPG, PNG або WebP (до 640 КБ, автоматичне стискання)</span>
              </div>
            </button>
          )}
        </div>

        <div className="whatsapp-autopost-caption-wrap">
          <div className="flex items-center justify-between">
            <label htmlFor="whatsapp-autopost-caption" className="text-sm font-semibold text-foreground">
              Текст автопоста
            </label>
            <span className="text-[11px] tabular-nums text-muted-foreground">
              {caption.length} / 4000
            </span>
          </div>

          <Textarea
            id="whatsapp-autopost-caption"
            rows={5}
            maxLength={4000}
            disabled={busy || !captionLoaded}
            value={caption}
            onChange={(event) => onCaptionChange(event.target.value)}
            placeholder="Вставте текст, який має піти під фото. Якщо залишити порожнім — Work OS автоматично підставить текст із Library для кожного чату."
            className="whatsapp-autopost-textarea"
          />

          <div className="flex flex-wrap items-center justify-between gap-2">
            <small className="text-xs text-muted-foreground">
              {caption.trim() ? (
                <span className="flex items-center gap-1 text-foreground/80">
                  <Sparkles className="size-3 text-primary" /> Власний текст використовується як підпис до фото
                </span>
              ) : (
                'Текст із Library підставляється окремо для кожного напрямку чату'
              )}
            </small>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={busy || !captionLoaded}
                onClick={onSaveCaption}
              >
                Зберегти текст
              </Button>
              {caption && (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  disabled={busy}
                  onClick={onClearCaption}
                  className="text-muted-foreground hover:text-foreground"
                >
                  Очистити
                </Button>
              )}
            </div>
          </div>
        </div>

        <div className="dialog-actions whatsapp-autopost-actions">
          {hasQueue && !running && (
            <Button
              variant="outline"
              disabled={busy}
              onClick={onReset}
              title="Почати постинг спочатку: сьогоднішня черга очиститься, уже відправлені чати лишаться"
            >
              <RotateCcw data-icon="inline-start" className="size-3.5" />
              Скинути чергу
            </Button>
          )}
          <Button variant="outline" disabled={busy} onClick={onClose}>
            Закрити
          </Button>
          {running ? (
            <Button
              variant="destructive"
              disabled={busy}
              onClick={onStop}
            >
              <Square data-icon="inline-start" className="size-3.5" />
              Зупинити автопост
            </Button>
          ) : (
            <Button disabled={busy || !ready} onClick={onStart}>
              {busy ? (
                <Loader2 data-icon="inline-start" className="size-4 animate-spin" />
              ) : (
                <Send data-icon="inline-start" className="size-4" />
              )}
              {busy
                ? 'Ставимо в чергу…'
                : queueSize
                ? `Автопост черги (${queueSize})`
                : 'Автопост черги'}
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
