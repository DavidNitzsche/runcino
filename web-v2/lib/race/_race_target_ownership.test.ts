/**
 * lib/race/_race_target_ownership.test.ts · B2, 2026-09-02.
 *
 * ONE OWNER FOR "WHAT SHOULD THIS RUNNER RUN THIS RACE AT".
 *
 * ── THE FINDING THIS CLOSES ────────────────────────────────────────────────
 *
 * The owner's live plan `pln_9a57561debb776e5` held TWO records of the
 * prescribed CIM target, 180 seconds apart, and which one reached him depended
 * on whether a job had run:
 *
 *   training_plans.authored_state.prescribed_race_pace
 *     → {"pace_s_per_mi": 436, "target_sec": 11430, "ceiling_vdot": 47.1}
 *       written by `achievableRaceTarget` at authoring (2026-08-31), and
 *       `ceiling_vdot` already stale against a live threshold VDOT of 47.8.
 *
 *   plan_workouts 2026-12-06 (type 'race')
 *     → pace_target_s_per_mi 443, race_execution.target_sec 11610
 *       written by `refreshRaceRowsForPlan` from `race-outlook.execution`.
 *
 * `generate.ts` read the FIRST back as the seed for the next authoring, so a
 * rebuild resolved the row against a number the brain had already replaced
 * (Rule 16 sitting on a Rule 23 ordering dependency).
 *
 * And a THIRD reader survived both: the row's pace-adrift abort. Verified in
 * production on 2026-09-02, on the same row as the 443 above:
 *
 *   rules: [ {abort, hr,   > 163},
 *            {abort, pace, > 458, "Mile 10 check: pace slower than 7:38/mi"} ]
 *
 * 458 is `round(1.05 × 436)` — the abort was anchored to the authoring seed
 * while the target beside it had moved to 443 (correct abort: 465). The runner
 * read a target and a bail-out priced off two different numbers on one row.
 *
 * ── WHAT ANSWERS THE QUESTION NOW ──────────────────────────────────────────
 *
 *   `lib/race/race-outlook.ts#resolveRaceOutlook().execution` — the only owner.
 *   `refreshRaceRowsForPlan` writes the row (pace, band, race_execution,
 *   race_hr AND the pace abort). `resolveAuthoringRaceSeed` gives authoring the
 *   SAME owner's answer, so the seed and the refresh cannot disagree.
 *   `authored_state.prescribed_race_pace` is PROVENANCE — stamped
 *   `authority: 'provenance_only'` with the anchor it was struck against
 *   (Rule 10) — and no live module reads its `pace_s_per_mi` as a value.
 *
 * ── RULE 22 · WHAT THIS TEST CANNOT FAIL ON ────────────────────────────────
 *
 *   · It cannot see a read of `prescribed_race_pace` assembled dynamically —
 *     a bracket index off a variable, a SQL `->>` built by concatenation, or a
 *     column selected as `*` and destructured downstream. It matches the
 *     literal key text only.
 *   · It cannot tell whether `race-outlook`'s answer is CORRECT. It pins where
 *     the answer comes from, never what it is. A wrong execution target passes
 *     every assertion here.
 *   · It cannot see the wrist. `native-v2` renders whatever the row carries and
 *     nothing in this file reads Swift.
 *   · It cannot prove the refresh RAN. Rule 23 is not closed by this file;
 *     what is closed is that the two paths, when they run, produce one number.
 *   · The rule-repricing assertions are unit-level. They prove the derivation
 *     agrees across the two writers; they do not prove any production row has
 *     been rewritten yet (the next authoring or recompute does that).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import { racePaceAbortRule, RACE_PACE_ABORT_FRACTION, raceCheckpointMi } from './distance-doctrine';
import { rulesRepricedTo, raceExecutionSpecFields } from './race-row-refresh';
import type { RaceOutlook } from './race-outlook';

const ROOT = join(__dirname, '..', '..');

/**
 * Modules allowed to mention `prescribed_race_pace` at all. RATCHET — shrink
 * only; an entry whose file no longer mentions the key fails until deleted.
 */
const PROVENANCE_READERS: ReadonlyArray<{ file: string; reason: string }> = [
  {
    file: 'lib/plan/generate.ts',
    reason: 'WRITES the provenance blob, and reads `goal_sec` out of it for '
      + '`deriveBlockStrategy` (the runner\'s STATED goal, carried verbatim). '
      + 'It no longer reads `pace_s_per_mi` — asserted separately below.',
  },
  {
    file: 'lib/plan/authoring-shadow-compare.ts',
    reason: 'the legacy-vs-canonical authoring comparison harness. It reads the '
      + 'legacy number ON PURPOSE, to report the delta against the canonical '
      + 'one. Reporting a second number is the opposite of prescribing it.',
  },
];

