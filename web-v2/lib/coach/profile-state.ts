/**
 * profile-state.ts
 * Identity + physiology (derived) + connections + preferences + shoes.
 */
import { pool } from '@/lib/db/pool';
import { runnerToday } from '@/lib/runtime/runner-tz';
import { loadSettings, type UserSettings } from '@/lib/coach/settings';
import { computeZones, estimateLTHR, estimateMaxHRFromLTHR, type ZoneTable } from '@/lib/training/zones';
import { loadLatestVdotWithAnchor } from '@/lib/training/projection-snapshots';
import { loadEffectiveMaxHr } from '@/lib/training/max-hr';
import { loadNextARace } from './race-lookup';
import { loadActivePlan } from '@/lib/plan/lookup';
import { computeShoeMileage } from '@/lib/shoe/mileage';
import { loadStravaConnectionStatus } from '@/lib/strava/connection-status';
import { distanceMiFromLabel } from '@/lib/race/distance';

export type ExperienceLevel = 'beginner' | 'intermediate' | 'advanced' | 'advanced_plus';

export interface ProfileState {
  identity: {
    full_name: string | null;
    sex: string | null;
    birthday: string | null;     // ISO date
    age: number | null;          // computed from birthday
    city: string | null;
    height_cm: number | null;
    experience_level: ExperienceLevel | null;
  };
  physiology: {
    max_hr: number | null;           // best estimate (user-entered, observed, or derived)
    max_hr_source: 'observed' | 'lthr-derived' | 'formula' | 'manual' | null;
    rhr: number | null;
    vo2: number | null;
    weight_lb: number | null;
    vdot: number | null;
    /** ISO date of the race/run that produced vdot. Null pre-migration-125. */
    vdot_anchor_date: string | null;
    /** Distance (miles) of that race/run. Null pre-migration-125. */
    vdot_anchor_distance_mi: number | null;
    /** 2026-06-09 · F1/F9 — anchor age (days) at load time. Null when no anchor. */
    vdot_anchor_age_days: number | null;
    /** 2026-06-09 · F1/F9 — resolved race name for the anchor ("Disney Half
     *  Marathon"). Null when the anchor was a training run or pre-migration. */
    vdot_anchor_name: string | null;
    lthr: number | null;
    lthr_method: string | null;      // how it was set
    lthr_set_at: string | null;      // ISO timestamp
    zones: ZoneTable | null;         // computed zones (LTHR-based if available, else %MHR)
  };
  shoes: { id: string; name: string; brand: string; model: string; color: string | null; color2: string | null; notes: string | null; runTypes: string[]; mileage: number; cap: number; pctUsed: number; preferred: boolean | null; retired: boolean; baseline_mi: number }[];
  nextARace: { slug: string; name: string; date: string; goal: string | null; days_to_race: number } | null;
  /** 2026-06-15 · no-race anchor: the runner's tt_goal_*. Present when there's
   *  no A-race so the briefing voice can say "TRAINING FOR · 10K · 41:35". */
  fitnessGoal: { distance: string; time: string; seconds: number | null } | null;
  connections: {
    /** P2-3: `connected` is now token-derived (real Strava linkage), not
     *  "ran recently". `needsReauth` distinguishes a dead/401'd token
     *  from a never-connected runner — both read connected:false, but
     *  the copy/CTA should differ. */
    strava:       { connected: boolean; needsReauth?: boolean; lastSync: string | null; note: string };
    appleHealth:  { connected: boolean; lastSync: string | null; note: string };
    appleWatch:   { connected: boolean; lastSync: string | null; note: string };
  };
  preferences: UserSettings;
}

function ageFromBirthday(iso: string | null): number | null {
  if (!iso) return null;
  const b = new Date(iso + 'T12:00:00Z');
  if (isNaN(b.getTime())) return null;
  const now = new Date();
  let age = now.getUTCFullYear() - b.getUTCFullYear();
  const beforeBday = now.getUTCMonth() < b.getUTCMonth() ||
                     (now.getUTCMonth() === b.getUTCMonth() && now.getUTCDate() < b.getUTCDate());
  if (beforeBday) age--;
  return age;
}

