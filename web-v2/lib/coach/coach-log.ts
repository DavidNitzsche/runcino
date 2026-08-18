/**
 * lib/coach/coach-log.ts · the coach's log — minimum relationship arc.
 *
 * 2026-08-17 · coach-experience pass. The engine had no long-term
 * memory a runner could see: pr_bank re-paced silently (nobody told the
 * runner they got faster), phase transitions were never spoken, and a
 * biggest-week-of-the-block closed without a word. This module is the
 * deterministic log a real coach keeps:
 *
 *   · week_close — fired the morning a training week closes (the day
 *     after the long-run day, same weekWindowFor boundary every week
 *     total uses). "Biggest week of the block · 42.1 mi · both quality
 *     days landed."
 *   · phase_boundary — fired when the active plan crosses phases.
 *     "Base done · 8 weeks, 240 mi, long run 10→16. Build starts today."
 *   · first_ever — all-time firsts: longest run ever, biggest week ever.
 *   · fitness_shift — read-time merge of plan_adapt_recompute_paces
 *     intents (pr_bank / fitness_regression / goal_changed), so every
 *     silent re-pace becomes a spoken line: "New race fitness · VDOT
 *     45.1 · your paces just moved."
 *   · easy_discipline — the runner's easy days have been running over
 *     the easy ceiling as a SUSTAINED PATTERN (lib/coach/easy-discipline.ts
 *     owns the detection and the per-run context filtering). Written
 *     exactly twice per episode: once when the pattern establishes and
 *     once when it resolves. Never in between — this is an observation,
 *     not a per-run grade (feedback_no_reactive_coach).
 *   · fitness_evidence — 2026-08-18 · a key session read PARTIAL_FAILED
 *     with evidence.fitness === 'high' (lib/coach/fitness-evidence.ts,
 *     lib/execution/interpret.ts): the athlete came apart at a pace already
 *     established as achievable, which Design/execution-memory-firing.md
 *     Part 1 calls "one of the most informative things that can happen."
 *     Routed through classifyFinding (lib/coach/firing-policy.ts) before it
 *     writes; only written when that classification is SURFACE or louder.
 *     One-shot per session date, not an episode.
 *
 * STORAGE · coach_intents (no new table, no DDL). Entries are rows with
 * reason 'coach_log_<kind>', field = idempotency key, value = the
 * composed entry JSON. acknowledged_at is stamped at insert so the
 * state-loader's pending-intents read (acknowledged_at IS NULL) never
 * picks log entries up as actionable intents — they are history, not
 * asks. Re-running updateCoachLog is idempotent on (reason, field).
 *
 * WRITE SEAM · updateCoachLog(userId) rides the daily run-adaptations
 * cron (one call per user, best-effort). Week/phase checks only do work
 * on the week-boundary morning; the longest-run check is one indexed
 * query per day.
 *
 * READ · loadCoachLog(userId, {limit, before}) → newest-first page.
 * GET /api/coach/log wraps it; the web TrainView LOG strip renders it.
 *
 * Wire contract for native (additive, stable):
 *   { entries: [{ id, kind, dateISO, title, body, meta, ts }], nextBefore }
 *
 * Voice: coach voice · short · no hype · no exclamation marks · " · "
 * joiner · no citations in payloads.
 */

import { pool } from '@/lib/db/pool';
import { runnerToday } from '@/lib/runtime/runner-tz';
import { canonicalMileageByDay } from '@/lib/runs/merge';
import { loadActivePlan } from '@/lib/plan/lookup';
import { loadSettings } from '@/lib/coach/settings';
import { weekWindowFor } from '@/lib/coach/week-window';
import { stripResearchCitations } from '@/lib/plan/strip-citations';
import {
  loadEasyDiscipline,
  composeEasyDisciplineEntry,
  composeEasyDisciplineResolved,
  type EasyDisciplineFinding,
  type EasyQuietReason,
} from '@/lib/coach/easy-discipline';
import { updateEpisode, type EpisodeDetector } from '@/lib/coach/episode-log';
import { classifyFinding, atLeastAsLoud } from '@/lib/coach/firing-policy';
import {
  loadPartialFitnessEvidenceFindings,
  composeFitnessEvidenceEntry,
} from '@/lib/coach/fitness-evidence';

