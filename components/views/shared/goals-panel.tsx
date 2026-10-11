'use client';

import { useState } from 'react';
import { Panel } from '@/components/shell/panel';
import { useShell } from '@/components/shell/shell-context';
import { Button } from '@/components/ui/button';
import { Chip } from '@/components/ui/chip';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { useToast } from '@/components/ui/toast';
import { FOCUS_DIRECTIONS } from '@/lib/directions';
import { humanError } from '@/components/ui/human-error';

/** Цілі записів, цільова конверсія воронки й напрямки фокусу. Відкривається з «Сьогодні» і з «Налаштування». */
export function GoalsPanel({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <Panel open={open} onOpenChange={onOpenChange} title="Цілі й напрямки" subtitle="Денна й місячна ціль записів, цільова конверсія та напрямки фокусу.">
      <GoalsForm onClose={() => onOpenChange(false)} />
    </Panel>
  );
}

function GoalsForm({ onClose }: { onClose: () => void }) {
  const { snapshot, refreshSnapshot } = useShell();
  const toast = useToast();
  const [saving, setSaving] = useState(false);
  const [directions, setDirections] = useState<string[]>(snapshot.focusDirections);
  const [daily, setDaily] = useState(String(snapshot.bookingGoal.target));
  const [monthly, setMonthly] = useState(String(snapshot.monthlyBookingGoal));
  const [rates, setRates] = useState({
    publicationRate: String(snapshot.funnelTargets.publicationRate),
    responseRate: String(snapshot.funnelTargets.responseRate),
    bookingRate: String(snapshot.funnelTargets.bookingRate),
    completionRate: String(snapshot.funnelTargets.completionRate),
  });
  const [error, setError] = useState('');

  async function save() {
    setSaving(true);
    setError('');
    try {
      const response = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          settings: {
            focus_directions: directions,
            daily_booking_goal: Number(daily),
            monthly_booking_goal: Number(monthly),
            target_publication_rate: Number(rates.publicationRate),
            target_response_rate: Number(rates.responseRate),
            target_booking_rate: Number(rates.bookingRate),
            target_completion_rate: Number(rates.completionRate),
          },
        }),
      });
      const body = await response.json() as { error?: string };
      if (!response.ok) throw new Error(body.error || 'Не вдалося зберегти цілі.');
      refreshSnapshot();
      toast.push({ message: 'Цілі збережено.' });
      onClose();
    } catch (reason) {
      setError(humanError(reason, 'Не вдалося зберегти цілі.'));
    } finally {
      setSaving(false);
    }
  }

  const toggle = (direction: string) => setDirections((current) => (current.includes(direction) ? current.filter((item) => item !== direction) : [...current, direction]));
  const rate = (key: keyof typeof rates, label: string) => (
    <Field label={label} htmlFor={`rate-${key}`}>
      <Input id={`rate-${key}`} type="number" inputMode="numeric" min={0} max={100} value={rates[key]} onChange={(event) => setRates({ ...rates, [key]: event.target.value })} />
    </Field>
  );

  return (
    <div className="flex flex-col gap-7">
      <fieldset className="m-0 flex flex-col gap-3 border-0 p-0">
        <legend className="mb-3 p-0 text-[15px] font-medium">Цілі записів</legend>
        <div className="grid grid-cols-2 gap-3">
          <Field label="На день" htmlFor="goal-daily"><Input id="goal-daily" type="number" inputMode="numeric" min={0} max={100000} value={daily} onChange={(event) => setDaily(event.target.value)} /></Field>
          <Field label="На місяць" htmlFor="goal-monthly"><Input id="goal-monthly" type="number" inputMode="numeric" min={0} max={100000} value={monthly} onChange={(event) => setMonthly(event.target.value)} /></Field>
        </div>
      </fieldset>

      <fieldset className="m-0 flex flex-col gap-3 border-0 p-0">
        <legend className="mb-3 p-0 text-[15px] font-medium">Цільова конверсія воронки, %</legend>
        <div className="grid grid-cols-2 gap-3">
          {rate('publicationRate', 'Публікація / приєднання')}
          {rate('responseRate', 'Відгук / публікація')}
          {rate('bookingRate', 'Запис / відгук')}
          {rate('completionRate', 'Проведено / запис')}
        </div>
        <p className="m-0 text-xs text-ink-2">0% означає, що ціль для цього етапу ще не задана.</p>
      </fieldset>

      <fieldset className="m-0 flex flex-col gap-3 border-0 p-0">
        <legend className="mb-3 p-0 text-[15px] font-medium">Напрямки фокусу</legend>
        <div className="flex flex-wrap gap-2">
          {FOCUS_DIRECTIONS.map((direction) => <Chip key={direction} pressed={directions.includes(direction)} onClick={() => toggle(direction)}>{direction}</Chip>)}
        </div>
      </fieldset>

      {error ? <p role="alert" className="m-0 text-sm text-hot">{error}</p> : null}
      <div className="flex justify-end gap-2">
        <Button variant="ghost" disabled={saving} onClick={onClose}>Скасувати</Button>
        <Button variant="action" busy={saving} onClick={() => void save()}>{saving ? 'Зберігаємо…' : 'Зберегти'}</Button>
      </div>
    </div>
  );
}
