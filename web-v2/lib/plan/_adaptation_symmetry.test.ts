/**
 * lib/plan/_adaptation_symmetry.test.ts · THRESHOLD-OWNER-1 ·
 * THE BAR TO GO UP MAY NOT BE HIGHER THAN THE BAR TO COME DOWN.
 *
 * CLAUDE.md Rule 21, in its own words: "When you write or touch an adaptation
 * trigger, put its threshold beside its opposite number's and justify any
 * asymmetry with a citation. Five downgrades against zero upgrades is not a
 * runner's record, it is an engine's disposition."
 *
 * ── WHAT WAS MEASURED, 2026-09-05 ──────────────────────────────────────────
 *
 * The two training-evidence arms of `detectAdaptations`, condition by
 * condition:
 *
 *     UP · detectTrainingLead            DOWN · fitness_regression (training)
 *     ────────────────────────────────   ────────────────────────────────────
 *     delta >= +1.0                      delta <  -1.5        doctrine-cited
 *     >= 2 qualifying sessions           (nothing)            HABIT
 *     span >= 14 days                    (nothing)            HABIT
 *     newest <= 28 days old              (nothing)            HABIT
 *     the winning candidate is a RUN     (nothing)            HABIT
 *     race-week suppression, fail-closed race-week, fail-closed  equal
 *     non-provisional anchor             non-provisional anchor equal
 *     runs only if pr_bank AND           runs only if pr_bank   stricter UP
 *       fitness_regression both silent     is silent
 *
 * The only downward condition beyond the delta was
 * `COUNT(DISTINCT snapshot_date) >= 8` over 28 days of `projection_snapshots`
 * — rows the cron writes every morning whether the runner ran or not. Eight of
 * them means the cron ran eight times, not that anything was corroborated.
 *
 * And the corroboration constants themselves were named `TRAINING_LEAD_*`
 * while `ADAPTATION.training-lead-quantum` reads their value out of doctrine's
 * DOWNWARD row ("Tempo runs unexpectedly hard for >=2 sessions"). The engine
 * took doctrine's bar for coming down and spent it going up.
 *
 * ── WHAT DOCTRINE LICENSES, AND WHAT ONLY HABIT DID ────────────────────────
 *
 * `Research/01-pace-zones-vdot.md` §"Triggers to retest" is asymmetric on
 * PURPOSE in exactly one column: "+1 VDOT" up against "-1 to -2 VDOT" down.
 * That difference stays, and this file asserts it stays. Every other
 * difference was habit, and the corroboration half is now the same both ways —
 * read from the same doctrine row, through the same direction-free helper.
 *
 * ── RULE 22 · WHAT THIS GATE CANNOT FAIL ON ────────────────────────────────
 *
 *   · IT COMPARES CONDITIONS, NOT OUTCOMES. Both arms could be correct here
 *     and still never fire for a real runner — which is precisely the state
 *     Rule 21 was written about (309 production intents, zero upgrades). Only
 *     a replay over real history can answer that, and this is not one.
 *   · IT IS A SOURCE SCAN FOR THE STRUCTURAL HALF. It asserts each detector
 *     CALLS the shared corroboration helper; it cannot tell whether the
 *     candidate set each one hands it is fairly built. A downward arm that
 *     called the helper with a deliberately generous filter would pass.
 *   · IT SAYS NOTHING ABOUT THE OTHER TWO AXES. Volume (`adaptive-ramp.ts`)
 *     and quality density (`progression-pass.ts`) have their own opposing
 *     verdicts and their own possible imbalance. Unmeasured here.
 *   · IT CANNOT SEE APPLY-VERSUS-PROPOSE. The upward arm auto-applies and the
 *     downward arm proposes, which is an asymmetry in the UPWARD path's
 *     favour and is argued in `detectTrainingLead`'s header. Recorded in the
 *     table above so it is not forgotten, not enforced here.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  TRAINING_LEAD_DELTA_THRESHOLD,
  REGRESSION_DELTA_THRESHOLD,
  TRAINING_TREND_MIN_SESSIONS,
  TRAINING_TREND_MIN_SPAN_DAYS,
  TRAINING_TREND_MAX_AGE_DAYS,
  sustainedTrainingTrend,
  trainingLeadFires,
  fitnessRegressionFires,
} from './adapt';

const ROOT = path.resolve(__dirname, '..', '..', '..');
const ADAPT = path.resolve(__dirname, 'adapt.ts');
const DOC = path.join(ROOT, 'Research', '01-pace-zones-vdot.md');

/** The body of one top-level `async function NAME(` … up to the next
 *  column-0 `}`. Enough to tell which detector a call sits inside. */
