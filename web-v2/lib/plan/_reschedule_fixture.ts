/**
 * lib/plan/_reschedule_fixture.ts · THE LIVE CASE, READ OFF PRODUCTION.
 *
 * These rows are not invented. They were read from the production database
 * read-only on 2026-09-02 for user `0645f40c-…`, active plan
 * `pln_9a57561debb776e5` (CIM, goal 2026-12-06), and transcribed verbatim:
 * types, distances, quality and long flags, week ids, cutback flags, and the
 * two specs that matter (the 15-mile long run's fuelling ladder, and the tempo
 * that sits on the Tuesday after it).
 *
 * They are here because CLAUDE.md Rule 13's companion point applies to engine
 * work as well as to display: a fixture invented to suit the code under test
 * proves the code agrees with itself. The single most important fact in this
 * fixture would never have been invented — `wk_ad7ea126c58167e7`, the week that
 * ENDS on the Santa Monica 10k, carries **`is_race_week = false`** in
 * production while carrying `is_cutback = true`. Q34's "protect the PURPOSE,
 * not the label" is written for exactly that row, and a hand-made fixture would
 * have set the flag the tidy way and hidden the case.
 *
 * The ids are shortened for legibility. Nothing else is changed.
 */

export const USER_UUID = '0645f40c-951d-4ccc-b86e-9979cd26c795';
export const PLAN_ID = 'pln_9a57561debb776e5';
export const TODAY = '2026-09-02';

export interface FixtureWeek {
  id: string; week_idx: number; week_start_iso: string;
  phase: string | null; is_race_week: boolean; is_cutback: boolean;
}

export interface FixtureDay {
  id: string; week_id: string; date_iso: string; dow: number; type: string;
  distance_mi: string; is_quality: boolean; is_long: boolean;
  sub_label: string | null; pace_target_s_per_mi: number | null;
  workout_spec: Record<string, unknown> | null;
  original_date_iso?: string;
}

export const WEEKS: FixtureWeek[] = [
  { id: 'wk1', week_idx: 1, week_start_iso: '2026-08-31', phase: 'QUALITY', is_race_week: false, is_cutback: false },
  // is_race_week FALSE, in production, on the week that ends on the 10k.
  { id: 'wk2', week_idx: 2, week_start_iso: '2026-09-07', phase: 'QUALITY', is_race_week: false, is_cutback: true },
  { id: 'wk3', week_idx: 3, week_start_iso: '2026-09-14', phase: 'QUALITY', is_race_week: false, is_cutback: false },
  { id: 'wk4', week_idx: 4, week_start_iso: '2026-09-21', phase: 'QUALITY', is_race_week: false, is_cutback: false },
];

const d = (
  id: string, week_id: string, date_iso: string, dow: number, type: string,
  distance_mi: number, is_quality: boolean, is_long: boolean,
  sub_label: string | null, workout_spec: Record<string, unknown> | null = null,
): FixtureDay => ({
  id, week_id, date_iso, dow, type, distance_mi: String(distance_mi),
  is_quality, is_long, sub_label, pace_target_s_per_mi: null, workout_spec,
});

/** The 15-mile long run's real spec. The fuelling ladder is what makes it
 *  marathon-specific, and therefore what makes Q35 refuse to split it. */
export const LONG_0906_SPEC = {
  kind: 'long',
  fuel_mi: [5, 9, 13],
  hr_cap_bpm: 151,
  pace_target_s_per_mi_hi: 537,
  pace_target_s_per_mi_lo: 502,
};

const TEMPO_0908_SPEC = {
  kind: 'tempo',
  warmup_mi: 2.1,
  cooldown_mi: 2.1,
  hr_target_bpm: 155,
  tempo_distance_mi: 2,
  tempo_pace_s_per_mi: 430,
};

