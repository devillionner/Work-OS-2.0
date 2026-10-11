'use client';

import { useId, useState, type ReactNode } from 'react';
import { Panel } from '@/components/shell/panel';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { Field } from '@/components/ui/field';
import { Ghost } from '@/components/ui/ghost';
import { Input, Textarea } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/toggle';
import { useToast } from '@/components/ui/toast';
import { useRemote } from '@/components/views/shared/use-remote';
import { LIBRARY_ADVERTISEMENT_PLATFORMS, canonicalLibraryPlatform, cleanLibraryPlatforms } from '@/lib/library';
import { SUBJECT_OPTIONS, canonicalKnownSubject } from '@/lib/subjects';
import { ViberCard } from './viber-card';
import { collectionLabel, formFromItem, formatStamp, newForm, platformLabel, splitList, updateDirectionChoice, updatePlatformChoice, type Collection, type Form, type Item } from './types';
import { humanError } from '@/components/ui/human-error';

type PanelTab = 'edit' | 'history';
type Version = {
  id: string; versionNumber: number; action: 'create' | 'update' | 'archive' | 'restore'; collection: string; title: string;
  ukText: string; ruText: string; notes: string; tags: string[]; platforms: string[]; archivedAt: number | null; savedAt: number;
};
const ACTIONS: Record<string, string> = { create: 'Створено', update: 'Оновлено', archive: 'Архівовано', restore: 'Відновлено' };

function Choice({ checked, disabled, onChange, children }: { checked: boolean; disabled: boolean; onChange: (checked: boolean) => void; children: ReactNode }) {
  return (
    <label className="flex min-h-9 items-center gap-2.5 rounded-field border border-line px-3 text-sm">
      <Checkbox checked={checked} disabled={disabled} onCheckedChange={(next) => onChange(next === true)} />
      <span className="min-w-0 truncate">{children}</span>
    </label>
  );
}

function History({ item }: { item: Item }) {
  const [attempt, setAttempt] = useState(0);
  const { data, error } = useRemote<{ versions?: Version[] }>(`/api/library/history?id=${encodeURIComponent(item.id)}`, { refresh: attempt, fallback: 'Не вдалося завантажити історію.' });
  const versions = data?.versions ?? null;
  if (error && !versions) {
    return (
      <div className="flex flex-col items-start gap-3">
        <p role="alert" className="m-0 text-sm text-hot">{error}</p>
        <Button variant="outline" size="sm" onClick={() => setAttempt((value) => value + 1)}>Спробувати ще раз</Button>
      </div>
    );
  }
  if (!versions) return <div aria-busy="true" className="flex flex-col gap-3"><Ghost className="h-16 rounded-inner" /><Ghost className="h-16 rounded-inner" /><Ghost className="h-16 rounded-inner" /></div>;
  if (versions.length === 0) return <EmptyState text="Історія цього матеріалу ще порожня." />;
  return (
    <ol className="m-0 flex list-none flex-col gap-3 p-0">
      {versions.map((version) => (
        <li key={version.id} className="rounded-inner border border-line">
          <details>
            <summary className="flex cursor-pointer items-center justify-between gap-3 px-4 py-3">
              <span className="min-w-0">
                <span className="block text-sm font-medium"><span className="font-mono">v{version.versionNumber}</span> · {ACTIONS[version.action] ?? version.action}</span>
                {version.title !== item.title ? <span className="block truncate text-xs text-ink-2">{version.title}</span> : null}
              </span>
              <time dateTime={new Date(version.savedAt * 1000).toISOString()} className="shrink-0 font-mono text-xs text-ink-2">{formatStamp(version.savedAt)}</time>
            </summary>
            <div className="flex flex-col gap-2 px-4 pb-4">
              {version.notes ? <p className="m-0 text-xs text-ink-2">{version.notes}</p> : null}
              {version.ukText ? <pre className="m-0 whitespace-pre-wrap rounded-field bg-sunken p-3 font-sans text-[13px]">{version.ukText}</pre> : null}
              {version.ruText ? <pre className="m-0 whitespace-pre-wrap rounded-field bg-sunken p-3 font-sans text-[13px]">{version.ruText}</pre> : null}
              <p className="m-0 text-xs text-ink-2">Теги: {version.tags.join(', ') || '—'} · Платформи: {version.platforms.join(', ') || '—'}</p>
            </div>
          </details>
        </li>
      ))}
    </ol>
  );
}

