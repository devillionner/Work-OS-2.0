'use client';

import { useRef, useState } from 'react';
import { Panel } from '@/components/shell/panel';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/dialog';
import { Ghost } from '@/components/ui/ghost';
import { useToast } from '@/components/ui/toast';
import { useRemote } from '@/components/views/shared/use-remote';
import type { BackupTable } from '@/lib/backups/export';
import { CLOUD_BACKUP_MAX_BYTES, inspectCloudBackup, type CloudBackupInspection } from '@/lib/backups/inspect';
import { BackupButton } from './backup-button';
import { humanError } from '@/components/ui/human-error';

type Preview = {
  sha256: string;
  inspection: CloudBackupInspection;
  currentRevision: number;
  dataChanged: boolean;
  comparison: Record<BackupTable, { backup: number; current: number; difference: number }>;
};
type StagedRestore = { id: string; filename: string; sha256: string; schemaVersion: number; sourceRevision: number; currentRevisionAtStage: number; byteSize: number; counts: Record<BackupTable, number>; status: string; createdAt: number };
type RestoreGate = { ready: boolean; currentRevision: number; backupRevision: number | null; backupCreatedAt: number | null };
type RestoreJob = { id: string; importId: string; status: 'running' | 'completed' | 'failed'; phase: string; total: number; complete: number; percent: number; error: string | null; completedAt: number | null };

const IMPORTANT_TABLES: BackupTable[] = ['chats', 'chat_profiles', 'chat_publications', 'leads', 'students', 'lessons', 'daily_reports', 'activity_events'];
const TABLE_LABELS: Partial<Record<BackupTable, string>> = { chats: 'Чати', chat_profiles: 'Профілі чатів', chat_publications: 'Публікації', leads: 'Ліди', students: 'Учні', lessons: 'Уроки', daily_reports: 'Звіти', activity_events: 'Події статистики' };

const formatBytes = (value: number) => (value >= 1024 * 1024 ? `${(value / 1024 / 1024).toFixed(1)} МБ` : `${Math.max(1, Math.round(value / 1024))} КБ`);

async function restoreRequest(action: 'start' | 'process', importId?: string): Promise<RestoreJob> {
  const response = await fetch('/api/backups/restore/apply', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, importId }) });
  const result = await response.json().catch(() => ({})) as { job?: RestoreJob | null; error?: string };
  if (!response.ok || !result.job) throw new Error(result.error || 'Не вдалося виконати етап відновлення.');
  return result.job;
}

