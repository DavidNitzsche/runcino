/**
 * lib/plan/established-cadence.ts · CADENCE-STABLE-1 (2026-09-02).
 *
 * ONE question, ONE owner (Constitution): what deload cadence is this runner's
 * CURRENT block already built on?
 *
 * ── WHY IT EXISTS ───────────────────────────────────────────────────────────
 *
 * The owner's ruling, 2026-09-02: *"A mid-block rebuild must preserve
 * established block intent unless there is sustained evidence for a meaningful
 * change. A single delayed or missing run sync must not reorganize the
 * calendar."*
 *
 * `cutbackCadence` used to re-derive the cadence on every authoring from one
 * instantaneous Banister TSB reading. Measured on the owner's real CIM block:
 * crossing that line re-phased SEVEN OF FIFTEEN weeks, moved one week by 16 mi
 * and one long run by 6 mi. His reading sat one point from the line and had
 * travelled twelve points in the preceding seven days. A deload cadence is a
 * periodisation decision; it belongs to the block, and a rebuild inherits it.
 *
 * ── TWO RUNGS, BECAUSE THE FIRST DOES NOT EXIST YET ─────────────────────────
 *
 * 1 · `authored_state.cutback_every_n`, written by `composePlan` from this
 *     change forward. The block's own stated answer.
 * 2 · `plan_weeks.is_cutback`, for every block authored BEFORE that key
 *     existed — which on the day this landed is every block in production,
 *     including the owner's. The cadence is the spacing between the flagged
 *     weeks, taken as the MODE of the gaps rather than the first gap, so one
 *     mislabelled week cannot decide it.
 *
 * Returns null — never a substituted 4 — when neither rung can answer (Rule
 * 11). Null means "this is an initial authoring, derive it", which is a
 * different fact from "authored at 4", and `cutbackCadence` branches on it.
 *
 * ── SCOPE (Rule 14) ─────────────────────────────────────────────────────────
 *
 * The ACTIVE block: `user_uuid` + `archived_iso IS NULL`, newest authoring.
 * Reading across archived plan versions is the defect Rule 14 is named for —
 * a join on `user_uuid` alone reads every version the runner has ever had.
 */
import { pool } from '@/lib/db/pool';
import { rowOrNull, rowsOrNull } from '@/lib/db/read';

/**
 * The cycles this engine may CARRY, and the one it AUTHORS.
 *
 * `Research/00b` §"Frequency" lists four profiles. The two this engine uses are
 * "Default for most runners | 3 weeks load -> 1 week cutback" (a 4-week cycle)
 * and the "Injury-prone / older / returning" and "Late-block" rows (a 3-week
 * cycle). Bound by `CUTBACK.cadence`, which reads both numbers out of here.
 *
 * CADENCE-AUTHORED-1 (2026-09-02) · a NEW block is authored on the default row,
 * always. The 3-week cycle is reachable only by INHERITANCE, from a block that
 * already has it — which is the owner's live CIM block, and which is why the
 * value is still live rather than dead code (Rule 15).
 *
 * WHY NOT DERIVE THE 3 FROM THE RUNNER. It was tried, on `RampBaseEvidence
 * .returning` ("is there a level this runner has held that they are currently
 * below"), on the reasoning that it was the nearest thing the engine measures
 * to doctrine's "returning" row. Measured 2026-09-02 across the archetype
 * corpus, it was far too broad — almost every mid-build runner is below their
 * own third-best week of sixteen — and it took four gates red: 1,419 extra
 * sessions past `BOUNDARY-OWNER-1`'s ratchet, a `_coach_sensible` easy-day
 * floor violation (Rule 12's own gate), and `_audit_nonrace`. A tighter cycle
 * means smaller weeks, and smaller weeks is where the easy day gets squeezed.
 *
 * So the rule is the simple one, and the trade is stated rather than hidden: a
 * genuinely injury-prone or returning runner does not get doctrine's tighter
 * cycle from a NEW block authored here. The comeback protocols
 * (`injury-builder.ts`, `Research/22` §"Return from Moderate Layoff") own that
 * runner's ramp, and a cadence guessed from a proxy is what this change exists
 * to remove.
 */
const VALID_CADENCES = new Set([3, 4]);
/** `Research/00b` §Frequency · "Default for most runners". */
export const DEFAULT_CUTBACK_EVERY_N = 4;

/**
 * PURE half · the cadence implied by which weeks a block flagged as cutbacks.
 *
 * `plan_weeks.is_cutback` is a display fact (a drop of more than 15% off the
 * week before, excluding race and taper weeks), so the flagged indices are a
 * SAMPLE of the deload weeks rather than a statement of the rule. The mode of
 * the gaps between consecutive flags recovers the rule from the sample and is
 * unmoved by a single missing or extra flag.
 *
 * Exported for direct unit testing — the worktree has no database.
 */
export function cadenceFromCutbackWeeks(weekIdxs: readonly number[]): number | null {
  const sorted = [...new Set(weekIdxs)].filter((n) => Number.isInteger(n) && n >= 0)
    .sort((a, b) => a - b);
  if (sorted.length < 2) return null;
  const gaps = new Map<number, number>();
  for (let i = 1; i < sorted.length; i++) {
    const g = sorted[i] - sorted[i - 1];
    gaps.set(g, (gaps.get(g) ?? 0) + 1);
  }
  let best: number | null = null;
  let bestN = 0;
  for (const [g, n] of gaps) {
    // Ties go to the SMALLER gap: a block whose taper truncated its last cycle
    // reports one long gap and one true one, and the true one is the shorter.
    if (n > bestN || (n === bestN && best != null && g < best)) { best = g; bestN = n; }
  }
  return best != null && VALID_CADENCES.has(best) ? best : null;
}

/**
 * DB half.
 *
 * Null means "no established block" — an INITIAL authoring, where the cadence
 * is chosen. A read FAILURE is logged by `lib/db/read.ts` and also answers
 * null, because there is no third posture available here: the composer must
 * author something. The distinction is preserved where it can be, in the log,
 * rather than pretended at (Rule 11).
 */
export async function readEstablishedCutbackCadence(userId: string): Promise<number | null> {
  const plan = await rowOrNull<{ id: string; authored_state: Record<string, unknown> | null }>(
    'established-cadence:plan',
    pool.query(
      `SELECT id, authored_state FROM training_plans
        WHERE user_uuid = $1::uuid AND archived_iso IS NULL
        ORDER BY authored_iso DESC LIMIT 1`,
      [userId],
    ),
  );
  if (!plan) return null;

  // Rung 1 · the block's own stated answer.
  const stated = (plan.authored_state ?? {})['cutback_every_n'];
  if (typeof stated === 'number' && VALID_CADENCES.has(stated)) return stated;

  // Rung 2 · recover it from the block's own cutback weeks.
  const rows = await rowsOrNull<{ week_idx: number }>(
    'established-cadence:weeks',
    pool.query(
      `SELECT week_idx FROM plan_weeks
        WHERE plan_id = $1 AND is_cutback IS TRUE
        ORDER BY week_idx`,
      [plan.id],
    ),
  );
  if (rows == null) return null;
  return cadenceFromCutbackWeeks(rows.map((r) => Number(r.week_idx)));
}
