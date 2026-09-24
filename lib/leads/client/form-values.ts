import { businessDateTime, lessonEpoch } from '../domain/time.ts';
export const textValue = (data: FormData, key: string) => {
  const value = data.get(key);
  return typeof value === 'string' ? value : '';
};
export function epochValue(
  data: FormData,
  key: string,
  original?: number | null,
): number | null {
  const value = textValue(data, key);
  if (original != null && value === datetimeValue(original)) return original;
  if (!value) return null;
  const [day, time] = value.split('T');
  const epoch = lessonEpoch(day, time);
  if (epoch === null)
    throw new Error('Некоректний або неоднозначний час за Києвом.');
  return epoch;
}
export const datetimeValue = (epoch: number | null | undefined) =>
  epoch == null ? '' : businessDateTime(epoch);