/** Inspector матеріалу: вкладки «Матеріал» і «Історія»; збереження створює нову версію. */
export function LibraryPanel({ open, onOpenChange, collection, item, onSaved, onChanged }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  collection: Collection;
  item: Item | null;
  onSaved: (item: Item) => void;
  onChanged: (closePanel: boolean) => void;
}) {
  const toast = useToast();
  const id = useId();
  const [tab, setTab] = useState<PanelTab>('edit');
  const [form, setForm] = useState<Form>(() => (item ? formFromItem(item) : newForm(collection)));
  const [saving, setSaving] = useState(false);
  const [archiveAsk, setArchiveAsk] = useState(false);
  const ad = collection === 'advertisement';
  const knowledge = collection === 'knowledge';
  const archived = item?.archivedAt != null;
  const locked = saving || archived;
  const directions = SUBJECT_OPTIONS.filter((subject) => form.tags.some((tag) => canonicalKnownSubject(tag) === subject));
  const extraTags = form.tags.filter((tag) => canonicalKnownSubject(tag) === null);
  const unsupported = ad && item ? item.platforms.filter((value) => !canonicalLibraryPlatform(value)) : [];
  const incomplete = ad && (!form.ukText.trim() || !form.ruText.trim());
  const canSave = Boolean(form.title.trim()) && (ad ? !incomplete && form.platforms.length > 0 : Boolean(form.ukText.trim() || form.ruText.trim()));

  const set = (patch: Partial<Form>) => setForm((current) => ({ ...current, ...patch }));

  const save = async () => {
    setSaving(true);
    try {
      const response = await fetch('/api/library', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'save', id: item?.id, version: item?.version, collection, ...form }) });
      const body = await response.json().catch(() => ({})) as { id?: string; version?: number; updatedAt?: number; error?: string };
      if (!response.ok) throw new Error(body.error || 'Не вдалося зберегти матеріал.');
      if (!body.id || !body.version || !body.updatedAt) throw new Error('Не вдалося підтвердити збереження.');
      onSaved({ id: body.id, kind: ad ? 'advertisement' : 'script', collection, version: body.version, title: form.title.trim(), ukText: form.ukText, ruText: form.ruText, notes: form.notes, tags: [...form.tags], platforms: [...form.platforms], usedTodayPlatforms: item?.usedTodayPlatforms ?? [], archivedAt: null, updatedAt: body.updatedAt });
      toast.push({ message: `Збережено · v${body.version}.`, tone: 'ok' });
    } catch (reason) {
      toast.push({ message: humanError(reason, 'Не вдалося зберегти матеріал.'), tone: 'hot', duration: 7000 });
      onChanged(false);
    } finally {
      setSaving(false);
    }
  };

  const changeArchive = async () => {
    if (!item) return;
    const action = item.archivedAt === null ? 'archive' : 'restore';
    setSaving(true);
    try {
      const response = await fetch('/api/library', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, id: item.id, version: item.version }) });
      const body = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(body.error || 'Не вдалося змінити матеріал.');
      toast.push({ message: action === 'archive' ? 'Переміщено в архів.' : 'Матеріал відновлено.', tone: 'ok' });
      setArchiveAsk(false);
      onChanged(true);
    } catch (reason) {
      toast.push({ message: humanError(reason, 'Не вдалося змінити матеріал.'), tone: 'hot' });
      onChanged(false);
    } finally {
      setSaving(false);
    }
  };

  const copy = async (text: string, language: 'uk' | 'ru') => {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      toast.push({ message: `Скопійовано ${language === 'uk' ? 'UA' : 'RU'}.` });
    } catch {
      toast.push({ message: 'Не вдалося скопіювати текст.', tone: 'hot' });
    }
  };

  const language = (key: 'ukText' | 'ruText', code: 'uk' | 'ru') => {
    const label = code === 'uk'
      ? knowledge ? 'Інструкція або відповідь українською' : ad ? 'Українська версія · обов’язково' : 'Українська версія'
      : knowledge ? 'Російська версія, якщо потрібна' : ad ? 'Російська версія · обов’язково' : 'Російська версія';
    return (
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between gap-2">
          <label htmlFor={`${id}-${code}`} className="text-xs font-medium text-ink-2">{label}</label>
          {form[key] ? (
            <span className="flex items-center gap-1">
              <span className="font-mono text-xs text-ink-2">{form[key].length} симв.</span>
              <Button variant="ghost" size="sm" className="h-7 px-2.5 text-xs" onClick={() => void copy(form[key], code)}>{`Копіювати ${code === 'uk' ? 'UA' : 'RU'}`}</Button>
            </span>
          ) : null}
        </div>
        <Textarea id={`${id}-${code}`} disabled={locked} rows={7} value={form[key]} onChange={(event) => set({ [key]: event.target.value })} placeholder={code === 'uk' ? 'Текст українською' : 'Текст російською'} />
      </div>
    );
  };

  return (
    <>
      <Panel<PanelTab>
        open={open}
        onOpenChange={onOpenChange}
        title={item ? item.title : 'Новий матеріал'}
        subtitle={item ? `${collectionLabel(collection)} · v${item.version}` : collectionLabel(collection)}
        tabs={item ? [{ value: 'edit', label: 'Матеріал' }, { value: 'history', label: 'Історія' }] : undefined}
        tab={item ? tab : undefined}
        onTabChange={item ? setTab : undefined}
        footer={tab === 'edit' || !item ? (
          <div className="flex items-center justify-between gap-3">
            {item ? <Button variant="ghost" size="sm" disabled={saving} onClick={() => (archived ? void changeArchive() : setArchiveAsk(true))}>{archived ? 'Відновити' : 'В архів'}</Button> : <span />}
            {archived ? null : <Button variant="action" size="sm" busy={saving} disabled={!canSave} onClick={() => void save()}>{saving ? 'Зберігаємо…' : 'Зберегти нову версію'}</Button>}
          </div>
        ) : undefined}
      >
        {item && tab === 'history' ? <History item={item} /> : (
          <div className="flex flex-col gap-5">
            {archived ? <p className="m-0 text-[13px] text-ink-2">Матеріал в архіві: щоб редагувати, спершу відновити його.</p> : null}
            <Field label="Назва" htmlFor={`${id}-title`}>
              <Input id={`${id}-title`} disabled={locked} value={form.title} onChange={(event) => set({ title: event.target.value })} placeholder={knowledge ? 'Як підготувати учня до пробного' : 'Англійська — батьки школярів'} />
            </Field>
            {language('ukText', 'uk')}
            {language('ruText', 'ru')}
            {incomplete ? <p className="m-0 text-[13px] text-ink-2">Оголошення має містити обидві мовні версії. Старий однолокальний матеріал не видаляється, але нову версію можна зберегти лише після заповнення UA і RU.</p> : null}
            <Field label="Нотатка" htmlFor={`${id}-notes`}>
              <Textarea id={`${id}-notes`} disabled={locked} rows={3} value={form.notes} onChange={(event) => set({ notes: event.target.value })} placeholder="Коли та де використовувати" />
            </Field>
            {ad ? (
              <>
                <fieldset className="m-0 flex min-w-0 flex-col gap-2 border-0 p-0">
                  <legend className="mb-1 text-xs font-medium text-ink-2">Платформи — де це оголошення можна публікувати</legend>
                  <div className="grid grid-cols-2 gap-2">
                    {LIBRARY_ADVERTISEMENT_PLATFORMS.map((value) => (
                      <Choice key={value} checked={form.platforms.includes(value)} disabled={locked} onChange={(checked) => set({ platforms: updatePlatformChoice(form.platforms, value, checked) })}>{platformLabel(value)}</Choice>
                    ))}
                  </div>
                </fieldset>
                <fieldset className="m-0 flex min-w-0 flex-col gap-2 border-0 p-0">
                  <legend className="mb-1 text-xs font-medium text-ink-2">Напрямки — без вибраного матеріал універсальний</legend>
                  <div className="grid grid-cols-2 gap-2">
                    {SUBJECT_OPTIONS.map((subject) => (
                      <Choice key={subject} checked={directions.includes(subject)} disabled={locked} onChange={(checked) => set({ tags: updateDirectionChoice(form.tags, subject, checked) })}>{subject}</Choice>
                    ))}
                  </div>
                </fieldset>
                <Field label="Додаткові теги" htmlFor={`${id}-extra`}>
                  <Input id={`${id}-extra`} disabled={locked} value={extraTags.join(', ')} onChange={(event) => set({ tags: [...directions, ...splitList(event.target.value)] })} placeholder="батьки, НМТ, 1–4 клас" />
                </Field>
                {item && item.usedTodayPlatforms.length ? <p className="m-0 text-[13px] text-ink-2">Сьогодні вже використано: {cleanLibraryPlatforms(item.usedTodayPlatforms).map(platformLabel).join(', ')}. Повтор на тій самій платформі залежить від наявності невикористаних придатних оголошень.</p> : null}
                {unsupported.length ? <p className="m-0 text-[13px] text-ink-2">Є старі невідомі платформи: {unsupported.join(', ')}. Обери актуальні зі списку перед збереженням.</p> : null}
                {item && item.archivedAt === null && cleanLibraryPlatforms(item.platforms).includes('viber') ? <ViberCard key={item.id} item={item} /> : null}
              </>
            ) : (
              <div className="flex flex-col gap-4">
                <Field label="Теги" htmlFor={`${id}-tags`}>
                  <Input id={`${id}-tags`} disabled={locked} value={form.tags.join(', ')} onChange={(event) => set({ tags: splitList(event.target.value) })} placeholder={knowledge ? 'бот, підготовка, техпідтримка' : 'відповідь, запис, ціна'} />
                </Field>
                <Field label="Платформи" htmlFor={`${id}-platforms`}>
                  <Input id={`${id}-platforms`} disabled={locked} value={form.platforms.join(', ')} onChange={(event) => set({ platforms: splitList(event.target.value) })} placeholder="telegram, viber" />
                </Field>
              </div>
            )}
          </div>
        )}
      </Panel>
      <ConfirmDialog
        open={archiveAsk}
        title="Перемістити матеріал в архів?"
        description={item ? `«${item.title}» зникне з активної бібліотеки, але його можна буде відновити з архіву.` : ''}
        confirmLabel="В архів"
        destructive
        busy={saving}
        onCancel={() => setArchiveAsk(false)}
        onConfirm={() => void changeArchive()}
      />
    </>
  );
}