/**
 * Parse a last-sync value into a Date, or null. Tolerates BOTH the
 * "YYYY-MM-DD" date-only shape (anchored at noon UTC to dodge a TZ
 * rollover) AND a full ISO timestamp — some ingest paths write
 * data.date as a full timestamp ("2026-06-11T02:41:28Z"), and the old
 * `new Date(`${v}T12:00:00Z`)` produced a double-suffixed Invalid Date
 * for those. A truthy-but-Invalid Date is the trap: `?.toISOString()`
 * does NOT guard it (optional-chaining only stops at null/undefined),
 * so it threw "Invalid time value" and crashed the entire profile load
 * → null profile → cold Targets gap. Never returns an Invalid Date.
 */
function parseLastSync(v: string | Date | null | undefined): Date | null {
  if (!v) return null;
  const s = v instanceof Date ? v.toISOString() : String(v);
  const d = /^\d{4}-\d{2}-\d{2}$/.test(s) ? new Date(`${s}T12:00:00Z`) : new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

export async function loadProfileState(userId: string): Promise<ProfileState> {
  const today = await runnerToday(userId);

  // Audit 2026-05-27: most of /profile's data sources are independent.
  // Parallelize the 11-query first batch with Promise.all so /profile FCP
  // is bounded by max query time rather than sum. Dependent lookups
  // (race lookup off plan.race_id, VDOT candidate runs off race rows,
  // LTHR derive off race meta) follow in the second wave.
  const [
    pRow,
    mhrRow,
    rhrRow,
    vo2Row,
    wRow,
    shoesRows,
    planRow,
    stravaRow,
    healthRow,
    watchRow,
    preferencesResolved,
    stravaConnStatus,
  ] = await Promise.all([
    pool.query(
      `SELECT full_name, sex, age, city, height_cm, hrmax, rhr,
              birthday::text AS birthday,
              lthr, experience_level,
              lthr_method, lthr_set_at::text AS lthr_set_at
         FROM profile
        WHERE user_uuid = $1
        ORDER BY (user_uuid = $1) DESC LIMIT 1`,
      [userId]
    ).then((r) => r.rows[0]),
    pool.query(
      `SELECT MAX(value) AS m FROM health_samples WHERE COALESCE(user_uuid, user_id) = $1 AND sample_type = 'hr'`,
      [userId]
    ).then((r) => r.rows[0]),
    pool.query(
      `SELECT AVG(value) AS a FROM health_samples
        WHERE COALESCE(user_uuid, user_id) = $1 AND sample_type = 'resting_hr'
          AND recorded_at >= NOW() - interval '60 days'`,
      [userId]
    ).then((r) => r.rows[0]),
    pool.query(
      `SELECT value FROM health_samples WHERE COALESCE(user_uuid, user_id) = $1 AND sample_type = 'vo2_max'
        ORDER BY recorded_at DESC LIMIT 1`,
      [userId]
    ).then((r) => r.rows[0]),
    pool.query(
      `SELECT value FROM health_samples WHERE COALESCE(user_uuid, user_id) = $1 AND sample_type = 'body_mass'
        ORDER BY sample_date DESC LIMIT 1`,
      [userId]
    ).then((r) => r.rows[0]),
    pool.query(
      `SELECT id, brand, model, color, color2, notes, run_types, mileage, mileage_cap, retired, preferred,
              COALESCE(baseline_mi, 0)::numeric AS baseline_mi
         FROM shoes
        WHERE user_uuid = $1
        ORDER BY id`,
      [userId]
    ).then((r) => r.rows),
    // Active plan via the memoized loadActivePlan helper. Inside this
    // Promise.all batch we still hit the lookup, but subsequent state-
    // loaders firing on /today + /profile share the cached value.
    loadActivePlan(userId).then((p) => p ? { race_id: p.race_id } : undefined),
    // P2-3 (2026-07-06): scoped to source='strava' — this feeds the
    // Strava "last sync" note, not the connected boolean (that's now
    // token-derived below). Any-run MAX() here is how a watch-only
    // runner who never touched Strava saw "Strava · Synced".
    pool.query(
      `SELECT MAX(COALESCE(data->>'date', LEFT(data->>'startLocal',10))::text) AS last
         FROM runs
        WHERE user_uuid = $1
          AND NOT (data ? 'mergedIntoId')
          AND data->>'source' = 'strava'`,
      [userId]
    ).catch(() => ({ rows: [{ last: null }] })).then((r) => r.rows[0]),
    pool.query(
      `SELECT MAX(recorded_at) AS last FROM health_samples WHERE COALESCE(user_uuid, user_id) = $1`,
      [userId]
    ).catch(() => ({ rows: [{ last: null }] })).then((r) => r.rows[0]),
    pool.query(
      `SELECT MAX(recorded_at) AS last
         FROM health_samples
        WHERE COALESCE(user_uuid, user_id) = $1
          AND sample_type IN ('hrv_sdnn','vo2_max','resting_hr')`,
      [userId]
    ).catch(() => ({ rows: [{ last: null }] })).then((r) => r.rows[0]),
    loadSettings(userId).catch(() => DEFAULT_PREFS),
    // P2-3: real Strava linkage (connector_tokens / legacy profile.*
    // token presence), not "any run exists recently". Separate query
    // so a dead-token 401 case (needs_reauth) can be told apart from
    // a genuine never-connected runner.
    loadStravaConnectionStatus(userId).catch(() => ({ state: 'disconnected' as const, last_push_at: null })),
  ]);

  const p = pRow;
  const rhr = rhrRow?.a ? Math.round(Number(rhrRow.a)) : (p?.rhr ?? null);
  const vo2 = vo2Row?.value ? +Number(vo2Row.value).toFixed(1) : null;
  const weight_lb = wRow?.value ? +(Number(wRow.value) * 2.20462).toFixed(1) : null;
  const preferences = preferencesResolved;

  // Mileage computed ON READ from canonical runs (lib/shoe/mileage.ts) ·
  // the stored `shoes.mileage` column is stale/fictional and no longer
  // trusted. pctUsed therefore reflects real tracked miles.
  const shoeMiles = await computeShoeMileage(userId);
  const shoes = shoesRows.map((s: any) => {
    const tracked = shoeMiles.get(Number(s.id)) ?? 0;
    const baseline = Number(s.baseline_mi ?? 0);
    const m = tracked + baseline;
    const cap = Number(s.mileage_cap) || 400;
    return {
      id: String(s.id),
      name: `${s.brand} ${s.model}`,
      brand: s.brand, model: s.model,
      color: s.color ?? null,
      color2: s.color2 ?? null,
      notes: s.notes ?? null,
      runTypes: s.run_types ?? [],
      mileage: Math.round(m),
      cap, pctUsed: Math.round((m / cap) * 100),
      preferred: s.preferred,
      retired: !!s.retired,
      baseline_mi: baseline,
    };
  });

  // Next A race — shared memoized helper. Same lookup state-loader uses,
  // so /today + /profile + /health all share one query per 60s window.
  const nextARaceFull = await loadNextARace(userId, today, planRow?.race_id ?? null);
  const nextARace: ProfileState['nextARace'] = nextARaceFull ? {
    slug: nextARaceFull.slug,
    name: nextARaceFull.name ?? '',
    date: nextARaceFull.date,
    goal: nextARaceFull.goal,
    days_to_race: nextARaceFull.days_to_race,
  } : null;

  // 2026-06-15 · fitness goal (no-race anchor). When there's no A-race, the
  // tt_goal_* IS what the runner is training for — the briefing voice anchors
  // on it. Only loaded when no race, so a race always wins.
  let fitnessGoal: ProfileState['fitnessGoal'] = null;
  if (!nextARace) {
    const g = (await pool.query<{ d: string | null; t: string | null; s: number | null }>(
      `SELECT tt_goal_distance AS d, tt_goal_time AS t, tt_goal_time_seconds AS s FROM profile WHERE user_uuid = $1`,
      [userId],
    ).catch(() => ({ rows: [] as Array<{ d: string | null; t: string | null; s: number | null }> }))).rows[0];
    if (g?.d && g?.t) fitnessGoal = { distance: g.d, time: g.t, seconds: g.s ?? null };
  }

  // Connection windows from the now-parallelized lastsync rows. parseLastSync
  // tolerates date-only OR full-timestamp inputs and never yields an Invalid
  // Date (see helper · the old inline `new Date(`${v}T12:00:00Z`)` threw on a
  // full-timestamp value and crashed the whole profile load).
  const stravaLast: Date | null = parseLastSync(stravaRow?.last);
  // P2-3: connected = real token on file (connector_tokens / legacy
  // profile.strava_refresh_token), not "ran recently". A dead/401'd
  // token reads 'needs_reauth', which we still surface as NOT connected
  // (the UI's binary "Synced"/"Connect" can't distinguish the third
  // state today — this at least stops the auto-push toggle from lying).
  const stravaConnected = stravaConnStatus.state === 'connected';
  const stravaNeedsReauth = stravaConnStatus.state === 'needs_reauth';
  const healthLast: Date | null = parseLastSync(healthRow?.last);
  const healthConnected = healthLast != null && (Date.now() - healthLast.getTime()) < 1000 * 60 * 60 * 24 * 7;
  const watchLast: Date | null = parseLastSync(watchRow?.last);
  const watchConnected = watchLast != null && (Date.now() - watchLast.getTime()) < 1000 * 60 * 60 * 24 * 30;

  // B4 (2026-06-08): VDOT is now read from projection_snapshots (cron-written
  // nightly) rather than recomputed live. Single query replaces 4+ queries +
  // the full race-candidate chain. Falls back to null for cold-start users
  // who haven't had a cron run yet — display reads null as "no VDOT yet".
  const effMaxHr = await loadEffectiveMaxHr(userId, today);
  const { vdot, anchorDateISO: vdotAnchorDate, anchorDistanceMi: vdotAnchorDistMi } =
    await loadLatestVdotWithAnchor(userId);

  // 2026-06-09 · race-killers F1/F9 — anchor age + name. A 4-month-old
  // VDOT rendered with no provenance: "47.9" looked current while every
  // race since the anchor read 44-45. Resolve the anchor race's name by
  // date (±1d) + distance so the UI can say
  // "47.9 · Disney Half Marathon · Feb 1 · 128d old".
  const vdotAnchorAgeDays = vdotAnchorDate
    ? Math.max(0, Math.round((Date.parse(today + 'T12:00:00Z') - Date.parse(String(vdotAnchorDate).slice(0, 10) + 'T12:00:00Z')) / 86400000))
    : null;
  let vdotAnchorName: string | null = null;
  if (vdotAnchorDate) {
    vdotAnchorName = (await pool.query<{ name: string | null }>(
      `SELECT meta->>'name' AS name FROM races
        WHERE user_uuid = $1
          AND ABS((meta->>'date')::date - $2::date) <= 1
        ORDER BY ABS((meta->>'date')::date - $2::date) ASC
        LIMIT 1`,
      [userId, String(vdotAnchorDate).slice(0, 10)],
    ).catch(() => ({ rows: [] }))).rows[0]?.name ?? null;
  }

  // === LTHR + true MaxHR ===
  // Prefer user-entered values; fall back to derived-from-race if we have race meta.
  let lthr: number | null = p?.lthr ?? null;
  let lthrMethod: string | null = p?.lthr_method ?? null;
  if (lthr == null) {
    // Try to derive from race data — half-marathon avg HR is the best proxy
    const raceWithHr = (await pool.query(
      `SELECT meta FROM races
        WHERE user_uuid = $1
          AND meta->>'finishTime' IS NOT NULL
          AND meta->>'avgHrBpm' IS NOT NULL
        ORDER BY (meta->>'date') DESC NULLS LAST LIMIT 5`,
      [userId]
    ).catch(() => ({ rows: [] }))).rows;
    for (const row of raceWithHr) {
      const m = row.meta;
      // 2026-07-07 · ultra-honesty audit · was `?? 13.1` — any race missing a
      // numeric distanceMi (the common case; POST /api/race writes a label,
      // not a number) got FORCED into estimateLTHR's half-marathon band, its
      // highest-confidence branch, regardless of actual distance. A 50K/100K
      // (or any other unlabeled race) avg HR was read as "half-marathon avg
      // HR ≈ LTHR" — wrong for an ultra's much lower relative effort, and
      // wrong for anything that isn't actually a half. Resolve the real
      // distance from the label first; skip this row (never guess) when it
      // can't be resolved at all — estimateLTHR's own band-match already
      // handles "resolved but not close to a known race distance" honestly.
      const distanceMi = m.distanceMi != null ? Number(m.distanceMi) : distanceMiFromLabel(m.distanceLabel);
      if (distanceMi == null) continue;
      const est = estimateLTHR({
        raceDistanceMi: distanceMi,
        avgHrBpm: Number(m.avgHrBpm),
      });
      if (est) {
        lthr = est.lthr;
        lthrMethod = `derived: ${m.name ?? 'race'} (${est.note})`;
        break;
      }
    }
  }

  // True MaxHR: loadEffectiveMaxHr is authoritative for every user
  // (user_override → 12-month observed → manual stored → null).
  // profile.hrmax_observed no longer bypasses the resolver — any user
  // who wants to assert a known max should use users.max_hr_override,
  // which feeds into the resolver at step 1.
  // See lib/training/max-hr.ts for the full resolution doctrine.
  const max_hr: number | null =
    effMaxHr.bpm
    ?? (lthr != null ? estimateMaxHRFromLTHR(lthr) : null)
    ?? (p?.hrmax ?? null);
  const max_hr_source: ProfileState['physiology']['max_hr_source'] =
    effMaxHr.bpm != null && effMaxHr.source === 'observed_12mo' ? 'observed' :
    effMaxHr.bpm != null && effMaxHr.source === 'user_override' ? 'manual' :
    effMaxHr.bpm != null && effMaxHr.source === 'manual_stored' ? 'manual' :
    lthr != null ? 'lthr-derived' :
    p?.hrmax ? 'formula' : null;

  const zones = computeZones({ lthr, maxHr: max_hr });

  const birthday = p?.birthday ?? null;
  const age = ageFromBirthday(birthday) ?? p?.age ?? null;

  return {
    identity: {
      full_name: p?.full_name ?? null,
      sex: p?.sex ?? null,
      birthday,
      age,
      city: p?.city ?? null,
      // Postgres returns NUMERIC columns as strings by default to preserve
      // precision · pg-node never coerces them. iPhone Decodable expects
      // Double, so a String payload here crashed the entire ProfileState
      // decode + emptied the iPhone Profile / Today / Activity / Targets /
      // Train avatars (all 5 views read this struct). Cast to Number on
      // the way out so the wire shape is honest. Added 2026-05-31.
      height_cm: p?.height_cm != null ? Number(p.height_cm) : null,
      experience_level: (p?.experience_level as ExperienceLevel | null) ?? null,
    },
    physiology: {
      max_hr, max_hr_source,
      rhr, vo2, weight_lb, vdot,
      vdot_anchor_date: vdotAnchorDate ?? null,
      vdot_anchor_distance_mi: vdotAnchorDistMi ?? null,
      vdot_anchor_age_days: vdotAnchorAgeDays,
      vdot_anchor_name: vdotAnchorName,
      lthr,
      lthr_method: lthrMethod,
      lthr_set_at: p?.lthr_set_at ?? null,
      zones,
    },
    shoes: shoes.filter((s) => !s.retired),
    nextARace,
    fitnessGoal,
    connections: {
      strava:      { connected: stravaConnected, needsReauth: stravaNeedsReauth, lastSync: stravaLast?.toISOString() ?? null, note: stravaConnected ? (stravaLast ? `Last sync ${relativeAgo(stravaLast)}` : 'Connected · no runs synced yet') : (stravaNeedsReauth ? 'Reconnect needed — token expired' : 'Connect for auto-sync') },
      appleHealth: { connected: healthConnected, lastSync: healthLast?.toISOString() ?? null, note: healthConnected ? `Last reading ${relativeAgo(healthLast!)}` : 'Sleep / HRV / RHR / weight / VO2' },
      appleWatch:  { connected: watchConnected, lastSync: watchLast?.toISOString() ?? null, note: watchConnected ? `Last workout ${relativeAgo(watchLast!)}` : 'Open Faff on iPhone to pair' },
    },
    preferences,
  };
}

// Inline default to avoid import cycle issues if settings loader fails completely.
const DEFAULT_PREFS: UserSettings = {
  units_distance: 'mi',
  units_temp: 'F',
  units_pace: 'min_per_mi',
  long_run_day: 'sun',
  rest_day: 'sat',
  quality_days: ['tue', 'thu'],
  briefing_time: '07:00',
  push_enabled: true,
};

function relativeAgo(d: Date): string {
  const mins = Math.floor((Date.now() - d.getTime()) / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return d.toISOString().slice(0, 10);
}
