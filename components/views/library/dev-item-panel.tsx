'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { ImagePlus, Plus, X } from 'lucide-react';
import { Panel } from '@/components/shell/panel';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { humanError } from '@/components/ui/human-error';
import { Input, Textarea } from '@/components/ui/input';
import { Segmented } from '@/components/ui/segmented';
import { Select } from '@/components/ui/select';
import { useToast } from '@/components/ui/toast';
import { Checkbox } from '@/components/ui/toggle';
import {
  CHECKLIST_LIMIT, DEV_PRIORITIES, DEV_PRIORITY_LABEL, DEV_STATUSES, DEV_STATUS_LABEL, DEV_TYPES, DEV_TYPE_LABEL, PHOTO_LIMIT, checklistProgress, taskText,
  type ChecklistItem, type DevItem, type DevPhoto, type DevPriority, type DevStatus, type DevType,
} from '@/lib/dev-items';
import { cn } from '@/lib/utils';
import { compressImage } from './image-compress';

type Draft = { type: DevType; title: string; body: string; status: DevStatus; priority: DevPriority; checklist: ChecklistItem[]; photos: DevPhoto[]; notes: string };
const draftOf = (item: DevItem | null, status: DevStatus): Draft => item
  ? { type: item.type, title: item.title, body: item.body, status: item.status, priority: item.priority, checklist: item.checklist.map((entry) => ({ ...entry })), photos: [...item.photos], notes: item.notes }
  : { type: 'idea', title: '', body: '', status, priority: 'normal', checklist: [], photos: [], notes: '' };
const photoUrl = (key: string) => `/api/dev-items/files?key=${encodeURIComponent(key)}`;

/**
 * Inspector запису «Розробки»: тип, назва, статус, пріоритет, опис, чекпоінти з прогресом, фото (кліком, перетягуванням і
 * вставкою з буфера; стискаються в браузері, файли в R2) і нотатки. «Скопіювати як задачу» кладе короткий текст у буфер.
 */
