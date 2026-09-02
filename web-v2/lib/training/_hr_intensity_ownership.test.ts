/**
 * lib/training/_hr_intensity_ownership.test.ts · BRAIN SCORECARD, 2026-09-02.
 *
 * Constitution §5 ("one question, one resolver") and §29's Pace Prescription
 * row — "how hard should this workout be?" — applied to the HALF of intensity
 * that is not pace.
 *
 * ── THE FINDING THIS PINS ───────────────────────────────────────────────────
 *
 * `lib/training/load-prescription-anchors.ts` resolves SIX pace anchors for a
 * runner and is the single owner of prescribed pace. There is no equivalent
 * for heart rate. The HR half of the same prescription is derived from a
 * hand-written fraction of LTHR or HRmax in four modules outside
 * `lib/training/zones.ts`, and they do not agree with each other.
 *
 * Measured on the reference runner's live plan (LTHR 168), plan
 * `pln_9a57561debb776e5`, row 2026-09-08, `workout_spec`:
 *
 *     { kind: 'tempo', tempo_pace_s_per_mi: 430, hr_target_bpm: 155,
 *       rules: [ pass avgHr <= 164, bail avgHr > 173 ] }
 *
 * 430 s/mi IS the canonical threshold pace out of `resolveThresholdCapacity`
 * (Daniels T). 155 is `round(168 * 0.92)` from `spec-builder.ts`, which is the
 * TOP OF FRIEL Z3 — a tempo heart rate under a threshold pace. 164 is
 * `thresholdPassHrBpm(168)` = `round(168 * 0.975)`, the Z4/Z5 seam, and it is
 * the number the row is actually judged against. The runner's own most recent
 * threshold session (2026-09-01) ran the work at 162 bpm and 7:02/mi, so the
 * prescribed HR target is 7 bpm below what he demonstrably holds at the
 * prescribed pace.
 *
 * The watch reads that same row and adds two more anchors of its own
 * (`build-workout.ts` — 0.95 and 0.87 of HRmax as an LTHR-absent fallback,
 * 0.78 of HRmax for an easy ceiling), so a runner with no LTHR on file is
 * prescribed HR off a THIRD derivation.
 *
 * ── B7 · WHAT CLOSED, 2026-09-02 ────────────────────────────────────────────
 *
 * `lib/training/zones.ts` is now the owner of the PRESCRIBED half. It holds
 * `FRIEL_PCT_LTHR_BY_INTENSITY` (Research/03 §6) and
 * `DANIELS_PCT_HRMAX_BY_INTENSITY` / `DANIELS_PCT_HRMAX_TARGET` (§8), and
 * `prescribedHrTargetBpm({ intensity, lthr, maxHr })` answers for every caller.
 * Three sites migrated and the allowlist below shrank from seven to four:
 *
 *   spec-builder.ts   0.92 x lthr    → prescribedHrTargetBpm('threshold')
 *   build-workout.ts  0.95 x maxHr   → prescribedHrTargetBpm('interval')
 *   build-workout.ts  0.87 x maxHr   → prescribedHrTargetBpm('threshold')
 *
 * A FOURTH site was consolidated that this scanner never saw: the watch's
 * interval uplift `Math.round(rawHrTarget * 1.05)`. It is a fraction of LTHR
 * applied to a VARIABLE, so the regex below could not match it — the exact
 * blind spot the Rule 22 note already declared. 1.05 is the centre of Friel
 * Z5b, so it now comes from the table like everything else.
 *
 * ── THE RESIDUAL, NAMED RATHER THAN QUIETLY LEFT ────────────────────────────
 *
 * The easy CEILING is still three definitions of 0.78 x HRmax:
 * `spec-builder#hrCapEasy`, the watch's `hrCeilingBpm` fallback, and
 * `lib/coach/easy-discipline#EASY_HRMAX_CEILING_PCT`. It was NOT folded in on
 * this pass, for reasons that are not convenience:
 *
 *   1. `lib/coach/**` was outside the editing agent's file boundary, so two of
 *      three could have been merged and the third left standing — which is a
 *      worse state than three, not a better one.
 *   2. `EASY.cap-not-looser-than-daniels` in `lib/doctrine/registry.ts` parses
 *      the literal out of `hrCapEasy`'s source text and carries an ARGUED
 *      known-violation exemption about `MAX(lthrCap, maxHrCap)` being the
 *      looser of two ceilings. Moving the arithmetic would have broken a live
 *      claim and orphaned a real, documented finding.
 *
 * It is a ceiling, not a target, so `DANIELS_PCT_HRMAX_TARGET.easy` is `null`
 * rather than a fourth copy of 0.78. Two allowlist rows below carry it.
 *
 * ── WHAT THIS TEST DOES ─────────────────────────────────────────────────────
 *
 * It does NOT assert the fractions are wrong — that is a doctrine question and
 * `zones.ts` cites `Research/03` for the two it owns. It asserts that the SET
 * of modules deriving an HR intensity from a physiological anchor is exactly
 * the set enumerated below, so that consolidating one (or adding a fifth)
 * cannot happen silently. The allowlist is a RATCHET: it may shrink, never
 * grow, and an entry whose site is now clean fails until deleted (Rule 18 §4).
 *
 * ── RULE 22 · WHAT THIS TEST CANNOT FAIL ON ─────────────────────────────────
 *
 *   · It cannot see a fraction that is not spelled as a decimal literal
 *     against `lthr` / `maxHr` in the same expression — a constant extracted
 *     to a named export in another file, an anchor multiplied in two steps, or
 *     an HR derived from a percentage stored in the database, all pass.
 *   · It cannot tell a CORRECT derivation from an incorrect one. Every site
 *     below could be changed to a wrong fraction and this test stays green;
 *     only the LOCATION is pinned.
 *   · It cannot see Swift. `native-v2` carries its own HR logic on the wrist
 *     and nothing here reads it.
 *   · It says nothing about whether these numbers reach a screen. Reachability
 *     is the scorecard's job, not this file's.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import {
  FRIEL_PCT_LTHR_BY_INTENSITY,
  DANIELS_PCT_HRMAX_BY_INTENSITY,
  DANIELS_PCT_HRMAX_TARGET,
  prescribedHrTargetBpm,
  thresholdPassHrBpm,
} from './zones';

const ROOT = join(__dirname, '..', '..');

/**
 * Every site outside `lib/training/zones.ts` that derives a heart rate from a
 * physiological anchor by multiplying it by a literal fraction. One entry per
 * distinct fraction per file. RATCHET — shrink only.
 */