export const DAYS: FixtureDay[] = [
  // ── week 1 · 2026-08-31 → 09-06 · 45.0 mi ────────────────────────────────
  d('pw0831', 'wk1', '2026-08-31', 1, 'easy', 4.5, false, false, 'EASY · 6×20s strides', { kind: 'easy' }),
  d('pw0901', 'wk1', '2026-09-01', 2, 'threshold', 8.5, true, false, '4×1 mi @ T pace', { kind: 'threshold' }),
  d('pw0902', 'wk1', '2026-09-02', 3, 'easy', 5.0, false, false, 'EASY · 6×20s strides', { kind: 'easy' }),
  d('pw0903', 'wk1', '2026-09-03', 4, 'intervals', 6.5, true, false, '10×60s hills @ I', { kind: 'intervals' }),
  d('pw0904', 'wk1', '2026-09-04', 5, 'easy', 5.5, false, false, 'EASY', { kind: 'easy' }),
  d('pw0905', 'wk1', '2026-09-05', 6, 'rest', 0, false, false, 'REST', null),
  d('pw0906', 'wk1', '2026-09-06', 0, 'long', 15.0, false, true, 'LONG', LONG_0906_SPEC),

  // ── week 2 · 2026-09-07 → 09-13 · CUTBACK, and it ends on the B 10k ──────
  d('pw0907', 'wk2', '2026-09-07', 1, 'easy', 4.5, false, false, 'EASY · 6×20s strides', { kind: 'easy' }),
  d('pw0908', 'wk2', '2026-09-08', 2, 'tempo', 6.2, true, false, '2.1 mi WU · 2 mi T · 2.1 mi CD', TEMPO_0908_SPEC),
  d('pw0909', 'wk2', '2026-09-09', 3, 'easy', 5.0, false, false, 'EASY · 6×20s strides', { kind: 'easy' }),
  d('pw0910', 'wk2', '2026-09-10', 4, 'easy', 5.0, false, false, 'EASY', { kind: 'easy' }),
  d('pw0911', 'wk2', '2026-09-11', 5, 'shakeout', 2.0, false, false, 'SHAKEOUT · 4×20s', { kind: 'easy' }),
  d('pw0912', 'wk2', '2026-09-12', 6, 'rest', 0, false, false, 'REST', null),
  d('pw0913', 'wk2', '2026-09-13', 0, 'race', 6.2, true, true, 'RACE', { kind: 'easy' }),

  // ── week 3 · 2026-09-14 → 09-20 ──────────────────────────────────────────
  d('pw0914', 'wk3', '2026-09-14', 1, 'rest', 0, false, false, 'REST', null),
  d('pw0915', 'wk3', '2026-09-15', 2, 'easy', 5.0, false, false, 'EASY', { kind: 'easy' }),
  d('pw0916', 'wk3', '2026-09-16', 3, 'easy', 5.0, false, false, 'EASY · 6×20s strides', { kind: 'easy' }),
  d('pw0917', 'wk3', '2026-09-17', 4, 'intervals', 7.0, true, false, '7×3 min hills', { kind: 'intervals' }),
  d('pw0918', 'wk3', '2026-09-18', 5, 'easy', 5.0, false, false, 'EASY · 6×20s strides', { kind: 'easy' }),
  d('pw0919', 'wk3', '2026-09-19', 6, 'rest', 0, false, false, 'REST', null),
  d('pw0920', 'wk3', '2026-09-20', 0, 'long', 12.0, false, true, 'LONG', { kind: 'long', fuel_mi: [5, 9] }),

  // ── week 4 · 2026-09-21 → 09-27 · the authored Dodgers race weekend ──────
  d('pw0921', 'wk4', '2026-09-21', 1, 'easy', 4.5, false, false, 'EASY · 6×20s strides', { kind: 'easy' }),
  d('pw0922', 'wk4', '2026-09-22', 2, 'tempo', 9.0, true, false, '2.5 mi WU · 4 mi T', { kind: 'tempo' }),
  d('pw0923', 'wk4', '2026-09-23', 3, 'easy', 6.5, false, false, 'EASY · 6×20s strides', { kind: 'easy' }),
  d('pw0924', 'wk4', '2026-09-24', 4, 'rest', 0, false, false, 'REST', null),
  d('pw0925', 'wk4', '2026-09-25', 5, 'easy', 7.0, false, false, 'EASY', { kind: 'easy' }),
  d('pw0926', 'wk4', '2026-09-26', 6, 'race', 6.21, true, false, 'RACE', { kind: 'easy' }),
  d('pw0927', 'wk4', '2026-09-27', 0, 'long', 15.5, false, true, 'LONG', { kind: 'long', fuel_mi: [5, 9, 13] }),
];

export interface FixtureRace {
  slug: string; name: string | null; date_iso: string | null;
  priority: string | null; distance_mi: string | null;
}

/** As `races.meta` holds them in production. */
export const RACES: FixtureRace[] = [
  { slug: 'santa-monica-10k-2026-09-13', name: 'Santa Monica 10k', date_iso: '2026-09-13', priority: 'B', distance_mi: '6.2' },
  { slug: 'dodgers', name: 'Dodgers', date_iso: '2026-09-26', priority: 'C', distance_mi: '6.21' },
  { slug: 'run-malibu', name: 'Run Malibu', date_iso: '2026-11-08', priority: 'B', distance_mi: '13.1' },
  { slug: 'cim', name: 'California International Marathon', date_iso: '2026-12-06', priority: 'A', distance_mi: '26.22' },
];

export interface QueryRecord { sql: string; params: unknown[] }

/**
 * A read-only client that answers exactly the three `loadPlanShape` queries and
 * the one race-calendar query, and RECORDS every statement it is asked to run.
 *
 * The recording is the point: `_reschedule_contract.test.ts` asserts that a
 * recommendation issues nothing but SELECTs. That is the enforceable form of
 * "nothing writes until he approves" — stronger than reading the code and
 * believing it, which is how the claim would otherwise be made.
 */
export function makeReadClient(opts: {
  log: QueryRecord[];
  days?: FixtureDay[];
  weeks?: FixtureWeek[];
  races?: FixtureRace[];
}) {
  const days = opts.days ?? DAYS;
  const weeks = opts.weeks ?? WEEKS;
  const races = opts.races ?? RACES;
  return {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    query: async (sql: any, params: any = []): Promise<{ rows: unknown[]; rowCount: number }> => {
      const text = typeof sql === 'string' ? sql : String(sql?.text ?? '');
      opts.log.push({ sql: text, params });
      const rows = (() => {
        if (/FROM training_plans/i.test(text)) {
          return [{ id: PLAN_ID, mode: 'race-prep', race_id: 'cim', goal_iso: '2026-12-06' }];
        }
        if (/FROM plan_weeks/i.test(text)) return weeks;
        if (/FROM plan_workouts/i.test(text)) return days;
        if (/FROM races/i.test(text)) return races;
        return [];
      })();
      return { rows, rowCount: rows.length };
    },
  };
}
