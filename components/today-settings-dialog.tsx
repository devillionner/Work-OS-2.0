'use client';

import { useState } from 'react';
import { Target, TrendingUp, Compass, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { FOCUS_DIRECTIONS } from '@/lib/directions';

type TodaySettingsDialogProps = {
  open: boolean;
  onClose: () => void;
  initialDirections: string[];
  initialDailyGoal: number;
  initialMonthlyGoal: number;
  initialFunnelTargets: {
    publicationRate: number;
    responseRate: number;
    bookingRate: number;
    completionRate: number;
  };
  onSaved: () => void;
};

export function TodaySettingsDialog({
  open,
  onClose,
  initialDirections,
  initialDailyGoal,
  initialMonthlyGoal,
  initialFunnelTargets,
  onSaved,
}: TodaySettingsDialogProps) {
  const [saving, setSaving] = useState(false);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && !saving) onClose();
      }}
    >
      <DialogContent className="today-settings-dialog" showCloseButton={false}>
        <DialogHeader>
          <p className="eyebrow">Налаштування фокусу</p>
          <DialogTitle>Цілі та напрямки</DialogTitle>
          <DialogDescription>
            Налаштуй денну й місячну ціль та напрямки, які мають бути у фокусі Today.
          </DialogDescription>
        </DialogHeader>

        {open && (
          <TodaySettingsForm
            initialDirections={initialDirections}
            initialDailyGoal={initialDailyGoal}
            initialMonthlyGoal={initialMonthlyGoal}
            initialFunnelTargets={initialFunnelTargets}
            onClose={onClose}
            onSaved={onSaved}
            saving={saving}
            setSaving={setSaving}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function TodaySettingsForm({
  initialDirections,
  initialDailyGoal,
  initialMonthlyGoal,
  initialFunnelTargets,
  onClose,
  onSaved,
  saving,
  setSaving,
}: {
  initialDirections: string[];
  initialDailyGoal: number;
  initialMonthlyGoal: number;
  initialFunnelTargets: TodaySettingsDialogProps['initialFunnelTargets'];
  onClose: () => void;
  onSaved: () => void;
  saving: boolean;
  setSaving: (value: boolean) => void;
}) {
  const [directions, setDirections] = useState<string[]>(initialDirections);
  const [daily, setDaily] = useState(String(initialDailyGoal));
  const [monthly, setMonthly] = useState(String(initialMonthlyGoal));
  const [rates, setRates] = useState(() => ({
    publicationRate: String(initialFunnelTargets.publicationRate),
    responseRate: String(initialFunnelTargets.responseRate),
    bookingRate: String(initialFunnelTargets.bookingRate),
    completionRate: String(initialFunnelTargets.completionRate),
  }));
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
      const body = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(body.error || 'Не вдалося зберегти налаштування.');
      onSaved();
      onClose();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Не вдалося зберегти налаштування.');
    } finally {
      setSaving(false);
    }
  }

  const toggleDirection = (direction: string) => {
    setDirections((current) =>
      current.includes(direction) ? current.filter((item) => item !== direction) : [...current, direction]
    );
  };

  return (
    <>
      <div className="today-settings-section">
        <div className="settings-section-header">
          <Target className="settings-section-icon" />
          <h3>Цілі записів</h3>
        </div>
        <div className="today-settings-fields">
          <label>
            <span>Ціль записів на день</span>
            <Input
              type="number"
              min="0"
              max="100000"
              value={daily}
              onChange={(event) => setDaily(event.target.value)}
              placeholder="0"
            />
          </label>
          <label>
            <span>Ціль записів на місяць</span>
            <Input
              type="number"
              min="0"
              max="100000"
              value={monthly}
              onChange={(event) => setMonthly(event.target.value)}
              placeholder="0"
            />
          </label>
        </div>
      </div>

      <fieldset className="today-settings-fieldset">
        <legend className="settings-section-header">
          <TrendingUp className="settings-section-icon" />
          <span>Цільова конверсія воронки, %</span>
        </legend>
        <div className="today-settings-fields">
          <label>
            <span>Публікація / приєднання</span>
            <Input
              type="number"
              min="0"
              max="100"
              value={rates.publicationRate}
              onChange={(event) => setRates({ ...rates, publicationRate: event.target.value })}
              placeholder="0"
            />
          </label>
          <label>
            <span>Відгук / публікація</span>
            <Input
              type="number"
              min="0"
              max="100"
              value={rates.responseRate}
              onChange={(event) => setRates({ ...rates, responseRate: event.target.value })}
              placeholder="0"
            />
          </label>
          <label>
            <span>Запис / відгук</span>
            <Input
              type="number"
              min="0"
              max="100"
              value={rates.bookingRate}
              onChange={(event) => setRates({ ...rates, bookingRate: event.target.value })}
              placeholder="0"
            />
          </label>
          <label>
            <span>Проведено / запис</span>
            <Input
              type="number"
              min="0"
              max="100"
              value={rates.completionRate}
              onChange={(event) => setRates({ ...rates, completionRate: event.target.value })}
              placeholder="0"
            />
          </label>
        </div>
        <p className="muted-note">0% означає, що ціль для цього етапу поки не задана.</p>
      </fieldset>

      <fieldset className="today-settings-fieldset">
        <legend className="settings-section-header">
          <Compass className="settings-section-icon" />
          <span>Фокус напрямків</span>
        </legend>
        <div className="direction-checks">
          {FOCUS_DIRECTIONS.map((direction) => {
            const checked = directions.includes(direction);
            return (
              <label key={direction} className={checked ? 'is-selected' : undefined}>
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => toggleDirection(direction)}
                />
                <span className="direction-check-box" aria-hidden="true">
                  {checked && <Check className="direction-check-icon" />}
                </span>
                <span className="direction-label">{direction}</span>
              </label>
            );
          })}
        </div>
      </fieldset>

      {error && <p className="workspace-error" role="alert">{error}</p>}

      <div className="dialog-actions">
        <Button variant="outline" onClick={onClose} disabled={saving}>
          Скасувати
        </Button>
        <Button onClick={() => void save()} disabled={saving}>
          {saving ? 'Зберігаємо…' : 'Зберегти'}
        </Button>
      </div>
    </>
  );
}
