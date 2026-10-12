'use client';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Hint } from '@/components/ui/hint';
import { Textarea } from '@/components/ui/input';
import { Surface } from '@/components/ui/surface';
import { Checkbox } from '@/components/ui/toggle';
import { calendarContextLabels } from '@/lib/reports/calendar-labels';
import type { CalendarDayContext } from '@/lib/reports/calendar-context';
import { hasFormLine, replaceGoalLines, setFormLine } from './goal-lines';
import { formatDate, formatDateLong, formatStamp, type ReportData } from './types';

function Status({ report }: { report: ReportData['selected'] }) {
  if (!report) return <span className="text-xs font-medium text-ink-2">Немає звіту</span>;
  if (report.stale) return <Badge tone="warn">Потребує оновлення</Badge>;
  if (report.submittedAt) return <Badge tone="ok">Здано</Badge>;
  return <span className="text-xs font-medium text-ink-2">Чернетка</span>;
}

/** Звіт дня: текст, статус, дії (зберегти, здати, копіювати) і підказки про те, чому здача недоступна. */
export function ReportEditor({ date, data, context, text, onText, saving, conflict, onSave, onCopy, onHistory, onDiff, onCorrections, onBackdatedLead }: {
  date: string;
  data: ReportData;
  context: CalendarDayContext | undefined;
  text: string;
  onText: (text: string) => void;
  saving: boolean;
  conflict: boolean;
  onSave: (submitted: boolean) => void;
  onCopy: () => void;
  onHistory: () => void;
  onDiff: () => void;
  onCorrections: () => void;
  onBackdatedLead: () => void;
}) {
  const report = data.selected;
  const labels = calendarContextLabels(date, context);
  const blocked = saving || conflict || !text.trim();
  return (
    <Surface as="section" variant="glass" radius="card" data-reveal aria-labelledby="report-day-title" className="flex min-w-0 flex-col gap-4 p-5 @4xl:p-6">
      <header className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <h2 id="report-day-title" className="m-0 text-[17px] font-medium">{formatDateLong(date)}</h2>
          <p className="m-0 mt-1 text-[13px] text-ink-2"><span className="font-mono">{formatDate(date)}</span>{labels.length ? ` · ${labels.join(' · ')}` : ''}</p>
        </div>
        <div className="flex items-center gap-1">
          {!report && data.suggestedText ? <Hint label="Звідки чернетка">Чернетку сформовано з подій за цей день. Перевір текст перед збереженням.</Hint> : null}
          <Status report={report} />
        </div>
      </header>

      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" size="sm" disabled={saving} onClick={onHistory}>Версії</Button>
        <Button variant="outline" size="sm" disabled={saving} onClick={onDiff}>Факт і корекція</Button>
        <Button variant="outline" size="sm" disabled={saving} onClick={onCorrections}>Додати за датою</Button>
        <Button variant="outline" size="sm" disabled={saving} onClick={onBackdatedLead}>Новий лід за дату</Button>
      </div>

      <Textarea aria-label="Текст щоденного звіту" disabled={saving} value={text} onChange={(event) => onText(event.target.value)} placeholder="Встав текст щоденного звіту або внеси коригування" rows={14} className="min-h-72 font-mono text-[13px] leading-relaxed" />
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <label className="flex min-h-9 cursor-pointer items-center gap-2.5 text-sm [@media(pointer:coarse)]:min-h-11">
          <Checkbox checked={hasFormLine(text)} disabled={saving} aria-label="Форму заповнено" onCheckedChange={(checked) => onText(setFormLine(text, checked))} />
          Форму заповнено
        </label>
        {data.goalLines.length ? <Button variant="ghost" size="sm" disabled={saving} onClick={() => onText(replaceGoalLines(text, data.goalLines))}>Оновити рядки цілей</Button> : null}
      </div>

      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        {report ? (
          <dl className="m-0 flex flex-col gap-0.5 text-xs text-ink-2">
            <div className="flex gap-2"><dt>Остання зміна:</dt><dd className="m-0 font-mono">{formatStamp(report.updatedAt)}</dd></div>
            {report.submittedAt ? <div className="flex gap-2"><dt>Остання фінальна здача:</dt><dd className="m-0 font-mono">{formatStamp(report.submittedAt)}</dd></div> : null}
            <div className="flex gap-2"><dt>Версій:</dt><dd className="m-0 font-mono">{report.revisionCount}</dd></div>
          </dl>
        ) : <span />}
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="ghost" size="sm" disabled={saving || !text.trim()} onClick={onCopy}>Копіювати</Button>
          <Button variant="outline" size="sm" disabled={blocked} onClick={() => onSave(false)}>{saving ? 'Зберігаємо…' : 'Зберегти чернетку'}</Button>
          <Button variant="action" size="sm" disabled={blocked || !data.finalReportState?.canSubmit} onClick={() => onSave(true)}>{saving ? 'Здаємо…' : report?.submittedAt ? 'Здати оновлення' : 'Здати фінальний'}</Button>
          {data.finalReportState && !data.finalReportState.canSubmit && data.finalReportState.reason ? <Hint label="Чому не можна здати фінальний">{data.finalReportState.reason}</Hint> : null}
        </div>
      </div>
    </Surface>
  );
}
