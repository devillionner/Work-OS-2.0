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
import { Lessons } from './lessons';
import { Conversation } from './conversation';
import { LeadHistoryDialog } from './history';

export function LeadsWorkspace({ account }: { account: string }) {
  const [postCommand] = useState(() => createBrowserCommandClient(account));
  const [filter, setFilter] = useState('active');
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [offset, setOffset] = useState(0);
  const [list, setList] = useState<LeadList | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<LeadDetail | null>(null);
  const [listError, setListError] = useState('');
  const [detailError, setDetailError] = useState('');
  const [refresh, setRefresh] = useState(0);
  const [editor, setEditor] = useState<'create' | 'update' | null>(null);
  const [archive, setArchive] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [notice, setNotice] = useState('');
  const busy = useRef(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const focusSelection = useRef<string | null>(null);
  const reload = useCallback(() => setRefresh((v) => v + 1), []);
  useEffect(() => {
    const timer = setTimeout(() => {
      setQuery(search);
      setOffset(0);
    }, 250);
    return () => clearTimeout(timer);
  }, [search]);
  useEffect(() => {
    const controller = new AbortController();
    const url = `/api/leads?archived=${filter === 'archived'}&overdue=${filter === 'overdue'}&search=${encodeURIComponent(query)}&offset=${offset}`;
    void getJson<LeadList>(url, controller.signal)
      .then((data) => {
        if (controller.signal.aborted) return;
        setList(data);
        setListError('');
      })
      .catch((error) => {
        if (!controller.signal.aborted) setListError(error.message);
      });
    return () => controller.abort();
  }, [filter, query, offset, refresh]);
  useEffect(() => {
    if (!selected) return;
    const controller = new AbortController();
    void getJson<LeadDetail>(
      `/api/leads?id=${encodeURIComponent(selected)}`,
      controller.signal,
    )
      .then((data) => {
        if (controller.signal.aborted) return;
        setDetail((current) =>
          current?.lead.id === data.lead.id &&
          current.lead.version > data.lead.version
            ? current
            : data,
        );
        setDetailError('');
      })
      .catch((error) => {
        if (!controller.signal.aborted) setDetailError(error.message);
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
      setDetail(null);
      reload();
    } catch (error) {
      reload();
      throw error;
    } finally {
      busy.current = false;
    }
  };
  const current = detail?.lead.id === selected ? detail : null;
  useEffect(() => {
    if (current && focusSelection.current === current.lead.id) {
      heading.current?.focus();
      focusSelection.current = null;
    }
  }, [current]);
  return (
    <div className="leads-workspace">
      <LeadHistoryDialog open={historyOpen} lead={current?.lead ? { id: current.lead.id, name: current.lead.name } : null} onClose={() => setHistoryOpen(false)} />
      <div className="leads-toolbar">
        <div>
          <p className="eyebrow">Контакти, учні та уроки</p>
          <p className="muted-note">Один лід — повна історія родини.</p>
        </div>
        <Button onClick={() => setEditor('create')}>Новий лід</Button>
      </div>
      <div className="leads-layout">
        <section className="leads-list" aria-label="Список лідів">
          <label htmlFor="lead-search">Пошук ліда</label>
          <Input
            id="lead-search"
            type="search"
            placeholder="Ім’я, телефон, username"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <fieldset className="lead-filters" aria-label="Фільтр лідів">
            {[
              ['active', 'Активні'],
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
          </fieldset>
          {listError ? (
            <p className="lead-error" role="alert">
              {listError}{' '}
              <Button variant="ghost" onClick={reload}>
                Повторити
              </Button>
            </p>
          ) : !list ? (
            <output>Завантаження…</output>
          ) : (
            <>
              <p className="muted-note">Знайдено: {list.total}</p>
              {list.leads.length ? (
                <ul>
                  {list.leads.map((lead) => (
                    <li key={lead.id}>
                      <button
                        type="button"
                        className="lead-list-item"
                        aria-current={selected === lead.id ? 'true' : undefined}
                        onClick={() => {
                          focusSelection.current = lead.id;
                          setSelected(lead.id);
                          setDetailError('');
                          setNotice('');
                        }}
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
            <output>Завантаження картки…</output>
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
                    <span>Телефон: {current.lead.phone}</span>
                  )}
                  {current.lead.telegramUsername && (
                    <span>Telegram: {current.lead.telegramUsername}</span>
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
                  <p className="lead-preserve">{current.lead.note}</p>
                )}
                {current.lead.duplicateState !== 'none' && (
                  <p>Дублікат: {labels[current.lead.duplicateState]}</p>
                )}
                <div className="lead-actions">
                  <Button
                    variant="outline"
                    disabled={current.lead.archivedAt !== null}
                    onClick={() => setEditor('update')}
                  >
                    Редагувати контакт
                  </Button>
                  <Button variant="ghost" onClick={() => setArchive(true)}>
                    {current.lead.archivedAt !== null
                      ? 'Відновити'
                      : 'Архівувати'}
                  </Button>
                  <Button variant="outline" onClick={() => setHistoryOpen(true)}>
                    Історія
                  </Button>
                  <Button variant="ghost" onClick={reload}>
                    Оновити
                  </Button>
                  <output>{notice}</output>
                </div>
              </section>
              <FollowUp detail={current} mutate={mutate} />
              <Lessons detail={current} mutate={mutate} />
              <Students detail={current} mutate={mutate} />
              <Conversation detail={current} mutate={mutate} />
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
    </div>
  );
}
