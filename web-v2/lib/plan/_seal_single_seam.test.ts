/**
 * RULE 20 GATE · there is EXACTLY ONE adaptation seam, it is OFF, and no
 * unattended path reaches a plan mutation around it.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * THE RULING THIS ENFORCES (owner, 2026-09-02)
 *
 *   "Too many independent levers can soften, reshape, re-phase, refuse, or
 *    automatically mutate the plan."
 *
 *   "Remove their decision authority, not merely their UI. Delete unused
 *    proposal paths, triggers, queues, and competing ownership where safe."
 *
 *   "There must be exactly one future adaptation boundary, disabled by
 *    default."
 *
 * The last sentence is the one that needs a gate, and it needs one because
 * the failure mode is additive and invisible: nobody sets out to build a
 * second seam. Someone adds a `SHADOW_ONLY = true`, or a
 * `PUSH_ENABLED = false`, or wires a cron straight to `applyAdaptations`
 * "just for now", and the app is back to several dormant levers that each
 * look harmless on their own. Rule 20: a product rule with no check is a
 * hypothesis.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * WHAT THIS GATE CANNOT FAIL ON (Rule 22)
 *
 * Say what it is structurally incapable of catching, not what it covers.
 *
 *   · It reads STATIC SOURCE TEXT. A second switch reached through a
 *     computed property, an environment variable, a database column, or a
 *     function that returns a boolean from a table lookup is invisible to
 *     it. It can see `export const X = false`; it cannot see
 *     `process.env.ADAPT_ON === '1'`.
 *   · It checks CALL SHAPE, not reachability. It asserts that no cron route
 *     names `applyAdaptations` / `tryAdaptiveBump` outside the sealed
 *     wiring; a route that reached one of them through a chain of helpers in
 *     three other modules would pass. The import-graph walk that would catch
 *     that lives in `lib/audit/_automatic_mutations.test.ts`, which is the
 *     gate for "which statements write a plan"; this one is the gate for
 *     "how many switches are there".
 *   · It cannot tell a DELIBERATE promotion from an accidental one. Opening
 *     the seam trips this file, which is the point — it makes the decision
 *     visible, it does not make it for anyone.
 *   · It says NOTHING about whether the seal is the right product call, and
 *     nothing about whether the runner-gated proposal lane behaves well. A
 *     proposal that lands on the runner's phone and is wrong is not this
 *     gate's business.
 *   · Its second-switch scan is NAME-BASED over exported boolean literals.
 *     A seam expressed as a non-boolean (an enum, a string mode, a numeric
 *     level) would slip past. The allowlist below is a ratchet against the
 *     shapes it CAN see.
 *
 * FALSIFIED before it was trusted, in both directions — see the report for
 * this change for the verbatim output.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { sealAutomaticActions, SEALED_ACTION_INTENT_REASON } from './adaptation-authority';
import type { AdaptationAction } from './adapt';

const WEB = join(__dirname, '..', '..');
const SEAM = join(WEB, 'lib', 'plan', 'adaptation-authority.ts');
const SEAM_REL = 'lib/plan/adaptation-authority.ts';

function walk(dir: string, out: string[] = []): string[] {
  let entries: string[];
  try { entries = readdirSync(dir); } catch { return out; }
  for (const e of entries) {
    if (e === 'node_modules' || e.startsWith('.')) continue;
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if ((p.endsWith('.ts') || p.endsWith('.tsx')) && !p.includes('.test.')) out.push(p);
  }
  return out;
}

/** Source with comments removed — a claim about CODE must not be satisfied,
 *  or broken, by prose describing the code. This whole file is full of
 *  sentences naming the very symbols it forbids. */
function code(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
}

const SOURCE_FILES = [
  ...walk(join(WEB, 'lib')),
  ...walk(join(WEB, 'app')),
];
const rel = (p: string) => relative(WEB, p).split('\\').join('/');

/**
 * Exported boolean-literal constants that are NOT the seam, each with the
 * argument for why it is not a second adaptation switch.
 *
 * A ratchet: it may shrink, never grow. An entry whose file no longer holds
 * such a constant fails until deleted, so a stale excuse cannot outlive the
 * thing it excused (Rule 18 guard 4).
 */
