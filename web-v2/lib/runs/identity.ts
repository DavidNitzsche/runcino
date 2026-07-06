/**
 * lib/runs/identity.ts · physical-run identity for dedup.
 *
 * One physical run can land as multiple `runs` rows from different ingest
 * paths (Faff watch app keyed on workoutId, Apple-Health HKWorkout import
 * keyed on HKWorkout.uuid, Strava). They share NO id, so identity is
 * physical, not key-based. Single source of both for the write-time merge
 * (merge.ts) AND the read-time volume reader (volume.ts):
 *
 *   isSameRun(a,b)   — same physical run?
 *   pickCanonical(c) — which row is canonical?
 *
 * isTrustworthy(3) finalized against real per-source shapes (RO, 2026-06-05):
 * only apple_watch + strava_webhook are bare-yet-canonical; everything else
 * carries `Z` → covered by (1). NOTE: Strava's start_date_local Z is a
 * mislabel — it's the athlete's local wall time, not UTC (Strava API quirk).
 * isTrustworthy still returns true (the timestamp IS pinnable once corrected),
 * but startUtcMs strips the Z and re-interprets as local PT (2026-06-06).
 */
import { SOURCE_TIER } from './canonical';

export type RunRow = { id: string; user_uuid: string | null; data: any };

// ── trustworthy timestamp · the hinge ─────────────────────────────────────
// A `startLocal` we can pin to an unambiguous instant. A bare wall-clock from
// a raw-device-time source (watch/treadmill/manual) is NEVER trusted — it may
// be PT or UTC (the 2026-05-29 corruption). Explicit markers override source,
// so this self-upgrades as the watch starts sending Z / tz.
const PROVIDER_LOCAL = new Set(['apple_watch', 'strava_webhook']);
const hasOffset = (s: string): boolean => /(?:Z|[+-]\d{2}:?\d{2})$/.test(s || '');
const isIana = (tz: unknown): tz is string =>
  typeof tz === 'string' && /^[A-Za-z]+\/[A-Za-z0-9_+\-]+$/.test(tz);

export function isTrustworthy(row: RunRow): boolean {
  const d = row.data ?? {};
  if (hasOffset(String(d.startLocal ?? ''))) return true;       // (1) explicit Z / offset
  if (isIana(d.timezone)) return true;                          // (2) explicit IANA tz
  if (PROVIDER_LOCAL.has(String(d.source ?? ''))) return true;  // (3) bare but provider-canonical
  return false;
}

// ── field accessors ───────────────────────────────────────────────────────
const localDay = (r: RunRow): string =>
  String(r.data?.date ?? String(r.data?.startLocal ?? '').slice(0, 10));
// #3 · durationSec has MIXED semantics across ingest paths: strava_webhook
// writes ELAPSED here (webhook/route.ts), watch/HK write MOVING/active, and
// pullSync omits it entirely (so the fallback chain reaches movingTimeS). This
// is safe for span-overlap dedup specifically: a longer elapsed span only WIDENS
// [start,end], which makes spansOverlap MORE likely — it can never produce a
// dedup false-negative. Do NOT "normalize" this read without re-checking the
// ±120s duration-equality fallback in isSameRun (used only when a timestamp is
// untrustworthy); tightening durSec there could break legacy-row merging.
const durSec = (r: RunRow): number =>
  Number(r.data?.durationSec ?? r.data?.movingTimeS ?? r.data?.elapsedTimeS ?? 0);
const distMi = (r: RunRow): number => Number(r.data?.distanceMi ?? 0);

