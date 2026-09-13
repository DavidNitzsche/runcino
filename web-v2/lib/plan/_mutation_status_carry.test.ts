/**
 * lib/plan/_mutation_status_carry.test.ts
 * STATUSCARRY-1 + LEDGERHONESTY-1 (2026-09-13)
 *
 * Round 6 of the archived-plan-mutation-guard review. Two findings, both
 * FALSIFIED against the round-5 tree before this file landed.
 *
 * ══ STATUSCARRY-1 · THE REFUSAL'S STATUS DID NOT SURVIVE THE LAST HOP ═══════
 *
 * `refusalFor` resolves `{ code, reason, violations, status, retryable }`. The
 * five route handlers that call it read all five. Four callers one hop back —
 * `applyReschedule`, `undoReschedule`, `applyChange`, and the two proposal
 * appliers — returned `{ code, reason, violations }` and dropped the rest.
 *
 * Six routes then re-derived the HTTP status from a `STATUS` record of their
 * own. Not one of them contained `plan_verification_failed`,
 * `ledger_unrecorded`, `duplicate` or `mutation_failed`, so three fell through
 * to `?? 400` and two to `409`.
 *
 * LIVE at the time of writing, and this is not hypothetical: migration 166 is
 * not applied to production, so `landDecisionInTransaction` refuses every
 * structural mutation, `applyReschedule` answers `plan_verification_failed`
 * where it used to answer `'rejected'` (409), and Move-a-Run therefore answers
 * **400** — "your request is malformed, do not retry" — over a transient read
 * failure that `refusalFor` itself marks `retryable: true`. The round-4 fix
 * made the backend honest; the last hop un-did it.
 *
 * ══ LEDGERHONESTY-1 · A FALSE CLAIM WRITTEN INTO A PERMANENT RECORD ═════════
 *
 * Round 5 justified refusing on a failed `loadMutationContext` read by saying a
 * null `trainingDaysPerWeek` "disables a real safety gate" — a frequency cap.
 * There is no frequency cap in `validate.ts`. The field has exactly ONE
 * consumer there, in §5, and it SKIPS the quality-coverage check when the value
 * is `<= 1`. A null therefore makes the validator STRICTER, which is the exact
 * opposite of the claim.
 *
 * That wrong sentence reached `plan_decision_ledger.explanation` and
 * `plan_mutation_rejections.violations` — durable rows, not a transient
 * response — which is the same defect class as the runner-facing sentence this
 * whole review chain started from.
 *
 * The DECISION to refuse is untouched and correct: Rule 11 carries it on its
 * own ("the read failed" is not "the value is absent"). Only the stated reason
 * changes, because a decision defended on a false premise is one nobody can
 * check.
 *
 * ══ WHAT IS FALSIFIED, AND HOW ══════════════════════════════════════════════
 *
 * Per Rule 18, no assertion below hardcodes both sides. Every route's `STATUS`
 * map and every relevant `validate.ts` constant is PARSED OUT OF THE REAL
 * SOURCE at run time, so a check cannot pass by agreeing with itself, and the
 * F2 direction claim is falsified by actually RUNNING the validator twice
 * rather than by reading a comment about it.
 *
 * ══ RULE 22 · WHAT THIS FILE CANNOT FAIL ON ═════════════════════════════════
 *
 * · A NEW route that invents its own status mapping. `ROUTES` below is a fixed
 *   pin list, not a discovery pass, exactly as `_mutation_refusal.test.ts`'s
 *   caller scan is. A discovery pass over "everything that turns a
 *   MutationOutcome into an HTTP status" does not exist and is named here as
 *   the gap rather than implied to be covered.
 * · Whether the PHONE respects `retryable`. It does not read the key at all —
 *   `SurfaceStoreV5.swift`'s `v5RefusalSettlement` keys a permanent refusal on
 *   the presence of a `refusal` string in a 4xx body, which `refusalBody` does
 *   not emit, so a `retryable: false` doctrine rejection still renders a Retry
 *   on the device. That is a real, confirmed mismatch and it is a NATIVE-side
 *   change, out of scope for a web-only branch. Named, not fixed, not covered.
 * · Whether `plan_verification_failed` is the RIGHT outcome for any given
 *   scenario. That is `_mutation_read_honesty.db.test.ts`'s claim. This file
 *   only asserts that whatever outcome is chosen is transported honestly.
 * · The `lineage-unknown:` marker's permanence. It has no repair path, by
 *   design as of round 5, and inventing one is a separate architectural
 *   question. Nothing here would notice.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  refusalFor, httpStatusForRefusal, carriedRefusal,
  type MutationRefusalCode,
} from './mutation-refusal';
import { validateComposedPlan, PlanValidationError } from './validate';
import type { ComposePlanResult, ComposedWeek, DayPlan, DOW } from './generate';

const REPO = join(__dirname, '..', '..');
const read = (rel: string) => readFileSync(join(REPO, rel), 'utf8');

/** Every code `refusalFor` can produce, taken from the resolver rather than
 *  retyped, so a new outcome cannot slip past this file unlisted. */
