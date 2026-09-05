/**
 * lib/adaptation/canonical/_cannot_mutate.test.ts · THE ENGINE CANNOT WRITE,
 * EVEN IF IT IS CALLED.
 *
 * The brief's requirement is structural, not behavioural: "The engine must be
 * structurally incapable of mutating a plan." So this file proves four things
 * from source, none of which depend on the engine behaving well:
 *
 *   1 · No file here issues a write against any table.
 *   2 · No file here imports a database, a pool, a client, an ORM, `fetch`, or
 *       anything else that could reach the outside world. A pure function
 *       cannot mutate a plan whatever it is handed.
 *   3 · No file here names a known plan writer.
 *   4 · Nothing outside this directory imports it, INCLUDING through a nested
 *       path, with a small set of narrowly enumerated authorized exceptions
 *       — see "THE AUTHORIZED EXCEPTIONS" below. This closes a real hole
 *       described further down.
 *
 * ── THE AUTHORIZED EXCEPTIONS (added for live shadow evaluation) ───────────
 *
 * David: "Wire the canonical Adaptation Engine into live shadow evaluation
 * only... Keep live automatic mutation disabled." Guard 4 below is updated
 * DELIBERATELY, not weakened, to allow the files that live wiring actually
 * needs — three entries, each a (FILE, MODULE, IMPORTED VALUE SYMBOLS)
 * triple, not a directory-to-directory pass:
 *
 *   · `lib/adaptation/canonical-shadow/run-live-shadow-evaluation.ts` may
 *     import exactly `evaluateAdaptation` from exactly
 *     `@/lib/adaptation/canonical/evaluate` — the engine's own "ONE ENTRY
 *     POINT".
 *   · `lib/adaptation/canonical-shadow/live-input.ts`, which BUILDS the
 *     input that entry point consumes, may import exactly `measured`,
 *     `absent` and `failed` from `@/lib/adaptation/canonical/input` (the
 *     three `Measured<T>` constructors Rule 11 requires it to state its
 *     evidence through) and exactly `gradeStimulus` from
 *     `@/lib/adaptation/canonical/stimulus` (so grading a live session
 *     reuses the ONE canonical grader rather than growing a second one —
 *     `docs/DOCTRINE_ENFORCEMENT_AND_CLEAN_IMPLEMENTATION.md` §1).
 *
 * Nothing else, from nowhere else. Every symbol on this list is a pure,
 * side-effect-free helper — trivial tagged-union constructors or a function
 * that takes plain values and returns a plain assessment — and every file
 * that defines them already passes guards 1-3, so none of them can carry a
 * plan write regardless of who calls them (see the allowlist's own
 * in-source comment for the full argument).
 *
 * The allowlist is keyed on (FILE, MODULE, IMPORTED SYMBOL), not on
 * directory or on "this subdirectory may talk to that one". That is the
 * property the task requires and the reason it is not simply "guard 4 is
 * off for `canonical-shadow/`": `canonical/` itself has no mutating export
 * for a future importer to reach — guards 1-3 already make that
 * structurally true — so the actual risk this allowlist defends against is
 * SCOPE CREEP: a new file reaching into this directory, or one of the two
 * allowed files reaching for something beyond what it was reviewed
 * against. Both are still caught:
 *
 *   · a DIFFERENT file importing any of these symbols (or anything else
 *     from `canonical/`) is refused — proven by the oracles below
 *   · either allowed file importing anything OTHER than its own enumerated
 *     symbols — a hypothetical future export, or an internal helper reached
 *     around the reviewed surface — is refused, proven by further oracles
 *   · a whole-statement `import type {...}` is out of scope by design (it
 *     produces no runtime code at all — see `canonicalEngineImportsIn`'s own
 *     header), which is WHY `live-input.ts`'s many TYPE imports from
 *     `canonical/input` need no allowlist entry of their own
 *
 * `lib/adaptation/canonical-shadow/_never_mutates_plan.test.ts` is the
 * companion proof that this directory, having imported these pure helpers
 * and the pure evaluator, never turns any of their output into a write
 * against a plan table — the same two-part discipline this file already
 * applies to the engine: guard 4 controls WHO may call in,
 * `_never_mutates_plan.test.ts` controls what the authorized callers may do
 * with what they get back.
 *
 * ── THE HOLE THIS FILE CLOSES IN THE PRE-EXISTING GATE ─────────────────────
 *
 * `_zero_mutation_scan.test.ts` guard 3 rations who may import this layer with
 *
 *     /import\s+(type\s+)?\{([^}]*)\}\s+from\s+'(@\/lib\/adaptation\/[a-z-]+)'/g
 *
 * `[a-z-]+` matches ONE path segment, so `@/lib/adaptation/canonical/evaluate`
 * is invisible to it: the ratchet that is supposed to stop a plan writer
 * importing the proposal path cannot see anything in a subdirectory. That gate
 * predates this subdirectory and is not wrong, it is scoped to the flat layout
 * it was written for. Guard 4 below covers nested paths, and the gap is
 * reported rather than silently patched, because the same blind spot applies to
 * any future subdirectory anyone adds under `lib/adaptation`.
 *
 * ── RULE 18 · LIVENESS AND FALSIFICATION ───────────────────────────────────
 *
 * Each guard has an ORACLE proving its detector fires on planted violations,
 * and each states how many files it read. Falsified by hand before landing.
 *
 * ── RULE 22 · WHAT THIS GATE CANNOT FAIL ON ────────────────────────────────
 *
 * · A write reached through a function imported from outside whose name is not
 *   in the writer list. Guard 2 is the real defence there: with no I/O import
 *   of any kind, there is no transport for a write to travel on.
 * · A caller that takes a returned `PlanDiff` and applies it itself. Nothing
 *   here can stop that, and nothing should: the diff is the deliverable. What
 *   guard 4 does is ensure no such caller currently exists, so wiring one
 *   becomes a deliberate, reviewable act rather than an accident.
 * · Behaviour. This file reads source, never runs the engine. The purity test
 *   at the bottom is the only behavioural check and it is deliberately narrow.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { evaluateAdaptation } from './evaluate';
import { baseInput, threeGoodWeeks, twoGoodLongRuns } from './_fixtures';

const HERE = __dirname;
const WEB = path.resolve(HERE, '..', '..', '..');

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name.startsWith('._') || name === 'node_modules' || name === '.next') continue;
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith('.ts') || p.endsWith('.tsx')) out.push(p);
  }
  return out;
}

export function stripComments(src: string): string {
  const BLOCK = new RegExp('/\\*[\\s\\S]*?\\*/', 'g');
  const LINE = new RegExp('(^|[^:\'"\\x60])//[^\\n]*', 'g');
  return src
    .replace(BLOCK, (m) => m.replace(/[^\n]/g, ' '))
    .replace(LINE, (_m, p1: string) => p1);
}

