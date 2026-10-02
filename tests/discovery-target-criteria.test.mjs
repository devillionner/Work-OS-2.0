import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { evaluateDiscoveryCandidate, inferDiscoveryTopicMatch } from '../lib/chat-discovery/domain.ts';

// Operator decision 2026-10-02: a WhatsApp target is a group (not a community) of 700–18,000 members with a
// Ukrainian audience where the account can write. Ad rules and activity are not criteria; religious groups
// are never targets.
const confirmed = {
  chatType:'group', memberCount:900, topicMatch:'match', canWrite:true,
  adsPolicy:'unknown', activityState:'unknown',
  membershipState:'joined', inspectionState:'inspected', linkState:'valid', accessState:'available',
};

void test('unknown ad rules and activity no longer keep a confirmed group out of targets', () => {
  assert.deepEqual(evaluateDiscoveryCandidate(confirmed), { decision:'target', reasonCodes:['all_required_confirmed'] });
  assert.equal(evaluateDiscoveryCandidate({ ...confirmed, adsPolicy:'forbidden', activityState:'dead' }).decision, 'target');
});

void test('communities are rejected and size, audience and write access still decide', () => {
  assert.deepEqual(evaluateDiscoveryCandidate({ ...confirmed, chatType:'community' }), { decision:'rejected', reasonCodes:['community_not_supported'] });
  assert.deepEqual(evaluateDiscoveryCandidate({ ...confirmed, memberCount:500 }).reasonCodes, ['too_few_members']);
  assert.deepEqual(evaluateDiscoveryCandidate({ ...confirmed, canWrite:false }).reasonCodes, ['cannot_write']);
  assert.deepEqual(evaluateDiscoveryCandidate({ ...confirmed, topicMatch:'unknown' }), { decision:'review', reasonCodes:['unknown_topic_match'] });
});

void test('religious groups are a topic mismatch even with a Ukrainian audience', () => {
  assert.equal(inferDiscoveryTopicMatch('Українці Мюнхен барахолка', []), 'match');
  for (const name of ['Українська греко-католицька парафія Мюнхен', 'Православна церква України в Берліні', 'Молитовна група українців Відень', 'Ukrainian church Dublin'])
    assert.equal(inferDiscoveryTopicMatch(name, []), 'mismatch', name);
});

void test('the runner screens communities and religious groups from invite metadata, before any join', async () => {
  const runner = await readFile(new URL('../scripts/chat-discovery-runner.mjs', import.meta.url), 'utf8');
  const adapter = await readFile(new URL('../scripts/whatsapp-web-cdp.mjs', import.meta.url), 'utf8');
  const preflight = runner.slice(runner.indexOf('async function processLocalPreflight('), runner.indexOf('async function resolveLocalSourceSeedData'));
  const community = preflight.indexOf("if(pre.chatType==='community')reasons.push('community_not_supported')");
  assert.ok(community > 0 && community < preflight.indexOf('joinWhatsappInviteViaRuntime(task'));
  assert.doesNotMatch(runner, /unknown_ads_allowed|unknown_activity|ads_forbidden|inactive_chat/);
  assert.match(adapter, /const topicMatch=spamPattern\.test\(evidence\)\|\|nonTargetGroupPattern\.test\(evidence\)/);
  assert.match(adapter, /nonTargetGroupPattern\.test\(identityEvidence\)/);
  assert.match(adapter, /nonTargetGroupPattern\.test\(identityText\)/);
  // The browser adapter and the server must use the same list of non-target names.
  const domain = await readFile(new URL('../lib/chat-discovery/domain.ts', import.meta.url), 'utf8');
  const server = /NON_TARGET_GROUP_PATTERN = (\/.+\/iu);/.exec(domain)?.[1];
  const browser = /const nonTargetGroupPattern = (\/.+\/iu);/.exec(adapter)?.[1];
  assert.ok(server && server === browser);
});
