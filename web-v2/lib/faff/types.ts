/**
 * Shared type definitions · consumed by web + iOS clients.
 *
 * These mirror `apps/server/lib/resolver/types.ts` and `lib/coach/types.ts`.
 * A future build step can codegen this from the server side to ensure they
 * stay in sync.
 *
 * Cardinal Rule #4: SINGLE source of truth. The runtime types live with
 * the server (where they're authored); this file exists so clients can
 * import them without depending on `apps/server/` for type definitions.
 *
 * Frontend agents (web + iOS):
 *   - TypeScript: import from `@faff/shared` (configure path alias).
 *   - Swift: a parallel `Faff/SharedTypes.swift` file will be generated
 *     from this manifest as part of the iOS build step. Until codegen is
 *     wired, hand-mirror the types here in Swift.
 */

// ──────────────────────────────────────────────────────────────────────
// Primitives
// ──────────────────────────────────────────────────────────────────────

export type ISODate = string;          // 'YYYY-MM-DD'
export type ISOTimestamp = string;     // 'YYYY-MM-DDTHH:MM:SSZ'
export type ISOTime = string;          // 'HH:MM' (local)
export type UUID = string;

// ──────────────────────────────────────────────────────────────────────
// Enums
// ──────────────────────────────────────────────────────────────────────

export type WorkoutType =
  | 'easy' | 'long' | 'quality' | 'rest' | 'race'
  | 'recovery' | 'shakeout' | 'cross' | 'strength';

export type WorkoutSubLabel =
  | 'recovery' | 'shakeout'
  | 'intervals' | 'tempo' | 'threshold' | 'fartlek' | 'progression'
  | 'race_pace' | 'strides'
  | 'with_mp' | 'with_hills' | 'race_simulation';

export type DayState =
  | 'easy' | 'quality' | 'long' | 'rest'
  | 'done_nailed' | 'done_ease_off'
  | 'niggle' | 'sick' | 'missed' | 'race_week' | 'new_user';

export type Surface = 'today' | 'plan' | 'races' | 'race_detail' | 'health' | 'me';

export type HRZone = 'z1' | 'z2' | 'z3' | 'z4' | 'z5';

export type AcwrBand = 'detrain' | 'sweet_spot' | 'build' | 'spike';

export type RacePriority = 'A' | 'B' | 'C' | 'training_run' | 'hilly_excluded';

export type NiggleSeverity = 'mild' | 'moderate' | 'flare' | 'injury';
export type NiggleSide = 'left' | 'right' | 'both';

export type ValueColor = 'default' | 'amber' | 'green' | 'over' | 'race' | 'dist';
export type DotColor = 'green' | 'amber' | 'over' | 'dist' | 'none';

// ──────────────────────────────────────────────────────────────────────
// Component-ready payloads (resolver output)
// ──────────────────────────────────────────────────────────────────────

export interface MiniTile {
  label: string;
  value: string;
  valueUnit?: string;
  valueColor?: ValueColor;
  meta: string;
  metaStrong?: string;
  dot: DotColor;
  action?: { kind: 'tap'; target: string };
  learnArticleSlug?: string;
}

/**
 * Setup step tile · used by the `new_user` Sibling.
 *
 * v1 setup is ≤ 3 steps (2 required + 1 optional). Design owns the exact
 * step list in `design/resolver/states.md` §11 "Onboarding scope
 * (2026-05-28 — simplified)" + `design/components/Sibling.md` (new-user row).
 *
 * No `lthr_*` step: LTHR auto-derives per Path A
 * (`research/notes/lthr-auto-derivation.md` — tier 3 `HRmax × 0.92` seeds a
 * usable value the moment HRmax exists; tier 4 `Tanaka × 0.90 + sex adj.`
 * fires when only birthday + sex exist; algorithm refines from the first
 * qualifying run forward). NEVER ask the runner for a manual LTHR during
 * onboarding (locked 2026-05-28 · PROJECT.md).
 *
 * Tile 4 in the new-user sibling is an informational "what's next" status
 * tile, NOT a step — it's a plain `MiniTile`, not a `SetupStepTile`. The
 * sibling's `tiles` array is therefore typed `(SetupStepTile | MiniTile)[]`
 * so clients can discriminate via `'stepIndex' in tile`.
 */
