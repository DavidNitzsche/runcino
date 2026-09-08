/**
 * THE ACTION COMPLETENESS GATE · ACTIONCOMPLETE-1 (2026-09-05).
 *
 * ══════════════════════════════════════════════════════════════════════════
 * WHAT THIS ASSERTS
 *
 * That every one of the twenty-one `BrainAction` kinds has ALL FOURTEEN of the
 * things a lever needs before it is real — evidence source, generator,
 * validator, serializer, PROPOSAL WRITER, renderer, explanation, accept
 * executor, mutation, ledger writer, DECLINE behaviour, undo posture, watch
 * behaviour, integration test — or a ratchet entry in `facets.ts` saying which
 * one is missing and why.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * WHAT THE ELEVEN-FACET VERSION OF THIS GATE COULD NOT SEE (2026-09-05)
 *
 * It reported HOLD and SAFETY_STOP as fully complete. Both were: generated,
 * validated, serialized, rendered, executable, ledgered, watched. And NO
 * PRODUCTION PATH COULD PUT EITHER IN FRONT OF ANYONE — `writeWorkoutProposals`
 * takes `AdaptationAction[]`, and neither kind is a member of that type,
 * because neither is a mutation. `scripts/v5-roundtrip-seed.ts` wrote them by
 * hand and said so in its own header. Eleven green cells, one unreachable
 * lever, and this file certified it.
 *
 * That is the reason PROPOSAL_WRITER exists, and it is the reason a facet list
 * is a hypothesis rather than a proof (Rule 22): fourteen is also a list
 * somebody wrote down.
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
  type LiveRow,
} from './action';
import { plannedWrites, isNonMutatingKind } from './execute';
import { validateAction } from './validate';
import { serializeAction, deserializeAction } from './serialize';
import { undoWritesFor } from './undo';
import { beforeFromLive } from './staleness';
import { ledgerFacetsOf } from './ledger-facet';
import { watchBehaviorOf, watchIsApplicable } from './watch-facet';
import { executorFor } from './executor-map';
import { phoneDirectionOf, actionHeadline } from '@/lib/faff/v5-action-render';
import {
  ALL_FACETS,
  FACET_GAPS,
  FACET_OWNER_FILE,
  GENERATOR_REGISTRY,
  PROPOSAL_WRITER_REGISTRY,
  ORIGINAL_ELEVEN_FACETS,
  ORIGINAL_ELEVEN_GAP_CEILING,
  WRITER_MUST_REFUSE,
  facetGapFor,
  facetCoverage,
  type Facet,
} from './facets';
import { EVIDENCE_REGISTRY } from './evidence-facet';
import { declineBehaviorOf, isDeclinable } from './decline-facet';
import { WRITER_REFUSES, rowKindOf } from './write';
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
import { actionFromLongRunStructure } from './generate/from-long-run-structure';
import { resolveLongRunStructureEvidence } from './evidence/long-run-structure';

/** `web-v2/`, so the registry's repo-relative paths resolve. */
const WEB = join(__dirname, '..', '..', '..');

/**
 * THE FULLY-RECORDED SNAPSHOT.
 *
 * UNDOCOMPLETE-1 (2026-09-05) added the five SHAPE fields. They are what makes
 * the UNDO facet answerable for the session-geometry kinds, and they are here
 * rather than in a second fixture because the completeness question is "can
 * this facet work", and the honest answer for a proposal written by
 * `beforeFromLive` today is yes. A row written before those columns were
 * recorded still refuses, and `refuses when the field it would restore was
 * never recorded` below is the case that proves it.
 */