const ALL_OUTCOMES = [
  'rejected', 'undeclared_structural', 'plan_verification_failed',
  'no_plan', 'ledger_unwritten', 'duplicate', 'not_attempted', null,
] as const;

/* ══════════════════════════════════════════════════════════════════════════
 * STATUSCARRY-1 · part 1 · the resolver's status is the one that gets spent
 * ═══════════════════════════════════════════════════════════════════════ */

describe('STATUSCARRY-1 · httpStatusForRefusal', () => {
  it('a carried status WINS over the route-local map, always', () => {
    // The precise shape of the live regression: a route map that maps this
    // code to something else entirely must not be consulted.
    const carried = carriedRefusal(
      refusalFor({ outcome: 'plan_verification_failed', violations: [] }), 'plan_verification_failed',
    );
    expect(carried.status).toBe(503);
    expect(httpStatusForRefusal(carried, { plan_verification_failed: 418 }, 400)).toBe(503);
  });

  it('a refusal with NO status of its own still reads the route-local map', () => {
    // `reschedule.ts`'s `no_record_table` limb never goes through `refusalFor`.
    expect(httpStatusForRefusal({ code: 'no_record_table' }, { no_record_table: 503 }, 400)).toBe(503);
  });

  it('a code neither source knows falls through to the route\'s own stated default', () => {
    expect(httpStatusForRefusal({ code: 'something_new' }, { no_plan: 404 }, 409)).toBe(409);
  });

  it('carriedRefusal cannot lose status or retryable · they are not optional on its return', () => {
    for (const outcome of ALL_OUTCOMES) {
      const r = refusalFor({ outcome, violations: [] });
      const c = carriedRefusal(r, r.code);
      expect(c.status, `outcome=${String(outcome)}`).toBe(r.status);
      expect(c.retryable, `outcome=${String(outcome)}`).toBe(r.retryable);
    }
  });

  it('a caller renaming the code keeps the resolver\'s status · the rename is vocabulary, not policy', () => {
    // Three callers say `rejected` where the resolver says
    // `plan_invariant_violation`. That must not change the status.
    const r = refusalFor({ outcome: 'rejected', violations: [] });
    expect(carriedRefusal(r, 'rejected').status).toBe(r.status);
    expect(carriedRefusal(r, 'rejected').status).toBe(409);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * STATUSCARRY-1 · part 2 · THE FALSIFIER, against the real route sources
 * ═══════════════════════════════════════════════════════════════════════ */

/**
 * Parse a route's `const STATUS: Record<string, number> = { ... }` out of its
 * own source. Rule 18: read the numbers out of the thing under test rather
 * than retyping them here, or the check only proves it agrees with itself.
 */
function statusMapOf(rel: string): Record<string, number> {
  const src = read(rel);
  const at = src.indexOf('const STATUS: Record<string, number> = {');
  if (at < 0) throw new Error(`${rel}: no STATUS map found — this parser has gone stale`);
  const body = src.slice(src.indexOf('{', at) + 1, src.indexOf('};', at));
  const out: Record<string, number> = {};
  for (const line of body.split('\n')) {
    const m = line.match(/^\s*([a-z_]+)\s*:\s*(\d{3})\s*,/);
    if (m) out[m[1]] = Number(m[2]);
  }
  return out;
}

/** The routes that answer a lib-level mutation refusal over HTTP. A RATCHET:
 *  it may grow; an entry leaves only when the route does. */
const ROUTES = [
  { file: 'app/api/plan/change/route.ts', hadFallback: 400 },
  { file: 'app/api/plan/reschedule/route.ts', hadFallback: 400 },
  { file: 'app/api/plan/move/route.ts', hadFallback: 400 },
] as const;

/** The routes whose ladder is inline rather than a `STATUS` record. */
const LADDER_ROUTES = [
  'app/api/plan/replan/route.ts',
  'app/api/plan/workout-proposals/[id]/undo/route.ts',
] as const;

describe('STATUSCARRY-1 · the six downstream routes', () => {
  it('LIVENESS · every pinned route file was read and is non-empty', () => {
    let n = 0;
    for (const r of ROUTES) { expect(read(r.file).length, r.file).toBeGreaterThan(0); n++; }
    for (const f of LADDER_ROUTES) { expect(read(f).length, f).toBeGreaterThan(0); n++; }
    expect(n, 'the scan looked at nothing, which is the worst outcome available').toBe(5);
  });

  it(
    'THE BUG, REPRODUCED · every route STATUS map, read live, is BLIND to the four '
    + 'mutation-refusal codes · this is what made the old `?? 400` fire',
    () => {
      const blind: string[] = [];
      for (const r of ROUTES) {
        const map = statusMapOf(r.file);
        expect(Object.keys(map).length, `${r.file}: parsed an empty STATUS map`).toBeGreaterThan(3);
        for (const code of ['plan_verification_failed', 'ledger_unrecorded', 'duplicate', 'mutation_failed'] as const) {
          if (map[code] === undefined) blind.push(`${r.file}:${code}`);
        }
      }
      // The maps SHOULD still be blind. Adding the codes to them by hand is
      // the fix this file rejects (Rule 16 — six hand-kept copies). The point
      // is that the map is no longer the thing consulted.
      expect(blind.length, 'a route added a mutation-refusal code to its own map by hand').toBe(12);
    },
  );

  it(
    'THE FIX · for every outcome, the carried status is what the routes now answer, '
    + 'and it DIFFERS from what their own maps would have said',
    () => {
      const moved = new Map<string, string>();
      for (const r of ROUTES) {
        const map = statusMapOf(r.file);
        for (const outcome of ALL_OUTCOMES) {
          const refusal = refusalFor({ outcome, violations: [] });
          const carried = carriedRefusal(
            refusal, refusal.code === 'plan_invariant_violation' ? 'rejected' : refusal.code,
          );
          const now = httpStatusForRefusal(carried, map, r.hadFallback);
          const before = map[carried.code] ?? r.hadFallback;   // the old expression, verbatim
          expect(now, `${r.file} · ${String(outcome)}`).toBe(refusal.status);
          if (now !== before) moved.set(`${carried.code}`, `${before} -> ${now}`);
        }
      }
      /* Every code whose answer this fix CHANGES, and to what. Written out
       * rather than counted, because a bare number would not have caught the
       * `no_plan` row — a real behaviour change beyond the reported finding,
       * and one this branch is deliberately taking (Rule 16: `refusalFor` is
       * the single owner of a mutation refusal's status, the five routes that
       * already call it directly have answered 409 for `no_plan` all along,
       * and these three maps were the second answer). Only a `no_plan` raised
       * BY `mutatePlan` moves; each module's own "there is no active plan"
       * early return carries no status and still reads the map's 404. */
      expect(Object.fromEntries([...moved].sort())).toEqual({
        duplicate: '400 -> 409',
        ledger_unrecorded: '400 -> 503',
        mutation_failed: '400 -> 503',
        no_plan: '404 -> 409',
        plan_verification_failed: '400 -> 503',
      });
    },
  );

  it(
    'THE REGRESSION THE REVIEW MEASURED · a Move-a-Run refused by an unapplied '
    + 'migration answers 503 and retryable, not 400',
    () => {
      // `landDecisionInTransaction` refuses -> `mutatePlan` -> `applyReschedule`
      // -> `applyMove` -> `/api/plan/move`.
      const refusal = refusalFor({ outcome: 'plan_verification_failed', violations: ['ledger table absent'] }, { thing: 'That move' });
      const carried = carriedRefusal(refusal, refusal.code);
      const map = statusMapOf('app/api/plan/move/route.ts');
      expect(map[carried.code], 'the map knows this code, so the finding is stale').toBeUndefined();
      expect(map[carried.code] ?? 400, 'the pre-fix answer').toBe(400);
      expect(httpStatusForRefusal(carried, map, 400), 'the post-fix answer').toBe(503);
      expect(carried.retryable).toBe(true);
    },
  );

  for (const r of ROUTES) {
    it(`${r.file} · no longer keys an HTTP status off a raw map lookup`, () => {
      const src = read(r.file);
      expect(src, `${r.file} does not import the shared status resolver`)
        .toContain("httpStatusForRefusal");
      // The exact pre-fix expressions, in code (comments quoting them are how
      // this work documents itself).
      const code = src.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
      expect(code, `${r.file} re-derives a status from its own map again`)
        .not.toContain('STATUS[out.code] ??');
      expect(code, `${r.file} re-derives a status from its own map again`)
        .not.toContain('STATUS[rec.code] ??');
    });
  }

  for (const f of LADDER_ROUTES) {
    it(`${f} · its inline ladder no longer swallows a carried status`, () => {
      const src = read(f);
      expect(src, `${f} does not import the shared status resolver`).toContain('httpStatusForRefusal');
      const code = src.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
      // Both ladders ended in a bare `: 409`, which is what swallowed the 503s.
      expect(code, `${f} still ends its status ladder in a bare 409`)
        .not.toMatch(/\n\s*:\s*409;/);
    });
  }
});

/* ══════════════════════════════════════════════════════════════════════════
 * STATUSCARRY-1 · part 3 · the four lib callers carry it
 * ═══════════════════════════════════════════════════════════════════════ */

/** The four modules that CALL `refusalFor` and return rather than respond.
 *  These are the callers the review found dropping `status`/`retryable`. */
const CARRYING_CALLERS = [
  'lib/plan/reschedule.ts',
  'lib/plan/replan-scenarios.ts',
  'lib/brain/proposal/accept.ts',
  'lib/brain/proposal/undo-apply.ts',
] as const;

/** A module that FORWARDS a carrying caller's refusal without calling the
 *  resolver itself. One more hop the distinction has to survive. */
const FORWARDING_CALLERS = ['lib/brain/orchestration/move-orchestrator.ts'] as const;

describe('STATUSCARRY-1 · source · the hop that dropped it', () => {
  it('LIVENESS · every carrying and forwarding caller was read', () => {
    let n = 0;
    for (const f of [...CARRYING_CALLERS, ...FORWARDING_CALLERS]) {
      expect(read(f).length, f).toBeGreaterThan(0); n++;
    }
    expect(n).toBe(5);
  });

  for (const f of FORWARDING_CALLERS) {
    it(`${f} · forwards status and retryable on every refusal limb`, () => {
      const src = read(f);
      expect(src, `${f} dropped \`status\` from its refusal type`).toMatch(/status\?:\s*409 \| 503/);
      expect(src, `${f} dropped \`retryable\` from its refusal type`).toMatch(/retryable\?:\s*boolean/);
      // Both limbs — apply and undo — must forward, not just one.
      const forwards = [...src.matchAll(/status:\s*\w+\.status/g)].length;
      expect(
        forwards,
        `${f} forwards a status on ${forwards} limb(s); applyMove and undoMove are two`,
      ).toBeGreaterThanOrEqual(2);
    });
  }

  for (const f of CARRYING_CALLERS) {
    it(`${f} · its refusal type declares status AND retryable`, () => {
      const src = read(f);
      expect(src, `${f} dropped \`status\` from its refusal type again`).toMatch(/status\?*:\s*(409 \| 503|number)/);
      expect(src, `${f} dropped \`retryable\` from its refusal type again`).toMatch(/retryable\?*:\s*boolean/);
    });

    it(`${f} · EVERY refusalFor call site carries both fields, not just one of them`, () => {
      const src = read(f);
      /* PER SITE, not per file. A whole-file check passes as soon as ONE of
       * two call sites carries the fields, which is exactly the half-fix this
       * round is correcting — `reschedule.ts` has two, and falsifying only the
       * first one slipped past the file-level version of this assertion. */
      const sites: number[] = [];
      for (let i = src.indexOf('refusalFor('); i >= 0; i = src.indexOf('refusalFor(', i + 1)) {
        // Skip the import statement and any prose that names the function.
        const lineStart = src.lastIndexOf('\n', i) + 1;
        const line = src.slice(lineStart, src.indexOf('\n', i));
        if (/^\s*(import|\*|\/\/)/.test(line)) continue;
        sites.push(i);
      }
      expect(sites.length, `${f} no longer calls refusalFor at all`).toBeGreaterThan(0);
      for (const at of sites) {
        // The return statement that spends this refusal. 900 chars covers the
        // longest of them (`undoReschedule`'s, with its two-branch reason).
        const after = src.slice(at, at + 900);
        const carries = after.includes('carriedRefusal(')
          || (/status:/.test(after) && /retryable:/.test(after));
        expect(
          carries,
          `${f} at char ${at}: this refusalFor result is returned without status/retryable, `
          + 'so the distinction dies on this hop again. Use carriedRefusal().',
        ).toBe(true);
      }
    });
  }
});

/* ══════════════════════════════════════════════════════════════════════════
 * LEDGERHONESTY-1 · the claim, falsified by RUNNING the validator
 * ═══════════════════════════════════════════════════════════════════════ */

/** One QUALITY-phase week, in the future, with no quality day in it. The
 *  minimum shape §5 has an opinion about. */
function weekWithNoQuality(startISO: string): ComposedWeek {
  const day = (dow: DOW, type: DayPlan['type'], mi: number, isLong = false): DayPlan => ({
    dow, type, distanceMi: mi, isQuality: false, isLong, subLabel: null, notes: '',
  });
  return {
    startISO,
    phase: 'QUALITY',
    weeklyMi: 24,
    isRaceWeek: false,
    days: [
      day(1, 'easy', 5), day(2, 'easy', 5), day(3, 'rest', 0),
      day(4, 'easy', 5), day(5, 'rest', 0), day(6, 'easy', 3),
      day(0, 'long', 6, true),
    ],
  };
}

function planOf(week: ComposedWeek): ComposePlanResult {
  return {
    weeks: [week],
    blocks: { totalWeeks: 1, phases: [{ label: 'QUALITY', weeks: 1, rationale: '', citation: '' }] },
    totalWeeks: 1,
    vols: [week.weeklyMi],
    authoredState: {},
  };
}

/** Every violation the validator raised, or [] when it raised none. */
function violationsFor(trainingDaysPerWeek: number | null): string[] {
  const week = weekWithNoQuality('2099-01-04');
  try {
    validateComposedPlan(planOf(week), 13.1, 'race-prep', {
      level: 'intermediate',
      isSteppingStoneToMarathon: false,
      priorPlanPeakLongMi: null,
      todayISO: '2099-01-01',
      trailingAvgWeeklyMi: null,
      trainingDaysPerWeek,
      qualityStrandedByAvailability: false,
      recentWeeklyMi: 24,
    });
    return [];
  } catch (e) {
    if (e instanceof PlanValidationError) return e.violations;
    throw e;
  }
}

const NO_QUALITY = /no quality sessions prescribed/;

describe('LEDGERHONESTY-1 · a null trainingDaysPerWeek makes the validator STRICTER', () => {
  it(
    'THE FALSIFIER · the same plan PASSES §5 at trainingDaysPerWeek=1 and FAILS it at null · '
    + 'the round-5 claim that null "disables a safety gate" has the direction backwards',
    () => {
      const atOne = violationsFor(1);
      const atNull = violationsFor(null);
      expect(
        atOne.some((v) => NO_QUALITY.test(v)),
        'a 1-day-a-week runner is meant to be EXEMPT from §5 — if this fires, the '
        + 'skip has been removed and this whole finding needs rewriting',
      ).toBe(false);
      expect(
        atNull.some((v) => NO_QUALITY.test(v)),
        'a null trainingDaysPerWeek must let §5 fire · that is what makes it the STRICTER '
        + 'reading, not the more permissive one',
      ).toBe(true);
    },
  );

  it('and there is no frequency cap for a null to disable · exactly one consumer, and it is a skip', () => {
    const src = read('lib/plan/validate.ts');
    const uses = src.split('\n')
      .map((l, i) => [i + 1, l] as const)
      .filter(([, l]) => l.includes('ctx.trainingDaysPerWeek'));
    expect(
      uses.length,
      'trainingDaysPerWeek gained a second consumer in validate.ts. If it is a cap, the '
      + `refusal explanations may finally say so; check it: ${uses.map(([n]) => n).join(', ')}`,
    ).toBe(1);
    expect(uses[0][1], 'the one consumer is no longer a skip').toContain('continue');
    expect(uses[0][1]).toContain('<= 1');
  });

  it('nor is 26.2 the loosest long-run cap row · ultra is looser, read out of validate.ts', () => {
    const src = read('lib/plan/validate.ts');
    const capOf = (label: string) => {
      const m = src.match(new RegExp(`case '${label}':\\s*return (\\d+);`));
      if (!m) throw new Error(`longRunCapMi: no '${label}' row found — this parser has gone stale`);
      return Number(m[1]);
    };
    const marathon = capOf('m');
    const ultra = capOf('ultra');
    expect(capOf('5k'), 'liveness · the parser read a real table').toBeGreaterThan(0);
    expect(
      ultra,
      'the review\'s finding was that ultra is looser than the 26.2 fallback. If this '
      + 'flips, the corrected comments in mutate.ts need revisiting.',
    ).toBeGreaterThan(marathon);
    // And the fallback IS looser than every shorter row, which is the half of
    // the original claim that was true and is kept.
    expect(marathon).toBeGreaterThan(capOf('5k'));
    expect(marathon).toBeGreaterThan(capOf('10k'));
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * LEDGERHONESTY-1 · the PERSISTED strings say the true thing
 * ═══════════════════════════════════════════════════════════════════════ */

/** Strings that reach a durable row and used to carry the false claim. */
const FALSE_CLAIM = [
  'no weekly-frequency cap at all',
  'no frequency cap at all',
  'NO CAP AT ALL',
  'STRICTLY MORE PERMISSIVE',
  'maximally permissive fallbacks',
];

describe('LEDGERHONESTY-1 · what lands in plan_decision_ledger and plan_mutation_rejections', () => {
  const src = read('lib/plan/mutate.ts');

  /** `mutate.ts` documents its own history in comments, and per Rule 18 an
   *  absence-only assertion over the whole file would be satisfied by garbage.
   *  So the scan is on the STRING LITERALS the code actually persists. */
  function persistedStrings(): string {
    return src
      .split('\n')
      .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
      .join('\n');
  }

  it('LIVENESS · mutate.ts was read and both persisted sites are present', () => {
    expect(src.length).toBeGreaterThan(1000);
    expect(src, 'PLAN_VERIFICATION_REASON is gone — this scan is now about nothing')
      .toContain('const PLAN_VERIFICATION_REASON');
    expect(src, "the mutation-context ledger branch is gone").toContain("why === 'mutation-context'");
  });

  for (const claim of FALSE_CLAIM) {
    it(`the false claim "${claim}" is not written into any persisted string`, () => {
      expect(
        persistedStrings().includes(claim),
        `mutate.ts persists the claim "${claim}". validate.ts has no frequency cap and `
        + 'ultra\'s long-run cap is looser than the 26.2 fallback, so this is a false '
        + 'statement in a durable record.',
      ).toBe(false);
    });
  }

  it(
    'and the two persisted sentences say what actually happened · '
    + 'an absence-only assertion is satisfied by garbage (Rule 18)',
    () => {
      const at = src.indexOf("'mutation-context':", src.indexOf('const PLAN_VERIFICATION_REASON'));
      expect(at, 'the mutation-context reason is gone from the registry').toBeGreaterThan(0);
      const reason = src.slice(at, src.indexOf('};', at));
      expect(reason, 'the persisted reason no longer says the read failed').toContain('read itself failed');
      expect(reason).toContain('never established');
      expect(reason, 'it must not claim the check ran').toContain('it was not run');

      const lAt = src.indexOf("? 'the validator context for this mutation could not be read");
      expect(lAt, 'the ledger explanation for mutation-context is gone').toBeGreaterThan(0);
      const explanation = src.slice(lAt, src.indexOf('Rule 11).', lAt));
      expect(explanation).toContain('read failed');
      expect(explanation).toContain('never established for this runner');
      expect(explanation, 'the ledger explanation must not name a cap it cannot name')
        .not.toContain('frequency cap');
    },
  );
});