/* ────────────────────────── Types ────────────────────────── */

export type CoachLogKind =
  | 'week_close'
  | 'phase_boundary'
  | 'first_ever'
  | 'fitness_shift'
  | 'easy_discipline'
  | 'fitness_evidence';

export interface CoachLogEntry {
  id: string;
  kind: CoachLogKind;
  /** The day the entry is ABOUT (week-close = closed week's last day). */
  dateISO: string;
  /** Short display eyebrow · e.g. "WEEK CLOSED" / "PHASE" / "FIRST". */
  title: string;
  /** The coach's line. One or two short sentences. */
  body: string;
  meta: Record<string, unknown>;
  /** When the entry was written (ISO timestamp). */
  ts: string;
}

const REASON_OF_KIND: Record<Exclude<CoachLogKind, 'fitness_shift'>, string> = {
  week_close: 'coach_log_week_close',
  phase_boundary: 'coach_log_phase',
  first_ever: 'coach_log_first',
  easy_discipline: 'coach_log_easy_discipline',
  fitness_evidence: 'coach_log_fitness_evidence',
};

/* ──────────────────── Pure entry composers ──────────────────── */

const round1 = (n: number) => Math.round(n * 10) / 10;

function qualityClause(done: number, planned: number): string {
  if (planned <= 0) return 'all easy by design';
  if (done >= planned) {
    if (planned === 1) return 'the quality day landed';
    if (planned === 2) return 'both quality days landed';
    return `all ${planned} quality days landed`;
  }
  if (done === 0) return `quality slipped · 0 of ${planned} landed`;
  return `${done} of ${planned} quality days landed`;
}

export interface WeekCloseInput {
  weekStartISO: string;
  weekEndISO: string;
  totalMi: number;
  plannedMi: number | null;
  qualityPlanned: number;
  qualityDone: number;
  longestDayMi: number;
  isBiggestOfBlock: boolean;
  isBiggestEver: boolean;
  /** Week contained a race / tune-up row · the race is the story, and
   *  "all easy by design" would misread the week. */
  hadRace?: boolean;
}

/** Week-close line. Biggest-ever beats biggest-of-block beats plain. */
export function composeWeekCloseEntry(w: WeekCloseInput): { title: string; body: string } {
  const mi = round1(w.totalMi);
  const q = w.hadRace ? 'race week · the race is the story, not the volume' : qualityClause(w.qualityDone, w.qualityPlanned);
  if (w.isBiggestEver) {
    return { title: 'WEEK CLOSED', body: `Biggest week you have ever logged · ${mi} mi · ${q}.` };
  }
  if (w.isBiggestOfBlock) {
    return { title: 'WEEK CLOSED', body: `Biggest week of the block · ${mi} mi · ${q}.` };
  }
  if (w.totalMi <= 0.3) {
    return { title: 'WEEK CLOSED', body: `A zero week went in the book. The plan resumes where you are, not where the calendar says.` };
  }
  const plannedPart = w.plannedMi != null && w.plannedMi > 0
    ? ` of ${round1(w.plannedMi)} planned`
    : '';
  return { title: 'WEEK CLOSED', body: `${mi} mi${plannedPart} · ${q}.` };
}

export interface PhaseBoundaryInput {
  endedPhase: string;
  weeks: number;
  totalMi: number;
  longFirstMi: number | null;
  longLastMi: number | null;
  nextPhase: string | null;
  /** ISO date the next phase starts. */
  nextStartISO: string | null;
  todayISO: string;
}

function cap(s: string): string {
  const t = s.trim();
  return t.length ? t[0].toUpperCase() + t.slice(1).toLowerCase() : t;
}

function startWord(nextStartISO: string | null, todayISO: string): string {
  if (!nextStartISO || nextStartISO === todayISO) return 'today';
  const d = new Date(nextStartISO + 'T12:00:00Z');
  return new Intl.DateTimeFormat('en-US', { weekday: 'long', timeZone: 'UTC' }).format(d);
}

