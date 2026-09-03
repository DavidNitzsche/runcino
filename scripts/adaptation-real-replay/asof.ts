/**
 * scripts/adaptation-real-replay/asof.ts · NO LOOKAHEAD AS A COMPILE ERROR,
 * NOT AS A DISCIPLINE.
 *
 * The replay already had the property. What it did not have was a REASON the
 * property holds other than that somebody wrote the filter correctly:
 * `buildInputAt` opened with a local `before()` closure and every collection
 * was passed through it by hand. Three attack tests then proved, after the
 * fact, that no leak had occurred. That is the shape CLAUDE.md Rule 20 calls a
 * hypothesis — a rule held up by care plus a test, where the next person to add
 * a fourth collection has to remember the convention, and nothing stops them if
 * they do not.
 *
 * `web-v2/lib/training/normal-window.ts` set the pattern this file copies.
 * `NormalReading<T>`'s refusal branch carries no `value` field at all, so
 * `reading.value` does not compile until the caller has branched. Rule 11
 * stopped being a discipline there and became a type error. The same move is
 * available here.
 *
 * ── THE MOVE ───────────────────────────────────────────────────────────────
 *
 * A sealed collection HAS NO ARRAY SURFACE. `SealedEvidence<T>` declares no
 * `filter`, no `find`, no `map`, no `length`, no index signature and no
 * iterator. So:
 *
 *     history.runs.filter(r => r.date < asOf)   // does not compile
 *     history.runs[0]                            // does not compile
 *     for (const r of history.runs)              // does not compile
 *
 * The only way to obtain rows is to name a moment, and the rows you get back
 * are branded with it. There is no correct-usage and incorrect-usage pair to
 * choose between; there is one door.
 *
 * ── TWO KINDS OF ROW, AND THEY SHARE NO MEMBER ─────────────────────────────
 *
 * The naive fence — "nothing dated after the decision point" — is wrong, and
 * wrong in the direction that gets fences deleted. A race on 2026-12-06 is on
 * the calendar in June. Next Tuesday's prescription is written today; the
 * engine is being asked whether to change it, so of course it may read it. A
 * single backwards-only door makes both unreachable.
 *
 * The real distinction is not past-versus-future. It is OUTCOME versus
 * ARTIFACT:
 *
 *     Evidence<T> · what the runner DID. Knowable only after the fact, so it
 *                   is admitted strictly before the decision point.
 *     Authored<T> · what somebody WROTE DOWN. Knowable from the moment it was
 *                   authored, in both time directions, so it is admitted when
 *                   its author was visible — never when its own date passed.
 *
 * Sealing a prescription by its own date would be the wrong axis and would
 * quietly permit the real leak: a plan authored on 31 August repricing a week
 * in June. It is the AUTHORING time that gates an artifact, which is why
 * `Authored<T>` can only be obtained through a `VisiblePlan` token, and a
 * `VisiblePlan` can only be obtained from plans that were already authored.
 *
 * The two brands share no member — this repo's own S1.3 pattern, "separately
 * branded unions that share no member, so the false substitution cannot
 * type-check" — so no function that consumes evidence can be handed artifacts,
 * whatever the underlying row type is.
 *
 * ── AND A FORWARD READ CANNOT RETURN A RESULT ──────────────────────────────
 *
 * Disjoint brands stop a mix-up. They do not stop the subtler leak: reading a
 * real field off a real future row — a race's finish time, five months before
 * it is run. So the forward door on a calendar takes a PROJECTION and returns
 * only what the projection produced. `races` projects to identity and date.
 * There is no expression downstream that reads a future race's `finishS`,
 * because the type that would carry it does not exist past that boundary.
 *
 * Runs get `sealEvidence`, which has no forward door at all. A run cannot be
 * known before it is run, so the door is not narrowed — it is absent.
 *
 * ── RULE 18 · HOW THIS GATE IS FALSIFIED ───────────────────────────────────
 *
 * A type-level gate fails at compile time, so it is falsified at compile time.
 * `_asof_typecheck.ts` holds one `@ts-expect-error` per property this file
 * claims, and `_asof_fence.test.ts` runs `tsc --noEmit` over it. Weaken the
 * fence — add an array surface back, merge the brands, widen the projection —
 * and the expected error stops occurring, TypeScript reports the now-unused
 * `@ts-expect-error` as an error of its own, and the test fails.
 *
 * That was run rather than assumed; the falsification log is in the test.
 *
 * ── RULE 22 · WHAT THIS FENCE CANNOT FAIL ON ───────────────────────────────
 *
 * · **A wrong date on a row.** The fence enforces an ordering over `dateOf`.
 *   If the extract stamped a run with the wrong date, the fence admits it, on
 *   time, wrongly.
 * · **A leak through a value rather than a collection.** A seeded belief, a
 *   constant or an anchor computed from the whole season and passed in through
 *   `BuildArgs` is not a collection and this file never sees it. The seed
 *   threshold anchor is exactly such a value; it is argued in `build-input.ts`
 *   and is not protected here.
 * · **Anything outside the decision path.** `realHistory()` still returns plain
 *   arrays, deliberately, because the extract-integrity assertions in
 *   `real-replay.test.ts` ("156 runs, 11 races, the AFC half finished in
 *   6113 s") are not decisions and must see everything at once. The fence
 *   guards the door into the engine, not every read of the file.
 * · **Whether a projection is the RIGHT projection.** It can prove nothing
 *   reads a future `finishS`. It cannot prove that identity and date are the
 *   only two things about a future race that ought to be knowable.
 * · **An author who reaches around it.** Importing `realHistory()` directly
 *   into the decision path compiles fine. That is a source-shape question, and
 *   it is checked by a scan in `_asof_fence.test.ts` rather than by a type.
 */

