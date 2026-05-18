/**
 * Strava activity writeback — rename + describe Strava activities to
 * match what the runner did in the faff.run plan.
 *
 * Triggered from the webhook `create` handler in /api/strava/webhook
 * (NEVER on `update` — that would clobber the runner's manual edits
 * forever after the first sync).
 *
 * Decisions (locked with David 2026-05-18):
 *   - Only fires if Strava name is one of the platform defaults
 *     ("Morning Run", "Afternoon Run", "Lunch Run", "Evening Run",
 *     "Night Run"). Anything custom → skip entirely.
 *   - Skips race-day activities so the runner's own race name stays.
 *   - Skips activities with no matching planned workout.
 *   - Skips when users.strava_writeback is false.
 *   - Writes both name + description. Description format is the
 *     faff.run block PLUS any pre-existing Strava description below
 *     it (separated by an em-dash divider).
 *
 * Required scope: activity:write — added to /api/strava/connect.
 * Existing connections need to re-authorize once.
 */

import { query } from './db';
import type { PlanWeek, PlanWeekDay, PlanPhase } from './synthetic-plan';
import { describeWorkout } from './workout-descriptions';

const STRAVA_DEFAULT_NAMES = new Set([
  'Morning Run',
  'Afternoon Run',
  'Lunch Run',
  'Evening Run',
  'Night Run',
]);

const PHASE_LABEL: Record<PlanPhase, string> = {
  BASE: 'Base',
  BUILD: 'Build',
  PEAK: 'Peak',
  TAPER: 'Taper',
  RACE_WEEK: 'Race Week',
};

export function isStravaDefaultName(name: string | null | undefined): boolean {
  if (!name) return true; // unnamed → treat as default
  return STRAVA_DEFAULT_NAMES.has(name.trim());
}

/** "Threshold · Cruise Intervals · Base Week 2" */
export function formatPlanName(day: PlanWeekDay, phase: PlanPhase, phaseWeek: number): string {
  return `${day.label} · ${PHASE_LABEL[phase]} Week ${phaseWeek}`;
}

interface ActualStats {
  distanceMi: number;
  paceSPerMi: number;
  avgHr: number | null;
}

function fmtPace(sPerMi: number): string {
  if (!sPerMi || sPerMi <= 0) return '—';
  const m = Math.floor(sPerMi / 60);
  const s = sPerMi % 60;
  return `${m}:${String(s).padStart(2, '0')}/mi`;
}

/**
 * Build the faff.run description block. Prepends it to any existing
 * Strava description (separated by an em-dash divider) so the runner's
 * own notes are preserved below.
 */
export function formatPlanDescription(
  day: PlanWeekDay,
  phase: PlanPhase,
  phaseWeek: number,
  actual: ActualStats,
  existingDescription: string | null,
): string {
  const desc = describeWorkout(day.label, day.type);
  const head = `faff.run · ${PHASE_LABEL[phase]} Week ${phaseWeek} · ${day.label}`;
  const planLine = `Plan: ${day.distanceMi} mi @ ${desc.paceTarget}`;
  const actualBits = [`Actual: ${actual.distanceMi} mi`];
  if (actual.paceSPerMi > 0) actualBits.push(`@ ${fmtPace(actual.paceSPerMi)}`);
  if (actual.avgHr && actual.avgHr > 0) actualBits.push(`· ${Math.round(actual.avgHr)} avg HR`);
  const actualLine = actualBits.join(' ');

  // Build a compact text version of the step table for the Strava
  // description (which is plain text — can't render the modal's grid).
  const stepLines = desc.steps.length === 0
    ? []
    : ['', 'WORKOUT', ...desc.steps.flatMap((s) => {
        const main = `  ${s.name} — ${s.duration} @ ${s.pace}`;
        return s.note ? [main, `    (${s.note})`] : [main];
      })];

  const tail = [
    '',
    `EFFORT: ${desc.effort}`,
    '',
    `WHY: ${desc.why}`,
  ];

  const block = [head, planLine, actualLine, ...stepLines, ...tail].join('\n');

  const existing = (existingDescription || '').trim();
  if (!existing) return block;
  // Don't duplicate the block if the activity already has it
  // (re-fire safety — webhook update events shouldn't trigger writeback
  // but if one slips through, this prevents stacking).
  if (existing.startsWith('faff.run · ')) {
    // Replace whatever's above the first em-dash divider (if any) with
    // our fresh block; preserve whatever's below.
    const dividerIdx = existing.indexOf('\n—\n');
    if (dividerIdx >= 0) {
      return `${block}\n—\n${existing.slice(dividerIdx + 3)}`;
    }
    return block;
  }
  return `${block}\n—\n${existing}`;
}

