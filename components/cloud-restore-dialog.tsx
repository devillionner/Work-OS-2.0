'use client';

import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, FileJson, LoaderCircle, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { CloudBackupButton } from '@/components/cloud-backup-button';
import { BACKUP_TABLES, type BackupTable } from '@/lib/backups/export';
import { CLOUD_BACKUP_MAX_BYTES, inspectCloudBackup, type CloudBackupInspection } from '@/lib/backups/inspect';

type Preview = {
  sha256: string;
  inspection: CloudBackupInspection;
  currentRevision: number;
  dataChanged: boolean;
  comparison: Record<BackupTable, { backup: number; current: number; difference: number }>;
};

type StagedRestore = {
  id: string; filename: string; sha256: string; schemaVersion: number; sourceRevision: number;
  currentRevisionAtStage: number; byteSize: number; counts: Record<BackupTable, number>;
  status: string; createdAt: number;
};
type RestoreGate = { ready: boolean; currentRevision: number; backupRevision: number | null; backupCreatedAt: number | null };
type RestoreJob = { id:string; importId:string; status:'running'|'completed'|'failed'; phase:string; total:number; complete:number; percent:number; error:string|null; completedAt:number|null };

const IMPORTANT_TABLES: BackupTable[] = ['chats', 'chat_profiles', 'chat_publications', 'leads', 'students', 'lessons', 'daily_reports', 'activity_events'];

