'use client';
import { useState } from 'react';
import type { LeadDetail } from '@/lib/leads/application/queries';
import { businessDate } from '@/lib/leads/domain/time';
import type { Mutation } from './client';
import { EditDialog, Field, SaveForm, SelectField, textValue } from './form';
export function LessonEditor({
  detail,
  lesson,
  mode,
  mutate,
  close,
}: {
  detail: LeadDetail;
  lesson?: LeadDetail['lessons'][number];
  mode: 'book' | 'update' | 'reschedule';
  mutate: Mutation;
  close: () => void;
}) {
  const [now] = useState(() => Math.floor(Date.now() / 1000));
  return (
    <EditDialog
      title={
        mode === 'reschedule'
          ? 'Перенести урок'
          : mode === 'update'
            ? 'Дані уроку'
            : 'Записати на урок'
      }
      close={close}
      description="Час уроку вказуйте за Києвом. Без викладача, часу чи посилання нагадування чекатимуть даних."
    >
      <SaveForm
        cancel={close}
        save={async (f) => {
          const data: Record<string, unknown> = {
            subject: textValue(f, 'subject'),
            studentId: textValue(f, 'studentId') || null,
            teacherName: textValue(f, 'teacherName'),
            lessonDate: textValue(f, 'lessonDate'),
            lessonTime: textValue(f, 'lessonTime'),
            lessonPlatform: textValue(f, 'lessonPlatform'),
            meetingLink: textValue(f, 'meetingLink'),
            ...(mode !== 'book' &&
            lesson?.bookingDate === null &&
            !textValue(f, 'bookingDate')
              ? {}
              : { bookingDate: textValue(f, 'bookingDate') }),
          };
          if (mode === 'book' && detail.curatorRequests.length)
            data.curatorRequestId = textValue(f, 'curatorRequestId');
          if (mode === 'reschedule') data.reason = textValue(f, 'reason');
          await mutate(
            `lesson_${mode}`,
            data,
            mode === 'book' ? undefined : lesson?.id,
          );
          close();
        }}
      >
        {mode === 'book' && detail.curatorRequests.length > 0 && (
          <SelectField
            label="Підтвердити запит куратору"
            name="curatorRequestId"
            value={detail.curatorRequests[0].id}
            options={detail.curatorRequests.map((r) => ({
              value: r.id,
              label: `Запит від ${r.submittedDate}`,
            }))}
          />
        )}
        <Field
          label="Предмет *"
          name="subject"
          value={lesson?.subject ?? detail.lead.subject}
          required
        />
        <SelectField
          label="Учень"
          name="studentId"
          value={lesson?.studentId ?? ''}
          options={[
            ...(mode !== 'book' || detail.lead.isStudent === 1
              ? [{ value: '', label: `${detail.lead.name} (сам контакт)` }]
              : []),
            ...detail.students.map((s) => ({
              value: s.id,
              label: `${s.name} ${s.surname}`.trim(),
            })),
          ]}
        />
        <Field
          label="Викладач"
          name="teacherName"
          value={lesson?.teacherName}
        />
        <Field
          label="Дата уроку *"
          name="lessonDate"
          type="date"
          value={lesson?.lessonDate}
          required
          readOnly={mode === 'update'}
        />
        <Field
          label="Час (Київ)"
          name="lessonTime"
          type="time"
          value={lesson?.lessonTime}
          readOnly={mode === 'update' && !!lesson?.lessonTime}
        />
        <Field
          label="Платформа зустрічі"
          name="lessonPlatform"
          value={lesson?.lessonPlatform ?? ''}
        />
        <Field
          label="Посилання зустрічі"
          name="meetingLink"
          type="url"
          value={lesson?.meetingLink}
        />
        <Field
          label="Дата запису *"
          name="bookingDate"
          type="date"
          value={
            mode === 'book' ? businessDate(now) : (lesson?.bookingDate ?? '')
          }
          required={mode === 'book' || lesson?.bookingDate !== null}
          readOnly={mode === 'reschedule' || !!lesson?.rescheduledFromId}
        />
        {mode === 'reschedule' && (
          <Field label="Причина перенесення *" name="reason" required />
        )}
      </SaveForm>
    </EditDialog>
  );
}
