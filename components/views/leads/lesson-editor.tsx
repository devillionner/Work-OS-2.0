'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import type { LeadDetail } from '@/lib/leads/application/queries';
import { businessDate } from '@/lib/leads/domain/time';
import { lessonDateRecommendations } from '@/lib/leads/domain/lesson-recommendations';
import { SUBJECT_OPTIONS } from '@/lib/subjects';
import type { Mutation } from './client';
import { EditDialog, Field, SaveForm, SelectField, textValue } from './form';

/** Запис на урок, перенесення або зміна даних уроку. */
export function LessonEditor({ detail, lesson, mode, mutate, close }: {
  detail: LeadDetail;
  lesson?: LeadDetail['lessons'][number];
  mode: 'book' | 'update' | 'reschedule';
  mutate: Mutation;
  close: () => void;
}) {
  const [now] = useState(() => Math.floor(Date.now() / 1000));
  const [lessonDate, setLessonDate] = useState(lesson?.lessonDate ?? '');
  const recommendations = lessonDateRecommendations(now);
  return (
    <EditDialog
      title={mode === 'reschedule' ? 'Перенести урок' : mode === 'update' ? 'Дані уроку' : 'Записати на урок'}
      close={close}
      description="Час уроку вказуй за Києвом. Без викладача, часу чи посилання нагадування чекатимуть даних."
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
            ...(mode !== 'book' && lesson?.bookingDate === null && !textValue(f, 'bookingDate') ? {} : { bookingDate: textValue(f, 'bookingDate') }),
          };
          if (mode === 'book' && detail.curatorRequests.length) data.curatorRequestId = textValue(f, 'curatorRequestId');
          if (mode === 'reschedule') data.reason = textValue(f, 'reason');
          await mutate(`lesson_${mode}`, data, mode === 'book' ? undefined : lesson?.id);
          close();
        }}
      >
        {mode === 'book' && detail.curatorRequests.length > 0 ? (
          <SelectField label="Підтвердити запит куратору" name="curatorRequestId" value={detail.curatorRequests[0].id} options={detail.curatorRequests.map((request) => ({ value: request.id, label: `Запит від ${request.submittedDate}` }))} />
        ) : null}
        <Field label="Предмет *" name="subject" value={lesson?.subject ?? detail.lead.subject} required suggestions={SUBJECT_OPTIONS} />
        <SelectField
          label="Учень"
          name="studentId"
          value={lesson?.studentId ?? ''}
          options={[
            ...(mode !== 'book' || detail.lead.isStudent === 1 ? [{ value: '', label: `${detail.lead.name} (сам контакт)` }] : []),
            ...detail.students.map((student) => ({ value: student.id, label: `${student.name} ${student.surname}`.trim() })),
          ]}
        />
        <Field label="Викладач" name="teacherName" value={lesson?.teacherName} />
        {mode === 'book' ? (
          <div className="flex flex-col gap-2">
            <span className="text-xs font-medium text-ink-2">Рекомендована дата</span>
            <div className="flex flex-wrap gap-2">
              {recommendations.map((recommendation) => (
                <Button key={recommendation.date} type="button" variant="outline" size="sm" onClick={() => setLessonDate(recommendation.date)}>
                  {recommendation.label} · {recommendation.date}
                </Button>
              ))}
            </div>
          </div>
        ) : null}
        <Field key={lessonDate || 'lesson-date'} label="Дата уроку *" name="lessonDate" type="date" value={lessonDate} required readOnly={mode === 'update'} />
        <Field label="Час (Київ)" name="lessonTime" type="time" value={lesson?.lessonTime} readOnly={mode === 'update' && !!lesson?.lessonTime} />
        <Field label="Платформа зустрічі" name="lessonPlatform" value={lesson?.lessonPlatform ?? ''} />
        <Field label="Посилання зустрічі" name="meetingLink" type="url" value={lesson?.meetingLink} />
        <Field label="Дата запису *" name="bookingDate" type="date" value={mode === 'book' ? businessDate(now) : (lesson?.bookingDate ?? '')} required={mode === 'book' || lesson?.bookingDate !== null} readOnly={mode === 'reschedule' || !!lesson?.rescheduledFromId} />
        {mode === 'reschedule' ? <Field label="Причина перенесення *" name="reason" required /> : null}
      </SaveForm>
    </EditDialog>
  );
}
