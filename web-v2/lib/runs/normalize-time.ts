/**
 * lib/runs/normalize-time.ts · canonical-run time normalization.
 *
 * The bug this fixes (2026-05-31 audit):
 *
 *   Different ingest paths stamp `data.startLocal` with different and
 *   inconsistent timezone conventions:
 *     · strava / strava_webhook → ISO with explicit `Z` (UTC)
 *     · apple_health raw → ISO with explicit `Z` (UTC)
 *     · apple_watch via HK → no `Z` marker, value is LOCAL wall time
 *     · watch (Faff watch app) → no `Z` marker, value is UTC
 *
 *   `Date.parse("2026-05-31T08:43:14")` interprets a no-Z string as
 *   server-local. The recap engine runs on Railway (UTC), so an
 *   apple_watch row stored at "2026-05-31T08:43:14" (which is 08:43 PDT
 *   = 15:43 UTC) gets read as 08:43 UTC, which puts the weather window
 *   in the wrong 7-hour bracket.
 *
 *   On David's 12mi today this meant the original (pre-rename) weather
 *   sample reported 65°F (the temp at 08:43 UTC = 01:43 PDT, basically
 *   dawn) instead of the real run window of 08:51-10:30 PDT where it
 *   climbed 68°F → 78°F.
 *
 * This module gives every consumer one confident answer · what's the
 * UTC moment this run actually started at?
 *
 * `toUtcIso(startLocal, source, tz)` returns a confident ISO with an
 * explicit `Z`. The decision tree is keyed off `source`:
 *
 *   · source has explicit Z or numeric offset → trust it, normalize to Z
 *   · source 'strava' / 'strava_webhook' → UTC
 *   · source 'apple_health' → UTC
 *   · source 'watch' → UTC (Faff watch app stamps server-side UTC)
 *   · source 'apple_watch' → LOCAL (HealthKit emits the workout's
 *       startDate in the runner's local zone without offset · we
 *       reconstruct UTC by applying `tz`)
 *   · unknown / null → UTC (defensive; matches the majority shape)
 *
 * `tz` defaults to `America/Los_Angeles` — the zone every pre-multiuser
 * row was stamped in. 2026-07-06 (audit P1-33/P1-51): every runner-data
 * caller now passes the runner's zone explicitly — the row's own
 * `data.timezone` when present, else `runnerTimezoneOrPacific(userUuid)`
 * (lib/runtime/runner-tz.ts · stored profile tz, LA only when unset).
 * The default remains for admin diagnostics and as the legacy-safe floor.
 */

export const DEFAULT_TZ = 'America/Los_Angeles';

/** True when the ISO string carries a timezone marker we can trust. */
function hasTzMarker(iso: string): boolean {
  return /Z$|[+\-]\d{2}:?\d{2}$/.test(iso);
}

/** True for sources whose no-Z `startLocal` is UTC. */
function sourceStoresUtc(source: string | null | undefined): boolean {
  if (!source) return true;
  const s = source.toLowerCase();
  return s === 'strava'
    || s === 'strava_webhook'
    || s === 'apple_health'
    || s === 'manual';         // Faff manual entry stamps with `Z`
}

/** True for sources whose no-Z `startLocal` is the runner's local wall time.
 *  · 'apple_watch' · HealthKit emits the workout startDate in the runner's
 *    local zone without an offset.
 *  · 'watch' · 2026-06-02 audit (admin/audit-weather for David's interval
 *    workout) showed Faff watch direct ingest stores startLocal as PDT
 *    wall time (12:16:14, not 19:16:14 UTC). The original "stamps server-
 *    side UTC" comment was wrong · weather enrichment was hitting Open-
 *    Meteo 7 hours early as a result, returning predawn temps.
 *  · 'treadmill' · same call path as 'watch' (TreadmillView posts to
 *    /api/watch/workouts/complete), so it inherits the same shape. */
function sourceStoresLocal(source: string | null | undefined): boolean {
  if (!source) return false;
  const s = source.toLowerCase();
  return s === 'apple_watch' || s === 'watch' || s === 'treadmill';
}

