import assert from 'node:assert/strict';
import test from 'node:test';
import { buildAnalyticsRecommendation, summarizeArchiveReasons } from '../lib/analytics-insights.ts';

void test('long-period zero-response chat is flagged only after a meaningful publication sample', () => {
  const recommendation = buildAnalyticsRecommendation([
    { id:'good',name:'Good',platform:'telegram',status:'ready',publications:8,responses:3,responseRate:37.5 },
    { id:'quiet',name:'Quiet',platform:'telegram',status:'ready',publications:7,responses:0,responseRate:0 },
  ], 30);
  assert.equal(recommendation.kind, 'check_low_efficiency');
  assert.equal(recommendation.chatId, 'quiet');
  assert.match(recommendation.explanation, /7 публікацій/);

  const short = buildAnalyticsRecommendation([
    { id:'quiet',name:'Quiet',platform:'telegram',status:'ready',publications:7,responses:0,responseRate:0 },
  ], 7);
  assert.equal(short.kind, 'insufficient_data');
});

void test('archived low-efficiency chat is never suggested for archive again', () => {
  const recommendation = buildAnalyticsRecommendation([
    { id:'archived',name:'Archived quiet',platform:'telegram',status:'archived',publications:9,responses:0,responseRate:0 },
    { id:'active',name:'Active good',platform:'telegram',status:'ready',publications:6,responses:2,responseRate:33.3 },
  ], 30);
  assert.equal(recommendation.kind,'consider_more_often');
  assert.equal(recommendation.chatId,'active');
});

void test('strong archived chat can only suggest a manual restore review', () => {
  const recommendation = buildAnalyticsRecommendation([
    { id:'archived',name:'Archived strong',platform:'viber',status:'archived',publications:5,responses:3,responseRate:60 },
  ], 30);
  assert.equal(recommendation.kind,'consider_more_often');
  assert.match(recommendation.title,/в архіві/);
  assert.match(recommendation.explanation,/відновити/);
});

void test('strongest sufficiently sampled chat is suggested without claiming automatic action', () => {
  const recommendation = buildAnalyticsRecommendation([
    { id:'a',name:'A',platform:'whatsapp',status:'ready',publications:10,responses:3,responseRate:30 },
    { id:'b',name:'B',platform:'viber',status:'ready',publications:5,responses:2,responseRate:40 },
    { id:'tiny',name:'Tiny',platform:'facebook',status:'ready',publications:2,responses:2,responseRate:100 },
  ], 30);
  assert.equal(recommendation.kind, 'consider_more_often');
  assert.equal(recommendation.chatId, 'b');
  assert.match(recommendation.explanation, /5 публікаціями/);
});

void test('small samples return an explicit insufficient-data result', () => {
  const recommendation = buildAnalyticsRecommendation([
    { id:'small',name:'Small',platform:'telegram',status:'ready',publications:4,responses:0,responseRate:0 },
  ], 90);
  assert.deepEqual(recommendation, {
    kind:'insufficient_data',
    title:'Поки недостатньо даних для рекомендації',
    explanation:'Для поясненої поради потрібно щонайменше 5 публікацій у чаті. Work OS не робить висновок із малої вибірки.',
    chatId:null,
    chatName:null,
  });
});

void test('archive reasons are normalized and sorted by frequency', () => {
  assert.deepEqual(summarizeArchiveReasons(['Дублікат','  Дублікат  ','Забанено','',null]),[
    { reason:'Без причини',count:2 },
    { reason:'Дублікат',count:2 },
    { reason:'Забанено',count:1 },
  ]);
});
