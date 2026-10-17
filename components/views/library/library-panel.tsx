'use client';

import { useId, useMemo, useRef, useState } from 'react';
import { Panel } from '@/components/shell/panel';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { Field } from '@/components/ui/field';
import { Ghost } from '@/components/ui/ghost';
import { Input, Textarea } from '@/components/ui/input';
import { MultiSelect, SearchSelect, type SearchOption } from '@/components/ui/combobox';
import { Segmented } from '@/components/ui/segmented';
import { Select } from '@/components/ui/select';
import { useToast } from '@/components/ui/toast';
import { useRemote } from '@/components/views/shared/use-remote';
import { LIBRARY_ADVERTISEMENT_PLATFORMS, canonicalLibraryPlatform, cleanLibraryPlatforms } from '@/lib/library';
import { FUNNEL_STAGES } from '@/lib/leads/domain/validation';
import { sameName, type Dictionaries } from '@/lib/library-dictionaries';
import type { ScriptFieldKey } from '@/lib/script-fields';
import { labels as leadLabels } from '@/components/views/leads/client';
import { InsertFieldMenu, ScriptTextEditor } from './script-editor';
import { ViberCard } from './viber-card';
import { collectionLabel, formFromItem, formatStamp, newForm, platformLabel, type Form, type Item, type LibraryCollectionKey } from './types';
import { humanError } from '@/components/ui/human-error';

type PanelTab = 'edit' | 'history';
type Version = {
  id: string; versionNumber: number; action: 'create' | 'update' | 'archive' | 'restore'; collection: string; title: string;
  ukText: string; ruText: string; notes: string; tags: string[]; platforms: string[]; archivedAt: number | null; savedAt: number;
};
const ACTIONS: Record<string, string> = { create: 'Створено', update: 'Оновлено', archive: 'Архівовано', restore: 'Відновлено' };

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

type DictionaryPayload = { dictionaries: Dictionaries };
const STAGE_NONE = '';
const NO_BRANCH = '__none';

const toOptions = (names: readonly string[]): SearchOption[] => names.map((name) => ({ value: name, label: name }));
const withValues = (names: readonly string[], values: readonly string[]) => [...names, ...values.filter((value) => !names.some((name) => sameName(name, value)))];

