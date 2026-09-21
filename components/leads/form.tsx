'use client';
import {
  createContext,
  useContext,
  useId,
  useRef,
  useState,
  type ReactNode,
} from 'react';
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
import { labels } from './client';
const DialogBusy = createContext<((busy: boolean) => void) | null>(null);
export function Field({
  label,
  name,
  value = '',
  type = 'text',
  required = false,
  min,
  max,
  readOnly = false,
  suggestions,
}: {
  label: string;
  name: string;
  value?: string | number;
  type?: string;
  required?: boolean;
  min?: number;
  max?: number;
  readOnly?: boolean;
  suggestions?: readonly string[];
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
        list={suggestions?.length ? `${id}-suggestions` : undefined}
      />
      {suggestions?.length ? (
        <datalist id={`${id}-suggestions`}>
          {suggestions.map((suggestion) => (
            <option key={suggestion} value={suggestion}>{suggestion}</option>
          ))}
        </datalist>
      ) : null}
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
  const [busy, setBusy] = useState(false);
  return (
    <DialogBusy.Provider value={setBusy}>
      <Dialog
        open
        onOpenChange={(open) => {
          if (!open && !busy) close();
        }}
      >
        <DialogContent className="lead-dialog" showCloseButton={!busy}>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
          {children}
        </DialogContent>
      </Dialog>
    </DialogBusy.Provider>
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
  const [saveSnapshot] = useState(() => save);
  const dialogBusy = useContext(DialogBusy);
  const submitting = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  return (
    <form
      className="lead-form"
      onSubmit={async (e) => {
        e.preventDefault();
        if (submitting.current) return;
        submitting.current = true;
        dialogBusy?.(true);
        const data = new FormData(e.currentTarget);
        setBusy(true);
        setError('');
        try {
          await saveSnapshot(data);
        } catch (cause) {
          setError(
            cause instanceof Error ? cause.message : 'Не вдалося зберегти.',
          );
        } finally {
          submitting.current = false;
          dialogBusy?.(false);
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
export {
  textValue,
  epochValue,
  datetimeValue,
} from '@/lib/leads/client/form-values';
