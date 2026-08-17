/**
 * lib/coach/morning-brief.ts · the composed morning brief.
 *
 * 2026-08-17 · coach-experience pass. The morning already had all the
 * instruments — recap verdict, run purpose, readiness synthesis, gap —
 * but on separate surfaces; no single composed paragraph read like a
 * coach talking. This module assembles ONE deterministic 2-3 sentence
 * paragraph from pieces that already exist:
 *
 *   sentence 1 · yesterday acknowledged — the acknowledge-loop sentence
 *     (lib/coach/acknowledge.ts) when the runner told us how it felt,
 *     else a neutral recap line. Skipped entirely when there was no run
 *     and no check-in.
 *   sentence 2 · today's purpose + readiness band. Respects the
 *     no-reactive-coach rule: the plan stands, the score informs — this
 *     sentence NEVER re-prescribes.
 *   sentence 3 · season context, ONLY when it changed: race ≤ 7 days,
 *     a phase boundary, or a fresh coach-log milestone (biggest week,
 *     all-time first, fitness shift). Most mornings have no sentence 3
 *     — that is what makes the mornings that do land.
 *
 * Composition is server-side; the paragraph rides additively on the
 * web seed (FaffSeed.morningBrief) and the legacy /api/briefing today
 * envelope (morning_brief) so native can adopt it without a wire break.
 *
 * Voice: coach voice · short · no hype · no exclamation marks · " · "
 * joiner · no citations in payloads.
 */

import { pool } from '@/lib/db/pool';
import { runnerToday } from '@/lib/runtime/runner-tz';
import {
  loadYesterdaySignals,
  acknowledgeSentenceFor,
  categorizeWorkoutType,
  type YesterdaySignals,
} from './acknowledge';
import { stripResearchCitations } from '@/lib/plan/strip-citations';

/* ────────────────────────── Types ────────────────────────── */

export type MorningBriefBand = 'sharp' | 'ready' | 'moderate' | 'pull-back' | 'no-data';

export interface MorningBriefInput {
  todayISO: string;
  /** Today's planned workout · null/'' when nothing is planned. */
  todayType: string | null;
  todayMi: number;
  todayLabel: string | null;
  readinessScore: number | null;
  readinessBand: MorningBriefBand | null;
  /** From lib/coach/acknowledge.ts · null when no subjective signal. */
  acknowledgeSentence: string | null;
  /** Yesterday's run for the neutral recap fallback · null = no run. */
  yesterday: { ranMi: number; type: string | null } | null;
  raceName: string | null;
  daysToRace: number | null;
  /** Freshest coach-log milestone within the last 36h · null = none. */
  milestone: { kind: string; body: string } | null;
}

export interface MorningBrief {
  /** The full paragraph, sentences joined with single spaces. */
  paragraph: string;
  sentences: {
    recap: string | null;
    today: string;
    season: string | null;
  };
  composedFor: string; // todayISO
}

/* ──────────────────── Pure composer ──────────────────── */

function typeWord(type: string | null): string {
  const t = (type ?? '').toLowerCase();
  if (t === 'long') return 'long run';
  if (t === 'easy') return 'easy run';
  if (t === 'recovery' || t === 'shakeout') return 'recovery run';
  if (t === 'tempo') return 'tempo';
  if (t === 'threshold') return 'threshold session';
  if (t === 'intervals' || t === 'vo2max') return 'intervals';
  if (t === 'progression') return 'progression run';
  if (t === 'fartlek') return 'fartlek';
  return 'run';
}

function bandPhrase(band: MorningBriefBand | null, score: number | null): string | null {
  if (band == null || band === 'no-data' || score == null) return null;
  // Plan stands · score informs. No re-prescription in any branch.
  if (band === 'sharp') return `readiness ${score} · the system is firing`;
  if (band === 'ready') return `readiness ${score} · solid`;
  if (band === 'moderate') return `readiness ${score} · keep the easy parts genuinely easy`;
  return `readiness ${score} · low, so listen on the way · the plan stands`;
}

