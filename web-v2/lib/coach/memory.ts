/**
 * lib/coach/memory.ts · Part 2 of Design/execution-memory-firing.md.
 *
 *   "The database remembers everything. The coach remembers selectively."
 *
 * This is not another detector. `coach-log.ts` and `easy-discipline.ts` each
 * hand-roll their own "has this happened enough to matter" state machine —
 * week-close firsts count priorWeeksWithMiles, easy-discipline counts
 * MIN_QUALIFYING_RUNS across MIN_DISTINCT_WEEKS. This module pulls that
 * pattern out once so future detectors (and, over time, those two) share one
 * promotion rule and one decay clock instead of re-deriving both.
 *
 * STORAGE · coach_intents, same table coach-log and easy-discipline already
 * use. reason = 'coach_memory_<category>', field = a caller-chosen stable key
 * (e.g. 'pref:long_run_day', 'pattern:threshold_durability',
 * 'goal:hm:2026'), value = the MemoryRecord JSON below. No DDL — this is the
 * append-only precedent from coach-log.ts §STORAGE, reused. Rows are never
 * deleted; decay is a READ-time filter, so the audit trail (what the coach
 * once believed, and when) stays intact even after a memory goes quiet.
 *
 * PROMOTION · a memory does not exist the first time something is true. A
 * caller reports evidence via `recordEvidence`; nothing is written until the
 * evidence crosses BOTH bars doctrine asks for — enough occurrences AND
 * enough distinct periods, so one bad week can never read as a pattern. The
 * thresholds default to the numbers already proven in easy-discipline.ts
 * (MIN_QUALIFYING_RUNS=5 / MIN_DISTINCT_WEEKS=3 there; this module defaults
 * to the lighter 3/3 the doctrine doc itself uses for "repeated evidence")
 * and every caller may override them where its own domain has a different
 * honest bar — the numbers are a starting point, not a mandate.
 *
 * DECAY · three tiers, durations are product convention (this doctrine is
 * David's own brief, not a physiology claim — no doctrine-registry citation;
 * inventing a Research/ citation for a UX policy would be exactly the
 * citation rot the doctrine gate exists to catch). `isExpired` is pure and
 * takes "today" as an argument so it is trivially testable.
 *
 * SPEAKING · out of scope here, deliberately. "Storing is not speaking"
 * (Part 2) — this module answers "what does the coach still believe", not
 * "should it say so now". That is Part 3's firing policy, consuming
 * `loadActiveMemory` as one input among several.
 */

import { pool } from '@/lib/db/pool';

/* ═════════════════════════════ Types ═════════════════════════════════ */

export type MemoryCategory =
  | 'preference'      // durable preferences — long runs on Saturday
  | 'pattern'         // meaningful patterns — easy runs drift fast when fresh
  | 'physiological'   // injury history, tolerance
  | 'goal_history'    // goal set / revised / abandoned
  | 'milestone'       // first 40-mile week absorbed
  | 'race';           // significant race — PR, breakthrough, collapse

export type MemoryTier = 'permanent' | 'medium' | 'short';

export type MemoryStatus = 'candidate' | 'active' | 'superseded';

export interface MemoryRecord {
  category: MemoryCategory;
  tier: MemoryTier;
  status: MemoryStatus;
  /** The coach's own statement of the memory — this is what gets spoken,
   *  never the raw evidence. Written in coach voice at promotion time. */
  statement: string;
  evidenceCount: number;
  distinctPeriods: number;
  firstObservedISO: string;
  lastObservedISO: string;
  /** Free-form, category-specific — e.g. { day: 'sat' } for a preference,
   *  { pathology: 'bone_stress', region: 'tibia' } for physiological. */
  detail: Record<string, unknown>;
  /** Set when a newer memory replaces this one (e.g. a revised goal). Points
   *  at the field key of the record it supersedes. */
  supersedesField?: string;
}

/* ══════════════════════ Decay tiers (product convention) ══════════════ */

/** Doctrine: "expire or revalidate over weeks." 8 weeks — two full
 *  load-cutback macrocycles (`Research/00b` "3 weeks load → 1 week
 *  cutback"), so a medium memory survives one bad cycle but not two stale
 *  ones. Convention, not a registry claim — see module header. */
export const MEDIUM_TIER_DAYS = 56;

/** Doctrine: "days." Long enough to matter through a full training week,
 *  short enough that travel fatigue from a month ago never resurfaces. */
export const SHORT_TIER_DAYS = 10;

