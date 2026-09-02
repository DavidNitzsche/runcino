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
    reason: 'easy/long HR cap, the %HRmax half of max(89% LTHR, 78% HRmax). '
      + 'Belongs in zones.ts beside aerobicCeilingBpm, which owns the LTHR half.',
  },
  {
    file: 'lib/plan/spec-builder.ts', fraction: '0.92', anchor: 'lthr',
    reason: 'THE FINDING. Authors workout_spec.hr_target_bpm for a tempo row '
      + 'whose pace is the canonical Daniels T. 92% of LTHR is the top of '
      + 'Friel Z3; the pace is Z4. No doctrine citation at the site.',
  },
  {
    file: 'lib/watch/build-workout.ts', fraction: '0.78', anchor: 'maxHr',
    reason: 'the watch re-derives the easy ceiling when the plan row carries '
      + 'no hr_cap_bpm. Second copy of the spec-builder line above.',
  },
  {
    file: 'lib/watch/build-workout.ts', fraction: '0.95', anchor: 'maxHr',
    reason: 'interval HR target when the runner has no LTHR. Research/03 §8 '
      + 'is cited in the comment; the derivation still lives on the wrist path '
      + 'rather than in the zone owner.',
  },
  {
    file: 'lib/watch/build-workout.ts', fraction: '0.87', anchor: 'maxHr',
    reason: 'threshold HR target when the runner has no LTHR. Same as above.',
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

describe('HR intensity has no single owner (brain scorecard, 2026-09-02)', () => {
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
    // Seven sites. Five are prescriptive (spec-builder x2, build-workout x3);
    // two answer a different question and are argued as such above. Lower this
    // number when a site moves into zones.ts; it may never be raised.
    expect(found.length).toBe(7);
  });
});