const BEFORE = {
  planWorkoutId: 'pw_1',
  dateISO: '2026-09-22',
  type: 'tempo',
  distanceMi: 9.5,
  paceTargetSecPerMi: 430,
  planVersion: 'v7',
  durationMin: 62,
  isQuality: true,
  subLabel: '4 x 8 min @ T',
  notes: 'threshold, controlled',
  workoutSpec: { reps: 4, rep_minutes: 8, recovery_minutes: 2, zone: 'threshold' },
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

  it('keeps the ratchet meaningful across the facet widening', () => {
    /* THE ONE WAY THE GAP TOTAL MAY LEGITIMATELY RISE, AND ITS GUARD.
     *
     * Adding EVIDENCE_SOURCE, PROPOSAL_WRITER and DECLINE added 63 cells and
     * therefore added gaps, so `FACET_GAPS.length` alone stopped being a
     * ratchet the moment the facet list grew. A new facet must not be able to
     * cover a regression on an old one, so the count on the ORIGINAL eleven is
     * pinned separately: it went 23 to 14 in the same pass, and this number may
     * only ever come down.
     *
     * `toBeLessThanOrEqual` rather than an equality on purpose: closing an old
     * gap should not require editing this line, and the ceiling failing is what
     * a regression looks like. */
    const onOriginal = FACET_GAPS.filter((g) => ORIGINAL_ELEVEN_FACETS.includes(g.facet));
    expect(
      onOriginal.length,
      `the original eleven facets now carry ${onOriginal.length} gaps against a ceiling of `
      + `${ORIGINAL_ELEVEN_GAP_CEILING}: ${onOriginal.map((g) => `${g.kind}/${g.facet}`).join(', ')}`,
    ).toBeLessThanOrEqual(ORIGINAL_ELEVEN_GAP_CEILING);
    // Liveness: a filter that matched nothing would pass the ceiling trivially.
    expect(onOriginal.length).toBeGreaterThan(0);
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

  it('an upward distance change carries the bumps the pipeline needs', () => {
    /* THE DEFECT THIS PINS, found by wiring the executor: `mark_upgrade` joined
     * PROPOSABLE_KINDS on 2026-09-05, the accept route rebuilt its
     * AdaptationAction from newType / newDate / shaveFraction, and
     * `applyAdaptations`'s upgrade limb is guarded on
     * `a.bumps && a.bumps.length > 0`. So an accepted UPWARD proposal wrote
     * nothing and answered `{ ok: true, applied: 0 }` — the runner's one
     * push-shaped card, doing nothing, reporting success.
     *
     * Asserted at the SOURCE rather than by executing, because executing needs
     * a plan: the bridge must build `bumps` for a MORE and `shaveFraction` for
     * a LESS, and those are two different fields of one kind. */
    const src = readOwned('lib/brain/proposal/accept.ts');
    expect(src, 'the bridge no longer builds bumps for an upward distance change')
      .toContain('newDistanceMi: action.to!.value');
    expect(src, 'a mutating accept that touched no row is reported as success again')
      .toContain('zeroIsNotSuccess');
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

  it('puts a session\'s GEOMETRY back whole, or refuses naming the spec', () => {
    /* UNDOCOMPLETE-1 · the largest cluster this matrix ever carried. Seven
     * kinds could be applied and never reversed, all for one reason: the shape
     * they replaced lived in `workout_spec`, `sub_label`, `notes`,
     * `duration_min` and `is_quality`, and `RowBefore` recorded none of the
     * five. The refusal was honest and it was the right answer to the wrong
     * shape.
     *
     * WHOLE is the property under test, not merely "some write happens".
     * `applyProgressionReshape` writes spec, sub_label and pace from ONE
     * rendered shape precisely so the three cannot disagree; an undo that put
     * back the spec and left the chip is that defect running backwards. */
    for (const kind of ['DURATION_CHANGE', 'REPETITION_CHANGE',
      'RECOVERY_INTERVAL_CHANGE', 'QUALITY_DOSE_CHANGE'] as ActionKind[]) {
      const plan = undoWritesFor(SPECIMENS[kind]);
      expect(plan.kind, `${kind} still cannot be reversed`).toBe('reverse');
      if (plan.kind !== 'reverse') continue;
      const w = plan.writes[0];
      expect(w.op).toBe('update');
      if (w.op !== 'update') continue;
      expect(w.set.workout_spec, `${kind} restored no spec`).toEqual(BEFORE.workoutSpec);
      expect(w.set.sub_label, `${kind} restored the spec and left the chip`).toBe(BEFORE.subLabel);
      expect(w.set.pace_target_s_per_mi, `${kind} restored the spec and left the pace`)
        .toBe(BEFORE.paceTargetSecPerMi);
    }

    // And a field test, which replaces the TYPE as well.
    const ft = undoWritesFor(SPECIMENS.FIELD_TEST);
    expect(ft.kind).toBe('reverse');
    if (ft.kind === 'reverse' && ft.writes[0].op === 'update') {
      expect(ft.writes[0].set.type).toBe(BEFORE.type);
      expect(ft.writes[0].set.workout_spec).toEqual(BEFORE.workoutSpec);
    }

    /* THE REFUSAL IS STILL THERE, and it is what makes this a fix rather than a
     * loosening. A proposal that recorded a chip and no spec would restore the
     * label onto a prescription it no longer describes, so the refusal names
     * the spec — the field, not a flat "cannot undo". */
    const noSpec: BrainAction = {
      ...SPECIMENS.QUALITY_DOSE_CHANGE,
      before: [{ planWorkoutId: 'pw_1', subLabel: '4 x 8 min @ T' }],
    } as BrainAction;
    const refused = undoWritesFor(noSpec);
    expect(refused.kind).toBe('not_undoable');
    if (refused.kind === 'not_undoable') {
      expect(refused.because).toContain('label disagreeing with the prescription');
    }
  });

  it('restores a note rather than blanking it, and refuses when none was recorded', () => {
    // TAPER_CHANGE and RECOVERY_CHANGE write only `notes`. They refused because
    // reversing would have written the empty string over the runner's own
    // sentence, which is a loss worth refusing over — and was, until `notes`
    // was recorded.
    for (const kind of ['TAPER_CHANGE', 'RECOVERY_CHANGE'] as ActionKind[]) {
      const plan = undoWritesFor(SPECIMENS[kind]);
      expect(plan.kind, `${kind} still cannot be reversed`).toBe('reverse');
      if (plan.kind === 'reverse' && plan.writes[0].op === 'update') {
        expect(plan.writes[0].set.notes).toBe(BEFORE.notes);
      }
    }
    const noNote: BrainAction = {
      ...SPECIMENS.TAPER_CHANGE, before: [{ planWorkoutId: 'pw_1' }],
    } as BrainAction;
    expect(undoWritesFor(noNote).kind).toBe('not_undoable');
  });

  it('the SHIPPING snapshot records everything the undo restores', () => {
    /* THE HOLE THIS CLOSES, found by falsification 21.
     *
     * Every undo assertion above runs against SPECIMENS this file writes, and
     * they record the whole session. Deleting the `workoutSpec` line from
     * `beforeFromLive` — the function that builds the `before` every real
     * proposal actually carries — passed all of them. Which means the UNDO
     * facet could read GREEN while every proposal in production was
     * un-undoable, and nothing anywhere would say so.
     *
     * That is Rule 15 exactly: a mechanism the corpus cannot reach is untested
     * however many cases pass, and a fixture that is richer than the live path
     * is a corpus that cannot reach the defect. So this drives the SHIPPING
     * snapshot rather than the fixture. */
    const live = new Map<string, LiveRow>([['pw_1', {
      planWorkoutId: 'pw_1',
      dateISO: BEFORE.dateISO,
      type: BEFORE.type,
      distanceMi: BEFORE.distanceMi,
      paceTargetSecPerMi: BEFORE.paceTargetSecPerMi,
      planVersion: BEFORE.planVersion,
      durationMin: BEFORE.durationMin,
      isQuality: BEFORE.isQuality,
      subLabel: BEFORE.subLabel,
      notes: BEFORE.notes,
      workoutSpec: BEFORE.workoutSpec,
    }]]);
    const snapshot = beforeFromLive(live);
    expect(snapshot.length).toBe(1);

    let reversible = 0;
    for (const kind of ALL_ACTION_KINDS) {
      if (facetGapFor(kind, 'UNDO') != null) continue;
      const fromSnapshot = { ...SPECIMENS[kind], before: snapshot } as BrainAction;
      const plan = undoWritesFor(fromSnapshot);
      expect(
        plan.kind,
        `${kind} can be undone from a hand-written specimen and NOT from the snapshot the `
        + 'shipping writer records, so its undo would refuse for every real proposal',
      ).not.toBe('not_undoable');
      reversible += 1;
    }
    // Liveness: a loop that skipped every kind would pass silently.
    expect(reversible, 'the snapshot walk covered no kinds').toBeGreaterThan(10);

    /* AND THE READ THAT FEEDS IT. `beforeFromLive` can only record what
     * `readLiveRows` selected, and a `LiveRow` built here proves nothing about
     * the SQL. Checked as text because the query needs a database. */
    const reader = readOwned('lib/brain/proposal/staleness.ts');
    for (const col of ['duration_min', 'is_quality', 'sub_label', 'notes', 'workout_spec']) {
      expect(reader, `readLiveRows does not select ${col}, so no proposal can record it`)
        .toContain(`pw.${col}`);
    }
  });

  it('the undo applier can actually write every column an undo produces', () => {
    /* Rule 20's shape: a computed inverse nothing can apply is a promise the
     * accept response makes and no path keeps, which is exactly the state
     * `undoWritesFor` was in before `undo-apply.ts` existed. The column
     * allowlist there is deliberately written out rather than derived, so this
     * is the check that the two lists agree. */
    /* SCOPED TO THE BLOCK, and the falsification is why. The first cut asked
     * whether the whole FILE contained `'workout_spec'`, and deleting it from
     * `UNDOABLE_COLUMNS` passed — because `JSONB_COLUMNS` two lines below still
     * spelled it. An absence-only assertion over a whole file cannot see which
     * list a string is in, which is the citation-scrub defect in miniature
     * (Rule 18: "the bad string is gone" is satisfied by garbage). */
    const applierFile = readOwned('lib/brain/proposal/undo-apply.ts');
    const start = applierFile.indexOf('const UNDOABLE_COLUMNS = new Set([');
    expect(start, 'UNDOABLE_COLUMNS is gone; the undo applier writes nothing').toBeGreaterThan(-1);
    const applier = applierFile.slice(start, applierFile.indexOf(']);', start));
    const columns = new Set<string>();
    for (const kind of ALL_ACTION_KINDS) {
      const plan = undoWritesFor(SPECIMENS[kind]);
      if (plan.kind !== 'reverse') continue;
      for (const w of plan.writes) {
        if (w.op === 'update') for (const c of Object.keys(w.set)) columns.add(c);
      }
    }
    expect(columns.size, 'no undo produced any column, so this proves nothing').toBeGreaterThan(4);
    for (const c of columns) {
      expect(applier, `an undo writes ${c} and UNDOABLE_COLUMNS does not list it`)
        .toContain(`'${c}'`);
    }
  });
});

describe('GUARD 1 · DECLINE · every kind says what the runner\'s NO means', () => {
  it('has a decline arm and classifies into the three answers', () => {
    const body = readOwned(FACET_OWNER_FILE.DECLINE);
    const KINDS = ['KEEP_AS_PRESCRIBED', 'ACKNOWLEDGE_ONLY', 'NOT_DECLINABLE'];
    let checked = 0;
    for (const kind of ALL_ACTION_KINDS) {
      const gap = facetGapFor(kind, 'DECLINE');
      const armed = hasArm(body, kind);
      if (gap) {
        expect(armed, `STALE RATCHET · ${kind} has a DECLINE gap and now has an arm`).toBe(false);
        continue;
      }
      expect(armed, `${kind} has no arm in decline-facet.ts and no ratchet entry`).toBe(true);
      const d = declineBehaviorOf(SPECIMENS[kind]);
      expect(KINDS, `${kind} produced decline kind ${d.kind}`).toContain(d.kind);
      expect(d.because.length, `${kind} declines without saying what that means`).toBeGreaterThan(10);
      checked += 1;
    }
    expect(checked, 'the decline scan examined no kinds').toBeGreaterThan(0);
  });

  it('refuses to let a safety stop be answered no, and refuses nothing else', () => {
    /* THE DEFECT THIS PINS. The dismiss route was one UPDATE for twenty-one
     * kinds, so tapping "Leave it" on a withhold marked it answered — a button
     * that overrides safety. Asserted in BOTH directions, because a
     * NOT_DECLINABLE that spread would be a card the runner can never clear. */
    expect(declineBehaviorOf(SPECIMENS.SAFETY_STOP).kind).toBe('NOT_DECLINABLE');
    expect(isDeclinable('SAFETY_STOP')).toBe(false);
    const refused = ALL_ACTION_KINDS.filter(
      (k) => declineBehaviorOf(SPECIMENS[k]).kind === 'NOT_DECLINABLE');
    expect(refused).toEqual(['SAFETY_STOP']);
    for (const k of ALL_ACTION_KINDS) {
      expect(isDeclinable(k), `${k} disagrees with its own decline posture`)
        .toBe(declineBehaviorOf(SPECIMENS[k]).kind !== 'NOT_DECLINABLE');
    }
  });

  it('keeps "nothing was asked" apart from "the answer is no"', () => {
    // Rule 11 on the runner's side of the lane. A HOLD did not propose a change,
    // so declining one is not the same event as declining a shave, and a
    // decision history that collapsed them would say he refused work he was
    // never offered.
    for (const k of ['HOLD', 'REFUSAL', 'CONDITIONAL'] as ActionKind[]) {
      expect(declineBehaviorOf(SPECIMENS[k]).kind, `${k} should be ACKNOWLEDGE_ONLY`)
        .toBe('ACKNOWLEDGE_ONLY');
    }
    expect(declineBehaviorOf(SPECIMENS.DISTANCE_CHANGE).kind).toBe('KEEP_AS_PRESCRIBED');
  });

  it('does not re-raise a decision the runner has already refused on principle', () => {
    // His stated goal is his. Everything whose EVIDENCE can move is re-raisable;
    // a goal renegotiation is not evidence, and asking twice is nagging about a
    // judgement he has given.
    expect(declineBehaviorOf(SPECIMENS.RACE_TARGET_CHANGE).reraise).toBe(false);
    const nagging = ALL_ACTION_KINDS.filter((k) => !declineBehaviorOf(SPECIMENS[k]).reraise);
    expect(nagging).toEqual(['RACE_TARGET_CHANGE']);
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
    // 13 → 14 (LONGRUNSTRUCTURE-1, 2026-09-06): LONG_RUN_STRUCTURE_CHANGE now
    // has a real generator (`lib/brain/proposal/generate/from-long-run-
    // structure.ts`), reached live from `action-proposal-lane.ts`'s third
    // section.
    expect(emitted.length, `emitted kinds: ${emitted.join(', ')}`).toBe(14);
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
      /* REPRICEHEADLINE-1 (2026-09-08) · the sentence names the anchor that
       * moved, not the session count. Threshold moved here (430 -> 424) and
       * keeps first refusal, so it is the subject; 424 s/mi is 7:04. The
       * count is drawn once, by `affectedFrom`, on its own row. */
      expect(a.describe).toBe('Threshold moves to 7:04 across the block');
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

  it('the long-run structure reader proposes a finish only when the last two long runs held together', () => {
    const cleanSample = (dateISO: string) => ({
      dateISO,
      prescribedMi: 16,
      completedMi: 16,
      middlePaceSecPerMi: 540,
      finalPaceSecPerMi: 538,
      middleHrBpm: 150,
      finalHrBpm: 151,
    });

    const clean = resolveLongRunStructureEvidence({
      nextLongRunSubLabel: null,
      nextLongRunMi: 16,
      recent: [cleanSample('2026-08-24'), cleanSample('2026-08-31')],
    });
    expect(clean.decision).toBe('PROPOSE');
    expect(clean.proposedSubLabel).toMatch(/^LONG · \dmi @ M$/);
    const proposed = actionFromLongRunStructure(clean, [BEFORE]);
    expect(proposed?.kind).toBe('LONG_RUN_STRUCTURE_CHANGE');
    expect(proposed?.direction).toBe('MORE');

    // Already carries a segment · this axis has already moved, so HOLD.
    const already = resolveLongRunStructureEvidence({
      nextLongRunSubLabel: 'LONG · 4mi @ M',
      nextLongRunMi: 16,
      recent: [cleanSample('2026-08-24'), cleanSample('2026-08-31')],
    });
    expect(already.decision).toBe('HOLD');
    expect(actionFromLongRunStructure(already, [BEFORE])?.kind).toBe('HOLD');

    // A deteriorated finish is exactly what a harder finish would test hardest.
    const deteriorated = resolveLongRunStructureEvidence({
      nextLongRunSubLabel: null,
      nextLongRunMi: 16,
      recent: [
        cleanSample('2026-08-24'),
        {
          ...cleanSample('2026-08-31'),
          finalPaceSecPerMi: 590,
          middleHrBpm: 148,
          finalHrBpm: 162,
        },
      ],
    });
    expect(deteriorated.decision).toBe('HOLD');
    expect(actionFromLongRunStructure(deteriorated, [BEFORE])?.kind).toBe('HOLD');

    // Not enough long runs on record · a data problem, not a coaching call.
    const thin = resolveLongRunStructureEvidence({
      nextLongRunSubLabel: null,
      nextLongRunMi: 16,
      recent: [cleanSample('2026-08-31')],
    });
    expect(thin.decision).toBe('REFUSE');
    expect(actionFromLongRunStructure(thin, [BEFORE])).toBeNull();

    // No upcoming long run at all · nothing to attach a finish to.
    const none = resolveLongRunStructureEvidence({
      nextLongRunSubLabel: null, nextLongRunMi: 0, recent: [],
    });
    expect(none.decision).toBe('HOLD');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * GUARD 2b · THE PROPOSAL WRITER · A LIVE PATH CAN SHOW IT TO THE RUNNER
 *
 * THE FACET THE ELEVEN COULD NOT SEE. HOLD and SAFETY_STOP passed every one of
 * the original eleven while being unreachable from production: the writer took
 * `AdaptationAction[]` and neither kind is a member of that type. A lever the
 * runner can never be shown is inert however complete it looks.
 * ═══════════════════════════════════════════════════════════════════════ */

describe('GUARD 2b · PROPOSAL_WRITER · every kind can reach the runner', () => {
  it('names a writer, a call site and a live caller, and all three resolve', () => {
    let checked = 0;
    for (const kind of ALL_ACTION_KINDS) {
      const gap = facetGapFor(kind, 'PROPOSAL_WRITER');
      const ref = PROPOSAL_WRITER_REGISTRY[kind];
      if (gap) {
        expect(ref, `STALE RATCHET · ${kind} has a PROPOSAL_WRITER gap and a writer is registered`)
          .toBeNull();
        continue;
      }
      expect(ref, `${kind} has no writer and no ratchet entry`).not.toBeNull();
      const w = ref!;

      const mod = readOwned(w.module);
      expect(mod, `${w.module} does not export ${w.symbol}`)
        .toMatch(new RegExp(`export (async )?function ${w.symbol}`));
      expect(w.how.length, `${kind}'s writer does not say how it reaches the row`).toBeGreaterThan(20);

      // The writer actually writes THIS table. A "writer" that inserts nowhere
      // is the same shape of lie as a generator with no live caller.
      expect(mod, `${w.module} does not insert into plan_workout_proposals`)
        .toContain('INSERT INTO plan_workout_proposals');

      const callSite = readOwned(w.callSite);
      expect(
        callSite.includes(`${w.symbol}(`),
        `${w.callSite} is named as the call site for ${kind} and does not call ${w.symbol}`,
      ).toBe(true);

      expect(
        /^app\/api\/.+route\.ts$/.test(w.liveCaller),
        `${w.liveCaller} is named as the live caller for ${kind} and is not a route or cron entry`,
      ).toBe(true);
      readOwned(w.liveCaller);
      const graph = reachableModules(w.liveCaller);
      expect(
        graph.has(w.callSite),
        `${w.liveCaller} does not reach ${w.callSite}, so nothing live can raise a ${kind} card`,
      ).toBe(true);
      expect(
        graph.has(w.module),
        `${w.liveCaller} does not reach ${w.module}, so ${kind} cannot be written on a live path`,
      ).toBe(true);
      checked += 1;
    }
    expect(checked, 'the writer scan examined no kinds').toBeGreaterThan(0);
  });

  it('cross-checks the ratchet against write.ts\'s own refusals, both ways', () => {
    /* THE SELF-VERIFYING HALF, modelled on the ACCEPT_EXECUTOR cross-check.
     * `write.ts` refuses six kinds by name with the ruling attached. A refusal
     * with no gap entry is a list nobody updated; a gap for a kind the writer
     * now carries is a stale entry. Neither can move without the other. */
    for (const kind of ALL_ACTION_KINDS) {
      const refused = WRITER_REFUSES[kind] !== undefined;
      const gap = facetGapFor(kind, 'PROPOSAL_WRITER') != null;
      if (refused) {
        expect(gap, `write.ts refuses ${kind} and no PROPOSAL_WRITER gap says so`).toBe(true);
        expect(WRITER_REFUSES[kind]!.length, `${kind} is refused without an argued reason`)
          .toBeGreaterThan(80);
      }
      if (PROPOSAL_WRITER_REGISTRY[kind] !== null) {
        expect(refused, `${kind} has a registered writer and write.ts refuses it`).toBe(false);
      }
    }
    /* THE SET, PINNED SET-FOR-SET, AND THE HOLE THAT PUT IT HERE.
     *
     * The three assertions above are all consistent with `WRITER_REFUSES`
     * SHRINKING. Falsification 18 proved it: deleting `QUALITY_DOSE_CHANGE`
     * from that map passed the entire suite, because the kind still has no
     * registered writer and still carries a gap — and `writeActionProposal`
     * would have carried it, which is the side door around the owner's ruling
     * that `write.ts` exists to not be.
     *
     * `WRITER_MUST_REFUSE` names the kinds whose gap is a RULING rather than an
     * absence: constructible, generated, and withheld only because someone
     * decided. Those two lists are the same list, and equality is what makes
     * removing a name fail. */
    expect(
      ALL_ACTION_KINDS.filter((k) => WRITER_REFUSES[k] !== undefined).sort(),
      'write.ts and facets.ts disagree about which kinds are withheld by a ruling',
    ).toEqual([...WRITER_MUST_REFUSE].sort());
    // Liveness: an empty refusal map would satisfy every assertion above.
    expect(WRITER_MUST_REFUSE.length, 'nothing is withheld by a ruling, so this proves nothing')
      .toBeGreaterThan(0);
  });

  it('the row kind is derived from the union rather than typed out', () => {
    // A hand-written column vocabulary drifts from the union it mirrors. This
    // is what makes a new kind a legal row value on the day it is added.
    for (const kind of ALL_ACTION_KINDS) {
      expect(rowKindOf(SPECIMENS[kind])).toBe(kind.toLowerCase());
    }
  });

  it('every reason the progression gate can give fits on a card', () => {
    /* THE FRAGILITY THIS PINS, and it is fifteen characters wide.
     *
     * The HOLD lane raises a card whose `reason` is the gate's own `why`, and
     * `validateAction` refuses prose past PROSE_MAX_CHARS — correctly, because
     * a card is six to ten words plus one line. `writeActionProposal` reports
     * the refusal rather than swallowing it, so nothing breaks; the HOLD lane
     * simply STOPS RAISING ANYTHING, quietly, and this repo's whole finding is
     * that wired-tested-and-inert is what it ships.
     *
     * The longest sentence the gate can currently produce is 185 characters
     * against a limit of 200. A coaching edit that adds one clause switches the
     * lane off. So the STRINGS ARE READ OUT OF THE GATE AT RUN TIME and each is
     * driven through the real generator and the real validator — a check that
     * hardcoded the length would only prove it agrees with itself (Rule 18). */
    const gate = readOwned('lib/plan/progression-gate.ts');
    /* EVERY coach sentence in the file, not only the ones spelled `why:`.
     * `takeWhy` RETURNS two of them and a third is a template literal, so a
     * `why:`-anchored matcher read three of six — a check that scans most of a
     * thing and reports clean is the shape Rule 18 warns about. Any
     * single-quoted literal over forty characters in this file is a sentence
     * the gate can put on a card. */
    const whys = [...gate.matchAll(/'((?:[^'\\\n]|\\.){40,})'/g)].map((m) => m[1])
      .filter((t) => !t.includes('Research/'));
    expect(whys.length, 'no reasons were read out of progression-gate.ts; the extractor is broken')
      .toBeGreaterThan(4);
    for (const why of whys) {
      const v = validateAction(holdFor(why, ['pw_1']));
      expect(
        v.ok,
        `the progression gate can say a ${why.length}-character reason that no card can carry, so `
        + `the HOLD lane would silently stop raising: ${v.ok ? '' : v.refusals.join('; ')}`,
      ).toBe(true);
    }
  });

  it('the two kinds this facet was added for are now written by a live path', () => {
    /* Rule 20, on the finding itself. The owner asked for HOLD and SAFETY_STOP
     * to be "producible by real evidence, not seeded screenshots", and a
     * registry entry is a claim rather than a proof — so the claim is asserted
     * against the actual lane and the actual cron. */
    for (const kind of ['HOLD', 'SAFETY_STOP'] as ActionKind[]) {
      const w = PROPOSAL_WRITER_REGISTRY[kind];
      expect(w, `${kind} has no writer and it is the reason this facet exists`).not.toBeNull();
      expect(w!.symbol).toBe('writeActionProposal');
      expect(w!.callSite).toBe('lib/plan/action-proposal-lane.ts');
    }
    const lane = readOwned('lib/plan/action-proposal-lane.ts');
    // The safety verdict is an INPUT and is never re-derived here.
    expect(lane, 'the lane does not consume the canonical safety owner').toContain('resolveSafety');
    expect(lane, 'the lane does not build the stop from the generator').toContain('safetyStopFrom');
    /* AND THE SEAM IS NOT TOUCHED — gated rather than asserted in prose.
     *
     * Rule 19's corollary: both files claim in their own headers that they do
     * not read `AUTOMATIC_ADAPTATION_AUTHORITY`, and `lthr-reanchor.ts` proved
     * what a header claim is worth by asserting "imports no database at any
     * depth" while importing one three modules deep, for a day, with every gate
     * green. So the claim is checked against the IMPORT GRAPH.
     *
     * The check is on imports rather than on the string, because the string
     * appears in both headers making exactly this promise — and a gate that
     * fails on a file explaining why it does not do something is a gate that
     * teaches people to stop explaining. */
    for (const rel of ['lib/plan/action-proposal-lane.ts', 'lib/brain/proposal/write.ts']) {
      const body = readOwned(rel);
      const importsSeam = /(?:from|import\()\s*'[^']*adaptation-authority'/.test(body);
      expect(importsSeam, `${rel} imports the automatic-adaptation seam`).toBe(false);
      /* And does not name the switch in CODE. Comments are stripped first, for
       * the reason above: both headers say what they do not do, and that
       * sentence is the thing being checked rather than a violation of it.
       *
       * A TRANSITIVE check was tried here and is deliberately not used: the
       * lane takes `AdaptationAction` as a TYPE from `lib/plan/adapt.ts`, which
       * the seam itself imports, so the graph reaches the seam through a
       * type-only edge that erases at compile time. Failing on that would be
       * the gate objecting to a file naming a type, which is not the property
       * anyone cares about — what matters is whether the switch is READ. */
      const code = body.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
      expect(code.includes('AUTOMATIC_ADAPTATION_AUTHORITY'),
        `${rel} reads the automatic-adaptation seam`).toBe(false);
    }
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * GUARD 2c · THE EVIDENCE SOURCE · SOMETHING MEASURED IT
 * ═══════════════════════════════════════════════════════════════════════ */

describe('GUARD 2c · EVIDENCE_SOURCE · every kind names the reader behind it', () => {
  it('names a real module and a real exported symbol', () => {
    const FAMILIES = [
      'PACE_ANCHOR', 'PROGRESSION_GATE', 'DETECTION_PASS', 'VOLUME_EVIDENCE',
      'SAFETY_VERDICT', 'AUTHORITY_SEAM', 'RUNNER_STATED', 'EARNING_GATE',
    ];
    let checked = 0;
    for (const kind of ALL_ACTION_KINDS) {
      const gap = facetGapFor(kind, 'EVIDENCE_SOURCE');
      const ref = EVIDENCE_REGISTRY[kind];
      if (gap) {
        expect(ref, `STALE RATCHET · ${kind} has an EVIDENCE_SOURCE gap and a reader is registered`)
          .toBeNull();
        continue;
      }
      expect(ref, `${kind} names no evidence reader and has no ratchet entry`).not.toBeNull();
      const e = ref!;
      expect(FAMILIES, `${kind} claims family ${e.family}`).toContain(e.family);
      const mod = readOwned(e.module);
      expect(mod, `${e.module} does not export ${e.symbol}`)
        .toMatch(new RegExp(`export (async )?(function|const) ${e.symbol}\\b`));
      expect(e.measures.length, `${kind} does not say what its reader measures`).toBeGreaterThan(30);
      checked += 1;
    }
    expect(checked, 'the evidence scan examined no kinds').toBeGreaterThan(0);
  });

  it('labels the one source that is not a measurement as not one', () => {
    /* The coach projects and never renegotiates a stated goal, so the only
     * thing that may move a race target is the runner saying so. Calling that
     * a measurement would put his own statement in the same voice as a reading,
     * which is exactly what `Provenance.POLICY_ASSUMPTION` exists to prevent. */
    expect(EVIDENCE_REGISTRY.RACE_TARGET_CHANGE!.family).toBe('RUNNER_STATED');
    const stated = ALL_ACTION_KINDS.filter(
      (k) => EVIDENCE_REGISTRY[k]?.family === 'RUNNER_STATED');
    expect(stated).toEqual(['RACE_TARGET_CHANGE']);
  });

  it('a generated kind always names its evidence', () => {
    // The pairing that matters: a generator with no named reader is a card the
    // runner is asked to accept with nothing measured behind it.
    for (const kind of ALL_ACTION_KINDS) {
      if (GENERATOR_REGISTRY[kind] === null) continue;
      expect(EVIDENCE_REGISTRY[kind], `${kind} is generated and names no evidence reader`)
        .not.toBeNull();
    }
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
      expect(declineBehaviorOf(back!).kind).toBeTruthy();
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
