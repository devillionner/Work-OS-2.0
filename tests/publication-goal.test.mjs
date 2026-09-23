import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveDailyPublicationGoal } from '../lib/publication-goal.ts';
import { nextProfilePublicationDate, profilePublicationRule, validateChatProfile } from '../lib/chats/profile.ts';

void test('daily publication goal resolves override, period, default and fallback', () => {
  const schedule = JSON.stringify({ legacyStorageValue: JSON.stringify({ defaultGoal: { ads: 140 }, periods: [{ start: '2026-09-01', end: '2026-09-30', goal: { ads: 150 }, updatedAt: 1 }], overrides: { '2026-09-13': { ads: 160 } } }) });
  assert.equal(resolveDailyPublicationGoal(schedule, '2026-09-13'), 160);
  assert.equal(resolveDailyPublicationGoal(schedule, '2026-09-14'), 150);
  assert.equal(resolveDailyPublicationGoal(schedule, '2026-10-01'), 140);
  assert.equal(resolveDailyPublicationGoal('bad', '2026-09-13'), 100);
});

void test('profile rules normalize custom cadence and enforce date/weekdays', () => {
  const profile = validateChatProfile({ name:'Chat', language:'uk', cadence:'custom', weekdays:[7,1,1], customIntervalDays:3, nextAllowedOn:'2026-09-15', directions:[], note:'', reviewStatus:'confirmed' });
  assert.deepEqual(profile.weekdays,[1,7]); assert.equal(profile.customIntervalDays,3);
  assert.equal(profilePublicationRule(profile,'2026-09-13').allowed,false);
  assert.equal(profilePublicationRule({ ...profile, nextAllowedOn:null },'2026-09-13').allowed,true);
  assert.equal(profilePublicationRule({ ...profile, nextAllowedOn:null },'2026-09-14').allowed,true);
  assert.equal(profilePublicationRule({ ...profile, nextAllowedOn:null },'2026-09-15').allowed,false);
  assert.equal(nextProfilePublicationDate('2026-09-13','custom',3),'2026-09-16');
  assert.equal(nextProfilePublicationDate('2026-01-31','monthly',null),'2026-02-28');
});
void test('successful publication advances the confirmed profile next date', async (t) => {
  const { localDatabase, seedChat } = await import('./helpers/local-d1.mjs');
  const { readChatState } = await import('../lib/chats/state.ts');
  const { saveChatProfile } = await import('../lib/chats/profile.ts');
  const { recordManualPublication } = await import('../lib/chats/publication.ts');
  const db = await localDatabase(t); const now = Date.parse('2026-09-13T12:00:00Z') / 1000;
  await seedChat(db,{id:'daily-chat',platform:'whatsapp',status:'ready'});
  const before=await readChatState(db,'u','daily-chat');
  assert.equal((await saveChatProfile(db,{userId:'u',chatId:'daily-chat',stateToken:before.state_token,now,profile:{name:'Daily',language:'uk',cadence:'daily',weekdays:[],customIntervalDays:null,nextAllowedOn:null,directions:[],note:'',reviewStatus:'confirmed'}})).ok,true);
  const chat=await readChatState(db,'u','daily-chat');
  const publication=await recordManualPublication(db,{userId:'u',chat,accountId:null,now,date:'2026-09-13',stateToken:chat.state_token});
  assert.equal(publication.ok,true);
  assert.equal(typeof (publication.ok?publication.publicationId:null),'string');
  assert.equal(await db.prepare(`SELECT next_allowed_on FROM chat_profiles WHERE chat_id='daily-chat'`).first('next_allowed_on'),'2026-09-14');
});