import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const root = new URL('../', import.meta.url);
const source = (path) => readFileSync(new URL(path, root), 'utf8');

void test('PUB-04 and PROFILE-12 are present in the real operator flow', () => {
  const platform = source('components/platform-workspace.tsx');
  const chatsRoute = source('app/api/chats/route.ts');
  const profileDialog = source('components/chat-profile-dialog.tsx');
  assert.match(platform, /<span>Робочий темп<\/span><strong>\{data\.publicationPace\.ratePerHour\}\/год<\/strong>/);
  assert.match(platform, /<span>Денна ціль<\/span><strong>\{data\.publicationPace\.completed\} \/ \{data\.publicationPace\.target\}<\/strong>/);
  assert.match(chatsRoute, /publicationPace: \{ ratePerHour: 7, completed: completedPublications, target: resolveDailyPublicationGoal\(goalValue,today\) \}/);
  for (const value of ['any','daily','several_week','weekly','monthly','custom']) assert.match(profileDialog, new RegExp(value));
  assert.match(profileDialog, /Дозволені дні/);
  assert.match(profileDialog, /Наступна дозволена дата/);
  assert.match(profileDialog, /Інтервал, днів/);
});

void test('AD-06/07/09 keep daily reuse controlled and archived chats out of future Telegram plans', () => {
  const selection = source('lib/chats/advertisement-selection.ts');
  const scheduler = source('lib/chats/telegram-schedule.ts');
  const platform = source('components/platform-workspace.tsx');
  assert.match(selection, /hasUnusedEligible/);
  assert.match(selection, /Повтор дозволений: усі придатні варіанти вже використані сьогодні/);
  assert.match(selection, /спочатку оберіть невикористаний придатний варіант/);
  assert.match(scheduler, /c\.workflow_status='ready'/);
  assert.match(platform, /Архівувати/);
});

