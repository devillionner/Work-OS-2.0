import assert from 'node:assert/strict';
import test from 'node:test';
import { handleTabKeyNavigation } from '../lib/tab-navigation.ts';

function makeTabs(count, disabled = []) {
  const calls = Array.from({ length: count }, () => ({ focus: 0, click: 0 }));
  const tabs = calls.map((state, index) => ({
    disabled: disabled.includes(index),
    focus() { state.focus += 1; },
    click() { state.click += 1; },
    parentElement: null,
  }));
  const parent = { querySelectorAll: (selector) => selector.includes(':not(:disabled)') ? tabs.filter((tab) => !tab.disabled) : tabs };
  for (const tab of tabs) tab.parentElement = parent;
  return { tabs, calls };
}

function press(tabs, index, key) {
  let prevented = 0;
  handleTabKeyNavigation({ key, currentTarget: tabs[index], preventDefault() { prevented += 1; } });
  return prevented;
}

void test('tab keyboard navigation moves, wraps and activates the focused tab', () => {
  const { tabs, calls } = makeTabs(4);
  assert.equal(press(tabs, 1, 'ArrowRight'), 1);
  assert.deepEqual(calls.map((item) => item.focus), [0, 0, 1, 0]);
  assert.deepEqual(calls.map((item) => item.click), [0, 0, 1, 0]);
  assert.equal(press(tabs, 0, 'ArrowLeft'), 1);
  assert.equal(calls[3].focus, 1);
  assert.equal(calls[3].click, 1);
});

void test('tab keyboard navigation supports Home and End and ignores unrelated keys', () => {
  const { tabs, calls } = makeTabs(3);
  assert.equal(press(tabs, 1, 'Home'), 1);
  assert.equal(press(tabs, 1, 'End'), 1);
  assert.equal(press(tabs, 1, 'Enter'), 0);
  assert.equal(calls[0].focus, 1);
  assert.equal(calls[2].focus, 1);
  assert.equal(calls[1].focus, 0);
});

void test('tab keyboard navigation skips disabled tabs and leaves a lone enabled tab untouched', () => {
  const { tabs, calls } = makeTabs(4, [1, 2]);
  assert.equal(press(tabs, 0, 'ArrowRight'), 1);
  assert.equal(calls[3].focus, 1);
  assert.equal(calls[3].click, 1);

  const single = makeTabs(3, [0, 2]);
  assert.equal(press(single.tabs, 1, 'ArrowRight'), 0);
  assert.deepEqual(single.calls.map((item) => item.focus), [0, 0, 0]);
  assert.deepEqual(single.calls.map((item) => item.click), [0, 0, 0]);
});
