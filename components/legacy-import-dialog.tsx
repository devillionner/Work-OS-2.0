'use client';

import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, ArchiveRestore, CheckCircle2, FileJson, LoaderCircle, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  inspectLegacyBackup,
  LEGACY_BACKUP_MAX_BYTES,
  type LegacyBackupInspection,
  type LegacyBackupAnalysis,
  type LegacyBackupSummary,
  sha256Hex,
} from '@/lib/legacy-backup';

type PreparedBackup = {
  filename: string;
  raw: string;
  hash: string;
  inspection: LegacyBackupInspection;
};

type StagedImport = {
  id: string;
  filename: string;
  sha256: string;
  byteSize: number;
  status: string;
  createdAt: number;
  integrityOk: boolean;
  summary: LegacyBackupSummary;
  analysis: LegacyBackupAnalysis;
  syncPreview?: { added:number; matched:number; preserved:number };
};

type MigrationReconciliationRow = { expected:number; verified:number; expectedChecksum:string; actualChecksum:string; ok:boolean };
type MigrationJob = {
  id: string; importId: string; status: 'running' | 'completed' | 'failed'; phase: string;
  total: number; complete: number; percent: number; error?: string | null;
  reconciliation?: Record<string,MigrationReconciliationRow>;
};

export function LegacyImportDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [prepared, setPrepared] = useState<PreparedBackup | null>(null);
  const [reading, setReading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [staged, setStaged] = useState<StagedImport | null>(null);
  const [loadingStaged, setLoadingStaged] = useState(false);
  const [job, setJob] = useState<MigrationJob | null>(null);
  const [migrationConfirmed, setMigrationConfirmed] = useState(false);
  const [migrating, setMigrating] = useState(false);

  useEffect(() => {
    if (!open) return;
    let active = true;
    queueMicrotask(() => { if (active) setLoadingStaged(true); });
    fetch('/api/imports/legacy')
      .then(async (response) => {
        const result = (await response.json()) as { staged?: StagedImport | null; error?: string };
        if (!response.ok) throw new Error(result.error || 'Не вдалося перевірити безпечну зону.');
        if (active) setStaged(result.staged || null);
      })
      .catch((cause: unknown) => {
        if (active) setError(cause instanceof Error ? cause.message : 'Не вдалося перевірити безпечну зону.');
      })
      .finally(() => {
        if (active) setLoadingStaged(false);
      });
    fetch('/api/imports/legacy/migrate')
      .then(async (response) => {
        const result = (await response.json()) as { job?: MigrationJob | null };
        if (active && response.ok) setJob(result.job || null);
      })
      .catch(() => undefined);
    return () => { active = false; };
  }, [open]);

  const chooseFile = async (file: File | undefined) => {
    if (!file) return;
    setReading(true);
    setPrepared(null);
    setMessage('');
    setError('');
    try {
      if (file.size > LEGACY_BACKUP_MAX_BYTES) {
        throw new Error('Файл завеликий. Максимальний розмір — 10 МБ.');
      }
      const raw = await file.text();
      const inspection = inspectLegacyBackup(raw);
      const hash = await sha256Hex(raw);
      setPrepared({ filename: file.name, raw, hash, inspection });
      if (!inspection.valid) setError(inspection.errors[0] || 'Копія не пройшла перевірку.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Не вдалося прочитати файл.');
    } finally {
      setReading(false);
    }
  };

  const upload = async () => {
    if (!prepared?.inspection.valid || uploading) return;
    setUploading(true);
    setMessage('');
    setError('');
    try {
      const response = await fetch('/api/imports/legacy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filename: prepared.filename,
          rawBackup: prepared.raw,
          sha256: prepared.hash,
        }),
      });
      const result = (await response.json()) as {
        error?: string;
        duplicate?: boolean;
        staged?: StagedImport | null;
      };
      if (!response.ok) throw new Error(result.error || 'Не вдалося завантажити копію.');
      if (result.staged) {
        setStaged(result.staged);
        setJob((current) => current?.importId === result.staged?.id ? current : null);
        setMigrationConfirmed(false);
      }
      setMessage(
        result.duplicate
          ? 'Ця сама копія вже є в безпечній зоні. Дані не дубльовано.'
          : 'Копію збережено в безпечній зоні. Робочі дані ще не змінені.',
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Не вдалося завантажити копію.');
    } finally {
      setUploading(false);
    }
  };

  const summary = prepared?.inspection.summary;
  const relevantJob = job?.importId === staged?.id ? job : null;

  const migrate = async () => {
    if (!staged?.integrityOk || !staged.analysis.canProceed || !migrationConfirmed || migrating) return;
    setMigrating(true);
    setError('');
    setMessage('');
    try {
      let current = await migrationRequest('start', staged.id);
      setJob(current);
      for (let step = 0; current.status === 'running' && step < 300; step += 1) {
        current = await migrationRequest('process');
        setJob(current);
      }
      if (current.status !== 'completed') throw new Error(current.error || 'Перенос не завершився. Його можна безпечно продовжити.');
      setMessage('Work OS 2.0 синхронізовано з цією копією Prototype Checker без дублювання та автоматичного видалення.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Не вдалося завершити перенос.');
    } finally {
      setMigrating(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next && !uploading && !migrating) onClose(); }}>
      <DialogContent className="import-dialog" showCloseButton={false}>
        <DialogHeader>
          <p className="eyebrow">Безпечна синхронізація</p>
          <DialogTitle>Оновити дані з Prototype Checker</DialogTitle>
          <DialogDescription>Спочатку копія перевіряється та зберігається окремо. Робочі дані змінюються лише після явного підтвердження.</DialogDescription>
        </DialogHeader>

        <div className="import-safety-note">
          <ShieldCheck />
          <div><strong>Спочатку лише перевірка</strong><p>Нова копія зберігається окремо. Дані оновляться лише після твого підтвердження, без очищення бази.</p></div>
        </div>

        {loadingStaged && <p className="import-loading"><LoaderCircle />Перевіряємо безпечну зону…</p>}
        {staged && !loadingStaged && <StagedReview staged={staged} />}
        {staged && !loadingStaged && (
          <section className="migration-control" aria-label="Остаточний перенос">
            {relevantJob && <div className={`migration-progress ${relevantJob.status === 'completed' ? 'is-complete' : ''}`}>
              <div><strong>{relevantJob.status === 'completed' ? 'Синхронізацію завершено' : migrating ? 'Оновлюємо дані…' : 'Синхронізацію можна продовжити'}</strong><span>{relevantJob.complete} із {relevantJob.total} записів</span></div>
              <div className="migration-progress-track"><i style={{ width: `${relevantJob.percent}%` }} /></div>
              <small>{relevantJob.percent}% · етап: {migrationPhaseName(relevantJob.phase)}</small>
            </div>}
            {relevantJob && Object.keys(relevantJob.reconciliation || {}).length>0 && <div className="staged-review" aria-label="Звірка переносу">
              <div className="reconciliation-heading"><ShieldCheck/><strong>Звірка записаних даних</strong></div>
              <div className="reconciliation-list">
                {Object.entries(relevantJob.reconciliation || {}).map(([phase,row])=><div key={phase}>
                  <span>{migrationPhaseName(phase)}</span>
                  <strong className={!row.ok || row.verified !== row.expected ? 'has-issue' : ''}>{row.verified}/{row.expected} · {row.ok && row.expectedChecksum===row.actualChecksum ? 'SHA ✓' : 'помилка'}</strong>
                </div>)}
              </div>
              <p className="staged-footnote">Кожна порція звіряється за stable ID та checksum одразу після запису в D1. Завершення недоступне, якщо звірка не пройдена.</p>
            </div>}
            {relevantJob?.status !== 'completed' && <>
              <label className="migration-consent"><input type="checkbox" checked={migrationConfirmed} onChange={(event) => setMigrationConfirmed(event.target.checked)} disabled={migrating} /><span>Я перевірив підсумок. Оновлюємо Work OS 2.0 даними з цієї копії Prototype Checker без автоматичного видалення відсутніх записів.</span></label>
              <Button type="button" onClick={() => void migrate()} disabled={!migrationConfirmed || !staged.integrityOk || !staged.analysis.canProceed || migrating}>
                {migrating ? <><LoaderCircle className="is-spinning" />Оновлення {relevantJob?.percent || 0}%</> : relevantJob ? 'Продовжити синхронізацію' : 'Синхронізувати перевірені дані'}
              </Button>
            </>}
          </section>
        )}

        <ol className="import-steps">
          <li>У старому Work OS відкрий «Звіт» → «Дані й відновлення».</li>
          <li>Натисни «Завантажити повну копію».</li>
          <li>Вибери отриманий JSON-файл тут.</li>
        </ol>

        <input ref={inputRef} className="import-file-input" type="file" accept="application/json,.json" onChange={(event) => void chooseFile(event.target.files?.[0])} />
        <button className="import-dropzone" type="button" onClick={() => inputRef.current?.click()} disabled={reading || uploading}>
          <FileJson />
          <strong>{reading ? 'Перевіряємо файл…' : prepared?.filename || 'Вибрати повну JSON-копію'}</strong>
          <span>До 10 МБ · файл не імпортується автоматично</span>
        </button>

        {summary && (
          <div className="import-preview">
            <div className="import-preview-heading"><div><p className="eyebrow">Попередній перегляд</p><h3>{prepared.inspection.valid ? 'Копія готова до безпечного переносу' : 'Копія потребує уваги'}</h3></div>{prepared.inspection.valid && <CheckCircle2 />}</div>
            <div className="import-metrics">
              <span><strong>{summary.chats}</strong>чатів</span>
              <span><strong>{summary.archivedChats}</strong>в архіві</span>
              <span><strong>{summary.leads}</strong>лідів</span>
              <span><strong>{summary.lessons}</strong>уроків</span>
              <span><strong>{summary.reports}</strong>звітів</span>
              <span><strong>{summary.storageKeys}</strong>розділів</span>
            </div>
            <div className="import-platforms">
              {Object.entries(summary.platforms).map(([platform, values]) => (
                <div key={platform}><strong>{platformName(platform)}</strong><span>{values.total} чатів · {values.joined} для публікації · {values.publications} публікацій</span></div>
              ))}
            </div>
            {prepared.inspection.warnings.map((warning) => <p className="import-warning" key={warning}>{warning}</p>)}
          </div>
        )}

        {error && <p className="import-error" role="alert">{error}</p>}
        {message && <output className="import-success"><ArchiveRestore />{message}</output>}

        <footer className="import-actions">
          <Button variant="outline" type="button" onClick={onClose} disabled={uploading}>Закрити</Button>
          <Button type="button" onClick={() => void upload()} disabled={!prepared?.inspection.valid || uploading}>
            {uploading ? 'Зберігаємо…' : 'Зберегти в безпечній зоні'}
          </Button>
        </footer>
      </DialogContent>
    </Dialog>
  );
}