// ── startLocal → true UTC instant (DST-aware) ─────────────────────────────
// `Z`/offset → absolute. A bare wall-clock is interpreted in the row's tz
// (explicit `timezone`, else the caller's `defaultTz` — the HK importer
// forces PT and strava_webhook is bare-local), so two trustworthy timestamps
// from different sources (apple_watch bare-PT vs strava `Z`-UTC) compare in
// the SAME frame. One-shot offset lookup is exact except inside the 1h
// DST-transition window (a 2 a.m. run start — vanishingly rare).
//
// 2026-07-06 · phone+watch audit P1-51 · `defaultTz` threads the RUNNER'S
// stored timezone (lib/runtime/runner-tz.ts runnerTimezoneOrPacific) through
// every identity computation, so a non-Pacific runner's bare Strava wall
// times reconstruct to the right UTC instant. DEFAULT_TZ stays
// America/Los_Angeles as the no-caller-tz fallback: every profile with runs
// stored 'America/Los_Angeles' at rollout (RO probe 2026-07-06), so the
// threading is byte-identical for all existing rows. Rows carrying an
// explicit `data.timezone` are unaffected — the row's own tz always wins.
const DEFAULT_TZ = 'America/Los_Angeles';
function tzOffsetMs(utcMs: number, tz: string): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  const p: Record<string, string> = {};
  for (const part of dtf.formatToParts(new Date(utcMs))) p[part.type] = part.value;
  const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  return asUtc - utcMs;
}
function startUtcMs(r: RunRow, defaultTz: string = DEFAULT_TZ): number {
  let s = String(r.data?.startLocal ?? '');
  if (!s) return NaN;
  // Strava's start_date_local carries a spurious Z: it's the athlete's local
  // wall time, not UTC (Strava API quirk — pullSync.ts:134 stores verbatim).
  // Strip before interpreting so the pair maps to the same UTC as a bare-PT row.
  if (String(r.data?.source ?? '') === 'strava' && s.endsWith('Z')) s = s.slice(0, -1);
  if (hasOffset(s)) return Date.parse(s);
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?/.exec(s);
  if (!m) return Date.parse(s);
  const tz = isIana(r.data?.timezone) ? (r.data!.timezone as string) : defaultTz;
  const guess = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] ?? 0));
  return guess - tzOffsetMs(guess, tz);
}
const endUtcMs = (r: RunRow, defaultTz: string = DEFAULT_TZ): number =>
  startUtcMs(r, defaultTz) + durSec(r) * 1000;
function spansOverlap(a: RunRow, b: RunRow, defaultTz: string = DEFAULT_TZ): boolean {
  const sa = startUtcMs(a, defaultTz), sb = startUtcMs(b, defaultTz);
  const ea = endUtcMs(a, defaultTz), eb = endUtcMs(b, defaultTz);
  if (![sa, sb, ea, eb].every(Number.isFinite)) return false;
  return Math.max(sa, sb) < Math.min(ea, eb);
}

// ── same physical run? ────────────────────────────────────────────────────
// Both timestamps trustworthy → the same physical run occupies the same UTC
// span, so time-span OVERLAP is the test (distance/duration NOT required →
// catches the HK↔Strava divergent-distance dupe; no overlap → sequential or
// far-apart distinct runs stay separate). A timestamp untrustworthy (watch raw
// wall-clock, possibly UTC-mislabeled) → start unusable → fall back to the
// shared-HKWorkout fingerprint: tight duration + distance (start ignored →
// TZ-robust, still merges the 05-29 / 05-31 pairs).
export function isSameRun(a: RunRow, b: RunRow, defaultTz: string = DEFAULT_TZ): boolean {
  if (String(a.user_uuid) !== String(b.user_uuid)) return false;
  if (localDay(a) !== localDay(b)) return false;
  if (isTrustworthy(a) && isTrustworthy(b)) return spansOverlap(a, b, defaultTz);
  return Math.abs(durSec(a) - durSec(b)) <= 120 && Math.abs(distMi(a) - distMi(b)) <= 0.05;
}

// ── cluster same-day rows into one group per physical run ─────────────────
export function clusterRuns(rows: RunRow[], defaultTz: string = DEFAULT_TZ): RunRow[][] {
  const clusters: RunRow[][] = [];
  for (const row of rows) {
    let placed = false;
    for (const cluster of clusters) {
      if (cluster.some((member) => isSameRun(member, row, defaultTz))) { cluster.push(row); placed = true; break; }
    }
    if (!placed) clusters.push([row]);
  }
  return clusters;
}

// ── canonical selection · tier→richness, + narrow trustworthy-ts override ──
const tierOf = (r: RunRow): number => SOURCE_TIER[String(r.data?.source ?? '')] ?? 0;
const richness = (r: RunRow): number => {
  const d = r.data ?? {}; let n = 0;
  for (const k of ['avgHr', 'maxHr', 'avgCadence', 'elevGainFt', 'tempF', 'routePolyline']) if (d[k] != null) n++;
  if (Array.isArray(d.splits) && d.splits.length) n++;
  return n;
};
const realSplits = (r: RunRow): number =>
  (Array.isArray(r.data?.splits) ? r.data.splits : []).filter((s: any) =>
    (s?.hr ?? s?.avgHr ?? s?.hrAvgBpm) != null && (s?.pace ?? s?.paceSPerMi ?? s?.paceSecPerMi) != null).length;