export interface SetupStepTile extends MiniTile {
  stepIndex: number; // 1-indexed · backend doesn't constrain step count · design composes
  isCompleted: boolean;
  isActive: boolean;
}

export interface Stat {
  value: string;
  label: string;
  valueColor?: ValueColor;
}

export interface PosterPayload {
  state: DayState;
  gradient_token: string;
  eyebrow: string;
  verb: string;
  verb_suffix: string | null;
  prose: string | null;
  phase_tag: string | null;
  stat_trio: Stat[] | null;
  hero_number: { value: string; unit: string | null; duration: string | null } | null;
  choice_row: {
    left: { label: string; sub: string; action: 'catch_up' };
    right: { label: string; sub: string; action: 'move_on' };
    recommended: 'catch_up' | 'move_on';
  } | null;
  days_countdown: { days: number; dateLabel: string } | null;
}

/**
 * Sibling title is a two-piece structured value, NOT a string. The `main`
 * is rendered with the display recipe (Inter 900 · -0.06em tracking · 0.82
 * line-height) at 24px — the state label; the optional `suffix` is rendered
 * Inter 700wt 9px UPPERCASE caps-tracked (the modifier reading). Backend
 * emits both pieces separately so clients render the typography without
 * parsing string delimiters.
 *
 * Per-state main/suffix values are tabled in `design/components/Sibling.md`
 * (§State table) — single source of truth.
 *
 * `suffix` is optional in the type: in v1 every state ships with one
 * specified, but future content variants may render with `main` only.
 * A suffix without a `main` is not valid.
 */
export interface SiblingTitle {
  main: string;
  suffix?: string;
}

export type SiblingPayload =
  | { state: 'easy'; title: SiblingTitle; tiles: MiniTile[]; prose?: string }
  | { state: 'quality'; title: SiblingTitle; tiles: MiniTile[]; prose?: string }
  | { state: 'long'; title: SiblingTitle; tiles: MiniTile[]; prose?: string }
  | { state: 'rest'; title: SiblingTitle; tiles: MiniTile[] }
  | { state: 'done_nailed'; title: SiblingTitle; tiles: MiniTile[]; prose?: string }
  | { state: 'done_ease_off'; title: SiblingTitle; tiles: MiniTile[]; prose: string; action_tile_index: number }
  | { state: 'niggle'; title: SiblingTitle; tiles: MiniTile[]; prose: string; bail_trigger: string }
  | { state: 'sick'; title: SiblingTitle; tiles: MiniTile[]; prose: string; return_condition: string }
  | { state: 'missed'; title: SiblingTitle; tiles: MiniTile[]; prose: string; recommendation: 'catch_up' | 'move_on' }
  | { state: 'race_week'; title: SiblingTitle; tiles: MiniTile[]; prose: string }
  | { state: 'new_user'; title: SiblingTitle; tiles: Array<SetupStepTile | MiniTile>; prose: string; completion_pct: number };

export interface WeekStripPayload {
  weekStart: ISODate;
  days: Array<{
    date: ISODate;
    dow: 0 | 1 | 2 | 3 | 4 | 5 | 6;
    plannedType: WorkoutType | null;
    plannedDistance: number | null;
    /**
     * Bottom-line caps label rendered under the mileage on each day card.
     * Drawn from a closed, strictly 4-char vocabulary specced in
     * `design/components/WeekStrip.md` §"Type label vocabulary" (locked
     * 2026-05-28 after TypeSetter Sprint 02 audit · finding 27 — the prior
     * 8-char rule broke the Phone SE never-truncate guarantee):
     *   EASY · INTS · TMPO · THRS · FART · QUAL · LONG · REST · XTRN · RACE · —
     * Backend derives this on the resolver (workout type + subtype → label)
     * and emits it directly; clients never compute it. Plural vs singular
     * decided per-label (e.g. INTS plural, LONG/TMPO singular) — the 4-char
     * ceiling is the binding constraint, not grammatical number.
     */
    plannedTypeLabel: string;
    /**
     * @deprecated Replaced 2026-05-28 by the two-line card pattern
     * (`plannedDistance` on top + `plannedTypeLabel` underneath). Backend
     * still emits a value for any server consumer still reading it; new
     * client code MUST render `plannedTypeLabel`, not this freeform label.
     * Will be removed once `apps/server/lib/resolver/week.ts` stops emitting.
     */
    plannedLabel: string | null;
    completedRunId: UUID | null;
    isToday: boolean;
    isFuture: boolean;
  }>;
  totals: { plannedMi: number; completedMi: number };
}