function platformName(value: string): string {
  return ({ telegram: 'Telegram', whatsapp: 'WhatsApp', viber: 'Viber', facebook: 'Facebook' } as Record<string, string>)[value] || value;
}

function StagedReview({ staged }: { staged: StagedImport }) {
  const checks = [
    ['Повтори серед активних чатів', staged.analysis.activeDuplicateEntries],
    ['Одночасно активні й в архіві', staged.analysis.activeArchiveOverlaps],
    ['Без назви', staged.analysis.missingNames],
    ['Без посилання', staged.analysis.missingLinks],
    ['Ліди без контакту', staged.analysis.leadsWithoutContact],
    ['Джерело ліда не знайдено', staged.analysis.leadsWithoutKnownSourceChat],
    ['Неповні записи на урок', staged.analysis.incompleteLessons],
  ] as const;
  const issueCount = checks.reduce((total, [, value]) => total + value, 0);

  return (
    <section className="staged-review" aria-label="Перевірка збереженої копії">
      <div className="staged-review-title">
        <div><p className="eyebrow">Збережена копія</p><h3>{staged.filename}</h3></div>
        <span className={staged.integrityOk ? 'is-ok' : 'is-danger'}>{staged.integrityOk ? 'Цілісна' : 'Пошкоджена'}</span>
      </div>
      <p className="staged-meta">{formatBytes(staged.byteSize)} · {new Date(staged.createdAt * 1000).toLocaleString('uk-UA')} · SHA {staged.sha256.slice(0, 10)}…</p>
      <div className="staged-totals">
        <span><strong>{staged.summary.chats}</strong> чатів</span>
        <span><strong>{staged.summary.archivedChats}</strong> в архіві</span>
        <span><strong>{staged.summary.leads}</strong> лідів</span>
        <span><strong>{staged.summary.reports}</strong> звітів</span>
      </div>
      {staged.syncPreview && <div className="sync-preview" aria-label="Зміни під час синхронізації">
        <span><strong>{staged.syncPreview.added}</strong>буде додано</span>
        <span><strong>{staged.syncPreview.matched}</strong>буде звірено й оновлено</span>
        <span><strong>{staged.syncPreview.preserved}</strong>залишиться поза копією</span>
      </div>}
      <div className="reconciliation-heading">
        {issueCount ? <AlertTriangle /> : <CheckCircle2 />}
        <strong>{issueCount ? 'Пункти для звірки перед переносом' : 'Конфліктів не знайдено'}</strong>
      </div>
      <div className="reconciliation-list">
        {checks.map(([label, value]) => <div key={label}><span>{label}</span><strong className={value ? 'has-issue' : ''}>{value}</strong></div>)}
        <div><span>Профілі чатів можна доповнити пізніше</span><strong>{staged.analysis.chatsNeedingProfile}</strong></div>
      </div>
      <p className="staged-footnote">Це лише звірка. Записи поза копією не видаляються автоматично.</p>
    </section>
  );
}

function formatBytes(value: number): string {
  return value >= 1024 * 1024
    ? `${(value / 1024 / 1024).toFixed(1)} МБ`
    : `${Math.round(value / 1024)} КБ`;
}

async function migrationRequest(action: 'start' | 'process', importId?: string): Promise<MigrationJob> {
  const response = await fetch('/api/imports/legacy/migrate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, importId }),
  });
  const result = (await response.json()) as { job?: MigrationJob | null; error?: string };
  if (!response.ok || !result.job) throw new Error(result.error || 'Не вдалося виконати етап переносу.');
  return result.job;
}

function migrationPhaseName(value: string): string {
  return ({ accounts: 'Telegram-акаунти', chats: 'чати', profiles: 'профілі', publications: 'публікації', leads: 'ліди', students: 'учні', lessons: 'уроки', curatorRequests: 'кураторські заявки', reports: 'звіти', settings: 'налаштування', events: 'статистика', done: 'готово' } as Record<string, string>)[value] || value;
}