interface TokenRow { access_token: string; refresh_token: string | null; }

/**
 * Refresh + return a fresh access token for the user. We re-refresh on
 * every writeback call so a stale token never silently 401s — Strava
 * rotates refresh tokens, we persist the new one immediately.
 */
async function freshAccessToken(userId: string): Promise<string | null> {
  const rows = await query<TokenRow>(
    `SELECT access_token, refresh_token
       FROM connector_tokens
      WHERE user_id = $1 AND provider = 'strava' AND disconnected_at IS NULL
      LIMIT 1`,
    [userId],
  );
  const row = rows[0];
  if (!row?.refresh_token) return null;

  const clientId = process.env.STRAVA_CLIENT_ID;
  const clientSecret = process.env.STRAVA_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;

  const res = await fetch('https://www.strava.com/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: row.refresh_token,
      grant_type: 'refresh_token',
    }),
  });
  if (!res.ok) {
    console.error('[strava-writeback] token refresh failed:', res.status, await res.text());
    return null;
  }
  const j = (await res.json()) as { access_token: string; refresh_token: string; expires_at: number };
  await query(
    `UPDATE connector_tokens
        SET access_token = $2, refresh_token = $3, expires_at = $4, updated_at = NOW()
      WHERE user_id = $1 AND provider = 'strava'`,
    [userId, j.access_token, j.refresh_token, new Date(j.expires_at * 1000)],
  );
  return j.access_token;
}

interface WritebackParams {
  userId: string;
  activityId: number;
  /** Current Strava activity name + description, as fetched. */
  currentName: string | null;
  currentDescription: string | null;
  /** Plan day matched to this activity. Null = no plan match → skip. */
  day: PlanWeekDay | null;
  /** Week + phase for naming. */
  phase: PlanPhase;
  phaseWeek: number;
  /** Actual stats from the synced activity. */
  actual: ActualStats;
}

export interface WritebackResult {
  pushed: boolean;
  reason?: string;
}

/**
 * Push name + description back to Strava if all guards pass.
 * Returns { pushed: false, reason } when skipped — caller can log.
 */
export async function pushWorkoutNameToStrava(p: WritebackParams): Promise<WritebackResult> {
  if (!p.day) return { pushed: false, reason: 'no matching plan day' };
  if (p.day.type === 'race') return { pushed: false, reason: 'race day — never overwrite' };
  if (p.day.isRest || p.day.distanceMi === 0) return { pushed: false, reason: 'rest day' };
  if (!isStravaDefaultName(p.currentName)) {
    return { pushed: false, reason: `custom name "${p.currentName}" preserved` };
  }

  // Check the user opted in (defaults to TRUE)
  const settingRows = await query<{ enabled: boolean }>(
    `SELECT COALESCE(strava_writeback, TRUE) AS enabled FROM users WHERE id = $1 LIMIT 1`,
    [p.userId],
  );
  if (settingRows[0] && settingRows[0].enabled === false) {
    return { pushed: false, reason: 'writeback disabled by user' };
  }

  const accessToken = await freshAccessToken(p.userId);
  if (!accessToken) return { pushed: false, reason: 'no access token' };

  const name = formatPlanName(p.day, p.phase, p.phaseWeek);
  const description = formatPlanDescription(p.day, p.phase, p.phaseWeek, p.actual, p.currentDescription);

  const res = await fetch(`https://www.strava.com/api/v3/activities/${p.activityId}`, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ name, description }),
  });
  if (!res.ok) {
    const text = await res.text();
    console.error('[strava-writeback] PUT failed', p.activityId, res.status, text.slice(0, 200));
    return { pushed: false, reason: `Strava PUT ${res.status}` };
  }
  return { pushed: true };
}
