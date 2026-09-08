'use client';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import type { LeadDetail } from '@/lib/leads/application/queries';
import type { Mutation } from './client';
import { EditDialog, Field, NoteField, SaveForm, textValue } from './form';
export function Students({
  detail,
  mutate,
}: {
  detail: LeadDetail;
  mutate: Mutation;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const current = detail.students.find((s) => s.id === editing);
  return (
    <section className="lead-panel" aria-labelledby="students-title">
      <div className="lead-section-head">
        <h3 id="students-title">
          Учні <small>{detail.students.length}</small>
        </h3>
        <Button
          variant="outline"
          onClick={() => setEditing('new')}
          disabled={detail.lead.archivedAt !== null}
        >
          Додати учня
        </Button>
      </div>
      {detail.students.length ? (
        <ul className="lead-simple-list">
          {detail.students.map((s) => (
            <li key={s.id}>
              <div>
                <strong>
                  {s.name} {s.surname}
                </strong>
                <p>
                  {s.grade ? `${s.grade} клас` : s.ageGroup || 'Вік не вказано'}
                </p>
                {s.note && <p className="lead-preserve">{s.note}</p>}
              </div>
              <Button
                variant="ghost"
                disabled={detail.lead.archivedAt !== null}
                onClick={() => setEditing(s.id)}
                aria-label={`Редагувати учня ${s.name}`}
              >
                Редагувати
              </Button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted-note">
          Якщо контакт навчається сам, урок можна записати без окремого учня.
          Для дітей додайте учнів тут.
        </p>
      )}
      {editing && (
        <EditDialog
          title={current ? 'Редагувати учня' : 'Додати учня'}
          close={() => setEditing(null)}
        >
          <SaveForm
            cancel={() => setEditing(null)}
            save={async (f) => {
              await mutate(
                current ? 'student_update' : 'student_create',
                {
                  name: textValue(f, 'name'),
                  grade: textValue(f, 'grade')
                    ? Number(textValue(f, 'grade'))
                    : null,
                  ageGroup: textValue(f, 'ageGroup'),
                  note: textValue(f, 'note'),
                },
                current?.id,
              );
              setEditing(null);
            }}
          >
            <Field label="Ім’я *" name="name" value={current?.name} required />
            <Field
              label="Клас (1–11)"
              name="grade"
              type="number"
              min={1}
              max={11}
              value={current?.grade ?? ''}
            />
            <Field
              label="Або вікова категорія"
              name="ageGroup"
              value={current?.ageGroup}
            />
            <NoteField label="Примітка" name="note" value={current?.note} />
          </SaveForm>
        </EditDialog>
      )}
    </section>
  );
}
