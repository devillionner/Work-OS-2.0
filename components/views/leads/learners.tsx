'use client';

import { useId, useState } from 'react';
import { Plus, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useToast } from '@/components/ui/toast';
import { humanError } from '@/components/ui/human-error';
import type { LeadDetail } from '@/lib/leads/application/queries';
import type { Learner } from '@/lib/leads/data/list';
import { SUBJECT_OPTIONS } from '@/lib/subjects';
import { cn } from '@/lib/utils';
import type { Mutation } from './client';
import { EditDialog, Field, NoteField, SaveForm, SelectField, textValue } from './form';

type Student = LeadDetail['students'][number];

/** Підпис учня на картці: сам лід — його ім'я, дитина — її ім'я. */
export function learnerLabel(learner: Pick<Learner, 'kind' | 'name'>, leadName: string): string {
  return learner.kind === 'self' ? (leadName.trim().split(/\s+/)[0] || 'Сам') : learner.name;
}

/** Чіпи «Максим: Англійська, Математика» для дошки й таблиці: одна картка на ліда, учні в чіпах. */
export function LearnerChips({ learners, leadName, max = 3, className }: { learners: readonly Learner[]; leadName: string; max?: number; className?: string }) {
  const shown = learners.slice(0, max);
  const rest = learners.length - shown.length;
  return (
    <ul className={cn('m-0 flex min-w-0 list-none flex-wrap gap-1 p-0', className)} aria-label="Учні й предмети">
      {shown.map((learner) => (
        <li key={learner.id} className="max-w-full truncate rounded-full border border-line px-2 py-0.5 text-[11px] text-ink-2">
          {learnerLabel(learner, leadName)}{learner.subjects.length ? `: ${learner.subjects.join(', ')}` : ''}
        </li>
      ))}
      {rest > 0 ? <li className="rounded-full border border-line px-2 py-0.5 text-[11px] text-ink-3">+{rest}</li> : null}
    </ul>
  );
}

/** Предмети чіпами з «×» і полем додавання (стандартні предмети підказкою, власний можна ввести). */
export function SubjectsInput({ value, onChange, label = 'Предмети', disabled = false }: { value: readonly string[]; onChange: (next: string[]) => void; label?: string; disabled?: boolean }) {
  const id = useId();
  const [draft, setDraft] = useState('');
  const add = () => {
    const text = draft.trim();
    if (text && !value.some((item) => item.toLowerCase() === text.toLowerCase())) onChange([...value, text]);
    setDraft('');
  };
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <label htmlFor={id} className="text-xs font-medium text-ink-2">{label}</label>
      {value.length ? (
        <ul className="m-0 flex list-none flex-wrap gap-1.5 p-0">
          {value.map((item) => (
            <li key={item} className="inline-flex h-7 items-center gap-1 rounded-full border border-line pl-3 pr-1 text-[13px]">
              {item}
              <button type="button" disabled={disabled} aria-label={`Прибрати предмет ${item}`} onClick={() => onChange(value.filter((entry) => entry !== item))} className="inline-flex size-5 items-center justify-center rounded-full text-ink-3 hover:bg-raised hover:text-ink"><X aria-hidden="true" strokeWidth={1.5} className="size-3" /></button>
            </li>
          ))}
        </ul>
      ) : null}
      <div className="flex gap-2">
        <Input id={id} value={draft} disabled={disabled} list={`${id}-subjects`} placeholder="Додати предмет" onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ',') { event.preventDefault(); add(); } }} />
        <datalist id={`${id}-subjects`}>{SUBJECT_OPTIONS.map((item) => <option key={item} value={item}>{item}</option>)}</datalist>
        <Button type="button" variant="outline" size="md" disabled={disabled || !draft.trim()} onClick={add}>Додати</Button>
      </div>
    </div>
  );
}

function subtitle(student: Student): string {
  return student.grade ? `${student.grade} клас` : student.ageGroup || (student.kind === 'self' ? 'Дорослий' : 'Вік не вказано');
}

