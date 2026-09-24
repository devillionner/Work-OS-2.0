'use client';

import { useEffect, useState } from 'react';
import { CalendarClock, TrendingUp, WalletCards } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DEFAULT_PAYMENT_RULES,
  type BonusPeriodMode,
  type PaymentRules,
  type PaymentSummary,
} from '@/lib/payments';

type ApiPayload = {
  rules: PaymentRules;
  summary: PaymentSummary;
  error?: string;
};

const BONUS_PERIODS: Array<{ value: BonusPeriodMode; label: string }> = [
  { value: 'salary', label: 'Період зарплати' },
  { value: 'monthly', label: 'Календарний місяць' },
  { value: 'weekly', label: 'Тиждень' },
];

const METRIC_LABELS = {
  leads: 'Ліди',
  bookings: 'Записи',
  lessons: 'Проведені уроки',
} as const;

export function PaymentSettings({ onSaved }: { onSaved?: () => void }) {
  const [rules, setRules] = useState<PaymentRules>(DEFAULT_PAYMENT_RULES);
  const [summary, setSummary] = useState<PaymentSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    void fetch('/api/payments', { signal: controller.signal, cache: 'no-store' })
      .then(async (response) => {
        const body = await response.json() as ApiPayload;
        if (!response.ok) throw new Error(body.error || 'Не вдалося завантажити виплати.');
        setRules(body.rules);
        setSummary(body.summary);
      })
      .catch((reason) => {
        if (!controller.signal.aborted)
          setNotice(reason instanceof Error ? reason.message : 'Не вдалося завантажити виплати.');
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, []);

  async function save() {
    setSaving(true);
    setNotice('');
    try {
      const response = await fetch('/api/payments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rules }),
      });
      const body = await response.json() as ApiPayload;
      if (!response.ok) throw new Error(body.error || 'Не вдалося зберегти правила виплат.');
      setRules(body.rules);
      setSummary(body.summary);
      setNotice('Правила виплат збережено.');
      onSaved?.();
    } catch (reason) {
      setNotice(reason instanceof Error ? reason.message : 'Не вдалося зберегти правила виплат.');
    } finally {
      setSaving(false);
    }
  }

  return <section className="settings-panel settings-panel-payment" aria-labelledby="payment-settings-title">
    <div className="settings-panel-icon"><WalletCards /></div>
    <div className="card-heading">
      <div>
        <p className="eyebrow">Виплати</p>
        <h3 id="payment-settings-title">Зарплата, бонуси та прогноз</h3>
      </div>
      <Button size="sm" onClick={() => void save()} disabled={saving || loading}>
        {saving ? 'Зберігаємо…' : 'Зберегти'}
      </Button>
    </div>

    {loading ? <p className="muted-note">Завантажуємо правила виплат…</p> : <>
      <div className="payment-config-grid">
        <label>
          <span>Період зарплати</span>
          <select
            value={rules.periodMode}
            onChange={(event) => setRules((current) => ({
              ...current,
              periodMode: event.target.value as PaymentRules['periodMode'],
            }))}
          >
            <option value="monthly">Раз на місяць</option>
            <option value="semimonthly">Двічі на місяць</option>
          </select>
        </label>
        <MoneyField
          label="Базова зарплата за період, ₴"
          cents={rules.baseSalaryCents}
          onChange={(baseSalaryCents) => setRules((current) => ({ ...current, baseSalaryCents }))}
        />
        <NumberField
          label={rules.periodMode === 'semimonthly' ? 'День виплати за 1–15' : 'День виплати після періоду'}
          value={rules.firstPayDay}
          min={1}
          max={31}
          onChange={(firstPayDay) => setRules((current) => ({ ...current, firstPayDay }))}
        />
        {rules.periodMode === 'semimonthly' && <NumberField
          label="День виплати за 16–кінець"
          value={rules.secondPayDay}
          min={1}
          max={31}
          onChange={(secondPayDay) => setRules((current) => ({ ...current, secondPayDay }))}
        />}
      </div>

      <div className="payment-rule-table">
        <div className="payment-rule-head">
          <span>Показник</span><span>Бонус</span><span>План</span><span>Період бонусу</span>
        </div>
        <MetricRule
          label="Ліди"
          cents={rules.leadBonusCents}
          target={rules.leadTarget}
          period={rules.leadBonusPeriod}
          onCents={(leadBonusCents) => setRules((current) => ({ ...current, leadBonusCents }))}
          onTarget={(leadTarget) => setRules((current) => ({ ...current, leadTarget }))}
          onPeriod={(leadBonusPeriod) => setRules((current) => ({ ...current, leadBonusPeriod }))}
        />
        <MetricRule
          label="Записи"
          cents={rules.bookingBonusCents}
          target={rules.bookingTarget}
          period={rules.bookingBonusPeriod}
          onCents={(bookingBonusCents) => setRules((current) => ({ ...current, bookingBonusCents }))}
          onTarget={(bookingTarget) => setRules((current) => ({ ...current, bookingTarget }))}
          onPeriod={(bookingBonusPeriod) => setRules((current) => ({ ...current, bookingBonusPeriod }))}
        />
        <MetricRule
          label="Проведені уроки"
          cents={rules.lessonBonusCents}
          target={rules.lessonTarget}
          period={rules.lessonBonusPeriod}
          onCents={(lessonBonusCents) => setRules((current) => ({ ...current, lessonBonusCents }))}
          onTarget={(lessonTarget) => setRules((current) => ({ ...current, lessonTarget }))}
          onPeriod={(lessonBonusPeriod) => setRules((current) => ({ ...current, lessonBonusPeriod }))}
        />
      </div>

      {summary && <PaymentForecast summary={summary} />}
    </>}

    {notice && <output className="settings-inline-notice">{notice}</output>}
    <p className="settings-panel-copy">
      Факт рахується лише з канонічних подій Work OS. Нульові ставки не додають жодних вигаданих нарахувань.
    </p>
  </section>;
}

