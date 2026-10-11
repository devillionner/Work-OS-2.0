import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

void test('Discovery executor cannot source-crawl raw candidates before factual local qualification', async () => {
  const [runner, executor] = await Promise.all([
    readFile(new URL('../scripts/chat-discovery-runner.mjs', import.meta.url), 'utf8'),
    readFile(new URL('../lib/chat-discovery/executor.ts', import.meta.url), 'utf8'),
  ]);
  assert.match(runner,/function canAdvanceDiscoverySource\(\)\{\s*return false;/);
  assert.match(executor,/sourceAdvanceNeeded: false/);
  assert.doesNotMatch(executor,/SELECT min_members,status FROM chat_discovery_runs/);
});

// Operator decision 2026-10-02: outcomes stay in the tab session; non-targets become durable dedupe only
// through «Архівувати всі» (one batch), targets only through «Підтвердити».
void test('source name hints fail closed when they contain markup or URL noise', async () => {
  const preview = await readFile(new URL('../lib/chat-discovery/local-preview.ts', import.meta.url), 'utf8');
  assert.match(preview, /safeDiscoveryNameHint/);
  assert.match(preview, /src\|href\|class\|id/);
  assert.match(preview, /suggestedChatName/);
});

void test('autonomous start reaches the runner through the owner DO, not the tab', async()=>{
  const channel=await readFile(new URL('../workers/owner-channel.js',import.meta.url),'utf8');
  const http=channel.slice(channel.indexOf('async handleDiscoveryRunHttp'),channel.indexOf('In-flight autopost/Discovery tasks owned by'));
  assert.match(http,/next = startRun\(run, \{ runId: crypto\.randomUUID\(\), goal: body\.goal, now \}\)/);
  assert.match(http,/this\.broadcast\('runner', await this\.runPlanMessage\(next\.runId\)\)/);
  assert.match(http,/this\.broadcast\('runner', \{ type: 'run_control', process: 'discovery_run', runId: next\.runId, active: true \}\)/);
});

void test('final WhatsApp facts never inherit optimistic source guesses', async()=>{
  const runState=await readFile(new URL('../lib/chat-discovery/run-state.ts',import.meta.url),'utf8');
  assert.match(runState,/topicMatch: result\.topicMatch === 'match' \|\| result\.topicMatch === 'mismatch' \? result\.topicMatch : 'unknown'/);
  assert.match(runState,/canWrite: typeof result\.canWrite === 'boolean' \? result\.canWrite : null/);
  assert.match(runState,/activityState: result\.activityState === 'active' \|\| result\.activityState === 'dead' \? result\.activityState : 'unknown'/);
  assert.doesNotMatch(runState,/result\.topicMatch === 'mismatch' \? result\.topicMatch : candidate\.topicMatch/);
});

