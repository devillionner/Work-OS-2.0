// Нотатка скрипту може починатися з уточнюючого питання, яке пишемо ліду першим повідомленням, ще до самого скрипту (заперечення:
// «Уточнююче питання: …», далі порожній рядок і решта нотатки). Окремої колонки немає: формат видно й редагується в редакторі.
export const CLARIFIER_PREFIX = 'Уточнююче питання:';

/** Нотатка → уточнююче питання (якщо є) і решта тексту нотатки. */
export function splitClarifier(notes: string): { question: string; rest: string } {
  const text = notes.replace(/\r\n/g, '\n').trim();
  if (!text.startsWith(CLARIFIER_PREFIX)) return { question: '', rest: text };
  const body = text.slice(CLARIFIER_PREFIX.length);
  const cut = body.indexOf('\n\n');
  const question = (cut === -1 ? body : body.slice(0, cut)).trim();
  const rest = cut === -1 ? '' : body.slice(cut + 2).trim();
  return { question, rest };
}

/** Уточнююче питання + решта нотатки → один рядок нотатки (зворотна дія до splitClarifier). */
export function joinClarifier(question: string, rest: string): string {
  const q = question.trim();
  const r = rest.trim();
  return q ? `${CLARIFIER_PREFIX} ${q}${r ? `\n\n${r}` : ''}` : r;
}
