/**
 * POST /api/profile/goal
 *
 * Set or update the runner's fitness goal (no-race time target).
 * Writes profiles.tt_goal_distance + tt_goal_time + tt_goal_time_seconds.
 *
 * Body: { distance_label: "5K" | "10K" | "Half Marathon" | "Marathon" | "50K" | "100K",
 *         goal_time: "23:50" | "1:45:00" }
 *
 * Distance maps to the same labels the onboarding/plan system recognises.
 * goal_time is stored as-is (display string) and also parsed to seconds.
 */
import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/lib/db/pool';
import { requireUserId } from '@/lib/auth/session';
import { bustBriefingCacheForEvent } from '@/lib/coach/cache';
import { generatePlan } from '@/lib/plan/generate';
import { goalDistanceMiFromCode } from '@/lib/training/vdot';
import { runnerToday } from '@/lib/runtime/runner-tz';
import { patchSettings } from '@/lib/coach/settings';

const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
/** Parse + persist available_days (which days the runner can run) to
 *  user_settings before generating, so the plan places runs on those days. */
async function persistAvailableDays(userId: string, body: any): Promise<void> {
  const raw = Array.isArray(body?.available_days) ? body.available_days : null;
  if (!raw) return;
  const days = [...new Set(raw.filter((d: any) => DAY_KEYS.includes(d)))];
  if (days.length >= 2) await patchSettings(userId, { available_days: days as any }).catch(() => {});
}

const ALLOWED_DISTANCES = ['5K', '10K', 'Half Marathon', 'Marathon', '50K', '100K'];

/** Accepts MM:SS or H:MM:SS */
function parseTimeSeconds(s: string): number | null {
  const parts = s.split(':').map(Number);
  if (parts.some(isNaN)) return null;
  if (parts.length === 2 && parts[1] < 60) return parts[0] * 60 + parts[1];
  if (parts.length === 3 && parts[1] < 60 && parts[2] < 60) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  return null;
}

export async function POST(req: NextRequest) {
  const auth = await requireUserId(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth;

  const body = await req.json().catch(() => null);
  const distanceLabel = String(body?.distance_label ?? '').trim();
  const goalTime = String(body?.goal_time ?? '').trim();
  // Plan length the runner picked in SetGoalSheet (e.g. 10 / 14). Clamped.
  const planWeeksRaw = Number(body?.plan_weeks);
  const planWeeks = Number.isFinite(planWeeksRaw) && planWeeksRaw >= 4 && planWeeksRaw <= 52
    ? Math.round(planWeeksRaw) : null;

  if (!ALLOWED_DISTANCES.includes(distanceLabel)) {
    return NextResponse.json(
      { error: `distance_label must be one of: ${ALLOWED_DISTANCES.join(', ')}` },
      { status: 400 }
    );
  }
  if (!goalTime) {
    return NextResponse.json({ error: 'goal_time required (e.g. "23:50" or "1:45:00")' }, { status: 400 });
  }

  const goalSeconds = parseTimeSeconds(goalTime);
  if (!goalSeconds) {
    return NextResponse.json(
      { error: 'Could not parse goal_time. Use MM:SS or H:MM:SS format.' },
      { status: 400 }
    );
  }

  // 2026-06-20 · "when do you want to start" (David). SetGoalSheet now sends a
  // start_date; the plan anchors week 0 there and the goal deadline = start +
  // plan_weeks. Clamp to >= today so a goal can't back-date the plan. Falls back
  // to today when omitted (older clients / no pick).
  const todayISO = await runnerToday(userId);
  const startRaw = String(body?.start_date ?? '').trim();
  const startDateISO = /^\d{4}-\d{2}-\d{2}$/.test(startRaw) && startRaw >= todayISO
    ? startRaw : todayISO;
  // Persist available days BEFORE generating so the plan places runs on them.
  await persistAvailableDays(userId, body);

  await pool.query(
    `UPDATE profile
        SET tt_goal_distance        = $1,
            tt_goal_time            = $2,
            tt_goal_time_seconds    = $3,
            tt_goal_plan_weeks      = $5
      WHERE user_uuid = $4`,
    [distanceLabel, goalTime, goalSeconds, userId, planWeeks]
  );

  // Setting a goal GENERATES the plan — the goal IS the anchor (onboarding no
  // longer seeds). EVERY distance (5K → 100K) routes through the canonical
  // periodized builder via a goal target (no race row), so each gets a real
  // build: BASE → QUALITY → RACE-SPECIFIC → TAPER with distance-appropriate
  // long-run progression + race-pace work (incl. ultra). Synthetic target date
  // = today + plan_weeks. generatePlan reads volume/frequency/prefs itself.
  // Best-effort: a generation failure doesn't fail the save.
  let plan: Awaited<ReturnType<typeof generatePlan>> | null = null;
  let planError: string | null = null;
  const distMi = goalDistanceMiFromCode(distanceLabel);
  if (distMi) {
    const weeks = planWeeks ?? 16;
    // Deadline = chosen start + plan_weeks. The plan anchors week 0 at the start.
    const genWith = (anchor: 'today' | 'monday', startISO?: string) => {
      const baseISO = startISO ?? startDateISO;
      const raceDateISO = new Date(Date.parse(baseISO + 'T12:00:00Z') + weeks * 7 * 86400000)
        .toISOString().slice(0, 10);
      return generatePlan({
        userId,
        goalTarget: { distanceMi: distMi, goalSec: goalSeconds, raceDateISO },
        startDateISO: startISO,
        startAnchor: anchor,
        freshTarget: true,
      });
    };
    try {
      plan = await genWith('today', startDateISO);
    } catch (e) {
      planError = e instanceof Error ? e.message : 'plan generation error';
      console.error('[profile/goal] plan generation failed:', e);
    }
    // 2026-06-21 · fail-safe: a runner must NEVER be left with a saved goal and
    // zero plans (the workflow CRITICAL — a narrow runway/long alignment made a
    // valid marathon goal fail validation, the error was swallowed, and TODAY
    // went empty with no signal). If the chosen-start build did not produce a
    // valid plan, retry once Monday-anchored (which generates cleanly) and, if
    // it still fails, surface plan_error so the failure is visible, not silent.
    if (!plan || plan.ok === false) {
      if (plan && plan.ok === false) planError = plan.reason ?? planError ?? 'plan validation failed';
      try {
        const retry = await genWith('monday');
        if (retry && retry.ok) { plan = retry; planError = null; }
        else if (retry && retry.ok === false) planError = planError ?? retry.reason ?? 'plan validation failed';
      } catch (e2) {
        console.error('[profile/goal] Monday-anchored fallback also failed:', e2);
      }
    }
  }

  await bustBriefingCacheForEvent(userId, 'profile_edit');

  return NextResponse.json({
    ok: true, distance_label: distanceLabel, goal_time: goalTime, goal_seconds: goalSeconds,
    plan_weeks: planWeeks,
    plan: plan && plan.ok ? { ok: plan.ok, plan_id: plan.plan_id, weeks: plan.weeks_generated } : null,
    plan_error: planError,
  });
}