/** Phase-boundary line. */
export function composePhaseBoundaryEntry(p: PhaseBoundaryInput): { title: string; body: string } {
  const span = `${p.weeks} ${p.weeks === 1 ? 'week' : 'weeks'}, ${Math.round(p.totalMi)} mi`;
  const longPart = p.longFirstMi != null && p.longLastMi != null && p.longLastMi > p.longFirstMi
    ? `, long run ${Math.round(p.longFirstMi)}→${Math.round(p.longLastMi)}`
    : '';
  const tail = p.nextPhase
    ? ` ${cap(p.nextPhase)} starts ${startWord(p.nextStartISO, p.todayISO)}.`
    : '';
  return {
    title: 'PHASE',
    body: `${cap(p.endedPhase)} done · ${span}${longPart}.${tail}`,
  };
}

export type FirstEverKind = 'longest_run' | 'biggest_week';

export interface FirstEverInput {
  kind: FirstEverKind;
  valueMi: number;
  previousBestMi: number | null;
}

/** All-time-first line. */
export function composeFirstEverEntry(f: FirstEverInput): { title: string; body: string } {
  const mi = round1(f.valueMi);
  const prev = f.previousBestMi != null ? ` Old mark ${round1(f.previousBestMi)}.` : '';
  if (f.kind === 'longest_run') {
    return { title: 'FIRST', body: `Longest run you have ever logged · ${mi} mi.${prev}` };
  }
  return { title: 'FIRST', body: `Biggest week you have ever logged · ${mi} mi.${prev}` };
}

/* ──────────────────── Idempotent writer ──────────────────── */

async function entryExists(userId: string, reason: string, field: string): Promise<boolean> {
  const r = await pool.query(
    `SELECT 1 FROM coach_intents
      WHERE COALESCE(user_uuid, user_id) = $1 AND reason = $2 AND field = $3
      LIMIT 1`,
    [userId, reason, field],
  ).catch(() => ({ rows: [] as unknown[] }));
  return r.rows.length > 0;
}

async function writeEntry(
  userId: string,
  kind: Exclude<CoachLogKind, 'fitness_shift'>,
  field: string,
  entry: { title: string; body: string; dateISO: string; meta?: Record<string, unknown> },
): Promise<boolean> {
  const reason = REASON_OF_KIND[kind];
  if (await entryExists(userId, reason, field)) return false;
  // acknowledged_at stamped at insert · log entries are history, never
  // pending asks (state-loader pendingIntents filters on IS NULL).
  await pool.query(
    `INSERT INTO coach_intents (user_id, user_uuid, reason, field, value, acknowledged_at)
     VALUES ($1, $1, $2, $3, $4, NOW())`,
    [userId, reason, field, JSON.stringify({
      kind,
      dateISO: entry.dateISO,
      title: entry.title,
      body: entry.body,
      meta: entry.meta ?? {},
    })],
  );
  return true;
}

/* ──────────────────── Daily update pass ──────────────────── */

/** Weekly canonical totals bucketed on the runner's week boundary. */
function bucketWeeks(
  byDay: Map<string, { mi: number }>,
  anyWeekStartISO: string,
): Map<string, number> {
  const anchor = Date.parse(anyWeekStartISO + 'T12:00:00Z');
  const out = new Map<string, number>();
  for (const [day, info] of byDay) {
    if (info.mi <= 0) continue;
    const t = Date.parse(day + 'T12:00:00Z');
    const weekIdx = Math.floor((t - anchor) / (7 * 86400000));
    const ws = new Date(anchor + weekIdx * 7 * 86400000).toISOString().slice(0, 10);
    out.set(ws, (out.get(ws) ?? 0) + info.mi);
  }
  return out;
}

/**
 * The daily coach-log check. Cheap on non-boundary days (one indexed
 * longest-run query); does the week/phase work only on the morning a
 * training week closes. Idempotent — safe to re-run. Never throws.
 */
