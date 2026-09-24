import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const polish = readFileSync(
  new URL('../app/design-polish.css', import.meta.url),
  'utf8',
);

void test('Astra mobile menu keeps a fixed 44px target at narrow widths', () => {
  assert.match(
    polish,
    /\.mobile-menu \{[\s\S]*min-width: 44px;[\s\S]*flex: 0 0 44px;/,
  );
});

void test('Astra-confirmed Leads header actions keep 44px mobile targets', () => {
  assert.match(
    polish,
    /\.lead-section-head > \[data-slot="button"\][\s\S]*min-height: 44px;/,
  );
});

void test('Platform mobile workflow closes remaining direct target gaps', () => {
  assert.match(polish, /\.platform-hero > \[data-slot="button"\],[\s\S]*\.telegram-account-tabs > \[data-slot="button"\],[\s\S]*\.telegram-break > \[data-slot="button"\],[\s\S]*\.chat-main \[data-slot="button"\],[\s\S]*\.chat-pagination \[data-slot="button"\],[\s\S]*min-height: 44px;/);
  assert.match(polish, /\.chat-native-link \{[\s\S]*min-height: 44px;[\s\S]*display: flex;[\s\S]*align-items: center;/);
});
