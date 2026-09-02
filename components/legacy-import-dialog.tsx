'use client';

import { useRef, useState } from 'react';
import { ArchiveRestore, CheckCircle2, FileJson, ShieldCheck, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  inspectLegacyBackup,
  LEGACY_BACKUP_MAX_BYTES,
  type LegacyBackupInspection,
  sha256Hex,
} from '@/lib/legacy-backup';

type PreparedBackup = {
  filename: string;
  raw: string;
  hash: string;
  inspection: LegacyBackupInspection;
};

export function LegacyImportDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose(): void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [prepared, setPrepared] = useState<PreparedBackup | null>(null);
  const [reading, setReading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  if (!open) return null;

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
      };
      if (!response.ok) throw new Error(result.error || 'Не вдалося завантажити копію.');
      setMessage(
        result.duplicate
          ? 'Ця сама копія вже є у staging-зоні. Дані не дубльовано.'
          : 'Копію безпечно збережено у staging-зоні. Робочі дані ще не змінені.',
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Не вдалося завантажити копію.');
    } finally {
      setUploading(false);
    }
  };

  const summary = prepared?.inspection.summary;

  return (
    <div className="import-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget && !uploading) onClose();
    }}>
      <section className="import-dialog" role="dialog" aria-modal="true" aria-labelledby="legacy-import-title">
        <header className="import-dialog-header">
          <div>
            <p className="eyebrow">Безпечна міграція</p>
            <h2 id="legacy-import-title">Підготувати імпорт старої бази</h2>
          </div>
          <button className="import-close" type="button" aria-label="Закрити" onClick={onClose} disabled={uploading}><X /></button>
        </header>

        <div className="import-safety-note">
          <ShieldCheck />
          <div><strong>Спочатку лише перевірка</strong><p>Файл зберігається окремо. Чати, ліди та статистика не зміняться без наступного підтвердження.</p></div>
        </div>

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
            <div className="import-preview-heading"><div><p className="eyebrow">Попередній перегляд</p><h3>{prepared.inspection.valid ? 'Копія готова до staging' : 'Копія потребує уваги'}</h3></div>{prepared.inspection.valid && <CheckCircle2 />}</div>
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
        {message && <p className="import-success" role="status"><ArchiveRestore />{message}</p>}

        <footer className="import-actions">
          <Button variant="outline" type="button" onClick={onClose} disabled={uploading}>Закрити</Button>
          <Button type="button" onClick={() => void upload()} disabled={!prepared?.inspection.valid || uploading}>
            {uploading ? 'Зберігаємо…' : 'Зберегти у staging-зоні'}
          </Button>
        </footer>
      </section>
    </div>
  );
}

function platformName(value: string): string {
  return ({ telegram: 'Telegram', whatsapp: 'WhatsApp', viber: 'Viber', facebook: 'Facebook' } as Record<string, string>)[value] || value;
}
