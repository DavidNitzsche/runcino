/**
 * THE ACTION COMPLETENESS GATE · ACTIONCOMPLETE-1 (2026-09-05).
 *
 * ══════════════════════════════════════════════════════════════════════════
 * WHAT THIS ASSERTS
 *
 * That every one of the twenty-one `BrainAction` kinds has ALL ELEVEN of the
 * things a lever needs before it is real — generator, validator, serializer,
 * renderer, explanation, accept executor, mutation, ledger writer, undo
 * posture, watch behaviour, integration test — or a ratchet entry in
 * `facets.ts` saying which one is missing and why.
 *
 * `_action_schema_gate.test.ts` next door proves every kind maps to writes and
 * draws a headline, and states in its own Rule 22 note exactly what it cannot
 * see: "Whether anything ever RAISES these actions. A union nobody constructs
 * is still fully covered here." This is that question.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * WHAT THIS GATE CANNOT FAIL ON (Rule 22)
 *
 * · WHETHER ANY FACET IS ANY GOOD. It proves a renderer exists, never that the
 *   sentence is right; that an executor is named, never that it applies the
 *   change correctly; that a generator can construct the kind, never that
 *   constructing it was the right coaching call.
 * · WHETHER THE LIVE CALLER IS ACTUALLY REACHED IN PRODUCTION. The generator
 *   check is a STATIC IMPORT EDGE from a file the registry names. A caller that
 *   is itself dead — a cron nobody schedules, a route nobody calls — passes
 *   clean. Rule 19 is the standing reminder that green is not deployed.
 * · WHETHER A GENERATOR EVER FIRES FOR A REAL RUNNER. Rule 21's higher bar
 *   ("compute what the runner would have had to DO to trigger it, then check
 *   whether any week they have actually run would have") needs production
 *   history and cannot run here. A generator wired to a condition no runner
 *   ever meets passes every assertion below.
 * · A FACET NOBODY THOUGHT OF. Eleven is a list somebody wrote down.
 * · THE NATIVE SIDE. Swift is not in this process, so "the phone draws it" is
 *   asserted only as far as the wire.
 * · A RATCHET ENTRY WHOSE REASON IS FALSE. It can tell a stale entry from a
 *   live one; it cannot tell a true sentence from a plausible one.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * LIVENESS (Rule 18 point 2)
 *
 * Every scan below reports how many cells it examined and fails on zero. The
 * source-arm scans read the real files off disk and fail if a file is missing
 * or empty, because a gate that reports clean because it looked at nothing is
 * the worst outcome available — it also reports confidence.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

import {
  ALL_ACTION_KINDS,
  ACTION_SCHEMA_VERSION,
  type ActionKind,
  type BrainAction,
} from './action';
import { plannedWrites, isNonMutatingKind } from './execute';
import { validateAction } from './validate';
import { serializeAction, deserializeAction } from './serialize';
import { undoWritesFor } from './undo';
import { ledgerFacetsOf } from './ledger-facet';
import { watchBehaviorOf, watchIsApplicable } from './watch-facet';
import { executorFor } from './executor-map';
import { phoneDirectionOf, actionHeadline } from '@/lib/faff/v5-action-render';
import {
  ALL_FACETS,
  FACET_GAPS,
  FACET_OWNER_FILE,
  GENERATOR_REGISTRY,
  facetGapFor,
  facetCoverage,
  type Facet,
} from './facets';
import {
  LEDGER_DECISIONS,
  LEDGER_LEVERS,
  LEDGER_SCOPES,
} from '@/lib/brain/ledger/ledger-entry';
import { actionFromProgression } from './generate/from-progression';
import { actionFromAdaptation } from './generate/from-adaptation';
import { actionFromReprice } from './generate/from-reprice';
import { refusalFromSeal, holdFor } from './generate/from-seal';
import { safetyStopFrom } from './generate/from-safety';

/** `web-v2/`, so the registry's repo-relative paths resolve. */
const WEB = join(__dirname, '..', '..', '..');

const BEFORE = {
  planWorkoutId: 'pw_1',
  dateISO: '2026-09-22',
  type: 'tempo',
  distanceMi: 9.5,
  paceTargetSecPerMi: 430,
  planVersion: 'v7',
} as const;

const base = { schemaVersion: ACTION_SCHEMA_VERSION, before: [BEFORE] } as const;

/**
 * One specimen per kind, typed as a TOTAL Record so the compiler is the first
 * gate: a new kind cannot be added to the union without a specimen appearing
 * here, and a specimen that is not exercised is caught by the count assertion.
 *
 * Every specimen is deliberately WELL FORMED and FULLY RECORDED. That is the
 * best case, and the best case is the right question for a completeness gate:
 * it measures whether a facet CAN work, not whether a degraded row happens to.
 */