/** Files the scanner reads. Tests and scripts are excluded. */
function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    // `name.startsWith('.')` also drops the exFAT `._foo.ts` AppleDouble
    // sidecars this repo's working volume carries, so a local file count
    // matches a clean CI checkout (they would otherwise roughly double it).
    if (name === 'node_modules' || name === '.next' || name.startsWith('.')) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) sourceFiles(p, out);
    else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}

function outlookWith(paceSecPerMi: number | null, distanceMi = 26.2): RaceOutlook {
  return {
    modelVersion: '1.0.0',
    resolvedAt: '2026-09-02T00:00:00.000Z',
    execution: {
      paceSecPerMi,
      targetSec: paceSecPerMi != null ? Math.round(paceSecPerMi * distanceMi) : null,
      source: 'stated_goal_clamped_to_range_edge',
      reasonVsExpected: null,
      hr: null,
    },
    race: { distanceMi },
    statedGoal: { sec: null },
    capacity: { thresholdSecPerMi: 430, thresholdVdot: 47.8, durabilityExponent: 1.0825 },
    currentProjection: { expectedSec: null },
    expectedRaceDay: { expectedSec: null, likelyRangeSec: null },
    expectedImprovement: { gainVdot: 0 },
    trainingPrescription: { paceSecPerMi: 472 },
    goalFeasibility: { status: 'unlikely_currently' },
    staleness: { evidenceAgeDays: 0, stale: false },
  } as unknown as RaceOutlook;
}