/* ══════════════════════════════════════════════════════════════════════════
 * THE MOMENT
 * ═══════════════════════════════════════════════════════════════════════ */

declare const AS_OF_BRAND: unique symbol;

/**
 * A decision point. A plain `string` is not one: the brand is unforgeable
 * outside this module, so a caller cannot pass a date it computed from a row it
 * should not have been reading.
 */
export type AsOf = string & { readonly [AS_OF_BRAND]: 'as-of' };

/** The only constructor. Normalises to a calendar day. */
export function asOf(iso: string): AsOf {
  if (typeof iso !== 'string' || iso.length < 10) {
    throw new Error(`[asof] '${iso}' is not a date this fence can order against.`);
  }
  return iso.slice(0, 10) as AsOf;
}

/** For a message or a key. Never for a comparison against a row. */
export function asOfISO(a: AsOf): string {
  return a as string;
}

/* ══════════════════════════════════════════════════════════════════════════
 * THE TWO KINDS  ·  disjoint by construction
 * ═══════════════════════════════════════════════════════════════════════ */

declare const EVIDENCE_BRAND: unique symbol;
declare const AUTHORED_BRAND: unique symbol;

/**
 * Outcomes, strictly before the moment. What the runner did.
 *
 * A real readonly array, so every ordinary operation works on it. What it is
 * not is assignable FROM a bare array, and it is not assignable TO
 * `Authored<T>`.
 */
export type Evidence<T> = readonly T[] & { readonly [EVIDENCE_BRAND]: AsOf };

/**
 * Artifacts, visible because whoever wrote them had already written them.
 * Prescriptions, week structure, the race calendar.
 *
 * Never evidence. Nothing here says what the runner did.
 */
export type Authored<T> = readonly T[] & { readonly [AUTHORED_BRAND]: AsOf };

/**
 * Why a forward read is legitimate. A closed union rather than a free-text
 * comment, so the set of arguments for reading past the decision point is
 * enumerable and reviewable in one place instead of restated at each call site.
 */
export type AuthoredReason =
  /** A race date is published months ahead. Knowing it is not lookahead. */
  | 'RACE_DATE_IS_PUBLISHED_IN_ADVANCE'
  /** The prescription for a future day is what the engine is asked to change. */
  | 'PRESCRIPTION_IS_AUTHORED_IN_ADVANCE'
  /** Cutback, peak and race-week flags are stamped at authoring. */
  | 'PLAN_WEEK_STRUCTURE_IS_AUTHORED_IN_ADVANCE';

/* ══════════════════════════════════════════════════════════════════════════
 * THE SEALS
 * ═══════════════════════════════════════════════════════════════════════ */

/**
 * A collection that can only be read backwards.
 *
 * Note what is absent: `filter`, `find`, `map`, `length`, `[n]` and the
 * iterator. That absence is the whole mechanism.
 */
export interface SealedEvidence<T> {
  /** The one door. Rows with `dateOf(row) < asOf`. */
  readonly before: (a: AsOf) => Evidence<T>;
  /**
   * How many rows exist across all time. A count is not a leak, and the
   * extract-integrity checks need it. It cannot be used to read a row.
   */
  readonly total: number;
  /** For diagnostics. Never a row. */
  readonly kind: string;
}

/**
 * A collection with a legitimate forward reading, narrowed to a projection.
 *
 * `F` is what a future row is allowed to BE. For races that is identity and
 * date; the finish time has no representation on this side of the door.
 */
export interface SealedCalendar<T, F> extends SealedEvidence<T> {
  /** Rows with `dateOf(row) >= asOf`, projected. The reason is required. */
  readonly fromInclusive: (a: AsOf, why: AuthoredReason) => Authored<F>;
}

/**
 * A collection of artifacts whose visibility is decided by their AUTHOR, not by
 * their own date.
 *
 * The token is the mechanism: rows come out only when a `VisiblePlan` is handed
 * in, and a `VisiblePlan` is only mintable from plans that were themselves
 * admitted as evidence at the same moment. So a plan authored after the
 * decision point cannot contribute its prescriptions to it — including its
 * prescriptions for weeks in the PAST, which is the leak a date-based fence
 * would wave straight through.
 */
