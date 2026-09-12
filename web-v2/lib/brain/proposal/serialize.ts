/**
 * lib/brain/proposal/serialize.ts · AN ACTION THAT SURVIVES THE DATABASE.
 *
 * ── WHY A PROPOSAL NEEDS ONE ───────────────────────────────────────────────
 *
 * `plan_workout_proposals.action_payload` carried three fields — `newType`,
 * `newDate`, `shaveFraction` — and `staleness.ts:actionFromPending`
 * RECONSTRUCTS a `BrainAction` from them by guessing which of five engine kinds
 * wrote the row. That works for the five kinds that exist and cannot work for
 * the sixteen that do not: there is no field in that payload that could carry a
 * rep count, a recovery interval or a coordinated part list.
 *
 * So the action itself is stored. `action_payload` is jsonb with no constraint,
 * which is the same property `reprice` and `newDistanceMi` already used — no
 * migration, and the column could always have held this. What changes is that
 * the propose lane now carries the DECISION rather than a lossy summary of it,
 * and the reader stops inferring.
 *
 * ── READING IS DEFENSIVE, WRITING IS NOT ───────────────────────────────────
 *
 * A stored payload is DATA. It was written by an older build, possibly by a
 * kind this build no longer has, possibly by a partial write. So
 * `deserializeAction` type-checks every field it reads and returns `null` for
 * anything it cannot fully reconstruct — never a partially-filled action, and
 * never a no-op one. Rule 11: a payload that cannot be read is a refusal the
 * caller must handle, not an action that applies nothing while reporting
 * success.
 *
 * ── WHAT THIS CANNOT FAIL ON (Rule 22) ─────────────────────────────────────
 *
 * · WHETHER THE ROUND TRIP IS SEMANTICALLY RIGHT. It proves the same values
 *   come back, not that the values were right going in. `validate.ts` is the
 *   coherence check and it is deliberately run on the way out as well as in.
 * · A FIELD ADDED TO A MEMBER AND NOT ADDED HERE. The writer is
 *   `JSON.parse(JSON.stringify(action))`, so a new field is written; the READER
 *   is hand-built per kind, so a new field is silently dropped on the way back.
 *   `_action_completeness.test.ts`'s round-trip assertion is what catches that,
 *   by comparing the whole object rather than a field list — which means the
 *   protection lives in the test, not in this file, and would go with it.
 *
 * ── WHY THE READERS ARE A RECORD AND NOT A SWITCH (2026-09-05) ─────────────
 *
 * A `switch` with a `default: return null` is TOTAL AT RUNTIME and not at
 * COMPILE TIME, which is exactly the wrong way round for this file: a
 * twenty-second kind added to the union compiled, serialized, and came back
 * `null` — a card the runner could never be shown, reported by nothing. Every
 * other owner in this lane (`plannedWrites`, `executorFor`, `undoWritesFor`,
 * `ledgerFacetsOf`, `watchBehaviorOf`, `validateAction`, `actionHeadline`) is
 * exhaustive by a `never` check and fails the BUILD. This one could not be,
 * because it must still answer null for a kind that is not in the union at all
 * — a payload written by another build.
 *
 * `Readonly<Record<ActionKind, Reader>>` gets both: the compiler demands an
 * entry for every member, and the lookup still misses for a foreign string.
 */

import {
  ACTION_SCHEMA_VERSION,
  type ActionDirection,
  type ActionKind,
  type BrainAction,
  type Quantity,
  type RowBefore,
} from './action';

/** The stored shape. Deliberately just the action plus its version stamp. */
export interface StoredAction {
  readonly v: typeof ACTION_SCHEMA_VERSION;
  readonly action: Record<string, unknown>;
}

/**
 * An action, as jsonb.
 *
 * `undefined` is not a JSON value, so a field the action deliberately omitted
 * (Rule 11's "not recorded", as against `null`'s "recorded as nothing") must
 * DISAPPEAR rather than become null. `JSON.stringify` does exactly that for
 * object properties, which is why the round trip goes through it rather than
 * through a hand-built copy that would have to remember.
 */
