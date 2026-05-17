/**
 * lib/core/types.ts
 *
 * The contract between the research layer and the planning layer.
 * This is the seam. Pin it down here; everything else derives from it.
 *
 * Nullability rules:
 *   - Required fields (distance_mi, course_type) are never null.
 *     If research can't determine them, it throws — we can't build a plan.
 *   - Optional facts (elevation, coords, aid stations) are null when
 *     Claude could not verify them from a primary source.
 *     The planner renders the plan anyway and flags the gaps visibly.
 *   - source_urls[] is always present, may be empty on total failure.
 *   - flagged_fields[] names every field that is null due to missing
 *     primary-source verification — not every null field (some are
 *     legitimately absent, e.g. a loop course has no finish_coords
 *     different from start_coords).
 */

// ─── Visualization data ───────────────────────────────────────────────────────

/** Downsampled track point for the course map (≤500 points from GPX). */
export interface TrackPoint {
  lat: number;
  lon: number;
  distMi: number;
  eleFt: number;
}

/** One chart data point for the elevation/pace chart. */
export interface SegmentSummary {
  startMi: number;
  endMi: number;
  eleFt: number;         // elevation at segment start
  gradePct: number;      // mean grade (signed)
  targetPaceS: number;   // target pace in seconds/mile
}

/** One meaningful race section (4–8 per plan). */
export interface RacePhase {
  index: number;
  name: string;
  start_mi: number;
  end_mi: number;
  avg_pace_s: number;
  avg_pace_display: string;
  gain_ft: number;
  loss_ft: number;
  net_ft: number;
  gels: GelPlacement[];
  strategy_note: string;
}

// ─── Watch payload ────────────────────────────────────────────────────────────

/** A GPS coordinate used for proximity-based triggers on the Watch. */
export interface WatchCoord {
  lat: number;
  lon: number;
}

/** A gel trigger — fires when within trigger_radius_m of coord (if available),
 *  otherwise falls back to at_mile distance estimate. */
export interface WatchGelTrigger {
  number: number;
  at_mile: number;
  caffeine: boolean;
  label: string;
  coord: WatchCoord | null;       // null when no GPX available
  trigger_radius_m: number;       // 80m for official GPX, 150m for OSRM
}

/** A phase boundary trigger — advance to next phase when runner passes this point. */
export interface WatchPhase {
  index: number;
  name: string;
  start_mi: number;
  end_mi: number;
  avg_pace_s: number;
  avg_pace_display: string;
  gain_ft: number;
  loss_ft: number;
  strategy_note: string;
  gels: GelPlacement[];
  start_coord: WatchCoord | null; // coordinate of phase start for proximity trigger
  end_coord: WatchCoord | null;   // coordinate of phase end
}

/** Mile marker coordinates — used for the Watch calibration screen.
 *  Runner taps official marker → app snaps to this coord. */
export interface WatchMileMarker {
  mile: number;
  coord: WatchCoord | null;
}

/** Self-contained payload for the Watch app.
 *  Everything it needs, nothing it doesn't. */
export interface WatchPayload {
  race_name: string;
  race_date: string;
  total_miles: number;
  goal_finish_s: number;
  goal_display: string;
  avg_pace_s: number;
  gpx_source: 'user_upload' | 'official_download' | 'community_gpx' | 'osrm_synthetic' | null;
  phases: WatchPhase[];
  gels: WatchGelTrigger[];
  mile_markers: WatchMileMarker[];  // every mile, coord null when no GPX
}

// ─── Research output ──────────────────────────────────────────────────────────

export interface CourseResearch {
  // Identity
  race_name: string;              // Canonical name from official site
  slug: string;                   // kebab-case

  // Geometry — distance is required; plan cannot proceed without it
  distance_mi: number;
  distance_m: number;
  course_type: 'point_to_point' | 'loop' | 'out_and_back';

  // Elevation — null if not found on primary source
  total_gain_ft: number | null;
  total_loss_ft: number | null;
  net_elevation_ft: number | null;

  // Location — null if coords not verified
  start_coords: { lat: number; lon: number } | null;
  finish_coords: { lat: number; lon: number } | null;
  start_location_name: string | null;   // e.g. "Dodger Stadium"
  finish_location_name: string | null;  // e.g. "Avenue of the Stars, Century City"

  // Aid stations — null means not found; [] means verified none
  aid_station_miles: number[] | null;

  // Course route — null if not found during research
  gpx_url: string | null;        // URL to official or public GPX file

  // Context
  typical_date: string | null;          // e.g. "third Sunday of March"
  course_warnings: string[];            // Notable features, hazards, recent changes

  // Research integrity — always populated
  source_urls: string[];                // Every URL consulted
  primary_source_url: string | null;    // Must be on official race domain
  flagged_fields: string[];             // Fields that are null due to missing primary source
  research_notes: string;              // Claude's reasoning + any conflicts
}

// ─── Plan inputs ──────────────────────────────────────────────────────────────

export interface PlanRequest {
  race_name: string;
  race_date: string;          // YYYY-MM-DD
  goal_time: string;          // "h:mm:ss" — validated by the route before use
  nutrition_notes: string;    // Free text: "SiS GO Isotonic and GO Caffeine 75mg"
}

// ─── Plan outputs ─────────────────────────────────────────────────────────────

export interface GelPlacement {
  number: number;
  at_mile: number;
  caffeine: boolean;
  label: string;              // Parsed from nutrition_notes, e.g. "SiS GO Caffeine"
}

export interface MilePlan {
  mile: number;               // 1-based (mile 1 = end of first mile)
  target_pace_s: number;      // Seconds per mile (even splits = constant)
  target_pace_display: string; // "8:35"
  cumulative_s: number;
  cumulative_display: string;  // "1:03:25"
  is_aid_station: boolean;    // true if aid_station_miles contains this mile (±0.4)
  gel: GelPlacement | null;
}

export interface WeatherConditions {
  narrative: string;           // Human-readable one-liner
  start_temp_f: number | null;
  finish_temp_f: number | null;
  wind_summary: string | null; // "SW 8–12 mph"
  precip_pct: number | null;
}

export interface RacePlan {
  // Echoed inputs
  race_date: string;
  goal_finish_s: number;
  goal_display: string;        // "3:45:00"
  avg_pace_display: string;    // "8:35/mi"

  // Research output (full, for logging + display)
  course: CourseResearch;

  // Weather (null if coords unavailable or NOAA failed)
  weather: WeatherConditions | null;

  // Terrain data (null when no GPX obtained)
  gpx_available: boolean;
  gpx_source: 'user_upload' | 'official_download' | 'community_gpx' | 'osrm_synthetic' | null;
  phases: RacePhase[] | null;
  segments_summary: SegmentSummary[] | null;  // For elevation chart
  track_points: TrackPoint[] | null;          // For course map (≤500 pts)

  // The plan
  miles: MilePlan[];
  gels: GelPlacement[];

  // Integrity flags — rendered visibly in the UI
  missing_fields: string[];    // Human-readable descriptions of what's missing
  warnings: string[];          // Research warnings + course_warnings

  // Watch payload — self-contained, ready for WatchConnectivity transfer
  watch_payload: WatchPayload;

  // Meta
  generated_at: string;        // ISO timestamp
  slice: 'slice-1';            // Tag so we know which build produced this
}