void test('LEAD-24 and SCRIPT-04 expose contextual work and personal scripts inside the lead card', () => {
  const workspace = source('components/leads/workspace.tsx');
  const scripts = source('components/leads/scripts.tsx');
  const ranking = source('lib/leads/domain/script-match.ts');
  assert.match(workspace, /<LeadScripts lead=\{current\.lead\} \/>/);
  assert.match(scripts, /rankLeadScripts\(items, \{/);
  assert.match(scripts, /subject: lead\.subject/);
  assert.match(scripts, /funnelStage: lead\.funnelStage/);
  assert.match(scripts, /qualification: lead\.qualification/);
  assert.match(scripts, /Особистий/);
  assert.match(scripts, /Робочий/);
  assert.match(ranking, /collection === 'personal_script' \? 'personal' : 'work'/);
});

void test('ANALYTICS-22 and KNOW-01/02 have complete user-facing surfaces', () => {
  const subjects = source('components/report-subject-analytics.tsx');
  const library = source('components/library-workspace.tsx');
  const history = source('components/library-history-dialog.tsx');
  for (const label of ['День','7 днів','30 днів','Місяць','Весь час']) assert.match(subjects, new RegExp(label));
  for (const label of ['Відгуки','Записи','Конверсія','Частка відгуків','Частка записів','Усього']) assert.match(subjects, new RegExp(label));
  assert.match(library, /knowledge:'База знань'/);
  assert.match(library, /Робоча інструкція, бот, підготовка учня або типова відповідь/);
  assert.match(library, /Зберегти нову версію/);
  assert.match(library, /<LibraryHistoryDialog/);
  assert.match(history, /Показати збережену версію/);
  assert.match(history, /knowledge:'База знань'/);
});


void test('AD-14/16/17 focus controls preserve data and expose plan freshness in the publish flow', () => {
  const today = source('components/today-settings-dialog.tsx');
  const settings = source('app/api/settings/route.ts');
  const selection = source('lib/chats/advertisement-selection.ts');
  const publish = source('components/chat-publish-dialog.tsx');
  assert.match(today, /FOCUS_DIRECTIONS\.map/);
  assert.match(today, /focus_directions: directions/);
  assert.match(settings, /key === 'focus_directions' \? canonicalDirections\(rawList\) : rawList/);
  assert.doesNotMatch(settings, /DELETE FROM (library_items|chat_profiles|activity_events)/);
  assert.match(selection, /focusDirections: focusPlan\.planDirections/);
  assert.match(selection, /taggedFocusDirections\.some/);
  assert.match(publish, /Активний фокус/);
  assert.match(publish, /Поточний план/);
  assert.match(publish, /planCreatedAt\*1000/);
  assert.match(publish, /План застарів після зміни фокусу/);
  assert.match(publish, /Оновити невиконану частину/);
  assert.match(publish, /Залишити поточний/);
});

void test('manual publishing and profile management cover the remaining operator parity surfaces', () => {
  const platform = source('components/platform-workspace.tsx');
  const route = source('app/api/chats/route.ts');
  const publication = source('lib/chats/publication.ts');
  const publish = source('components/chat-publish-dialog.tsx');
  const profile = source('components/chat-profile-dialog.tsx');
  const selection = source('lib/chats/advertisement-selection.ts');
  assert.match(platform, /<ChatPublishDialog/);
  assert.match(publish, /Відмітити публікацію/);
  assert.match(publish, /Відкрити чат/);
  assert.match(publish, /Публікація зараз недоступна:/);
  assert.match(selection, /profilePublicationRule/);
  assert.match(profile, /<option value="uk">Українська<\/option><option value="ru">Російська<\/option>/);
  assert.match(profile, /Напрямки/);
  assert.match(profile, /Нотатка про правила/);
  assert.match(platform, /Профілі: ✓ \{profileSummary\.confirmed\}/);
  assert.match(platform, /Потребують правил \(\$\{profileSummary\?\.needsReview\|\|0\}\)/);
  assert.match(route, /ORDER BY published_today ASC,CASE WHEN c\.snoozed_until IS NOT NULL/);
  assert.match(route, /action === 'undo_published'/);
  assert.match(publication, /export async function undoManualPublication/);
  assert.match(publication, /manualUndo/);
  assert.match(platform, /action:'undo_published'/);
  assert.match(platform, /Публікацію відмічено\. Чат переміщено нижче завершених на сьогодні/);
});

void test('WhatsApp and Viber quick publishing locks one material without bypassing normal publication rules', () => {
  const platform = source('components/platform-workspace.tsx');
  const publish = source('components/chat-publish-dialog.tsx');
  const publication = source('lib/chats/publication.ts');
  assert.match(platform, /queue==='ready'&&\(platform==='whatsapp'\|\|platform==='viber'\)/);
  assert.match(platform, /Почати швидку публікацію/);
  assert.match(platform, /setQuickAdvertisementId\(advertisementId\)/);
  assert.match(platform, /act\(publishChat,'published',\{advertisementId,language,quick\},\{action:'undo_published'/);
  assert.match(platform, /!chat\.profileConfirmed&&queue==='ready'&&<Badge variant="outline">Профіль пізніше<\/Badge>/);
  assert.match(publish, /quickMode&&preferredAdvertisementId/);
  assert.match(publish, /Матеріал швидкого режиму/);
  assert.match(publish, /quickMode&&!selected/);
  assert.match(publish, /Профіль чату ще не підтверджено/);
  assert.match(publication, /profilePublicationRule\(profile,date\)/);
  assert.match(publication, /chat\.workflow_status !== 'ready'/);
  assert.match(publication, /advertisementId/);
  assert.match(publication, /JSON\.stringify\(eventMetadata\)/);
});

void test('script library exposes search, tags, immutable versions and archive controls', () => {
  const library = source('components/library-workspace.tsx');
  const history = source('components/library-history-dialog.tsx');
  assert.match(library, /official_script:'Офіційні скрипти'/);
  assert.match(library, /personal_script:'Особисті скрипти'/);
  assert.match(library, /Пошук за назвою, текстом або тегом/);
  assert.match(library, /<label htmlFor="library-tags">Теги/);
  assert.match(library, /Історія/);
  assert.match(library, /В архів/);
  assert.match(history, /versionNumber/);
});


void test('chat operator flow keeps grouped copy, fast archive and archived-chat exclusion explicit', () => {
  const platform = source('components/platform-workspace.tsx');
  const selection = source('lib/chats/advertisement-selection.ts');
  assert.match(platform, /\(index\+1\)%5===0&&index<items\.length-1\?\[''\]:\[\]/);
  assert.match(platform, /\['Забанено','Чат не існує','Чат не цільовий'\]/);
  assert.match(platform, /queue==='archived'\?<><Button variant="outline" onClick=\{\(\)=>act\(chat,'restore'\)\}/);
  assert.match(selection, /c\.workflow_status='ready'/);
});


void test('chat archive reasons, available-now links and Telegram duplicate scope are explicit', () => {
  const platform = source('components/platform-workspace.tsx');
  const route = source('app/api/chats/route.ts');
  const duplicates = source('lib/chats/duplicates.ts');
  const migration = source('migrations/0011_telegram_accounts.sql');
  assert.match(platform, /\['Забанено','Чат не існує','Чат не цільовий'\]/);
  assert.match(platform, /aria-label="Власна причина архівації"/);
  assert.match(route, /availableTodayStatement/);
  assert.match(platform, /<TodayLinks title="Доступні зараз"/);
  assert.match(duplicates, /c\.telegram_account_id=\?3 OR \(c\.telegram_account_id IS NULL AND c\.workflow_status='to_join'\)/);
  assert.match(migration, /workflow_status != 'to_join' AND telegram_account_id IS NULL/);
});


void test('archived chat rows expose timestamp and tightly gated permanent deletion', () => {
  const route = source('app/api/chats/route.ts');
  const platform = source('components/platform-workspace.tsx');
  const deletion = source('lib/chats/permanent-delete.ts');
  assert.match(route, /c\.archive_reason,c\.archived_at/);
  assert.match(route, /archivedAt: row\.archived_at/);
  assert.match(platform, /queue==='archived'&&chat\.archivedAt&&<small>Архівовано \{formatDateTime\(chat\.archivedAt\)\}<\/small>/);
  assert.match(platform, /PERMANENTLY_DELETE_NONEXISTENT_CHAT/);
  assert.match(platform, /chat\.archiveReason==='Чат не існує'/);
  assert.match(deletion, /NOT EXISTS\(SELECT 1 FROM chat_publications/);
  assert.match(deletion, /NOT EXISTS\(SELECT 1 FROM leads/);
  assert.match(deletion, /chat_permanently_deleted/);
});

void test('Telegram account switch lets the request-key effect reload the selected account', () => {
  const platform = source('components/platform-workspace.tsx');
  assert.match(platform, /if\(action==='select'&&id\) \{[\s\S]*?setAccountId\(id\);[\s\S]*?await loadAccounts\(\);[\s\S]*?\} else \{/);
  assert.doesNotMatch(platform, /if\(action==='select'&&id\)[\s\S]{0,240}reloadChats\.current\(\)/);
});
