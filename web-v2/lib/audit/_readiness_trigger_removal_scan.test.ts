/**
 * READINESS-REMOVAL-1 · the runner decides how ready he is.
 *
 * ── THE RULING (owner, 2026-09-02) ──────────────────────────────────────────
 *
 *   "I want to be the one who decides how ready I am or not ready. I've been
 *    training a long time. Pushed through a lot of things. To have a plan
 *    cheapen itself is not what I'm building here."
 *
 * Asked how far it went, he chose to remove readiness from training decisions
 * ENTIRELY rather than make it advisory, and added: "remove illness and injury
 * for now. its noise. its a feature we can add in later."
 *
 * So six adaptation triggers were deleted outright — `readiness_pullback`,
 * `rhr_spike`, `sleep_crater`, `niggle_reported`, `sick_episode_active`,
 * `injury_active` — with their detectors, their actions, the `coach_intents`
 * reasons they wrote, and the `coach_proposals` type illness used.
 *
 * ── WHY A GATE AND NOT A NOTE (Rule 20) ─────────────────────────────────────
 *
 * A product rule with no check is a hypothesis. This file is the check. Every
 * name below is one the codebase used to carry and must not carry again, and
 * the ratchet is the point: a future session reaching for "just a small
 * readiness nudge" has to delete an assertion here and say why, in front of the
 * owner, rather than quietly re-adding a trigger.
 *
 * ── WHAT THIS GATE CANNOT FAIL ON (Rule 22) ─────────────────────────────────
 *
 * Stated rather than hidden, because a gate that only advertises its coverage
 * is how this project has shipped checks that could not fail:
 *
 *   · IT MATCHES NAMES, NOT BEHAVIOUR. Someone re-introducing exactly this
 *     mechanism under a different vocabulary — `freshness_hold`,
 *     `recovery_gate`, `wellness_check` — passes every assertion below. It
 *     raises the cost of a silent revival; it cannot make one impossible.
 *   · IT READS SOURCE TEXT. A trigger kind assembled at run time, or reached
 *     through a table-driven dispatch keyed on a string from the database, is
 *     invisible to it.
 *   · IT SAYS NOTHING ABOUT DISPLAY. Readiness is still computed, still
 *     stored, and still shown to the runner — that was deliberate, he asked
 *     not to be blinded — so the whole `lib/coach/readiness*` surface is out
 *     of scope here by design. A readiness sentence that starts RECOMMENDING a
 *     training change again would not trip this file. Guard 4 covers the two
 *     worst-offending shapes and no more.
 *   · IT IS ONE-DIRECTIONAL. Everything it can catch is a re-ADDITION. It has
 *     no opinion about whether the upward path works, which is the failure
 *     CLAUDE.md Rule 21 and Rule 22 say this codebase actually has. Guard 5 is
 *     the one exception and it is narrow: it checks that the ramp's brake is
 *     still fed, not that the ramp ever fires.
 *
 * ── LIVENESS (Rule 18 §2) ───────────────────────────────────────────────────
 *
 * Guard 0 asserts the scanner actually read files and actually found the
 * modules it claims to police. A scan that reports clean because it looked at
 * nothing is the worst outcome available, since it also reports confidence.
 *
 * ── FALSIFIED (Rule 18 §1) ──────────────────────────────────────────────────
 *
 * Re-added `| 'readiness_pullback'` to `AdaptationTriggerKind` in
 * `lib/plan/adapt.ts` and ran this file. Observed:
 *
 *   FAIL  lib/audit/_readiness_trigger_removal_scan.test.ts > READINESS-REMOVAL-1
 *         > guard 1 · no deleted trigger kind is back in the union
 *   AssertionError: readiness_pullback is back in AdaptationTriggerKind.
 *   The runner decides how ready he is (owner, 2026-09-02).
 *
 * Then restored, and the file passes.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(__dirname, '..', '..');

/**
 * The trigger kinds the ruling removed. These are ADAPTATION TRIGGERS — names
 * that once appeared in `AdaptationTriggerKind` and drove a change to the
 * runner's plan. They are not a ban on the words themselves: `lib/safety`,
 * `lib/coach/readiness*` and the runner's own logging surfaces all still speak
 * about illness, injury and niggles, because he still reports them and still
 * reads them back.
 */