export async function updateCoachLog(userId: string): Promise<{ written: number }> {
  let written = 0;
  try {
    const today = await runnerToday(userId);
    const settings = await loadSettings(userId).catch(() => null);
    const ww = weekWindowFor(settings?.long_run_day ?? 'sun', today);
    const plan = await loadActivePlan(userId).catch(() => null);

    // ── 1 · Week close + biggest-week firsts (boundary morning only) ──
    if (today === ww.startISO) {
      const closedStart = new Date(Date.parse(ww.startISO + 'T12:00:00Z') - 7 * 86400000)
        .toISOString().slice(0, 10);
      const closedEnd = new Date(Date.parse(ww.startISO + 'T12:00:00Z') - 1 * 86400000)
        .toISOString().slice(0, 10);
      const weekKey = `week:${closedStart}`;
      if (!(await entryExists(userId, REASON_OF_KIND.week_close, weekKey))) {
        // 53 trailing weeks of canonical mileage · block + all-time context.
        const histFrom = new Date(Date.parse(closedStart + 'T12:00:00Z') - 52 * 7 * 86400000)
          .toISOString().slice(0, 10);
        const byDay = await canonicalMileageByDay(userId, histFrom, closedEnd);
        const weekTotals = bucketWeeks(byDay, closedStart);
        const totalMi = weekTotals.get(closedStart) ?? 0;

        let longestDayMi = 0;
        for (const [day, info] of byDay) {
          if (day >= closedStart && day <= closedEnd) longestDayMi = Math.max(longestDayMi, info.mi);
        }

        // Plan side of the closed week · planned volume + quality landed.
        let plannedMi: number | null = null;
        let qualityPlanned = 0;
        let qualityDone = 0;
        let hadRace = false;
        if (plan) {
          const rows = (await pool.query<{ date_iso: string; type: string; distance_mi: string | null }>(
            `SELECT date_iso::text, type, distance_mi::text
               FROM plan_workouts
              WHERE plan_id = $1 AND date_iso BETWEEN $2 AND $3 AND type <> 'strength'`,
            [plan.id, closedStart, closedEnd],
          ).catch(() => ({ rows: [] as Array<{ date_iso: string; type: string; distance_mi: string | null }> }))).rows;
          plannedMi = rows.reduce((s, r) => s + (Number(r.distance_mi) || 0), 0);
          hadRace = rows.some((r) => r.type === 'race' || r.type === 'race_week_tuneup');
          const QUALITY = new Set(['threshold', 'tempo', 'intervals', 'vo2max']);
          for (const r of rows) {
            if (!QUALITY.has(r.type)) continue;
            qualityPlanned++;
            const prescribed = Number(r.distance_mi) || 0;
            const dayMi = byDay.get(r.date_iso.slice(0, 10))?.mi ?? 0;
            // ≥60% of the prescription counts as landed · same
            // workout-relative threshold the adapter's missed detector
            // uses (adapt.ts completionThresholdMi).
            const threshold = prescribed > 0 ? Math.min(prescribed, Math.max(1, prescribed * 0.6)) : 1;
            if (dayMi >= threshold) qualityDone++;
          }
        }

        // Block window · weeks since the active plan was authored.
        const blockStart = plan?.authored_iso?.slice(0, 10) ?? null;
        let isBiggestOfBlock = false;
        let priorWeeksInBlock = 0;
        let isBiggestEver = false;
        let priorWeeksWithMiles = 0;
        let priorBestWeekMi = 0;
        for (const [ws, mi] of weekTotals) {
          if (ws >= closedStart) continue;
          if (mi > 0.3) priorWeeksWithMiles++;
          priorBestWeekMi = Math.max(priorBestWeekMi, mi);
          if (blockStart && ws >= blockStart) priorWeeksInBlock++;
        }
        if (blockStart && priorWeeksInBlock >= 2) {
          let blockBest = 0;
          for (const [ws, mi] of weekTotals) {
            if (ws >= blockStart && ws < closedStart) blockBest = Math.max(blockBest, mi);
          }
          isBiggestOfBlock = totalMi > blockBest && totalMi > 0.3;
        }
        // "Ever" is honest only with real history · require 5 prior weeks.
        if (priorWeeksWithMiles >= 5 && totalMi > priorBestWeekMi && totalMi > 0.3) {
          isBiggestEver = true;
        }

        const composed = composeWeekCloseEntry({
          weekStartISO: closedStart,
          weekEndISO: closedEnd,
          totalMi,
          plannedMi,
          qualityPlanned,
          qualityDone,
          longestDayMi,
          isBiggestOfBlock,
          isBiggestEver,
          hadRace,
        });
        if (await writeEntry(userId, 'week_close', weekKey, {
          ...composed,
          dateISO: closedEnd,
          meta: {
            weekStartISO: closedStart, totalMi: round1(totalMi),
            plannedMi: plannedMi != null ? round1(plannedMi) : null,
            qualityPlanned, qualityDone, hadRace,
            isBiggestOfBlock, isBiggestEver,
          },
        })) written++;

        if (isBiggestEver) {
          const first = composeFirstEverEntry({
            kind: 'biggest_week', valueMi: totalMi, previousBestMi: priorBestWeekMi,
          });
          if (await writeEntry(userId, 'first_ever', `first:biggest_week:${closedStart}`, {
            ...first, dateISO: closedEnd,
            meta: { kind: 'biggest_week', valueMi: round1(totalMi), previousBestMi: round1(priorBestWeekMi) },
          })) written++;
        }
      }

      // ── 2 · Phase boundary (phases flip on week boundaries) ──
      if (plan) {
        const weeks = (await pool.query<{ id: string; week_idx: number; week_start_iso: string }>(
          `SELECT id::text, week_idx, week_start_iso::text
             FROM plan_weeks WHERE plan_id = $1 ORDER BY week_idx`,
          [plan.id],
        ).catch(() => ({ rows: [] as Array<{ id: string; week_idx: number; week_start_iso: string }> }))).rows;
        const phases = (await pool.query<{ label: string; start_week_idx: number; end_week_idx: number }>(
          `SELECT label, start_week_idx, end_week_idx
             FROM plan_phases WHERE plan_id = $1 ORDER BY start_week_idx`,
          [plan.id],
        ).catch(() => ({ rows: [] as Array<{ label: string; start_week_idx: number; end_week_idx: number }> }))).rows;
        const cur = weeks.find((w) => {
          const ws = w.week_start_iso.slice(0, 10);
          const next = new Date(Date.parse(ws + 'T12:00:00Z') + 7 * 86400000).toISOString().slice(0, 10);
          return ws <= today && next > today;
        });
        const prev = cur ? weeks.find((w) => w.week_idx === cur.week_idx - 1) : undefined;
        if (cur && prev && phases.length > 0) {
          const phaseOf = (idx: number) =>
            phases.find((p) => idx >= p.start_week_idx && idx <= p.end_week_idx) ?? null;
          const curPhase = phaseOf(cur.week_idx);
          const prevPhase = phaseOf(prev.week_idx);
          if (curPhase && prevPhase && curPhase.label !== prevPhase.label) {
            const key = `phase:${plan.id}:${curPhase.label}`;
            if (!(await entryExists(userId, REASON_OF_KIND.phase_boundary, key))) {
              // Ended-phase stats · canonical miles across its weeks +
              // long-run progression from the plan's own long rows.
              const phaseWeeks = weeks.filter((w) =>
                w.week_idx >= prevPhase.start_week_idx && w.week_idx <= prevPhase.end_week_idx);
              const phaseStart = phaseWeeks[0]?.week_start_iso.slice(0, 10) ?? today;
              const phaseEnd = new Date(Date.parse(cur.week_start_iso.slice(0, 10) + 'T12:00:00Z') - 86400000)
                .toISOString().slice(0, 10);
              const phaseByDay = await canonicalMileageByDay(userId, phaseStart, phaseEnd);
              let phaseMi = 0;
              for (const [, v] of phaseByDay) phaseMi += v.mi;
              const longRows = (await pool.query<{ week_id: string; distance_mi: string | null }>(
                `SELECT week_id::text, distance_mi::text FROM plan_workouts
                  WHERE plan_id = $1 AND type = 'long'
                    AND week_id = ANY($2::text[])`,
                [plan.id, phaseWeeks.map((w) => w.id)],
              ).catch(() => ({ rows: [] as Array<{ week_id: string; distance_mi: string | null }> }))).rows;
              const firstWeekId = phaseWeeks[0]?.id;
              const lastWeekId = phaseWeeks[phaseWeeks.length - 1]?.id;
              const longMi = (weekId: string | undefined): number | null => {
                if (!weekId) return null;
                const vals = longRows.filter((r) => r.week_id === weekId)
                  .map((r) => Number(r.distance_mi) || 0);
                return vals.length ? Math.max(...vals) : null;
              };
              const composed = composePhaseBoundaryEntry({
                endedPhase: prevPhase.label,
                weeks: phaseWeeks.length,
                totalMi: phaseMi,
                longFirstMi: longMi(firstWeekId),
                longLastMi: longMi(lastWeekId),
                nextPhase: curPhase.label,
                nextStartISO: cur.week_start_iso.slice(0, 10),
                todayISO: today,
              });
              if (await writeEntry(userId, 'phase_boundary', key, {
                ...composed, dateISO: today,
                meta: {
                  endedPhase: prevPhase.label, nextPhase: curPhase.label,
                  weeks: phaseWeeks.length, totalMi: Math.round(phaseMi),
                },
              })) written++;
            }
          }
        }
      }
    }

    // ── 3 · Longest run ever (daily · one indexed query) ──
    const yesterdayISO = new Date(Date.parse(today + 'T12:00:00Z') - 86400000)
      .toISOString().slice(0, 10);
    const lr = (await pool.query<{ yesterday_mi: string | null; prior_max_mi: string | null; prior_runs: string }>(
      `SELECT
         (SELECT MAX((data->>'distanceMi')::numeric) FROM runs
           WHERE user_uuid = $1::uuid AND NOT (data ? 'mergedIntoId')
             AND COALESCE(data->>'date', LEFT(data->>'startLocal',10)) = $2) AS yesterday_mi,
         (SELECT MAX((data->>'distanceMi')::numeric) FROM runs
           WHERE user_uuid = $1::uuid AND NOT (data ? 'mergedIntoId')
             AND COALESCE(data->>'date', LEFT(data->>'startLocal',10)) < $2) AS prior_max_mi,
         (SELECT COUNT(*)::text FROM runs
           WHERE user_uuid = $1::uuid AND NOT (data ? 'mergedIntoId')
             AND (data->>'distanceMi')::numeric > 0.3
             AND COALESCE(data->>'date', LEFT(data->>'startLocal',10)) < $2) AS prior_runs`,
      [userId, yesterdayISO],
    ).catch(() => ({ rows: [] as Array<{ yesterday_mi: string | null; prior_max_mi: string | null; prior_runs: string }> }))).rows[0];
    const yMi = lr?.yesterday_mi != null ? Number(lr.yesterday_mi) : null;
    const priorMax = lr?.prior_max_mi != null ? Number(lr.prior_max_mi) : null;
    const priorRuns = lr?.prior_runs != null ? Number(lr.prior_runs) : 0;
    // Honest "ever" needs history · require 10 prior runs and a real jump
    // (> 0.2 mi over the old mark, so GPS jitter never mints a first).
    if (yMi != null && priorMax != null && priorRuns >= 10 && yMi > priorMax + 0.2) {
      const first = composeFirstEverEntry({ kind: 'longest_run', valueMi: yMi, previousBestMi: priorMax });
      if (await writeEntry(userId, 'first_ever', `first:longest_run:${yesterdayISO}`, {
        ...first, dateISO: yesterdayISO,
        meta: { kind: 'longest_run', valueMi: round1(yMi), previousBestMi: round1(priorMax) },
      })) written++;
    }

    // ── 4 · Easy-day discipline (daily, at most twice per episode) ──
    written += await updateEasyDisciplineLog(userId, today);

    // ── 5 · Partial-failed-at-a-known-pace fitness evidence (daily) ──
    // See lib/coach/fitness-evidence.ts · Design/execution-memory-firing.md
    // Part 1's "extremely informative" case, routed through classifyFinding
    // before it is allowed to write. One-shot per session date; the
    // (reason, field) idempotency below is the whole suppression mechanism.
    written += await updateFitnessEvidenceLog(userId, today);
  } catch (e) {
    console.warn('[coach-log] updateCoachLog failed:', e instanceof Error ? e.message : String(e));
  }
  return { written };
}