export interface SealedAuthored<T> {
  readonly ofPlan: (plan: VisiblePlan, why: AuthoredReason) => Authored<T>;
  /** Every visible plan's rows at once, for enumeration that spans versions. */
  readonly ofAnyVisiblePlan: (plans: readonly VisiblePlan[], why: AuthoredReason) => Authored<T>;
  readonly total: number;
  readonly kind: string;
}

declare const VISIBLE_PLAN_BRAND: unique symbol;

/**
 * A plan version that had already been authored at the decision point.
 *
 * The brand is what makes `SealedAuthored` work: `ofPlan` cannot be called with
 * a plan id read out of a row, only with a token minted by `admitPlan` from
 * plans that came through `SealedEvidence.before`.
 */
export interface VisiblePlan {
  readonly planId: string;
  readonly [VISIBLE_PLAN_BRAND]: AsOf;
}

/**
 * Mint the token. Takes the plan row from an `Evidence<P>` collection, so a
 * plan the fence has not already admitted cannot be turned into one.
 */
export function admitPlan<P extends { planId: string }>(
  plans: Evidence<P>, plan: P, a: AsOf,
): VisiblePlan {
  if (!(plans as readonly P[]).includes(plan)) {
    throw new Error(
      `[asof] plan '${plan.planId}' was not admitted as evidence at ${a as string}, `
      + 'so its prescriptions cannot be read at that moment.',
    );
  }
  // The brand is a `declare const unique symbol`, which exists only in the type
  // system. Writing it as a runtime computed key would throw, so the token
  // carries the plan id and the moment and is branded by the cast — the brand's
  // whole job is to make the type unforgeable, not to be present at run time.
  return { planId: plan.planId, asOf: a } as unknown as VisiblePlan;
}

/** A row whose date cannot be read is admitted nowhere. Rule 11: not "before". */
type DateOf<T> = (row: T) => string | null | undefined;

function partition<T>(
  rows: readonly T[], dateOf: DateOf<T>, a: AsOf,
): { past: T[]; future: T[] } {
  const cut = a as string;
  const past: T[] = [];
  const future: T[] = [];
  for (const row of rows) {
    const iso = dateOf(row);
    // Rule 11 · an unreadable date is neither past nor future. It is dropped
    // from BOTH sides and is invisible to every decision, rather than
    // defaulting into one of them, which is how an undated row becomes
    // evidence.
    if (typeof iso !== 'string' || iso.length < 10) continue;
    (iso.slice(0, 10) < cut ? past : future).push(row);
  }
  return { past, future };
}

/** Seal a collection that can only ever be known after the fact. */
export function sealEvidence<T>(
  kind: string, rows: readonly T[], dateOf: DateOf<T>,
): SealedEvidence<T> {
  return {
    kind,
    total: rows.length,
    before: (a) => partition(rows, dateOf, a).past as unknown as Evidence<T>,
  };
}

/**
 * Seal a collection with a legitimate forward reading.
 *
 * `project` decides what a future row IS. Everything it does not copy is
 * unreachable past the boundary — not by convention, by the absence of the
 * field on the returned type.
 */
export function sealCalendar<T, F>(
  kind: string, rows: readonly T[], dateOf: DateOf<T>, project: (row: T) => F,
): SealedCalendar<T, F> {
  return {
    kind,
    total: rows.length,
    before: (a) => partition(rows, dateOf, a).past as unknown as Evidence<T>,
    fromInclusive: (a, _why) =>
      partition(rows, dateOf, a).future.map(project) as unknown as Authored<F>,
  };
}

/** Seal artifacts gated by their plan's authoring, not by their own date. */
export function sealAuthored<T extends { planId: string }>(
  kind: string, rows: readonly T[],
): SealedAuthored<T> {
  const byPlan = new Map<string, T[]>();
  for (const row of rows) {
    const bucket = byPlan.get(row.planId);
    if (bucket) bucket.push(row); else byPlan.set(row.planId, [row]);
  }
  return {
    kind,
    total: rows.length,
    ofPlan: (plan, _why) => (byPlan.get(plan.planId) ?? []) as unknown as Authored<T>,
    ofAnyVisiblePlan: (plans, _why) =>
      plans.flatMap((p) => byPlan.get(p.planId) ?? []) as unknown as Authored<T>,
  };
}

/* ══════════════════════════════════════════════════════════════════════════
 * HELPERS THAT KEEP THE BRAND
 * ═══════════════════════════════════════════════════════════════════════ */

/**
 * Narrow evidence without losing the brand.
 *
 * A caller who writes `[...ev].filter(p)` gets a plain array back and has
 * silently left the fence. This keeps them inside it, and it can only narrow:
 * there is no way to ADD a row to an `Evidence<T>` through this module.
 */
export function narrow<T>(ev: Evidence<T>, p: (row: T) => boolean): Evidence<T> {
  return (ev as readonly T[]).filter(p) as unknown as Evidence<T>;
}

/** The same, for artifacts. */
export function narrowAuthored<F>(s: Authored<F>, p: (row: F) => boolean): Authored<F> {
  return (s as readonly F[]).filter(p) as unknown as Authored<F>;
}