/** Блок «Учні» в Inspector: картка кожного учня з предметами. Учня чи предмет з уроками прибрати не можна, і це пояснено в рядку. */
export function StudentsBlock({ detail, mutate }: { detail: LeadDetail; mutate: Mutation }) {
  const toast = useToast();
  const [editing, setEditing] = useState<string | null>(null);
  const [adding, setAdding] = useState<string | null>(null);
  const [subjects, setSubjects] = useState<string[]>([]);
  const archived = detail.lead.archivedAt !== null;
  const current = detail.students.find((student) => student.id === editing);
  const hasSelf = detail.students.some((student) => student.kind === 'self');
  const lessonsOf = (student: Student, subject?: string) => detail.lessons.some((lesson) => (lesson.studentId === student.id || (lesson.studentId === null && student.kind === 'self')) && (subject === undefined || lesson.subject === subject));
  const run = async (action: () => Promise<void>, fallback: string) => {
    try { await action(); } catch (reason) { toast.push({ message: humanError(reason, fallback), tone: 'hot' }); }
  };
  const addSubject = (student: Student, subject: string) => run(async () => { await mutate('student_subject_add', { subject }, student.id); setAdding(null); }, 'Не вдалося додати предмет.');

  return (
    <section className="flex min-w-0 flex-col gap-3" aria-label="Учні">
      <div className="flex items-center justify-between gap-3">
        <h3 className="m-0 text-sm font-medium">Учні</h3>
        <Button variant="outline" size="sm" disabled={archived} onClick={() => { setSubjects(detail.lead.subject ? [detail.lead.subject] : []); setEditing('new'); }}><Plus aria-hidden="true" strokeWidth={1.5} />Додати учня</Button>
      </div>
      {detail.students.length ? (
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          {detail.students.map((student) => (
            <li key={student.id} className="flex flex-col gap-2.5 rounded-inner border border-line bg-sunken px-3.5 py-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="m-0 truncate text-sm font-medium">{student.kind === 'self' ? detail.lead.name : `${student.name} ${student.surname}`.trim()}</p>
                  <p className="m-0 text-xs text-ink-2">{subtitle(student)}{student.kind === 'self' ? ' · сам контакт' : ''}</p>
                </div>
                <div className="flex shrink-0 gap-1">
                  <Button variant="ghost" size="sm" disabled={archived} aria-label={`Редагувати учня ${student.name}`} onClick={() => { setSubjects([]); setEditing(student.id); }}>Змінити</Button>
                  <Button variant="ghost" size="sm" tone="danger" disabled={archived || lessonsOf(student)} title={lessonsOf(student) ? 'У цього учня є уроки' : undefined} aria-label={`Прибрати учня ${student.name}`} onClick={() => void run(() => mutate('student_delete', {}, student.id), 'Не вдалося прибрати учня.')}>Прибрати</Button>
                </div>
              </div>
              <ul className="m-0 flex list-none flex-wrap gap-1.5 p-0">
                {student.subjects.map((subject) => {
                  const used = lessonsOf(student, subject.subject);
                  return (
                    <li key={subject.id} className="inline-flex h-7 items-center gap-1 rounded-full border border-line pl-3 pr-1 text-[13px]">
                      {subject.subject}
                      <button type="button" disabled={archived || used} aria-label={`Прибрати предмет ${subject.subject}`} title={used ? 'За цим предметом є урок' : undefined} onClick={() => void run(() => mutate('student_subject_remove', {}, subject.id), 'Не вдалося прибрати предмет.')} className="inline-flex size-5 items-center justify-center rounded-full text-ink-3 enabled:hover:bg-raised enabled:hover:text-ink disabled:opacity-40"><X aria-hidden="true" strokeWidth={1.5} className="size-3" /></button>
                    </li>
                  );
                })}
                <li><Button variant="ghost" size="sm" disabled={archived} className="h-7" onClick={() => setAdding(student.id)}><Plus aria-hidden="true" strokeWidth={1.5} />Предмет</Button></li>
              </ul>
              {student.subjects.length === 0 ? <p className="m-0 text-xs text-ink-3">Предметів ще немає</p> : null}
              {lessonsOf(student) ? <p className="m-0 text-xs text-ink-3">Учня й предмети з уроками прибрати не можна</p> : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="m-0 rounded-inner border border-dashed border-line-strong px-3.5 py-3 text-sm text-ink-2">Учнів ще немає. Додай того, хто навчається: сам контакт чи дитину.</p>
      )}

      {adding ? (
        <EditDialog title="Додати предмет" description="Предмет учня; його можна використати під час запису на урок." close={() => setAdding(null)}>
          <SaveForm cancel={() => setAdding(null)} save={async (f) => { const student = detail.students.find((item) => item.id === adding); if (student) await mutate('student_subject_add', { subject: textValue(f, 'subject') }, student.id); setAdding(null); }}>
            <Field label="Предмет *" name="subject" required suggestions={SUBJECT_OPTIONS} />
          </SaveForm>
        </EditDialog>
      ) : null}

      {editing ? (
        <EditDialog title={current ? 'Редагувати учня' : 'Додати учня'} close={() => setEditing(null)}>
          <SaveForm
            cancel={() => setEditing(null)}
            save={async (f) => {
              const data = { name: textValue(f, 'name'), grade: textValue(f, 'grade') ? Number(textValue(f, 'grade')) : null, ageGroup: textValue(f, 'ageGroup'), note: textValue(f, 'note') };
              if (current) await mutate('student_update', data, current.id);
              else await mutate('student_create', { ...data, kind: textValue(f, 'kind') === 'self' ? 'self' : 'child', subjects: JSON.parse(textValue(f, 'subjects') || '[]') as string[] });
              setEditing(null);
            }}
          >
            {!current && !hasSelf ? <SelectField label="Хто навчається" name="kind" value="child" options={[{ value: 'child', label: 'Дитина' }, { value: 'self', label: 'Сам контакт (дорослий)' }]} /> : null}
            <Field label="Ім’я *" name="name" value={current?.name ?? ''} required={!current || current.kind !== 'self'} readOnly={current?.kind === 'self'} />
            <Field label="Клас (1–11)" name="grade" type="number" min={1} max={11} value={current?.grade ?? ''} />
            <Field label="Або вікова категорія (для дорослого: Дорослий)" name="ageGroup" value={current?.ageGroup ?? ''} />
            {!current ? (
              <>
                <input type="hidden" name="subjects" value={JSON.stringify(subjects)} />
                <SubjectsInput value={subjects} onChange={setSubjects} />
              </>
            ) : null}
            <NoteField label="Примітка" name="note" value={current?.note} />
          </SaveForm>
        </EditDialog>
      ) : null}
    </section>
  );
}

type NewChildDraft = { key: string; name: string; grade: string; ageGroup: string; subjects: string[] };

/** «Хто навчається» у формі нового ліда: сам контакт і/або діти, у кожного свої предмети. Значення йде в приховане поле `learners`. */
export function LearnersFields({ defaultSubject }: { defaultSubject: string }) {
  const [self, setSelf] = useState(true);
  const [selfSubjects, setSelfSubjects] = useState<string[]>([]);
  const [children, setChildren] = useState<NewChildDraft[]>([]);
  const update = (key: string, patch: Partial<NewChildDraft>) => setChildren((list) => list.map((child) => (child.key === key ? { ...child, ...patch } : child)));
  const payload = { self: self ? { subjects: selfSubjects } : null, children: children.filter((child) => child.name.trim()).map((child) => ({ name: child.name, grade: child.grade ? Number(child.grade) : null, ageGroup: child.ageGroup, subjects: child.subjects })) };
  return (
    <fieldset className="m-0 flex min-w-0 flex-col gap-3 rounded-inner border border-line p-3.5">
      <legend className="px-1 text-xs font-medium text-ink-2">Хто навчається</legend>
      <input type="hidden" name="learners" value={JSON.stringify(payload)} />
      <input type="hidden" name="learnersDefaultSubject" value={defaultSubject} />
      <label className="flex min-h-9 cursor-pointer items-center gap-2.5 text-sm">
        <input type="checkbox" checked={self} onChange={(event) => setSelf(event.target.checked)} className="size-4" />
        Сам контакт навчається
      </label>
      {self ? <SubjectsInput value={selfSubjects} onChange={setSelfSubjects} label="Предмети контакту (порожньо: предмет відгуку)" /> : null}
      {children.map((child, index) => (
        <div key={child.key} className="flex flex-col gap-3 rounded-inner border border-line bg-sunken p-3">
          <div className="flex items-center justify-between gap-2"><span className="text-xs font-medium text-ink-2">Учень {index + 1}</span><Button type="button" variant="ghost" size="sm" onClick={() => setChildren((list) => list.filter((item) => item.key !== child.key))}>Прибрати</Button></div>
          <div className="flex min-w-0 flex-col gap-1.5"><label className="text-xs font-medium text-ink-2" htmlFor={`${child.key}-n`}>Ім’я *</label><Input id={`${child.key}-n`} value={child.name} onChange={(event) => update(child.key, { name: event.target.value })} /></div>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex min-w-0 flex-col gap-1.5"><label className="text-xs font-medium text-ink-2" htmlFor={`${child.key}-g`}>Клас (1–11)</label><Input id={`${child.key}-g`} type="number" min={1} max={11} value={child.grade} onChange={(event) => update(child.key, { grade: event.target.value, ageGroup: '' })} /></div>
            <div className="flex min-w-0 flex-col gap-1.5"><label className="text-xs font-medium text-ink-2" htmlFor={`${child.key}-a`}>Або вік</label><Input id={`${child.key}-a`} value={child.ageGroup} onChange={(event) => update(child.key, { ageGroup: event.target.value, grade: '' })} /></div>
          </div>
          <SubjectsInput value={child.subjects} onChange={(next) => update(child.key, { subjects: next })} label="Предмети учня (порожньо: предмет відгуку)" />
        </div>
      ))}
      <Button type="button" variant="outline" size="sm" className="self-start" onClick={() => setChildren((list) => [...list, { key: `child-${list.length}-${Math.random().toString(36).slice(2, 7)}`, name: '', grade: '', ageGroup: '', subjects: [] }])}><Plus aria-hidden="true" strokeWidth={1.5} />Додати учня</Button>
    </fieldset>
  );
}

/** Предмети, що лишились порожніми, отримують предмет відгуку: інакше учень був би без предметів. */
export function withDefaultSubject(raw: string, subject: string): unknown {
  try {
    const value = JSON.parse(raw) as { self: { subjects: string[] } | null; children: Array<{ subjects: string[] }> };
    if (value.self && !value.self.subjects.length && subject) value.self.subjects = [subject];
    for (const child of value.children) if (!child.subjects.length && subject) child.subjects = [subject];
    return value;
  } catch { return { self: null, children: [] }; }
}