export function pickCanonical(cluster: RunRow[]): { canonical: RunRow; losers: RunRow[] } {
  const ranked = [...cluster].sort((a, b) => (tierOf(b) - tierOf(a)) || (richness(b) - richness(a)));
  let canonical = ranked[0];
  // Trustworthy-timestamp preference: when the tier-winner's timestamp is
  // untrustworthy (bare wall-clock that may be UTC-mislabeled), prefer any
  // equivalent trustworthy alternative. "Equivalent" = Δdist ≤ 0.05 mi,
  // Δdur ≤ 120 s, and the alt doesn't have fewer real splits (never demote
  // split coverage). No gap requirement — unlike GUARD-A's ≥4h heuristic,
  // this is the general case: equal runs → trustworthy timestamp wins.
  // David confirmed this rule manually twice (05-29, 06-04) before it was
  // made the engine default.
  if (!isTrustworthy(canonical)) {
    for (const alt of ranked.slice(1)) {
      if (
        isTrustworthy(alt) &&
        Math.abs(distMi(alt) - distMi(canonical)) <= 0.05 &&
        Math.abs(durSec(alt) - durSec(canonical)) <= 120 &&
        realSplits(alt) >= realSplits(canonical)
      ) {
        canonical = alt;
        break;
      }
    }
  }
  // Strava-mislabel GPS-divergence preference: Strava's start_date_local Z is
  // local wall time, not UTC (stripped in startUtcMs above). When the tier-winner
  // has ≥10% more distance than a strava-mislabel alt (source=strava + Z + no IANA
  // tz), the tier-winner GPS-overcounted — GPS drift only inflates distance, never
  // removes it. Prefer the lower (strava) distance as more accurate.
  // Confirmed on 05-26: apple_watch 7.61mi vs strava 5.91mi — strava is ground truth.
  const canonDist = distMi(canonical);
  for (const alt of ranked.slice(1)) {
    const altDist = distMi(alt);
    if (
      String(alt.data?.source ?? '') === 'strava' &&
      /Z$/.test(String(alt.data?.startLocal ?? '')) &&
      !isIana(alt.data?.timezone) &&
      altDist > 0 && canonDist > altDist * 1.10
    ) {
      canonical = alt;
      break;
    }
  }
  return { canonical, losers: cluster.filter((r) => r.id !== canonical.id) };
}

// ── merge-op planning · the write-time invariant as a pure function ─────────
// Given ALL of a day's rows (merged AND unmerged — pass them unfiltered), compute
// the mergedIntoId operations that bring the day to the canonical invariant:
//
//   for every physical-run cluster, EXACTLY ONE row (the canonical) carries no
//   mergedIntoId, and every other row's mergedIntoId === canonical.id.
//
// Deriving the flags purely from the CURRENT clustering is what makes the merge
// self-healing and CYCLE-FREE. The canonical's flag is always cleared first, so
// a loser can never end up pointing at a row that points back — the 2026-06-07
// circular-merge bug (a stale in-memory mergedIntoId re-applied by the ingest
// weather UPDATE after autoMerge had legitimately cleared it, leaving A→B AND
// B→A so neither was canonical and volume.ts zeroed the day). A lone row that
// still carries a flag (its same-day partner was deleted, or a prior unstable
// clustering orphaned it) is a singleton cluster → its stale flag is cleared too.
//
// Pure + idempotent: apply the ops, re-run, and you get zero ops. The SAME
// function drives the runtime absorber (merge.ts:autoMergeForDate) and the
// read-only data-repair audit, so write-time and repair-time can never disagree.
export type MergeOps = {
  clears: string[];                                   // ids to drop mergedIntoId from (canonicals + healed singletons)
  sets: Array<{ id: string; canonicalId: string }>;   // losers to (re)point at their canonical
  absorptions: Array<{ canonicalId: string; loserId: string }>; // loser→canonical field absorption
  clusters: number;
};

export function planMergeOps(rows: RunRow[], defaultTz: string = DEFAULT_TZ): MergeOps {
  const clears: string[] = [];
  const sets: Array<{ id: string; canonicalId: string }> = [];
  const absorptions: Array<{ canonicalId: string; loserId: string }> = [];
  const clustered = clusterRuns(rows, defaultTz);
  for (const cluster of clustered) {
    const { canonical, losers } = pickCanonical(cluster);
    const canonicalId = canonical.id;
    // The canonical must NEVER carry a mergedIntoId. Clearing it unconditionally
    // (cluster-canonical or lone singleton) breaks any inbound cycle and heals
    // orphaned flags. This clear is sequenced before any set below.
    if (canonical.data?.mergedIntoId != null) clears.push(canonicalId);
    for (const loser of losers) {
      if (String(loser.data?.mergedIntoId ?? '') !== canonicalId) {
        sets.push({ id: loser.id, canonicalId });
      }
      absorptions.push({ canonicalId, loserId: loser.id });
    }
  }
  return { clears, sets, absorptions, clusters: clustered.length };
}
