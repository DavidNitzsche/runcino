/**
 * _race_row_coherence_gate.test.ts · ROW-CONTRACT-1.
 *
 * THE INVARIANT, in the owner's words: *"Pace, HR, effort, notes, and workout
 * structure agree."* And the rule underneath it: *"A refresh must update the
 * complete workout contract atomically, not one number inside an incompatible
 * structure."*
 *
 * This gate is for the CLASS. Four instances were measured on his live plan on
 * 2026-09-02 and every one of them was the same shape — `race-row-refresh`
 * moved `pace_target_s_per_mi` and left the prose, the reps or the abort rule
 * describing the pace it replaced. Fixing four rows would have left the fifth
 * to be found by the runner.
 *
 * ── WHY NOTHING HERE IS A NUMBER ─────────────────────────────────────────
 *
 * Not one assertion pins a pace. `priority` is about to become load-bearing in
 * a separate change — a C race will stop being priced like an A race — and at
 * least one of these four targets will move. A gate asserting "CIM is 443"
 * would fail that day and teach everyone to edit the gate. A gate asserting
 * "the prose names the number the row carries" cannot fail for that reason and
 * will still be true afterwards.
 *
 * Determinism, which is now a standing requirement: every assertion below is a
 * function of the row and the outlook handed in. Nothing reads a clock.
 *
 * ── WHAT THIS GATE CANNOT FAIL ON (Rule 22) ──────────────────────────────
 *
 *   · A pace that is WRONG. It has no answer key. A row priced coherently at
 *     nonsense passes every check here; whether 7:23/mi is the right marathon
 *     target belongs to the race-pace brain and its own contract test.
 *   · A field it does not know about. `raceRowContractViolations` checks the
 *     keys that have been observed restating a pace. A new spec key that
 *     restates one needs a check adding to that file, and this gate will not
 *     notice its absence.
 *   · Prose that states a pace in WORDS. "Run it at threshold" is invisible to
 *     a digit matcher.
 *   · Whether the refresh RUNS. `_race_row_refresh_gate.test.ts` owns the
 *     wiring; this one owns what the wiring leaves behind.
 *
 * ── FALSIFIED 2026-09-02, all five, before the gate was trusted ──────────
 *
 *   1. Removing `notes` from the write in `raceRowWrite` → test 2 fails with
 *      PROSE_NAMES_ANOTHER_PACE.
 *   2. Restoring the old behaviour of repricing every tune-up to the race
 *      target → test 4 fails with HEADLINE_DISAGREES_WITH_REPS.
 *   3. Dropping the `race_execution`/`race_hr` removal for a tune-up → test 4
 *      fails with RACE_ONLY_FIELD_ON_A_NON_RACE_ROW.
 *   4. Repricing the target without repricing the abort rule → test 3 fails
 *      with ABORT_PRICED_OFF_ANOTHER_TARGET.
 *   5. Reverting `NOTE.race` to the "first 5K … mile 12" string → test 7 fails.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  raceRowContractViolations,
  describeViolations,
  type RaceRowContractView,
} from './race-row-contract';
import { raceRowWrite, applyWriteToRow, contractRowOf, raceExecutionSpecFields } from './race-row-refresh';
import { composeRaceOutlook, type RaceOutlook } from './race-outlook';
import { fixtureReads, fixtureRace } from './_race_outlook_fixture';
import { raceTargetSentence, repriceRaceNote, paceTokensSecPerMi } from './race-row-note';
import { buildWorkoutSpec, tuneupPaceAnchor } from '@/lib/plan/spec-builder';

const ROOT = path.resolve(__dirname, '..', '..');
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

/** One outlook, resolved once, for every case below. Pure fixture, no clock. */
async function outlook(goalSec: number | null = null): Promise<RaceOutlook> {
  return composeRaceOutlook({ ...fixtureRace(), statedGoalSec: goalSec }, '2026-09-01', fixtureReads());
}

/** The row a race day is AUTHORED as, through the writer's own builder — not a
 *  hand-written literal, so a change to authoring reaches this gate. */