function daysBetween(fromISO: string, toISO: string): number {
  const a = Date.parse(fromISO + 'T12:00:00Z');
  const b = Date.parse(toISO + 'T12:00:00Z');
  return Math.round((b - a) / 86400000);
}

/** Pure. A permanent memory never expires; medium/short expire from their
 *  LAST observation, not their first — a pattern reinforced last week is not
 *  stale even if it started months ago. */
export function isExpired(record: Pick<MemoryRecord, 'tier' | 'lastObservedISO'>, todayISO: string): boolean {
  if (record.tier === 'permanent') return false;
  const age = daysBetween(record.lastObservedISO, todayISO);
  const ceiling = record.tier === 'medium' ? MEDIUM_TIER_DAYS : SHORT_TIER_DAYS;
  return age > ceiling;
}

/* ══════════════════════ Promotion (pure) ══════════════════════════════ */

export interface PromotionThresholds {
  /** Minimum occurrences before promotion. Default 3 — the doctrine doc's
   *  own bar ("generally require repeated evidence"), lighter than
   *  easy-discipline's 5 because that module additionally requires a
   *  two-thirds majority within its window; this primitive has no majority
   *  concept, so callers wanting one enforce it before calling. */
  minEvidenceCount: number;
  /** Minimum distinct periods (weeks, blocks, whatever the caller buckets
   *  by) — the guard a raw count cannot provide on its own. */
  minDistinctPeriods: number;
}

export const DEFAULT_PROMOTION_THRESHOLDS: PromotionThresholds = {
  minEvidenceCount: 3,
  minDistinctPeriods: 3,
};

/** Pure. Whether accumulated evidence has crossed the promotion bar. */
export function shouldPromote(
  evidenceCount: number,
  distinctPeriods: number,
  thresholds: PromotionThresholds = DEFAULT_PROMOTION_THRESHOLDS,
): boolean {
  return evidenceCount >= thresholds.minEvidenceCount
    && distinctPeriods >= thresholds.minDistinctPeriods;
}

/* ══════════════════════════ DB shell ═══════════════════════════════════ */

function reasonOf(category: MemoryCategory): string {
  return `coach_memory_${category}`;
}

async function readRecord(
  userId: string, category: MemoryCategory, field: string,
): Promise<MemoryRecord | null> {
  const r = await pool.query<{ value: unknown }>(
    `SELECT value FROM coach_intents
      WHERE COALESCE(user_uuid, user_id) = $1 AND reason = $2 AND field = $3
      ORDER BY ts DESC LIMIT 1`,
    [userId, reasonOf(category), field],
  ).catch(() => ({ rows: [] as Array<{ value: unknown }> }));
  const row = r.rows[0];
  if (!row) return null;
  try {
    return (typeof row.value === 'string' ? JSON.parse(row.value) : row.value) as MemoryRecord;
  } catch {
    return null;
  }
}

async function writeRecord(
  userId: string, category: MemoryCategory, field: string, record: MemoryRecord,
): Promise<void> {
  // acknowledged_at stamped at insert · memory rows are history, never
  // pending asks (same reasoning as coach-log.ts writeEntry).
  await pool.query(
    `INSERT INTO coach_intents (user_id, user_uuid, reason, field, value, acknowledged_at)
     VALUES ($1, $1, $2, $3, $4, NOW())`,
    [userId, reasonOf(category), field, JSON.stringify(record)],
  );
}

export interface RecordEvidenceInput {
  userId: string;
  category: MemoryCategory;
  /** Stable key identifying WHAT is being observed, e.g.
   *  'pattern:threshold_durability' or 'pref:long_run_day'. Distinct
   *  observations of the SAME underlying thing must reuse this key so
   *  evidence accumulates instead of forking into parallel candidates. */
  field: string;
  tier: MemoryTier;
  /** A period identifier for the distinct-periods bar — typically an ISO
   *  week-start. Repeated evidence within the same period counts once. */
  periodKey: string;
  observedISO: string;
  /** How to phrase it IF this evidence promotes the memory. Ignored on
   *  sub-threshold calls (row already exists, evidence count is what's
   *  bumped) — recompute the statement fresh each time evidence increments
   *  so the wording can improve as more evidence comes in. */
  statement: string;
  detail?: Record<string, unknown>;
  thresholds?: PromotionThresholds;
}