export function serializeAction(action: BrainAction): StoredAction {
  return {
    v: ACTION_SCHEMA_VERSION,
    action: JSON.parse(JSON.stringify(action)) as Record<string, unknown>,
  };
}

/**
 * Read a stored action back, or refuse.
 *
 * Accepts either a `StoredAction` envelope or a bare action object, because the
 * first rows written under this scheme carry the envelope and a caller holding
 * only `action_payload.action` should not have to know which.
 */
export function deserializeAction(raw: unknown): BrainAction | null {
  if (raw == null || typeof raw !== 'object') return null;
  const outer = raw as Record<string, unknown>;
  const body = (outer.action != null && typeof outer.action === 'object')
    ? outer.action as Record<string, unknown>
    : outer;

  const version = typeof outer.v === 'number' ? outer.v : body.schemaVersion;
  if (version !== ACTION_SCHEMA_VERSION) return null;

  const direction = dir(body.direction);
  const before = beforeList(body.before);
  if (direction === null || before === null) return null;
  const base = { schemaVersion: ACTION_SCHEMA_VERSION, direction, before } as const;

  /* Rule 11 · a kind this build does not have is not a no-op. The caller
   * withholds the card rather than applying nothing and reporting success.
   * The lookup misses for a foreign string; the RECORD is what stops a kind
   * this build DOES have from reaching that same miss. */
  const reader = typeof body.kind === 'string'
    ? (READERS as Partial<Record<string, Reader>>)[body.kind]
    : undefined;
  return reader === undefined ? null : reader(body, base);
}

/** One stored payload, one member of the union, or a refusal. */
type Reader = (
  body: Record<string, unknown>,
  base: { readonly schemaVersion: typeof ACTION_SCHEMA_VERSION;
    readonly direction: ActionDirection; readonly before: readonly RowBefore[] },
) => BrainAction | null;

/**
 * A READER PER KIND, TOTAL AT COMPILE TIME.
 *
 * A member added to `BrainAction` without an entry here fails `tsc`. That is
 * the property the old `switch (body.kind)` could not have, because its
 * `default` arm is load-bearing for foreign payloads and a `default` arm is
 * exactly what stops a compiler noticing a missing case.
 */
