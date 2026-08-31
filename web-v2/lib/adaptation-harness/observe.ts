/**
 * lib/adaptation-harness/observe.ts · what the RUNNER sees.
 *
 * CLAUDE.md's standard for this harness is that it asserts the observable and
 * not the internal: "the prescription the runner sees on day N changed from X
 * to Y, and the app told him why" — never "the function returned a verdict
 * object". A verdict object that never reaches a screen is the exact failure
 * mode Rule 21 was locked over.
 *
 * So every assertion in `worlds.harness.test.ts` reads through here, and here
 * reads through the app's OWN composer — `loadAdaptationInfoByPlanIds` in
 * `lib/coach/adaptation-info.ts`, the same call `training-state.ts`,
 * `glance-state.ts` and `lib/watch/build-workout.ts` make. Nothing in this file
 * re-derives what the surface would show; it asks the surface's own reader and
 * then renders the sentence the way `components/faff-app/overlays/
 * WorkoutDetail.tsx` renders it.
 *
 * The one thing this file DOES duplicate is that final sentence, because it
 * lives in a React component that cannot be imported into a node test. The
 * duplication is deliberate and narrow — verb table and was-label, seven lines
 * — and `adaptationVerbTableMatchesComponent` below is the check that keeps the
 * copy honest by reading the component's own source at run time. Rule 18: a
 * mirror nothing verifies is prose.
 */

import fs from 'node:fs';
import path from 'node:path';
import { assertHarnessDatabase } from './fence';

assertHarnessDatabase();

import type { AdaptationInfo } from '@/lib/coach/adaptation-info';

/** The prescription a runner reads on one day, plus how it was explained. */
export interface SeenDay {
  workoutId: string;
  dateISO: string;
  /** "8 mi · CRUISE INTERVALS @ T" — the chip, near enough. */
  prescription: string;
  type: string;
  distanceMi: number | null;
  subLabel: string | null;
  paceTargetSPerMi: number | null;
  /** Null when the app would show no adaptation banner at all. */
  told: string | null;
  info: AdaptationInfo | null;
}

/**
 * `components/faff-app/overlays/WorkoutDetail.tsx`'s own verb table. Kept in
 * step by `adaptationVerbTableMatchesComponent`.
 */
const KIND_COPY: Record<string, string> = {
  downgrade: 'Downgraded',
  reschedule: 'Rescheduled',
  shave: 'Shortened',
  mark_dirty: 'Paces refreshed',
  other: 'Adjusted',
};

/**
 * Rule 18 · the mirror above is checked against the component it mirrors, at
 * run time, by reading the component's source. A stale copy fails loudly
 * instead of quietly asserting against a screen that no longer exists.
 *
 * It also reports what the component has NO entry for, which is how the
 * harness noticed that `reshape` — the progression gate's own kind, and the
 * only kind that can say "the plan asked for more" — falls through to
 * "Adjusted".
 */
export function adaptationVerbTableMatchesComponent(repoRoot: string): {
  ok: boolean; detail: string; componentKinds: string[];
} {
  const file = path.join(repoRoot, 'components/faff-app/overlays/WorkoutDetail.tsx');
  let src: string;
  try {
    src = fs.readFileSync(file, 'utf8');
  } catch {
    return { ok: false, detail: `cannot read ${file} — the mirror cannot be verified, so it must not be trusted`, componentKinds: [] };
  }
  const block = src.match(/const kindCopy: Record<string, string> = \{([\s\S]*?)\}/);
  if (!block) {
    return { ok: false, detail: 'WorkoutDetail.tsx no longer declares a kindCopy table — this mirror is stale', componentKinds: [] };
  }
  const componentKinds = [...block[1].matchAll(/(\w+)\s*:/g)].map((m) => m[1]);
  const mine = Object.keys(KIND_COPY);
  const missing = componentKinds.filter((k) => !mine.includes(k));
  const extra = mine.filter((k) => !componentKinds.includes(k));
  const ok = missing.length === 0 && extra.length === 0;
  return {
    ok,
    detail: ok ? 'verb table matches the component' : `drifted · component-only [${missing}] harness-only [${extra}]`,
    componentKinds,
  };
}

/** Render the banner sentence the way the overlay renders it. */
export function tellSentence(info: AdaptationInfo | null): string | null {
  if (!info || !info.wasAdapted) return null;
  const verb = KIND_COPY[info.kind ?? 'other'] ?? 'Adjusted';
  const was = info.originalSubLabel || info.originalType;
  const head = was ? `${verb} · was ${was}` : verb;
  return info.reason ? `${head} — ${info.reason}` : head;
}

/**
 * Read a window of the plan exactly as a surface would: the rows, joined to the
 * app's own adaptation composer.
 */
export async function seeWeek(
  planId: string, fromISO: string, toISO: string,
): Promise<SeenDay[]> {
  const { pool } = await import('@/lib/db/pool');
  const { loadAdaptationInfoByPlanIds } = await import('@/lib/coach/adaptation-info');
  const infoById = await loadAdaptationInfoByPlanIds([planId]);

  const { rows } = await pool.query<{
    id: string; date_iso: string; type: string; distance_mi: string | null;
    sub_label: string | null; pace_target_s_per_mi: string | null;
  }>(
    `SELECT pw.id::text AS id, pw.date_iso::text AS date_iso, pw.type,
            pw.distance_mi::text AS distance_mi, pw.sub_label,
            pw.pace_target_s_per_mi::text AS pace_target_s_per_mi
       FROM plan_workouts pw
      WHERE pw.plan_id = $1 AND pw.date_iso >= $2 AND pw.date_iso <= $3
      ORDER BY pw.date_iso`,
    [planId, fromISO, toISO],
  );

  return rows.map((r) => {
    const info = infoById.get(r.id) ?? null;
    const mi = r.distance_mi != null ? Number(r.distance_mi) : null;
    const pace = r.pace_target_s_per_mi != null ? Number(r.pace_target_s_per_mi) : null;
    return {
      workoutId: r.id,
      dateISO: r.date_iso,
      type: r.type,
      distanceMi: mi,
      subLabel: r.sub_label,
      paceTargetSPerMi: pace,
      prescription: `${mi ?? '–'} mi · ${r.sub_label ?? r.type}${pace ? ` @ ${paceStr(pace)}` : ''}`,
      told: tellSentence(info),
      info,
    };
  });
}

function paceStr(sPerMi: number): string {
  const m = Math.floor(sPerMi / 60);
  const s = Math.round(sPerMi % 60);
  return `${m}:${String(s).padStart(2, '0')}/mi`;
}

/** Total prescribed miles across a window — the volume axis, as prescribed. */
export function totalMi(days: SeenDay[]): number {
  return Number(days.reduce((a, d) => a + (d.distanceMi ?? 0), 0).toFixed(2));
}

/** A stable fingerprint of what the runner would read, for byte-stability checks. */
export function fingerprint(days: SeenDay[]): string {
  return days.map((d) => `${d.dateISO}|${d.type}|${d.distanceMi}|${d.subLabel}|${d.paceTargetSPerMi}`).join('\n');
}
