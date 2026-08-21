/**
 * GET /api/v5/paces · design 18a "Paces slower / faster".
 *
 * One mirrored surface, three data variants (`V5PaceDirection`):
 *   slower / faster-training  → MODELLED. Every zone value carries
 *                                `modelled: true`, `caption` states the read
 *                                is not race-confirmed, both dismissible.
 *   faster-race                → hard evidence. `modelled: false` on every
 *                                value, evidence shows the race itself, one
 *                                action ("Update my paces").
 *
 * Reads the durable pace-drop event `lib/plan/pace-drop-event.ts` stamped by
 * the daily self-heal (`lib/plan/reanchor-plan.ts`) or the race-authority
 * fallback (`POST /api/v5/race-authority`) and turns it into the per-zone
 * before/after off the canonical Daniels curve (`lib/plan/pace-zones.ts`) —
 * never a single headline delta.
 *
 * 404 (`no_pace_change`) when the plan has never recorded a re-anchor — a
 * genuine empty state, not a refusal: there is nothing to show, not a
 * declined request.
 */
import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/lib/db/pool';
import { requireUserId } from '@/lib/auth/session';
import { loadPaceZoneEvent, acknowledgePaceZoneEvent } from '@/lib/plan/pace-drop-event';
import { resolveZonePaces, formatDeltaLabel, formatPaceMinSec } from '@/lib/plan/pace-zones';
import { distanceMiFromLabel } from '@/lib/race/distance';
import { formatRaceTime, parseRaceTime } from '@/lib/training/vdot';
import { WATCH_PROVISIONAL_FINISH_LABEL, isProvisionalResult } from '@/lib/coach/races-state';

export const dynamic = 'force-dynamic';

interface V5Number { text: string | null; modelled: boolean }
/** `tone` inks the VALUE. 'attention' is the design's word for "a decision
 *  waiting" — an unconfirmed finish is exactly that. Added 2026-08-21 with
 *  the race-data re-audit; the phone's `V5Row` has always decoded it. */
interface V5Row {
  id: string; label: string; sub: string | null;
  value: V5Number | null; action: string | null;
  tone?: 'attention' | 'signal' | 'fault' | null;
}

function num(text: string | null, modelled: boolean): V5Number { return { text, modelled }; }