function bodyOf(src: string, name: string): string {
  const open = src.indexOf(`async function ${name}(`);
  if (open < 0) throw new Error(`${name} is gone from adapt.ts`);
  const end = src.indexOf('\n}\n', open);
  if (end < 0) throw new Error(`${name} has no closing brace`);
  return src.slice(open, end);
}

describe('adaptation symmetry · Rule 21', () => {
  const src = fs.readFileSync(ADAPT, 'utf8');

  it('0 · LIVENESS · the scan reads the real detectors', () => {
    // Rule 18 point 2. A scan that matched nothing would report clean.
    expect(src.length).toBeGreaterThan(50_000);
    expect(bodyOf(src, 'detectTrainingLead').length).toBeGreaterThan(500);
    expect(bodyOf(src, 'detectFitnessRegression').length).toBeGreaterThan(500);
    expect(fs.existsSync(DOC)).toBe(true);
  });

  it('1 · the corroboration bar is IDENTICAL in both directions', () => {
    // The structural claim: both arms reach the same helper, so the count, the
    // span and the freshness cannot drift apart without one of them failing.
    const up = bodyOf(src, 'detectTrainingLead');
    const down = bodyOf(src, 'detectFitnessRegression');
    expect(up, 'the upward arm no longer corroborates').toContain('sustainedTrainingTrend(');
    expect(down, 'the downward training arm corroborates nothing · Rule 21').toContain('sustainedTrainingTrend(');
    // And neither may carry a private count of its own.
    for (const [name, body] of [['up', up], ['down', down]] as const) {
      expect(
        /(sessions|qualifying)[^\n]*(>=|>)\s*\d/.test(body.replace(/sustainedTrainingTrend\([^)]*\)/g, '')),
        `${name} arm re-implements a session count instead of using the shared bar`,
      ).toBe(false);
    }
  });

  it('2 · the ONLY licensed asymmetry is the delta, and doctrine states it', () => {
    // Read both magnitudes out of the cited table at run time rather than
    // hardcoding both sides — a check that hardcodes both only proves it
    // agrees with itself (Rule 18).
    const text = fs.readFileSync(DOC, 'utf8');
    const upRow = /\|\s*Tempo runs feel notably easier[^|]*\|\s*([^|\n]+?)\s*\|/i.exec(text);
    const downRow = /\|\s*Tempo runs unexpectedly hard[^|]*\|\s*([^|\n]+?)\s*\|/i.exec(text);
    expect(upRow, 'Research/01 lost its upward training row').not.toBeNull();
    expect(downRow, 'Research/01 lost its downward training row').not.toBeNull();

    const up = Number(/Add\s+(\d+(?:\.\d+)?)\s+VDOT/i.exec(upRow![1])![1]);
    const downMin = Number(
      /[-–—]?\s*(\d+(?:\.\d+)?)\s*(?:to|[-–—])\s*[-–—]?\s*(\d+(?:\.\d+)?)\s*VDOT/i.exec(downRow![1])![1],
    );
    // Doctrine is heavier downward. The engine must not flatten it, and must
    // not invert it either.
    expect(up).toBeLessThanOrEqual(downMin);
    expect(TRAINING_LEAD_DELTA_THRESHOLD).toBe(up);
    expect(TRAINING_LEAD_DELTA_THRESHOLD).toBeLessThanOrEqual(REGRESSION_DELTA_THRESHOLD);

    // The corroboration count is the DOWNWARD row's own sentence, which is why
    // spending it on the upward path alone was the defect.
    const sessions = /unexpectedly hard for\s*(?:≥|>=)\s*(\d+)\s*sessions/i.exec(text);
    expect(sessions, 'Research/01 lost the session count this bar is read from').not.toBeNull();
    expect(TRAINING_TREND_MIN_SESSIONS).toBe(Number(sessions![1]));
    const weeks = /sustained\s*(?:≥|>=)\s*(\d+)\s*weeks/i.exec(text);
    expect(TRAINING_TREND_MIN_SPAN_DAYS).toBe(Number(weeks![1]) * 7);
  });

  it('3 · the helper is direction-free · the same dates decide both ways', () => {
    // The behavioural half of test 1: one function, no direction argument, so
    // an asymmetry cannot be smuggled into the corroboration itself.
    const dates = ['2026-08-10', '2026-08-26'];
    const r = sustainedTrainingTrend(dates, '2026-09-05');
    expect(r.sustained).toBe(true);
    expect(r.sessions).toBe(2);
    expect(r.spanDays).toBe(16);
    // One session is never a trend, whichever way it points.
    expect(sustainedTrainingTrend(['2026-09-01'], '2026-09-05').sustained).toBe(false);
    // Two sessions inside one week is a good week, not a trend.
    expect(sustainedTrainingTrend(['2026-09-01', '2026-09-04'], '2026-09-05').sustained).toBe(false);
    // Stale evidence describes a runner from a month ago.
    expect(sustainedTrainingTrend(['2026-06-01', '2026-07-01'], '2026-09-05').sustained).toBe(false);
    expect(TRAINING_TREND_MAX_AGE_DAYS).toBe(28);
  });

  it('4 · the firing predicates are exact mirrors around their own thresholds', () => {
    const anchor = 46.6;                                  // the owner's live anchor
    expect(trainingLeadFires(anchor, anchor + 1.0)).toBe(true);
    expect(trainingLeadFires(anchor, anchor + 0.9)).toBe(false);
    expect(fitnessRegressionFires(anchor, anchor - 1.6)).toBe(true);
    expect(fitnessRegressionFires(anchor, anchor - 1.5)).toBe(false);
    // Neither predicate fires in the other's direction — a single reading must
    // not be able to satisfy both, which is what would let one evidence set
    // produce two contradictory proposals.
    expect(trainingLeadFires(anchor, anchor - 3)).toBe(false);
    expect(fitnessRegressionFires(anchor, anchor + 3)).toBe(false);
  });

  it('5 · the downward arm no longer rests on a cron-liveness count alone', () => {
    // `nDays >= 8` counts mornings the projection cron ran, not sessions the
    // runner completed. It may STAY as a data-presence precondition; it may
    // not be the only thing standing between the runner and a downgrade.
    // Assert the shape of the result, not the absence of the defect (Rule 13).
    const down = bodyOf(src, 'detectFitnessRegression');
    const snapshotGate = /nDays\s*>=\s*8/.test(down);
    expect(snapshotGate, 'the snapshot-day precondition is gone · that is fine only if something replaced it').toBe(true);
    const idx = down.indexOf('nDays >= 8');
    // The corroboration must sit AFTER the snapshot gate, inside the same
    // branch — not somewhere else in the function that the branch skips.
    expect(down.indexOf('sustainedTrainingTrend(')).toBeGreaterThan(idx);
    // And the trigger it emits must carry what corroborated it, or the log
    // cannot tell an engine that never pushes from a runner who never earned
    // it (Rule 21's "make it observable").
    expect(down).toContain('span_days: span.spanDays');
    expect(down).toContain("citation: 'Research/01-pace-zones-vdot.md");
  });
});
