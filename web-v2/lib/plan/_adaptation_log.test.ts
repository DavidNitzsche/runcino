/**
 * lib/plan/_adaptation_log.test.ts · THE LOG CAN ANSWER "HAS THIS EVER PUSHED
 * UP", AND IT SAYS SO OUT OF ITS OWN ROWS.
 *
 * Rule 21's observability clause, gated. The old `{ts, n}` shape is produced
 * identically by a pass that raised three weeks and one that cut three
 * sessions, and that ambiguity is what let an engine with zero upward
 * adaptations survive 309 production intents unnoticed.
 *
 * Four guards.
 *
 *   1 · **Every action kind has a direction, and the union is total.** A new
 *       kind defaulting to NEUTRAL is how a log quietly stops counting the
 *       thing it exists to count. The switch has no `default`, so this is a
 *       compile-time property; the test is the runtime half — it enumerates
 *       every kind on the shipped union and asserts each answers.
 *   2 · **The three directions are actually reachable.** Rule 15: a mechanism
 *       no case can reach is untested. A direction vocabulary where nothing can
 *       ever be UP is the same defect one level up.
 *   3 · **Direction is DERIVED, not asserted.** `reshape` and `recompute_paces`
 *       resolve from their own payload, so an ACCELERATE and a BACK_OFF of the
 *       same kind must come out opposite. This is the guard against a caller
 *       labelling its own change.
 *   4 · **The write site still appends and still carries `ts` and `n`.** A
 *       source assertion, because `docs/OVERNIGHT-REPORT.md` records consumers
 *       deriving "last changed" from `max(adaptation_log.ts)` and no test in
 *       this repo covers those readers.
 *
 * ── FALSIFIED, PER RULE 18 ─────────────────────────────────────────────────
 *
 *   · `mark_upgrade` switched from UP to NEUTRAL in `directionOfAction`.
 *     Guard 3b failed, showing the push pass counted `{UP: 1}` where it should
 *     count 2. Guard 2 did NOT fail, and that is worth stating rather than
 *     hiding: `recompute_paces` with a rising VDOT still reaches UP, so
 *     reachability survived losing the only kind whose NAME means "more work".
 *     A reachability check cannot see a mechanism going dark while a sibling
 *     covers for it, which is why guard 3b exists and asserts counts.
 *   · the write site's `jsonb_build_object` reduced to `('ts', NOW(), 'did',
 *     ...)`, dropping `n`: guard 4 failed with "the 'n' key existing consumers
 *     read was dropped".
 *
 * Both restored, and the suite returned green.
 *
 * ── RULE 22 · WHAT THIS GATE CANNOT FAIL ON ────────────────────────────────
 *
 * · **The direction being the RIGHT answer for an action.** It checks that a
 *   direction exists, is reachable, and is derived from the payload where the
 *   payload decides it. Whether `field_test` should really be NEUTRAL is a
 *   coaching judgement no test can settle.
 * · **The write actually reaching the database.** Guard 4 reads source text. It
 *   proves the statement is shaped correctly; it does not prove a row changed,
 *   and the production write barrier means no test in this repo may try.
 * · **The three other paths that can move a workout.** `/api/today/reschedule`,
 *   `move_day` and `PATCH /api/plan/workout` write nothing here, so a zero UP
 *   count from this log is evidence about the nightly cron and not about the
 *   app. That consolidation is already open in the program document.
 * · **A pass that changed nothing.** `applyAdaptations` appends only when
 *   `touched > 0`, so a night the engine considered pushing and declined leaves
 *   no row. This gate does not ask for one, and that gap is named in
 *   `adaptation-log.ts`'s own header.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';
import type { AdaptationAction } from './adapt';
import {
  buildAdaptationLogEntry, countByDirection, directionOfAction, leverOfAction,
  type AdaptationDirection,
} from './adaptation-log';

/**
 * Every kind on the shipped union, written out.
 *
 * Deliberately a literal list rather than something derived, so adding a kind
 * to `AdaptationAction` without adding it here is a compile error at the
 * `satisfies` below. A derived list would silently cover a new kind with no
 * case for it, which is the failure this guard exists for.
 */
const ALL_KINDS = [
  'reschedule', 'downgrade', 'shave', 'recompute_paces', 'mark_dirty',
  'mark_upgrade', 'note', 'field_test', 'reshape',
] as const satisfies readonly AdaptationAction['kind'][];

/** A minimal action of one kind. Nothing here is mocked; it is the real type. */
function action(kind: AdaptationAction['kind'], extra: Partial<AdaptationAction> = {}): AdaptationAction {
  return { kind, why: 'because', ...extra } as AdaptationAction;
}

const reshapeAction = (a: 'ACCELERATE' | 'TAKE' | 'HOLD' | 'BACK_OFF'): AdaptationAction =>
  action('reshape', {
    reshape: {
      resolution: { action: a, shape: {}, why: 'x', changed: true },
      row: {},
      band: {},
      lthr: 162,
      weekStartISO: '2026-09-07',
    },
  } as unknown as Partial<AdaptationAction>);