/* ─────────────── Partial-failed fitness-evidence writer ─────────────── */

/**
 * Write the fitness-evidence line for every not-yet-logged
 * PARTIAL_FAILED-at-a-known-pace session in the lookback window.
 *
 * Unlike easy-discipline this is not an open/close episode: each occurrence
 * is its own dated event, keyed by date, written at most once per date via
 * the same `writeEntry` idempotency `week_close` / `phase_boundary` /
 * `first_ever` already use. `classifyFinding` gates the write — the finder
 * only ever proposes SURFACE-worthy findings per its own module header, but
 * the classification is still run explicitly here rather than assumed, so a
 * future change to the firing test is honoured automatically.
 */
async function updateFitnessEvidenceLog(userId: string, todayISO: string): Promise<number> {
  let written = 0;
  const findings = await loadPartialFitnessEvidenceFindings(userId, todayISO);
  for (const finding of findings) {
    const level = classifyFinding({
      changed: true,
      athleteNeedsToKnow: true,
      usefulOnlyBecauseLooking: true,
      isPositive: false,
    });
    if (!atLeastAsLoud(level, 'SURFACE')) continue;

    const composed = composeFitnessEvidenceEntry(finding);
    const key = `fitness_evidence:${finding.dateISO}`;
    if (await writeEntry(userId, 'fitness_evidence', key, {
      ...composed,
      dateISO: finding.dateISO,
      meta: {
        domain: finding.domain,
        stimulusCompletion: Math.round(finding.stimulusCompletion * 100) / 100,
        establishedPaceSPerMi: Math.round(finding.establishedPaceSPerMi),
        actualPaceSPerMi: Math.round(finding.actualPaceSPerMi),
        firingLevel: level,
      },
    })) written++;
  }
  return written;
}

