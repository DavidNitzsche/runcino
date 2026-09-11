/**
 * POST /api/v5/goal-answer · answer the Races decision card.
 *
 * `native-v2/…/APIV5.swift`'s `answerGoalCard(action:targetSec:raceSlug:)`
 * posts `{ action, targetSec?, raceSlug? }` where `action` is one of the
 * card's own answer actions. What each one means:
 *
 *   not_now       · dismiss. Suppresses whichever fact/choice trigger was
 *                   showing, for `TRIGGER_SUPPRESS_DAYS`. No plan change.
 *   acknowledge   · same as `not_now`, for the heat/course-changed facts.
 *   repace        · heat only. The goal stands; acknowledged + suppressed.
 *                   Re-pacing race morning itself is a race-week concern,
 *                   not a plan mutation — nothing here rewrites paces.
 *   confirm       · chip-time lock only. Promotes the race's own already-
 *                   resolved provisional finish (the Strava/watch match
 *                   `loadVdotInputs` already computed) to the authoritative
 *                   chip time, through the SAME canonical write
 *                   `POST /api/race/result` uses (`manualResultPatch` +
 *                   `runPostResultChain`). Never accepts a client-supplied
 *                   number — the server re-derives the provisional time
 *                   itself, so this endpoint cannot be used to inject an
 *                   arbitrary result.
 *   leave         · chip-time lock only. Leaves the result provisional;
 *                   suppresses the trigger. No write beyond the log.
 *   choose_race   · two-A-races only. Demotes every OTHER upcoming A race
 *                   to B, through the same primitives `PATCH /api/race`
 *                   uses for a priority edit (meta.priority + auto-rebuild
 *                   kind `a_race_removed`). Requires `raceSlug` — the race
 *                   that stays the goal.
 *   use_measured_elevation
 *                 · course-changed CHOICE only (low-confidence conflict —
 *                   see `lib/training/race-card.ts#courseChangedChoiceCard`
 *                   and `docs/design/cim-elevation-semantic-trace-2026-09-11.md`).
 *                   Re-resolves the race's elevation server-side (never
 *                   trusts a client-supplied number) and writes the GPS
 *                   track's own reading into `course_library` — the same
 *                   curated-value correction mechanism
 *                   `lib/race/course-elevation.ts`'s own header already
 *                   documents for AFC and Big Sur. This is the ONE action
 *                   in this route that changes what every other consumer of
 *                   `resolveCourseElevation()` sees, going forward.
 *   keep_curated_elevation
 *                 · course-changed CHOICE only. Suppresses the trigger;
 *                   writes nothing to `course_library`. Genuinely the
 *                   opposite outcome of `use_measured_elevation` — this is
 *                   what the old Acknowledge/Not-now pair never had.
 *
 * 2026-09-11 · CIM elevation-integrity fix. `acknowledge` for the
 * course-changed FACT (informational — high/medium confidence, the resolver
 * has already adopted the measured value; see `courseChangedFactCard`) is
 * now the only answer that card offers, since there is nothing left to
 * decide. The CHOICE variant (`courseChangedChoiceCard`, low confidence)
 * never uses `acknowledge`/`not_now` at all — it uses the two actions above,
 * specifically so two buttons never again trace to the same outcome.
 *

 * `take` (re-state the goal to a server-computed number on one tap) and
 * `hold` (keep the goal — only meaningful as the answer to a `take` it could
 * have refused) are both gone, removed 2026-08-26 per David's ruling (see
 * `lib/training/race-card.ts`'s `buildDecisionCard` doc): the coach
 * projects, it does not renegotiate the goal for the runner, and a pure
 * verdict read is not a decision needing a yes/no. A runner who wants to
 * change their own goal number still can, explicitly, through `PATCH
 * /api/race/[slug]` (the race-edit screen) — a decision the runner makes,
 * never one this card makes for them.
 *
 * `choose_race` goes through the plan's existing race/goal write paths,
 * never a bare UPDATE — CLAUDE.md's multi-writer jsonb rule (Rule 6) is why
 * `PATCH /api/race` already merges rather than replaces, and this route
 * reuses that code path rather than a second writer to the same column.
 */