export interface ResolverOutput {
  state: DayState;
  niggle_modifier: boolean;
  poster: PosterPayload;
  sibling: SiblingPayload;
  week: WeekStripPayload;
  context: {
    resolved_at: ISOTimestamp;
    today_iso: ISODate;
    runner_id: UUID;
    plan_phase: string;
    plan_week_index: number;
    plan_week_count: number;
  };
}

// ──────────────────────────────────────────────────────────────────────
// Coaching engine output (briefing)
// ──────────────────────────────────────────────────────────────────────

export interface BriefingResponse {
  surface: Surface;
  mode: string;
  lead: string;
  voice: string[];
  proposed_alternative?: ProposedAlternative;
  meta: {
    runner_id: UUID;
    today: ISODate;
    state: DayState;
    promptVersion: 'deterministic-v1';
    generated_at: ISOTimestamp;
  };
}

export interface ProposedAlternative {
  alt_type: WorkoutType;
  alt_distance_mi: number;
  alt_label: string;
  reason: string;
}

// ──────────────────────────────────────────────────────────────────────
// Run detail shapes (mirrored from RunDetail in api-contracts.md §C)
// ──────────────────────────────────────────────────────────────────────

/**
 * Per-mile split. Mirrored from `RunDetail.splits` in `api-contracts.md` §C.
 * Consumed by the mile-splits chart per `design/charts/specs/mile-splits.md`.
 */
export interface RunSplit {
  mile: number;                  // 1-indexed
  pace_s_per_mi: number;
  hr_bpm?: number;
  cadence_spm?: number;
  elevation_gain_ft?: number;
}

/**
 * Watch-driven workout phase. Mirrored from `RunDetail.phases` in
 * `api-contracts.md` §C — same shape as `WatchCompletionPhase` per the
 * apple-watch protocol doc.
 */
export interface RunPhase {
  index: number;
  type: 'warmup' | 'work' | 'recovery' | 'cooldown';
  label: string;
  targetPaceSPerMi: number | null;
  actualPaceSPerMi: number | null;
  actualDurationSec: number;
  actualDistanceMi: number | null;
  avgHr: number | null;
  maxHr: number | null;
  avgCadence: number | null;
  completed: boolean;
}

/**
 * Per-HR-zone time breakdown for the hr-zones-bar chart
 * (`design/charts/specs/hr-zones-bar.md`). Seconds per zone; sum equals
 * the run's `duration_sec`. Computed server-side from the watch's HR stream
 * + the runner's LTHR-derived zones per `design/resolver/zones.md`.
 */
export interface ZoneTimeSec {
  z1: number;
  z2: number;
  z3: number;
  z4: number;
  z5: number;
}

/**
 * The just-completed run, embedded inline in `TodayResponse` when state is
 * `done_nailed` or `done_ease_off`. Lets the client render mile-splits +
 * HR-zones + workout-breakdown charts without a second round-trip to
 * `GET /runs/:id`.
 *
 * Spec: `shared/api-contracts.md` §B "TodayResponse.recent_run" + the
 * three chart specs that consume it.
 */
export interface TodayRecentRun {
  id: UUID;
  started_at: ISOTimestamp;
  completed_at: ISOTimestamp;
  distance_mi: number;
  duration_sec: number;
  avg_pace_s_per_mi: number | null;
  avg_hr_bpm: number | null;
  max_hr_bpm: number | null;
  avg_cadence_spm: number | null;
  elevation_gain_ft: number | null;
  splits: RunSplit[];
  phases: RunPhase[] | null;
  zone_time_sec: ZoneTimeSec | null;
  planned_pace_target_s_per_mi: number | null;
  planned_pace_band_low_s_per_mi: number | null;
  planned_pace_band_high_s_per_mi: number | null;
}