const DELETED_TRIGGER_KINDS = [
  'readiness_pullback',
  'rhr_spike',
  'sleep_crater',
  'niggle_reported',
  'sick_episode_active',
  'injury_active',
] as const;

/** The `coach_intents.reason` values the deleted limbs wrote. */
const DELETED_INTENT_REASONS = [
  'readiness_convergence_amber',
  'readiness_convergence_red_no_quality',
  'readiness_convergence_red_proposed',
  'plan_adapt_readiness_pullback',
  'plan_adapt_niggle_reported',
  'plan_adapt_sick_episode_active',
  'plan_adapt_injury_active',
] as const;

/** The detector functions that formed the app's opinion about his body. */
const DELETED_DETECTORS = [
  'detectReadinessPullback',
  'detectRhrSpike',
  'detectSleepCrater',
  'detectNiggleReported',
  'detectSickEpisodeActive',
  'detectInjuryActive',
] as const;

/**
 * Files that decide what the runner is PRESCRIBED. Deliberately narrow: this
 * is the blast radius the ruling is about. Display modules are out of scope —
 * see "what this gate cannot fail on".
 */
const DECISION_FILES = [
  'lib/plan/adapt.ts',
  'lib/plan/adaptive-ramp.ts',
  'lib/plan/progression-gate.ts',
  'lib/plan/progression-pass.ts',
  'lib/plan/workout-proposals.ts',
  'lib/adaptation/adaptation-model.ts',
  'lib/adaptation/load.ts',
  'app/api/cron/run-adaptations/route.ts',
];

