'use client';

import { useRef, useState } from 'react';
import { Download, Upload } from 'lucide-react';
import { Panel } from '@/components/shell/panel';
import { Button } from '@/components/ui/button';
import { humanError } from '@/components/ui/human-error';

type Platform = 'telegram' | 'whatsapp' | 'viber' | 'facebook';
type Preview = { revision: number; total: number; add: number; existing: number; conflicts: string[]; byPlatform: Record<Platform, { total: number; add: number; existing: number }> };
const LABELS: Record<Platform, string> = { telegram: 'Telegram', whatsapp: 'WhatsApp', viber: 'Viber', facebook: 'Facebook' };

/** CSV-експорт і перевірений імпорт чатів. */
export function CsvPanel({ open, onClose, onImported }: { open: boolean; onClose: () => void; onImported: () => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [csv, setCsv] = useState('');
  const [fileName, setFileName] = useState('');
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  function resetImport() { setCsv(''); setFileName(''); setPreview(null); setError(''); setNotice(''); if (inputRef.current) inputRef.current.value = ''; }
  function close() { if (busy) return; resetImport(); onClose(); }
  async function choose(file: File | null) {
    resetImport(); if (!file) return;
    setFileName(file.name);
    try { setCsv(await file.text()); } catch { setError('Не вдалося прочитати CSV-файл.'); }
  }
  async function request(mode: 'preview' | 'apply') {
    if (!csv) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const suffix = mode === 'apply' && preview ? `&revision=${encodeURIComponent(String(preview.revision))}` : '';
      const response = await fetch(`/api/chats/csv?mode=${mode}${suffix}`, { method: 'POST', headers: { 'Content-Type': 'text/csv; charset=utf-8' }, body: csv });
      const body = await response.json() as Preview & { error?: string; inserted?: number };
      if (!response.ok) throw new Error(body.error || 'Не вдалося обробити CSV.');
      if (mode === 'preview') { setPreview(body); return; }
      setNotice(`Імпорт завершено: додано ${body.inserted || 0} чатів.`); setPreview(null); onImported();
    } catch (reason) { setError(humanError(reason, 'Не вдалося обробити CSV.')); if (mode === 'apply') setPreview(null); }
    finally { setBusy(false); }
  }
  async function download() {
    setBusy(true); setError(''); setNotice('');
    try {
      const response = await fetch('/api/chats/csv', { cache: 'no-store' });
      if (!response.ok) { const body = await response.json() as { error?: string }; throw new Error(body.error || 'Не вдалося експортувати CSV.'); }
      const blob = await response.blob();
      const match = /filename="([^"]+)"/.exec(response.headers.get('content-disposition') || '');
      const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = match?.[1] || 'work-os-chats.csv'; document.body.appendChild(link); link.click(); link.remove(); URL.revokeObjectURL(url);
      setNotice('CSV експортовано.');
    } catch (reason) { setError(humanError(reason, 'Не вдалося експортувати CSV.')); }
    finally { setBusy(false); }
  }

  return (
    <Panel open={open} onOpenChange={(next) => { if (!next) close(); }} title="CSV імпорт та експорт" subtitle="CSV переносить поточний стан і профілі чатів. Повна історія подій переноситься лише через резервну копію.">
      <div className="flex flex-col gap-5">
        {error ? <p role="alert" className="m-0 text-sm text-hot">{error}</p> : null}
        {notice ? <output className="block text-sm text-ok">{notice}</output> : null}
        <section className="flex flex-col gap-3 rounded-inner border border-line bg-sunken p-4">
          <div><h3 className="m-0 text-[15px] font-medium">Експорт</h3><p className="m-0 mt-1 text-xs text-ink-2">Зберегти Telegram, WhatsApp, Viber і Facebook разом зі станами, датами та профілями.</p></div>
          <Button variant="outline" busy={busy} className="self-start" onClick={() => void download()}><Download aria-hidden="true" strokeWidth={1.5} />Експортувати CSV</Button>
        </section>
        <section className="flex flex-col gap-3 rounded-inner border border-line bg-sunken p-4">
          <div><h3 className="m-0 text-[15px] font-medium">Імпорт</h3><p className="m-0 mt-1 text-xs text-ink-2">Посилання, які вже є в Work OS, не перезаписуються. Спочатку обов’язкова перевірка даних.</p></div>
          <input ref={inputRef} type="file" accept=".csv,text/csv" disabled={busy} aria-label="CSV чатів" className="text-sm file:mr-3 file:h-9 file:rounded-full file:border file:border-line-strong file:bg-transparent file:px-4 file:text-[13px] file:text-ink" onChange={(event) => void choose(event.target.files?.[0] || null)} />
          {fileName ? <p className="m-0 text-xs text-ink-2">Обрано: {fileName}</p> : null}
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" disabled={busy || !csv} onClick={() => void request('preview')}><Upload aria-hidden="true" strokeWidth={1.5} />Перевірити CSV</Button>
            {preview ? <Button variant="action" busy={busy} disabled={preview.add === 0 || preview.conflicts.length > 0} onClick={() => void request('apply')}>{busy ? 'Імпортуємо…' : `Імпортувати ${preview.add}`}</Button> : null}
          </div>
        </section>
        {preview ? (
          <section className="flex flex-col gap-3 rounded-inner border border-line p-4">
            <div className="flex items-start justify-between gap-3">
              <div><h3 className="m-0 text-[15px] font-medium">Попередній перегляд</h3><p className="m-0 mt-1 text-xs text-ink-2">{preview.total} рядків · нових {preview.add} · вже існують {preview.existing}</p></div>
              <span className={`text-xs ${preview.conflicts.length ? 'text-hot' : 'text-ok'}`}>{preview.conflicts.length ? `${preview.conflicts.length} конфліктів` : 'Готово до імпорту'}</span>
            </div>
            <dl className="m-0 grid grid-cols-4 gap-2 text-center">
              {(Object.keys(LABELS) as Platform[]).map((platform) => <div key={platform}><dt className="text-[11px] text-ink-2">{LABELS[platform]}</dt><dd className="m-0 font-mono text-lg">{preview.byPlatform[platform].add}</dd><dd className="m-0 text-[11px] text-ink-3">із {preview.byPlatform[platform].total}</dd></div>)}
            </dl>
            {preview.conflicts.length > 0 ? (
              <div role="alert" className="text-sm text-hot"><strong className="font-medium">Спочатку виправ конфлікти:</strong>
                <ul className="m-0 mt-1 list-disc pl-5">{preview.conflicts.slice(0, 20).map((item) => <li key={item}>{item}</li>)}</ul>
                {preview.conflicts.length > 20 ? <p className="m-0">Ще {preview.conflicts.length - 20} конфліктів.</p> : null}
              </div>
            ) : null}
          </section>
        ) : null}
      </div>
    </Panel>
  );
}