// ──────────────────────────────────────────────────────────────────────
// Health series shapes (consumed by health-trend charts)
// ──────────────────────────────────────────────────────────────────────

/**
 * Per-day ACWR datapoint. Computed server-side per Hulin/Gabbett 2016
 * (cited in `research/doctrine/data/15-wearable-data.md` §"Acute:Chronic
 * Workload Ratio"). Consumed by `design/charts/specs/acwr-load-trend.md`.
 *
 * `value` is null until 7+ days of run data exist (chart-spec edge case
 * "Sparse data"). `band` mirrors `AcwrBand` per Gabbett's sweet-spot table.
 */
export interface AcwrSeriesPoint {
  date: ISODate;
  value: number | null;
  band: AcwrBand | null;
}

/**
 * Single-metric daily datapoint (HRV/RHR/sleep). Mirrors the per-metric
 * shape in `GET /health/series` per `api-contracts.md` §6.
 */
export interface HealthSeriesPoint {
  date: ISODate;
  value: number | null;
}

/**
 * Per-day zone-time distribution (% in each HR zone). Used for the
 * zone-time-pie / zone-time-bar variants on `pages/health.md` (post-v1).
 */
export interface ZoneTimeSeriesPoint {
  date: ISODate;
  z1_pct: number;
  z2_pct: number;
  z3_pct: number;
  z4_pct: number;
  z5_pct: number;
}

/**
 * Full `GET /health/series` response shape. Each metric array is optional —
 * the client passes `metrics=` to control which series come back. Baselines
 * are doctrine-pinned values surfaced for client rendering without
 * hard-coding numbers (Cardinal Rule #4).
 */
export interface HealthSeriesResponse {
  days: number;
  metrics: {
    hrv?: HealthSeriesPoint[];
    rhr?: HealthSeriesPoint[];
    sleep?: HealthSeriesPoint[];
    zone_time?: ZoneTimeSeriesPoint[];
    acwr?: AcwrSeriesPoint[];
  };
  baselines: {
    hrv_ms?: number;
    rhr_bpm?: number;
    sleep_h?: number;
    /** ACWR band edges per `15-wearable-data.md` (Hulin/Gabbett 2016). */
    acwr_sweet_spot_low?: number;
    acwr_sweet_spot_high?: number;
    acwr_spike_threshold?: number;
  };
}

// ──────────────────────────────────────────────────────────────────────
// Elevation profile (for the long-run workout-detail endpoint)
// ──────────────────────────────────────────────────────────────────────

/**
 * Single (distance, elevation) sample point. Cumulative distance from the
 * route start, absolute elevation (not gain). Samples are ordered by
 * `distance_mi` ascending.
 */
export interface ElevationSample {
  distance_mi: number;
  elevation_ft: number;
}

/**
 * Elevation-profile payload returned on `GET /plan/workouts/:id` for long-run
 * workouts that have an associated route. Consumed by the chart spec
 * `design/charts/specs/elevation-profile.md` (long-run today-state variant).
 *
 * Race-detail elevation comes from `RaceDetail.course.geometry.elevation_profile`,
 * not this shape (race endpoints emit raw `number[]` per the GPX-upload
 * contract — that path is unchanged in this round).
 */
export interface PlanWorkoutElevationProfile {
  samples: ElevationSample[];
  total_gain_ft: number;
  max_grade_pct: number;
  distance_mi: number;
  source: 'route_library' | 'previous_run' | 'upload';
}

// ──────────────────────────────────────────────────────────────────────
// Today endpoint composite (most clients hit this and get everything)
// ──────────────────────────────────────────────────────────────────────

export interface TodayResponse extends ResolverOutput {
  brief?: BriefingResponse;
  /**
   * Present iff `state ∈ {'done_nailed', 'done_ease_off'}` AND a run is in
   * the 6h DONE window. Lets clients render mile-splits + HR-zones charts
   * inline without a second `/runs/:id` round-trip.
   *
   * Spec: `shared/api-contracts.md` §B "TodayResponse.recent_run".
   */
  recent_run?: TodayRecentRun;
}