const HR_DERIVATION_ALLOWLIST: ReadonlyArray<{
  file: string; fraction: string; anchor: 'lthr' | 'maxHr'; reason: string;
}> = [
  {
    file: 'lib/plan/spec-builder.ts', fraction: '0.78', anchor: 'maxHr',
    reason: 'RESIDUAL, argued in the header. The easy CEILING half of '
      + 'max(89% LTHR, 78% HRmax). Not migrated on the B7 pass because '
      + '`EASY.cap-not-looser-than-daniels` parses this literal out of the '
      + 'source text and hangs an argued known-violation exemption on the '
      + 'MAX(...) beside it, and the third copy of the same number lives in '
      + '`lib/coach/**`, out of that pass\'s boundary. A ceiling, not a target.',
  },
  {
    file: 'lib/watch/build-workout.ts', fraction: '0.78', anchor: 'maxHr',
    reason: 'RESIDUAL. The watch re-derives the easy CEILING when the plan row '
      + 'carries no hr_cap_bpm. Second copy of the spec-builder line above, '
      + 'and it stays paired with it — migrating one of a matched pair is how '
      + 'two surfaces start disagreeing. Same argument as that row.',
  },
  {
    file: 'lib/training/lthr.ts', fraction: '0.90', anchor: 'maxHr',
    reason: 'NOT a prescription — `lthrFromMaxHr`, the ANCHOR ESTIMATOR that '
      + 'produces LTHR itself when none is on file. Answers a different '
      + 'question (what is the anchor?), so it correctly sits outside the zone '
      + 'table that consumes the anchor. Found by this scanner and missed by a '
      + 'hand grep, which is the point of the scanner.',
  },
  {
    file: 'lib/training/vdot.ts', fraction: '0.80', anchor: 'maxHr',
    reason: 'NOT a prescription — the honest-effort admissibility gate for '
      + 'reading a training run as a fitness candidate. Different question '
      + '(is this evidence?), correctly not in zones.ts. Listed so the scan '
      + 'stays complete rather than filtered.',
  },
];

/** Files the scanner reads. Tests, scripts and the zone owner are excluded. */
function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === '.next' || name.startsWith('.')) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) sourceFiles(p, out);
    else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) && !/\.script\.ts$/.test(name)) out.push(p);
  }
  return out;
}

