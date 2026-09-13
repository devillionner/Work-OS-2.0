import assert from 'node:assert/strict';
import test from 'node:test';
import { rankLeadScripts } from '../lib/leads/domain/script-match.ts';

const item = (id, options = {}) => ({
  id,
  title: options.title || id,
  ukText: options.ukText || 'UA',
  ruText: options.ruText || 'RU',
  notes: options.notes || '',
  tags: options.tags || [],
  platforms: options.platforms || [],
  updatedAt: options.updatedAt || 1,
});

void test('lead scripts prefer subject/stage matches and exclude another explicit platform', () => {
  const ranked = rankLeadScripts([
    item('english-response', {
      title: 'Англійська — перша відповідь',
      tags: ['англійська', 'response', 'особистий'],
      platforms: ['telegram'],
    }),
    item('telegram-generic', { platforms: ['telegram'] }),
    item('generic'),
    item('wrong-platform', {
      tags: ['англійська', 'response'],
      platforms: ['viber'],
    }),
  ], {
    platform: 'telegram',
    subject: 'Англійська',
    funnelStage: 'response',
    qualification: 'A',
  });

  assert.equal(ranked[0].id, 'english-response');
  assert.equal(ranked[0].audience, 'personal');
  assert.ok(ranked.some((entry) => entry.id === 'generic'));
  assert.ok(!ranked.some((entry) => entry.id === 'wrong-platform'));
});

void test('lead script ranking respects limit and uses newest item as a deterministic tie breaker', () => {
  const ranked = rankLeadScripts([
    item('old', { updatedAt: 1 }),
    item('new', { updatedAt: 2 }),
    item('third', { updatedAt: 3 }),
  ], {
    platform: 'facebook',
    subject: '',
    funnelStage: '',
    qualification: null,
  }, 2);

  assert.deepEqual(ranked.map((entry) => entry.id), ['third', 'new']);
  assert.ok(ranked.every((entry) => entry.audience === 'work'));
});