export async function GET(req: NextRequest) {
  const auth = await requireUserId(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth;

  const planRow = (await pool.query<{ id: string }>(
    `SELECT id FROM training_plans WHERE user_uuid = $1 AND archived_iso IS NULL
      ORDER BY authored_iso DESC LIMIT 1`,
    [userId],
  ).catch(() => ({ rows: [] }))).rows[0];
  if (!planRow) {
    // RULE FOUR. These three reasons render as the WHOLE Paces screen (the
    // phone puts `reason` straight into `Silence`), so they are runner-facing
    // copy, not log lines. They read as sentences now.
    return NextResponse.json({ error: 'no_pace_change', reason: 'There is no active plan, so there are no paces to move yet.' }, { status: 404 });
  }

  const event = await loadPaceZoneEvent(planRow.id);
  if (!event) {
    return NextResponse.json({ error: 'no_pace_change', reason: 'Your paces have not moved since this plan was written.' }, { status: 404 });
  }
  // Once acknowledged (a race-representativeness answer, or the plain
  // `POST` below for a non-race dismiss/confirm), the event has nothing
  // left to say — same "genuine empty state" 404 as never having fired at
  // all. Without this check, GET kept answering the same pending question
  // forever: the confirm section would re-render for a question the runner
  // already answered, and Today's paces-moved entry row (which reads this
  // same route's success/404 as its gate) would never clear either.
  if (event.acknowledgedAt) {
    return NextResponse.json({ error: 'no_pace_change', reason: 'You have already settled this one. The new bands are on Today.' }, { status: 404 });
  }

  // ── the evidence race, read BEFORE `direction` is decided ──────────────
  //
  // RULE ONE. `actual_result` can hold an AUTO-LOGGED watch time
  // (`source:'watch_provisional'`) that has not been confirmed against a
  // chip. It wins the result ladder, but it is a training effort with a race
  // still to lock it in — the same discriminator `races-state.ts` derives as
  // `finishProvisional` and the schedule list on /api/v5/races already ships.
  //
  // 2026-08-21 · race-data re-audit · this flag WAS computed here, and then
  // never read. `direction` was decided purely on `evidenceSource === 'race'`
  // further up the file, so an unconfirmed watch time produced the
  // `faster-race` variant: every zone pace stamped `modelled:false` (no amber
  // `~`), the caption suppressed, the coach line asserting "is confirmed
  // fitness", and a single irreversible "Update my paces" action offered on
  // the strength of it. That is precisely the claim a provisional time cannot
  // make. The read moved above `direction` so the flag can gate it.
  const raceRow = event.evidenceRaceSlug
    ? (await pool.query<{ meta: Record<string, unknown> | null; actual_result: Record<string, unknown> | null }>(
        `SELECT meta, actual_result FROM races WHERE slug = $1 AND user_uuid = $2`,
        [event.evidenceRaceSlug, userId],
      ).catch(() => ({ rows: [] }))).rows[0]
    : undefined;
  const meta = (raceRow?.meta ?? {}) as Record<string, unknown>;
  const ar = (raceRow?.actual_result ?? {}) as Record<string, unknown>;
  const raceFinishProvisional = isProvisionalResult(ar);

  const isRaceEvidence = event.evidenceSource === 'race' && event.evidenceRaceSlug != null;
  // A race CONFIRMS fitness only when its finish is confirmed. An unconfirmed
  // one still moved the read — it just moved it as a modelled read, which is
  // exactly what `faster-training` means on this screen.
  const raceConfirmsFitness = isRaceEvidence && !raceFinishProvisional;
  const direction: 'slower' | 'faster-training' | 'faster-race' =
    event.direction === 'slower' ? 'slower' : (raceConfirmsFitness ? 'faster-race' : 'faster-training');
  const modelled = direction !== 'faster-race';

  const zonePaces = resolveZonePaces(event.fromVdot, event.toVdot);
  const zones = zonePaces.map((z) => ({
    id: z.id,
    name: z.name,
    before: num(formatPaceMinSec(z.beforeSPerMi), modelled),
    after: num(formatPaceMinSec(z.afterSPerMi), modelled),
    delta: formatDeltaLabel(z.deltaSec),
  }));

  // ── evidence + confirm ─────────────────────────────────────────────────
  let evidence: V5Row[] = [];
  let raceName: string | null = null;
  if (event.evidenceRaceSlug) {
    raceName = typeof meta.name === 'string' ? meta.name : event.evidenceRaceSlug;
    const dateLabel = typeof meta.date === 'string' ? meta.date : null;
    const finishSec = ar.finishS != null ? Number(ar.finishS) : parseRaceTime(meta.finishTime as string);
    const finishText = formatRaceTime(finishSec);
    const distMi = meta.distanceMi ? Number(meta.distanceMi) : distanceMiFromLabel(meta.distanceLabel as string);

    const raceLabel: string = raceName ?? event.evidenceRaceSlug ?? 'Race';
    if (direction === 'faster-race') {
      // "the evidence list shows the race / finish / effort instead of
      // training causes" (docs/design/.../README-v5-handoff.md §18a).
      evidence = [
        { id: 'race', label: raceLabel, sub: dateLabel, value: null, action: null },
        { id: 'finish', label: 'Finish', sub: distMi ? `${distMi.toFixed(distMi < 10 ? 2 : 1)} mi` : null, value: num(finishText, false), action: null },
        { id: 'effort', label: 'Effort', sub: 'Race effort', value: null, action: null },
      ];
    } else {
      // A race triggered this modelled read (rule 8's downward re-anchor, or
      // an unconfirmed finish), but the zones are still re-derived, not
      // race-locked — so the evidence names what fed the read without
      // asserting a cause.
      evidence = [
        { id: 'race', label: raceLabel, sub: dateLabel, value: null, action: null },
        { id: 'finish', label: 'Finish', sub: distMi ? `${distMi.toFixed(distMi < 10 ? 2 : 1)} mi` : null, value: num(finishText, true), action: null },
      ];
      // Say WHY the finish carries the `~`, in the one string every other
      // surface renders verbatim, rather than leaving the mark unexplained.
      if (raceFinishProvisional) {
        evidence.push({
          id: 'provisional', label: 'Status', sub: null,
          value: num(WATCH_PROVISIONAL_FINISH_LABEL, false), action: null,
          tone: 'attention',
        });
      }
    }
  } else if (event.evidenceSource === 'training') {
    evidence = [
      { id: 'training', label: 'Recent training', sub: 'A recent effort moved the read', value: null, action: null },
    ];
  }

  const headline = direction === 'slower'
    ? 'Your paces moved slower.'
    : 'Your paces moved faster.';

  const coachLine = direction === 'faster-race'
    ? `${raceName ?? 'That race'} is confirmed fitness. Paces move to match.`
    : direction === 'faster-training'
      ? (isRaceEvidence
          // Names the race, and names what is missing, without calling it
          // training. The runner ran a race; only the time is unlocked.
          ? `${raceName ?? 'That race'} moved the read. The time is not locked in yet, so the paces are a projection.`
          : 'Recent training says you are fitter. Paces moved to match, not confirmed by a race.')
      : 'Threshold, interval and rep pace all moved. The evidence below is what changed. Nothing here is a diagnosis.';

  const caption = !modelled
    ? null
    : (isRaceEvidence && raceFinishProvisional
        ? 'Modelled from an unconfirmed finish · lock the chip time to confirm'
        : 'Modelled from training · not confirmed by a race');

  let confirm: {
    kind: 'race_counted' | 'update' | 'dismiss';
    question: string | null;
    options: V5Row[];
    actionLabel: string | null;
    raceSlug: string | null;
  };

  if (direction === 'faster-race') {
    confirm = {
      kind: 'update',
      question: null,
      options: [],
      actionLabel: 'Update my paces',
      raceSlug: event.evidenceRaceSlug,
    };
  } else if (direction === 'slower' && isRaceEvidence) {
    // "Did this race count?" — not accept/deny (docs/faff-iphone-design-
    // contract.md §"The confirm on a slower read").
    confirm = {
      kind: 'race_counted',
      question: 'Did this race count?',
      options: [
        { id: 'representative', label: 'Representative', sub: 'A clean read of where you are', value: null, action: 'representative' },
        { id: 'compromised', label: 'Compromised', sub: 'Heat, a hill, something off · partly fitness', value: null, action: 'compromised' },
        { id: 'unrepresentative', label: "Didn't count", sub: 'Sick, paced someone, ran it as a workout', value: null, action: 'unrepresentative' },
      ],
      actionLabel: null,
      raceSlug: event.evidenceRaceSlug,
    };
  } else {
    confirm = {
      kind: 'dismiss',
      question: null,
      options: [{ id: 'dismiss', label: 'Got it', sub: null, value: null, action: 'dismiss' }],
      actionLabel: null,
      raceSlug: null,
    };
  }

  return NextResponse.json({
    direction,
    headline,
    coachLine,
    zones,
    caption,
    evidence,
    confirm,
  });
}

/**
 * POST /api/v5/paces · body `{ action: 'acknowledge' }`.
 *
 * Settles the plan's pending pace-drop event when the runner's answer is
 * NOT a race-representativeness tier — "Got it" on a modelled dismiss,
 * "Just a good patch" on a faster-training read, or "Update my paces" on a
 * faster-race confirm. `POST /api/v5/race-authority` already acknowledges
 * the race-anchored `representative` tier; this is the sibling for every
 * other confirm option, so GET above can 404 once ANY of them has been
 * answered rather than only the one race-tiered path.
 */
export async function POST(req: NextRequest) {
  const auth = await requireUserId(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth;

  const planRow = (await pool.query<{ id: string }>(
    `SELECT id FROM training_plans WHERE user_uuid = $1 AND archived_iso IS NULL
      ORDER BY authored_iso DESC LIMIT 1`,
    [userId],
  ).catch(() => ({ rows: [] }))).rows[0];
  if (!planRow) {
    // RULE THREE. A bare `error` code with no `reason` fails `v5Write`'s
    // refusal test on the phone (APIV5.swift wants `refusal ?? reason`
    // non-empty), so this correct, deliberate decline rendered as the
    // data-outage ErrorNote — complete with a Retry button that can never
    // succeed. Every sibling refusal on this route already carries a reason.
    return NextResponse.json(
      { error: 'no_active_plan', reason: 'There is no active plan, so there is no pace read to settle.' },
      { status: 404 },
    );
  }

  await acknowledgePaceZoneEvent(planRow.id);
  return NextResponse.json({ ok: true });
}