const WRITE_RE =
  /\b(UPDATE|INSERT\s+INTO|DELETE\s+FROM|TRUNCATE(?:\s+TABLE)?)\s+(?:public\.)?"?([a-z_][a-z0-9_]*)"?/gi;

/**
 * `ON CONFLICT ... DO UPDATE SET` is the upsert half of the INSERT it belongs
 * to. It names no table — by definition of the clause it targets the one the
 * INSERT already named — so `WRITE_RE` reads it as `UPDATE` against a table
 * called `SET`, which is a phantom write against a table that does not exist.
 *
 * Neutralised rather than filtered out downstream, so the scanners keep their
 * property that EVERY write they find is a real write. Added 2026-09-04 with
 * the first upsert in this layer (`canonical-shadow/deferral-store.ts`); the
 * oracle below plants one and asserts exactly one write, against the INSERT's
 * own table.
 */
export function neutraliseUpsertClause(src: string): string {
  return src.replace(/\bdo\s+update\s+set\b/gi, 'do_upsert_set');
}

export function writesIn(src: string): Array<{ verb: string; table: string }> {
  const out: Array<{ verb: string; table: string }> = [];
  for (const m of neutraliseUpsertClause(stripComments(src)).matchAll(WRITE_RE)) {
    out.push({ verb: m[1].toUpperCase().replace(/\s+/g, ' '), table: m[2] });
  }
  return out;
}

