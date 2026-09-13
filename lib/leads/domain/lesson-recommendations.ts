import { businessDate, shiftBusinessDate } from '../../business-time.ts';

export type LessonDateRecommendation = {
  label: 'Завтра' | 'Післязавтра';
  date: string;
};

export function lessonDateRecommendations(now: number): LessonDateRecommendation[] {
  const today = businessDate(now);
  return [
    { label: 'Завтра', date: shiftBusinessDate(today, 1) },
    { label: 'Післязавтра', date: shiftBusinessDate(today, 2) },
  ];
}
