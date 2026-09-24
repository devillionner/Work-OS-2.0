import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

void test('repeated Leads actions expose contextual accessible names', () => {
  const conversation = readFileSync(new URL('../components/leads/conversation.tsx', import.meta.url), 'utf8');
  const reminders = readFileSync(new URL('../components/leads/reminders.tsx', import.meta.url), 'utf8');

  assert.match(conversation, /aria-label=\{`Прикріпити файл до повідомлення від \$\{displayTime\(m\.sentAt\)\}`\}/);
  assert.match(conversation, /aria-label=\{`Відкрити \$\{attachment\.fileName\}`\}/);
  assert.match(conversation, /aria-label=\{`Редагувати повідомлення від \$\{displayTime\(m\.sentAt\)\}`\}/);
  assert.match(conversation, /aria-label=\{`Видалити повідомлення від \$\{displayTime\(m\.sentAt\)\}`\}/);
  assert.match(reminders, /aria-label=\{`Копіювати текст нагадування №\$\{r\.slot\}`\}/);
  assert.match(reminders, /aria-label=\{`Налаштувати нагадування №\$\{r\.slot\}`\}/);
  assert.match(reminders, /aria-label=\{`Позначити нагадування №\$\{r\.slot\} як надіслане`\}/);
  assert.match(reminders, /aria-label=\{`Пропустити нагадування №\$\{r\.slot\}`\}/);
});
