/** Відомий збіг: хвилина дня й вертикальна позиція в пікселях (центр картки події). */
export type AxisPoint = { minutes: number; px: number };

export type TimeAxis = {
  /** Хвилина від 00:00 → піксель. Для хвилини, на яку припадає кілька подій, береться верхня. */
  toPx: (minutes: number) => number;
  /** Піксель → хвилина від 00:00 (з дробовою частиною). */
  toMinutes: (px: number) => number;
};

/**
 * Кусково-лінійне відображення «хвилина ↔ піксель» через фактичні позиції подій. Між двома сусідніми подіями час
 * інтерполюється лінійно, тож де події стоять щільно, вісь розтягується, а де рідко — стискається; рядки при цьому не
 * рухаються. До першої й після останньої події вісь продовжується з крутістю `slope` (пікселів на хвилину). Якщо точок
 * немає, діє `origin` і та сама крутість.
 */
export function buildTimeAxis(points: readonly AxisPoint[], slope: number, origin: AxisPoint): TimeAxis {
  const sorted = [...(points.length ? points : [origin])].sort((a, b) => a.minutes - b.minutes || a.px - b.px);
  // Піксель не спадає разом із часом; порушення (збіги хвилин, округлення) вирівнюються по попередній точці.
  const list: AxisPoint[] = [];
  for (const point of sorted) {
    const previous = list[list.length - 1];
    list.push(previous && point.px < previous.px ? { minutes: point.minutes, px: previous.px } : point);
  }
  const first = list[0];
  const last = list[list.length - 1];

  const toPx = (minutes: number): number => {
    if (minutes <= first.minutes) return first.px - (first.minutes - minutes) * slope;
    for (let index = 1; index < list.length; index += 1) {
      const b = list[index];
      if (b.minutes < minutes) continue;
      if (b.minutes === minutes) return b.px;
      const a = list[index - 1];
      return a.px + ((minutes - a.minutes) / (b.minutes - a.minutes)) * (b.px - a.px);
    }
    return last.px + (minutes - last.minutes) * slope;
  };

  const toMinutes = (px: number): number => {
    if (px <= first.px) return first.minutes - (first.px - px) / slope;
    for (let index = 1; index < list.length; index += 1) {
      const b = list[index];
      if (b.px < px) continue;
      const a = list[index - 1];
      return a.minutes + ((px - a.px) / (b.px - a.px)) * (b.minutes - a.minutes);
    }
    return last.minutes + (px - last.px) / slope;
  };

  return { toPx, toMinutes };
}
