/**
 * lib/coach/_race_meta_sentinel.test.ts — a legacy "unset" sentinel is not a
 * value, and it is coerced once at the composition layer, not per client.
 *
 * `races.meta.startTime` for `cim` is literally the single character `·`. It
 * reached the phone's race detail as:
 *
 *     Gun time    ·
 *
 * a piece of punctuation presented as the time the runner's goal marathon
 * starts. It survived because every guard on the path is a TRUTHINESS test —
 * `app/api/v5/races/route.ts` composes the row under `if (r.gun_time)`, and
 * `'·'` is a non-empty string.
 *
 * The web client had already met this and grown a LOCAL defence
 * (`RaceDetailClient.tsx`: `r.startTime !== '·' ? … : 'Not set'`), which fixed
 * one renderer and left the phone, the notification templates, the race-week
 * course builder and the execution plan's gun-relative clock reading it raw.
 * A guard in one client is not a fix; it is a second reader disagreeing with
 * the first. So the coercion moved to `races-state.ts`, which every consumer
 * of a race row already goes through.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { metaText } from './races-state';

const ROOT = path.resolve(__dirname, '..', '..');

describe('metaText · the sentinel is not a value', () => {
  it('rejects the exact character stored on cim', () => {
    expect(metaText('·')).toBeNull();
  });

  it('rejects the sentinels that would otherwise render as punctuation or noise', () => {
    for (const s of ['·', ' · ', '-', '--', '—', '–', 'N/A', 'n/a', 'TBD', 'tba', 'None', 'null', 'undefined', 'unknown', '']) {
      expect(metaText(s), JSON.stringify(s)).toBeNull();
    }
  });

  it('preserves every real value on the owner\'s account', () => {
    // These are the actual stored strings, not invented ones.
    expect(metaText('7:00 AM')).toBe('7:00 AM');
    expect(metaText('6:15 AM')).toBe('6:15 AM');
    expect(metaText('Dodger Stadium, 1000 Vin Scully Ave, Los Angeles, CA 90012'))
      .toBe('Dodger Stadium, 1000 Vin Scully Ave, Los Angeles, CA 90012');
    // The dodgers row's whole paragraph is ugly but it is information.
    expect(metaText('Not yet published for 2026; Kids Fun Run at 4:00 PM'))
      .toMatch(/^Not yet published/);
  });

  it('does not eat a value that merely CONTAINS a sentinel character', () => {
    // The interpunct is the app's own separator and appears inside real copy.
    expect(metaText('7:00 AM · wave B')).toBe('7:00 AM · wave B');
    expect(metaText('Start-Finish on Ocean Ave')).toBe('Start-Finish on Ocean Ave');
  });

  it('trims rather than rejecting padded real values', () => {
    expect(metaText('  7:00 AM  ')).toBe('7:00 AM');
  });

  it('is null-safe for every non-string shape the jsonb column can hold', () => {
    for (const v of [null, undefined, 0, 1, {}, [], true]) {
      expect(metaText(v)).toBeNull();
    }
  });
});

describe('the fix is at the composition layer, not in one client', () => {
  const src = fs.readFileSync(path.join(ROOT, 'lib/coach/races-state.ts'), 'utf8');

  it('every free-text meta field goes through metaText', () => {
    // Fixing only the field that was reported leaves its siblings loaded —
    // they share the same authors (race editor, autofill crawler) and so the
    // same "wrote a placeholder instead of nothing" exposure.
    for (const field of [
      'gun_time', 'wave', 'bib', 'website', 'packet_pickup', 'shuttle',
      'parking', 'notes', 'summary', 'notable_miles', 'weather_norms',
      'gear_check', 'pacers', 'spectators', 'location',
    ]) {
      // The COMPOSITION line, not the interface declaration of the same name
      // — both start with `${field}:`, and only one of them reads `m.…`.
      const line = src.split('\n').find((l) => new RegExp(`^\\s*${field}:.*\\bm\\.`).test(l));
      expect(line, `${field} not found in the row composition`).toBeTruthy();
      expect(line, `${field} does not sanitise`).toMatch(/metaText\(|firstClause\(/);
    }
  });

  it('the ?? chain resolves the naming history before the sentinel check', () => {
    // A row storing '·' under startTime and a real time under start_time must
    // still find the real one — so each alternative is checked individually.
    expect(src).toMatch(/gun_time: metaText\(m\.startTime\) \?\? metaText\(m\.gun_time\) \?\? metaText\(m\.start_time\)/);
  });
});