const NOT_A_SEAM: Record<string, string> = {
  'lib/audit/coercion-registry.ts':
    'HANDED_BACK_FAILS is a documentation constant inside an AUDIT registry. It records whether a '
    + 'swallowed-failure shape hands its failure back to the caller; it gates no runtime behaviour, '
    + 'reaches no plan table, and is read only by that registry\'s own scanner.',
};

/**
 * Files allowed to name the mutating entry points despite not being the
 * seam or its declared callers. Each needs an argument.
 */
const MUTATOR_NAME_EXEMPT: Record<string, string> = {
  'lib/adaptation-harness/drive.ts':
    'Fenced test substrate. It calls the SHIPPED path on purpose (Rule 13\'s fixture trap, one level '
    + 'up) and asserts assertHarnessDatabase() at module scope, so it cannot run against production. '
    + 'Already excluded on the same argument by lib/audit/_automatic_mutations.test.ts.',
  'lib/plan/adaptive-ramp.ts':
    'It IS one of the sealed entry points: tryAdaptiveBump names applyAdaptations, and refuses at the '
    + 'seam before reaching it. Asserted directly below rather than merely excused.',
  'app/api/plan/workout-proposals/[id]/accept/route.ts':
    'RUNNER-INITIATED. The runner tapped accept on a proposal card; this is the driver\'s seat the '
    + 'ruling preserves, not an unattended lever. Not a cron route.',
};

describe('LIVENESS · the scan opened real files', () => {
  it('read enough source to mean anything', () => {
    // Rule 18 guard 2. A scanner that reports clean because it looked at
    // nothing is the worst outcome available, since it also reports
    // confidence. Floor held below the observed count so ordinary deletion
    // does not trip it.
    expect(SOURCE_FILES.length, `scanned ${SOURCE_FILES.length} files`).toBeGreaterThan(400);
    expect(existsSync(SEAM), `${SEAM_REL} is missing — the seam itself is gone`).toBe(true);
    expect(readFileSync(SEAM, 'utf8').length).toBeGreaterThan(3000);
  });
});

describe('GUARD 1 · the seam exists, says what it would enable, and is OFF', () => {
  const src = readFileSync(SEAM, 'utf8');

  it('declares the switch, typed as the literal false so opening it is a visible edit', () => {
    expect(
      code(src),
      'The seam constant is gone or no longer pinned to the literal `false`. Typing it `false` rather '
      + 'than `boolean` is what makes opening the seam a deliberate, compile-visible act instead of a '
      + 'value that could drift true.',
    ).toMatch(/export const AUTOMATIC_ADAPTATION_AUTHORITY\s*:\s*false\s*=\s*false\s*;/);
  });

  it('its header states what turning it on would enable', () => {
    // Rule 20's corollary for prose runs the other way here: this header is
    // the ONLY place that says what the grant costs, so the gate insists it
    // keeps saying it.
    for (const phrase of ['THE ONE SEAM', 'WOULD ENABLE', 'run-adaptations', 'tryAdaptiveBump']) {
      expect(src, `the seam header no longer mentions "${phrase}"`).toContain(phrase);
    }
  });

  it('both consumers read the switch rather than re-deciding', () => {
    const c = code(src);
    expect(c).toMatch(/export function sealAutomaticActions/);
    expect(c).toMatch(/export function automaticPlanMutationIsAuthorised/);
    // The closed branch must be the DEFAULT branch, not the only branch: a
    // seam with no open path is a deletion wearing a switch's name, and the
    // owner asked for a boundary he can open.
    expect(c, 'the seam has no open branch — it is a deletion, not a switch').toMatch(
      /if\s*\(\s*AUTOMATIC_ADAPTATION_AUTHORITY as boolean\s*\)/,
    );
  });
});

