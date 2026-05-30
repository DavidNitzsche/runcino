/**
 * injury-builder · INJURY-mode plan generator.
 *
 * When `runner_injuries.resolved_date IS NULL`, the regular race-prep
 * plan is the wrong scaffold. This generator produces a return-to-run
 * progression: walk-only week → walk-run scaffolds → easy continuous
 * running, per Research/05-injury-return-protocols.md §General-
 * Principles.
 *
 * Invocation: triggered by coach_proposals.proposal_type='injury_adjust'
 * accept (Q-08 path). Caller already authoritatively decided the
 * runner is moving from race-prep into INJURY mode.
 *
 * Plan shape (severity-scaled):
 *   minor    · 2 weeks · walk-run 4:1 → 2:3 → easy 15-20min
 *   moderate · 3 weeks · walk 25min → walk-run 4:1 → 2:3
 *   major    · 4 weeks · walk 20min → walk 30min → walk-run 5:1 → 4:2
 *
 * After the INJURY plan ends, the runner re-enters the regular
 * race-prep flow via /api/plan/generate against their next A race.
 *
 * Cite: Research/05-injury-return-protocols.md §General-Principles
 *       (walk-run scaffold + pain-monitoring rules: in-session,
 *       24-hour, location).
 */
import { pool } from '@/lib/db/pool';
import { randomBytes } from 'crypto';

export interface InjuryBuildInput {
  userId: string;
  injuryId: number;
}

export interface InjuryBuildResult {
  ok: boolean;
  plan_id?: string;
  weeks_generated?: number;
  reason?: string;
}

function id(prefix: string): string {
  return `${prefix}_${randomBytes(8).toString('hex')}`;
}

function todayPT(): string {
  return new Date(Date.now() - 7 * 3600000).toISOString().slice(0, 10);
}

function addDays(iso: string, days: number): string {
  return new Date(Date.parse(iso + 'T12:00:00Z') + days * 86400000).toISOString().slice(0, 10);
}

function mondayOf(iso: string): string {
  const d = new Date(iso + 'T12:00:00Z');
  const dow = d.getUTCDay();
  const shift = dow === 0 ? -6 : 1 - dow;
  return addDays(iso, shift);
}

interface DayShape {
  dow: number; // 0=Sun..6=Sat
  type: string;
  subLabel: string;
  notes: string;
  distance_mi: number;
}

/**
 * 7-day shape for one week of INJURY mode, severity-scaled.
 * Returns the same Mon-Sun layout used by plan_workouts.
 */
function injuryWeekShape(weekIdx: number, severity: 'minor' | 'moderate' | 'major'): DayShape[] {
  // Common 7-day pattern: Mon rest, Tue session, Wed cross-train,
  // Thu session, Fri rest, Sat session, Sun session.
  const sessionDays = [1, 2, 3, 5, 6]; // Mon..Sat indices for "active" days
  void sessionDays;

  // Pick this week's prescription based on severity + weekIdx.
  const phase = severity === 'minor'
    ? (weekIdx === 0 ? 'walk-run-4-1' : 'walk-run-2-3')
    : severity === 'moderate'
      ? (weekIdx === 0 ? 'walk-only-25' : weekIdx === 1 ? 'walk-run-4-1' : 'walk-run-2-3')
      : /* major */
        (weekIdx === 0 ? 'walk-only-20' : weekIdx === 1 ? 'walk-only-30'
         : weekIdx === 2 ? 'walk-run-5-1' : 'walk-run-4-2');

  const phaseDetails: Record<string, { subLabel: string; notes: string; durationMin: number }> = {
    'walk-only-20':   { subLabel: 'WALK 20 MIN', durationMin: 20, notes: 'Walk only. Goal: 20 minutes pain-free. Monitor symptoms in-session, 24h post, and site.' },
    'walk-only-25':   { subLabel: 'WALK 25 MIN', durationMin: 25, notes: 'Walk only. Goal: 25 minutes pain-free. Monitor symptoms in-session, 24h post, and site.' },
    'walk-only-30':   { subLabel: 'WALK 30 MIN', durationMin: 30, notes: 'Walk only. Goal: 30 minutes pain-free. Pain check daily before each session.' },
    'walk-run-5-1':   { subLabel: 'WALK-RUN 5:1', durationMin: 25, notes: '5 min walk / 1 min jog × 4-5 reps. Easy jog effort. Pain ≥ 4/10 = stop.' },
    'walk-run-4-2':   { subLabel: 'WALK-RUN 4:2', durationMin: 30, notes: '4 min walk / 2 min jog × 4-5 reps. Pain ≥ 4/10 = stop.' },
    'walk-run-4-1':   { subLabel: 'WALK-RUN 4:1', durationMin: 25, notes: '4 min walk / 1 min jog × 5 reps. Pain ≥ 4/10 = stop.' },
    'walk-run-2-3':   { subLabel: 'WALK-RUN 2:3', durationMin: 25, notes: '2 min walk / 3 min jog × 5 reps. Pain ≥ 4/10 = stop. If 0 pain at end, progress to continuous next week.' },
  };
  const detail = phaseDetails[phase];

  // Mon: rest. Tue/Thu/Sat: active session. Wed: cross-train. Fri: rest.
  // Sun: optional active session for moderate+ in later weeks.
  const days: DayShape[] = [];
  for (let dow = 0; dow < 7; dow++) {
    if (dow === 1 || dow === 5) {
      // Mon, Fri = rest
      days.push({ dow, type: 'rest', subLabel: 'REST', notes: 'Off. Mobility + ice if symptoms warrant.', distance_mi: 0 });
    } else if (dow === 3) {
      // Wed = cross-train
      days.push({ dow, type: 'rest', subLabel: 'CROSS-TRAIN', notes: 'Bike, swim, or pool-run 30-45 min easy. Non-impact aerobic.', distance_mi: 0 });
    } else if (dow === 0 && severity === 'minor') {
      // Minor: Sun off in week 0
      days.push({ dow, type: 'rest', subLabel: 'REST', notes: 'Off.', distance_mi: 0 });
    } else {
      // Active session day
      days.push({
        dow,
        type: 'easy',
        subLabel: detail.subLabel,
        notes: detail.notes,
        // Approximate the mileage from duration at ~12 min/mi walk-jog pace
        distance_mi: Math.round((detail.durationMin / 12) * 10) / 10,
      });
    }
  }
  return days;
}