import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/lib/db/pool';
import { rowOrNull } from '@/lib/db/read';
import { requireUserId } from '@/lib/auth/session';
import { runnerToday } from '@/lib/runtime/runner-tz';
import { loadRacesState } from '@/lib/coach/races-state';
import { loadVdotInputs } from '@/lib/training/vdot-inputs';
import { bustBriefingCacheForEvent } from '@/lib/coach/cache';
import { manualResultPatch, runPostResultChain } from '@/lib/race/result-chain';
import type { FactChoiceTriggerId } from '@/lib/training/race-card';
import { resolveCourseElevation, type ResolveCourseElevationInput } from '@/lib/race/course-elevation';
import { decideCourseElevationChoice } from '@/lib/race/course-elevation-choice';
import { outage } from '@/lib/route/failure';

export const dynamic = 'force-dynamic';

const ACTIONS = [
  'not_now', 'acknowledge', 'repace', 'confirm', 'leave', 'choose_race',
  'use_measured_elevation', 'keep_curated_elevation',
] as const;
type Action = (typeof ACTIONS)[number];

/**
 * The reason stamped on this route's INTERNAL receipts — a record that the
 * runner tapped an answer, kept so the triggers above can tell an answered
 * question from an unasked one.
 *
 * IT MUST NOT BEGIN `coach_log_`. It did, and `loadCoachLog` selects
 * `WHERE reason LIKE 'coach_log_%'`, so every one of these receipts was
 * eligible for the runner-facing coach log. One of them got there: row 881 on
 * the owner's account, `{"action":"acknowledge"}`, which the reader's silent
 * kind-coercion relabelled `week_close` and rendered as an empty WEEK_CLOSE
 * card dated Wednesday 2026-08-26 — a day that is not a week boundary, under a
 * heading claiming a week had closed.
 *
 * The reader now excludes unknown kinds rather than renaming them, which fixes
 * the existing row. This fixes the cause: a receipt is not a log entry and does
 * not wear the log's prefix. `suppressTrigger` below already had this right
 * (`goal_card_dismissed`) — these five call sites simply reached for the wrong
 * prefix, and nothing downstream ever read the name they chose.
 */
const GOAL_ANSWER_RECEIPT = 'goal_answer_receipt';

/** `course_library.elevation_gain_ft`/`net_elevation_ft` are INTEGER, but
 *  read defensively as `number | string | null` the same way
 *  `lib/race/course-elevation.ts`'s own `lib` input does — coerced here
 *  before it becomes the undo receipt's "previous" value. */