function authoredRaceRow(o: RaceOutlook, notes: string, atPaceSecPerMi?: number): RaceRowContractView {
  // The whole row is authored at ONE pace, exactly as `persistPlan` authors it,
  // so a stale row in these cases is stale COHERENTLY — which is the honest
  // starting state: the defect was never a row that disagreed with itself at
  // authoring, it was a refresh that moved one field of a coherent row.
  const pace = atPaceSecPerMi ?? o.execution.paceSecPerMi!;
  const built = buildWorkoutSpec(
    'race', o.race.distanceMi, o.capacity.thresholdSecPerMi, 168, 'RACE', 183,
    o.statedGoal.paceSecPerMi, null, null, false, pace, null,
  );
  return {
    type: 'race',
    distanceMi: o.race.distanceMi,
    paceTargetSecPerMi: built.paceTargetSPerMi,
    spec: (built.spec ?? {}) as Record<string, unknown>,
    notes,
    subLabel: 'RACE',
  };
}

describe('ROW-CONTRACT-1 · a refreshed race row agrees with itself', () => {
  it('1 · LIVENESS · the checker actually looks at something, and can see a defect', async () => {
    const o = await outlook();
    const pace = o.execution.paceSecPerMi!;
    expect(pace).toBeGreaterThan(0);
    // A deliberately incoherent row must produce findings. A checker that
    // reports clean on THIS has stopped working, and reporting clean is the
    // worst outcome available because it also reports confidence (Rule 18).
    const broken: RaceRowContractView = {
      type: 'race',
      distanceMi: o.race.distanceMi,
      paceTargetSecPerMi: pace,
      spec: { pace_target_s_per_mi_lo: pace - 99, pace_target_s_per_mi_hi: pace + 99 },
      notes: `Target ${Math.floor((pace + 60) / 60)}:${String((pace + 60) % 60).padStart(2, '0')}/mi.`,
      subLabel: 'RACE',
    };
    const v = raceRowContractViolations(broken);
    expect(v.map((x) => x.code)).toContain('PROSE_NAMES_ANOTHER_PACE');
    expect(v.map((x) => x.code)).toContain('BAND_NOT_CENTRED_ON_TARGET');
    expect(describeViolations(v)).toMatch(/prescribes/);
  });

  it('2 · THE PROSE NAMES THE NUMBER THE ROW CARRIES, after the refresh moves it', async () => {
    const o = await outlook();
    const pace = o.execution.paceSecPerMi!;
    // Authored at a DIFFERENT pace, exactly as the owner's rows were: the note
    // states the goal pace and the refresh then moves the column.
    const stale = raceTargetSentence(pace + 28, 'coach')!;
    const row = authoredRaceRow(o, `Santa Monica 10k. B race · race effort. ${stale}`, pace + 28);
    expect(row.paceTargetSecPerMi).toBe(pace + 28);
    // Before: the row is coherent at the OLD pace.
    expect(raceRowContractViolations(row)).toEqual([]);
    const w = raceRowWrite({ row, outlook: o });
    expect('refused' in w).toBe(false);
    const after = applyWriteToRow(row, w as never);
    // After: the column moved AND the sentence moved with it.
    expect(after.paceTargetSecPerMi).toBe(pace);
    expect(paceTokensSecPerMi(after.notes)).toEqual([pace]);
    expect(after.notes).toContain('B race · race effort');
    expect(raceRowContractViolations(after)).toEqual([]);
  });

  it('3 · THE ABORT RULE IS REPRICED WITH THE TARGET, never left on the old anchor', async () => {
    const o = await outlook();
    const pace = o.execution.paceSecPerMi!;
    const row = authoredRaceRow(o, 'Execute the plan.', pace + 22);
    const w = raceRowWrite({ row, outlook: o });
    const after = applyWriteToRow(row, w as never);
    const rules = (after.spec?.rules ?? []) as Array<Record<string, unknown>>;
    const paceAbort = rules.find((r) => r.kind === 'abort' && r.metric === 'pace');
    expect(paceAbort, 'a race row carries a mid-race pace abort').toBeTruthy();
    // Not asserted as a literal: re-derived from the row's own target, which is
    // what makes this survive the C-race repricing change.
    expect(raceRowContractViolations(after)).toEqual([]);
    expect(paceTokensSecPerMi(String(paceAbort!.label))).toEqual([Number(paceAbort!.value)]);
  });

  it('4 · A TUNE-UP IS NOT GIVEN A RACE\'S CLOTHES, and keeps its own reps', async () => {
    const o = await outlook();
    const pace = o.execution.paceSecPerMi!;
    // The marathon race-week sharpener: 5K-pace reps, deliberately FASTER than
    // race pace (TAPER-SHARP-1 · Research/08 §9.3). Built by the real builder.
    const label = '5×400m @ 5K pace · 2min jog';
    const built = buildWorkoutSpec(
      'race_week_tuneup', 4.5, o.capacity.thresholdSecPerMi, 168, label, 183,
      null, o.capacity.thresholdSecPerMi - 29, null, false, null, null,
    );
    expect(tuneupPaceAnchor(label)).toBe('interval');
    const repPace = Number((built.spec as Record<string, unknown>).rep_pace_s_per_mi);
    expect(repPace).toBeGreaterThan(0);
    expect(repPace).not.toBe(pace);

    // The row as the OLD behaviour left it in production: repriced to the race
    // target, wearing the race's execution block, HR band and mid-race abort.
    const wrecked: RaceRowContractView = {
      type: 'race_week_tuneup',
      distanceMi: 4.5,
      paceTargetSecPerMi: pace,
      spec: {
        ...(built.spec as Record<string, unknown>),
        ...raceExecutionSpecFields(o, null, { rules: (built.spec as Record<string, unknown>).rules, distanceMi: 4.5 }),
      },
      notes: 'Five sharp 5K-pace reps, 5 days out. Brief neuromuscular primer. Legs stay fresh.',
      subLabel: label,
    };
    const before = raceRowContractViolations(wrecked).map((x) => x.code);
    expect(before).toContain('HEADLINE_DISAGREES_WITH_REPS');
    expect(before).toContain('RACE_ONLY_FIELD_ON_A_NON_RACE_ROW');

    // The refresh must HEAL it, not refuse it forever: rows in production are
    // already in this state.
    const w = raceRowWrite({ row: wrecked, outlook: o });
    expect('refused' in w).toBe(false);
    const after = applyWriteToRow(wrecked, w as never);
    expect(after.paceTargetSecPerMi).toBe(repPace);
    expect(after.spec?.race_execution).toBeUndefined();
    expect(after.spec?.race_hr).toBeUndefined();
    expect(raceRowContractViolations(after)).toEqual([]);
  });

  it('5 · A TUNE-UP THAT IS AT RACE PACE MOVES BOTH HALVES TOGETHER', async () => {
    const o = await outlook();
    const pace = o.execution.paceSecPerMi!;
    const label = '4×1km @ race pace · 90s jog';
    expect(tuneupPaceAnchor(label)).toBe('race_pace');
    const built = buildWorkoutSpec(
      'race_week_tuneup', 5, o.capacity.thresholdSecPerMi, 168, label, 183,
      pace + 30, null, null, false, null, null,
    );
    const row: RaceRowContractView = {
      type: 'race_week_tuneup', distanceMi: 5,
      paceTargetSecPerMi: built.paceTargetSPerMi,
      spec: built.spec as Record<string, unknown>,
      notes: null, subLabel: label,
    };
    const after = applyWriteToRow(row, raceRowWrite({ row, outlook: o }) as never);
    expect(after.paceTargetSecPerMi).toBe(pace);
    expect(after.spec?.rep_pace_s_per_mi).toBe(pace);
    expect(raceRowContractViolations(after)).toEqual([]);
  });

  it('6 · THE SENTENCE HAS ONE OWNER · authoring and the refresh compose it identically', () => {
    // Rule 16 on the prose. `generate.ts` must not carry its own copy of the
    // string, or the two drift the moment either is edited.
    const gen = read('lib/plan/generate.ts');
    expect(gen).toContain("from '@/lib/race/race-row-note'");
    expect(gen).not.toMatch(/Coach target \$\{/);
    expect(gen).not.toMatch(/` Target \$\{/);
    // Both voices round-trip through strip + reprice with no residue.
    for (const voice of ['coach', 'runner'] as const) {
      const note = `Run Malibu. B race · race effort. ${raceTargetSentence(430, voice)}`;
      const out = repriceRaceNote(note, 412, voice)!;
      expect(paceTokensSecPerMi(out)).toEqual([412]);
      expect(out.startsWith('Run Malibu. B race · race effort.')).toBe(true);
      // Idempotent: repricing to the same number is a no-op, so the refresh can
      // report `unchanged` honestly rather than writing every night (Rule 11).
      expect(repriceRaceNote(out, 412, voice)).toBeNull();
    }
    // A note with no target sentence gains none. The block's own race day reads
    // "Execute the plan. Pacing in race-week briefing." on purpose.
    expect(repriceRaceNote('Execute the plan. Pacing in race-week briefing.', 443, 'coach')).toBeNull();
  });

  it('7 · A STEP NOTE NAMES NO DISTANCE · the table\'s own header, gated', () => {
    // The header three lines above the table says: "A note that names a
    // distance is a second place for the card to contradict the plan, so none
    // of these name one." `NOTE.race` named two, and printed them on a 6.21-mile
    // race. Rule 20: a rule with no gate is a hypothesis.
    const src = read('lib/training/spec-card.ts');
    const table = src.slice(src.indexOf('const NOTE = {'), src.indexOf('} as const;', src.indexOf('const NOTE = {')));
    const values = [...table.matchAll(/^\s{2}[A-Za-z]+:\s*'([^']*)'/gm)].map((m) => m[1]);
    expect(values.length, 'the NOTE table was found and read').toBeGreaterThan(5);
    for (const line of values) {
      expect(line, `NOTE value names a distance: "${line}"`)
        .not.toMatch(/\b\d+\s?K\b|\bmile \d+\b|\b\d+(\.\d+)?\s?mi(les)?\b|\bhalf marathon\b|\bmarathon\b/i);
    }
  });

  it('8 · THE WRITE IS ATOMIC · the refresh refuses rather than landing half a contract', () => {
    // The SQL applies exactly what `raceRowWrite` returned: drop these keys,
    // merge those, set that note. Nothing composes a field at the call site,
    // which is what let the old version move a pace and leave the prose.
    const s = read('lib/race/race-row-refresh.ts');
    expect(s).toMatch(/const write = raceRowWrite\(\{ row: contractRowOf\(row\), outlook \}\);/);
    expect(s).toMatch(/const violations = raceRowContractViolations\(projected\);/);
    expect(s).toMatch(/CONTRACT_INCOHERENT/);
    // The refusal must sit BEFORE the UPDATE, or it is a log line, not a gate.
    expect(s.indexOf('CONTRACT_INCOHERENT')).toBeLessThan(s.indexOf('UPDATE plan_workouts'));
    expect(s).toMatch(/workout_spec = \(COALESCE\(workout_spec, '\{\}'::jsonb\) - \$4::text\[\]\) \|\| \$3::jsonb/);
    expect(s).toMatch(/notes = COALESCE\(\$5, notes\)/);
  });

  it('9 · ONE OWNER FOR "WHICH PACE ARE THESE REPS AT" · the refresh does not re-implement it', () => {
    const s = read('lib/race/race-row-refresh.ts');
    expect(s).toContain("import { tuneupPaceAnchor } from '@/lib/plan/spec-builder'");
    // The regexes live in spec-builder and nowhere else.
    expect(s).not.toMatch(/5\\s\*k\\s\*pace/);
    const sb = read('lib/plan/spec-builder.ts');
    expect((sb.match(/race\\s\*pace\|@\\s\*\(\?:HM\|M\)P\?\\b/g) ?? []).length).toBe(1);
  });
});
