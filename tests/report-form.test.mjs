import assert from 'node:assert/strict';
import test from 'node:test';
import { ADMIN_REPORT_FORM_URL } from '../lib/reports/form.ts';

void test('administrator report form keeps the current legacy destination', () => {
  assert.equal(
    ADMIN_REPORT_FORM_URL,
    'https://docs.google.com/forms/d/e/1FAIpQLSeXjsjGDWBdTngl4F01vl7BpMwQj_Q1fmCImiQ_1SQhO37dGw/viewform',
  );
  assert.match(ADMIN_REPORT_FORM_URL, /^https:\/\/docs\.google\.com\/forms\//);
});
