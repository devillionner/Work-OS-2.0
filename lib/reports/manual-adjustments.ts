export type ReportManualAdjustments = {
  publications: number;
  responses: number;
  bookings: number;
};

export type ReportMetricTotals = ReportManualAdjustments;

type SummaryRow = { eventType: string; count: number };

const ADJUSTMENT_LIMIT = 9999;
const KEYS = ['publications', 'responses', 'bookings'] as const;

export function emptyReportManualAdjustments(): ReportManualAdjustments {
  return { publications: 0, responses: 0, bookings: 0 };
}

export function validateReportManualAdjustments(value: unknown): ReportManualAdjustments | null {
  if (value === undefined) return emptyReportManualAdjustments();
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const result = emptyReportManualAdjustments();
  for (const key of KEYS) {
    const item = record[key] ?? 0;
    if (typeof item !== 'number' || !Number.isSafeInteger(item) || Math.abs(item) > ADJUSTMENT_LIMIT)
      return null;
    result[key] = item;
  }
  return result;
}

export function reportManualAdjustmentsFromPayload(payloadJson: string | null | undefined): ReportManualAdjustments {
  if (!payloadJson) return emptyReportManualAdjustments();
  try {
    const parsed: unknown = JSON.parse(payloadJson);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return emptyReportManualAdjustments();
    return validateReportManualAdjustments((parsed as Record<string, unknown>).manualAdjustments)
      ?? emptyReportManualAdjustments();
  } catch {
    return emptyReportManualAdjustments();
  }
}

export function writeReportManualAdjustmentsPayload(
  payloadJson: string | null | undefined,
  adjustments: ReportManualAdjustments,
  updatedAt: number,
): string {
  let base: Record<string, unknown> = {};
  if (payloadJson) {
    try {
      const parsed: unknown = JSON.parse(payloadJson);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed))
        base = parsed as Record<string, unknown>;
    } catch {
      base = {};
    }
  }
  return JSON.stringify({
    ...base,
    source: 'manual',
    updatedAt,
    manualAdjustments: adjustments,
  });
}

export function reportFactTotals(summary: readonly SummaryRow[]): ReportMetricTotals {
  const totals = emptyReportManualAdjustments();
  for (const row of summary) {
    const count = Number(row.count || 0);
    if (row.eventType === 'publication') totals.publications += count;
    else if (row.eventType === 'lead_created') totals.responses += count;
    else if (row.eventType === 'lesson_booked' || row.eventType === 'curator_booking_pending') totals.bookings += count;
  }
  return totals;
}

export function applyReportManualAdjustments(
  facts: ReportMetricTotals,
  adjustments: ReportManualAdjustments,
): ReportMetricTotals {
  return {
    publications: facts.publications + adjustments.publications,
    responses: facts.responses + adjustments.responses,
    bookings: facts.bookings + adjustments.bookings,
  };
}

export function reportManualAdjustmentsAreValidForFacts(
  facts: ReportMetricTotals,
  adjustments: ReportManualAdjustments,
): boolean {
  const total = applyReportManualAdjustments(facts, adjustments);
  return KEYS.every((key) => total[key] >= 0);
}