/* ─────────────── Easy-discipline episode state machine ─────────────── */

/**
 * Write the easy-discipline line at most twice per episode: once when the
 * pattern establishes, once when it resolves.
 *
 * 2026-08-17 firing-policy pass: the two-state machine that used to live
 * here directly (read the newest `coach_log_easy_discipline` row, derive
 * open/closed, decide open/close/nothing) is now `lib/coach/episode-log.ts`
 * — lifted so other pattern-gated detectors can reuse the same mechanism
 * instead of hand-rolling it. This function is unchanged in EFFECT: same
 * reason (`coach_log_easy_discipline`), same field naming
 * (`easy:open:<date>` / `easy:resolved:<episode>`), same (reason, field)
 * idempotency, same single-row lookback. `episode-log.test.ts` locks the
 * generalised state machine directly; `easy-discipline.test.ts` still locks
 * the pure gate and the composed words, untouched.
 */
const EASY_DISCIPLINE_EPISODE: EpisodeDetector<EasyDisciplineFinding, EasyQuietReason> = {
  reason: REASON_OF_KIND.easy_discipline,
  openPrefix: 'easy:open:',
  closePrefix: 'easy:resolved:',
  resolvedReason: 'resolved',
  composeOpen: composeEasyDisciplineEntry,
  composeClose: composeEasyDisciplineResolved,
};

