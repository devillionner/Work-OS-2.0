'use client';

import { useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, FileJson, LoaderCircle, ShieldCheck, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { BACKUP_TABLES, type BackupTable } from '@/lib/backups/export';
import { CLOUD_BACKUP_MAX_BYTES, inspectCloudBackup, type CloudBackupInspection } from '@/lib/backups/inspect';

type Preview = {
  sha256: string;
  inspection: CloudBackupInspection;
  currentRevision: number;
  dataChanged: boolean;
  comparison: Record<BackupTable, { backup: number; current: number; difference: number }>;
};

const IMPORTANT_TABLES: BackupTable[] = ['chats', 'chat_profiles', 'chat_publications', 'leads', 'students', 'lessons', 'daily_reports', 'activity_events'];

export function CloudRestoreDialog({ open, onClose }: { open: boolean; onClose(): void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [filename, setFilename] = useState('');
  const [reading, setReading] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [localInspection, setLocalInspection] = useState<CloudBackupInspection | null>(null);
  const [error, setError] = useState('');

  if (!open) return null;

  async function chooseFile(file?: File) {
    if (!file) return;
    setFilename(file.name); setReading(true); setPreview(null); setError(''); setLocalInspection(null);
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
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Не вдалося перевірити файл.');
    } finally { setReading(false); setPreviewing(false); }
  }

  const close = () => { if (!reading && !previewing) onClose(); };
  return <div className="import-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) close(); }}>
    <section className="import-dialog restore-dialog" role="dialog" aria-modal="true" aria-labelledby="restore-title">
      <header className="import-dialog-header"><div><p className="eyebrow">Контрольоване відновлення</p><h2 id="restore-title">Перевірити резервну копію</h2></div><button className="import-close" type="button" aria-label="Закрити" onClick={close} disabled={reading || previewing}><X /></button></header>
      <div className="import-safety-note"><ShieldCheck /><div><strong>Поточні дані не змінюються</strong><p>Файл перевіряється локально та звіряється з D1 тільки на читання. Відновлення не запускається автоматично.</p></div></div>
      <input ref={inputRef} className="import-file-input" type="file" accept="application/json,.json" onChange={(event) => void chooseFile(event.target.files?.[0])} />
      <button className="import-dropzone" type="button" onClick={() => inputRef.current?.click()} disabled={reading || previewing}><FileJson /><strong>{reading || previewing ? 'Перевіряємо копію…' : filename || 'Вибрати копію Work OS 2.0'}</strong><span>JSON до 25 МБ · без запису в базу</span></button>
      {localInspection && !localInspection.valid && <div className="restore-validation"><AlertTriangle /><div><strong>Копія не пройшла перевірку</strong><p>{localInspection.errors.length} помилок структури або зв’язків.</p></div></div>}
      {preview && <section className="restore-preview"><div className="restore-validation is-valid"><CheckCircle2 /><div><strong>Копія цілісна й належить цьому акаунту</strong><p>{preview.inspection.totalRecords} записів · SHA {preview.sha256.slice(0, 12)}…</p></div></div><div className="restore-comparison"><div className="restore-comparison-head"><span>Розділ</span><span>У копії</span><span>Зараз</span></div>{IMPORTANT_TABLES.map((table) => <div key={table}><span>{tableLabel(table)}</span><strong>{preview.comparison[table].backup}</strong><strong>{preview.comparison[table].current}</strong></div>)}</div>{preview.dataChanged && <p className="restore-note"><AlertTriangle />Після створення цієї копії база змінювалася. Перед відновленням буде потрібна нова контрольна копія.</p>}<p className="staged-footnote">Перевірку завершено. Наступний етап — окреме підтверджене відновлення через staging без прямого перезаписування бази.</p></section>}
      {previewing && <p className="import-loading"><LoaderCircle className="is-spinning" />Звіряємо з хмарною базою…</p>}
      {error && <p className="import-error" role="alert">{error}</p>}
      <footer className="import-actions"><Button variant="outline" type="button" onClick={close} disabled={reading || previewing}>Закрити</Button><Button type="button" onClick={() => inputRef.current?.click()} disabled={reading || previewing}>{preview ? 'Перевірити інший файл' : 'Вибрати файл'}</Button></footer>
    </section>
  </div>;
}

function tableLabel(table: BackupTable): string {
  return ({ chats: 'Чати', chat_profiles: 'Профілі чатів', chat_publications: 'Публікації', leads: 'Ліди', students: 'Учні', lessons: 'Уроки', daily_reports: 'Звіти', activity_events: 'Події статистики' } as Partial<Record<BackupTable, string>>)[table] || table;
}