/** `lthr * 0.92`, `maxHr * 0.78`, `lthrBpm * 0.975`, `max_hr * 0.8` … */
const HR_FRACTION = /\b(lthr|lthrBpm|lthr_bpm|maxHr|maxHrBpm|max_hr)\s*\*\s*(0\.\d+)/gi;

describe('HR intensity ownership · the prescribed half is owned (B7, 2026-09-02)', () => {
  const files = [
    ...sourceFiles(join(ROOT, 'lib')),
    ...sourceFiles(join(ROOT, 'app')),
  ].filter((f) => !f.endsWith(join('lib', 'training', 'zones.ts')));

  it('LIVENESS · the scanner actually read source (Rule 18 §2)', () => {
    expect(files.length).toBeGreaterThan(400);
  });

  const found: Array<{ file: string; fraction: string; anchor: string; line: number }> = [];
  for (const f of files) {
    const rel = f.slice(ROOT.length + 1);
    const src = readFileSync(f, 'utf8');
    src.split('\n').forEach((line, i) => {
      if (line.trimStart().startsWith('*') || line.trimStart().startsWith('//')) return;
      HR_FRACTION.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = HR_FRACTION.exec(line))) {
        const anchor = /lthr/i.test(m[1]) ? 'lthr' : 'maxHr';
        found.push({ file: rel, fraction: m[2], anchor, line: i + 1 });
      }
    });
  }

  it('every HR derivation outside zones.ts is on the allowlist', () => {
    const unlisted = found.filter((f) => !HR_DERIVATION_ALLOWLIST.some(
      (a) => a.file === f.file && Number(a.fraction) === Number(f.fraction) && a.anchor === f.anchor,
    ));
    expect(
      unlisted.map((u) => `${u.file}:${u.line} ${u.anchor} * ${u.fraction}`),
    ).toEqual([]);
  });

  it('RATCHET · every allowlist entry still names a live site (Rule 18 §4)', () => {
    const stale = HR_DERIVATION_ALLOWLIST.filter((a) => !found.some(
      (f) => f.file === a.file && Number(f.fraction) === Number(a.fraction) && f.anchor === a.anchor,
    ));
    expect(stale.map((s) => `${s.file} ${s.anchor} * ${s.fraction}`)).toEqual([]);
  });

  it('the count is pinned · consolidating one must update this file', () => {
    // FOUR sites, down from seven (B7, 2026-09-02). Two are the easy-CEILING
    // residual argued in the header; two answer a different question entirely
    // (anchor estimation, evidence admissibility). Not one of the four is a
    // prescribed intensity target any more — every one of those now resolves
    // through `prescribedHrTargetBpm`.
    //
    // Lower this number when a site moves into zones.ts; it may never be
    // raised. RATCHET.
    expect(found.length).toBe(4);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * B7 · THE OWNER ITSELF · 2026-09-02
 *
 * The block above pins WHERE derivations live. This one checks that the owner
 * agrees with the research, by parsing the numbers OUT OF `Research/03` at run
 * time rather than restating them — a check that hardcodes both sides only
 * proves the test agrees with itself (Rule 18).
 *
 * ── RULE 22 · WHAT THIS BLOCK CANNOT FAIL ON ────────────────────────────────
 *
 *   · It cannot tell whether Friel's BAND is the right band for a given
 *     Daniels intensity. That mapping (T pace -> Friel Z4) is a doctrine
 *     judgement stated in `zones.ts`; this only checks the arithmetic against
 *     the row that judgement names.
 *   · It cannot see any caller. A module could stop calling
 *     `prescribedHrTargetBpm` tomorrow and every assertion here still passes;
 *     the allowlist scan above is what covers that, and only for fractions it
 *     can pattern-match.
 *   · It cannot see the wrist's Swift.
 *   · It says nothing about the easy CEILING family, which is the declared
 *     residual, not a covered case.
 * ══════════════════════════════════════════════════════════════════════════ */
describe('B7 · the HR prescription owner agrees with Research/03', () => {
  const DOC = join(ROOT, '..', 'Research', '03-heart-rate-zones.md');
  const doc = readFileSync(DOC, 'utf8');

  it('LIVENESS · the doctrine file was actually read (Rule 18 §2)', () => {
    expect(doc.length).toBeGreaterThan(2000);
    expect(doc).toContain('### Friel 7-Zone Running HR Table');
    expect(doc).toContain("## 8. Daniels' HR Zones");
  });

  /** The doc has SEVERAL percent tables. Slice to the one section first, or a
   *  row label matches a %HRmax row in §4 and the check silently grades the
   *  engine against the wrong table (it did, on the first run). */
  function section(startsWith: string, endsWith: string): string {
    const a = doc.indexOf(startsWith);
    if (a < 0) throw new Error(`Research/03 has no section "${startsWith}"`);
    const b = doc.indexOf(endsWith, a + startsWith.length);
    if (b < 0) throw new Error(`Research/03 section "${startsWith}" is unterminated`);
    return doc.slice(a, b);
  }
  const FRIEL_TABLE = section('### Friel 7-Zone Running HR Table', '### Friel Pace Zones');
  const DANIELS_TABLE = section("## 8. Daniels' HR Zones", '### Notes');

  /** `| 3 Tempo | 90-94% | ... |` -> [0.90, 0.94] */
  function frielRow(label: string): [number, number] {
    const re = new RegExp(`\\|\\s*${label}[^|]*\\|\\s*(\\d+)\\s*[\u2013-]\\s*(\\d+)\\s*%`, 'i');
    const m = FRIEL_TABLE.match(re);
    if (!m) throw new Error(`Research/03 Friel table has no row matching ${label}`);
    return [Number(m[1]) / 100, Number(m[2]) / 100];
  }

  /** `| T (Threshold) | 86-92% | ... |` -> [0.86, 0.92] */
  function danielsRow(pattern: string): [number, number] {
    const re = new RegExp(`\\|\\s*${pattern}\\s*\\|\\s*(\\d+)\\s*[\u2013-]\\s*(\\d+)\\s*%`, 'i');
    const m = DANIELS_TABLE.match(re);
    if (!m) throw new Error(`Research/03 Daniels table has no row matching ${pattern}`);
    return [Number(m[1]) / 100, Number(m[2]) / 100];
  }

  it("the Friel band per intensity is the doc's own row", () => {
    // The doc publishes WHOLE-PERCENT runs (85-89, 90-94, ...) which tile the
    // whole percents; their continuous extension is [floor, next floor), which
    // is exactly what `FRIEL_7_ZONE_EDGES` encodes and what the table reuses.
    // So the engine's floor must equal the doc's floor, and the engine's
    // exclusive ceiling must be the doc's stated ceiling plus one point.
    const cases: Array<[keyof typeof FRIEL_PCT_LTHR_BY_INTENSITY, string]> = [
      ['easy', '2 Aerobic'],
      ['marathon', '3 Tempo'],
      ['threshold', '4 SubThreshold'],
      ['interval', '5b Aerobic capacity'],
    ];
    for (const [intensity, row] of cases) {
      const [lo, hi] = frielRow(row);
      const band = FRIEL_PCT_LTHR_BY_INTENSITY[intensity];
      expect(band, `${intensity} has no band`).not.toBeNull();
      expect(band![0]).toBeCloseTo(lo, 5);
      expect(band![1]).toBeCloseTo(hi + 0.01, 5);
    }
  });

  it('repetition REFUSES rather than inventing an HR (Rule 11)', () => {
    // §8's own note. Read it out of the doc so the refusal stays tied to the
    // sentence that justifies it.
    expect(doc).toMatch(/\*\*R\*\* workouts: HR unreliable/);
    expect(FRIEL_PCT_LTHR_BY_INTENSITY.repetition).toBeNull();
    expect(DANIELS_PCT_HRMAX_TARGET.repetition).toBeNull();
    expect(prescribedHrTargetBpm({ intensity: 'repetition', lthr: 168, maxHr: 180 })).toBeNull();
  });

  it("every %HRmax band is the doc's own row, and every target sits inside it", () => {
    const rows: Array<[keyof typeof DANIELS_PCT_HRMAX_BY_INTENSITY, string]> = [
      ['easy', 'E \\(Easy\\)'],
      ['marathon', 'M \\(Marathon\\)'],
      ['threshold', 'T \\(Threshold\\)'],
      ['interval', 'I \\(Interval / VO2max\\)'],
    ];
    for (const [intensity, pattern] of rows) {
      const [lo, hi] = danielsRow(pattern);
      const band = DANIELS_PCT_HRMAX_BY_INTENSITY[intensity];
      expect(band, `${intensity} band missing`).not.toBeNull();
      expect(band![0]).toBeCloseTo(lo, 5);
      expect(band![1]).toBeCloseTo(hi, 5);
      const target = DANIELS_PCT_HRMAX_TARGET[intensity];
      if (target != null) {
        expect(target, `${intensity} target ${target} is outside the doc row ${lo}-${hi}`)
          .toBeGreaterThanOrEqual(lo);
        expect(target).toBeLessThanOrEqual(hi);
      }
    }
  });

  it('REGRESSION · a threshold pace no longer carries a tempo heart rate', () => {
    // The reference runner, LTHR 168, plan pln_9a57561debb776e5 row 2026-09-08.
    // Before: hr_target_bpm 155 = round(168 x 0.92), the middle of Friel Z3,
    // under a 430 s/mi pace that is the canonical Daniels T, judged against a
    // pass line of 164. Three intensity statements on one row.
    const LTHR = 168;
    expect(Math.round(LTHR * 0.92)).toBe(155);          // the old number, proven
    const t = prescribedHrTargetBpm({ intensity: 'threshold', lthr: LTHR });
    expect(t).not.toBeNull();
    expect(t!.bpm).not.toBe(155);
    // ONE quantity, ONE name: the target and the line it is judged against are
    // the same figure by construction - both are the centre of Friel Z4.
    expect(t!.bpm).toBe(thresholdPassHrBpm(LTHR));
    expect(t!.bpm).toBe(164);
    expect(t!.anchor).toBe('lthr');
    // And it is now within 2 bpm of what he demonstrably holds at that pace
    // (162 bpm at 7:02/mi, 2026-09-01), against 7 bpm before.
    expect(Math.abs(t!.bpm - 162)).toBeLessThanOrEqual(2);
  });

  it('LTHR beats %HRmax, and the fallback fires only without one', () => {
    const both = prescribedHrTargetBpm({ intensity: 'interval', lthr: 168, maxHr: 180 });
    expect(both!.anchor).toBe('lthr');
    const fallback = prescribedHrTargetBpm({ intensity: 'interval', lthr: null, maxHr: 180 });
    expect(fallback!.anchor).toBe('maxHr');
    expect(fallback!.bpm).toBe(Math.round(180 * 0.95));  // the doc's I-row floor
    expect(prescribedHrTargetBpm({ intensity: 'interval', lthr: null, maxHr: null })).toBeNull();
  });

  it('the watch interval uplift is the Friel Z5b centre, not a typed 1.05', () => {
    // `build-workout` used to write `Math.round(rawHrTarget * 1.05)`. A
    // fraction of LTHR applied to a VARIABLE, which the allowlist scanner
    // above is structurally unable to see. The value is unchanged and the
    // derivation is now the table's.
    const src = readFileSync(join(ROOT, 'lib', 'watch', 'build-workout.ts'), 'utf8');
    const live = src.split('\n').filter((l) => {
      const t = l.trimStart();
      return !t.startsWith('*') && !t.startsWith('//') && !t.startsWith('/*');
    }).join('\n');
    // NOT `not.toMatch(/rawHrTarget \* 1.05/)`. That was the first version and
    // it was falsified in one line: renaming the variable made the gate green
    // while the derivation stayed on the wrist. The check is now the CLASS —
    // any decimal fraction applied to any HR-shaped identifier in this file.
    //
    // Fractions this file is still ALLOWED to carry are exactly the ones the
    // allowlist above declares for it — today, the easy-ceiling residual.
    // Anything else, under any variable name, is a derivation on the wrist.
    const allowedHere = new Set(
      HR_DERIVATION_ALLOWLIST
        .filter((a) => a.file === 'lib/watch/build-workout.ts')
        .map((a) => Number(a.fraction)),
    );
    const offenders = live.split('\n')
      .map((l, i) => ({ l, n: i + 1 }))
      .filter(({ l }) => {
        const m = l.match(/\b[A-Za-z_$][\w$]*(?:[Hh][Rr]|[Bb]pm)[\w$]*\s*\*\s*(\d*\.\d+)/);
        return m != null && !allowedHere.has(Number(m[1]));
      })
      .map(({ l, n }) => `${n}: ${l.trim()}`);
    expect(offenders).toEqual([]);
    const band = FRIEL_PCT_LTHR_BY_INTENSITY.interval!;
    expect((band[0] + band[1]) / 2).toBeCloseTo(1.05, 5);
    expect(prescribedHrTargetBpm({ intensity: 'interval', lthr: 164 })!.bpm)
      .toBe(Math.round(164 * 1.05));
  });
});