export function DevItemPanel({ item, defaultStatus, onClose, onChanged }: { item: DevItem | null; defaultStatus: DevStatus; onClose: () => void; onChanged: () => void }) {
  const toast = useToast();
  const id = useId();
  const [draft, setDraft] = useState<Draft>(() => draftOf(item, defaultStatus));
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [archiveAsk, setArchiveAsk] = useState(false);
  const [newStep, setNewStep] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);
  // Завантажені, але ще не збережені фото: якщо запис закрито без збереження, вони видаляються.
  const unsaved = useRef(new Set<string>());
  const archived = item?.archivedAt != null;
  const progress = checklistProgress(draft.checklist);
  const set = (patch: Partial<Draft>) => setDraft((current) => ({ ...current, ...patch }));

  const discardUnsaved = () => {
    for (const key of unsaved.current) void fetch(`/api/dev-items/files?key=${encodeURIComponent(key)}`, { method: 'DELETE', keepalive: true }).catch(() => {});
    unsaved.current.clear();
  };
  useEffect(() => () => discardUnsaved(), []);

  const addFiles = async (files: File[]) => {
    const images = files.filter((file) => file.type.startsWith('image/'));
    if (!images.length) return;
    const room = PHOTO_LIMIT - draft.photos.length;
    if (room <= 0) { toast.push({ message: `До запису можна додати до ${PHOTO_LIMIT} фото.`, tone: 'hot' }); return; }
    setUploading((value) => value + Math.min(images.length, room));
    for (const file of images.slice(0, room)) {
      try {
        const blob = await compressImage(file);
        const response = await fetch('/api/dev-items/files', { method: 'POST', headers: { 'Content-Type': blob.type }, body: blob });
        const body = await response.json().catch(() => ({})) as { key?: string; bytes?: number; error?: string };
        if (!response.ok || !body.key) throw new Error(body.error || 'Не вдалося завантажити фото.');
        unsaved.current.add(body.key);
        const photo: DevPhoto = { key: body.key, name: (file.name || 'фото').slice(0, 120), bytes: body.bytes ?? blob.size };
        setDraft((current) => ({ ...current, photos: [...current.photos, photo] }));
      } catch (reason) {
        toast.push({ message: humanError(reason, 'Не вдалося завантажити фото.'), tone: 'hot' });
      } finally {
        setUploading((value) => Math.max(0, value - 1));
      }
    }
  };

  // Вставка зображення з буфера, поки запис відкритий (Ctrl+V / ⌘V).
  useEffect(() => {
    const onPaste = (event: ClipboardEvent) => {
      const files = [...(event.clipboardData?.files ?? [])].filter((file) => file.type.startsWith('image/'));
      if (!files.length || archived) return;
      event.preventDefault();
      void addFiles(files);
    };
    document.addEventListener('paste', onPaste);
    return () => document.removeEventListener('paste', onPaste);
  });

  const addStep = () => {
    const text = newStep.trim();
    if (!text || draft.checklist.length >= CHECKLIST_LIMIT) return;
    set({ checklist: [...draft.checklist, { id: crypto.randomUUID(), text, done: false }] });
    setNewStep('');
  };

  const save = async () => {
    setSaving(true);
    try {
      const response = await fetch('/api/dev-items', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'save', id: item?.id, version: item?.version, ...draft }) });
      const body = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(body.error || 'Не вдалося зберегти запис.');
      unsaved.current.clear();
      toast.push({ message: 'Запис збережено.', tone: 'ok' });
      onChanged();
      onClose();
    } catch (reason) {
      toast.push({ message: humanError(reason, 'Не вдалося зберегти запис.'), tone: 'hot', duration: 7000 });
    } finally {
      setSaving(false);
    }
  };

  const archive = async () => {
    if (!item) return;
    setSaving(true);
    try {
      const response = await fetch('/api/dev-items', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: archived ? 'restore' : 'archive', id: item.id }) });
      if (!response.ok) throw new Error(((await response.json().catch(() => ({}))) as { error?: string }).error || 'Не вдалося змінити запис.');
      toast.push({ message: archived ? 'Запис відновлено.' : 'Переміщено в архів.', tone: 'ok' });
      onChanged();
      onClose();
    } catch (reason) {
      toast.push({ message: humanError(reason, 'Не вдалося змінити запис.'), tone: 'hot' });
    } finally {
      setSaving(false);
      setArchiveAsk(false);
    }
  };

  const copyTask = async () => {
    try {
      await navigator.clipboard.writeText(taskText({ ...draft }));
      toast.push({ message: 'Задачу скопійовано. Встав її в чат.' });
    } catch {
      toast.push({ message: 'Не вдалося скопіювати текст.', tone: 'hot' });
    }
  };

  const locked = saving || archived;
  return (
    <>
      <Panel
        open
        onOpenChange={(open) => { if (!open) { discardUnsaved(); onClose(); } }}
        title={item ? item.title : 'Новий запис'}
        subtitle={`${DEV_TYPE_LABEL[draft.type]} · ${DEV_STATUS_LABEL[draft.status]}`}
        footer={(
          <div className="flex items-center justify-between gap-3">
            <span className="flex items-center gap-1">
              <Button variant="ghost" size="sm" disabled={!draft.title.trim()} onClick={() => void copyTask()}>Скопіювати як задачу</Button>
              {item ? <Button variant="ghost" size="sm" disabled={saving} onClick={() => (archived ? void archive() : setArchiveAsk(true))}>{archived ? 'Відновити' : 'В архів'}</Button> : null}
            </span>
            {archived ? null : <Button variant="action" size="sm" busy={saving} disabled={!draft.title.trim() || uploading > 0} onClick={() => void save()}>{saving ? 'Зберігаємо…' : 'Зберегти'}</Button>}
          </div>
        )}
      >
        <div className="flex flex-col gap-5">
          {archived ? <p className="m-0 text-[13px] text-ink-2">Запис в архіві: щоб редагувати, спершу відновити його.</p> : null}
          <Segmented<DevType> label="Тип запису" size="sm" value={draft.type} onValueChange={(type) => set({ type })} items={DEV_TYPES.map((type) => ({ value: type, label: DEV_TYPE_LABEL[type] }))} />
          <Field label="Назва" htmlFor={`${id}-title`}>
            <Input id={`${id}-title`} disabled={locked} value={draft.title} maxLength={200} onChange={(event) => set({ title: event.target.value })} placeholder="Що зробити або що зламалось" />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Статус">
              <Select value={draft.status} disabled={locked} onChange={(event) => set({ status: event.target.value as DevStatus })}>
                {DEV_STATUSES.map((status) => <option key={status} value={status}>{DEV_STATUS_LABEL[status]}</option>)}
              </Select>
            </Field>
            <Field label="Пріоритет">
              <Select value={draft.priority} disabled={locked} onChange={(event) => set({ priority: event.target.value as DevPriority })}>
                {DEV_PRIORITIES.map((priority) => <option key={priority} value={priority}>{DEV_PRIORITY_LABEL[priority]}</option>)}
              </Select>
            </Field>
          </div>
          <Field label="Опис" htmlFor={`${id}-body`}>
            <Textarea id={`${id}-body`} disabled={locked} rows={5} value={draft.body} maxLength={10000} onChange={(event) => set({ body: event.target.value })} placeholder="Деталі, кроки відтворення, очікуваний результат" />
          </Field>

          <section className="flex flex-col gap-2" aria-label="Чекпоінти">
            <div className="flex items-center justify-between gap-3">
              <h3 className="m-0 text-xs font-medium text-ink-2">Чекпоінти</h3>
              {progress.total ? <span className="font-mono text-xs text-ink-2">{progress.done} / {progress.total}</span> : null}
            </div>
            {progress.total ? <div aria-hidden="true" className="h-1 overflow-hidden rounded-full bg-raised"><div className="h-full rounded-full bg-ink-2 transition-[width] duration-200" style={{ width: `${progress.ratio * 100}%` }} /></div> : null}
            <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
              {draft.checklist.map((entry) => (
                <li key={entry.id} className="flex items-center gap-2.5">
                  <Checkbox checked={entry.done} disabled={locked} aria-label={`Виконано: ${entry.text}`} onCheckedChange={(checked) => set({ checklist: draft.checklist.map((other) => (other.id === entry.id ? { ...other, done: checked === true } : other)) })} />
                  <Input value={entry.text} disabled={locked} aria-label="Текст чекпоінта" className={cn('h-9', entry.done && 'text-ink-2 line-through')} maxLength={300} onChange={(event) => set({ checklist: draft.checklist.map((other) => (other.id === entry.id ? { ...other, text: event.target.value } : other)) })} />
                  <Button variant="icon" size="sm" disabled={locked} aria-label={`Прибрати чекпоінт ${entry.text}`} onClick={() => set({ checklist: draft.checklist.filter((other) => other.id !== entry.id) })}><X aria-hidden="true" strokeWidth={1.5} /></Button>
                </li>
              ))}
            </ul>
            <div className="flex items-center gap-2">
              <Input value={newStep} disabled={locked || draft.checklist.length >= CHECKLIST_LIMIT} aria-label="Новий чекпоінт" placeholder="Новий чекпоінт" maxLength={300} onChange={(event) => setNewStep(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); addStep(); } }} />
              <Button variant="outline" size="md" disabled={locked || !newStep.trim()} onClick={addStep}><Plus aria-hidden="true" strokeWidth={1.5} />Додати</Button>
            </div>
          </section>

          <section className="flex flex-col gap-2" aria-label="Фото">
            <h3 className="m-0 text-xs font-medium text-ink-2">Фото</h3>
            <div
              onDragOver={(event) => { if (locked) return; event.preventDefault(); setDragging(true); }}
              onDragLeave={() => setDragging(false)}
              onDrop={(event) => { event.preventDefault(); setDragging(false); if (!locked) void addFiles([...event.dataTransfer.files]); }}
              className={cn('flex flex-col gap-3 rounded-inner border border-dashed p-3 transition-colors duration-200', dragging ? 'border-line-strong bg-raised' : 'border-line')}
            >
              {draft.photos.length || uploading ? (
                <ul className="m-0 grid list-none grid-cols-3 gap-2 p-0">
                  {draft.photos.map((photo) => (
                    <li key={photo.key} className="relative aspect-square overflow-hidden rounded-field border border-line bg-sunken">
                      <a href={photoUrl(photo.key)} target="_blank" rel="noreferrer" aria-label={`Відкрити фото ${photo.name}`} className="block size-full"><span aria-hidden="true" className="block size-full bg-cover bg-center" style={{ backgroundImage: `url("${photoUrl(photo.key)}")` }} /></a>
                      <button type="button" disabled={locked} aria-label={`Прибрати фото ${photo.name}`} onClick={() => set({ photos: draft.photos.filter((other) => other.key !== photo.key) })} className="absolute right-1 top-1 inline-flex size-6 items-center justify-center rounded-full bg-solid text-ink transition-colors hover:bg-raised"><X aria-hidden="true" strokeWidth={1.5} className="size-3.5" /></button>
                    </li>
                  ))}
                  {Array.from({ length: uploading }, (_, index) => <li key={`up-${index}`} aria-busy="true" className="aspect-square animate-pulse rounded-field bg-raised" />)}
                </ul>
              ) : null}
              <div className="flex flex-wrap items-center gap-2">
                <Button variant="outline" size="sm" disabled={locked || draft.photos.length >= PHOTO_LIMIT} onClick={() => fileInput.current?.click()}><ImagePlus aria-hidden="true" strokeWidth={1.5} />Додати фото</Button>
                <span className="text-xs text-ink-2">Натисни, перетягни файл сюди або встав з буфера (Ctrl+V).</span>
              </div>
              <input ref={fileInput} type="file" accept="image/*" multiple hidden onChange={(event) => { void addFiles([...(event.target.files ?? [])]); event.target.value = ''; }} />
            </div>
          </section>

          <Field label="Нотатки" htmlFor={`${id}-notes`}>
            <Textarea id={`${id}-notes`} disabled={locked} rows={3} value={draft.notes} maxLength={5000} onChange={(event) => set({ notes: event.target.value })} />
          </Field>
        </div>
      </Panel>
      {archiveAsk ? <ConfirmDialog
        open
        title="Перемістити запис в архів?"
        description={item ? `«${item.title}» зникне з дошки, але його можна відновити з архіву.` : ''}
        confirmLabel="В архів"
        destructive
        busy={saving}
        onCancel={() => setArchiveAsk(false)}
        onConfirm={() => void archive()}
      /> : null}
    </>
  );
}