function PaymentForecast({ summary }: { summary: PaymentSummary }) {
  return <div className="payment-forecast">
    <div className="payment-forecast-head">
      <div><CalendarClock /><span>{formatRange(summary.salaryRange.from, summary.salaryRange.to)}</span></div>
      <span>Виплата: {summary.salaryRange.payDate ? formatDate(summary.salaryRange.payDate) : '—'}</span>
    </div>
    <div className="payment-total-grid">
      <div><span>План</span><strong>{money(summary.planCents)}</strong></div>
      <div><span>Факт на сьогодні</span><strong>{money(summary.factCents)}</strong></div>
      <div><span>Прогноз</span><strong>{money(summary.forecastCents)}</strong></div>
    </div>
    <div className="payment-progress-note">
      <TrendingUp />
      <span>{summary.progress.elapsedDays} із {summary.progress.totalDays} днів поточного зарплатного періоду.</span>
    </div>
    <div className="payment-metric-grid">
      {summary.metrics.map((metric) => <div key={metric.metric}>
        <span>{METRIC_LABELS[metric.metric]}</span>
        <strong>{metric.actual} / {metric.target || '—'}</strong>
        <small>прогноз {metric.forecast} · {money(metric.actualBonusCents)} факт бонусу</small>
        <small>{formatRange(metric.range.from, metric.range.to)}</small>
      </div>)}
    </div>
  </div>;
}

function MetricRule({
  label,
  cents,
  target,
  period,
  onCents,
  onTarget,
  onPeriod,
}: {
  label: string;
  cents: number;
  target: number;
  period: BonusPeriodMode;
  onCents: (value: number) => void;
  onTarget: (value: number) => void;
  onPeriod: (value: BonusPeriodMode) => void;
}) {
  return <div className="payment-rule-row">
    <strong>{label}</strong>
    <MoneyField compact label={`Бонус за: ${label}`} cents={cents} onChange={onCents} />
    <NumberField compact label={`План: ${label}`} value={target} min={0} max={1_000_000} onChange={onTarget} />
    <label className="payment-compact-field">
      <span className="sr-only">Період бонусу: {label}</span>
      <select value={period} onChange={(event) => onPeriod(event.target.value as BonusPeriodMode)}>
        {BONUS_PERIODS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
      </select>
    </label>
  </div>;
}

function MoneyField({
  label,
  cents,
  onChange,
  compact = false,
}: {
  label: string;
  cents: number;
  onChange: (value: number) => void;
  compact?: boolean;
}) {
  return <label className={compact ? 'payment-compact-field' : undefined}>
    <span className={compact ? 'sr-only' : undefined}>{label}</span>
    <input
      type="number"
      min="0"
      step="0.01"
      inputMode="decimal"
      value={(cents / 100).toFixed(2)}
      aria-label={compact ? label : undefined}
      onChange={(event) => onChange(toCents(event.target.value))}
    />
  </label>;
}

function NumberField({
  label,
  value,
  min,
  max,
  onChange,
  compact = false,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
  compact?: boolean;
}) {
  return <label className={compact ? 'payment-compact-field' : undefined}>
    <span className={compact ? 'sr-only' : undefined}>{label}</span>
    <input
      type="number"
      min={min}
      max={max}
      step="1"
      value={value}
      aria-label={compact ? label : undefined}
      onChange={(event) => {
        const number = Number(event.target.value);
        onChange(Number.isFinite(number) ? Math.max(min, Math.min(max, Math.round(number))) : min);
      }}
    />
  </label>;
}

function toCents(value: string) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) return 0;
  return Math.min(100_000_000, Math.round(number * 100));
}

function money(cents: number) {
  return new Intl.NumberFormat('uk-UA', {
    style: 'currency',
    currency: 'UAH',
    maximumFractionDigits: cents % 100 ? 2 : 0,
  }).format(cents / 100);
}

function formatDate(value: string) {
  const [year, month, day] = value.split('-');
  return `${day}.${month}.${year}`;
}

function formatRange(from: string, to: string) {
  return `${formatDate(from)} — ${formatDate(to)}`;
}