/**
 * Build an INJURY-mode plan for the runner. Archives any active plan
 * then writes a new training_plans row with mode='injury-return'.
 */
export async function buildInjuryPlan(input: InjuryBuildInput): Promise<InjuryBuildResult> {
  const { userId, injuryId } = input;

  // Load the injury row to determine severity + duration.
  const injury = (await pool.query(
    `SELECT id, site, severity, start_date::text AS start_date, return_protocol
       FROM runner_injuries
      WHERE id = $1 AND user_uuid = $2 AND resolved_date IS NULL`,
    [injuryId, userId],
  ).catch(() => ({ rows: [] }))).rows[0];
  if (!injury) return { ok: false, reason: 'injury row not found or already resolved' };

  const severity = (injury.severity ?? 'moderate') as 'minor' | 'moderate' | 'major';
  const totalWeeks = severity === 'minor' ? 2 : severity === 'moderate' ? 3 : 4;

  // Archive any active plan for this user first.
  await pool.query(
    `UPDATE training_plans SET archived_iso = NOW()
      WHERE user_uuid = $1 AND archived_iso IS NULL`,
    [userId],
  ).catch(() => {});

  // Create the new INJURY plan.
  const planId = id('pln');
  const today = todayPT();
  const startMonday = mondayOf(today);
  const goalISO = addDays(startMonday, totalWeeks * 7 - 1); // end-of-plan date

  await pool.query(
    `INSERT INTO training_plans (id, user_id, user_uuid, mode, race_id, goal_iso, authored_state)
     VALUES ($1, 'me', $2, 'maintenance', NULL, $3, $4)`,
    [
      planId, userId, goalISO,
      JSON.stringify({
        mode_label: 'injury-return',
        injury_id: injuryId,
        injury_site: injury.site,
        severity,
        protocol: injury.return_protocol ?? null,
        total_weeks: totalWeeks,
        generated_at: new Date().toISOString(),
        citations: ['Research/05-injury-return-protocols.md §General-Principles'],
      }),
    ],
  );

  // Single phase: INJURY_RETURN.
  const phaseId = id('phs');
  await pool.query(
    `INSERT INTO plan_phases (id, plan_id, label, start_week_idx, end_week_idx, rationale, citation)
     VALUES ($1, $2, 'INJURY-RETURN', 0, $3, $4, 'Research/05-injury-return-protocols.md §General-Principles')`,
    [
      phaseId, planId, totalWeeks - 1,
      `Walk-run progression for ${injury.site} (${severity}). Pain ≥ 4/10 stops the session.`,
    ],
  );

  // Generate weeks + workouts.
  for (let wi = 0; wi < totalWeeks; wi++) {
    const weekId = id('wk');
    const weekStart = addDays(startMonday, wi * 7);
    await pool.query(
      `INSERT INTO plan_weeks (id, plan_id, week_idx, week_start_iso, phase_id, is_race_week, rationale)
       VALUES ($1, $2, $3, $4, $5, FALSE, $6)`,
      [weekId, planId, wi, weekStart, phaseId, `INJURY-RETURN · week ${wi + 1} of ${totalWeeks}`],
    );

    const days = injuryWeekShape(wi, severity);
    for (const d of days) {
      if (d.distance_mi === 0 && d.type !== 'rest') continue;
      const wkoId = id('wko');
      const dateISO = addDays(weekStart, ((d.dow - 1 + 7) % 7));
      await pool.query(
        `INSERT INTO plan_workouts (id, plan_id, week_id, date_iso, dow, type, distance_mi,
                                    is_quality, is_long, notes, sub_label,
                                    original_date_iso, original_type, original_distance_mi)
         VALUES ($1, $2, $3, $4, $5, $6, $7, FALSE, FALSE, $8, $9, $4, $6, $7)`,
        [wkoId, planId, weekId, dateISO, d.dow, d.type, d.distance_mi, d.notes, d.subLabel],
      );
    }
  }

  return { ok: true, plan_id: planId, weeks_generated: totalWeeks };
}
