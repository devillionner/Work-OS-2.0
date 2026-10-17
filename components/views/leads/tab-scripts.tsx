'use client';

import { useMemo, useState } from 'react';
import { Copy } from 'lucide-react';
import { SearchSelect } from '@/components/ui/combobox';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Ghost } from '@/components/ui/ghost';
import { humanError } from '@/components/ui/human-error';
import { Segmented } from '@/components/ui/segmented';
import { Select } from '@/components/ui/select';
import { useToast } from '@/components/ui/toast';
import { ScriptText } from '@/components/views/library/script-editor';
import { useRemote } from '@/components/views/shared/use-remote';
import type { LeadDetail } from '@/lib/leads/application/queries';
import { businessDate } from '@/lib/business-time';
import { bookedLessons, defaultLesson, reminderKind, scriptValues, type ScriptAudience } from '@/lib/leads/domain/script-context';
import { rankLeadScripts, type LeadScriptItem, type RankedLeadScript } from '@/lib/leads/domain/script-match';
import { fieldLabel, fillScript, type ScriptFieldKey, type ScriptValues } from '@/lib/script-fields';
import { cn } from '@/lib/utils';
import { displayTime, labels, type Mutation } from './client';

type Language = 'uk' | 'ru';
type UsedPayload = { used: Array<{ itemId: string; at: number; count: number }> };
const NO_INTEREST = '__none';

/** Поле з даних ліда й уроку в тексті: заповнене показується чіпом, порожнє — рядком вводу, який можна дописати. */
function fillNode(values: ScriptValues, manual: ScriptValues, setManual: (key: ScriptFieldKey, value: string) => void) {
  return (field: ScriptFieldKey) => {
    const resolved = values[field]?.trim();
    if (resolved) return <span className="rounded-[5px] bg-raised px-1 text-ink">{resolved}</span>;
    const typed = manual[field] ?? '';
    return (
      <input
        value={typed}
        placeholder={fieldLabel(field)}
        aria-label={`Дописати: ${fieldLabel(field)}`}
        onChange={(event) => setManual(field, event.target.value)}
        style={{ width: `${Math.max(typed.length + 2, fieldLabel(field).length + 1)}ch` }}
        className="mx-0.5 max-w-full rounded-[5px] border border-dashed border-warn bg-sunken px-1.5 py-0 align-baseline text-sm text-ink outline-none placeholder:text-ink-3 focus-visible:border-line-strong"
      />
    );
  };
}

function Script({ script, language, values, manual, setManual, onCopy, onPersonal, lastUsed }: {
  script: RankedLeadScript;
  language: Language;
  values: ScriptValues;
  manual: ScriptValues;
  setManual: (key: ScriptFieldKey, value: string) => void;
  onCopy: (script: RankedLeadScript, text: string, missing: ScriptFieldKey[]) => void;
  onPersonal: (script: RankedLeadScript) => void;
  lastUsed: { at: number; count: number } | undefined;
}) {
  const text = language === 'uk' ? script.ukText : script.ruText;
  const merged = useMemo(() => ({ ...manual, ...Object.fromEntries(Object.entries(values).filter(([, value]) => value?.trim())) } as ScriptValues), [values, manual]);
  const filled = useMemo(() => fillScript(text, merged), [text, merged]);
  const kind = script.templateKey ? 'Шаблон' : script.audience === 'personal' ? 'Особистий' : 'Офіційний';
  return (
    <li className={cn('rounded-inner border bg-sunken', script.recommended ? 'border-line-strong' : 'border-line')}>
      <details className="group" open={script.recommended || undefined}>
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-sm font-medium">
          <span className="min-w-0 truncate">{script.title}</span>
          <span className="flex shrink-0 items-center gap-2 text-xs font-normal text-ink-2">
            {lastUsed ? <span title={displayTime(lastUsed.at)}>Використано{lastUsed.count > 1 ? ` · ${lastUsed.count}` : ''}</span> : null}
            <span>{kind}</span>
          </span>
        </summary>
        <div className="flex flex-col gap-3 px-4 pb-4">
          {script.notes ? <p className="m-0 text-xs text-ink-2">{script.notes}</p> : null}
          {text.trim() ? (
            <ScriptText text={text} className="text-sm leading-relaxed" fill={fillNode(values, manual, setManual)} />
          ) : <p className="m-0 text-sm text-ink-2">Для цієї мови тексту немає.</p>}
          {filled.missing.length && text.trim() ? <p className="m-0 text-xs text-warn">Не вистачає: {filled.missing.filter((field) => !manual[field]?.trim()).map(fieldLabel).join(', ') || 'усе дописано'}.</p> : null}
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" disabled={!text.trim()} onClick={() => onCopy(script, filled.text, filled.missing.filter((field) => !manual[field]?.trim()))}><Copy aria-hidden="true" strokeWidth={1.5} />Копіювати {language === 'uk' ? 'UA' : 'RU'}</Button>
            {script.collection === 'official_script' ? <Button variant="ghost" size="sm" onClick={() => onPersonal(script)}>Зробити свою версію</Button> : null}
          </div>
        </div>
      </details>
    </li>
  );
}