/** Anything that could reach the world outside this process. */
const IO_IMPORT_RE =
  /from\s+'(@\/lib\/db\/[^']*|pg|pg-pool|node:fs|node:net|node:dns|fs|net|dns|@vercel\/postgres|drizzle[^']*|knex|@prisma\/client)'/;

const PLAN_WRITERS = [
  'applyAdaptations', 'tryAdaptiveBump', 'actionForAdaptiveRamp', 'planUpgrade',
  'applyProgressionReshape', 'mutatePlan', 'reanchorActivePlan', 'recomputePacesForPlan',
  'refreshRaceRowsForPlan', 'generatePlan', 'persistComposedPlan', 'fireAutoRebuild',
  'writeWorkoutProposals', 'reanchorLthr', 'rebuildActivePlanForPrefs',
] as const;

export function writerNamesIn(src: string): string[] {
  const code = stripComments(src);
  return PLAN_WRITERS.filter((w) => new RegExp(`\\b${w}\\b`).test(code));
}

/**
 * Engine source only.
 *
 * `.test.ts` and `.script.ts` are excluded, matching the predicate the
 * pre-existing `_zero_mutation_scan.test.ts` already uses. Both kinds of file
 * legitimately contain the very strings these guards hunt for: the tests plant
 * violations as oracles, and `_falsify_gates.script.ts` plants them on purpose
 * to prove these guards can fail. Scanning them would make the guards fire on
 * their own falsification harness, which is how this exclusion was discovered.
 *
 * The exclusion is safe because neither kind of file is reachable from the
 * application: nothing in `lib/` or `app/` imports a test or a script, and
 * guard 4 asserts nothing outside imports this directory at all.
 */
const isTestOrScript = (p: string) => /\.(test|script)\.ts$/.test(p);
const ENGINE = walk(HERE).filter((p) => !isTestOrScript(p));

describe('liveness · the scanner read the engine', () => {
  it('found every engine file', () => {
    expect(ENGINE.length).toBeGreaterThanOrEqual(10);
    expect(ENGINE.some((p) => p.endsWith('evaluate.ts'))).toBe(true);
  });

  it('ORACLE · planted violations are all detected', () => {
    expect(writesIn('const q = `UPDATE plan_workouts SET distance_mi = 9`;'))
      .toEqual([{ verb: 'UPDATE', table: 'plan_workouts' }]);
    expect(writerNamesIn('await applyAdaptations(uid, []);')).toEqual(['applyAdaptations']);
    expect(IO_IMPORT_RE.test("import { pool } from '@/lib/db/pool';")).toBe(true);
    // And prose is not flagged.
    expect(writesIn('// never UPDATE plan_workouts here')).toEqual([]);
    expect(writerNamesIn('/* nothing calls applyAdaptations */')).toEqual([]);
  });
});

describe('guard 1 · no engine file issues any write', () => {
  for (const f of ENGINE) {
    it(path.relative(HERE, f), () => {
      expect(writesIn(readFileSync(f, 'utf8'))).toEqual([]);
    });
  }
});

describe('guard 2 · no engine file imports any means of writing', () => {
  for (const f of ENGINE) {
    it(path.relative(HERE, f), () => {
      const code = stripComments(readFileSync(f, 'utf8'));
      expect(IO_IMPORT_RE.test(code), `${path.relative(HERE, f)} imports I/O`).toBe(false);
      expect(code, 'names fetch').not.toMatch(/\bfetch\s*\(/);
      expect(code, 'reads process.env').not.toMatch(/process\.env/);
    });
  }
});

describe('guard 3 · no engine file names a plan writer', () => {
  for (const f of ENGINE) {
    it(path.relative(HERE, f), () => {
      expect(writerNamesIn(readFileSync(f, 'utf8'))).toEqual([]);
    });
  }
});

/**
 * Every VALUE `import { A, B } from '@/lib/adaptation/canonical...'` in
 * `code`, restricted to the PURE ENGINE directory — `canonical` bare or
 * `canonical/...` — never the sibling `canonical-shadow/` directory this
 * same prefix-match would otherwise also catch. The distinction is drawn on
 * what character follows "canonical": a `/` (a subpath) or nothing (the
 * bare directory) is this engine; `-shadow` is a different directory
 * entirely and must not be flagged by a guard whose whole job is watching
 * THIS one.
 *
 * A whole-statement `import type { ... } from '...'` is deliberately OUT OF
 * SCOPE, and that is a principled exclusion, not an oversight: a type-only
 * import is erased at compile time and carries no runtime code at all,
 * which is exactly guard 2's own logic applied one level up ("with no I/O
 * import of any kind, there is no transport for a write to travel on") — a
 * type carries no transport whatsoever, not even a modest one.
 * `run-live-shadow-evaluation.ts` needs `CanonicalDecisionRecord`'s SHAPE to
 * type its own persistence code and imports it as `import type`; that
 * statement produces zero JavaScript and cannot call anything, so it is not
 * a "way in" this guard needs to police. A VALUE import — `import {
 * evaluateAdaptation } from '...'`, with or without other named values
 * mixed in — is what actually runs code, and is everything below.
 */
function canonicalEngineImportsIn(code: string): Array<{ module: string; names: string[] }> {
  const RE = /import\s+(?!type\s)\{([^}]*)\}\s+from\s+'(@\/lib\/adaptation\/[a-zA-Z0-9_/-]+)'/g;
  const out: Array<{ module: string; names: string[] }> = [];
  let m: RegExpExecArray | null;
  // eslint-disable-next-line no-cond-assign
  while ((m = RE.exec(code))) {
    const mod = m[2];
    const rel = mod.replace(/^@\/lib\/adaptation\//, '');
    if (rel !== 'canonical' && !rel.startsWith('canonical/')) continue;
    // A mixed import — `import { measured, type Foo } from '...'` — carries
    // per-specifier `type` prefixes rather than a whole-statement one. A
    // type-prefixed specifier is DROPPED entirely here, not merely
    // unwrapped to its bare name: it imports no runtime value, so it must
    // never appear in `names` for the allowlist to have to authorize.
    const names = m[1].split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0 && !/^type\s/.test(s));
    if (names.length === 0) continue; // every specifier was itself `type X` — no value imported
    out.push({ module: mod, names });
  }
  return out;
}

/**
 * The authorized exceptions. Every entry is (FILE, MODULE, SYMBOLS) —
 * narrower than "this file may import from `canonical/`": each entry names
 * exactly which module inside `canonical/` and exactly which value symbols
 * from it. `run-live-shadow-evaluation.ts` is the pure engine's one call
 * site (`evaluateAdaptation`, per the header's "THE ONE ENTRY POINT"). Two
 * more files are enumerated here because they genuinely need them, not
 * because the allowlist grew casually:
 *
 *   · `live-input.ts` builds the `CanonicalAdaptationInput` the engine
 *     consumes, so it needs `input.ts`'s three `Measured<T>` constructors
 *     (`measured` / `absent` / `failed`) to state Rule 11's three facts
 *     honestly, rather than reaching around them with ad-hoc `{ok:true,...}`
 *     object literals that would silently drift from the engine's own
 *     definition (Rule 16). It separately needs `stimulus.ts`'s
 *     `gradeStimulus`, because the alternative — a second, hand-rolled
 *     stimulus grader inside the loader — is exactly the "one owning
 *     service per coaching decision" duplication
 *     `docs/DOCTRINE_ENFORCEMENT_AND_CLEAN_IMPLEMENTATION.md` §1 forbids.
 *
 * Every symbol below is a PURE, side-effect-free helper — `measured` /
 * `absent` / `failed` are trivial tagged-union constructors, `gradeStimulus`
 * takes plain values and returns a plain assessment — and every file that
 * defines them already passes guards 1-3 above, so none of them can carry a
 * plan write regardless of who calls them. The allowlist exists to catch
 * SCOPE CREEP (a new importer, or an existing one reaching for something
 * new), not because these three symbols are independently suspected of
 * being able to mutate anything.
 */
interface AllowedImport { readonly file: string; readonly module: string; readonly symbols: ReadonlySet<string> }
const ALLOWED_EXCEPTION_FILE = path.join(WEB, 'lib/adaptation/canonical-shadow/run-live-shadow-evaluation.ts');
const ALLOWED_LOADER_FILE = path.join(WEB, 'lib/adaptation/canonical-shadow/live-input.ts');
/**
 * DEMANDWIRE-1 (2026-09-04) · the loader's demand-model half, split into its
 * own file only because `live-input.ts` is already 39 KB. It is the SAME
 * loader by every property this gate cares about, and it is enumerated
 * separately rather than folded into `ALLOWED_LOADER_FILE` so a reader can see
 * exactly which symbols the split bought.
 */
const ALLOWED_DEMAND_LOADER_FILE = path.join(WEB, 'lib/adaptation/canonical-shadow/demand-input.ts');
// MILEAGE-RESPONSIVE-1 (2026-09-04) · see the four grants at the end of
// ALLOWLIST. ONE file, deliberately, so a whole directory's dependence on this
// engine is auditable in one place.
const ALLOWED_VOLUME_EVIDENCE_DOOR = path.join(WEB, 'lib/adaptation/volume-evidence/contract.ts');
const ALLOWLIST: readonly AllowedImport[] = [
  { file: ALLOWED_EXCEPTION_FILE, module: '@/lib/adaptation/canonical/evaluate', symbols: new Set(['evaluateAdaptation']) },
  // DEFERPERSIST-1 (2026-09-04) · the shadow cycle must CARRY THE DEFERRAL
  // QUEUE across boundaries, which is what makes a deferred progression
  // survive a process restart instead of evaporating. Both symbols are PURE:
  // `reconsiderAtBoundary` is a total function of (queue, date, fresh records)
  // returning what to carry and what to retire, and `enqueueDeferrals` folds
  // suppressed records onto a queue. Neither touches a plan, a database or a
  // clock, and neither APPLIES anything — a queued item is re-offered to the
  // engine at its boundary, never auto-applied, and
  // `AUTOMATIC_ADAPTATION_AUTHORITY` is untouched by this grant.
  {
    file: ALLOWED_EXCEPTION_FILE,
    module: '@/lib/adaptation/canonical/deferral-queue',
    symbols: new Set(['enqueueDeferrals', 'reconsiderAtBoundary']),
  },
  { file: ALLOWED_LOADER_FILE, module: '@/lib/adaptation/canonical/input', symbols: new Set(['measured', 'absent', 'failed']) },
  { file: ALLOWED_LOADER_FILE, module: '@/lib/adaptation/canonical/stimulus', symbols: new Set(['gradeStimulus']) },
  // HRCEILING-1 (2026-09-04) · the loader must ask the ONE owner of "what HR
  // ceiling bounds this session's work" rather than reading `hr_cap_bpm` at
  // face value. Taking it at face value graded every threshold session against
  // an easy-day aerobic cap of 149 bpm while the runner's LTHR is 168, which is
  // why this engine had never proposed an increase. A PURE FUNCTION of
  // (intensity domain, stored cap) — it reads no plan, writes nothing, and
  // cannot widen this boundary.
  { file: ALLOWED_LOADER_FILE, module: '@/lib/adaptation/canonical/work-hr-ceiling', symbols: new Set(['workHrCeilingFor']) },
  // HRFLATLINE-1 (2026-09-04) · the loader must also decide whether the HR it
  // is about to hand C4 is a MEASUREMENT. The owner's 2026-09-03 hill session
  // holds one value for a whole 60-second rep — 134 bpm for all 18 samples,
  // 103 for another rep — which is a carried-forward value, and HRPHASE-1 (same
  // day) turns those into the phase means the grader reads. A PURE FUNCTION of
  // sample arrays: no plan, no database, no writes.
  { file: ALLOWED_LOADER_FILE, module: '@/lib/adaptation/canonical/hr-trace-credibility', symbols: new Set(['workTraceIsCredible']) },
  // DEMANDWIRE-1 (2026-09-04) · the loader must now RESOLVE this athlete's
  // weekly demand ceiling, because supplying it as `absent(...)` meant
  // arbitration's rule 1 could not fire on any live evaluation.
  //
  // `resolveAthleteWeeklyDemandCeiling` is a PURE function of the week and the
  // demonstrated weeks handed to it: it reads no plan, opens no pool, writes
  // nothing, and its only outward call is into `lib/plan/adjudication/
  // weekly-demand.ts`, which is itself pure and gated on that property by its
  // own suite. It returns a `Measured<AthleteWeeklyDemandCeiling>` — a
  // refusal-carrying value, never a mutation — and it cannot widen this
  // boundary in any direction.
  { file: ALLOWED_LOADER_FILE, module: '@/lib/adaptation/canonical/demand-ceiling', symbols: new Set(['resolveAthleteWeeklyDemandCeiling']) },
  // And the demand loader's own Rule 8 filter. `prescribedNonNormalWeek` is
  // the engine's ONE reconciliation of the two witnesses that say a week was
  // not normal — the week's own cutback flag and the authoring plan's mode.
  // It is imported rather than reimplemented precisely so this loader cannot
  // become a second answer to "is this a normal week" (Rule 16), which is the
  // question that decides whether a taper week raises the athlete's ceiling.
  // A pure predicate over one `WeekObservation`; it returns a boolean and a
  // sentence.
  { file: ALLOWED_DEMAND_LOADER_FILE, module: '@/lib/adaptation/canonical/input', symbols: new Set(['prescribedNonNormalWeek']) },
  // PHASEARB-1 (2026-09-05) · the loader must now tell the engine WHICH PHASE
  // the affected week is in, because arbitration's lever order is no longer a
  // static global constant. `phaseFromAuthoredLabel` is the ONE translation
  // from the plan generator's own `plan_phases.label` to the engine's phase
  // vocabulary — a pure string switch with a Rule 11 default of UNKNOWN, no
  // I/O, no plan read, no write. It is imported rather than re-implemented so
  // the loader cannot coin a second phase vocabulary (Rule 16), which is
  // exactly the drift that would put a taper week into a BASE ordering.
  { file: ALLOWED_LOADER_FILE, module: '@/lib/adaptation/canonical/phase-priority', symbols: new Set(['phaseFromAuthoredLabel']) },
  // COLDSTART-1 (2026-09-05) · the cold-start policy imports the SIX EVIDENCE
  // BARS this engine's contract already states, and imports them rather than
  // restating them for the reason Rule 16 gives: the thing a runner with no
  // record is asked to demonstrate before his low confidence ends must be the
  // SAME thing an established runner is asked to demonstrate before a lever
  // moves. Two copies of "three consecutive weeks at 95%" would drift the first
  // time either changed, and the cold start would then be calibrating against a
  // bar no lever reads.
  //
  // All six are `export const number` declarations in a file guards 1-3 already
  // prove has no I/O of any kind. `cold-start.ts` itself is pure: no pool, no
  // plan read, no write, and this grant cannot widen that in any direction.
  {
    file: path.join(WEB, 'lib/plan/adjudication/cold-start.ts'),
    module: '@/lib/adaptation/canonical/contract-constants',
    symbols: new Set([
      'LONG_RUN_LOOKBACK_COUNT',
      'LONG_RUN_COMPLETION_MIN_FRAC',
      'THRESHOLD_EVIDENCE_WINDOW_DAYS',
      'THRESHOLD_MIN_QUALIFYING_SESSIONS',
      'VOLUME_MIN_CONSECUTIVE_WEEKS',
      'VOLUME_WEEK_COMPLETION_MIN_FRAC',
    ]),
  },
  // ── A GATE THAT WAS ALREADY RED, FIXED HERE RATHER THAN LEFT ────────────
  //
  // `lib/plan/adjudication/weekly-demand.ts` landed on main in fc9257d2 and
  // imports three COEFFICIENTS from `plan-load.ts` as values. Guard 4 has no
  // entry for it, so THIS GUARD HAS BEEN FAILING ON MAIN SINCE THAT MERGE —
  // verified by running it against the unmodified tree, where it names
  // `_weekly_demand.test.ts` importing `projectPlanLoad`. It is fixed here
  // because Rule 20 says fix the gate, not just the instance, and a red gate
  // nobody has looked at is worth less than no gate at all.
  //
  // The grant is right rather than convenient. The whole reason the demand
  // model imports these three numbers instead of restating them is Rule 16:
  // `plan-load`'s three-term projection and the demand model's seven-component
  // reading are ONE scale, and they can only stay one scale if the shared
  // terms have one definition. They are `const number` declarations and two
  // pure functions in a file guards 1-3 already prove has no I/O of any kind.
  {
    file: path.join(WEB, 'lib/plan/adjudication/weekly-demand.ts'),
    module: '@/lib/adaptation/canonical/plan-load',
    symbols: new Set([
      'QUALITY_MINUTE_TO_EASY_MILE', 'LONG_RUN_SURCHARGE_PER_MI',
      'PACE_SEC_PER_MI_TO_QUALITY_COST',
    ]),
  },
  {
    file: path.join(WEB, 'lib/plan/adjudication/_weekly_demand.test.ts'),
    module: '@/lib/adaptation/canonical/plan-load',
    // The suite's own Rule 16 identity assertion: with no context, the demand
    // model's `demandIndex` must EQUAL `projectPlanLoad(...).demandIndex` for
    // the same week. It has to call the other side to compare against it.
    symbols: new Set(['projectPlanLoad']),
  },
  /* ── MILEAGE-RESPONSIVE-1 (2026-09-04) · FOUR GRANTS, ONE FILE ──────────
   *
   * `lib/adaptation/volume-evidence/` is the shadow-only path from "the runner
   * ran MORE than prescribed" to "future planned mileage increases" -- the
   * question three separate code paths answered downward or not at all. It
   * needs this engine's EVIDENCE VOCABULARY: the `Measured<T>` constructors so
   * a second dialect of "measured / absent / failed" never has to exist (Rule
   * 16), the grade set whose complement that engine's own doc comment warns
   * must not be spent as counter-evidence, and the doctrine constants whose
   * whole point is that the upward and downward paths share them (Rule 21).
   *
   * IT TAKES ONE DOOR. Five files there needed these symbols and the first cut
   * imported them five ways; this guard caught it on the first full-suite run.
   * They now reach the directory through `volume-evidence/contract.ts`, which
   * re-exports them, so the surface below is four grants against ONE file
   * rather than a dozen against five.
   *
   * NOTHING BEHIND THESE GRANTS CAN DECIDE ANYTHING. Two pure constructors, a
   * frozen Set of two grade names, five doctrine constants and a citation
   * string, and one PURE ledger function that takes a queue and returns a
   * queue. There is deliberately no grant for `evaluate`, for any lever, or
   * for `arbitrate`: that directory speaks this engine's vocabulary, it does
   * not run it, and `volume-evidence/_mileage_responsive.test.ts` asserts it
   * holds no writer of its own.
   */
  { file: ALLOWED_VOLUME_EVIDENCE_DOOR, module: '@/lib/adaptation/canonical/input', symbols: new Set(['measured', 'absent', 'failed']) },
  { file: ALLOWED_VOLUME_EVIDENCE_DOOR, module: '@/lib/adaptation/canonical/stimulus', symbols: new Set(['GRADES_THAT_COUNT_AS_EVIDENCE']) },
  { file: ALLOWED_VOLUME_EVIDENCE_DOOR, module: '@/lib/adaptation/canonical/deferral-queue', symbols: new Set(['reconsiderAtBoundary']) },
  // CONTINUOUS-EVIDENCE-1 (2026-09-05) · two more constants through the SAME
  // door, and they REMOVE a duplicate rather than adding a dependency:
  // `weight.ts` had 21 and 28 as its own literals, which was a second
  // definition of the contract's evidence window (Rule 16). Both are inert
  // numbers on a frozen module and neither can decide anything.
  { file: ALLOWED_VOLUME_EVIDENCE_DOOR, module: '@/lib/adaptation/canonical/contract-constants', symbols: new Set(['CONTRACT_DOC', 'VOLUME_MAX_STEP_FRAC', 'VOLUME_MAX_STEPS_PER_CUTBACK_CYCLE', 'VOLUME_MIN_CONSECUTIVE_WEEKS', 'VOLUME_WEEK_COMPLETION_MIN_FRAC', 'THRESHOLD_EVIDENCE_WINDOW_DAYS', 'THRESHOLD_EVIDENCE_WINDOW_DAYS_TIGHT']) },
];

function violatesAllowlist(file: string, imp: { module: string; names: string[] }): boolean {
  const entry = ALLOWLIST.find((e) => e.file === file && e.module === imp.module);
  if (!entry) return true;
  return !(imp.names.length > 0 && imp.names.every((n) => entry.symbols.has(n)));
}

describe('guard 4 · nothing outside imports this engine, nested paths included, except the enumerated authorized entry points', () => {
  const OUTSIDE = [...walk(path.join(WEB, 'lib')), ...walk(path.join(WEB, 'app'))]
    .filter((p) => !p.startsWith(HERE + path.sep));

  it('liveness · the outside world was actually scanned', () => {
    expect(OUTSIDE.length).toBeGreaterThan(200);
  });

  it('liveness · both authorized files exist and were included in the scan', () => {
    expect(OUTSIDE).toContain(ALLOWED_EXCEPTION_FILE);
    expect(OUTSIDE).toContain(ALLOWED_LOADER_FILE);
    expect(OUTSIDE).toContain(ALLOWED_VOLUME_EVIDENCE_DOOR);
  });

  it('ORACLE · a nested import is detected, which the pre-existing flat gate misses', () => {
    const planted = "import { evaluateAdaptation } from '@/lib/adaptation/canonical/evaluate';";
    expect(/@\/lib\/adaptation\/canonical/.test(stripComments(planted))).toBe(true);
    // The pre-existing flat-path ratchet cannot see it. Demonstrated, not
    // asserted in prose, so the claim in this file's header is checkable.
    const FLAT = /import\s+(type\s+)?\{([^}]*)\}\s+from\s+'(@\/lib\/adaptation\/[a-z-]+)'/g;
    expect([...planted.matchAll(FLAT)].length).toBe(0);
  });

  it('ORACLE · the sibling canonical-shadow/ directory is NOT mistaken for the engine directory', () => {
    const benign = "import { roQuery } from './read-only-db';";
    expect(canonicalEngineImportsIn(stripComments(benign))).toEqual([]);
    // And a real import of the SHADOW directory (not the engine) from a
    // third file must not be flagged by this scanner at all — it is a
    // different directory with its own, separate mutation gate
    // (`canonical-shadow/_never_mutates_plan.test.ts`).
    const ofShadowDir = "import { runAndPersistCanonicalShadowEvaluation } from '@/lib/adaptation/canonical-shadow/run-live-shadow-evaluation';";
    expect(canonicalEngineImportsIn(stripComments(ofShadowDir))).toEqual([]);
  });

  it('ORACLE · a whole-statement `import type` from the engine is correctly out of scope, and a VALUE import is not', () => {
    // This is the real statement `run-live-shadow-evaluation.ts` carries,
    // to type its own persistence code against `CanonicalDecisionRecord`'s
    // shape. It produces no JavaScript and cannot call anything, so it must
    // not be treated as "importing the engine" the way a value import is —
    // see the function's own header for why.
    const typeOnly = "import type { CanonicalDecisionRecord } from '@/lib/adaptation/canonical/decision-record';";
    expect(canonicalEngineImportsIn(stripComments(typeOnly))).toEqual([]);
    // But a VALUE import of the exact same module is NOT exempt — the
    // exclusion is about the `type` keyword, never about which file inside
    // `canonical/` is named.
    const sameModuleAsValue = "import { idempotencyKeyFor } from '@/lib/adaptation/canonical/decision-record';";
    const imports = canonicalEngineImportsIn(stripComments(sameModuleAsValue));
    expect(imports).toHaveLength(1);
    expect(violatesAllowlist(ALLOWED_EXCEPTION_FILE, imports[0])).toBe(true); // wrong module — evaluate.ts only
  });

  it('ORACLE · a DIFFERENT file importing evaluateAdaptation is still refused', () => {
    const fromSomeOtherFile = "import { evaluateAdaptation } from '@/lib/adaptation/canonical/evaluate';";
    const imports = canonicalEngineImportsIn(stripComments(fromSomeOtherFile));
    expect(imports).toHaveLength(1);
    const notTheAllowedFile = path.join(WEB, 'lib/some/other/file.ts');
    expect(violatesAllowlist(notTheAllowedFile, imports[0])).toBe(true);
  });

  it('ORACLE · the allowed file importing anything OTHER than evaluateAdaptation is still refused', () => {
    const reachingPastTheEntryPoint =
      "import { evaluateAdaptation, arbitrate } from '@/lib/adaptation/canonical/evaluate';";
    const imports = canonicalEngineImportsIn(stripComments(reachingPastTheEntryPoint));
    expect(imports).toHaveLength(1);
    expect(violatesAllowlist(ALLOWED_EXCEPTION_FILE, imports[0])).toBe(true);

    const fromADifferentModuleInTheEngine =
      "import { admissibility } from '@/lib/adaptation/canonical/admissibility';";
    const imports2 = canonicalEngineImportsIn(stripComments(fromADifferentModuleInTheEngine));
    expect(imports2).toHaveLength(1);
    expect(violatesAllowlist(ALLOWED_EXCEPTION_FILE, imports2[0])).toBe(true);
  });

  it('ORACLE · the allowed file importing exactly evaluateAdaptation from exactly evaluate.ts passes', () => {
    const exact = "import { evaluateAdaptation } from '@/lib/adaptation/canonical/evaluate';";
    const imports = canonicalEngineImportsIn(stripComments(exact));
    expect(imports).toHaveLength(1);
    expect(violatesAllowlist(ALLOWED_EXCEPTION_FILE, imports[0])).toBe(false);
  });

  it('ORACLE · the loader importing its own two enumerated grants passes', () => {
    const fromInput = "import { measured, absent, failed } from '@/lib/adaptation/canonical/input';";
    const imports1 = canonicalEngineImportsIn(stripComments(fromInput));
    expect(imports1).toHaveLength(1);
    expect(violatesAllowlist(ALLOWED_LOADER_FILE, imports1[0])).toBe(false);

    const fromStimulus = "import { gradeStimulus } from '@/lib/adaptation/canonical/stimulus';";
    const imports2 = canonicalEngineImportsIn(stripComments(fromStimulus));
    expect(imports2).toHaveLength(1);
    expect(violatesAllowlist(ALLOWED_LOADER_FILE, imports2[0])).toBe(false);
  });

  it('ORACLE · the loader reaching for evaluateAdaptation itself is still refused — that grant belongs to the OTHER file', () => {
    const overreach = "import { evaluateAdaptation } from '@/lib/adaptation/canonical/evaluate';";
    const imports = canonicalEngineImportsIn(stripComments(overreach));
    expect(imports).toHaveLength(1);
    expect(violatesAllowlist(ALLOWED_LOADER_FILE, imports[0])).toBe(true);
  });

  it('ORACLE · the loader importing an UNLISTED symbol from an otherwise-allowed module is refused', () => {
    // `directionOf` is a real export of evaluate.ts, and this file's module
    // is one of the loader's two allowed ones for INPUT, not for
    // evaluate.ts — a mismatched grant must not be honoured.
    const wrongModuleForLoader = "import { evaluateAdaptation } from '@/lib/adaptation/canonical/evaluate';";
    expect(violatesAllowlist(ALLOWED_LOADER_FILE, canonicalEngineImportsIn(stripComments(wrongModuleForLoader))[0])).toBe(true);
    // And an unlisted VALUE from a module the loader IS allowed to touch —
    // e.g. some future export of input.ts beyond measured/absent/failed —
    // must also be refused, not waved through because the module matched.
    const unlistedFromAllowedModule = "import { measured, someNewExport } from '@/lib/adaptation/canonical/input';";
    const imports = canonicalEngineImportsIn(stripComments(unlistedFromAllowedModule));
    expect(imports).toHaveLength(1);
    expect(violatesAllowlist(ALLOWED_LOADER_FILE, imports[0])).toBe(true);
  });

  it('ORACLE · a THIRD, unenumerated file importing the loader\'s own grants is still refused', () => {
    const fromSomeOtherFile = "import { measured } from '@/lib/adaptation/canonical/input';";
    const imports = canonicalEngineImportsIn(stripComments(fromSomeOtherFile));
    expect(imports).toHaveLength(1);
    const notEnumerated = path.join(WEB, 'lib/somewhere/else.ts');
    expect(violatesAllowlist(notEnumerated, imports[0])).toBe(true);
  });

  it('no file outside this directory references the engine except the enumerated authorized imports', () => {
    for (const f of OUTSIDE) {
      const code = stripComments(readFileSync(f, 'utf8'));
      const imports = canonicalEngineImportsIn(code);
      for (const imp of imports) {
        expect(
          violatesAllowlist(f, imp),
          `${path.relative(WEB, f)} imports {${imp.names.join(', ')}} from '${imp.module}' — this is `
          + 'not one of the enumerated (file, module, symbols) grants in ALLOWLIST above '
          + '(see this file\'s header, "THE AUTHORIZED EXCEPTIONS")',
        ).toBe(false);
      }
    }
  });
});

