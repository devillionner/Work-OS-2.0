'use client';

import { useMemo, useState } from 'react';
import { Plus, Search, UserRoundCheck } from 'lucide-react';
import { useCommand } from '@/components/shell/command-bus';
import { useSearchIndex, type SearchItem } from '@/components/shell/search-index';
import { useShell } from '@/components/shell/shell-context';
import { DESKTOP, useMediaQuery } from '@/components/shell/use-media';
import { TopbarControls, useViewActive } from '@/components/shell/view-pane';
import { Button } from '@/components/ui/button';
import { Chip } from '@/components/ui/chip';
import { ConfirmDialog } from '@/components/ui/dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { Ghost } from '@/components/ui/ghost';
import { SearchField } from '@/components/ui/search-field';
import { Segmented } from '@/components/ui/segmented';
import { Surface } from '@/components/ui/surface';
import { useToast } from '@/components/ui/toast';
import { AccountsCard } from '@/components/views/platforms/accounts-card';
import { ArchiveReasonDialog, JOIN_FAILED_REASON } from '@/components/views/platforms/archive-reason-dialog';
import { AutopostCard } from '@/components/views/platforms/autopost-card';
import { BulkPanel } from '@/components/views/platforms/bulk-panel';
import { ChatHistoryPanel } from '@/components/views/platforms/chat-history-panel';
import { ChatRow } from '@/components/views/platforms/chat-row';
import { DiscoveryPanel } from '@/components/views/platforms/discovery-panel';
import { JoinSections } from '@/components/views/platforms/join-sections';
import { DuplicatesPanel } from '@/components/views/platforms/duplicates-panel';
import { PlatformOverview } from '@/components/views/platforms/overview';
import { ProfilePanel, type ChatWithProfile } from '@/components/views/platforms/profile-panel';
import { PublishPanel } from '@/components/views/platforms/publish-panel';
import { ScheduleTab } from '@/components/views/platforms/schedule-tab';
import { SelectedChats } from '@/components/views/platforms/selected-chats';
import { SelectedListPicker } from '@/components/views/platforms/selected-list-picker';
import { usePlatforms, QUEUES, type Chat } from '@/components/views/platforms/use-platforms';
import { WaitingCheckCard } from '@/components/views/platforms/waiting-check-card';

type Zone = 'overview' | 'schedule' | 'autopost' | 'quick';
const PAGE = 50;

/**
 * «Платформи»: ліворуч платформа, черги, пошук і список чатів; праворуч робоча зона платформи
 * (Огляд · Розклад · Автопост · Швидкий режим). Профіль, публікація й історія чату — в Inspector.
 */
