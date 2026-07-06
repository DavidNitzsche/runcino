/**
 * lib/runtime/runner-tz.ts · runner-timezone resolution.
 *
 * THE PROBLEM (2026-06-03 · David's QC):
 *   Server runs in UTC. `new Date().toISOString().slice(0, 10)` returns
 *   "today" in UTC. For a runner in Pacific Time (America/Los_Angeles),
 *   server "today" tips over to tomorrow at 5pm Pacific (midnight UTC).
 *
 *   Symptoms David hit:
 *     · RECOVERING FROM panel disappearing at UTC-midnight (server thought
 *       recovery window was past while runner was still on day-3)
 *     · "null%" recovery (server's "today" queries returned null because
 *       runner hadn't slept and woken up to record today's readings yet)
 *     · ACWR / sleep streak / readiness "today" all off by one
 *
 * THE FIX:
 *   Every "today" calculation server-side uses the RUNNER'S timezone, not
 *   the server's. Runner TZ lives at `profile.timezone` (IANA name like
 *   "America/Los_Angeles"). Auto-populated from watch + iPhone sync
 *   payloads (TZ-08); manual override via Settings if the runner wants.
 *
 * USAGE:
 *   const today = await runnerToday(userUuid);
 *   // → "2026-06-03" when it's Wed 11pm Pacific (NOT "2026-06-04" UTC)
 *
 * SQL CALLERS:
 *   For Postgres queries currently using `CURRENT_DATE`, accept `today`
 *   as a $N::date parameter and pass `await runnerToday(userUuid)` from
 *   the JS caller. `CURRENT_DATE` is server-clock UTC and must be
 *   replaced.
 *
 * FALLBACK:
 *   Returns UTC when profile.timezone is null. New runners pre-sync land
 *   here briefly; their first watch / HK sync auto-writes the real TZ
 *   (TZ-08). Existing-runner backfill is one-time SQL · David: 2026-06-04.
 */

import { pool } from '@/lib/db/pool';

/**
 * Per-process cache. Next.js serverless re-instantiates per cold start,
 * which is fine · same runner within a request hits the cache for free,
 * and TZ changes (vacation, manual override) take effect on next process.
 * Stores the RAW profile.timezone value (null when unset) so the two
 * fallback policies below (UTC for "today", Pacific for legacy-data
 * interpretation) can share one DB read.
 */
const tzCache = new Map<string, string | null>();

/** Raw profile.timezone · null when the runner never set/synced one. */
async function storedRunnerTimezone(userUuid: string): Promise<string | null> {
  if (tzCache.has(userUuid)) return tzCache.get(userUuid) ?? null;

  const row = (await pool.query<{ timezone: string | null }>(
    `SELECT timezone FROM profile WHERE user_uuid = $1::uuid LIMIT 1`,
    [userUuid],
  ).catch(() => ({ rows: [] as Array<{ timezone: string | null }> }))).rows[0];

  const tz = row?.timezone || null;
  tzCache.set(userUuid, tz);
  return tz;
}

/**
 * Resolve the runner's IANA timezone identifier. Reads `profile.timezone`
 * once per process per user, falls back to "UTC" when null.
 */
export async function runnerTimezone(userUuid: string): Promise<string> {
  return (await storedRunnerTimezone(userUuid)) || 'UTC';
}

/**
 * 2026-07-06 · phone+watch audit P1-11/P1-33/P1-51/P1-52 · the runner's
 * timezone for interpreting DEVICE-STAMPED wall-clock data (run dedup
 * startLocal reconstruction, coach_intents watch-completion day bucketing,
 * HK ingest weather windows).
 *
 * Fallback is America/Los_Angeles — NOT UTC — deliberately: every row
 * written before multi-user signup was stamped in Pacific wall time by
 * the single-user-era clients (HealthKitImporter pinned PT; the LA
 * hardcodes this helper replaces assumed the same). A null profile
 * timezone therefore means "legacy Pacific data", and falling back to LA
 * preserves byte-identical interpretation for those rows. Verified live
 * 2026-07-06 (RO probe): every profile with runs stores
 * 'America/Los_Angeles'; the single null-tz profile has zero runs.
 *
 * Use runnerTimezone() for "what day is it for this runner" (UTC
 * fallback); use THIS for "what zone was this stored wall time written
 * in" (Pacific fallback).
 */
