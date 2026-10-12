'use client';

import { useState } from 'react';
import { useShell } from '@/components/shell/shell-context';
import { Button } from '@/components/ui/button';
import { Ghost } from '@/components/ui/ghost';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { useToast } from '@/components/ui/toast';
import { useRemote } from '@/components/views/shared/use-remote';
import { DEFAULT_PAYMENT_RULES, type BonusPeriodMode, type PaymentRules, type PaymentSummary } from '@/lib/payments';
import { Block, Group, Row } from './ui';
import { humanError } from '@/components/ui/human-error';

type Payload = { rules: PaymentRules; summary: PaymentSummary; error?: string };

const BONUS_PERIODS: ReadonlyArray<{ value: BonusPeriodMode; label: string }> = [
  { value: 'salary', label: 'Період зарплати' },
  { value: 'monthly', label: 'Календарний місяць' },
  { value: 'weekly', label: 'Тиждень' },
];
const METRIC_LABELS = { leads: 'Ліди', bookings: 'Записи', lessons: 'Проведені уроки' } as const;

const toCents = (value: string) => {
  const number = Number(value);
  return !Number.isFinite(number) || number < 0 ? 0 : Math.min(100_000_000, Math.round(number * 100));
};
const money = (cents: number) => new Intl.NumberFormat('uk-UA', { style: 'currency', currency: 'UAH', maximumFractionDigits: cents % 100 ? 2 : 0 }).format(cents / 100);
const formatDate = (value: string) => { const [year, month, day] = value.split('-'); return `${day}.${month}.${year}`; };
const formatRange = (from: string, to: string) => `${formatDate(from)} — ${formatDate(to)}`;

function Money({ label, cents, onChange }: { label: string; cents: number; onChange: (value: number) => void }) {
  return <Input type="number" min="0" step="0.01" inputMode="decimal" aria-label={label} value={(cents / 100).toFixed(2)} onChange={(event) => onChange(toCents(event.target.value))} className="h-9 w-[120px] text-right font-mono" />;
}

function Whole({ label, value, min, max, onChange }: { label: string; value: number; min: number; max: number; onChange: (value: number) => void }) {
  return (
    <Input type="number" min={min} max={max} step="1" aria-label={label} value={value} className="h-9 w-[96px] text-right font-mono" onChange={(event) => {
      const number = Number(event.target.value);
      onChange(Number.isFinite(number) ? Math.max(min, Math.min(max, Math.round(number))) : min);
    }} />
  );
}