export function CloudRestoreDialog({ open, onClose }: { open: boolean; onClose(): void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [filename, setFilename] = useState('');
  const [reading, setReading] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [staging, setStaging] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [staged, setStaged] = useState<StagedRestore | null>(null);
  const [rawBackup, setRawBackup] = useState('');
  const [gate, setGate] = useState<RestoreGate | null>(null);
  const [job, setJob] = useState<RestoreJob | null>(null);
  const [restoreConfirmed, setRestoreConfirmed] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [localInspection, setLocalInspection] = useState<CloudBackupInspection | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    let active = true;
    fetch('/api/backups/restore/stage', { cache: 'no-store' })
      .then(async (response) => { const result = await response.json() as { staged?: StagedRestore | null; error?: string }; if (!response.ok) throw new Error(result.error || 'Не вдалося перевірити безпечну зону.'); if (active) { setStaged(result.staged || null); if (result.staged) void loadRestoreState(result.staged.id, active); } })
      .catch((cause: unknown) => { if (active) setError(cause instanceof Error ? cause.message : 'Не вдалося перевірити безпечну зону.'); });
    return () => { active = false; };
  }, [open]);

  async function chooseFile(file?: File) {
    if (!file) return;
    setFilename(file.name); setReading(true); setPreview(null); setRawBackup(''); setError(''); setLocalInspection(null);
    try {
      if (file.size > CLOUD_BACKUP_MAX_BYTES) throw new Error('Файл завеликий. Максимальний розмір — 25 МБ.');
      const rawBackup = await file.text();
      const inspection = inspectCloudBackup(rawBackup);
      setLocalInspection(inspection);
      if (!inspection.valid) throw new Error(inspection.errors[0] || 'Копія не пройшла перевірку.');
      setPreviewing(true);
      const response = await fetch('/api/backups/restore/preview', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ rawBackup }) });
      const result = await response.json() as Preview & { error?: string };
      if (!response.ok) throw new Error(result.error || 'Не вдалося звірити копію з хмарною базою.');
      setPreview(result);
      setRawBackup(rawBackup);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Не вдалося перевірити файл.');
    } finally { setReading(false); setPreviewing(false); }
  }

  async function stage() {
    if (!preview || !rawBackup || staging) return;
    setStaging(true); setError('');
    try {
      const response = await fetch('/api/backups/restore/stage', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ filename, rawBackup, sha256: preview.sha256 }) });
      const result = await response.json() as { staged?: StagedRestore; error?: string };
      if (!response.ok || !result.staged) throw new Error(result.error || 'Не вдалося зберегти копію в безпечній зоні.');
      setStaged(result.staged); setRawBackup('');
      await loadRestoreState(result.staged.id);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Не вдалося зберегти копію в безпечній зоні.'); }
    finally { setStaging(false); }
  }

  async function loadRestoreState(importId: string, active = true) {
    const response = await fetch(`/api/backups/restore/apply?importId=${encodeURIComponent(importId)}`, { cache: 'no-store' });
    const result = await response.json() as { gate?: RestoreGate | null; job?: RestoreJob | null; error?: string };
    if (!response.ok) throw new Error(result.error || 'Не вдалося перевірити готовність до відновлення.');
    if (active) { setGate(result.gate || null); setJob(result.job || null); }
  }

  async function restore() {
    if (!staged || !gate?.ready || !restoreConfirmed || restoring) return;
    setRestoring(true); setError('');
    try {
      let current = await restoreRequest('start', staged.id);
      setJob(current);
      for (let step = 0; current.status === 'running' && step < 500; step += 1) {
        current = await restoreRequest('process', staged.id);
        setJob(current);
      }
      if (current.status !== 'completed') throw new Error(current.error || 'Відновлення призупинене. Його можна безпечно продовжити.');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Не вдалося завершити відновлення.'); }
    finally { setRestoring(false); }
  }

  const close = () => { if (!reading && !previewing && !staging && !restoring) onClose(); };
  return <Dialog open={open} onOpenChange={(next) => { if (!next) close(); }}><DialogContent className="import-dialog restore-dialog" showCloseButton={false}>
      <DialogHeader><p className="eyebrow">Контрольоване відновлення</p><DialogTitle>Перевірити резервну копію</DialogTitle><DialogDescription>Спочатку файл лише перевіряється. Відновлення запускається окремо після контрольної копії та підтвердження.</DialogDescription></DialogHeader>
      <div className="import-safety-note"><ShieldCheck /><div><strong>Без прямого перезаписування</strong><p>До окремого підтвердження файл лише перевіряється. Відновлення повертає відсутні записи, не видаляючи й не перезаписуючи наявні.</p></div></div>
      {staged && <section className="restore-staged"><div><p className="eyebrow">У безпечній зоні</p><strong>{staged.filename}</strong><span>{formatBytes(staged.byteSize)} · {new Date(staged.createdAt * 1000).toLocaleString('uk-UA')}</span></div><CheckCircle2 /><small>{staged.status === 'completed' ? 'Відсутні записи з цієї копії вже відновлено.' : 'Перевірений файл збережено окремо від робочих даних.'}</small></section>}
      {staged && gate && staged.status !== 'completed' && !gate.ready && <section className="restore-gate"><div><AlertTriangle /><div><strong>Спочатку захисти поточний стан</strong><p>Створи свіжу контрольну копію після підготовки копії. Якщо щось піде не так, цей файл залишиться незалежною точкою відновлення.</p></div></div><CloudBackupButton onComplete={() => void loadRestoreState(staged.id)} /></section>}
      {staged && gate?.ready && job?.status !== 'completed' && <section className="restore-apply"><label><input type="checkbox" checked={restoreConfirmed} onChange={(event) => setRestoreConfirmed(event.target.checked)} disabled={restoring} /><span>Я зберіг свіжу контрольну копію. Повернути лише відсутні записи з безпечної зони, не змінюючи наявні.</span></label>{job && <div className="migration-progress"><div><strong>{restoring ? 'Відновлюємо…' : job.status === 'failed' ? 'Можна безпечно продовжити' : 'Відновлення підготовлено'}</strong><span>{job.complete} із {job.total} порцій</span></div><div className="migration-progress-track"><i style={{ width: `${job.percent}%` }} /></div><small>{job.percent}% · {job.phase}</small></div>}<Button type="button" onClick={() => void restore()} disabled={!restoreConfirmed || restoring}>{restoring ? <><LoaderCircle className="is-spinning" />Відновлення {job?.percent || 0}%</> : job ? 'Продовжити відновлення' : 'Відновити відсутні записи'}</Button></section>}
      {job?.status === 'completed' && <div className="restore-validation is-valid"><CheckCircle2 /><div><strong>Відновлення завершено</strong><p>Відсутні записи повернуто. Наявні дані не перезаписувалися й не видалялися.</p></div></div>}
      <input ref={inputRef} className="import-file-input" type="file" accept="application/json,.json" onChange={(event) => void chooseFile(event.target.files?.[0])} />
      <button className="import-dropzone" type="button" onClick={() => inputRef.current?.click()} disabled={reading || previewing}><FileJson /><strong>{reading || previewing ? 'Перевіряємо копію…' : filename || 'Вибрати копію Work OS 2.0'}</strong><span>JSON до 25 МБ · спочатку лише перевірка</span></button>
      {localInspection && !localInspection.valid && <div className="restore-validation"><AlertTriangle /><div><strong>Копія не пройшла перевірку</strong><p>{localInspection.errors.length} помилок структури або зв’язків.</p></div></div>}
      {preview && <section className="restore-preview"><div className="restore-validation is-valid"><CheckCircle2 /><div><strong>Копія цілісна й належить цьому акаунту</strong><p>{preview.inspection.totalRecords} записів · контрольний код {preview.sha256.slice(0, 12)}…</p></div></div><div className="restore-comparison"><div className="restore-comparison-head"><span>Розділ</span><span>У копії</span><span>Зараз</span></div>{IMPORTANT_TABLES.map((table) => <div key={table}><span>{tableLabel(table)}</span><strong>{preview.comparison[table].backup}</strong><strong>{preview.comparison[table].current}</strong></div>)}</div>{preview.dataChanged && <p className="restore-note"><AlertTriangle />Після створення цієї копії база змінювалася. Перед відновленням буде потрібна нова контрольна копія.</p>}<p className="staged-footnote">Перевірку завершено. Наступний етап — окреме підтверджене відновлення через безпечний проміжний етап без прямого перезаписування бази.</p></section>}
      {previewing && <p className="import-loading"><LoaderCircle className="is-spinning" />Звіряємо з хмарною базою…</p>}
      {error && <p className="import-error" role="alert">{error}</p>}
      <footer className="import-actions"><Button variant="outline" type="button" onClick={close} disabled={reading || previewing || staging || restoring}>Закрити</Button>{preview && rawBackup ? <Button type="button" onClick={() => void stage()} disabled={staging || restoring}>{staging ? <><LoaderCircle className="is-spinning" />Зберігаємо…</> : 'Зберегти в безпечній зоні'}</Button> : <Button type="button" onClick={() => inputRef.current?.click()} disabled={reading || previewing || staging || restoring}>{preview ? 'Перевірити інший файл' : 'Вибрати файл'}</Button>}</footer>
    </DialogContent></Dialog>;
}

function tableLabel(table: BackupTable): string {
  return ({ chats: 'Чати', chat_profiles: 'Профілі чатів', chat_publications: 'Публікації', leads: 'Ліди', students: 'Учні', lessons: 'Уроки', daily_reports: 'Звіти', activity_events: 'Події статистики' } as Partial<Record<BackupTable, string>>)[table] || table;
}

function formatBytes(value: number): string { return value >= 1024 * 1024 ? `${(value / 1024 / 1024).toFixed(1)} МБ` : `${Math.max(1, Math.round(value / 1024))} КБ`; }

async function restoreRequest(action: 'start'|'process', importId?: string): Promise<RestoreJob> {
  const response = await fetch('/api/backups/restore/apply', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, importId }) });
  const result = await response.json() as { job?: RestoreJob | null; error?: string };
  if (!response.ok || !result.job) throw new Error(result.error || 'Не вдалося виконати етап відновлення.');
  return result.job;
}