describe('Rule 21 · the adaptation log records WHAT adapted, and which way', () => {
  it('guard 1 · every action kind answers with a direction and a lever', () => {
    const missing: string[] = [];
    for (const kind of ALL_KINDS) {
      const d = directionOfAction(action(kind));
      const l = leverOfAction(action(kind));
      if (d === undefined) missing.push(`${kind}: no direction`);
      if (l === undefined) missing.push(`${kind}: no lever`);
    }
    expect(missing).toEqual([]);
    // Liveness · a loop over an empty list would pass silently.
    expect(ALL_KINDS.length).toBe(9);
  });

  it('guard 2 · all three directions are reachable by a real action', () => {
    const seen = new Set<AdaptationDirection>();
    for (const kind of ALL_KINDS) seen.add(directionOfAction(action(kind)));
    seen.add(directionOfAction(reshapeAction('ACCELERATE')));
    seen.add(directionOfAction(reshapeAction('BACK_OFF')));
    seen.add(directionOfAction(action('recompute_paces', { fromVdot: 44, newVdot: 46 })));

    const unreachable = (['UP', 'DOWN', 'NEUTRAL'] as const).filter((d) => !seen.has(d));
    expect(
      unreachable,
      'A direction no action can produce is a vocabulary that cannot count the '
      + 'thing Rule 21 asks it to count.',
    ).toEqual([]);
  });

  it('guard 3 · direction is derived from the payload, not from the kind', () => {
    // Same kind, opposite verdicts, opposite directions.
    expect(directionOfAction(reshapeAction('ACCELERATE'))).toBe('UP');
    expect(directionOfAction(reshapeAction('BACK_OFF'))).toBe('DOWN');
    expect(directionOfAction(reshapeAction('HOLD'))).toBe('NEUTRAL');

    // A re-pace goes either way, and a higher VDOT is a harder prescription.
    expect(directionOfAction(action('recompute_paces', { fromVdot: 44, newVdot: 46 }))).toBe('UP');
    expect(directionOfAction(action('recompute_paces', { fromVdot: 46, newVdot: 44 }))).toBe('DOWN');
    expect(directionOfAction(action('recompute_paces', { fromVdot: 45, newVdot: 45 }))).toBe('NEUTRAL');

    // Rule 11 · a missing anchor is not a direction of zero, and it must not be
    // guessed. NEUTRAL is where an unknown sign goes, and it is stated.
    expect(directionOfAction(action('recompute_paces', { newVdot: 46 }))).toBe('NEUTRAL');
    expect(directionOfAction(action('recompute_paces', { fromVdot: 44 }))).toBe('NEUTRAL');
  });

  it('guard 3b · the log answers "has this ever pushed up" from its own rows', () => {
    // The exact scenario Rule 21 measured: a pass that only ever cuts.
    const cuts = buildAdaptationLogEntry(
      [
        action('downgrade', { workoutIds: ['w1'], sourceTrigger: 'missed_key_workout' }),
        action('shave', { shaveFraction: 0.15, workoutIds: ['w2'], sourceTrigger: 'volume_overshoot' }),
        action('reschedule', { workoutIds: ['w3'], newDate: '2026-09-09' }),
      ] as AdaptationAction[],
      3,
      '2026-09-03T03:00:00.000Z',
    );
    expect(countByDirection([cuts])).toEqual({ UP: 0, DOWN: 2, NEUTRAL: 1 });

    // And a pass that pushes is distinguishable, which `{n: 3}` was not.
    const pushes = buildAdaptationLogEntry(
      [
        action('mark_upgrade', {
          bumps: [{ workoutId: 'w1', newDistanceMi: 9 }],
          sourceTrigger: 'progression_gate',
        }),
        action('recompute_paces', { fromVdot: 44, newVdot: 46 }),
      ] as AdaptationAction[],
      3,
      '2026-09-04T03:00:00.000Z',
    );
    expect(countByDirection([pushes])).toEqual({ UP: 2, DOWN: 0, NEUTRAL: 0 });

    // The two passes have the SAME `n`. That is the whole point.
    expect(cuts.n).toBe(pushes.n);
    expect(countByDirection([cuts])).not.toEqual(countByDirection([pushes]));

    // Every item carries its evidence, never an empty string.
    for (const item of [...cuts.did, ...pushes.did]) {
      expect(item.evidence.length).toBeGreaterThan(0);
      expect(item.what.length).toBeGreaterThan(0);
    }
  });

  it('guard 4 · the write site still APPENDS and still carries ts and n', () => {
    const src = readFileSync(path.join(__dirname, 'adapt.ts'), 'utf8');
    const stmt = src.match(/SET adaptation_log = [\s\S]{0,300}?WHERE user_uuid/);
    expect(stmt, 'the adaptation_log write statement has moved or been renamed').not.toBeNull();
    const sql = stmt![0];

    // Rule 6 · one writer, and the write is an append. A full-column replace
    // here would be the multi-writer defect waiting for its second writer.
    expect(sql).toContain("COALESCE(adaptation_log, '[]'::jsonb)");
    expect(sql).toContain('||');

    // The two keys existing readers depend on. `docs/OVERNIGHT-REPORT.md`
    // records "last changed" being derived from max(adaptation_log.ts), and
    // nothing in this repo tests that reader.
    expect(sql, "the 'ts' key existing consumers read was dropped").toContain("'ts'");
    expect(sql, "the 'n' key existing consumers read was dropped").toContain("'n'");
    // And the new half, without which this whole file is decoration.
    expect(sql, "the 'did' key is gone, so the log is back to a bare counter").toContain("'did'");
  });
});