const READERS: Readonly<Record<ActionKind, Reader>> = {
  PACE_CHANGE: (body, base) => {
    const to = qty(body.to);
    const lever = oneOf(body.lever, ['THRESHOLD', 'MARATHON', 'INTERVAL', 'EASY'] as const);
    return to !== null && lever !== null ? { ...base, kind: 'PACE_CHANGE', to, lever } : null;
  },
  DISTANCE_CHANGE: (body, base) => {
    /* `to` is legitimately null — a decision made without a target distance —
     * so null must round-trip as null and an unreadable value must NOT. */
    const to = body.to === null ? null : qty(body.to);
    if (body.to !== null && to === null) return null;
    if (body.ofBefore === undefined) return { ...base, kind: 'DISTANCE_CHANGE', to };
    const ofBefore = num(body.ofBefore);
    if (ofBefore === null) return null;
    return { ...base, kind: 'DISTANCE_CHANGE', to, ofBefore };
  },
  DURATION_CHANGE: (body, base) => {
    const to = qty(body.to);
    return to !== null ? { ...base, kind: 'DURATION_CHANGE', to } : null;
  },
  DURATION_PROGRESS_OFFER: (body, base) => {
    const to = qty(body.to);
    return to !== null ? { ...base, kind: 'DURATION_PROGRESS_OFFER', to } : null;
  },
  REPETITION_CHANGE: (body, base) => {
    const to = qty(body.to);
    return to !== null ? { ...base, kind: 'REPETITION_CHANGE', to } : null;
  },
  RECOVERY_INTERVAL_CHANGE: (body, base) => {
    const to = qty(body.to);
    return to !== null ? { ...base, kind: 'RECOVERY_INTERVAL_CHANGE', to } : null;
  },
  QUALITY_DOSE_CHANGE: (body, base) => {
    const to = qty(body.to);
    const lever = oneOf(body.lever, ['THRESHOLD', 'MARATHON', 'INTERVAL'] as const);
    return to !== null && lever !== null ? { ...base, kind: 'QUALITY_DOSE_CHANGE', to, lever } : null;
  },
  LONG_RUN_STRUCTURE_CHANGE: (body, base) => {
    const to = str(body.to); const describe = str(body.describe);
    return to !== null && describe !== null
      ? { ...base, kind: 'LONG_RUN_STRUCTURE_CHANGE', to, describe } : null;
  },
  WORKOUT_TYPE_CHANGE: (body, base) => {
    const to = str(body.to);
    return to !== null ? { ...base, kind: 'WORKOUT_TYPE_CHANGE', to } : null;
  },
  ADD_WORKOUT: (body, base) => {
    const dateISO = str(body.dateISO); const type = str(body.type);
    const distanceMi = num(body.distanceMi);
    return dateISO !== null && type !== null && distanceMi !== null
      ? { ...base, kind: 'ADD_WORKOUT', dateISO, type, distanceMi } : null;
  },
  REMOVE_WORKOUT: (_body, base) => ({ ...base, kind: 'REMOVE_WORKOUT' }),
  FREQUENCY_CHANGE: (body, base) => {
    const to = qty(body.to);
    return to !== null ? { ...base, kind: 'FREQUENCY_CHANGE', to } : null;
  },
  RESCHEDULE: (body, base) => {
    const toDateISO = str(body.toDateISO);
    if (toDateISO === null) return null;
    const swap = body.swapWithId === null ? null : str(body.swapWithId);
    if (body.swapWithId !== null && swap === null) return null;
    return { ...base, kind: 'RESCHEDULE', toDateISO, swapWithId: swap };
  },
  COORDINATED: (body, base) => {
    const describe = str(body.describe);
    if (describe === null || !Array.isArray(body.parts)) return null;
    const parts: BrainAction[] = [];
    for (const p of body.parts) {
      const one = deserializeAction(p);
      // A coordinated action is applied whole or not at all, so a part that
      // cannot be read poisons the decision rather than shrinking it.
      if (one === null) return null;
      parts.push(one);
    }
    return { ...base, kind: 'COORDINATED', describe, parts };
  },
  RACE_TARGET_CHANGE: (body, base) => {
    const raceSlug = str(body.raceSlug); const toSecPerMi = num(body.toSecPerMi);
    return raceSlug !== null && toSecPerMi !== null
      ? { ...base, kind: 'RACE_TARGET_CHANGE', raceSlug, toSecPerMi } : null;
  },
  TAPER_CHANGE: (body, base) => {
    const describe = str(body.describe);
    return describe !== null ? { ...base, kind: 'TAPER_CHANGE', describe } : null;
  },
  RECOVERY_CHANGE: (body, base) => {
    const describe = str(body.describe);
    return describe !== null ? { ...base, kind: 'RECOVERY_CHANGE', describe } : null;
  },
  CONDITIONAL: (body, base) => {
    const defaultTo = qty(body.defaultTo); const earnedTo = qty(body.earnedTo);
    const assessOnISO = str(body.assessOnISO);
    return defaultTo !== null && earnedTo !== null && assessOnISO !== null
      ? { ...base, kind: 'CONDITIONAL', defaultTo, earnedTo, assessOnISO } : null;
  },
  FIELD_TEST: (body, base) => {
    const describe = str(body.describe);
    return describe !== null ? { ...base, kind: 'FIELD_TEST', describe } : null;
  },
  HOLD: (body, base) => {
    const because = str(body.because);
    return because !== null ? { ...base, kind: 'HOLD', because } : null;
  },
  REFUSAL: (body, base) => {
    const because = str(body.because);
    return because !== null ? { ...base, kind: 'REFUSAL', because } : null;
  },
  SAFETY_STOP: (body, base) => {
    const because = str(body.because);
    if (because === null) return null;
    const until = body.until === null ? null : str(body.until);
    if (body.until !== null && until === null) return null;
    return { ...base, kind: 'SAFETY_STOP', because, until };
  },
};

/* ── readers · each returns null rather than a coerced value ────────────── */

