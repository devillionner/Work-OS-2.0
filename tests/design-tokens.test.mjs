import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const globals = readFileSync(new URL('../app/globals.css', import.meta.url), 'utf8');
const polish = readFileSync(new URL('../app/design-polish.css', import.meta.url), 'utf8');
const css = `${globals}\n${polish}`;

/** Token values declared in the single :root block. */
function tokens() {
  const block = globals.match(/^:root \{([\s\S]*?)^\}/m);
  assert.ok(block, ':root block must be parseable');
  const found = new Map();
  for (const [, name, value] of block[1].matchAll(/^\s*(--[a-z0-9-]+):\s*([^;]+);/gm)) {
    found.set(name, value.trim());
  }
  return found;
}

/** WCAG 2.1 relative luminance. */
function luminance(hex) {
  const raw = hex.replace('#', '');
  const full = raw.length === 3 ? raw.split('').map((c) => c + c).join('') : raw;
  const channel = (value) => {
    const v = value / 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16));
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function contrast(a, b) {
  const [x, y] = [luminance(a), luminance(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

void test('globals.css declares tokens exactly once so the top block is the real one', () => {
  // A second :root later in the file silently overrode --background/--muted/--border
  // and made the documented token block wrong. One block only.
  assert.equal(globals.match(/^:root \{/gm)?.length, 1);
});

void test('semantic colour tokens exist and are mapped into the Tailwind theme', () => {
  const found = tokens();
  for (const name of [
    '--destructive', '--destructive-foreground', '--destructive-surface',
    '--success', '--success-surface', '--warning', '--warning-surface',
    '--surface-subtle', '--muted-foreground', '--sidebar-surface', '--sidebar-foreground-muted',
  ]) {
    assert.ok(found.has(name), `${name} must be declared in :root`);
  }
  // Without the @theme mapping Tailwind never emits bg-destructive/text-destructive,
  // which is how every destructive confirm button silently lost its colour.
  for (const mapped of [
    '--color-destructive: var(--destructive)',
    '--color-destructive-foreground: var(--destructive-foreground)',
    '--color-success: var(--success)',
    '--color-warning: var(--warning)',
  ]) {
    assert.ok(globals.includes(mapped), `@theme inline must map ${mapped}`);
  }
});

void test('every @theme mapping points at a token that actually exists', () => {
  // This is the exact shape of the original bug: --color-destructive mapped to
  // --destructive, which was never declared, so Tailwind silently emitted no utility.
  const theme = globals.match(/@theme inline \{([\s\S]*?)\n\}/);
  assert.ok(theme, '@theme inline block must be parseable');
  const declared = tokens();
  const broken = [];
  for (const [, mapping, token] of theme[1].matchAll(/(--color-[a-z0-9-]+):\s*var\((--[a-z0-9-]+)\)/g)) {
    if (!declared.has(token)) broken.push(`${mapping} → ${token}`);
  }
  assert.deepEqual(broken, [], `mapped to undeclared tokens — Tailwind emits nothing: ${broken.join('; ')}`);
});

void test('text tokens meet WCAG AA 4.5:1 on every surface they are used on', () => {
  const found = tokens();
  const surfaces = ['--card', '--background', '--muted', '--surface-subtle', '--accent'];
  const texts = ['--muted-foreground', '--foreground', '--primary', '--destructive', '--success', '--warning'];
  const failures = [];
  for (const text of texts) {
    for (const surface of surfaces) {
      const ratio = contrast(found.get(text), found.get(surface));
      if (ratio < 4.5) failures.push(`${text} on ${surface}: ${ratio.toFixed(2)}`);
    }
  }
  assert.deepEqual(failures, [], `below AA 4.5:1 — ${failures.join('; ')}`);
});

void test('inverted tokens stay readable on the surfaces they sit on', () => {
  const found = tokens();
  const pairs = [
    ['--primary-foreground', '--primary'],
    ['--destructive-foreground', '--destructive'],
    ['--sidebar-foreground', '--sidebar-surface'],
    ['--sidebar-foreground-muted', '--sidebar-surface'],
    ['--accent-foreground', '--accent'],
  ];
  const failures = [];
  for (const [text, surface] of pairs) {
    const ratio = contrast(found.get(text), found.get(surface));
    if (ratio < 4.5) failures.push(`${text} on ${surface}: ${ratio.toFixed(2)}`);
  }
  assert.deepEqual(failures, [], `below AA 4.5:1 — ${failures.join('; ')}`);
});

void test('colours that failed contrast are gone from the stylesheets', () => {
  // Each of these was measured below 4.5:1 against the surface it was painted on,
  // while carrying 10–13 px text. They must stay replaced by tokens.
  for (const hex of ['#d97706', '#737b8a', '#727a89', '#6f7583', '#687181', '#8a909c', '#69707d']) {
    assert.doesNotMatch(css, new RegExp(`${hex}(?![0-9a-fA-F])`, 'i'), `${hex} fails AA and must use a token`);
  }
});

void test('metadata text never drops below the 10 px floor', () => {
  assert.doesNotMatch(css, /font-size:\s*[0-9]px(?![0-9])/);
});

void test('motion rhythm tokens are declared and have valid easing and duration values', () => {
  const found = tokens();
  for (const name of ['--motion-fast', '--motion-base', '--motion-slow', '--motion-ease-spring', '--motion-ease-smooth', '--motion-spin-duration']) {
    assert.ok(found.has(name), `${name} must be declared in :root for unified animation rhythm`);
  }
  assert.match(found.get('--motion-fast'), /^[0-9]+ms$/);
  assert.match(found.get('--motion-base'), /^[0-9]+ms$/);
  assert.match(found.get('--motion-ease-spring'), /^cubic-bezier\(/);
});