const SPECIMENS: Record<ActionKind, BrainAction> = {
  PACE_CHANGE: { ...base, kind: 'PACE_CHANGE', direction: 'MORE', lever: 'THRESHOLD', to: { unit: 'sec_per_mi', value: 424 } },
  DISTANCE_CHANGE: { ...base, kind: 'DISTANCE_CHANGE', direction: 'MORE', to: { unit: 'mi', value: 11 } },
  DURATION_CHANGE: { ...base, kind: 'DURATION_CHANGE', direction: 'LESS', to: { unit: 'min', value: 50 } },
  REPETITION_CHANGE: { ...base, kind: 'REPETITION_CHANGE', direction: 'MORE', to: { unit: 'reps', value: 6 } },
  RECOVERY_INTERVAL_CHANGE: { ...base, kind: 'RECOVERY_INTERVAL_CHANGE', direction: 'MORE', to: { unit: 'min', value: 2 } },
  QUALITY_DOSE_CHANGE: { ...base, kind: 'QUALITY_DOSE_CHANGE', direction: 'MORE', lever: 'THRESHOLD', to: { unit: 'min', value: 24 } },
  LONG_RUN_STRUCTURE_CHANGE: { ...base, kind: 'LONG_RUN_STRUCTURE_CHANGE', direction: 'MORE', to: 'threshold', describe: 'last 6 at marathon pace' },
  WORKOUT_TYPE_CHANGE: { ...base, kind: 'WORKOUT_TYPE_CHANGE', direction: 'LESS', to: 'easy' },
  ADD_WORKOUT: { ...base, before: [], kind: 'ADD_WORKOUT', direction: 'MORE', dateISO: '2026-09-24', type: 'easy', distanceMi: 5 },
  REMOVE_WORKOUT: { ...base, kind: 'REMOVE_WORKOUT', direction: 'LESS' },
  FREQUENCY_CHANGE: { ...base, kind: 'FREQUENCY_CHANGE', direction: 'LESS', to: { unit: 'count', value: 5 } },
  RESCHEDULE: { ...base, kind: 'RESCHEDULE', direction: 'NEUTRAL', toDateISO: '2026-09-23', swapWithId: null },
  COORDINATED: {
    ...base, kind: 'COORDINATED', direction: 'MORE', describe: 'the block moves to faster paces',
    parts: [{ ...base, kind: 'PACE_CHANGE', direction: 'MORE', lever: 'THRESHOLD', to: { unit: 'sec_per_mi', value: 424 } }],
  },
  RACE_TARGET_CHANGE: { ...base, kind: 'RACE_TARGET_CHANGE', direction: 'MORE', raceSlug: 'cim-2026', toSecPerMi: 412 },
  TAPER_CHANGE: { ...base, kind: 'TAPER_CHANGE', direction: 'LESS', describe: 'the final week comes down further' },
  RECOVERY_CHANGE: { ...base, kind: 'RECOVERY_CHANGE', direction: 'LESS', describe: 'a rest day goes in before the long run' },
  CONDITIONAL: { ...base, kind: 'CONDITIONAL', direction: 'MORE', defaultTo: { unit: 'mi', value: 5.5 }, earnedTo: { unit: 'mi', value: 7 }, assessOnISO: '2026-09-20' },
  FIELD_TEST: { ...base, kind: 'FIELD_TEST', direction: 'NEUTRAL', describe: 'a 3 mile time trial' },
  HOLD: { ...base, kind: 'HOLD', direction: 'NEUTRAL', because: 'one hard week is not evidence' },
  REFUSAL: { ...base, kind: 'REFUSAL', direction: 'NEUTRAL', because: 'the HR trace is not credible' },
  SAFETY_STOP: { ...base, kind: 'SAFETY_STOP', direction: 'STOP', because: 'escalating pain reported', until: null },
};


/** Read a registry-named file, failing loudly rather than scanning nothing. */
function readOwned(rel: string): string {
  const p = join(WEB, rel);
  if (!existsSync(p)) throw new Error(`the gate names ${rel} and it does not exist`);
  const body = readFileSync(p, 'utf8');
  if (body.trim().length === 0) throw new Error(`${rel} is empty; the gate would scan nothing`);
  return body;
}

/** Does this file carry a switch arm for this kind? */
function hasArm(body: string, kind: ActionKind): boolean {
  return body.includes(`case '${kind}':`);
}

/**
 * Every module reachable by a static import from `startRel`, within `maxDepth`.
 *
 * TRANSITIVE on purpose. `lib/plan/adaptation-authority.ts` reaches the
 * progression generator through `from-adaptation.ts`, and a one-hop check would
 * have called that generator unreachable and forced the registry to name a
 * library file as its "live caller" — which is precisely the weakening this
 * field exists to prevent. Rule 19 was earned by a one-hop check: the import
 * that kept `main` undeployed for a day was three deep and dynamic.
 *
 * Resolves `@/…` and relative specifiers only. A package import is not a path
 * into this repo and is skipped rather than guessed at.
 */
function reachableModules(startRel: string, maxDepth = 6): Map<string, string> {
  const seen = new Map<string, string>();
  /* BREADTH FIRST, not depth first, and that is not a style choice. A
   * depth-first walk marks a module visited at whatever depth it happens to
   * reach it, so a file found down a long branch is recorded at that depth and
   * its own imports are never walked — which is exactly how the first cut of
   * this function reported `from-progression.ts` unreachable from a cron that
   * reaches it in three hops. BFS records every module at its MINIMUM depth. */
  const queue: Array<{ rel: string; depth: number }> = [{ rel: startRel, depth: 0 }];
  while (queue.length > 0) {
    const { rel, depth } = queue.shift()!;
    if (depth > maxDepth || seen.has(rel)) continue;
    const p = join(WEB, rel);
    if (!existsSync(p)) continue;
    const body = readFileSync(p, 'utf8');
    seen.set(rel, body);
    for (const m of body.matchAll(/from\s+'([^']+)'|import\(\s*'([^']+)'\s*\)/g)) {
      const spec = m[1] ?? m[2];
      if (spec === undefined) continue;
      let next: string | null = null;
      if (spec.startsWith('@/')) next = spec.slice(2);
      else if (spec.startsWith('./') || spec.startsWith('../')) {
        const dir = rel.split('/').slice(0, -1);
        for (const part of spec.split('/')) {
          if (part === '.') continue;
          else if (part === '..') dir.pop();
          else dir.push(part);
        }
        next = dir.join('/');
      }
      if (next === null) continue;
      // A specifier carries no extension in this codebase's style.
      for (const cand of [`${next}.ts`, `${next}.tsx`, `${next}/index.ts`, next]) {
        if (existsSync(join(WEB, cand))) { queue.push({ rel: cand, depth: depth + 1 }); break; }
      }
    }
  }
  return seen;
}

/* ══════════════════════════════════════════════════════════════════════════
 * GUARD 0 · THE MATRIX IS COMPLETE AND THE RATCHET IS WELL FORMED
 * ═══════════════════════════════════════════════════════════════════════ */