const toNumOrNull = (v: number | string | null | undefined): number | null => {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

async function writeIntent(userId: string, reason: string, field: string | null, value: Record<string, unknown>): Promise<void> {
  await pool.query(
    `INSERT INTO coach_intents (user_id, user_uuid, reason, field, value) VALUES ($1, $1, $2, $3, $4)`,
    [userId, reason, field, JSON.stringify(value)],
  ).catch((e) => console.error('[v5/goal-answer] writeIntent failed:', e instanceof Error ? e.message : e));
}

async function suppressTrigger(userId: string, trigger: FactChoiceTriggerId): Promise<void> {
  await writeIntent(userId, 'goal_card_dismissed', trigger, { trigger });
}

export async function POST(req: NextRequest) {
  const auth = await requireUserId(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth;

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const action = String(body?.action ?? '') as Action;
  if (!ACTIONS.includes(action)) {
    return NextResponse.json({ ok: false, error: 'bad_action', reason: `That is not an answer this card offers. Expected one of ${ACTIONS.join(', ')}.` }, { status: 400 });
  }
  const targetSec = typeof body?.targetSec === 'number' && Number.isFinite(body.targetSec) ? body.targetSec : null;
  const raceSlug = typeof body?.raceSlug === 'string' && body.raceSlug ? body.raceSlug : null;

  try {
    // These two reads used to sit OUTSIDE this `try`, so a throw in either
    // left the handler unhandled and became a raw Next.js 500 rather than
    // the outage body. Both hit the database; both belong inside.
    const todayISO = await runnerToday(userId);
    const racesState = await loadRacesState(userId);
    const upcomingAs = racesState.aRaces.filter(r => !r.is_past).sort((a, b) => a.days - b.days);
    const nextA = upcomingAs[0] ?? racesState.aRace ?? null;

    switch (action) {
      case 'not_now': {
        // Best-effort: suppress every fact/choice trigger that could be
        // showing right now (route can't know which one the client saw),
        // so the same question doesn't re-fire tomorrow.
        for (const t of ['heat', 'course_changed', 'chip_lock', 'two_a_races'] as FactChoiceTriggerId[]) {
          await suppressTrigger(userId, t);
        }
        await writeIntent(userId, GOAL_ANSWER_RECEIPT, nextA?.slug ?? null, { action, race: nextA?.slug ?? null });
        return NextResponse.json({ ok: true, action });
      }

      case 'acknowledge':
      case 'repace': {
        // 'acknowledge' answers BOTH heat and course_changed in race-
        // card.ts; 'repace' answers heat alone. Suppressing both on either
        // is harmless — a trigger that wasn't showing has nothing to skip.
        await suppressTrigger(userId, 'heat');
        await suppressTrigger(userId, 'course_changed');
        await writeIntent(userId, GOAL_ANSWER_RECEIPT, nextA?.slug ?? null, { action });
        return NextResponse.json({ ok: true, action });
      }

      case 'leave': {
        await suppressTrigger(userId, 'chip_lock');
        await writeIntent(userId, GOAL_ANSWER_RECEIPT, raceSlug ?? nextA?.slug ?? null, { action, left_provisional: true });
        return NextResponse.json({ ok: true, action });
      }

      case 'confirm': {
        // Re-derive the provisional finish server-side — never trust a
        // client-supplied time here. The race must be the one
        // loadVdotInputs' Strava-match rung actually resolved.
        const slug = raceSlug ?? [...racesState.past].filter(r => r.days >= -21).sort((a, b) => b.days - a.days)[0]?.slug ?? null;
        if (!slug) return NextResponse.json({ ok: false, error: 'no_race', reason: 'No recent unlocked race to confirm.' }, { status: 404 });
        const inputs = await loadVdotInputs(userId, todayISO);
        const candidate = inputs.raceCandidates.find(c => c.slug === slug);
        if (!candidate || !candidate.provisional || !candidate.finish_seconds) {
          return NextResponse.json({ ok: false, error: 'not_provisional', reason: "This race's time is already locked, or there's nothing to confirm." }, { status: 400 });
        }
        // Same write POST /api/race/result performs: Rule 6 jsonb-merge
        // patch, source:'manual'/provisional:false, then the shared
        // post-result chain (snapshots, vdot intent, archive+next-plan).
        const patch = manualResultPatch(candidate.finish_seconds, null);
        const finishDisplay = String(patch.finishDisplay);
        await pool.query(
          `UPDATE races SET
             actual_result = (COALESCE(actual_result, '{}'::jsonb) || $2::jsonb),
             meta = meta || jsonb_build_object('finishTime', $3::text)
           WHERE slug = $1 AND user_uuid = $4`,
          [slug, JSON.stringify(patch), finishDisplay, userId],
        );
        await writeIntent(userId, GOAL_ANSWER_RECEIPT, slug, { action, finish_seconds: candidate.finish_seconds, display: finishDisplay });
        let chain: Awaited<ReturnType<typeof runPostResultChain>> | null = null;
        try {
          chain = await runPostResultChain({
            userId, raceSlug: slug,
            raceDateISO: candidate.date || null,
            distanceMi: candidate.distance_mi,
            racePriority: candidate.priority,
            finishS: candidate.finish_seconds,
          });
        } catch (e) { console.error('[v5/goal-answer confirm] post-result chain warn:', e); }
        await bustBriefingCacheForEvent(userId, 'race_crud').catch(() => {});
        return NextResponse.json({
          ok: true, action, slug, finishSeconds: candidate.finish_seconds, finishDisplay,
          vdotBefore: chain?.vdotBefore ?? null, vdotAfter: chain?.vdotAfter ?? null,
        });
      }

      case 'choose_race': {
        if (!raceSlug) return NextResponse.json({ ok: false, error: 'no_race_chosen', reason: 'Say which race is the goal and we will build toward that one.' }, { status: 400 });
        const chosen = upcomingAs.find(r => r.slug === raceSlug);
        if (!chosen) return NextResponse.json({ ok: false, error: 'race_not_found', reason: 'That race is not one of your upcoming A races.' }, { status: 404 });
        const others = upcomingAs.filter(r => r.slug !== raceSlug);
        for (const other of others) {
          const current = await pool.query<{ meta: any }>(
            `SELECT meta FROM races WHERE user_uuid = $1::uuid AND slug = $2 LIMIT 1`,
            [userId, other.slug],
          ).then(r => r.rows[0]).catch(() => null);
          if (!current) continue;
          const newMeta = { ...current.meta, priority: 'B' };
          await pool.query(
            `UPDATE races SET meta = $1::jsonb WHERE user_uuid = $2::uuid AND slug = $3`,
            [JSON.stringify(newMeta), userId, other.slug],
          );
          await writeIntent(userId, GOAL_ANSWER_RECEIPT, other.slug, { action, demoted_to: 'B', chosen_goal: raceSlug });
          try {
            const { fireAutoRebuild } = await import('@/lib/plan/auto-rebuild');
            await fireAutoRebuild({
              userUuid: userId, raceSlug: other.slug, kind: 'a_race_removed',
              reasons: { to_priority: 'B', chosen_goal: raceSlug, source: 'v5_goal_card' },
              source: 'v5_goal_answer',
            });
          } catch (e) { console.error('[v5/goal-answer choose_race] auto-rebuild warn:', e); }
        }
        await suppressTrigger(userId, 'two_a_races');
        await bustBriefingCacheForEvent(userId, 'race_crud').catch(() => {});
        return NextResponse.json({ ok: true, action, chosen: raceSlug, demoted: others.map(o => o.slug) });
      }

      // ── course-changed CHOICE (low-confidence conflict) · 2026-09-11 ────
      // See `lib/training/race-card.ts#courseChangedChoiceCard` and
      // `docs/design/cim-elevation-semantic-trace-2026-09-11.md`. Only
      // reached when `resolveCourseElevation()`'s confidence is genuinely
      // low — the informational (high/medium) path never offers these two
      // actions at all, it only offers `acknowledge`.
      case 'use_measured_elevation': {
        const slug = raceSlug ?? nextA?.slug ?? null;
        if (!slug) return NextResponse.json({ ok: false, error: 'no_race', reason: 'No race to correct.' }, { status: 404 });
        // `rowOrNull` distinguishes "no such row" (undefined) from "the read
        // FAILED" (null) — a genuine failure here must reach the outer catch
        // as an outage, not be silently reinterpreted as "no GPS track on
        // file" (lib/audit/swallowed-failure-registry.ts's ratchet is what
        // catches exactly this collapse).
        const raceRow = await rowOrNull<{ course_geometry: unknown; distance_mi: number | null }>(
          'v5/goal-answer use_measured_elevation · race row',
          pool.query(`SELECT course_geometry, distance_mi FROM races WHERE slug = $1 AND user_uuid = $2`, [slug, userId]),
        );
        if (raceRow === null) throw new Error('race row read failed');
        if (!raceRow?.course_geometry) {
          return NextResponse.json({ ok: false, error: 'no_geometry', reason: 'No GPS track on file for this race.' }, { status: 400 });
        }
        const libRow = await rowOrNull<{ elevation_gain_ft: number | string | null; net_elevation_ft: number | string | null }>(
          'v5/goal-answer use_measured_elevation · course_library row',
          pool.query(`SELECT elevation_gain_ft, net_elevation_ft FROM course_library WHERE slug = $1`, [slug]),
        );
        if (libRow === null) throw new Error('course_library read failed');
        // Re-derive server-side — a client-supplied number is never trusted.
        // Read straight off the track (elevationProfileFromGeometry via the
        // resolver's own low-confidence rung), not off whatever the resolver
        // would AUTO-pick, since the runner's own confirmation is what earns
        // the measured value its precedence here.
        const input: ResolveCourseElevationInput = {
          lib: libRow,
          geometry: raceRow.course_geometry as ResolveCourseElevationInput['geometry'],
          nominalDistanceMi: raceRow.distance_mi,
        };
        const resolved = resolveCourseElevation(input);
        const conflict = resolved.conflict;
        const measuredGainFt = conflict?.measuredGainFt ?? (resolved.provenance === 'measured' ? resolved.elevationGainFt : null);
        const measuredNetFt = conflict?.measuredNetFt ?? (resolved.provenance === 'measured' ? resolved.netElevationFt : null);

        // The actual divergence from `keep_curated_elevation` is decided
        // HERE, in a pure function with its own falsification tests
        // (`lib/race/course-elevation-choice.test.ts`) — this route only
        // executes what it returns.
        const outcome = decideCourseElevationChoice({
          action: 'use_measured_elevation', slug,
          measuredGainFt, measuredNetFt,
          previousGainFt: toNumOrNull(libRow?.elevation_gain_ft),
          previousNetFt: toNumOrNull(libRow?.net_elevation_ft),
          confidence: resolved.confidence,
        });
        if (!outcome.ok) {
          return NextResponse.json({ ok: false, error: 'no_measurement', reason: outcome.error }, { status: 400 });
        }
        // outcome.courseLibraryUpdate is non-null whenever outcome.ok is
        // true for this action — the guard above is what makes that so.
        const update = outcome.courseLibraryUpdate!;
        await pool.query(
          `UPDATE course_library SET elevation_gain_ft = $2, net_elevation_ft = $3, updated_ts = NOW() WHERE slug = $1`,
          [update.slug, update.elevationGainFt, update.netElevationFt],
        );
        await suppressTrigger(userId, outcome.suppressTrigger!);
        // Carries the prior curated values so this can be manually reversed.
        // The receipt IS the undo record, per the product requirement that a
        // material data change keep a path back.
        await writeIntent(userId, GOAL_ANSWER_RECEIPT, slug, outcome.receipt!);
        await bustBriefingCacheForEvent(userId, 'race_crud').catch(() => {});
        return NextResponse.json({ ok: true, action, slug, previous: outcome.previous, applied: { elevationGainFt: update.elevationGainFt, netElevationFt: update.netElevationFt } });
      }

      case 'keep_curated_elevation': {
        const slug = raceSlug ?? nextA?.slug ?? null;
        const outcome = decideCourseElevationChoice({
          action: 'keep_curated_elevation', slug: slug ?? '',
          measuredGainFt: null, measuredNetFt: null, previousGainFt: null, previousNetFt: null, confidence: 'unknown',
        });
        await suppressTrigger(userId, outcome.suppressTrigger!);
        await writeIntent(userId, GOAL_ANSWER_RECEIPT, slug, outcome.receipt!);
        return NextResponse.json({ ok: true, action, slug });
      }

      default:
        return NextResponse.json({ ok: false, error: 'unhandled_action', reason: 'That answer is not one this card can act on.' }, { status: 400 });
    }
  } catch (err: unknown) {
    // Was `err?.message` in the body. The 4xx refusals above still carry
    // their own `reason` — that split is the whole point of rule three.
    return outage('v5/goal-answer', err);
  }
}