/**
 * Скрипти ліда з Бібліотеки: угорі «Рекомендовано зараз» (за етапом ліда, предметом і гілкою), нижче решта. Текст уже заповнений
 * даними ліда й уроку; «Учню / Дорослому» міняє звертання, порожні поля можна дописати. Копіювання ставить відмітку «використано».
 */
export function ScriptsTab({ detail, mutate }: { detail: LeadDetail; mutate: Mutation }) {
  const toast = useToast();
  const lead = detail.lead;
  const [language, setLanguage] = useState<Language>('uk');
  const [audience, setAudience] = useState<ScriptAudience>(lead.isStudent === 1 && detail.students.length === 0 ? 'student' : 'adult');
  const [lessonId, setLessonId] = useState<string | null>(null);
  const [manual, setManual] = useState<ScriptValues>({});
  const [refresh, setRefresh] = useState(0);
  const scriptsRemote = useRemote<{ items?: LeadScriptItem[] }>('/api/library?kind=script', { refresh, revalidateOnEnable: true, fallback: 'Не вдалося завантажити скрипти.' });
  const usedRemote = useRemote<UsedPayload>(`/api/leads/scripts?id=${encodeURIComponent(lead.id)}`, { refresh, fallback: 'Не вдалося завантажити відмітки використання.' });
  const dictionaries = useRemote<{ dictionaries: { branches: string[] } }>('/api/library/dictionaries', { fallback: 'Не вдалося завантажити довідники.' });
  const [today] = useState(() => businessDate(Math.floor(Date.now() / 1000)));
  const lessons = useMemo(() => bookedLessons(detail.lessons), [detail.lessons]);
  const lesson = useMemo(() => lessons.find((entry) => entry.id === lessonId) ?? defaultLesson(detail.lessons, today), [lessons, lessonId, detail.lessons, today]);
  const values = useMemo(() => scriptValues({ name: lead.name, subject: lead.subject, isStudent: lead.isStudent }, lesson, detail.students, audience), [lead.name, lead.subject, lead.isStudent, lesson, detail.students, audience]);
  const usedMap = useMemo(() => new Map((usedRemote.data?.used ?? []).map((entry) => [entry.itemId, entry])), [usedRemote.data]);
  const scripts = useMemo(() => rankLeadScripts(scriptsRemote.data?.items ?? [], {
    platform: lead.platform, subject: lead.subject, funnelStage: lead.funnelStage, qualification: lead.qualification, interest: lead.interest,
    reminder: reminderKind(lesson, detail.serverNow), used: new Set(usedMap.keys()),
  }), [scriptsRemote.data, lead.platform, lead.subject, lead.funnelStage, lead.qualification, lead.interest, lesson, detail.serverNow, usedMap]);
  const recommended = scripts.filter((script) => script.recommended).slice(0, 5);
  const rest = scripts.filter((script) => !recommended.includes(script));
  const archived = lead.archivedAt !== null;
  const branches = useMemo(() => {
    const names = dictionaries.data?.dictionaries.branches ?? [];
    return [{ value: NO_INTEREST, label: 'Без інтересу' }, ...[...names, ...(lead.interest && !names.includes(lead.interest) ? [lead.interest] : [])].map((name) => ({ value: name, label: name }))];
  }, [dictionaries.data, lead.interest]);

  const setField = (key: ScriptFieldKey, value: string) => setManual((current) => ({ ...current, [key]: value }));

  const copy = async (script: RankedLeadScript, text: string, missing: ScriptFieldKey[]) => {
    if (!text.trim()) return;
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      toast.push({ message: 'Браузер не дозволив автоматичне копіювання.', tone: 'hot' });
      return;
    }
    toast.push({ message: missing.length ? `${script.title}: скопійовано, не заповнено: ${missing.map(fieldLabel).join(', ')}.` : `${script.title}: ${language === 'uk' ? 'UA' : 'RU'} скопійовано.` });
    // Відмітка «використано» ставиться самим копіюванням і лишається в історії ліда.
    void fetch('/api/leads/scripts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ leadId: lead.id, itemId: script.id, language }) })
      .then((response) => { if (response.ok) setRefresh((value) => value + 1); })
      .catch(() => { /* відмітка не критична: копіювання вже відбулось */ });
  };

  const makePersonal = async (script: RankedLeadScript) => {
    try {
      const response = await fetch('/api/library', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'copy_personal', id: script.id }) });
      const body = await response.json().catch(() => ({})) as { error?: string; existing?: boolean };
      if (!response.ok) throw new Error(body.error || 'Не вдалося створити власну версію.');
      toast.push({ message: body.existing ? 'Власна версія вже є в «Особистих скриптах».' : 'Власну версію створено в «Особистих скриптах». Редагуй її в Бібліотеці.', tone: 'ok' });
      setRefresh((value) => value + 1);
    } catch (reason) {
      toast.push({ message: humanError(reason, 'Не вдалося створити власну версію.'), tone: 'hot' });
    }
  };

  const setInterest = (value: string | null) => {
    const interest = !value || value === NO_INTEREST ? '' : value;
    if (interest === lead.interest) return;
    void mutate('update', { interest }).catch((reason: unknown) => toast.push({ message: humanError(reason, 'Не вдалося зберегти інтерес ліда.'), tone: 'hot' }));
  };

  if (scriptsRemote.error && !scriptsRemote.data) return <p role="alert" className="m-0 text-sm text-hot">{scriptsRemote.error}</p>;
  if (!scriptsRemote.data) return <div aria-busy="true" className="flex flex-col gap-2">{[0, 1, 2].map((item) => <Ghost key={item} className="h-14 rounded-inner" />)}</div>;

  const list = (items: RankedLeadScript[]) => (
    <ul className="m-0 flex list-none flex-col gap-2 p-0">
      {items.map((script) => <Script key={script.id} script={script} language={language} values={values} manual={manual} setManual={setField} onCopy={(item, text, missing) => void copy(item, text, missing)} onPersonal={(item) => void makePersonal(item)} lastUsed={usedMap.get(script.id)} />)}
    </ul>
  );

  return (
    <section className="flex flex-col gap-4" aria-label="Скрипти">
      <div className="flex flex-col gap-3 rounded-inner border border-line p-3">
        <div className="flex flex-wrap items-center gap-2">
          <Segmented<ScriptAudience> label="Кому пишемо" size="sm" value={audience} onValueChange={setAudience} items={[{ value: 'student', label: 'Учню' }, { value: 'adult', label: 'Дорослому' }]} />
          <Segmented<Language> label="Мова скрипту" size="sm" value={language} onValueChange={setLanguage} items={[{ value: 'uk', label: 'UA' }, { value: 'ru', label: 'RU' }]} />
        </div>
        {lessons.length > 1 ? (
          <Select aria-label="Урок для полів скрипту" value={lesson?.id ?? ''} onChange={(event) => setLessonId(event.target.value)}>
            {lessons.map((entry) => <option key={entry.id} value={entry.id}>{entry.subject} · {entry.lessonDate} {entry.lessonTime}</option>)}
          </Select>
        ) : lesson ? <p className="m-0 text-xs text-ink-2">Урок для полів: {lesson.subject} · {lesson.lessonDate} {lesson.lessonTime || 'час не вказано'}.</p> : <p className="m-0 text-xs text-ink-2">Запланованого уроку немає: поля уроку можна дописати вручну.</p>}
        <div className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-ink-2">Інтерес ліда (гілка скриптів)</span>
          <SearchSelect
            options={branches}
            value={lead.interest || NO_INTEREST}
            onChange={setInterest}
            onCreate={(name) => setInterest(name)}
            disabled={archived}
            placeholder="Без інтересу"
            searchPlaceholder="Пошук або новий інтерес"
          />
        </div>
      </div>

      {!scripts.length ? <EmptyState text="У Бібліотеці ще немає відповідних скриптів." /> : (
        <>
          {recommended.length ? (
            <div className="flex flex-col gap-2">
              <h3 className="m-0 text-sm font-medium">Рекомендовано зараз</h3>
              <p className="m-0 text-xs text-ink-2">За етапом «{labels[lead.funnelStage] ?? lead.funnelStage}»{lead.subject ? `, предметом «${lead.subject}»` : ''}{lead.interest ? ` і гілкою «${lead.interest}»` : ''}.</p>
              {list(recommended)}
            </div>
          ) : <p className="m-0 text-xs text-ink-2">Скриптів, розмічених під етап «{labels[lead.funnelStage] ?? lead.funnelStage}», ще немає: розмітка етапу, напрямків і гілки редагується в редакторі скрипту.</p>}
          {rest.length ? (
            <details className="flex flex-col gap-2" open={!recommended.length || undefined}>
              <summary className="cursor-pointer text-sm font-medium">Решта скриптів · {rest.length}</summary>
              <div className="mt-2">{list(rest)}</div>
            </details>
          ) : null}
        </>
      )}
    </section>
  );
}