function fmtMi(mi: number): string {
  return (Math.round(mi * 10) / 10).toString();
}

/** Sentence 2 · today's purpose + readiness. Always present. */
function composeTodaySentence(i: MorningBriefInput): string {
  const t = (i.todayType ?? '').toLowerCase();
  const band = bandPhrase(i.readinessBand, i.readinessScore);
  if (t === 'race' || t.startsWith('race_a') || t.startsWith('race_b') || t.startsWith('race_c')) {
    return 'Race day · everything you need is already banked.';
  }
  if (t === 'race_week_tuneup') {
    const miPart = i.todayMi > 0 ? ` · ${fmtMi(i.todayMi)} mi` : '';
    return `Tune-up today${miPart} · sharp, not heroic.`;
  }
  if (t === 'rest' || t === '' || t === 'unplanned') {
    // No readiness tail on a no-run day · "keep the easy parts easy"
    // reads wrong when there is nothing to run. The score lives on the
    // readiness ring; the rest line stands alone.
    return t === 'rest' ? 'Rest day today · recovery is the work.' : 'Nothing on the plan today.';
  }
  const hasLabel = !!(i.todayLabel && i.todayLabel.trim() && i.todayLabel.length <= 28);
  const name = hasLabel ? i.todayLabel!.trim().toLowerCase() : typeWord(t);
  // Authored sub_labels ("cruise intervals") read wrong with an article;
  // generic type words ("easy run") need one.
  const article = hasLabel ? '' : (/^[aeiou]/.test(name) ? 'an ' : 'a ');
  const miPart = i.todayMi > 0 ? ` · ${fmtMi(i.todayMi)} mi` : '';
  const core = `Today is ${article}${name}${miPart}`;
  return band ? `${core} · ${band}.` : `${core}.`;
}

/** Sentence 1 · acknowledge or neutral recap · null when nothing happened. */
function composeRecapSentence(i: MorningBriefInput): string | null {
  if (i.acknowledgeSentence) return i.acknowledgeSentence;
  if (i.yesterday && i.yesterday.ranMi > 0.3) {
    const cat = categorizeWorkoutType(i.yesterday.type);
    const word = cat === 'quality' ? typeWord(i.yesterday.type)
      : cat === 'long' ? 'long run'
      : cat === 'easy' ? 'easy run'
      : (i.yesterday.type ?? '').toLowerCase().startsWith('race') ? 'race'
      : 'run';
    return `${fmtMi(i.yesterday.ranMi)} mi ${word} went in the book yesterday.`;
  }
  return null;
}

/** Sentence 3 · season context · null on an ordinary morning. */
function composeSeasonSentence(i: MorningBriefInput): string | null {
  const t = (i.todayType ?? '').toLowerCase();
  const isRaceDay = t === 'race' || t.startsWith('race_a') || t.startsWith('race_b') || t.startsWith('race_c');
  if (!isRaceDay && i.raceName && i.daysToRace != null && i.daysToRace >= 0 && i.daysToRace <= 7) {
    if (i.daysToRace === 0) return `${i.raceName} is today.`;
    if (i.daysToRace === 1) return `${i.raceName} is tomorrow · nothing left to build, just arrive fresh.`;
    return `${i.raceName} is ${i.daysToRace} days out · the work is done, the job now is arriving fresh.`;
  }
  if (i.milestone && i.milestone.body.trim()) {
    return stripResearchCitations(i.milestone.body.trim());
  }
  return null;
}

/**
 * The deterministic composer. Pure — locked by morning-brief.test.ts.
 */
export function composeMorningBrief(i: MorningBriefInput): MorningBrief {
  const recap = composeRecapSentence(i);
  const today = composeTodaySentence(i);
  const season = composeSeasonSentence(i);
  const paragraph = [recap, today, season].filter((s): s is string => !!s).join(' ');
  return {
    paragraph,
    sentences: { recap, today, season },
    composedFor: i.todayISO,
  };
}

