'use client';

import { createContext, useContext, useId, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { ArrowLeft } from 'lucide-react';
import { Panel, usePanelOverlay } from '@/components/shell/panel';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Input, Textarea } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { labels } from './client';
import { humanError } from '@/components/ui/human-error';

const BusyContext = createContext<((busy: boolean) => void) | null>(null);

export function Field({ label, name, value = '', type = 'text', required = false, min, max, readOnly = false, suggestions }: {
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
    <div className="flex min-w-0 flex-col gap-1.5">
      <label htmlFor={id} className="text-xs font-medium text-ink-2">{label}</label>
      <Input id={id} name={name} defaultValue={value} type={type} required={required} min={min} max={max} readOnly={readOnly} list={suggestions?.length ? `${id}-suggestions` : undefined} />
      {suggestions?.length ? <datalist id={`${id}-suggestions`}>{suggestions.map((item) => <option key={item} value={item}>{item}</option>)}</datalist> : null}
    </div>
  );
}

export function SelectField({ label, name, value = '', options }: { label: string; name: string; value?: string; options: readonly string[] | Array<{ value: string; label: string }> }) {
  const id = useId();
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <label htmlFor={id} className="text-xs font-medium text-ink-2">{label}</label>
      <Select id={id} name={name} defaultValue={value}>
        {options.map((option) => typeof option === 'string'
          ? <option key={option} value={option}>{labels[option] ?? option}</option>
          : <option key={option.value} value={option.value}>{option.label}</option>)}
      </Select>
    </div>
  );
}

export function NoteField({ label, name, value = '', required = false }: { label: string; name: string; value?: string; required?: boolean }) {
  const id = useId();
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <label htmlFor={id} className="text-xs font-medium text-ink-2">{label}</label>
      <Textarea id={id} name={name} defaultValue={value} required={required} rows={3} />
    </div>
  );
}

/**
 * Форма як крок усередині відкритої панелі (поверх її вмісту); без відкритої панелі — власна панель.
 * Замінює модальні діалоги редагування.
 */
export function EditDialog({ title, description = 'Зміни зберігаються у твоїй CRM.', close, children }: { title: string; description?: string; close: () => void; children: ReactNode }) {
  const [busy, setBusy] = useState(false);
  const overlay = usePanelOverlay();
  const content = <BusyContext.Provider value={setBusy}>{children}</BusyContext.Provider>;
  if (!overlay) {
    return <Panel open onOpenChange={(open) => { if (!open && !busy) close(); }} title={title} subtitle={description}>{content}</Panel>;
  }
  return createPortal(
    <div
      className="step-in flex min-h-0 flex-1 flex-col"
      onKeyDownCapture={(event) => {
        // Esc усередині відкритого списку чи меню (портал, але в дереві React) закриває лише його, а не крок.
        if (event.key !== 'Escape' || busy || (event.target instanceof Element && event.target.closest('[role="listbox"], [role="menu"]'))) return;
        event.preventDefault();
        event.stopPropagation();
        close();
      }}
    >
      <header className="flex shrink-0 items-start gap-2 px-4 pb-3 pt-4">
        <Button variant="icon" size="md" aria-label="Назад" disabled={busy} onClick={close}><ArrowLeft aria-hidden="true" strokeWidth={1.5} /></Button>
        <div className="min-w-0 pt-1.5">
          <h3 className="m-0 truncate text-[17px] font-medium">{title}</h3>
          <p className="m-0 mt-1 text-[13px] text-ink-2">{description}</p>
        </div>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-6">{content}</div>
    </div>,
    overlay,
  );
}

export function SaveForm({ children, save, label = 'Зберегти', cancel, columns = false }: { children: ReactNode; save: (data: FormData) => Promise<void>; label?: string; cancel?: () => void; columns?: boolean }) {
  const [saveSnapshot] = useState(() => save);
  const dialogBusy = useContext(BusyContext);
  const submitting = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  return (
    <form
      className="flex flex-col gap-5"
      onSubmit={async (event) => {
        event.preventDefault();
        if (submitting.current) return;
        submitting.current = true;
        dialogBusy?.(true);
        const data = new FormData(event.currentTarget);
        setBusy(true);
        setError('');
        try {
          await saveSnapshot(data);
        } catch (cause) {
          setError(humanError(cause, 'Не вдалося зберегти.'));
        } finally {
          submitting.current = false;
          dialogBusy?.(false);
          setBusy(false);
        }
      }}
    >
      <fieldset disabled={busy} className={cn('m-0 grid min-w-0 gap-4 border-0 p-0', columns && 'sm:grid-cols-2')}>{children}</fieldset>
      {error ? <p role="alert" className="m-0 text-sm text-hot">{error}</p> : null}
      <div className="flex justify-end gap-2">
        {cancel ? <Button type="button" variant="ghost" disabled={busy} onClick={cancel}>Скасувати</Button> : null}
        <Button type="submit" variant="action" busy={busy}>{busy ? 'Зберігаємо…' : label}</Button>
      </div>
    </form>
  );
}

/** Підтвердження дії — єдиний випадок модального вікна. */
export function Confirmation({ title, description, run, close }: { title: string; description: string; run: () => Promise<void>; close: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  return (
    <Dialog open onOpenChange={(open) => { if (!open && !busy) close(); }} title={title} description={description}>
      {error ? <p role="alert" className="m-0 text-sm text-hot">{error}</p> : null}
      <div className="flex justify-end gap-2">
        <Button variant="ghost" disabled={busy} onClick={close}>Скасувати</Button>
        <Button
          variant="action"
          busy={busy}
          onClick={async () => {
            setBusy(true);
            setError('');
            try { await run(); close(); } catch (cause) { setError(humanError(cause, 'Не вдалося виконати дію.')); } finally { setBusy(false); }
          }}
        >
          {busy ? 'Виконуємо…' : 'Підтвердити'}
        </Button>
      </div>
    </Dialog>
  );
}

export { textValue, epochValue, datetimeValue } from '@/lib/leads/client/form-values';