/**
 * Report one piece of evidence toward a memory. Accumulates until the
 * promotion bar is crossed, then writes an 'active' record; further calls
 * on an already-active memory keep it fresh (bump lastObservedISO, refresh
 * the statement) without re-litigating promotion. Idempotent per
 * (category, field, periodKey) — calling twice in the same period does not
 * double-count.
 *
 * Returns the resulting record, or null if evidence is still below the bar
 * (nothing written yet — sub-threshold evidence stays in the caller's own
 * bookkeeping, not here, matching "leave it as historical data" until it
 * earns memory).
 */
export async function recordEvidence(input: RecordEvidenceInput): Promise<MemoryRecord | null> {
  const thresholds = input.thresholds ?? DEFAULT_PROMOTION_THRESHOLDS;
  const existing = await readRecord(input.userId, input.category, input.field);

  if (existing && existing.status !== 'superseded') {
    // Already active (or, in principle, a stored candidate) — merge.
    const periods = new Set<string>(
      Array.isArray(existing.detail.periods) ? (existing.detail.periods as string[]) : [],
    );
    const alreadyCountedThisPeriod = periods.has(input.periodKey);
    periods.add(input.periodKey);
    const evidenceCount = alreadyCountedThisPeriod
      ? existing.evidenceCount
      : existing.evidenceCount + 1;
    const distinctPeriods = periods.size;
    const promoted = existing.status === 'active' || shouldPromote(evidenceCount, distinctPeriods, thresholds);
    const record: MemoryRecord = {
      ...existing,
      status: promoted ? 'active' : 'candidate',
      statement: promoted ? input.statement : existing.statement,
      evidenceCount,
      distinctPeriods,
      lastObservedISO: input.observedISO,
      detail: { ...existing.detail, ...input.detail, periods: Array.from(periods) },
    };
    await writeRecord(input.userId, input.category, input.field, record);
    return promoted ? record : null;
  }

  // First evidence for this key (or the prior record was superseded — a
  // fresh candidate starts clean rather than inheriting a dead chain).
  const evidenceCount = 1;
  const distinctPeriods = 1;
  const promoted = shouldPromote(evidenceCount, distinctPeriods, thresholds);
  const record: MemoryRecord = {
    category: input.category,
    tier: input.tier,
    status: promoted ? 'active' : 'candidate',
    statement: input.statement,
    evidenceCount,
    distinctPeriods,
    firstObservedISO: input.observedISO,
    lastObservedISO: input.observedISO,
    detail: { ...(input.detail ?? {}), periods: [input.periodKey] },
  };
  await writeRecord(input.userId, input.category, input.field, record);
  return promoted ? record : null;
}

/**
 * Mark a memory superseded — e.g. a goal revised, a preference explicitly
 * contradicted. The superseding call is the caller's job (write the new
 * memory with `supersedesField` pointing here); this only closes the old
 * one so it stops surfacing as active. Never deletes — audit trail intact.
 */
export async function supersedeMemory(
  userId: string, category: MemoryCategory, field: string,
): Promise<void> {
  const existing = await readRecord(userId, category, field);
  if (!existing || existing.status === 'superseded') return;
  await writeRecord(userId, category, field, { ...existing, status: 'superseded' });
}

/**
 * Read every currently-active, non-expired memory for a user. This is the
 * ONLY thing downstream consumers (prescription levers, firing policy,
 * future "why this workout" surfaces) should call — never the raw
 * coach_intents rows, so decay and promotion stay enforced in one place.
 */
export async function loadActiveMemory(
  userId: string, todayISO: string, categories?: MemoryCategory[],
): Promise<Array<MemoryRecord & { field: string }>> {
  const cats = categories ?? (
    ['preference', 'pattern', 'physiological', 'goal_history', 'milestone', 'race'] as MemoryCategory[]
  );
  const reasons = cats.map(reasonOf);
  const rows = (await pool.query<{ field: string; value: unknown; ts: Date }>(
    `SELECT DISTINCT ON (field) field, value, ts
       FROM coach_intents
      WHERE COALESCE(user_uuid, user_id) = $1 AND reason = ANY($2::text[])
      ORDER BY field, ts DESC`,
    [userId, reasons],
  ).catch(() => ({ rows: [] as Array<{ field: string; value: unknown; ts: Date }> }))).rows;

  const out: Array<MemoryRecord & { field: string }> = [];
  for (const row of rows) {
    let v: MemoryRecord | null = null;
    try {
      v = (typeof row.value === 'string' ? JSON.parse(row.value) : row.value) as MemoryRecord;
    } catch { continue; }
    if (!v || v.status !== 'active') continue;
    if (isExpired(v, todayISO)) continue;
    out.push({ ...v, field: row.field });
  }
  return out;
}