describe('guard 5 · the entry point is pure, demonstrated by running it', () => {
  it('the same input produces a byte-identical result, and mutates nothing', () => {
    const input = baseInput({ weeks: threeGoodWeeks(), longRuns: twoGoodLongRuns() });
    const snapshot = JSON.stringify(input);

    const a = evaluateAdaptation(input);
    const b = evaluateAdaptation(input);

    // Determinism. This is also the core of the idempotency guarantee: the same
    // evidence evaluated twice cannot produce two different answers.
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    // The input is untouched. A function that rewrote its own argument would be
    // one refactor away from rewriting a plan object it was handed.
    expect(JSON.stringify(input)).toBe(snapshot);
  });

  it('a refusal is a returned record, never a throw', () => {
    const unreadable = baseInput({ readable: false });
    const out = evaluateAdaptation(unreadable);
    expect(out.records).toHaveLength(3);
    expect(out.records.every((r) => r.decision === 'REFUSE')).toBe(true);
    // And it still explains itself.
    expect(out.records.every((r) => r.reason.length > 0)).toBe(true);
    expect(out.records.every((r) => r.whatWouldChangeIt.length > 0)).toBe(true);
  });

  it('no record ever proposes a change to completed history', () => {
    const input = baseInput({
      weeks: threeGoodWeeks(),
      longRuns: twoGoodLongRuns(),
    });
    for (const r of evaluateAdaptation(input).records) {
      expect(r.planDiff.touchesCompletedHistory).toBe(false);
      const inv = r.invariants.find((i) => i.id === 'INV_COMPLETED_HISTORY_IMMUTABLE');
      if (inv) expect(inv.passed).toBe(true);
    }
  });
});