/* ──────────────────── DB shell ──────────────────── */

/** Milestone-worthy coach-log kinds for sentence 3. A plain week close
 *  is history, not news — only the flagged ones speak. */
function milestoneWorthy(kind: string, meta: Record<string, unknown>): boolean {
  if (kind === 'phase_boundary' || kind === 'first_ever' || kind === 'fitness_shift') return true;
  if (kind === 'week_close') return meta?.isBiggestOfBlock === true || meta?.isBiggestEver === true;
  return false;
}

async function loadFreshMilestone(userId: string): Promise<{ kind: string; body: string } | null> {
  try {
    const { loadCoachLog } = await import('./coach-log');
    const page = await loadCoachLog(userId, { limit: 6 });
    const cutoff = Date.now() - 36 * 3600 * 1000;
    for (const e of page.entries) {
      if (Date.parse(e.ts) < cutoff) continue;
      if (milestoneWorthy(e.kind, e.meta)) return { kind: e.kind, body: e.body };
    }
  } catch { /* best-effort */ }
  return null;
}

export interface MorningBriefGlanceLike {
  today: string;
  weekDays: Array<{
    date: string; isToday: boolean;
    plannedType: string; plannedMi: number; plannedLabel: string | null;
  }>;
  readiness: { score: number | null; band: string };
  daysToARace: number | null;
  nextARaceName: string | null;
}

/**
 * Load + compose the morning brief for a runner. When the caller
 * already holds a GlanceState (seed.ts, /api/briefing), pass it to
 * skip the re-query. Best-effort: any failure returns null and the
 * surface renders without the paragraph.
 */
export async function loadMorningBrief(
  userId: string,
  glance?: MorningBriefGlanceLike | null,
): Promise<MorningBrief | null> {
  try {
    const today = glance?.today ?? await runnerToday(userId);

    // Today's planned workout.
    let todayType: string | null = null;
    let todayMi = 0;
    let todayLabel: string | null = null;
    if (glance) {
      const row = glance.weekDays.find((d) => d.isToday);
      todayType = row?.plannedType ?? null;
      todayMi = row?.plannedMi ?? 0;
      todayLabel = row?.plannedLabel ?? null;
    } else {
      const row = (await pool.query<{ type: string; distance_mi: string | null; sub_label: string | null }>(
        `SELECT pw.type, pw.distance_mi::text, pw.sub_label
           FROM plan_workouts pw
           JOIN training_plans tp ON tp.id = pw.plan_id
          WHERE tp.user_uuid = $1 AND tp.archived_iso IS NULL
            AND pw.date_iso = $2 AND pw.type <> 'strength'
          LIMIT 1`,
        [userId, today],
      ).catch(() => ({ rows: [] as Array<{ type: string; distance_mi: string | null; sub_label: string | null }> }))).rows[0];
      todayType = row?.type ?? null;
      todayMi = row?.distance_mi != null ? Number(row.distance_mi) : 0;
      todayLabel = row?.sub_label ?? null;
    }

    const signals: YesterdaySignals = await loadYesterdaySignals(userId, today);
    const acknowledge = acknowledgeSentenceFor(signals, todayType);
    const milestone = await loadFreshMilestone(userId);

    const band = (glance?.readiness.band ?? null) as MorningBriefBand | null;
    return composeMorningBrief({
      todayISO: today,
      todayType,
      todayMi,
      todayLabel,
      readinessScore: glance?.readiness.score ?? null,
      readinessBand: band,
      acknowledgeSentence: acknowledge,
      yesterday: signals.ranMi > 0.3
        ? { ranMi: signals.ranMi, type: signals.plannedType }
        : null,
      raceName: glance?.nextARaceName ?? null,
      daysToRace: glance?.daysToARace ?? null,
      milestone,
    });
  } catch (e) {
    console.warn('[morning-brief] compose failed:', e instanceof Error ? e.message : String(e));
    return null;
  }
}