/**
 * A string, or null when the value is NOT A STRING.
 *
 * The empty string is returned as itself. An earlier cut read `''` as null,
 * which is COERCION-1's zero-erasure shape in miniature: "the field held an
 * empty sentence" and "the field was not a string" are different facts, and a
 * reader that collapses them makes a malformed row indistinguishable from a
 * type error. Whether an empty `describe` is acceptable is
 * `validateAction`'s question, and it refuses one.
 */
function str(v: unknown): string | null {
  return typeof v === 'string' ? v : null;
}

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function dir(v: unknown): ActionDirection | null {
  return oneOf(v, ['MORE', 'LESS', 'NEUTRAL', 'STOP'] as const);
}

function oneOf<T extends string>(v: unknown, allowed: readonly T[]): T | null {
  return typeof v === 'string' && (allowed as readonly string[]).includes(v) ? v as T : null;
}

function qty(v: unknown): Quantity | null {
  if (v == null || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  const unit = oneOf(o.unit, ['mi', 'min', 'sec_per_mi', 'reps', 'count'] as const);
  const value = num(o.value);
  return unit && value !== null ? { unit, value } as Quantity : null;
}

/**
 * The before list, preserving the three-state distinction exactly.
 *
 * A field that was ABSENT stays absent; a field stored as `null` comes back as
 * `null`. Collapsing them here would undo the whole point of `RowBefore`'s
 * optionality and would make the staleness check refuse every legacy card.
 */
function beforeList(v: unknown): readonly RowBefore[] | null {
  if (!Array.isArray(v)) return null;
  const out: RowBefore[] = [];
  for (const raw of v) {
    if (raw == null || typeof raw !== 'object') return null;
    const o = raw as Record<string, unknown>;
    const id = str(o.planWorkoutId);
    if (id === null) return null;
    const row: Record<string, unknown> = { planWorkoutId: id };
    if ('dateISO' in o) { const d = str(o.dateISO); if (d === null) return null; row.dateISO = d; }
    if ('type' in o) { const t = str(o.type); if (t === null) return null; row.type = t; }
    if ('distanceMi' in o) {
      if (o.distanceMi === null) row.distanceMi = null;
      else { const n = num(o.distanceMi); if (n === null) return null; row.distanceMi = n; }
    }
    if ('paceTargetSecPerMi' in o) {
      if (o.paceTargetSecPerMi === null) row.paceTargetSecPerMi = null;
      else { const n = num(o.paceTargetSecPerMi); if (n === null) return null; row.paceTargetSecPerMi = n; }
    }
    if ('planVersion' in o) {
      if (o.planVersion === null) row.planVersion = null;
      else { const s = str(o.planVersion); if (s === null) return null; row.planVersion = s; }
    }
    /* UNDOCOMPLETE-1 · the five shape fields an undo restores. Read exactly as
     * the five above are: present-and-null is a recorded nothing, absent stays
     * absent, and a value of the wrong TYPE poisons the whole payload rather
     * than being dropped — a spec that came back as a string is a corrupt row,
     * not a row with no spec. */
    if ('durationMin' in o) {
      if (o.durationMin === null) row.durationMin = null;
      else { const n = num(o.durationMin); if (n === null) return null; row.durationMin = n; }
    }
    if ('isQuality' in o) {
      if (o.isQuality === null) row.isQuality = null;
      else if (typeof o.isQuality === 'boolean') row.isQuality = o.isQuality;
      else return null;
    }
    if ('subLabel' in o) {
      if (o.subLabel === null) row.subLabel = null;
      else { const s = str(o.subLabel); if (s === null) return null; row.subLabel = s; }
    }
    if ('notes' in o) {
      if (o.notes === null) row.notes = null;
      else { const s = str(o.notes); if (s === null) return null; row.notes = s; }
    }
    if ('workoutSpec' in o) {
      if (o.workoutSpec === null) row.workoutSpec = null;
      else if (typeof o.workoutSpec === 'object' && !Array.isArray(o.workoutSpec)) {
        row.workoutSpec = o.workoutSpec as Record<string, unknown>;
      } else return null;
    }
    out.push(row as unknown as RowBefore);
  }
  return out;
}
