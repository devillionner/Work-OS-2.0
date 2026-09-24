'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import type { LeadDetail } from '@/lib/leads/application/queries';
import { safeUrl } from '@/lib/leads/domain/validation';
import {
  getJson,
  createBrowserCommandClient,
  labels,
  type LeadList,
  type Mutation,
} from './client';
import { LeadEditor } from './lead-editor';
import { Confirmation } from './form';
import { Students } from './students';
import { FollowUp } from './follow-up';
import { LeadScripts } from './scripts';
import { Lessons } from './lessons';
import { Conversation } from './conversation';
import { LeadHistoryDialog } from './history';
import { TodayLeadsPanel } from './today-activity';
import { WorkspaceInitialLoading, WorkspaceRefreshIndicator } from '@/components/workspace-load-state';

const MOBILE_LIST_CHUNK = 12;

export function LeadsWorkspace({ account, initialLeadId, syncRevision=0, active=true }: { account: string; initialLeadId?: string | null; syncRevision?:number; active?:boolean }) {
  const [postCommand] = useState(() => createBrowserCommandClient(account));
  const [filter, setFilter] = useState('active');
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [offset, setOffset] = useState(0);
  const [mobileListState, setMobileListState] = useState({ key: '', count: MOBILE_LIST_CHUNK });
  const [list, setList] = useState<LeadList | null>(null);
  const [selected, setSelected] = useState<string | null>(initialLeadId ?? null);
  const [detail, setDetail] = useState<LeadDetail | null>(null);
  const [listError, setListError] = useState('');
  const [detailError, setDetailError] = useState('');
  const [listLoading, setListLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [editor, setEditor] = useState<'create' | 'update' | null>(null);
  const [archive, setArchive] = useState(false);
  const [responseChange, setResponseChange] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [notice, setNotice] = useState('');
  const busy = useRef(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const historyTrigger = useRef<HTMLButtonElement>(null);
  const focusSelection = useRef<string | null>(null);
  const detailCache = useRef(new Map<string,LeadDetail>());
  const lastSyncRevision = useRef(syncRevision);
  const lastInitialLeadId = useRef(initialLeadId ?? null);
  const reload = useCallback(() => setRefresh((v) => v + 1), []);
  const resetListControls = useCallback(() => {
    setFilter('active');
    setSearch('');
    setQuery('');
    setOffset(0);
  }, []);
  const copyText = useCallback(async (label: string, value: string) => {
    if (!value) return;
    if (!navigator.clipboard) {
      setNotice(`Не вдалося скопіювати ${label.toLowerCase()}. Скопіюйте вручну.`);
      return;
    }
    try {
      await navigator.clipboard.writeText(value);
      setNotice(`${label} скопійовано.`);
    } catch {
      setNotice(`Не вдалося скопіювати ${label.toLowerCase()}. Скопіюйте вручну.`);
    }
  }, []);
  const openLead = useCallback((id: string) => {
    focusSelection.current = id;
    setSelected(id);
    setDetailError('');
    setNotice('');
    if (window.matchMedia('(max-width: 1024px)').matches)
      requestAnimationFrame(() => window.scrollTo({ top: 0, behavior: 'smooth' }));
  }, []);
  useEffect(() => {
    const timer = setTimeout(() => {
      setQuery(search);
      setOffset(0);
    }, 250);
    return () => clearTimeout(timer);
  }, [search]);
  const mobileListKey = `${filter}:${query}:${offset}`;
  const mobileVisibleLeads = mobileListState.key === mobileListKey ? mobileListState.count : MOBILE_LIST_CHUNK;
  useEffect(() => {
    const controller = new AbortController();
    setListLoading(true);
    const url = `/api/leads?view=${encodeURIComponent(filter)}&search=${encodeURIComponent(query)}&offset=${offset}`;
    void getJson<LeadList>(url, controller.signal)
      .then((data) => {
        if (controller.signal.aborted) return;
        setList(data);
        setListError('');
        setListLoading(false);
      })
      .catch((error) => {
        if (!controller.signal.aborted) { setListError(error.message); setListLoading(false); }
      });
    return () => controller.abort();
  }, [filter, query, offset, refresh]);
  useEffect(() => {
    if (!selected) { setDetailLoading(false); return; }
    const cached=detailCache.current.get(selected);
    if(cached)setDetail(cached);
    setDetailLoading(true);
    const controller = new AbortController();
    void getJson<LeadDetail>(
      `/api/leads?id=${encodeURIComponent(selected)}`,
      controller.signal,
    )
      .then((data) => {
        if (controller.signal.aborted) return;
        detailCache.current.set(data.lead.id,data);
        setDetail((current) =>
          current?.lead.id === data.lead.id &&
          current.lead.version > data.lead.version
            ? current
            : data,
        );
        setDetailError('');
        setDetailLoading(false);
      })
      .catch((error) => {
        if (!controller.signal.aborted) { setDetailError(error.message); setDetailLoading(false); }
      });
    return () => controller.abort();
  }, [selected, refresh]);
  const mutate: Mutation = async (action, data = {}, entityId) => {
    if (busy.current) throw new Error('Попередня дія ще зберігається.');
    if (action !== 'create' && (!detail || detail.lead.id !== selected))
      throw new Error('Дочекайтесь завантаження картки.');
    busy.current = true;
    try {
      const id = await postCommand(
        action,
        data,
        action === 'create' ? undefined : detail!.lead,
        entityId,
      );
      setSelected(id);
      setNotice('Збережено.');
      detailCache.current.delete(id);
      setDetail((current)=>current?.lead.id===id?current:null);
      reload();
    } catch (error) {
      reload();
      throw error;
    } finally {
      busy.current = false;
    }
  };
  const current = detail?.lead.id === selected ? detail : selected ? detailCache.current.get(selected)||null : null;
  useEffect(() => {
    if (active) return;
    setHistoryOpen(false);
    setEditor(null);
    setArchive(false);
    setResponseChange(false);
  }, [active]);
  useEffect(() => {
    if (initialLeadId && initialLeadId !== lastInitialLeadId.current) {
      lastInitialLeadId.current = initialLeadId;
      openLead(initialLeadId);
    }
  }, [initialLeadId, openLead]);
  useEffect(() => {
    if (!active || lastSyncRevision.current === syncRevision) return;
    lastSyncRevision.current = syncRevision;
    reload();
  }, [active, syncRevision, reload]);
  useEffect(() => {
    if (current && focusSelection.current === current.lead.id) {
      heading.current?.focus();
      focusSelection.current = null;
    }
  }, [current]);
  useEffect(() => {
    if(!active)return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
      if (document.querySelector('[data-slot="dialog-content"]')) return;
      if (event.key === '/') {
        const target = event.target;
        const editable =
          target instanceof HTMLInputElement ||
          target instanceof HTMLTextAreaElement ||
          target instanceof HTMLSelectElement ||
          (target instanceof HTMLElement && target.isContentEditable);
        if (editable) return;
        event.preventDefault();
        searchInput.current?.focus();
        return;
      }
      if (event.key === 'Escape' && search) {
        event.preventDefault();
        setSearch('');
        setQuery('');
        setOffset(0);
        searchInput.current?.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [search,active]);
  return (
    <div className={`leads-workspace ${selected ? 'has-selection' : ''}`} aria-busy={listLoading||detailLoading}>
      <LeadHistoryDialog open={historyOpen} lead={current?.lead ? { id: current.lead.id, name: current.lead.name } : null} onClose={() => setHistoryOpen(false)} finalFocus={() => historyTrigger.current} />
      <WorkspaceRefreshIndicator active={(listLoading&&list!==null)||(detailLoading&&current!==null)} label="Оновлюємо CRM…" />
      <section className="leads-hero">
        <div>
          <p className="eyebrow">CRM та супровід</p>
          <h2>Контакти, учні та уроки</h2>
          <p>Один лід — повна історія родини.</p>
        </div>
        <Button onClick={() => setEditor('create')}>Новий лід</Button>
      </section>
      <TodayLeadsPanel refreshKey={refresh} onSelect={openLead} />
      <div className="leads-layout">
        <section className="leads-list" aria-label="Список лідів">
          <label htmlFor="lead-search">Пошук ліда</label>
          <Input
            ref={searchInput}
            id="lead-search"
            type="search"
            placeholder="Ім’я, контакт, предмет, викладач або стан"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <fieldset className="lead-filters" aria-label="Фільтр лідів">
            {[
              ['active', 'Активні'],
              ['responses', 'Усі відгуки'],
              ['curator', 'У куратора'],
              ['needs-details', 'Потрібно уточнити'],
              ['overdue', 'Прострочені'],
              ['archived', 'Архів'],
            ].map(([key, label]) => (
              <Button
                key={key}
                size="sm"
                variant={filter === key ? 'secondary' : 'ghost'}
                aria-pressed={filter === key}
                onClick={() => {
                  setFilter(key);
                  setOffset(0);
                }}
              >
                {label}
              </Button>
            ))}
            {(filter !== 'active' || search || offset !== 0) && (
              <Button type="button" size="sm" variant="ghost" onClick={resetListControls}>
                Скинути фільтри
              </Button>
            )}
          </fieldset>
          {listError ? (
            <p className="lead-error" role="alert">
              {listError}{' '}
              <Button variant="ghost" onClick={reload}>
                Повторити
              </Button>
            </p>
          ) : !list ? (
            <WorkspaceInitialLoading compact label="Завантажуємо ліди…"/>
          ) : (
            <>
              <p className="muted-note">Знайдено: {list.total}</p>
              {list.leads.length ? (
                <ul>
                  {list.leads.map((lead, index) => (
                    <li className={index >= mobileVisibleLeads ? 'mobile-progressive-hidden' : undefined} key={lead.id}>
                      <button
                        type="button"
                        className="lead-list-item"
                        aria-current={selected === lead.id ? 'true' : undefined}
                        onClick={() => openLead(lead.id)}
                      >
                        <div>
                          <strong>{lead.name}</strong>
                          <span>{labels[lead.platform] ?? lead.platform}</span>
                        </div>
                        <p>{lead.subject || 'Предмет не вказано'}</p>
                        <div>
                          <span>{labels[lead.funnelStage]}</span>
                          {lead.qualification && (
                            <Badge variant="outline">
                              {lead.qualification}
                            </Badge>
                          )}
                          {lead.duplicateState !== 'none' && (
                            <span>Дублікат?</span>
                          )}
                        </div>
                        {lead.nextAction && (
                          <p className={lead.overdue ? 'lead-error' : ''}>
                            {lead.overdue ? 'Прострочено · ' : ''}
                            {lead.nextAction}
                          </p>
                        )}
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="lead-empty">Лідів за цим фільтром немає.</p>
              )}
              {list.leads.length > mobileVisibleLeads && (
                <div className="mobile-list-more"><Button type="button" variant="outline" onClick={() => setMobileListState({ key: mobileListKey, count: Math.min(mobileVisibleLeads + MOBILE_LIST_CHUNK, list.leads.length) })}>Показати ще лідів</Button></div>
              )}
              <div className="lead-actions">
                <Button
                  variant="ghost"
                  disabled={offset === 0}
                  onClick={() => setOffset((v) => Math.max(0, v - 50))}
                >
                  Назад
                </Button>
                <Button
                  variant="ghost"
                  disabled={offset + 50 >= list.total}
                  onClick={() => setOffset((v) => v + 50)}
                >
                  Далі
                </Button>
              </div>
            </>
          )}
        </section>
        <div className="lead-detail" aria-label="Картка ліда">
          {selected && <Button type="button" variant="ghost" className="lead-mobile-back" onClick={() => { setSelected(null); setDetail(null); setDetailError(''); setNotice(''); }}>← До списку лідів</Button>}
          {detailError ? (
            <p className="lead-error" role="alert">
              {detailError}{' '}
              <Button variant="outline" onClick={reload}>
                Оновити картку
              </Button>
            </p>
          ) : !selected ? (
            <div className="lead-panel lead-empty">
              <h2>Оберіть ліда</h2>
              <p>Відкрийте контакт зі списку або створіть новий.</p>
            </div>
          ) : !current ? (
            <WorkspaceInitialLoading compact label="Завантажуємо картку ліда…"/>
          ) : (
            <div key={current.lead.id}>
              <section className="lead-panel lead-summary">
                <div className="lead-section-head">
                  <div>
                    <p className="eyebrow">
                      {labels[current.lead.platform] ?? current.lead.platform}
                    </p>
                    <h2 ref={heading} tabIndex={-1}>
                      {current.lead.name}
                    </h2>
                  </div>
                  <Badge variant="outline">
                    {current.lead.archivedAt !== null
                      ? 'В архіві'
                      : (labels[current.lead.status] ?? current.lead.status)}
                  </Badge>
                </div>
                <p>
                  {current.lead.subject || 'Предмет не вказано'} · Відгук:{' '}
                  {current.lead.responseDate || 'Не вказано'}
                </p>
                <div className="lead-contact-lines">
                  {current.lead.phone && (
                    <>
                      <span>Телефон: {current.lead.phone}</span>
                      <Button type="button" variant="ghost" size="sm" onClick={() => void copyText('Телефон', current.lead.phone)}>Копіювати телефон</Button>
                    </>
                  )}
                  {current.lead.telegramUsername && (
                    <>
                      <span>Telegram: {current.lead.telegramUsername}</span>
                      <Button type="button" variant="ghost" size="sm" onClick={() => void copyText('Telegram', current.lead.telegramUsername)}>Копіювати Telegram</Button>
                    </>
                  )}
                  {safeUrl(current.lead.sourceChatLink) && (
                    <a
                      href={current.lead.sourceChatLink}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Джерело відгуку ↗
                    </a>
                  )}
                </div>
                {current.lead.note && (
                  <div>
                    <p className="lead-preserve">{current.lead.note}</p>
                    <Button type="button" variant="ghost" size="sm" onClick={() => void copyText('Нотатку', current.lead.note)}>Копіювати нотатку</Button>
                  </div>
                )}
                {current.lead.duplicateState !== 'none' && (
                  <p>Дублікат: {labels[current.lead.duplicateState]}</p>
                )}
                <div className="lead-actions lead-contact-actions">
                  <div className="lead-action-primary">
                    <Button
                      variant="outline"
                      disabled={current.lead.archivedAt !== null}
                      onClick={() => setEditor('update')}
                    >
                      Редагувати контакт
                    </Button>
                    <Button
                      variant="outline"
                      disabled={current.lead.archivedAt !== null}
                      onClick={() => setResponseChange(true)}
                    >
                      {current.lead.responseCancelledAt === null ? 'Скасувати відгук' : 'Відновити відгук'}
                    </Button>
                  </div>
                  <div className="lead-action-utility">
                    <Button ref={historyTrigger} variant="ghost" size="sm" onClick={() => setHistoryOpen(true)}>Історія</Button>
                    <Button variant="ghost" size="sm" onClick={reload}>Оновити</Button>
                    <Button
                      className={current.lead.archivedAt !== null ? 'lead-restore-action' : 'lead-archive-action'}
                      variant="ghost"
                      size="sm"
                      onClick={() => setArchive(true)}
                    >
                      {current.lead.archivedAt !== null ? 'Відновити' : 'Архівувати'}
                    </Button>
                  </div>
                  <output>{notice}</output>
                </div>
              </section>
              {active&&<>
                <FollowUp detail={current} mutate={mutate} />
                <LeadScripts lead={current.lead} />
                <Lessons detail={current} mutate={mutate} />
                <Students detail={current} mutate={mutate} />
                <Conversation detail={current} mutate={mutate} onChanged={reload} />
              </>}
            </div>
          )}
        </div>
      </div>
      {editor && (
        <LeadEditor
          lead={editor === 'update' ? current?.lead : undefined}
          close={() => setEditor(null)}
          save={(data) =>
            mutate(editor === 'create' ? 'create' : 'update', data)
          }
        />
      )}
      {archive && current && (
        <Confirmation
          title={
            current.lead.archivedAt !== null
              ? 'Відновити ліда?'
              : 'Архівувати ліда?'
          }
          description="Учні, уроки, переписка й історичні показники збережуться."
          close={() => setArchive(false)}
          run={() =>
            mutate(current.lead.archivedAt !== null ? 'restore' : 'archive')
          }
        />
      )}
      {responseChange && current && (
        <Confirmation
          title={current.lead.responseCancelledAt === null ? 'Скасувати відгук?' : 'Відновити відгук?'}
          description={current.lead.responseCancelledAt === null
            ? 'Контакт і вся історія збережуться, але цей відгук перестане входити у звіти та статистику.'
            : 'Первинний відгук знову ввійде у звіти та статистику на своїй історичній даті.'}
          close={() => setResponseChange(false)}
          run={() => mutate(current.lead.responseCancelledAt === null ? 'response_cancel' : 'response_restore')}
        />
      )}
    </div>
  );
}
