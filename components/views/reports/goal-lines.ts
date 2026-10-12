/** Рядки цілей і галочка «Форму заповнено»: усе живе в самому тексті звіту, окремого сховища немає. */
export const FORM_LINE = 'Форма заповнена';
const GOAL_LINE = /^Ціль по (оголошенням|новим чатам|відгукам|записам)\b/;

export const hasFormLine = (text: string) => text.split('\n').some((line) => line.trim() === FORM_LINE);

const trimEnd = (lines: string[]) => {
  const result = [...lines];
  while (result.length && !result[result.length - 1].trim()) result.pop();
  return result;
};

/** Додає або прибирає рядок «Форма заповнена» наприкінці звіту. */
export function setFormLine(text: string, on: boolean): string {
  const body = trimEnd(text.split('\n').filter((line) => line.trim() !== FORM_LINE));
  return (on ? [...body, FORM_LINE] : body).join('\n');
}

/** Замінює (або додає) чотири рядки цілей наприкінці звіту, зберігаючи галочку «Форма заповнена». */
export function replaceGoalLines(text: string, goalLines: readonly string[]): string {
  if (!goalLines.length) return text;
  const form = hasFormLine(text);
  const body = trimEnd(text.split('\n').filter((line) => !GOAL_LINE.test(line.trim()) && line.trim() !== FORM_LINE));
  return [...body, '', ...goalLines, ...(form ? [FORM_LINE] : [])].join('\n');
}