export async function runnerTimezoneOrPacific(userUuid: string): Promise<string> {
  return (await storedRunnerTimezone(userUuid)) || 'America/Los_Angeles';
}

/**
 * Today's date in the runner's timezone, as YYYY-MM-DD.
 *
 * This is the canonical replacement for `new Date().toISOString().slice(0, 10)`
 * anywhere "today" should reflect the runner's calendar day, not the server's.
 *
 *   const today = await runnerToday(userUuid);
 *   // Pacific 11pm Wed → "2026-06-03" (UTC would say "2026-06-04")
 */
export async function runnerToday(userUuid: string): Promise<string> {
  const tz = await runnerTimezone(userUuid);
  // en-CA's date format is YYYY-MM-DD by default · matches the ISO date
  // shape we use everywhere downstream.
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return fmt.format(new Date());
}

/**
 * Drop a runner's cached timezone · call after writing a new value to
 * profile.timezone (Settings update, device auto-detect, vacation switch).
 * Same-process subsequent reads pick up the new value.
 */
export function invalidateRunnerTz(userUuid: string): void {
  tzCache.delete(userUuid);
}

/**
 * 2026-06-03 · capture a TZ from a device sync payload and persist it.
 * 2026-06-12 · travel-aware. Writes the device TZ when EITHER:
 *   · profile.timezone is currently null (first-sync auto-populate), OR
 *   · the runner is in AUTO mode (user_settings.tz_mode != 'manual', the
 *     default) and the device zone has changed (they travelled).
 * A MANUAL override (tz_mode='manual', set via Settings) stays sticky and
 * is never clobbered by a device payload. Returns the newly-stored value
 * when a write happened, else null.
 *
 * Used by watch workout complete, iPhone HK sync, iPhone seed call · any
 * surface that includes a TimeZone.current.identifier on its payload.
 */
export async function captureTimezoneFromDevice(
  userUuid: string,
  payloadTz: string | null | undefined,
): Promise<string | null> {
  if (!payloadTz) return null;
  // Validate · must be a real IANA name. Intl.DateTimeFormat throws on
  // bad timezones, which we treat as "ignore".
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone: payloadTz });
  } catch {
    return null;
  }
  const row = (await pool.query<{ timezone: string | null }>(
    `UPDATE profile SET timezone = $2
       WHERE user_uuid = $1::uuid
         AND (
           timezone IS NULL
           OR (
             COALESCE(user_settings->>'tz_mode', 'auto') <> 'manual'
             AND timezone IS DISTINCT FROM $2
           )
         )
     RETURNING timezone`,
    [userUuid, payloadTz],
  ).catch(() => ({ rows: [] as Array<{ timezone: string | null }> }))).rows[0];
  if (row?.timezone) {
    invalidateRunnerTz(userUuid);
    return row.timezone;
  }
  return null;
}

/**
 * 2026-06-12 · explicit Settings write of the runner timezone.
 *   · mode='manual' + a tz → pin profile.timezone, mark tz_mode='manual'
 *     so device payloads stop overwriting it.
 *   · mode='auto' (tz optional) → mark tz_mode='auto' so travel updates
 *     resume; if a fresh device tz is passed, adopt it immediately.
 * Validates the IANA name and busts the per-process cache.
 */
export async function setRunnerTimezone(
  userUuid: string,
  tz: string | null,
  mode: 'auto' | 'manual',
): Promise<void> {
  if (tz) {
    try {
      new Intl.DateTimeFormat('en-CA', { timeZone: tz });
    } catch {
      throw new Error(`invalid timezone: ${tz}`);
    }
  }
  await pool.query(
    `UPDATE profile
        SET timezone = COALESCE($2, timezone),
            user_settings = COALESCE(user_settings, '{}'::jsonb)
                            || jsonb_build_object('tz_mode', $3::text)
      WHERE user_uuid = $1::uuid`,
    [userUuid, tz ?? null, mode],
  );
  invalidateRunnerTz(userUuid);
}