function read(rel: string): string {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

/**
 * Source with comments stripped, so the gate polices CODE and not the
 * obituaries this removal deliberately left behind. A file that explains why a
 * mechanism was deleted must be allowed to name it — otherwise the honest
 * record becomes the violation, and the next reader loses the only account of
 * what happened.
 */
function code(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

describe('READINESS-REMOVAL-1 · the runner decides how ready he is', () => {
  it('guard 0 · LIVENESS · the scanner read the modules it claims to police', () => {
    const seen: string[] = [];
    for (const rel of DECISION_FILES) {
      const full = path.join(ROOT, rel);
      expect(fs.existsSync(full), `${rel} is missing — this gate is policing a file that no longer exists, which means it is now scanning less than it reports. Update DECISION_FILES.`).toBe(true);
      const src = fs.readFileSync(full, 'utf8');
      expect(src.length, `${rel} is empty`).toBeGreaterThan(0);
      seen.push(rel);
    }
    expect(seen.length).toBe(DECISION_FILES.length);
    expect(seen.length).toBeGreaterThanOrEqual(8);
  });

  it('guard 1 · no deleted trigger kind is back in the union', () => {
    const src = code(read('lib/plan/adapt.ts'));
    const union = src.slice(
      src.indexOf('export type AdaptationTriggerKind'),
      src.indexOf('export interface AdaptationTrigger'),
    );
    expect(union.length, 'AdaptationTriggerKind not found — the gate cannot see its subject').toBeGreaterThan(20);
    for (const kind of DELETED_TRIGGER_KINDS) {
      expect(
        union.includes(`'${kind}'`),
        `${kind} is back in AdaptationTriggerKind. The runner decides how ready he is (owner, 2026-09-02).`,
      ).toBe(false);
    }
  });

  it('guard 2 · no deleted detector exists anywhere in the decision path', () => {
    for (const rel of DECISION_FILES) {
      const src = code(read(rel));
      for (const fn of DELETED_DETECTORS) {
        expect(
          src.includes(fn),
          `${rel} references ${fn}. The detectors that formed the app's opinion about the runner's body were deleted, not disabled.`,
        ).toBe(false);
      }
    }
  });

  it('guard 3 · no deleted trigger kind or intent reason is written by the decision path', () => {
    for (const rel of DECISION_FILES) {
      const src = code(read(rel));
      for (const name of [...DELETED_TRIGGER_KINDS, ...DELETED_INTENT_REASONS]) {
        expect(
          src.includes(`'${name}'`) || src.includes(`"${name}"`),
          `${rel} still names ${name} in code. Deleted means deleted — no dormant enum member, no back-compat branch.`,
        ).toBe(false);
      }
    }
  });

  it('guard 4 · the plan engine does not read a wearable readiness table', () => {
    // The two tables that hold "how the runner's morning read". A decision file
    // querying either is readiness re-entering the prescription, whatever the
    // surrounding code calls itself.
    for (const rel of DECISION_FILES) {
      const src = code(read(rel));
      for (const table of ['readiness_snapshots', 'health_samples']) {
        expect(
          src.includes(table),
          `${rel} reads ${table}. Readiness is displayed, never prescribed from.`,
        ).toBe(false);
      }
    }
  });

  it('guard 4b · the plan engine does not read the runner-reported symptom tables', () => {
    for (const rel of DECISION_FILES) {
      const src = code(read(rel));
      for (const table of ['sick_episodes', 'runner_injuries', 'niggles']) {
        expect(
          src.includes(table),
          `${rel} reads ${table}. The runner logs these for himself; the plan does not act on them.`,
        ).toBe(false);
      }
    }
  });

  it('guard 5 · the ramp brake is still FED · Rule 11, a removed input must not silently disable a guard', () => {
    // `tryAdaptiveBump` refuses to raise load within 48h of a load reduction,
    // and reads that memory out of `coach_intents`. Two of the four reasons it
    // used to watch were readiness records, deleted with the trigger. If the
    // remaining reasons are also never written, the brake is a guard reading a
    // column that can only be empty — which is exactly the failure where a
    // missing input silently ENABLES a mechanism.
    //
    // This is the only assertion in the file that points at the upward path,
    // and it is deliberately about the brake being fed, not about the ramp
    // ever firing (Rule 22 · see the header).
    const ramp = read('lib/plan/adaptive-ramp.ts');
    const block = ramp.slice(
      ramp.indexOf('export const PULLBACK_INTENT_REASONS'),
      ramp.indexOf('] as const;', ramp.indexOf('export const PULLBACK_INTENT_REASONS')),
    );
    expect(block.length, 'PULLBACK_INTENT_REASONS not found').toBeGreaterThan(20);

    const reasons = [...block.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
    expect(reasons.length, 'the brake watches nothing — it cannot brake').toBeGreaterThan(0);

    // Read the writers out of the source rather than hardcoding both sides
    // (Rule 18 §4): each surviving reason must actually be produced somewhere
    // in the adapter.
    const adapt = read('lib/plan/adapt.ts');
    for (const reason of reasons) {
      const suffix = reason.replace(/^plan_adapt_/, '');
      const written = adapt.includes(`'${reason}'`)
        || new RegExp(`plan_adapt_\\$\\{[^}]*\\}`).test(adapt) && adapt.includes(`'${suffix}'`);
      expect(
        written,
        `PULLBACK_INTENT_REASONS watches '${reason}', but nothing in lib/plan/adapt.ts writes it. `
        + 'A brake reading a reason that is never recorded is not a brake.',
      ).toBe(true);
    }
  });

  it('guard 6 · the ramp gate that replaced readiness reads TRAINING, and fails closed', () => {
    const ramp = code(read('lib/plan/adaptive-ramp.ts'));
    expect(
      ramp.includes('readinessGreen'),
      'adaptive-ramp.ts is gating an upward adaptation on readiness again. '
      + 'The bar to go UP may not be a readiness score (CLAUDE.md Rule 21).',
    ).toBe(false);
    expect(
      ramp.includes('acwrHeadroom'),
      'the ACWR headroom gate is gone. Deleting the readiness gate without a '
      + 'structural replacement makes the upward path LESS bounded, which is '
      + 'the one direction the ruling did not license.',
    ).toBe(true);
    // Rule 11: an unreadable ratio and a not-yet-computable one are two facts,
    // and both must refuse. The gate is `acwrValue != null && acwrValue < CEIL`,
    // so a null ratio cannot pass — assert the shape rather than trusting it.
    expect(ramp).toMatch(/acwrValue\s*!=\s*null\s*&&\s*acwrValue\s*<\s*ACWR_ADD_LOAD_CEILING/);
    expect(ramp).toMatch(/acwrAbsentReason/);
  });
});