describe('GUARD 0 · the completeness matrix covers every kind and every facet', () => {
  it('exercises every kind in the union, with a specimen each', () => {
    const covered = Object.keys(SPECIMENS) as ActionKind[];
    expect(covered.length).toBe(ALL_ACTION_KINDS.length);
    expect(covered.length).toBeGreaterThan(0);
    for (const k of ALL_ACTION_KINDS) expect(covered, `${k} has no specimen`).toContain(k);
  });

  it('every specimen is itself valid, so a failure downstream is the facet and not the fixture', () => {
    let checked = 0;
    for (const kind of ALL_ACTION_KINDS) {
      const v = validateAction(SPECIMENS[kind]);
      expect(v.ok, `the ${kind} specimen is malformed: ${v.ok ? '' : v.refusals.join('; ')}`).toBe(true);
      checked += 1;
    }
    expect(checked).toBe(ALL_ACTION_KINDS.length);
  });

  it('names a real owning file for every facet', () => {
    let checked = 0;
    for (const facet of ALL_FACETS) {
      const rel = FACET_OWNER_FILE[facet];
      const p = join(WEB, rel);
      expect(existsSync(p), `${facet} names ${rel}, which does not exist`).toBe(true);
      checked += 1;
    }
    expect(checked).toBe(ALL_FACETS.length);
  });

  it('every ratchet entry names a real kind, a real facet and an argued reason', () => {
    expect(FACET_GAPS.length, 'the ratchet is empty; either the matrix is complete (say so) or the list was lost')
      .toBeGreaterThan(0);
    for (const g of FACET_GAPS) {
      expect(ALL_ACTION_KINDS, `gap names unknown kind ${g.kind}`).toContain(g.kind);
      expect(ALL_FACETS, `gap names unknown facet ${g.facet}`).toContain(g.facet as Facet);
      // "Not built yet" is not a reason. A gap has to say what would close it.
      expect(g.because.length, `${g.kind}/${g.facet} has no argued reason`).toBeGreaterThan(80);
    }
  });

  it('has no duplicate ratchet entries', () => {
    const seen = new Set<string>();
    for (const g of FACET_GAPS) {
      const key = `${g.kind}/${g.facet}`;
      expect(seen.has(key), `${key} is listed twice`).toBe(false);
      seen.add(key);
    }
  });

  it('reports its own coverage rather than only passing', () => {
    const c = facetCoverage(ALL_ACTION_KINDS);
    expect(c.cells).toBe(ALL_ACTION_KINDS.length * ALL_FACETS.length);
    expect(c.gaps).toBe(FACET_GAPS.length);
    expect(c.present).toBe(c.cells - c.gaps);
    // Liveness: a matrix that has stopped being mostly filled is a regression
    // worth failing on, not a number to notice later.
    expect(c.present).toBeGreaterThan(c.cells * 0.85);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * GUARD 1 · EVERY FACET, PROVED PRESENT OR PROVED ABSENT
 *
 * Each block runs over all 21 kinds. For a kind with no ratchet entry the facet
 * must be demonstrably there; for a kind WITH one the facet must be
 * demonstrably missing, which is what makes a stale entry fail.
 * ═══════════════════════════════════════════════════════════════════════ */

describe('GUARD 1 · VALIDATOR · every kind is checked for coherence', () => {
  it('has a validation arm and refuses a corrupted specimen', () => {
    const body = readOwned(FACET_OWNER_FILE.VALIDATOR);
    let checked = 0;
    for (const kind of ALL_ACTION_KINDS) {
      const gap = facetGapFor(kind, 'VALIDATOR');
      const armed = hasArm(body, kind);
      if (gap) {
        expect(armed, `STALE RATCHET · ${kind} has a VALIDATOR gap and validate.ts now handles it`).toBe(false);
        continue;
      }
      expect(armed, `${kind} has no arm in validate.ts and no ratchet entry`).toBe(true);
      checked += 1;
    }
    expect(checked, 'the validator scan examined no kinds').toBeGreaterThan(0);
  });

  it('actually refuses, rather than passing everything it is handed', () => {
    // Falsification in-line (Rule 18): a validator that never says no is not a
    // validator. Every kind is handed a specimen with its schema version
    // corrupted, which is the one refusal that applies to all of them.
    let refused = 0;
    for (const kind of ALL_ACTION_KINDS) {
      const broken = { ...SPECIMENS[kind], schemaVersion: 99 } as unknown as BrainAction;
      const v = validateAction(broken);
      expect(v.ok, `${kind} passed validation with a foreign schema version`).toBe(false);
      refused += 1;
    }
    expect(refused).toBe(ALL_ACTION_KINDS.length);
  });
});

describe('GUARD 1 · SERIALIZER · every kind survives the database', () => {
  it('round-trips through jsonb without losing or inventing a field', () => {
    let checked = 0;
    for (const kind of ALL_ACTION_KINDS) {
      const gap = facetGapFor(kind, 'SERIALIZER');
      const wire = JSON.parse(JSON.stringify(serializeAction(SPECIMENS[kind])));
      const back = deserializeAction(wire);
      if (gap) {
        expect(back, `STALE RATCHET · ${kind} has a SERIALIZER gap and now round-trips`).toBeNull();
        continue;
      }
      expect(back, `${kind} does not survive serialization`).not.toBeNull();
      // The WHOLE object, not a field list: a member that grows a field the
      // reader does not know about is caught here and nowhere else.
      expect(back, `${kind} lost or changed a field in the round trip`).toEqual(SPECIMENS[kind]);
      checked += 1;
    }
    expect(checked, 'the serializer scan examined no kinds').toBeGreaterThan(0);
  });

  it('refuses a payload it cannot fully read rather than returning a partial action', () => {
    expect(deserializeAction({ v: 1, action: { kind: 'PACE_CHANGE', direction: 'MORE', before: [] } })).toBeNull();
    expect(deserializeAction({ v: 99, action: SPECIMENS.HOLD })).toBeNull();
    expect(deserializeAction(null)).toBeNull();
    expect(deserializeAction({ v: 1, action: { kind: 'A_KIND_THIS_BUILD_DOES_NOT_HAVE', direction: 'MORE', before: [] } })).toBeNull();
  });

  it('preserves the three-state before, which is what stops every card reading stale', () => {
    const unrecorded: BrainAction = {
      ...base, kind: 'DISTANCE_CHANGE', direction: 'LESS',
      before: [{ planWorkoutId: 'pw_1' }], to: { unit: 'mi', value: 5 },
    };
    const recordedNull: BrainAction = {
      ...base, kind: 'DISTANCE_CHANGE', direction: 'LESS',
      before: [{ planWorkoutId: 'pw_1', distanceMi: null }], to: { unit: 'mi', value: 5 },
    };
    const a = deserializeAction(JSON.parse(JSON.stringify(serializeAction(unrecorded))));
    const b = deserializeAction(JSON.parse(JSON.stringify(serializeAction(recordedNull))));
    expect(a!.before[0]).not.toHaveProperty('distanceMi');
    expect(b!.before[0].distanceMi).toBeNull();
  });
});

describe('GUARD 1 · RENDERER · every kind knows which way the card draws', () => {
  const DRAWABLE = ['push', 'hold', 'pull_back', 'move', 'recovery', 'stop'];

  it('resolves to a direction the phone can draw', () => {
    let checked = 0;
    for (const kind of ALL_ACTION_KINDS) {
      const gap = facetGapFor(kind, 'RENDERER');
      const dir = phoneDirectionOf(SPECIMENS[kind]);
      if (gap) {
        expect(DRAWABLE, `STALE RATCHET · ${kind} has a RENDERER gap and now draws`).not.toContain(dir);
        continue;
      }
      expect(DRAWABLE, `${kind} produced direction "${dir}", which no card can draw`).toContain(dir);
      checked += 1;
    }
    expect(checked, 'the renderer scan examined no kinds').toBeGreaterThan(0);
  });

  it('keeps the two judgement calls the surface depends on', () => {
    // Prescribed easing is not a pull-back, and a field test is not a retreat.
    expect(phoneDirectionOf(SPECIMENS.TAPER_CHANGE)).toBe('recovery');
    expect(phoneDirectionOf(SPECIMENS.RECOVERY_CHANGE)).toBe('recovery');
    expect(phoneDirectionOf(SPECIMENS.FIELD_TEST)).toBe('push');
    expect(phoneDirectionOf(SPECIMENS.SAFETY_STOP)).toBe('stop');
  });
});

describe('GUARD 1 · EXPLANATION · every kind gives the runner a sentence', () => {
  it('has a headline arm and produces a distinct, clean sentence', () => {
    const body = readOwned(FACET_OWNER_FILE.EXPLANATION);
    const seen = new Map<string, ActionKind>();
    let checked = 0;
    for (const kind of ALL_ACTION_KINDS) {
      const gap = facetGapFor(kind, 'EXPLANATION');
      const armed = hasArm(body, kind);
      if (gap) {
        expect(armed, `STALE RATCHET · ${kind} has an EXPLANATION gap and now has a headline arm`).toBe(false);
        continue;
      }
      expect(armed, `${kind} has no headline arm and no ratchet entry`).toBe(true);
      const head = actionHeadline(SPECIMENS[kind], 'Tuesday');
      expect(head.trim().length, `${kind} has an empty headline`).toBeGreaterThan(0);
      expect(head, `${kind}'s headline leaked an engine value`).not.toMatch(/undefined|NaN|\[object|_CHANGE/);
      // Rule 17 and the coach voice, on strings composed at run time — which is
      // exactly the shape check-coach-voice.sh cannot see, because it scans
      // files and these sentences are built from evidence.
      expect(head, `${kind}'s headline uses a dash the coach voice does not`).not.toMatch(/[—–]/);
      expect(head, `${kind}'s headline shouts`).not.toContain('!');
      expect(head.length, `${kind}'s headline is a paragraph, not a card line`).toBeLessThan(90);
      // Two kinds sharing one sentence means the runner cannot tell them apart.
      const clash = seen.get(head);
      expect(clash, `${kind} and ${clash} produce the identical headline "${head}"`).toBeUndefined();
      seen.set(head, kind);
      checked += 1;
    }
    expect(checked, 'the explanation scan examined no kinds').toBeGreaterThan(0);
  });

  it('states a dose in the unit it was decided in', () => {
    // The defect this pins, found by driving the progression generator through
    // the renderer: QUALITY_DOSE_CHANGE printed fmtMi whatever the unit said,
    // so a dose resolved in MINUTES rendered as "24.0 mi".
    const inMinutes = actionHeadline(SPECIMENS.QUALITY_DOSE_CHANGE, 'Tuesday');
    expect(inMinutes).toContain('24 minutes');
    expect(inMinutes, 'a dose in minutes rendered as a distance').not.toMatch(/\bmi\b/);
    const inMiles = actionHeadline(
      { ...SPECIMENS.QUALITY_DOSE_CHANGE, to: { unit: 'mi', value: 6 } } as BrainAction, 'Tuesday');
    expect(inMiles).toMatch(/\bmi\b/);
  });
});

describe('GUARD 1 · MUTATION · every kind resolves to writes or is non-mutating out loud', () => {
  it('produces real writes, or a stated reason for none', () => {
    const body = readOwned(FACET_OWNER_FILE.MUTATION);
    let checked = 0;
    for (const kind of ALL_ACTION_KINDS) {
      const gap = facetGapFor(kind, 'MUTATION');
      const armed = hasArm(body, kind);
      if (gap) {
        expect(armed, `STALE RATCHET · ${kind} has a MUTATION gap and now has an arm`).toBe(false);
        continue;
      }
      expect(armed, `${kind} has no arm in execute.ts and no ratchet entry`).toBe(true);
      const plan = plannedWrites(SPECIMENS[kind]);
      if (plan.nonMutating) {
        expect(isNonMutatingKind(kind), `${kind} produced no writes and is not a declared non-mutating kind`).toBe(true);
        expect(plan.because.length, `${kind} wrote nothing without saying why`).toBeGreaterThan(0);
      } else {
        expect(plan.writes.length, `${kind} claims to mutate and produced no writes`).toBeGreaterThan(0);
      }
      checked += 1;
    }
    expect(checked, 'the mutation scan examined no kinds').toBeGreaterThan(0);
  });
});

describe('GUARD 1 · ACCEPT_EXECUTOR · every kind reaches a named apply path', () => {
  it('has an executor arm and names a path', () => {
    const body = readOwned(FACET_OWNER_FILE.ACCEPT_EXECUTOR);
    let checked = 0;
    for (const kind of ALL_ACTION_KINDS) {
      const gap = facetGapFor(kind, 'ACCEPT_EXECUTOR');
      const armed = hasArm(body, kind);
      const ref = executorFor(SPECIMENS[kind]);
      if (gap) {
        /* THE CROSS-CHECK, and the thing that makes this ratchet self-verifying:
         * a gap entry is only honest while `executorFor` itself says the path is
         * missing. Close the code without closing the list, or the other way
         * round, and this fails. */
        expect(ref.path, `STALE RATCHET · ${kind} has an ACCEPT_EXECUTOR gap and executorFor now returns ${ref.path}`)
          .toBe('UNIMPLEMENTED');
        expect(ref.because.length, `${kind} says UNIMPLEMENTED without saying what is missing`).toBeGreaterThan(40);
        continue;
      }
      expect(armed, `${kind} has no arm in executor-map.ts and no ratchet entry`).toBe(true);
      expect(ref.path, `${kind} has no ratchet entry and no executor`).not.toBe('UNIMPLEMENTED');
      expect(ref.because.length, `${kind}'s executor does not say what it does`).toBeGreaterThan(10);
      checked += 1;
    }
    expect(checked, 'the executor scan examined no kinds').toBeGreaterThan(0);
  });

  it('a non-mutating kind is recorded rather than quietly applied', () => {
    for (const kind of ['HOLD', 'REFUSAL', 'SAFETY_STOP', 'CONDITIONAL'] as ActionKind[]) {
      expect(executorFor(SPECIMENS[kind]).path, `${kind} should be RECORD_ONLY`).toBe('RECORD_ONLY');
    }
  });
});

describe('GUARD 1 · LEDGER · every decision can be written down', () => {
  it('classifies into the ledger vocabulary the migration constrains', () => {
    const body = readOwned(FACET_OWNER_FILE.LEDGER);
    let checked = 0;
    for (const kind of ALL_ACTION_KINDS) {
      const gap = facetGapFor(kind, 'LEDGER');
      const armed = hasArm(body, kind);
      if (gap) {
        expect(armed, `STALE RATCHET · ${kind} has a LEDGER gap and now has an arm`).toBe(false);
        continue;
      }
      expect(armed, `${kind} has no arm in ledger-facet.ts and no ratchet entry`).toBe(true);
      const f = ledgerFacetsOf(SPECIMENS[kind]);
      expect(LEDGER_SCOPES, `${kind} produced scope ${f.scope}, which the CHECK constraint rejects`).toContain(f.scope);
      expect(LEDGER_LEVERS, `${kind} produced lever ${f.proposedLever}, which the CHECK constraint rejects`).toContain(f.proposedLever);
      expect(LEDGER_DECISIONS, `${kind} produced decision ${f.decision}, which the CHECK constraint rejects`).toContain(f.decision);
      checked += 1;
    }
    expect(checked, 'the ledger scan examined no kinds').toBeGreaterThan(0);
  });

  it('does not supply a direction, which the boundary measures from the rows', () => {
    // Rule 16 and ledger-entry.ts's own doctrine: a caller that could label its
    // own change would eventually label a downgrade "adjustment".
    for (const kind of ALL_ACTION_KINDS) {
      expect(Object.keys(ledgerFacetsOf(SPECIMENS[kind])).sort())
        .toEqual(['decision', 'proposedLever', 'scope']);
    }
  });

  it('keeps a stop and a hold apart', () => {
    expect(ledgerFacetsOf(SPECIMENS.HOLD).decision).toBe('HOLD');
    expect(ledgerFacetsOf(SPECIMENS.SAFETY_STOP).decision).not.toBe('HOLD');
    expect(ledgerFacetsOf(SPECIMENS.REFUSAL).decision).toBe('REFUSE');
  });
});

describe('GUARD 1 · UNDO · every kind says whether the runner can take it back', () => {
  it('reverses, has nothing to reverse, or carries a ratchet entry saying it cannot', () => {
    const body = readOwned(FACET_OWNER_FILE.UNDO);
    let checked = 0;
    for (const kind of ALL_ACTION_KINDS) {
      const gap = facetGapFor(kind, 'UNDO');
      const armed = hasArm(body, kind);
      const plan = undoWritesFor(SPECIMENS[kind]);
      if (gap) {
        expect(plan.kind, `STALE RATCHET · ${kind} has an UNDO gap and now undoes to ${plan.kind}`)
          .toBe('not_undoable');
        if (plan.kind === 'not_undoable') {
          expect(plan.because.length, `${kind} refuses to undo without saying why`).toBeGreaterThan(20);
        }
        continue;
      }
      expect(armed, `${kind} has no arm in undo.ts and no ratchet entry`).toBe(true);
      expect(plan.kind, `${kind} has no ratchet entry and cannot be undone`).not.toBe('not_undoable');
      if (plan.kind === 'reverse') {
        expect(plan.writes.length, `${kind} claims to reverse and produced no writes`).toBeGreaterThan(0);
      }
      checked += 1;
    }
    expect(checked, 'the undo scan examined no kinds').toBeGreaterThan(0);
  });

  it('restores the value the proposal recorded, not a guess', () => {
    const plan = undoWritesFor(SPECIMENS.RESCHEDULE);
    expect(plan.kind).toBe('reverse');
    if (plan.kind === 'reverse') {
      expect(plan.writes[0]).toEqual({ op: 'update', planWorkoutId: 'pw_1', set: { date_iso: BEFORE.dateISO } });
    }
  });

  it('refuses when the field it would restore was never recorded', () => {
    const noPace: BrainAction = {
      ...SPECIMENS.PACE_CHANGE, before: [{ planWorkoutId: 'pw_1' }],
    } as BrainAction;
    expect(undoWritesFor(noPace).kind).toBe('not_undoable');
  });
});

describe('GUARD 1 · WATCH · every kind says what the wrist must do', () => {
  it('classifies into the three effects the watch wire can express', () => {
    const body = readOwned(FACET_OWNER_FILE.WATCH);
    const EFFECTS = ['RELOAD_IF_TODAY', 'NO_WATCH_EFFECT', 'WITHHOLD_WORKOUT'];
    let checked = 0;
    for (const kind of ALL_ACTION_KINDS) {
      const gap = facetGapFor(kind, 'WATCH');
      const armed = hasArm(body, kind);
      if (gap) {
        expect(armed, `STALE RATCHET · ${kind} has a WATCH gap and now has an arm`).toBe(false);
        continue;
      }
      expect(armed, `${kind} has no arm in watch-facet.ts and no ratchet entry`).toBe(true);
      const e = watchBehaviorOf(SPECIMENS[kind]);
      expect(EFFECTS, `${kind} produced watch effect ${e.kind}`).toContain(e.kind);
      expect(e.because.length, `${kind}'s watch effect has no reason`).toBeGreaterThan(10);
      // "Where applicable" is a real distinction and it is stated, not implied:
      // a kind the wrist carries must not read as no effect.
      if (watchIsApplicable(kind)) {
        expect(e.kind, `${kind} changes what the wrist carries and claims no watch effect`)
          .not.toBe('NO_WATCH_EFFECT');
      }
      checked += 1;
    }
    expect(checked, 'the watch scan examined no kinds').toBeGreaterThan(0);
  });

  it('a stop withholds rather than merely refreshing', () => {
    expect(watchBehaviorOf(SPECIMENS.SAFETY_STOP).kind).toBe('WITHHOLD_WORKOUT');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * GUARD 2 · THE GENERATOR · SOMETHING ON A LIVE PATH ACTUALLY EMITS IT
 *
 * The facet the other ten cannot see, and the whole finding this gate exists
 * for: "the lane can now carry 21 action kinds, but no engine emits most of
 * them."
 * ═══════════════════════════════════════════════════════════════════════ */

describe('GUARD 2 · GENERATOR · every kind is emitted by something live', () => {
  it('names a module, an exported symbol and a live caller, and all three resolve', () => {
    let checked = 0;
    for (const kind of ALL_ACTION_KINDS) {
      const gap = facetGapFor(kind, 'GENERATOR');
      const ref = GENERATOR_REGISTRY[kind];
      if (gap) {
        /* Cross-check, both ways. A gap standing while a generator is
         * registered is a stale entry; a generator registered while a gap
         * stands is a list nobody updated. */
        expect(ref, `STALE RATCHET · ${kind} has a GENERATOR gap and GENERATOR_REGISTRY now names one`).toBeNull();
        continue;
      }
      expect(ref, `${kind} has no generator and no ratchet entry`).not.toBeNull();
      const g = ref!;

      const mod = readOwned(g.module);
      expect(mod, `${g.module} does not export ${g.symbol}`).toContain(`export function ${g.symbol}`);
      // The module must be able to CONSTRUCT this kind, not merely mention it.
      expect(mod, `${g.module} never constructs a ${kind}`).toContain(`kind: '${kind}'`);
      expect(g.when.length, `${kind}'s generator does not say what causes it to fire`).toBeGreaterThan(30);

      /* THE LOAD-BEARING CHECK. A generator with no live caller is exactly the
       * "wired, tested and inert" shape, and a registry that only named the
       * module would have certified one. The import graph is walked from the
       * named caller against the real files, so a rename or a deleted import
       * fails here rather than being discovered by a runner staring at a card
       * that never appears. */
      /* THE NAMED CALL SITE ACTUALLY CALLS IT.
       *
       * This assertion exists because the first cut of this gate did NOT have
       * it, and the falsification found that out: deleting the
       * `actionFromAdaptation(` call from `workout-proposals.ts` — the writer
       * that is the whole point of the wiring — PASSED, because a sibling
       * module in the same import graph also called the symbol. A check that
       * accepts "somebody, somewhere in this graph" is not a check that the
       * generator is wired where it was claimed to be. */
      const callSite = readOwned(g.callSite);
      expect(
        callSite.includes(`${g.symbol}(`),
        `${g.callSite} is named as the call site for ${kind} and does not call ${g.symbol}`,
      ).toBe(true);

      /* AND THE CALL SITE IS REACHABLE FROM A ROUTE OR CRON. Static, and
       * transitive: the progression generator is three hops from the cron and a
       * one-hop check would have called it unreachable. Rule 19 was earned by a
       * one-hop check missing an edge three modules deep. */
      const liveBody = readOwned(g.liveCaller);
      expect(
        /^app\/api\/.+route\.ts$/.test(g.liveCaller),
        `${g.liveCaller} is named as the live caller for ${kind} and is not a route or cron entry point`,
      ).toBe(true);
      expect(liveBody.length).toBeGreaterThan(0);
      const graph = reachableModules(g.liveCaller);
      expect(
        graph.has(g.callSite),
        `${g.liveCaller} does not reach ${g.callSite}, so nothing live emits ${kind}`,
      ).toBe(true);
      expect(
        graph.has(g.module),
        `${g.liveCaller} does not reach ${g.module}, so ${kind} cannot be constructed on a live path`,
      ).toBe(true);
      checked += 1;
    }
    expect(checked, 'the generator scan examined no kinds').toBeGreaterThan(0);
  });

  it('reports how many kinds are genuinely emitted, so the number cannot rot silently', () => {
    const emitted = ALL_ACTION_KINDS.filter((k) => GENERATOR_REGISTRY[k] !== null);
    // Falsifiable, and deliberately an equality rather than a floor: closing a
    // gap must be a deliberate edit to this line, so nobody can quietly ADD a
    // generator without also arguing it, and nobody can quietly lose one.
    expect(emitted.length, `emitted kinds: ${emitted.join(', ')}`).toBe(12);
  });

  /* ── the generators, driven for real ─────────────────────────────────── */

  it('the progression generator emits the four session-geometry levers and a hold', () => {
    const shape = { reps: 4, repMinutes: 8, recoveryMinutes: 2, paceSPerMi: 430, zone: 'threshold' };
    const mk = (over: Record<string, unknown>) => actionFromProgression({
      workoutId: 'pw_1', dateISO: '2026-09-22', family: 'threshold',
      action: 'TAKE', shape: { ...shape, ...(over.shape as object ?? {}) },
      authored: shape, authoredLever: null, lever: null, why: 'earned it', changed: true,
      ...over,
    } as never, [BEFORE]);

    expect(mk({ lever: 'rep_count', shape: { ...shape, reps: 5 } }).kind).toBe('REPETITION_CHANGE');
    expect(mk({ lever: 'recovery_duration', shape: { ...shape, recoveryMinutes: 1.5 } }).kind).toBe('RECOVERY_INTERVAL_CHANGE');
    expect(mk({ lever: 'interval_duration', shape: { ...shape, repMinutes: 9 } }).kind).toBe('DURATION_CHANGE');
    expect(mk({ lever: 'quality_duration' }).kind).toBe('QUALITY_DOSE_CHANGE');
    expect(mk({ lever: 'work_density' }).kind).toBe('QUALITY_DOSE_CHANGE');
    expect(mk({ lever: 'pace', shape: { ...shape, paceSPerMi: 424 } }).kind).toBe('PACE_CHANGE');
    expect(mk({ action: 'HOLD', lever: null, changed: false }).kind).toBe('HOLD');
  });

  it('a shorter recovery reads as MORE work, not less', () => {
    // The one place a renderer that diffed the numbers would draw the hardest
    // step in this engine as a pull-back.
    const a = actionFromProgression({
      workoutId: 'pw_1', dateISO: '2026-09-22', family: 'interval', action: 'ACCELERATE',
      shape: { reps: 5, repMinutes: 4, recoveryMinutes: 1.5, paceSPerMi: 400, zone: 'interval' },
      authored: { reps: 5, repMinutes: 4, recoveryMinutes: 2.5, paceSPerMi: 400, zone: 'interval' },
      authoredLever: null, lever: 'recovery_duration', why: 'absorbed the last two', changed: true,
    } as never, [BEFORE]);
    expect(a.kind).toBe('RECOVERY_INTERVAL_CHANGE');
    expect(a.direction).toBe('MORE');
    expect(phoneDirectionOf(a)).toBe('push');
  });

  it('the adaptation generator emits the four per-workout kinds the cron raises', () => {
    const row = { planWorkoutId: 'pw_1', dateISO: '2026-09-22', type: 'tempo', distanceMi: 9.5 };
    const mk = (a: Record<string, unknown>) => actionFromAdaptation(a as never, row);

    expect(mk({ kind: 'downgrade', newType: 'easy', why: 'x' })!.kind).toBe('WORKOUT_TYPE_CHANGE');
    const shaved = mk({ kind: 'shave', shaveFraction: 0.17, why: 'x' })!;
    expect(shaved.kind).toBe('DISTANCE_CHANGE');
    expect(shaved.direction).toBe('LESS');
    const up = mk({ kind: 'mark_upgrade', bumps: [{ workoutId: 'pw_1', newDistanceMi: 11 }], why: 'x' })!;
    expect(up.kind).toBe('DISTANCE_CHANGE');
    expect(up.direction).toBe('MORE');
    expect(mk({ kind: 'reschedule', newDate: '2026-09-23', why: 'x' })!.kind).toBe('RESCHEDULE');
    expect(mk({ kind: 'field_test', why: 'no test in 42 days' })!.kind).toBe('FIELD_TEST');
    // Rule 11: a kind with no per-workout translation records nothing.
    expect(mk({ kind: 'mark_dirty', why: 'x' })).toBeNull();
    expect(mk({ kind: 'note', why: 'x' })).toBeNull();
  });

  it('the reprice generator names the anchors that moved', () => {
    const a = actionFromReprice({
      kind: 'reprice', planId: 'pln_1', arm: 'measured', fromVdot: 46.3, toVdot: 47.7,
      toSource: 'measured_vdot', measured: true,
      anchorMoves: [
        { key: 'threshold_s_per_mi', fromSecPerMi: 430, toSecPerMi: 424 },
        { key: 'marathon_s_per_mi', fromSecPerMi: 460, toSecPerMi: 456 },
      ],
      meanAnchorDeltaSecPerMi: -5, workoutsAffected: 77, workoutsSealed: 3,
      computedAt: '2026-09-05T09:00:00.000Z',
    } as never);
    expect(a.kind).toBe('COORDINATED');
    expect(a.direction).toBe('MORE');
    if (a.kind === 'COORDINATED') {
      expect(a.parts.map((p) => p.kind)).toEqual(['PACE_CHANGE', 'PACE_CHANGE']);
      expect(a.parts.every((p) => p.direction === 'MORE')).toBe(true);
      expect(a.describe).toContain('77 sessions ahead');
    }
  });

  it('the reprice generator lets one anchor disagree with the mean', () => {
    // Threshold faster, marathon slower. A part that inherited the mean would be
    // labelled a push while asking for less (Rule 16).
    const a = actionFromReprice({
      kind: 'reprice', planId: 'pln_1', arm: 'measured', fromVdot: null, toVdot: null,
      toSource: 'x', measured: false,
      anchorMoves: [
        { key: 'threshold_s_per_mi', fromSecPerMi: 430, toSecPerMi: 420 },
        { key: 'marathon_s_per_mi', fromSecPerMi: 450, toSecPerMi: 462 },
      ],
      meanAnchorDeltaSecPerMi: 1, workoutsAffected: 1, workoutsSealed: 0,
      computedAt: '2026-09-05T09:00:00.000Z',
    } as never);
    if (a.kind === 'COORDINATED') {
      expect(a.parts[0].direction).toBe('MORE');
      expect(a.parts[1].direction).toBe('LESS');
    }
  });

  it('the seal generator records a refusal as NEUTRAL, not as the thing it refused', () => {
    const r = refusalFromSeal({ kind: 'reshape', workoutIds: ['pw_1'], why: 'the gate said accelerate' } as never);
    expect(r.kind).toBe('REFUSAL');
    // A refused push is not a push. Counting it as one would corrupt the very
    // census Rule 21 measures.
    expect(r.direction).toBe('NEUTRAL');
    expect(r.kind === 'REFUSAL' && r.because).toContain('sealed');
    expect(holdFor('one hard week is not evidence').kind).toBe('HOLD');
  });

  it('the safety generator refuses to invent a stop, and takes the verdict as an input', () => {
    // Rule 11's sharp end: an UNKNOWN verdict is a read failure, and turning it
    // into a stop would tell a healthy runner to stop because the check failed.
    expect(safetyStopFrom({
      resolution: {
        known: false, posture: 'WITHHOLD_PENDING_CHECK',
        unreadable: [{ signal: 'injury', failure: 'read_failed' }], floor: 'NORMAL', explain: 'x',
      } as never,
    })).toBeNull();

    // MODIFY is a different prescription, not a halt.
    expect(safetyStopFrom({
      resolution: {
        known: true, state: 'MODIFY', posture: 'EASY_ONLY', reason: 'injury_minor', driver: 'injury',
        injury: { site: 'left calf', severity: 'minor' }, illness: null, niggle: null,
        degradedSignals: [], explain: 'x',
      } as never,
    })).toBeNull();

    const stop = safetyStopFrom({
      resolution: {
        known: true, state: 'STOP', posture: 'NO_TRAINING', reason: 'injury_major', driver: 'injury',
        injury: { site: 'left calf', severity: 'major' }, illness: null, niggle: null,
        degradedSignals: [], explain: 'x',
      } as never,
      before: [BEFORE],
    });
    expect(stop).not.toBeNull();
    expect(stop!.kind).toBe('SAFETY_STOP');
    expect(stop!.direction).toBe('STOP');
    // The sentence comes from the safety owner's own renderer, so no second
    // description of one injury can appear.
    expect(stop!.kind === 'SAFETY_STOP' && stop!.because).toContain('Rest, not run');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * GUARD 3 · THE INTEGRATION FACET · EVERY KIND WALKS THE WHOLE LANE
 * ═══════════════════════════════════════════════════════════════════════ */

describe('GUARD 3 · INTEGRATION_TEST · every kind survives the whole lane at once', () => {
  it('validates, serializes, renders, classifies, executes and states an undo posture', () => {
    let walked = 0;
    for (const kind of ALL_ACTION_KINDS) {
      const gap = facetGapFor(kind, 'INTEGRATION_TEST');
      if (gap) continue;
      const a = SPECIMENS[kind];

      expect(validateAction(a).ok, `${kind} failed validation`).toBe(true);
      const back = deserializeAction(JSON.parse(JSON.stringify(serializeAction(a))));
      expect(back, `${kind} did not survive the round trip`).toEqual(a);
      expect(actionHeadline(back!, 'Tuesday').length).toBeGreaterThan(0);
      expect(phoneDirectionOf(back!)).toBeTruthy();
      expect(executorFor(back!).path).toBeTruthy();
      expect(ledgerFacetsOf(back!).decision).toBeTruthy();
      expect(watchBehaviorOf(back!).kind).toBeTruthy();
      expect(undoWritesFor(back!).kind).toBeTruthy();
      expect(plannedWrites(back!)).toBeTruthy();
      walked += 1;
    }
    // Liveness: this is the number that would silently drop to zero if the
    // matrix were gutted, and a walk of nothing must not report clean.
    expect(walked, 'the end-to-end walk covered no kinds').toBe(ALL_ACTION_KINDS.length);
  });

  it('a generated action survives the lane, not only a hand-built specimen', () => {
    // Rule 15: a mechanism the corpus cannot REACH is untested. The specimens
    // above are written by this file; these are written by the engine.
    const generated: BrainAction[] = [
      actionFromAdaptation({ kind: 'shave', shaveFraction: 0.17, why: 'volume overshoot' } as never,
        { planWorkoutId: 'pw_1', dateISO: '2026-09-22', type: 'tempo', distanceMi: 9.5 })!,
      actionFromProgression({
        workoutId: 'pw_1', dateISO: '2026-09-22', family: 'threshold', action: 'ACCELERATE',
        shape: { reps: 5, repMinutes: 8, recoveryMinutes: 2, paceSPerMi: 424, zone: 'threshold' },
        authored: { reps: 4, repMinutes: 8, recoveryMinutes: 2, paceSPerMi: 430, zone: 'threshold' },
        authoredLever: null, lever: 'rep_count', why: 'absorbed the last two weeks', changed: true,
      } as never, [BEFORE]),
      refusalFromSeal({ kind: 'reshape', workoutIds: ['pw_1'], why: 'the gate said accelerate' } as never),
    ];
    expect(generated.length).toBeGreaterThan(0);
    for (const a of generated) {
      const v = validateAction(a);
      expect(v.ok, `a generated ${a.kind} is invalid: ${v.ok ? '' : v.refusals.join('; ')}`).toBe(true);
      const back = deserializeAction(JSON.parse(JSON.stringify(serializeAction(a))));
      expect(back, `a generated ${a.kind} did not survive serialization`).toEqual(a);
      expect(actionHeadline(a, 'Tuesday').length).toBeGreaterThan(0);
      expect(executorFor(a).path).not.toBe('UNIMPLEMENTED');
    }
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * GUARD 4 · RULE 21 AND RULE 22 · THE LANE IS NOT ONE-DIRECTIONAL
 * ═══════════════════════════════════════════════════════════════════════ */

describe('GUARD 4 · the completed lane can push as fluently as it can pull back', () => {
  it('every generated kind can be constructed in both directions', () => {
    const emitted = ALL_ACTION_KINDS.filter((k) => GENERATOR_REGISTRY[k] !== null);
    const canPush = emitted.filter((k) => {
      const a = { ...SPECIMENS[k], direction: 'MORE' } as BrainAction;
      return !plannedWrites(a).nonMutating || isNonMutatingKind(k);
    });
    const canPull = emitted.filter((k) => {
      const a = { ...SPECIMENS[k], direction: 'LESS' } as BrainAction;
      return !plannedWrites(a).nonMutating || isNonMutatingKind(k);
    });
    expect(canPush.length).toBe(canPull.length);
    expect(canPush.length).toBe(emitted.length);
  });

  it('states what it cannot fail on, in its own file', () => {
    // Rule 22, enforced rather than asserted in prose: this gate's header must
    // carry the sentence, and so must every facet owner.
    const self = readFileSync(join(__dirname, '_action_completeness.test.ts'), 'utf8');
    expect(self).toContain('WHAT THIS GATE CANNOT FAIL ON (Rule 22)');
    for (const facet of ALL_FACETS) {
      const rel = FACET_OWNER_FILE[facet];
      if (rel.endsWith('.test.ts')) continue;
      if (!rel.endsWith('.ts')) continue;   // the generator directory
      const body = readOwned(rel);
      expect(body, `${rel} owns a facet and does not state what it cannot fail on`)
        .toMatch(/CANNOT (FAIL ON|CATCH)/);
    }
  });
});