describe('B2 · the prescribed race target has one owner', () => {
  const files = [
    ...sourceFiles(join(ROOT, 'lib')),
    ...sourceFiles(join(ROOT, 'app')),
  ];

  it('LIVENESS · the scanner actually read source (Rule 18 §2)', () => {
    // Floor set from the AppleDouble-excluded count, which is what CI sees.
    expect(files.length).toBeGreaterThan(400);
  });

  /** CODE mentions, not prose. A file that only names the key in a comment —
   *  explaining what was deleted and why — is documentation, not a reader. */
  const mentions = files
    .map((f) => ({ rel: f.slice(ROOT.length + 1), src: readFileSync(f, 'utf8') }))
    .filter((f) => f.src.split('\n').some((line) => {
      const t = line.trimStart();
      if (t.startsWith('*') || t.startsWith('//') || t.startsWith('/*')) return false;
      return line.includes('prescribed_race_pace');
    }));

  it('only the declared provenance readers mention prescribed_race_pace', () => {
    const unlisted = mentions
      .map((m) => m.rel)
      .filter((rel) => !PROVENANCE_READERS.some((p) => p.file === rel));
    expect(unlisted).toEqual([]);
  });

  it('RATCHET · every declared provenance reader is still live (Rule 18 §4)', () => {
    const stale = PROVENANCE_READERS
      .map((p) => p.file)
      .filter((file) => !mentions.some((m) => m.rel === file));
    expect(stale).toEqual([]);
  });

  it('no live module reads prescribed_race_pace.pace_s_per_mi as a value', () => {
    // The shadow-compare harness is the one exception, and it is a REPORTER:
    // it exists to state the delta between the legacy number and the canonical
    // one. Everything else reading this key back would be a second owner.
    const REPORTERS = new Set(['lib/plan/authoring-shadow-compare.ts']);
    const offenders: string[] = [];
    for (const m of mentions) {
      if (REPORTERS.has(m.rel)) continue;
      m.src.split('\n').forEach((line, i) => {
        if (line.trimStart().startsWith('*') || line.trimStart().startsWith('//')) return;
        if (/prescribed_race_pace[\s\S]{0,120}?pace_s_per_mi/.test(line)) {
          offenders.push(`${m.rel}:${i + 1}`);
        }
      });
      // The multi-line shape `?.prescribed_race_pace as { pace_s_per_mi?: … }`
      // is what generate.ts used to carry; catch it across a line break too.
      const flat = m.src.replace(/\n/g, ' ');
      if (/prescribed_race_pace\s+as\s*\{[^}]*pace_s_per_mi/.test(flat)) {
        offenders.push(`${m.rel}:<multi-line cast to { pace_s_per_mi }>`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('the pace-adrift abort has ONE derivation, in the race owner', () => {
    // Anything constructing `{ kind: 'abort', metric: 'pace' }` by hand is a
    // second derivation of the same rule. `racePaceAbortRule` is the only one.
    const offenders: string[] = [];
    for (const f of files) {
      const rel = f.slice(ROOT.length + 1);
      if (rel === join('lib', 'race', 'distance-doctrine.ts')) continue;
      const flat = readFileSync(f, 'utf8').replace(/\n/g, ' ');
      if (/kind:\s*'abort'[^}]{0,160}metric:\s*'pace'/.test(flat)
        || /metric:\s*'pace'[^}]{0,160}kind:\s*'abort'/.test(flat)) {
        offenders.push(rel);
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe('B2 · the abort is repriced with the target, on the production shape', () => {
  it('reprices the owner\'s CIM row from the stale seed to the canonical target', () => {
    // The exact row, verified in production 2026-09-02.
    const productionRules = [
      { kind: 'abort', metric: 'hr', op: '>', value: 163, scope: 'mile-10',
        action: 'switch_to_b_goal', label: 'Mile 10 check: avgHr over 163 · switch to the B plan' },
      { kind: 'abort', metric: 'pace', op: '>', value: 458, scope: 'mile-10',
        action: 'switch_to_b_goal', label: 'Mile 10 check: pace slower than 7:38/mi · switch to the B plan' },
    ];
    // 458 is what the stale authoring seed produced. Prove that first, so the
    // number in the header is read out of the code rather than asserted at it.
    expect(Math.round(436 * (1 + RACE_PACE_ABORT_FRACTION))).toBe(458);

    const out = rulesRepricedTo(productionRules, outlookWith(443), 26.2);
    const pace = out.find((r) => r.metric === 'pace');
    expect(pace?.value).toBe(465);            // round(443 × 1.05)
    expect(pace?.scope).toBe(`mile-${raceCheckpointMi(26.2)}`);
    expect(pace?.label).toBe('Mile 10 check: pace slower than 7:45/mi · switch to the B plan');
    // Rule 6 in the array's own terms: the HR abort this path does not own
    // survives untouched, and exactly one pace abort remains.
    expect(out.filter((r) => r.metric === 'pace')).toHaveLength(1);
    expect(out.find((r) => r.metric === 'hr')).toEqual(productionRules[0]);
  });

  it('the refresh WIRES the repricing — not just exports it', () => {
    // A unit test on `rulesRepricedTo` alone cannot see the write path drop
    // the call, which is exactly how the rule went stale in the first place.
    // This asserts the field builder the UPDATE statement uses emits it.
    const productionRules = [
      { kind: 'abort', metric: 'hr', op: '>', value: 163, scope: 'mile-10', action: 'switch_to_b_goal', label: 'hr' },
      { kind: 'abort', metric: 'pace', op: '>', value: 458, scope: 'mile-10', action: 'switch_to_b_goal', label: 'stale' },
    ];
    const fields = raceExecutionSpecFields(outlookWith(443), null, {
      rules: productionRules, distanceMi: 26.2,
    });
    expect(Array.isArray(fields.rules)).toBe(true);
    const pace = (fields.rules as Array<Record<string, unknown>>).find((r) => r.metric === 'pace');
    expect(pace?.value).toBe(465);
    expect(fields.pace_target_s_per_mi_lo).toBe(438);
    expect(fields.pace_target_s_per_mi_hi).toBe(448);
  });

  it('the two writers derive the same rule from the same target', () => {
    // `spec-builder` (authoring) and `race-row-refresh` (every later write)
    // must not be able to disagree. They call one function; this asserts they
    // still produce the identical object for the same input.
    const direct = racePaceAbortRule({ distanceMi: 13.1, targetPaceSecPerMi: 422 });
    const viaRefresh = rulesRepricedTo([], outlookWith(422, 13.1), 13.1);
    expect(viaRefresh).toEqual([{ ...direct! }]);
  });

  it('RULE 11 · an unavailable target DROPS the abort rather than inventing one', () => {
    const productionRules = [
      { kind: 'abort', metric: 'pace', op: '>', value: 458, scope: 'mile-10', action: 'switch_to_b_goal', label: 'stale' },
    ];
    // The stale rule is DROPPED, not carried: an empty list, never the old one.
    expect(rulesRepricedTo(productionRules, outlookWith(null), 26.2)).toEqual([]);
    expect(racePaceAbortRule({ distanceMi: 26.2, targetPaceSecPerMi: null })).toBeNull();
    expect(racePaceAbortRule({ distanceMi: 26.2, targetPaceSecPerMi: 0 })).toBeNull();
    // And a race whose distance is unknown gets NO checkpoint rather than an
    // invented "Mile 5" one — a 5K would never have reached that mile.
    expect(racePaceAbortRule({ distanceMi: null, targetPaceSecPerMi: 443 })).toBeNull();
    expect(racePaceAbortRule({ distanceMi: 0, targetPaceSecPerMi: 443 })).toBeNull();
  });
});