/** Контрольоване відновлення: перевірка файлу, безпечна зона, свіжа контрольна копія й окреме підтвердження. Повертає лише відсутні записи. */
export function RestorePanel({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const toast = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [attempt, setAttempt] = useState(0);
  const [filename, setFilename] = useState('');
  const [reading, setReading] = useState(false);
  const [staging, setStaging] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [rawBackup, setRawBackup] = useState('');
  const [localInspection, setLocalInspection] = useState<CloudBackupInspection | null>(null);
  const [stagedLocal, setStagedLocal] = useState<StagedRestore | null>(null);
  const [jobLocal, setJobLocal] = useState<RestoreJob | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [error, setError] = useState('');

  const stagedRemote = useRemote<{ staged?: StagedRestore | null }>('/api/backups/restore/stage', { refresh: attempt, enabled: open, fallback: 'Не вдалося перевірити безпечну зону.' });
  const staged = stagedLocal ?? stagedRemote.data?.staged ?? null;
  const stateRemote = useRemote<{ gate?: RestoreGate | null; job?: RestoreJob | null }>(staged ? `/api/backups/restore/apply?importId=${encodeURIComponent(staged.id)}` : null, { refresh: attempt, enabled: open, fallback: 'Не вдалося перевірити готовність до відновлення.' });
  const gate = stateRemote.data?.gate ?? null;
  const job = jobLocal ?? stateRemote.data?.job ?? null;
  const busy = reading || staging || restoring;

  const chooseFile = async (file?: File) => {
    if (!file) return;
    setFilename(file.name); setReading(true); setPreview(null); setRawBackup(''); setError(''); setLocalInspection(null);
    try {
      if (file.size > CLOUD_BACKUP_MAX_BYTES) throw new Error('Файл завеликий. Максимальний розмір — 25 МБ.');
      const text = await file.text();
      const inspection = inspectCloudBackup(text);
      setLocalInspection(inspection);
      if (!inspection.valid) throw new Error(inspection.errors[0] || 'Копія не пройшла перевірку.');
      const response = await fetch('/api/backups/restore/preview', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ rawBackup: text }) });
      const result = await response.json().catch(() => ({})) as Preview & { error?: string };
      if (!response.ok) throw new Error(result.error || 'Не вдалося звірити копію з хмарною базою.');
      setPreview(result);
      setRawBackup(text);
    } catch (cause) {
      setError(humanError(cause, 'Не вдалося перевірити файл.'));
    } finally {
      setReading(false);
    }
  };

  const stage = async () => {
    if (!preview || !rawBackup || staging) return;
    setStaging(true); setError('');
    try {
      const response = await fetch('/api/backups/restore/stage', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ filename, rawBackup, sha256: preview.sha256 }) });
      const result = await response.json().catch(() => ({})) as { staged?: StagedRestore; error?: string };
      if (!response.ok || !result.staged) throw new Error(result.error || 'Не вдалося зберегти копію в безпечній зоні.');
      setStagedLocal(result.staged); setRawBackup(''); setJobLocal(null);
      setAttempt((value) => value + 1);
      toast.push({ message: 'Копію збережено в безпечній зоні.', tone: 'ok' });
    } catch (cause) {
      setError(humanError(cause, 'Не вдалося зберегти копію в безпечній зоні.'));
    } finally {
      setStaging(false);
    }
  };

  const restore = async () => {
    if (!staged || !gate?.ready || restoring) return;
    setRestoring(true); setError('');
    try {
      let current = await restoreRequest('start', staged.id);
      setJobLocal(current);
      for (let step = 0; current.status === 'running' && step < 500; step += 1) {
        current = await restoreRequest('process', staged.id);
        setJobLocal(current);
      }
      if (current.status !== 'completed') throw new Error(current.error || 'Відновлення призупинене. Його можна безпечно продовжити.');
      toast.push({ message: 'Відновлення завершено. Наявні дані не змінювалися.', tone: 'ok' });
    } catch (cause) {
      setError(humanError(cause, 'Не вдалося завершити відновлення.'));
    } finally {
      setRestoring(false);
      setConfirmOpen(false);
    }
  };

  const completed = job?.status === 'completed' || staged?.status === 'completed';

  return (
    <>
      <Panel open={open} onOpenChange={(next) => { if (!busy) onOpenChange(next); }} title="Відновлення з копії" subtitle="Спочатку файл лише перевіряється. Відновлення запускається окремо.">
        <div className="flex flex-col gap-5">
          <p className="m-0 text-[13px] text-ink-2">Відновлення повертає лише відсутні записи: наявні дані не видаляються й не перезаписуються. Перед запуском потрібна свіжа контрольна копія.</p>

          {staged ? (
            <section className="flex flex-col gap-1 rounded-inner border border-line bg-sunken p-4">
              <p className="m-0 text-xs font-medium text-ink-2">У безпечній зоні</p>
              <p className="m-0 truncate text-sm font-medium">{staged.filename}</p>
              <p className="m-0 text-xs text-ink-2"><span className="font-mono">{formatBytes(staged.byteSize)}</span> · {new Date(staged.createdAt * 1000).toLocaleString('uk-UA')}</p>
              <p className="m-0 text-xs text-ink-2">{completed ? 'Відсутні записи з цієї копії вже відновлено.' : 'Перевірений файл збережено окремо від робочих даних.'}</p>
            </section>
          ) : null}

          {staged && !completed && gate && !gate.ready ? (
            <section className="flex flex-col gap-3 rounded-inner border border-line p-4">
              <div><p className="m-0 text-sm font-medium">Спочатку захисти поточний стан</p><p className="m-0 mt-0.5 text-[13px] text-ink-2">Створи свіжу контрольну копію. Якщо щось піде не так, цей файл лишиться незалежною точкою відновлення.</p></div>
              <div><BackupButton label="Створити контрольну копію" onComplete={() => setAttempt((value) => value + 1)} /></div>
            </section>
          ) : null}

          {staged && !completed && gate?.ready ? (
            <section className="flex flex-col gap-3 rounded-inner border border-line p-4">
              {job ? (
                <div className="flex flex-col gap-2">
                  <div className="flex items-baseline justify-between gap-3"><p className="m-0 text-sm font-medium">{restoring ? 'Відновлюємо…' : job.status === 'failed' ? 'Можна безпечно продовжити' : 'Відновлення підготовлено'}</p><span className="font-mono text-xs text-ink-2">{job.complete} із {job.total}</span></div>
                  <progress className="sr-only" aria-label="Прогрес відновлення" max={100} value={job.percent} />
                  <div aria-hidden="true" className="h-1 overflow-hidden rounded-full bg-line"><div className="h-full origin-left rounded-full bg-ink" style={{ transform: `scaleX(${job.percent / 100})`, transition: 'transform 0.4s var(--ease-out)' }} /></div>
                  <p className="m-0 text-xs text-ink-2">{job.percent}% · {job.phase}</p>
                </div>
              ) : null}
              <div><Button variant="outline" tone="danger" busy={restoring} onClick={() => setConfirmOpen(true)}>{job ? 'Продовжити відновлення' : 'Відновити відсутні записи'}</Button></div>
            </section>
          ) : null}

          {completed ? <p className="m-0 rounded-inner border border-line bg-sunken p-4 text-sm"><span className="mr-2 inline-block size-1.5 rounded-full bg-ok align-middle" />Відновлення завершено. Відсутні записи повернуто, наявні дані не перезаписувалися й не видалялися.</p> : null}

          <input ref={input} type="file" accept="application/json,.json" className="sr-only" tabIndex={-1} aria-label="Файл резервної копії" onChange={(event) => { void chooseFile(event.target.files?.[0]); event.target.value = ''; }} />
          <button type="button" disabled={busy} onClick={() => input.current?.click()} className="flex flex-col items-start gap-1 rounded-inner border border-dashed border-line-strong px-5 py-5 text-left transition-colors duration-200 hover:bg-raised active:scale-[0.985] disabled:opacity-45">
            <span className="text-sm font-medium">{reading ? 'Перевіряємо копію…' : filename || 'Вибрати копію Work OS'}</span>
            <span className="text-xs text-ink-2">JSON до 25 МБ · спочатку лише перевірка</span>
          </button>
          {reading && !preview ? <Ghost className="h-24 rounded-inner" /> : null}

          {localInspection && !localInspection.valid ? <p role="alert" className="m-0 text-sm text-hot">Копія не пройшла перевірку: {localInspection.errors.length} помилок структури або зв’язків.</p> : null}

          {preview ? (
            <section className="flex flex-col gap-3">
              <p className="m-0 text-sm"><span className="mr-2 inline-block size-1.5 rounded-full bg-ok align-middle" />Копія цілісна й належить цьому акаунту · <span className="font-mono">{preview.inspection.totalRecords}</span> записів · код <span className="font-mono">{preview.sha256.slice(0, 12)}…</span></p>
              <table className="w-full border-collapse text-sm">
                <thead><tr className="text-left text-xs font-medium text-ink-2"><th scope="col" className="pb-2 font-medium">Розділ</th><th scope="col" className="pb-2 text-right font-medium">У копії</th><th scope="col" className="pb-2 text-right font-medium">Зараз</th></tr></thead>
                <tbody>{IMPORTANT_TABLES.map((table) => <tr key={table} className="border-t border-line"><th scope="row" className="py-2 text-left font-normal">{TABLE_LABELS[table] ?? table}</th><td className="py-2 text-right font-mono">{preview.comparison[table].backup}</td><td className="py-2 text-right font-mono">{preview.comparison[table].current}</td></tr>)}</tbody>
              </table>
              {preview.dataChanged ? <p className="m-0 text-[13px] text-ink-2"><span className="mr-2 inline-block size-1.5 rounded-full bg-warn align-middle" />Після створення цієї копії база змінювалася. Перед відновленням буде потрібна нова контрольна копія.</p> : null}
              {rawBackup ? <div><Button variant="action" size="sm" busy={staging} onClick={() => void stage()}>{staging ? 'Зберігаємо…' : 'Зберегти в безпечній зоні'}</Button></div> : null}
            </section>
          ) : null}

          {error ? <p role="alert" className="m-0 text-sm text-hot">{error}</p> : null}
        </div>
      </Panel>
      <ConfirmDialog
        open={confirmOpen}
        title="Відновити відсутні записи?"
        description="Зі збереженої копії повернуться лише записи, яких зараз немає. Наявні дані не змінюються. Перед запуском має бути свіжа контрольна копія."
        confirmLabel="Відновити"
        destructive
        busy={restoring}
        requireText="Відновити"
        onCancel={() => setConfirmOpen(false)}
        onConfirm={() => void restore()}
      />
    </>
  );
}