export default function PlatformsView() {
  const { snapshot, syncRevision, navigate } = useShell();
  const active = useViewActive();
  const desktop = useMediaQuery(DESKTOP);
  const toast = useToast();
  const p = usePlatforms({ enabledPlatforms: snapshot.enabledPlatforms, syncRevision, businessDate: snapshot.today, active });
  const [zone, setZone] = useState<Zone>('overview');
  const [phoneSection, setPhoneSection] = useState<'chats' | Zone>('chats');
  const [bulkOpen, setBulkOpen] = useState(false);
  const [deleteListId, setDeleteListId] = useState<string | null>(null);
  const [discoveryOpen, setDiscoveryOpen] = useState(false);
  const [duplicatesOpen, setDuplicatesOpen] = useState(false);
  const [profileChat, setProfileChat] = useState<Chat | null>(null);
  const [historyChat, setHistoryChat] = useState<Chat | null>(null);
  const [publishChat, setPublishChat] = useState<Chat | null>(null);

  useCommand('chats:add', () => setBulkOpen(true));
  useCommand('chats:discover', () => setDiscoveryOpen(true));
  useCommand('platforms:telegram-schedule', () => { p.selectPlatform('telegram'); setZone('schedule'); setPhoneSection('schedule'); });

  const { platform, queue, data } = p;
  const zones = useMemo<Array<{ value: Zone; label: string }>>(() => {
    const list: Array<{ value: Zone; label: string }> = [{ value: 'overview', label: 'Огляд' }];
    if (platform === 'telegram') list.push({ value: 'schedule', label: 'Розклад' });
    if (platform === 'whatsapp') list.push({ value: 'autopost', label: 'Автопост' });
    if (platform === 'viber') list.push({ value: 'quick', label: 'Швидкий режим' });
    return list;
  }, [platform]);
  const currentZone: Zone = zones.some((item) => item.value === zone) ? zone : 'overview';
  const phoneCurrent: 'chats' | Zone = phoneSection === 'chats' || zones.some((item) => item.value === phoneSection) ? phoneSection : 'chats';

  const searchItems = useMemo<SearchItem[]>(() => (data?.chats ?? []).map((chat) => ({
    id: `chat:${chat.id}`, group: 'Чати', label: chat.name, hint: `${chat.platform}`, run: () => { navigate('platforms'); p.selectPlatform(chat.platform); p.setSearch(chat.name); },
  })), [data, navigate, p]);
  useSearchIndex('platforms', searchItems);

  const profileSource: ChatWithProfile | null = profileChat ? { id: profileChat.id, name: profileChat.name, link: profileChat.link, platform: profileChat.platform, stateToken: profileChat.stateToken, profile: profileChat.profile } : null;
  const queueMode = queue === 'ready' && (platform === 'whatsapp' || platform === 'viber');
  const publishQuick = p.quickPublishMode && (publishChat?.platform === 'whatsapp' || publishChat?.platform === 'viber');
  const profileSummary = data?.profileCounts[queue];

  const publishAct = async ({ advertisementId, language }: { advertisementId: string | null; language: 'uk' | 'ru' | null }) => {
    if (!publishChat) return false;
    const quick = p.quickPublishMode && (publishChat.platform === 'whatsapp' || publishChat.platform === 'viber');
    const result = await p.act(publishChat, 'published', { advertisementId, language, quick }, { action: 'undo_published', label: 'Публікацію можна скасувати протягом 8 секунд.' });
    if (!result.ok) {
      if (result.refresh) { setPublishChat(null); toast.push({ message: `${result.error} Список уже оновлено — відкрий актуальний чат повторно.`, tone: 'hot' }); return false; }
      throw new Error(result.error);
    }
    if (quick && advertisementId && !p.quickAdvertisementId) { p.setQuickAdvertisementId(advertisementId); toast.push({ message: 'Матеріал швидкого режиму зафіксовано. Матеріал серії лишиться обраним.' }); }
    return true;
  };

  const overview = (
    <div className="flex flex-col gap-4">
      {data ? <PlatformOverview pace={data.publicationPace} available={queue === 'ready' ? data.availableToday : undefined} joined={data.joinedToday} published={data.publishedToday} /> : p.error ? <EmptyState text="Не вдалося завантажити огляд платформи." action={<Button variant="outline" size="sm" onClick={() => void p.reload()}>Спробувати ще раз</Button>} /> : <div className="grid gap-3 @xl:grid-cols-2 @4xl:grid-cols-3">{[0, 1, 2].map((item) => <Ghost key={item} className="h-32 rounded-card" />)}</div>}
      {platform === 'telegram' ? <AccountsCard accounts={p.accounts} accountId={p.accountId} activeAccount={p.activeAccount} breakSeconds={p.breakSeconds} busy={p.busy !== null} onAction={p.accountAction} /> : null}
      {platform === 'whatsapp' ? <WaitingCheckCard view={p.waitingCheckView} nowSeconds={Math.floor(p.clock / 1000)} busy={p.busy !== null} onAction={(action) => void p.changeWaitingCheck(action)} onConnect={() => void p.connectWaitingCheckRunner()} onProblemAction={(problem, action) => void p.resolveWaitingProblem(problem, action)} /> : null}
    </div>
  );

  const quick = (
    <Surface variant="glass" radius="card" className="flex flex-col gap-4 p-5 sm:p-6" aria-labelledby="quick-title">
      <div>
        <h2 id="quick-title" className="m-0 text-[17px] font-medium">Швидкий режим Viber</h2>
        <p className="m-0 mt-1 max-w-[62ch] text-sm text-ink-2">Один матеріал для серії чатів; кожну публікацію підтверджуєш вручну.</p>
      </div>
      <p className="m-0 text-sm text-ink-2">{p.quickPublishMode ? (p.quickAdvertisementId ? 'Матеріал серії вже зафіксовано. Підтверджуй лише фактично зроблені публікації.' : 'Обери матеріал у першому чаті — далі він лишатиметься для серії.') : 'Швидкий режим вимкнено.'}</p>
      <Button variant={p.quickPublishMode ? 'outline' : 'action'} className="self-start" disabled={p.busy !== null} onClick={() => { p.setQuickPublishMode(!p.quickPublishMode); if (p.quickPublishMode) p.setQuickAdvertisementId(null); p.selectQueue('ready'); }}>{p.quickPublishMode ? 'Завершити швидкий режим' : 'Увімкнути швидкий режим'}</Button>
    </Surface>
  );

  const zoneContent = (value: Zone) => {
    if (queue === 'selected' && platform === 'telegram' && value === 'overview') return null;
    if (value === 'schedule' && p.accountId) return <ScheduleTab key={p.accountId} accountId={p.accountId} />;
    if (value === 'schedule') return <EmptyState text="Додай або увімкни Telegram-акаунт, щоб побачити розклад." />;
    if (value === 'autopost') return <AutopostCard image={p.whatsappImage} imageLoaded={p.whatsappImageLoaded} caption={p.whatsappCaption} captionLoaded={p.whatsappCaptionLoaded} busy={p.busy !== null} queueSize={data?.counts.ready || 0} progress={p.whatsappProgress} onCaptionChange={p.setWhatsappCaption} onUploadImage={(file) => void p.uploadWhatsAppAutopostImage(file)} onRemoveImage={() => void p.removeWhatsAppAutopostImage()} onSaveCaption={() => void p.saveWhatsAppAutopostCaption()} onClearCaption={() => void p.clearWhatsAppAutopostCaption()} onStart={() => void p.startWhatsAppAutopostBatch()} onStop={() => void p.stopWhatsAppAutopostBatch()} onReset={() => void p.resetWhatsAppAutopostQueue()} />;
    if (value === 'quick') return quick;
    return overview;
  };

  const selectedList = p.selected.lists.find((item) => item.id === p.selected.listId);
  const deleteList = p.selected.lists.find((item) => item.id === deleteListId);

  const selectedBlock = platform === 'telegram' && queue === 'selected' ? (
    <Surface variant="glass" radius="card">
      <SelectedChats
        key={p.selected.listId ?? 'none'}
        view={p.selected.view}
        loading={!p.selected.view && !p.selected.failed}
        accounts={p.accounts}
        accountId={p.requestAccountId}
        listId={p.selected.listId ?? ''}
        listName={selectedList?.name ?? 'Відібрані'}
        onImported={(next) => p.selected.replaceView(next)}
        onDismiss={p.selected.dismiss}
        onOpenQueue={() => p.selectQueue('to_join')}
        onAdded={(link, status, chatAccountId, added) => {
          p.selected.setView((current) => ({ ...current, items: current.items.map((item) => (item.link === link ? { ...item, status, accountId: chatAccountId } : item)) }));
          p.invalidateQueueCache('telegram');
          const scope = `telegram:${p.requestAccountId || ''}`;
          if (added) p.setCountsByScope((current) => (current[scope] ? { ...current, [scope]: { ...current[scope], to_join: (current[scope].to_join || 0) + 1 } } : current));
        }}
        onBulkAdded={(links) => {
          const added = new Set(links);
          p.selected.setView((current) => ({ ...current, items: current.items.map((item) => (added.has(item.link) ? { ...item, status: 'to_join', accountId: p.requestAccountId } : item)) }));
          p.invalidateQueueCache('telegram');
          const scope = `telegram:${p.requestAccountId || ''}`;
          if (links.length) p.setCountsByScope((current) => (current[scope] ? { ...current, [scope]: { ...current[scope], to_join: (current[scope].to_join || 0) + links.length } } : current));
        }}
      />
    </Surface>
  ) : null;

  const renderRow = (chat: Chat, section?: 'queue' | 'pool') => (
    <ChatRow
      key={chat.id}
      chat={chat}
      queue={queue}
      section={section}
      clock={p.clock}
      busy={p.busy !== null}
      lastOpened={p.lastOpenedByPlatform[platform] === chat.id}
      accounts={p.accounts}
      whatsappAutopostReady={p.whatsappImageLoaded && Boolean(p.whatsappImage)}
      onAct={(target, action, extra, undo) => void p.act(target, action, extra, undo)}
      onShortlist={(target) => void p.shortlistChat(target)}
      onUnshortlist={(target) => void p.unshortlistChat(target)}
      onPublish={setPublishChat}
      onProfile={setProfileChat}
      onHistory={setHistoryChat}
      onArchive={p.setArchiveChat}
      onOpen={p.openChat}
      onReturn={p.returnToQueue}
      onDelete={p.setDeleteChat}
      onAssign={p.assignAccount}
      onAutopost={(target) => void p.toggleWhatsAppAutopost(target)}
    />
  );
  const joinSplit = platform === 'telegram' && queue === 'to_join' && data?.candidates !== undefined;

  const list = (
    <div className="flex min-w-0 flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="action" size="sm" disabled={p.busy !== null} onClick={() => setBulkOpen(true)}><Plus aria-hidden="true" strokeWidth={1.5} />Додати чати</Button>
        <Button variant="outline" size="sm" disabled={p.busy !== null} onClick={() => setDiscoveryOpen(true)}><Search aria-hidden="true" strokeWidth={1.5} />Знайти чати</Button>
        <Button variant="ghost" size="sm" disabled={p.busy !== null || (platform === 'telegram' && !p.accountId)} onClick={() => setDuplicatesOpen(true)}>Дублікати</Button>
      </div>
      <fieldset className="m-0 flex flex-wrap gap-1.5 border-0 p-0">
        <legend className="sr-only">Черга чатів</legend>
        {QUEUES.filter((item) => platform !== 'viber' || item.key !== 'profile_review').map((item) => <Chip key={item.key} pressed={queue === item.key} count={p.tabCounts ? (p.tabCounts[item.key] || 0) : '–'} onClick={() => p.selectQueue(item.key)}>{item.label}</Chip>)}
        {platform === 'telegram' ? <Chip pressed={queue === 'selected'} count={selectedList ? selectedList.count : '–'} onClick={() => p.selectQueue('selected')}>Відібрані</Chip> : null}
      </fieldset>

      {queue !== 'selected' ? (
        <div className="flex flex-wrap items-center gap-2">
          <SearchField value={p.search} onValueChange={p.setSearch} placeholder="Назва або посилання" hotkey={active} wrapperClassName="min-w-[200px] flex-1" />
          {(queue === 'waiting' || queue === 'ready') && platform !== 'viber' ? (
            <Chip pressed={p.profileFilter === 'needs_review'} onClick={() => { p.setProfileFilter(p.profileFilter === 'all' ? 'needs_review' : 'all'); p.setOffset(0); }} title={profileSummary ? `Підтверджені: ${profileSummary.confirmed}; чернетки: ${profileSummary.draft}; без профілю: ${profileSummary.empty}` : 'Фільтр профілів'}>
              <UserRoundCheck aria-hidden="true" strokeWidth={1.5} className="size-3.5" />{p.profileFilter === 'needs_review' ? `Усі профілі (${data?.counts[queue] || 0})` : `Потребують правил (${profileSummary?.needsReview || 0})`}
            </Chip>
          ) : null}
        </div>
      ) : null}
      {queue === 'profile_review' && profileSummary ? <p className="m-0 text-xs text-ink-2">Чернетки {profileSummary.draft} · без профілю {profileSummary.empty}</p> : null}

      {p.error ? <div className="flex flex-wrap items-center gap-3"><p role="alert" className="m-0 text-sm text-hot">{p.error}</p><Button variant="outline" size="sm" disabled={p.loading || p.busy !== null} onClick={() => void p.reload()}>Оновити список</Button></div> : null}

      {queue === 'selected' ? (
        <SelectedListPicker
          lists={p.selected.lists}
          listId={p.selected.listId}
          layout={desktop ? 'column' : 'strip'}
          onSelect={p.selected.select}
          onCreate={() => { void p.selected.create().then((error) => { if (error) toast.push({ message: error, tone: 'hot' }); }); }}
          onRename={p.selected.rename}
          onDelete={setDeleteListId}
        />
      ) : !data && (p.loading || p.switchingList) ? (
        <div aria-busy="true" className="flex flex-col gap-2">{[0, 1, 2, 3].map((item) => <Ghost key={item} className="h-24 rounded-inner" />)}</div>
      ) : data && joinSplit ? (
        <JoinSections candidates={data.candidates ?? []} pool={data.chats} counts={data.sections ?? { queue: 0, pool: 0 }} poolTotal={data.total} searching={p.search.trim() !== ''} renderRow={renderRow} onShowMore={p.showMoreNewChats} />
      ) : data?.chats.length ? (
        <>
          <ul className="m-0 flex list-none flex-col gap-2 p-0">
            {data.chats.map((chat) => renderRow(chat))}
          </ul>
          {data.total > PAGE ? (
            <div className="flex items-center justify-between gap-3">
              <Button variant="outline" size="sm" disabled={p.offset === 0} onClick={() => p.setOffset(Math.max(0, p.offset - PAGE))}>Назад</Button>
              <span className="font-mono text-xs text-ink-2">{p.offset + 1}–{Math.min(p.offset + PAGE, data.total)} із {data.total}</span>
              <Button variant="outline" size="sm" disabled={p.offset + PAGE >= data.total} onClick={() => p.setOffset(p.offset + PAGE)}>Далі</Button>
            </div>
          ) : null}
        </>
      ) : (
        <EmptyState text={queue === 'profile_review' ? 'Усі профілі уточнено: чернеток і чатів без підтверджених правил тут більше немає.' : 'У цій черзі нічого немає. Зміни платформу, чергу або очисть пошук.'} />
      )}
    </div>
  );

  return (
    <div className="mx-auto flex w-full max-w-[1480px] flex-col gap-4 pb-6" aria-busy={p.loading}>
      <TopbarControls>
        <Segmented<string> label="Платформа" value={platform} onValueChange={(value) => p.selectPlatform(value as typeof platform)} items={p.availablePlatforms.map((item) => ({ value: item.key, label: item.label }))} />
      </TopbarControls>

      {!desktop ? (
        <Segmented<string> label="Розділ платформи" value={phoneCurrent} onValueChange={(value) => setPhoneSection(value as 'chats' | Zone)} items={[{ value: 'chats', label: 'Чати' }, ...zones]} />
      ) : null}

      <div className="grid grid-cols-1 gap-4 @4xl:grid-cols-[minmax(340px,420px)_minmax(0,1fr)]">
        {(desktop || phoneCurrent === 'chats') ? <div className="min-w-0">{list}</div> : null}
        {desktop || phoneCurrent !== 'chats' ? (
          <div className="min-w-0 @4xl:sticky @4xl:top-0 @4xl:self-start">
            {desktop && zones.length > 1 ? <div className="mb-4"><Segmented<Zone> label="Зона платформи" value={currentZone} onValueChange={setZone} items={zones} /></div> : null}
            {selectedBlock && desktop ? selectedBlock : zoneContent(desktop ? currentZone : (phoneCurrent as Zone))}
          </div>
        ) : null}
        {selectedBlock && !desktop && phoneCurrent === 'chats' ? <div className="min-w-0">{selectedBlock}</div> : null}
      </div>

      <BulkPanel open={bulkOpen} onClose={() => setBulkOpen(false)} onAdded={(result) => { p.addedChats(result); }} enabledPlatforms={snapshot.enabledPlatforms} />
      <DiscoveryPanel open={discoveryOpen} onClose={() => setDiscoveryOpen(false)} onImported={(next) => p.importedDiscoveryChat(next as 'whatsapp' | 'viber')} />
      <DuplicatesPanel open={duplicatesOpen} onClose={() => setDuplicatesOpen(false)} />
      <ProfilePanel open={profileChat !== null} chat={profileSource} onClose={() => setProfileChat(null)} onSaved={() => { p.savedProfile(); setProfileChat(null); }} onOpenChat={() => { if (profileChat) p.openChat(profileChat); }} />
      <ChatHistoryPanel open={historyChat !== null} chat={historyChat ? { id: historyChat.id, name: historyChat.name, link: historyChat.link } : null} onClose={() => setHistoryChat(null)} />
      <PublishPanel open={publishChat !== null} chat={publishChat} quickMode={Boolean(publishQuick)} preferredAdvertisementId={p.quickAdvertisementId} onClose={() => setPublishChat(null)} onPublished={publishAct} onOpenChat={() => { if (publishChat) p.openChat(publishChat); }} />

      <ConfirmDialog
        open={deleteListId !== null}
        title="Видалити список?"
        description={`«${deleteList?.name ?? ''}» зникне зі списків разом із завантаженим файлом. Чати, які вже додано в роботу, лишаться.`}
        confirmLabel="Видалити список"
        destructive
        onCancel={() => setDeleteListId(null)}
        onConfirm={() => { const id = deleteListId; setDeleteListId(null); if (id) void p.selected.remove(id).then((error) => { if (error) toast.push({ message: error, tone: 'hot' }); else toast.push({ message: 'Список видалено.' }); }); }}
      />
      <ArchiveReasonDialog open={p.archiveChat !== null} chatName={p.archiveChat?.name ?? null} joinFailed={p.archiveChat?.status === 'to_join'} busy={p.busy !== null} error={p.error} onCancel={() => p.setArchiveChat(null)} onConfirm={(reason) => { const chat = p.archiveChat; if (!chat) return; p.setArchiveChat(null); void p.act(chat, chat.status === 'to_join' && reason === JOIN_FAILED_REASON ? 'failed' : 'archive', { reason }, { action: 'restore', label: `В архів: ${reason.toLowerCase()}. Можна скасувати протягом 8 секунд.`, ...(chat.platform === 'telegram' && chat.status === 'to_join' && chat.telegramAccountId === null ? { extra: { toPool: true } } : {}) }); }} />
      <ConfirmDialog open={p.confirmation !== null} title={p.confirmation?.kind === 'assign' ? 'Перепризначити Telegram-акаунт?' : p.confirmation?.chat.platform === 'telegram' ? 'Повернути чат у чергу приєднання?' : 'Повернути чат до приєднання?'} description={p.confirmation?.kind === 'assign' ? `Чат перейде з «${p.confirmation.currentName}» на «${p.confirmation.nextName}». Членство в самому Telegram потрібно змінити вручну.` : p.confirmation?.chat.platform === 'telegram' ? `Чат повернеться в чергу приєднання${p.confirmation.chat.inSchedule ? ' і зникне зі слота розкладу — слот лишиться вільним' : ''}. Історія чату не видаляється.` : 'Чат повернеться в чергу «Для приєднання». Історія чату не видаляється.'} confirmLabel={p.confirmation?.kind === 'assign' ? 'Перепризначити' : 'Повернути'} busy={p.busy !== null} onCancel={() => p.setConfirmation(null)} onConfirm={p.confirmPlatformAction} />
      <ConfirmDialog open={p.deleteChat !== null} title="Остаточно видалити чат?" description={p.deleteChat ? `«${p.deleteChat.name}» більше не блокуватиме повторне додавання. Дію не можна скасувати; вона доступна лише для неіснуючого чату без публікацій, лідів або активного розкладу.` : ''} confirmLabel="Видалити назавжди" destructive busy={p.busy !== null} onCancel={() => p.setDeleteChat(null)} onConfirm={() => { const chat = p.deleteChat; p.setDeleteChat(null); if (chat) void p.act(chat, 'permanent_delete', { confirmation: 'PERMANENTLY_DELETE_NONEXISTENT_CHAT' }); }} />
    </div>
  );
}