describe('GUARD 2 · there is no SECOND seam', () => {
  const BOOL_CONST = /^export const ([A-Z][A-Z0-9_]*)\s*(?::[^=\n]*)?=\s*(?:true|false)\s*;?$/gm;

  it('every exported boolean-literal constant is the seam or has an argued reason', () => {
    const found: Array<{ file: string; name: string }> = [];
    for (const f of SOURCE_FILES) {
      const c = code(readFileSync(f, 'utf8'));
      for (const m of c.matchAll(BOOL_CONST)) found.push({ file: rel(f), name: m[1] });
    }
    // Liveness for THIS scan specifically: the seam's own constant must be
    // among the matches, or the regex has stopped matching and the guard is
    // reporting clean on nothing.
    expect(
      found.some((x) => x.file === SEAM_REL && x.name === 'AUTOMATIC_ADAPTATION_AUTHORITY'),
      'the boolean-constant scan did not even find the seam. The predicate has rotted; fix it rather '
      + 'than trusting a clean report from a scanner that matches nothing.',
    ).toBe(true);

    const rogue = found
      .filter((x) => x.file !== SEAM_REL)
      .filter((x) => !NOT_A_SEAM[x.file])
      .map((x) => `${x.file} :: ${x.name}`);
    expect(
      [...new Set(rogue)],
      'A second default-off switch. The owner asked for EXACTLY ONE future adaptation boundary: '
      + 'several dormant ones is the state he is removing, and each looks harmless on its own. Either '
      + 'route this through lib/plan/adaptation-authority.ts, or add it to NOT_A_SEAM with an argument '
      + 'for why it can never gate a plan mutation.',
    ).toEqual([]);
  });

  it('every NOT_A_SEAM exemption still points at something real', () => {
    // Ratchet. A stale excuse fails until deleted.
    for (const [file, why] of Object.entries(NOT_A_SEAM)) {
      const abs = join(WEB, file);
      expect(existsSync(abs), `${file} is exempted here and no longer exists. Delete the entry.`).toBe(true);
      expect(
        BOOL_CONST.test(code(readFileSync(abs, 'utf8'))),
        `${file} no longer declares an exported boolean constant. The exemption has outlived its `
        + 'target — delete it.',
      ).toBe(true);
      BOOL_CONST.lastIndex = 0;
      expect(why.length, `${file}'s exemption is a shrug, not an argument`).toBeGreaterThan(80);
    }
  });
});