/** Inspector матеріалу: «Матеріал» (редактор) й «Історія»; збереження створює нову версію. */
export function LibraryPanel({ open, onOpenChange, collection, item, onSaved, onChanged, onMakePersonal }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  collection: LibraryCollectionKey;
  item: Item | null;
  onSaved: (item: Item) => void;
  onChanged: (closePanel: boolean) => void;
  /** Офіційний скрипт → власна копія в «Особистих скриптах». */
  onMakePersonal?: (item: Item) => void;
}) {
  const toast = useToast();
  const id = useId();
  const [tab, setTab] = useState<PanelTab>('edit');
  const [language, setLanguage] = useState<'uk' | 'ru'>('uk');
  const [form, setForm] = useState<Form>(() => (item ? formFromItem(item) : newForm(collection)));
  const [saving, setSaving] = useState(false);
  const [archiveAsk, setArchiveAsk] = useState(false);
  const insertRef = useRef<(key: ScriptFieldKey) => void>(() => {});
  const [created, setCreated] = useState<{ tags: string[]; branches: string[] }>({ tags: [], branches: [] });
  const dictionaries = useRemote<DictionaryPayload>('/api/library/dictionaries', { enabled: open, revalidateOnEnable: true, fallback: 'Не вдалося завантажити довідники.' }).data?.dictionaries ?? null;
  const ad = collection === 'advertisement';
  const script = collection === 'official_script' || collection === 'personal_script';
  const knowledge = collection === 'knowledge';
  const archived = item?.archivedAt != null;
  const locked = saving || archived;

  const directionNames = useMemo(() => withValues(dictionaries?.directions ?? [], form.tags.filter((tag) => (dictionaries?.directions ?? []).some((name) => sameName(name, tag)))), [dictionaries, form.tags]);
  const selectedDirections = form.tags.filter((tag) => directionNames.some((name) => sameName(name, tag)));
  const selectedTags = form.tags.filter((tag) => !selectedDirections.includes(tag));
  const tagNames = useMemo(() => withValues([...(dictionaries?.tags ?? []), ...created.tags], selectedTags), [dictionaries, created.tags, selectedTags]);
  const branchNames = useMemo(() => withValues([...(dictionaries?.branches ?? []), ...created.branches], form.branch ? [form.branch] : []), [dictionaries, created.branches, form.branch]);
  const platformOptions: SearchOption[] = useMemo(() => withValues([...LIBRARY_ADVERTISEMENT_PLATFORMS], form.platforms).map((value) => ({ value, label: platformLabel(value) })), [form.platforms]);
  const unsupported = ad && item ? item.platforms.filter((value) => !canonicalLibraryPlatform(value)) : [];
  const incomplete = ad && (!form.ukText.trim() || !form.ruText.trim());
  const canSave = Boolean(form.title.trim()) && (ad ? !incomplete && form.platforms.length > 0 : Boolean(form.ukText.trim() || form.ruText.trim()));
  const currentKey = language === 'uk' ? 'ukText' : 'ruText';

  const set = (patch: Partial<Form>) => setForm((current) => ({ ...current, ...patch }));

  const save = async () => {
    setSaving(true);
    try {
      const response = await fetch('/api/library', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'save', id: item?.id, version: item?.version, collection, ...form }) });
      const body = await response.json().catch(() => ({})) as { id?: string; version?: number; updatedAt?: number; error?: string };
      if (!response.ok) throw new Error(body.error || 'Не вдалося зберегти матеріал.');
      if (!body.id || !body.version || !body.updatedAt) throw new Error('Не вдалося підтвердити збереження.');
      onSaved({
        id: body.id, kind: ad ? 'advertisement' : 'script', collection, version: body.version, title: form.title.trim(), ukText: form.ukText, ruText: form.ruText, notes: form.notes,
        tags: [...form.tags], platforms: [...form.platforms], stage: script && form.stage ? form.stage : null, branch: script ? form.branch : '', originId: item?.originId ?? null, templateKey: item?.templateKey ?? null,
        usedTodayPlatforms: item?.usedTodayPlatforms ?? [], archivedAt: null, updatedAt: body.updatedAt,
      });
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

  const copy = async () => {
    const text = form[currentKey];
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      toast.push({ message: `Скопійовано ${language === 'uk' ? 'UA' : 'RU'}.` });
    } catch {
      toast.push({ message: 'Не вдалося скопіювати текст.', tone: 'hot' });
    }
  };

  const languageLabel = (code: 'uk' | 'ru') => {
    const base = code === 'uk' ? 'Українська' : 'Російська';
    return ad && !form[code === 'uk' ? 'ukText' : 'ruText'].trim() ? `${base} · порожньо` : base;
  };
  const placeholder = language === 'uk' ? (knowledge ? 'Інструкція або відповідь українською' : 'Текст українською') : (knowledge ? 'Російська версія, якщо потрібна' : 'Текст російською');

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
            <span className="flex items-center gap-1">
              {item ? <Button variant="ghost" size="sm" disabled={saving} onClick={() => (archived ? void changeArchive() : setArchiveAsk(true))}>{archived ? 'Відновити' : 'В архів'}</Button> : null}
              {item && collection === 'official_script' && onMakePersonal && !archived ? <Button variant="outline" size="sm" disabled={saving} onClick={() => onMakePersonal(item)}>Зробити свою версію</Button> : null}
            </span>
            {archived ? null : <Button variant="action" size="sm" busy={saving} disabled={!canSave} onClick={() => void save()}>{saving ? 'Зберігаємо…' : 'Зберегти нову версію'}</Button>}
          </div>
        ) : undefined}
      >
        {item && tab === 'history' ? <History item={item} /> : (
          <div className="flex flex-col gap-5">
            {archived ? <p className="m-0 text-[13px] text-ink-2">Матеріал в архіві: щоб редагувати, спершу відновити його.</p> : null}
            {item?.originId ? <p className="m-0 text-[13px] text-ink-2">Власна версія офіційного скрипту: оригіналу це не змінює.</p> : null}
            <Field label="Назва" htmlFor={`${id}-title`}>
              <Input id={`${id}-title`} disabled={locked} value={form.title} onChange={(event) => set({ title: event.target.value })} placeholder={knowledge ? 'Як підготувати учня до пробного' : script ? 'Привітання після відгуку' : 'Англійська — батьки школярів'} />
            </Field>

            <div className="flex flex-col gap-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Segmented<'uk' | 'ru'> label="Мова тексту" size="sm" value={language} onValueChange={setLanguage} items={[{ value: 'uk', label: languageLabel('uk') }, { value: 'ru', label: languageLabel('ru') }]} />
                <span className="flex items-center gap-1">
                  {script ? <InsertFieldMenu disabled={locked} onPick={(key) => insertRef.current(key)} /> : null}
                  {form[currentKey] ? <Button variant="ghost" size="sm" onClick={() => void copy()}>Копіювати</Button> : null}
                </span>
              </div>
              {script ? (
                <ScriptTextEditor key={language} id={`${id}-text`} value={form[currentKey]} onChange={(value) => set({ [currentKey]: value })} disabled={locked} placeholder={placeholder} inserter={(insert) => { insertRef.current = insert; }} />
              ) : (
                <Textarea id={`${id}-text`} disabled={locked} rows={8} value={form[currentKey]} onChange={(event) => set({ [currentKey]: event.target.value })} placeholder={placeholder} />
              )}
              <p className="m-0 flex items-center justify-between gap-3 text-xs text-ink-2">
                <span>{incomplete ? 'Оголошення має містити обидві мовні версії.' : script ? 'Поля в дужках підставляються з даних ліда й уроку.' : ''}</span>
                <span className="font-mono">{form[currentKey].length} симв.</span>
              </p>
            </div>

            <div className="flex flex-col gap-4">
              <Field label="Платформи" hint={ad ? 'Де це оголошення можна публікувати' : 'Порожньо: для всіх платформ'}>
                <MultiSelect options={platformOptions} values={form.platforms} onChange={(values) => set({ platforms: values })} disabled={locked} placeholder="Додати платформу" searchPlaceholder="Пошук платформи" />
              </Field>
              <Field label="Напрямки" hint="Без вибраного матеріал універсальний">
                <MultiSelect options={toOptions(directionNames)} values={selectedDirections} onChange={(values) => set({ tags: [...values, ...selectedTags] })} disabled={locked} placeholder="Додати напрямок" searchPlaceholder="Пошук напрямку" />
              </Field>
              <Field label="Теги">
                <MultiSelect
                  options={toOptions(tagNames)}
                  values={selectedTags}
                  onChange={(values) => set({ tags: [...selectedDirections, ...values] })}
                  onCreate={(name) => setCreated((current) => ({ ...current, tags: [...current.tags, name] }))}
                  disabled={locked}
                  placeholder="Додати тег"
                  searchPlaceholder="Пошук або новий тег"
                />
              </Field>
              {script ? (
                <>
                  <Field label="Етап воронки" hint="До якого етапу ліда скрипт підходить">
                    <Select value={form.stage || STAGE_NONE} disabled={locked} onChange={(event) => set({ stage: event.target.value })}>
                      <option value={STAGE_NONE}>Будь-який етап</option>
                      {FUNNEL_STAGES.map((stage) => <option key={stage} value={stage}>{leadLabels[stage] ?? stage}</option>)}
                    </Select>
                  </Field>
                  <Field label="Гілка" hint="Інтерес ліда, наприклад «екзамени»">
                    <SearchSelect
                      options={[{ value: NO_BRANCH, label: 'Без гілки' }, ...toOptions(branchNames)]}
                      value={form.branch || NO_BRANCH}
                      onChange={(value) => set({ branch: !value || value === NO_BRANCH ? '' : value })}
                      onCreate={(name) => { setCreated((current) => ({ ...current, branches: [...current.branches, name] })); set({ branch: name }); }}
                      disabled={locked}
                      placeholder="Без гілки"
                      searchPlaceholder="Пошук або нова гілка"
                    />
                  </Field>
                </>
              ) : null}
            </div>

            <Field label="Нотатка" htmlFor={`${id}-notes`} hint="Коли та де використовувати">
              <Textarea id={`${id}-notes`} disabled={locked} rows={2} value={form.notes} onChange={(event) => set({ notes: event.target.value })} />
            </Field>
            {ad ? (
              <>
                {item && item.usedTodayPlatforms.length ? <p className="m-0 text-[13px] text-ink-2">Сьогодні вже використано: {cleanLibraryPlatforms(item.usedTodayPlatforms).map(platformLabel).join(', ')}.</p> : null}
                {unsupported.length ? <p className="m-0 text-[13px] text-ink-2">Є старі невідомі платформи: {unsupported.join(', ')}. Обери актуальні зі списку перед збереженням.</p> : null}
                {item && item.archivedAt === null && cleanLibraryPlatforms(item.platforms).includes('viber') ? <ViberCard key={item.id} item={item} /> : null}
              </>
            ) : null}
          </div>
        )}
      </Panel>
      {archiveAsk ? <ConfirmDialog
        open
        title="Перемістити матеріал в архів?"
        description={item ? `«${item.title}» зникне з активної бібліотеки, але його можна буде відновити з архіву.` : ''}
        confirmLabel="В архів"
        destructive
        busy={saving}
        onCancel={() => setArchiveAsk(false)}
        onConfirm={() => void changeArchive()}
      /> : null}
    </>
  );
}
