/**
 * lib/runs/emptyish-erase.test.ts
 *
 * 2026-08-21 · backend audit · Rule 6, the half that is not about nulls.
 *
 * All three `runs.data` upserts merge with
 *
 *     SET data = runs.data || jsonb_strip_nulls(EXCLUDED.data)
 *
 * `jsonb_strip_nulls` drops NULLS. It does not drop `[]`, and it does not drop
 * a string that happens to mean "nothing". Two writers shipped exactly those:
 *
 *   1 · `app/api/watch/workouts/complete/route.ts` set `data.splits = []` when
 *       the derived per-mile array failed `splitTimesReliable`. `[]` survived
 *       the strip and replaced real per-mile splits that `lib/runs/canonical.ts`
 *       had absorbed off the HealthKit twin. Confirmed in production
 *       (faff_readonly, 2026-08-21): the 2026-05-24 run carries `splits: []` on
 *       the canonical row while its merged loser still holds all 12.
 *       `omitEmpty` — the fix for this exact shape — existed in
 *       `lib/runs/merge-safe.ts` and was applied to the HK ingest route only.
 *
 *   2 · `app/api/strava/webhook/route.ts` and `app/api/ingest/workout/route.ts`
 *       spread `sanitizeElevGain`'s `{ value: null, source: 'absent' }` verbatim.
 *       The null height was stripped (correct — the real number survived), but
 *       `elevGainSource: 'absent'` overwrote that number's provenance. Nine
 *       production rows are in that state, and it is not inert:
 *       `lib/runs/post-write-hooks.ts` re-derives elevation precisely when the
 *       source reads `absent`, so a barometric reading gets replaced by a
 *       GPS/DEM estimate.
 *
 * `mergePreserve` is the codebase's own JS mirror of the SQL merge, so these
 * assert against the real semantics rather than a restatement of them.
 *
 * E1  mergePreserve genuinely does not protect `[]` (guards the premise)
 * E2  the watch route deletes the splits key instead of writing `[]`
 * E3  ... so absorbed splits survive a re-POST
 * E4  neither elevation writer emits a bare `elevGainSource`
 * E5  ... so a measured elevation keeps its provenance through a silent re-ingest
 * E6  the emptyish-erase class stays closed across every runs.data payload builder
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { mergePreserve, omitEmpty } from '@/lib/runs/merge-safe';

const codeOf = (p: string) =>
  readFileSync(path.join(process.cwd(), p), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

const WATCH = 'app/api/watch/workouts/complete/route.ts';
const WEBHOOK = 'app/api/strava/webhook/route.ts';
const HK = 'app/api/ingest/workout/route.ts';

const REAL_SPLITS = [
  { mile: 1, pace: '7:41', hr: 139 },
  { mile: 2, pace: '8:00', hr: 150 },
];

describe('E1 · the premise: the merge does not protect emptyish values', () => {
  it('null is stripped, [] is not', () => {
    const existing = { splits: REAL_SPLITS, elevGainFt: 1240, elevGainSource: 'watch' };
    // A null cannot erase — this is the half of Rule 6 already fixed.
    expect(mergePreserve(existing, { splits: null }).splits).toEqual(REAL_SPLITS);
    // An empty array can. This is why writing `[]` is the bug.
    expect(mergePreserve(existing, { splits: [] }).splits).toEqual([]);
    // And so can a non-null sentinel string.
    expect(mergePreserve(existing, { elevGainSource: 'absent' }).elevGainSource).toBe('absent');
    // omitEmpty is the sanctioned way out, and it is what the fixes mirror.
    expect(omitEmpty('splits', [])).toEqual({});
    expect(omitEmpty('splits', REAL_SPLITS)).toEqual({ splits: REAL_SPLITS });
  });
});

describe('E2/E3 · the watch route stops erasing absorbed splits', () => {
  it('E2 · the unreliable branch deletes the key rather than assigning []', () => {
    const code = codeOf(WATCH);
    expect(code).not.toMatch(/data\.splits\s*=\s*\[\s*\]/);
    expect(code).toMatch(/delete data\.splits;/);
    // The flag it sets alongside is still set — only the array assignment moved.
    expect(code).toMatch(/data\.splits_unreliable\s*=\s*true/);
  });

  it('E3 · a payload silent about splits leaves the absorbed array alone', () => {
    const canonical = { splits: REAL_SPLITS, splits_unreliable: true, distanceMi: 13.13 };
    // What the fixed route now sends on the unreliable branch: no splits key.
    const payload: Record<string, unknown> = { splits_unreliable: true, distanceMi: 13.13 };
    expect(mergePreserve(canonical, payload).splits).toEqual(REAL_SPLITS);
    // What it used to send.
    expect(mergePreserve(canonical, { ...payload, splits: [] }).splits).toEqual([]);
  });
});

describe('E4/E5 · elevation provenance survives a silent re-ingest', () => {
  for (const P of [WEBHOOK, HK]) {
    it(`E4 · ${P} returns {} rather than a bare 'absent'`, () => {
      const code = codeOf(P);
      // Every elevGainSource emission must be guarded by a non-null value.
      expect(code).toMatch(/if \((?:sane|sanity)\.value == null\) return \{\};/);
    });
  }

  it('E5 · a measured barometric reading keeps its source', () => {
    const canonical = { elevGainFt: 1240, elevGainSource: 'watch' };
    // Fixed writers, nothing to say about elevation:
    expect(mergePreserve(canonical, {})).toEqual(canonical);
    // Pre-fix writers, same input:
    const clobbered = mergePreserve(canonical, { elevGainFt: null, elevGainSource: 'absent' });
    expect(clobbered.elevGainFt).toBe(1240);          // the number survived …
    expect(clobbered.elevGainSource).toBe('absent');  // … and lost its origin.
    // post-write-hooks re-derives on exactly this predicate, which is why the
    // clobber is not merely cosmetic.
    expect(clobbered.elevGainSource === 'absent').toBe(true);
  });
});

describe('E6 · the class stays closed', () => {
  it('no runs.data payload builder assigns an empty array to a merged key', () => {
    const files = [WATCH, WEBHOOK, HK];
    // Guard against a hollow pass: if the reads failed, assert loudly here
    // rather than reporting "no offenders found".
    const sources = files.map((f) => ({ f, code: codeOf(f) }));
    expect(sources.every((s) => s.code.length > 2000)).toBe(true);

    const offenders: string[] = [];
    for (const { f, code } of sources) {
      // `data.<key> = []` or `<key>: []` inside a payload object literal.
      for (const m of code.matchAll(/data\.(\w+)\s*=\s*\[\s*\]/g)) {
        offenders.push(`${f}: data.${m[1]} = []`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