/**
 * Convert a wall-time ISO string in a given IANA zone to its UTC ISO.
 *
 * Approach: build a Date treating the input as UTC, then ask Intl for
 * the offset that zone had at that moment, and subtract it. Two-pass to
 * handle the wall-time ambiguity around DST transitions correctly.
 */
function wallTimeToUtc(walltime: string, tz: string): string {
  // Strip any trailing markers · we already know there are none for the
  // wall-time path, but be defensive.
  const clean = walltime.replace(/[Z]|[+\-]\d{2}:?\d{2}$/, '');
  // Treat the wall time as if it were UTC to get a candidate epoch.
  const candidate = new Date(clean + 'Z');
  if (isNaN(candidate.getTime())) return walltime;

  // Look up the offset for tz at the candidate moment. Intl.DateTimeFormat
  // with the offset format gives us "GMT-7" or similar.
  const offsetMin = tzOffsetMinutes(candidate, tz);
  // wall = utc + offset · so utc = wall - offset. The wall-time-as-UTC
  // candidate is ahead of the real UTC by |offset| minutes when offset
  // is negative (west of UTC). Subtract offset minutes.
  const utcMs = candidate.getTime() - offsetMin * 60_000;
  return new Date(utcMs).toISOString();
}

/** Returns the IANA zone's offset from UTC in minutes at the given instant.
 *  Positive for east of UTC, negative for west. */
function tzOffsetMinutes(at: Date, tz: string): number {
  // The "longOffset" format yields strings like "GMT-07:00" or "GMT+05:30".
  const fmt = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'longOffset' });
  const parts = fmt.formatToParts(at);
  const off = parts.find(p => p.type === 'timeZoneName')?.value ?? 'GMT+00:00';
  const m = /GMT([+\-])(\d{2}):?(\d{2})/.exec(off);
  if (!m) return 0;
  const sign = m[1] === '-' ? -1 : 1;
  const hh = parseInt(m[2], 10);
  const mm = parseInt(m[3], 10);
  return sign * (hh * 60 + mm);
}

/**
 * Return a confident UTC ISO string for a run's start time.
 *
 * Inputs:
 *   - startLocal · whatever the row stored
 *   - source · the row's data.source field
 *   - tz · IANA zone for the LOCAL-stamped sources (defaults to
 *           America/Los_Angeles where David lives; pass the runner's
 *           configured zone for multi-user correctness).
 *
 * Returns: ISO with explicit `Z`, or null if startLocal is unparseable.
 */
export function toUtcIso(
  startLocal: string | null | undefined,
  source: string | null | undefined,
  tz: string = DEFAULT_TZ,
): string | null {
  if (!startLocal) return null;
  if (hasTzMarker(startLocal)) {
    // Trust the marker · just round-trip through Date to normalize to Z.
    const d = new Date(startLocal);
    return isNaN(d.getTime()) ? null : d.toISOString();
  }
  if (sourceStoresLocal(source)) {
    return wallTimeToUtc(startLocal, tz);
  }
  // Default: treat as UTC. Covers source 'watch', 'strava', 'apple_health',
  // 'manual', null, and any future source not explicitly flagged as local.
  const d = new Date(startLocal + 'Z');
  return isNaN(d.getTime()) ? null : d.toISOString();
}

/**
 * Return the run's wall-time local ISO (no Z), given the canonical UTC and
 * the runner's tz. Used when a UI surface wants "8:43 AM" instead of the
 * UTC moment.
 */
export function toLocalWallIso(
  utcIso: string | null | undefined,
  tz: string = DEFAULT_TZ,
): string | null {
  if (!utcIso) return null;
  const d = new Date(utcIso);
  if (isNaN(d.getTime())) return null;
  const offset = tzOffsetMinutes(d, tz);
  const wallMs = d.getTime() + offset * 60_000;
  // Build a no-Z ISO at the wall time. Slice off the trailing Z that
  // toISOString would emit, since we're emitting wall time not UTC.
  return new Date(wallMs).toISOString().replace(/Z$/, '');
}