describe('GUARD 3 · no unattended path reaches a plan mutation around the seam', () => {
  const CRON_DIR = join(WEB, 'app', 'api', 'cron');
  const cronFiles = walk(CRON_DIR);

  it('parsed real cron routes', () => {
    expect(cronFiles.length, 'no cron routes found — the scan is looking in the wrong place')
      .toBeGreaterThan(8);
  });

  it('the adaptation cron applies through the seam and not through the raw partition', () => {
    const f = join(CRON_DIR, 'run-adaptations', 'route.ts');
    expect(existsSync(f)).toBe(true);
    const c = code(readFileSync(f, 'utf8'));
    expect(c, 'run-adaptations no longer calls sealAutomaticActions. If the apply lane has been '
      + 'rewired, it has been rewired around the only switch that governs it.')
      .toMatch(/sealAutomaticActions\s*\(/);
    expect(c, 'run-adaptations calls partitionActionsForCron directly again. That function answers '
      + '"does the runner normally gate this KIND", which is the OLD question; the seam answers "may '
      + 'an unattended job change the plan at all", which is the ruling. Going straight to the '
      + 'partition restores the apply-now lane the seal closed.')
      .not.toMatch(/partitionActionsForCron\s*\(/);
  });

  it('no OTHER cron route names a plan-mutating adaptation entry point', () => {
    const offenders: string[] = [];
    for (const f of cronFiles) {
      const r = rel(f);
      if (r.endsWith('cron/run-adaptations/route.ts')) continue;
      const c = code(readFileSync(f, 'utf8'));
      if (/\bapplyAdaptations\s*\(/.test(c) || /\btryAdaptiveBump\s*\(/.test(c)) offenders.push(r);
    }
    expect(
      offenders,
      'A scheduled job reaches an adaptation mutator directly. Every unattended write must come '
      + 'through lib/plan/adaptation-authority.ts.',
    ).toEqual([]);
  });

  /**
   * REANCHORPROPOSES-1 (2026-09-05) · THE WRITER THAT WAS OUTSIDE THIS SEAM.
   *
   * `adaptation-authority.ts`'s own header used to carry `reanchorActivePlan`
   * under "what this does NOT gate, and why", deliberately left for the owner
   * to rule on. He ruled: "AUTOMATIC_ADAPTATION_AUTHORITY=false is meaningless
   * if reanchorActivePlan can bypass it and rewrite 76 workouts." It now
   * proposes, and this guard is what keeps it that way.
   *
   * The check is on the DECLARED AUTHORITY rather than on the presence of a
   * write, because the write statements have to stay — the accept path and the
   * race-authority answer both reach them. What may never come back is an
   * unattended caller with a class the seam refuses plus a hold that lets it
   * through anyway.
   */
  it('the daily self-heal cannot write the plan on its own authority', () => {
    const f = join(WEB, 'lib', 'plan', 'reanchor-plan.ts');
    const c = code(readFileSync(f, 'utf8'));
    expect(c.length, 'reanchor-plan is gone or the stripper broke').toBeGreaterThan(5000);
    expect(
      c.includes("authority: 'COACHING_ADAPTATION'"),
      'reanchor-plan declares the class the seam refuses. The only way that becomes a working '
      + 'write is a hold, and a hold that continues writing is an exemption with better paperwork.',
    ).toBe(false);
    expect(
      /^\s*hold:\s*\{/m.test(c),
      'a hold reappeared in the self-heal.',
    ).toBe(false);
    const fn = /export async function reanchorActivePlan[\s\S]*?\n}\n/.exec(c)?.[0] ?? '';
    expect(fn.length, 'reanchorActivePlan is gone or renamed').toBeGreaterThan(200);
    expect(
      fn.includes("'propose'"),
      'the unattended entry point no longer asks for the propose half.',
    ).toBe(true);
    expect(
      fn.includes('mutatePlan'),
      'reanchorActivePlan reaches the mutation boundary directly again.',
    ).toBe(false);
  });

  it('the volume bump refuses at the seam BEFORE it reads anything', () => {
    const f = join(WEB, 'lib', 'plan', 'adaptive-ramp.ts');
    const c = code(readFileSync(f, 'utf8'));
    const fnAt = c.indexOf('export async function tryAdaptiveBump');
    expect(fnAt, 'tryAdaptiveBump is gone or renamed').toBeGreaterThan(-1);
    const applyAt = c.indexOf('applyAdaptations', fnAt);
    const gateAt = c.indexOf('automaticPlanMutationIsAuthorised', fnAt);
    expect(gateAt, 'tryAdaptiveBump no longer consults the seam').toBeGreaterThan(-1);
    expect(
      gateAt,
      'the seam check does not come FIRST inside tryAdaptiveBump. A guard placed after the detection '
      + 'leaves a live path to applyAdaptations one edit away, which is exactly how "wired, tested and '
      + 'inert" became "wired, tested and firing" the last time.',
    ).toBeLessThan(applyAt);
  });

  it('every file that names a mutating entry point is the seam, a declared caller, or exempt', () => {
    const allowed = new Set<string>([
      SEAM_REL,
      'lib/plan/adapt.ts',                                  // the implementation itself
      'app/api/cron/run-adaptations/route.ts',              // the sealed cron
      ...Object.keys(MUTATOR_NAME_EXEMPT),
    ]);
    const offenders: string[] = [];
    for (const f of SOURCE_FILES) {
      const r = rel(f);
      if (allowed.has(r)) continue;
      const c = code(readFileSync(f, 'utf8'));
      if (/\bapplyAdaptations\s*\(/.test(c) || /\btryAdaptiveBump\s*\(/.test(c)) offenders.push(r);
    }
    expect(
      offenders,
      'A new caller of an adaptation mutator. If it is unattended it must go through the seam; if it '
      + 'is the runner tapping something, add it to MUTATOR_NAME_EXEMPT and name the route that '
      + 'reaches it.',
    ).toEqual([]);

    // Ratchet on the exemptions themselves.
    for (const [file, why] of Object.entries(MUTATOR_NAME_EXEMPT)) {
      const abs = join(WEB, file);
      expect(existsSync(abs), `${file} is exempted here and no longer exists. Delete the entry.`).toBe(true);
      const c = code(readFileSync(abs, 'utf8'));
      expect(
        /\bapplyAdaptations\s*\(/.test(c) || /\btryAdaptiveBump\s*\(/.test(c),
        `${file} no longer names a mutating entry point. The exemption has outlived its target — `
        + 'delete it.',
      ).toBe(true);
      expect(why.length, `${file}'s exemption is a shrug, not an argument`).toBeGreaterThan(80);
    }
  });
});

/**
 * GUARD 5 · the seam BEHAVES, not merely exists.
 *
 * Rule 22's warning applied to this gate itself: everything above is a
 * source scan, and a source scan cannot fail on a seam that is present,
 * correctly named, correctly wired, and routes the actions wrongly. These
 * cases run the real function.
 *
 * Distribution, stated deliberately: three of the five cases assert an
 * action is NOT applied and two assert something IS still allowed through
 * (the observational note, and the runner-gated card). A seal is a refusing
 * mechanism, so a suite that only tested refusal would pass a seam that
 * refused everything — including the two lanes the ruling explicitly keeps.
 */
describe('GUARD 5 · what the closed seam actually does with each action', () => {
  const note = (over: Partial<AdaptationAction> = {}): AdaptationAction => ({
    kind: 'note', noteReason: 'plan_adapt_missed_noted', why: 'noted', ...over,
  } as AdaptationAction);

  it('a record-only note still applies · observation is what the ruling keeps', () => {
    const { apply, propose, recorded } = sealAutomaticActions([note()]);
    expect(apply).toHaveLength(1);
    expect(apply[0].kind).toBe('note');
    expect(propose).toHaveLength(0);
    expect(recorded).toHaveLength(0);
  });

  it('a pace recompute is RECORDED, never applied · and never under the reason a real recompute writes', () => {
    const { apply, propose, recorded } = sealAutomaticActions([{
      kind: 'recompute_paces', sourceTrigger: 'pr_bank', newVdot: 54,
      why: 'new race result', forceApplyNow: true,
    } as AdaptationAction]);
    expect(propose, 'a recompute has no workoutIds · proposing it would silently drop it')
      .toHaveLength(0);
    expect(recorded).toHaveLength(1);
    expect(apply.every((a) => a.kind === 'note'), 'a plan-mutating action reached the apply lane')
      .toBe(true);
    // THE RULE 11 CLAUSE. `lib/training/pace-anchor.ts` stands the 07:30
    // self-heal down for 24h when it sees `plan_adapt_recompute_paces`. If a
    // REFUSED recompute wrote that reason, the self-heal would defer to work
    // that never happened and the block's paces would freeze — a guard that
    // silently stops guarding, which is worse than no guard.
    expect(
      recorded[0].noteReason,
      'the sealed note reuses the reason an APPLIED recompute writes. Downstream guards read that '
      + 'reason as proof the adapter re-priced the block; a refusal must not be able to say so.',
    ).toBe(SEALED_ACTION_INTENT_REASON);
    expect(recorded[0].noteReason).not.toBe('plan_adapt_recompute_paces');
    expect(recorded[0].noteValue?.sealed_kind).toBe('recompute_paces');
  });

  it('a sealed note is not hung off a workout id · no coach sentence on an unchanged row', () => {
    // lib/coach/adaptation-info.ts joins `ci.field = pw.id` for any
    // `plan_adapt%` reason and renders the row's `why` as "how it changed".
    // A refusal attached to a workout would explain a change that never
    // happened (Rule 16, and Rule 17's "the runner reads a sentence once").
    const { recorded } = sealAutomaticActions([{
      kind: 'reshape', sourceTrigger: 'progression_gate', workoutIds: ['wko_9'],
      why: 'earned the step', reshape: { weekStartISO: '2026-09-07' },
    } as unknown as AdaptationAction]);
    expect(
      recorded[0].noteField,
      'a sealed note carries a workout id. Today would render a coach explanation on a session the '
      + 'seam explicitly refused to change.',
    ).toBeNull();
    // …and the provenance is still recoverable by an operator.
    expect((recorded[0].noteValue?.sealed_payload as { workoutIds: string[] }).workoutIds)
      .toEqual(['wko_9']);
  });

  it('a quality-session reshape is RECORDED · "reshape" is named in the ruling', () => {
    const { apply, recorded } = sealAutomaticActions([{
      kind: 'reshape', sourceTrigger: 'progression_gate', workoutIds: ['wko_1'],
      why: 'earned the step', forceApplyNow: true,
      reshape: { weekStartISO: '2026-09-07' },
    } as unknown as AdaptationAction]);
    expect(recorded.map((a) => a.noteValue?.sealed_kind)).toEqual(['reshape']);
    expect(apply.every((a) => a.kind === 'note')).toBe(true);
    // THE OTHER RULE 11 CLAUSE. progression-pass.ts reads the most recent
    // `week_start_iso` to answer "has this week's pass already been decided".
    // Before the seal only an APPLIED reshape wrote it; a refused one has to
    // carry it too, or that guard reads an always-empty table and the weekly
    // pass fires on all three catch-up mornings instead of one.
    expect(
      recorded[0].noteValue?.week_start_iso,
      'a refused reshape dropped the once-per-week marker. The seal would then have DISABLED the '
      + 'progression pass\'s own frequency guard — a guard that silently stops guarding is worse '
      + 'than no guard.',
    ).toBe('2026-09-07');
  });

  it('a sealed note that is NOT a reshape carries no week marker', () => {
    // The other half of the same clause. `plan_adapt_sealed` is a shared
    // namespace, and progression-pass.ts filters on the key's PRESENCE; a
    // refused recompute that minted a bogus week marker would answer that
    // reader with the wrong week.
    const { recorded } = sealAutomaticActions([
      { kind: 'recompute_paces', sourceTrigger: 'pr_bank', why: 'x' } as AdaptationAction,
    ]);
    expect(Object.keys(recorded[0].noteValue ?? {})).not.toContain('week_start_iso');
  });

  it('a load-reducing action still PROPOSES · the runner keeps his card', () => {
    const { apply, propose } = sealAutomaticActions([{
      kind: 'shave', sourceTrigger: 'volume_overshoot', workoutIds: ['wko_2'],
      shaveFraction: 0.15, why: 'overshot',
    } as AdaptationAction]);
    expect(propose).toHaveLength(1);
    expect(propose[0].kind).toBe('shave');
    expect(apply).toHaveLength(0);
  });

  it('NOTHING is ever silently dropped · every action comes out of exactly one lane', () => {
    const actions = [
      note(),
      { kind: 'recompute_paces', sourceTrigger: 'training_lead', why: 'a' } as AdaptationAction,
      { kind: 'mark_dirty', sourceTrigger: 'goal_changed', why: 'b' } as AdaptationAction,
      { kind: 'mark_upgrade', bumps: [{ workoutId: 'w', newDistanceMi: 9 }], why: 'c' } as AdaptationAction,
      { kind: 'reschedule', sourceTrigger: 'training_gap', workoutIds: ['w3'], newDate: '2026-09-09', why: 'd' } as AdaptationAction,
      { kind: 'downgrade', sourceTrigger: 'missed_key_workout', workoutIds: ['w4'], why: 'e' } as AdaptationAction,
      // Deliberately un-proposable despite a propose-first trigger: no
      // workoutIds. `writeWorkoutProposals` would drop this on the floor.
      { kind: 'field_test', sourceTrigger: 'field_test_due', why: 'f' } as AdaptationAction,
    ];
    const { apply, propose, recorded } = sealAutomaticActions(actions);
    expect(apply.length + propose.length).toBe(actions.length);
    expect(apply.every((a) => a.kind === 'note'), 'the closed seam applied a plan-mutating action')
      .toBe(true);
    expect(propose.every((a) => (a.workoutIds?.length ?? 0) > 0),
      'an action with no workoutIds was routed to writeWorkoutProposals, which skips it — the '
      + 'action and its coach_intents row would both vanish (Rule 11).').toBe(true);
    expect(recorded.map((a) => a.noteValue?.sealed_kind).sort())
      .toEqual(['field_test', 'mark_dirty', 'mark_upgrade', 'recompute_paces']);
  });
});

describe('GUARD 4 · the retired drift levers have no writer and no accept', () => {
  const driftRoute = join(WEB, 'app', 'api', 'cron', 'plan-drift', 'route.ts');

  it('plan-drift writes no drift or goal-gap proposal row', () => {
    const c = code(readFileSync(driftRoute, 'utf8'));
    expect(c, 'the soft-drift proposal writer is back. Its six triggers are transient readings; the '
      + 'ruling removed their authority to re-phase a block.')
      .not.toContain('drift_cron_pending');
    expect(c, 'the goal-gap widening rebuild card is back. Its trigger is a three-day trend across '
      + 'projection_snapshots — true today, false next week.')
      .not.toContain('goal_gap_cron_pending');
    expect(c, 'plan-drift no longer runs detectDrift at all. The observation was deliberately kept '
      + '("make it observational only") — losing it is a different change from losing the writer, and '
      + 'should be made deliberately if it is made.')
      .toMatch(/detectDrift\s*\(/);
  });

  it('the lifecycle rebuilds SURVIVE · this seal must not have stranded the runner', () => {
    // The other half of the ruling, and the half a seal is most likely to
    // over-shoot. The owner's KEEP list preserves the race date and the full
    // block calendar; a runner parked in an ended block forever is not one
    // stable plan, it is no plan.
    const c = code(readFileSync(driftRoute, 'utf8'));
    for (const kind of ['race_graduate', 'recovery_complete', 'plan_elapsed']) {
      // Matched on the ARGUMENT to fireAutoRebuild, not on the bare word.
      // Falsified first as a plain `toContain(kind)` and it PASSED with the
      // transition deleted, because the route's own GET handler documents
      // each trigger in a prose string and `code()` strips comments, not
      // string literals. An assertion a doc line can satisfy is the
      // absence-only shape Rule 18 warns about.
      expect(c, `the ${kind} lifecycle transition no longer fires a rebuild. That is an AUTHORED `
        + 'calendar fact, not a transient reading, and removing it strands the runner in a block '
        + 'that has ended.')
        .toMatch(new RegExp(`kind:\\s*'${kind}'`));
    }
    expect(c).toMatch(/fireAutoRebuild\s*\(/);
  });

  it('a pending card of a retired kind is refused server-side, not merely unrendered', () => {
    // Deleting a writer stops NEW cards. It does nothing about the ones
    // already pending in a live account, and the generic accept branch would
    // still rebuild off one. A refusal in a renderer can be undone by a UI
    // edit; a refusal in the route cannot.
    const policy = code(readFileSync(join(WEB, 'lib', 'plan', 'drift-proposal-policy.ts'), 'utf8'));
    expect(policy).toMatch(/export const RETIRED_REBUILD_PROPOSAL_KINDS/);
    expect(policy).toContain('goal_gap_widening');

    const accept = code(readFileSync(join(WEB, 'app', 'api', 'plan', 'proposal', 'route.ts'), 'utf8'));
    expect(accept, 'POST /api/plan/proposal no longer refuses retired rebuild kinds. A stale '
      + 'long_drift card would re-author the block on the runner\'s next tap.')
      .toMatch(/isRetiredRebuildProposalKind\s*\(/);
    // And the refusal must stand IN FRONT of the generic rebuild, not after
    // it — the PACE.interval-offset failure was an exemption sitting above
    // the only assertion it was meant to qualify.
    const guardAt = accept.indexOf('isRetiredRebuildProposalKind');
    const rebuildAt = accept.indexOf('generatePlan(');
    expect(rebuildAt).toBeGreaterThan(-1);
    expect(
      guardAt,
      'the retired-kind refusal sits BELOW the generic rebuild call. A guard downstream of the thing '
      + 'it guards is decoration.',
    ).toBeLessThan(rebuildAt);
  });
});