/** Виплати: правила зарплати й бонусів та прогноз. Факт рахується лише з канонічних подій Work OS. */
export function PaymentsGroup() {
  const { refreshSnapshot } = useShell();
  const toast = useToast();
  const [attempt, setAttempt] = useState(0);
  const [draft, setDraft] = useState<PaymentRules | null>(null);
  const [saved, setSaved] = useState<Payload | null>(null);
  const [saving, setSaving] = useState(false);
  const remote = useRemote<Payload>('/api/payments', { refresh: attempt, fallback: 'Не вдалося завантажити виплати.' });
  const data = saved ?? remote.data;
  const rules = draft ?? data?.rules ?? DEFAULT_PAYMENT_RULES;
  const dirty = draft !== null && data !== null && JSON.stringify(draft) !== JSON.stringify(data.rules);
  const patch = (next: Partial<PaymentRules>) => setDraft({ ...rules, ...next });

  const save = async () => {
    setSaving(true);
    try {
      const response = await fetch('/api/payments', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ rules }) });
      const body = await response.json().catch(() => ({})) as Payload;
      if (!response.ok) throw new Error(body.error || 'Не вдалося зберегти правила виплат.');
      setSaved(body);
      setDraft(null);
      toast.push({ message: 'Правила виплат збережено.', tone: 'ok' });
      refreshSnapshot();
    } catch (reason) {
      toast.push({ message: humanError(reason, 'Не вдалося зберегти правила виплат.'), tone: 'hot' });
    } finally {
      setSaving(false);
    }
  };

  const metric = (label: string, bonus: keyof PaymentRules, target: keyof PaymentRules, period: keyof PaymentRules) => (
    <Row label={label}>
      <Money label={`Бонус за: ${label}, ₴`} cents={rules[bonus] as number} onChange={(value) => patch({ [bonus]: value })} />
      <Whole label={`План: ${label}`} value={rules[target] as number} min={0} max={1_000_000} onChange={(value) => patch({ [target]: value })} />
      <Select aria-label={`Період бонусу: ${label}`} value={rules[period] as string} onChange={(event) => patch({ [period]: event.target.value })} className="h-9" wrapperClassName="w-[188px]">
        {BONUS_PERIODS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
      </Select>
    </Row>
  );

  const summary = data?.summary;
  return (
    <Group
      id="payments"
      title="Оплати"
      hint="Факт рахується з подій Work OS. Нульові ставки нічого не додають."
      aside={<Button variant="action" size="sm" busy={saving} disabled={!dirty} onClick={() => void save()}>{saving ? 'Зберігаємо…' : 'Зберегти'}</Button>}
    >
      {remote.error && !data ? (
        <Block className="flex flex-col items-start gap-3">
          <p role="alert" className="m-0 text-sm text-hot">{remote.error}</p>
          <Button variant="outline" size="sm" onClick={() => setAttempt((value) => value + 1)}>Спробувати ще раз</Button>
        </Block>
      ) : !data ? (
        <Block className="flex flex-col gap-3"><Ghost className="h-9 rounded-full" /><Ghost className="h-9 rounded-full" /><Ghost className="h-24 rounded-inner" /></Block>
      ) : (
        <>
          <Row label="Період зарплати">
            <Select aria-label="Період зарплати" value={rules.periodMode} onChange={(event) => patch({ periodMode: event.target.value as PaymentRules['periodMode'] })} className="h-9" wrapperClassName="w-[188px]">
              <option value="monthly">Раз на місяць</option>
              <option value="semimonthly">Двічі на місяць</option>
            </Select>
          </Row>
          <Row label="Базова зарплата за період, ₴"><Money label="Базова зарплата за період, ₴" cents={rules.baseSalaryCents} onChange={(value) => patch({ baseSalaryCents: value })} /></Row>
          <Row label={rules.periodMode === 'semimonthly' ? 'День виплати за 1–15' : 'День виплати після періоду'}><Whole label="День виплати" value={rules.firstPayDay} min={1} max={31} onChange={(value) => patch({ firstPayDay: value })} /></Row>
          {rules.periodMode === 'semimonthly' ? <Row label="День виплати за 16–кінець"><Whole label="День виплати за 16–кінець" value={rules.secondPayDay} min={1} max={31} onChange={(value) => patch({ secondPayDay: value })} /></Row> : null}
          <li className="grid grid-cols-1 gap-1 border-t border-line px-5 pb-1 pt-3 text-xs font-medium text-ink-2" aria-hidden="true"><span>Бонуси: ставка за одиницю, план і період</span></li>
          {metric('Ліди', 'leadBonusCents', 'leadTarget', 'leadBonusPeriod')}
          {metric('Записи', 'bookingBonusCents', 'bookingTarget', 'bookingBonusPeriod')}
          {metric('Проведені уроки', 'lessonBonusCents', 'lessonTarget', 'lessonBonusPeriod')}
          {summary ? (
            <Block className="flex flex-col gap-4">
              <div className="flex flex-wrap items-baseline justify-between gap-2 text-[13px] text-ink-2">
                <span className="font-mono text-ink">{formatRange(summary.salaryRange.from, summary.salaryRange.to)}</span>
                <span>Виплата: <span className="font-mono">{summary.salaryRange.payDate ? formatDate(summary.salaryRange.payDate) : '—'}</span></span>
              </div>
              <dl className="m-0 grid grid-cols-3 gap-3">
                <div><dt className="text-xs text-ink-2">План</dt><dd className="m-0 font-mono text-[20px] tracking-[-0.02em]">{money(summary.planCents)}</dd></div>
                <div><dt className="text-xs text-ink-2">Факт на сьогодні</dt><dd className="m-0 font-mono text-[20px] tracking-[-0.02em]">{money(summary.factCents)}</dd></div>
                <div><dt className="text-xs text-ink-2">Прогноз</dt><dd className="m-0 font-mono text-[20px] tracking-[-0.02em]">{money(summary.forecastCents)}</dd></div>
              </dl>
              <p className="m-0 text-xs text-ink-2">{summary.progress.elapsedDays} із {summary.progress.totalDays} днів поточного зарплатного періоду.</p>
              <ul className="m-0 grid list-none grid-cols-1 gap-3 p-0 @2xl:grid-cols-3">
                {summary.metrics.map((item) => (
                  <li key={item.metric} className="rounded-inner border border-line p-3">
                    <p className="m-0 text-xs text-ink-2">{METRIC_LABELS[item.metric]}</p>
                    <p className="m-0 font-mono text-[17px]">{item.actual} / {item.target || '—'}</p>
                    <p className="m-0 text-xs text-ink-2">прогноз {item.forecast} · бонус {money(item.actualBonusCents)}</p>
                    <p className="m-0 font-mono text-xs text-ink-2">{formatRange(item.range.from, item.range.to)}</p>
                  </li>
                ))}
              </ul>
            </Block>
          ) : null}
        </>
      )}
    </Group>
  );
}