async function updateEasyDisciplineLog(userId: string, todayISO: string): Promise<number> {
  const finding = await loadEasyDiscipline(userId, todayISO);
  if (!finding) return 0;
  return updateEpisode(userId, EASY_DISCIPLINE_EPISODE, finding, todayISO, easyMeta);
}

function easyMeta(f: EasyDisciplineFinding, state: string): Record<string, unknown> {
  return {
    state,
    basis: f.basis,
    read: f.read,
    qualifying: f.qualifying,
    over: f.over,
    distinctWeeks: f.distinctWeeks,
    meanPctHrMax: f.meanPctHrMax,
    ceilingBpm: f.ceilingBpm,
    targetBpm: f.targetBpm,
    caveats: f.caveats,
  };
}

/* ──────────────────── Paged reader ──────────────────── */

export interface CoachLogPage {
  entries: CoachLogEntry[];
  /** Pass as `before` to fetch the next (older) page · null = no more. */
  nextBefore: string | null;
}

/**
 * Newest-first page of the coach's log. Merges the authored
 * coach_log_* entries with plan_adapt_recompute_paces intents (every
 * silent re-pace becomes a visible fitness_shift line). Whys are
 * citation-scrubbed on the way out for rows written before the
 * write-site scrub landed.
 */
export async function loadCoachLog(
  userId: string,
  opts: { limit?: number; before?: string | null } = {},
): Promise<CoachLogPage> {
  const limit = Math.min(Math.max(opts.limit ?? 20, 1), 100);
  const params: unknown[] = [userId];
  let beforeSql = '';
  if (opts.before) {
    params.push(opts.before);
    beforeSql = `AND ts < $${params.length}::timestamptz`;
  }
  params.push(limit + 1);
  const rows = (await pool.query<{
    id: string; reason: string; field: string | null;
    value: unknown; ts: Date;
  }>(
    `SELECT id::text, reason, field, value, ts
       FROM coach_intents
      WHERE COALESCE(user_uuid, user_id) = $1
        AND (reason LIKE 'coach_log_%' OR reason = 'plan_adapt_recompute_paces')
        ${beforeSql}
      ORDER BY ts DESC
      LIMIT $${params.length}`,
    params,
  ).catch(() => ({ rows: [] as Array<{ id: string; reason: string; field: string | null; value: unknown; ts: Date }> }))).rows;

  const hasMore = rows.length > limit;
  const page = rows.slice(0, limit);
  const entries: CoachLogEntry[] = [];
  for (const r of page) {
    let v: Record<string, unknown> = {};
    try {
      v = typeof r.value === 'string' ? JSON.parse(r.value) : ((r.value ?? {}) as Record<string, unknown>);
    } catch { v = {}; }
    const ts = r.ts instanceof Date ? r.ts.toISOString() : String(r.ts);
    if (r.reason === 'plan_adapt_recompute_paces') {
      const vdot = typeof v.vdot === 'number' ? v.vdot : null;
      const rawWhy = typeof v.why === 'string' && v.why.trim() ? v.why : null;
      const body = rawWhy
        ? stripResearchCitations(rawWhy)
        : (vdot != null
          ? `New fitness read · VDOT ${vdot.toFixed(1)} · your paces just moved.`
          : 'Your paces were recalibrated to current fitness.');
      entries.push({
        id: r.id,
        kind: 'fitness_shift',
        dateISO: ts.slice(0, 10),
        title: 'FITNESS',
        body,
        meta: { vdot, workoutsUpdated: v.workouts_updated ?? null },
        ts,
      });
      continue;
    }
    const kind = (typeof v.kind === 'string' ? v.kind : r.reason.replace(/^coach_log_/, '')) as CoachLogKind;
    entries.push({
      id: r.id,
      kind: (['week_close', 'phase_boundary', 'first_ever', 'easy_discipline', 'fitness_evidence'] as string[]).includes(kind)
        ? kind : 'week_close',
      dateISO: typeof v.dateISO === 'string' ? v.dateISO : ts.slice(0, 10),
      title: typeof v.title === 'string' ? v.title : 'LOG',
      body: typeof v.body === 'string' ? stripResearchCitations(v.body) : '',
      meta: (v.meta ?? {}) as Record<string, unknown>,
      ts,
    });
  }
  return {
    entries,
    nextBefore: hasMore ? (page[page.length - 1].ts instanceof Date
      ? (page[page.length - 1].ts as Date).toISOString()
      : String(page[page.length - 1].ts)) : null,
  };
}
