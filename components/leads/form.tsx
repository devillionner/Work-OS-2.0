'use client';
import { useId, useState, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/native-select';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { businessDateTime, lessonEpoch } from '@/lib/leads/domain/time';
import { labels } from './client';
export function Field({
  label,
  name,
  value = '',
  type = 'text',
  required = false,
  min,
  max,
  readOnly = false,
}: {
  label: string;
  name: string;
  value?: string | number;
  type?: string;
  required?: boolean;
  min?: number;
  max?: number;
  readOnly?: boolean;
}) {
  const id = useId();
  return (
    <div className="lead-field">
      <label htmlFor={id}>{label}</label>
      <Input
        id={id}
        name={name}
        defaultValue={value}
        type={type}
        required={required}
        min={min}
        max={max}
        readOnly={readOnly}
      />
    </div>
  );
}
export function SelectField({
  label,
  name,
  value = '',
  options,
}: {
  label: string;
  name: string;
  value?: string;
  options: readonly string[] | Array<{ value: string; label: string }>;
}) {
  const id = useId();
  return (
    <div className="lead-field">
      <label htmlFor={id}>{label}</label>
      <NativeSelect id={id} name={name} defaultValue={value}>
        {options.map((o) =>
          typeof o === 'string' ? (
            <option key={o} value={o}>
              {labels[o] ?? o}
            </option>
          ) : (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ),
        )}
      </NativeSelect>
    </div>
  );
}
export function NoteField({
  label,
  name,
  value = '',
  required = false,
}: {
  label: string;
  name: string;
  value?: string;
  required?: boolean;
}) {
  const id = useId();
  return (
    <div className="lead-field lead-wide">
      <label htmlFor={id}>{label}</label>
      <Textarea
        id={id}
        name={name}
        defaultValue={value}
        required={required}
        rows={3}
      />
    </div>
  );
}
export function EditDialog({
  title,
  description = 'Зміни зберігаються у вашій CRM.',
  close,
  children,
}: {
  title: string;
  description?: string;
  close: () => void;
  children: ReactNode;
}) {
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) close();
      }}
    >
      <DialogContent className="lead-dialog">
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>{description}</DialogDescription>
        {children}
      </DialogContent>
    </Dialog>
  );
}
export function SaveForm({
  children,
  save,
  label = 'Зберегти',
  cancel,
}: {
  children: ReactNode;
  save: (data: FormData) => Promise<void>;
  label?: string;
  cancel?: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  return (
    <form
      className="lead-form"
      onSubmit={async (e) => {
        e.preventDefault();
        if (busy) return;
        const data = new FormData(e.currentTarget);
        setBusy(true);
        setError('');
        try {
          await save(data);
        } catch (cause) {
          setError(
            cause instanceof Error ? cause.message : 'Не вдалося зберегти.',
          );
        } finally {
          setBusy(false);
        }
      }}
    >
      <fieldset disabled={busy}>{children}</fieldset>
      {error && (
        <p className="lead-error" role="alert">
          {error}
        </p>
      )}
      <div className="lead-actions">
        {cancel && (
          <Button
            type="button"
            variant="outline"
            onClick={cancel}
            disabled={busy}
          >
            Скасувати
          </Button>
        )}
        <Button type="submit" disabled={busy}>
          {busy ? 'Зберігаємо…' : label}
        </Button>
      </div>
    </form>
  );
}
export function Confirmation({
  title,
  description,
  run,
  close,
}: {
  title: string;
  description: string;
  run: () => Promise<void>;
  close: () => void;
}) {
  return (
    <EditDialog title={title} description={description} close={close}>
      <SaveForm
        save={async () => {
          await run();
          close();
        }}
        label="Підтвердити"
        cancel={close}
      >
        <p>Підтвердьте дію.</p>
      </SaveForm>
    </EditDialog>
  );
}
export const textValue = (data: FormData, key: string) => {
  const value = data.get(key);
  return typeof value === 'string' ? value : '';
};
export function epochValue(data: FormData, key: string): number | null {
  const value = textValue(data, key);
  if (!value) return null;
  const [day, time] = value.split('T');
  const epoch = lessonEpoch(day, time);
  if (epoch === null)
    throw new Error('Некоректний або неоднозначний час за Києвом.');
  return epoch;
}
export const datetimeValue = (epoch: number | null | undefined) =>
  epoch == null ? '' : businessDateTime(epoch);
