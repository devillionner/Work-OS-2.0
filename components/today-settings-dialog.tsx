'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

const DIRECTIONS = ['Англійська', 'Німецька', 'Польська', 'Математика', 'Шкільні предмети — комплексно', 'Логопедія та дефектологія', 'Малювання', 'ІТ та шахи'];

export function TodaySettingsDialog({ open, onClose, initialDirections, initialDailyGoal, initialMonthlyGoal, onSaved }: { open: boolean; onClose: () => void; initialDirections: string[]; initialDailyGoal: number; initialMonthlyGoal: number; onSaved: () => void }) {
  const [directions, setDirections] = useState<string[]>(initialDirections);
  const [daily, setDaily] = useState(String(initialDailyGoal));
  const [monthly, setMonthly] = useState(String(initialMonthlyGoal));
  const [saving, setSaving] = useState(false); const [error, setError] = useState('');
  useEffect(() => { if (open) { setDirections(initialDirections); setDaily(String(initialDailyGoal)); setMonthly(String(initialMonthlyGoal)); setError(''); } }, [open, initialDirections, initialDailyGoal, initialMonthlyGoal]);
  if (!open) return null;
  async function save() { setSaving(true); setError(''); try { const response = await fetch('/api/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ settings: { focus_directions: directions, daily_booking_goal: Number(daily), monthly_booking_goal: Number(monthly) } }) }); const body = await response.json() as { error?: string }; if (!response.ok) throw new Error(body.error || 'Не вдалося зберегти налаштування.'); onSaved(); onClose(); } catch (reason) { setError(reason instanceof Error ? reason.message : 'Не вдалося зберегти налаштування.'); } finally { setSaving(false); } }
  return <div className="settings-backdrop" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) onClose(); }}><section className="today-settings-dialog" role="dialog" aria-modal="true" aria-labelledby="today-settings-title"><div className="card-heading"><div><p className="eyebrow">Налаштування фокусу</p><h2 id="today-settings-title">Цілі та напрямки</h2></div><button className="import-close" type="button" aria-label="Закрити" onClick={onClose}>×</button></div><div className="today-settings-fields"><label>Ціль записів на день<Input type="number" min="0" max="100000" value={daily} onChange={(event) => setDaily(event.target.value)} /></label><label>Ціль записів на місяць<Input type="number" min="0" max="100000" value={monthly} onChange={(event) => setMonthly(event.target.value)} /></label></div><fieldset><legend>Фокус напрямків</legend><div className="direction-checks">{DIRECTIONS.map((direction) => <label key={direction}><input type="checkbox" checked={directions.includes(direction)} onChange={(event) => setDirections((current) => event.target.checked ? [...current, direction] : current.filter((item) => item !== direction))} />{direction}</label>)}</div></fieldset>{error && <p className="workspace-error">{error}</p>}<div className="dialog-actions"><Button variant="outline" onClick={onClose}>Скасувати</Button><Button onClick={() => void save()} disabled={saving}>{saving ? 'Зберігаємо…' : 'Зберегти'}</Button></div></section></div>;
}
