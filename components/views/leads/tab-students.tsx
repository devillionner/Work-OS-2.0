'use client';

import { useState } from 'react';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import type { LeadDetail } from '@/lib/leads/application/queries';
import type { Mutation } from './client';
import { EditDialog, Field, NoteField, SaveForm, textValue } from './form';

/** Учні контакту: діти або сам контакт. */
export function StudentsTab({ detail, mutate }: { detail: LeadDetail; mutate: Mutation }) {
  const [editing, setEditing] = useState<string | null>(null);
  const current = detail.students.find((student) => student.id === editing);
  const archived = detail.lead.archivedAt !== null;
  return (
    <section className="flex flex-col gap-4" aria-label="Учні">
      <div className="flex items-center justify-between gap-3">
        <p className="m-0 text-sm text-ink-2">{detail.students.length ? `Учнів: ${detail.students.length}` : 'Учнів ще немає'}</p>
        <Button variant="outline" size="sm" disabled={archived} onClick={() => setEditing('new')}><Plus aria-hidden="true" strokeWidth={1.5} />Додати учня</Button>
      </div>
      {detail.students.length ? (
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          {detail.students.map((student) => (
            <li key={student.id} className="flex items-start justify-between gap-3 rounded-inner border border-line bg-sunken px-4 py-3">
              <div className="min-w-0">
                <p className="m-0 text-sm font-medium">{student.name} {student.surname}</p>
                <p className="m-0 text-xs text-ink-2">{student.grade ? `${student.grade} клас` : student.ageGroup || 'Вік не вказано'}</p>
                {student.note ? <p className="m-0 mt-1 whitespace-pre-wrap text-xs text-ink-2">{student.note}</p> : null}
              </div>
              <Button variant="ghost" size="sm" disabled={archived} aria-label={`Редагувати учня ${student.name}`} onClick={() => setEditing(student.id)}>Редагувати</Button>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState text="Якщо контакт навчається сам, урок можна записати без окремого учня. Для дітей додай учнів тут." />
      )}
      {editing ? (
        <EditDialog title={current ? 'Редагувати учня' : 'Додати учня'} close={() => setEditing(null)}>
          <SaveForm
            cancel={() => setEditing(null)}
            save={async (f) => {
              await mutate(
                current ? 'student_update' : 'student_create',
                { name: textValue(f, 'name'), grade: textValue(f, 'grade') ? Number(textValue(f, 'grade')) : null, ageGroup: textValue(f, 'ageGroup'), note: textValue(f, 'note') },
                current?.id,
              );
              setEditing(null);
            }}
          >
            <Field label="Ім’я *" name="name" value={current?.name} required />
            <Field label="Клас (1–11)" name="grade" type="number" min={1} max={11} value={current?.grade ?? ''} />
            <Field label="Або вікова категорія" name="ageGroup" value={current?.ageGroup} />
            <NoteField label="Примітка" name="note" value={current?.note} />
          </SaveForm>
        </EditDialog>
      ) : null}
    </section>
  );
}
