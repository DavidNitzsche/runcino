/**
 * /races — fresh React port of designs/races-v4.html.
 *
 * Sections:
 *   1. Coach strip — race calendar narrative + VDOT anchor card
 *   2. A-race hero — AFC Half wordmark + 3 stats + Path to the Line
 *      + Coach's next move + coach take
 *   3. Upcoming Races — horizontal timeline (race stations)
 *   4. Recent Races — past finishes
 *   5. PRs by distance — 6 PR cards
 *
 * Seed data mirrors designs/races-v4.html for the legacy owner. Real
 * race CRUD wiring is a follow-up.
 */

import { Topbar } from '@/app/components';
import { ConnectBannerIsland } from '../training/ConnectBannerIsland';
import { requireActiveUser } from '@/lib/auth';
import { query } from '@/lib/db';
import { computeAggregateVdot } from '@/lib/compute-vdot';
import { todayISO, userTimezone } from '@/lib/synthetic-plan';
import { computeRaceTrajectory } from '@/lib/race-trajectory';
import { computeRaceProjection } from '@/lib/race-projection';
import { RaceProjectionChart } from './RaceProjectionChart';
import { FALSIFIER_PREFIX } from '@/lib/coach-voice';
import { classifyPR, coachingLineForPR } from '@/lib/pr-coaching';
import './races-v4.css';

function trajectoryColor(state: 'ahead' | 'on-track' | 'behind' | 'collecting-evidence'): string {
  switch (state) {
    case 'ahead':                return '#1f6a21';
    case 'on-track':             return '#0D6E8F';
    case 'behind':               return '#B3450A';
    case 'collecting-evidence':  return 'rgba(13,15,18,.55)';
  }
}

function trajectoryShortLabel(state: 'ahead' | 'on-track' | 'behind' | 'collecting-evidence'): string {
  switch (state) {
    case 'ahead':                return 'AHEAD';
    case 'on-track':             return 'ON TRACK';
    case 'behind':               return 'BEHIND';
    case 'collecting-evidence':  return 'COLLECTING';
  }
}

interface UpcomingRace {
  name: string;
  date: string;
  daysAway: number;
  distanceLabel: string;
  /** Raw distance in miles (used by trajectory + PR-coaching-line). */
  distanceMi: number;
  goal: string;
  priority: 'A' | 'B' | 'C';
  slug?: string;
}
interface RecentRace {
  date: string;
  name: string;
  distanceLabel: string;
  finish: string;
  pace: string;
  priority: 'A' | 'B' | 'C';
  note?: string;
  currentAnchor?: boolean;
}

function fmtMonthDay(iso: string): string {
  const d = new Date(iso + (iso.length === 10 ? 'T12:00:00Z' : ''));
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${months[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
}
function fmtTime(sec: number): string {
  if (!sec || sec <= 0) return '—';
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  if (h > 0) return `${h}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
  return `${m}:${String(s).padStart(2,'0')}`;
}
function fmtPace(sPerMi: number): string {
  if (!sPerMi || sPerMi <= 0) return '—';
  const m = Math.floor(sPerMi / 60);
  const s = sPerMi % 60;
  return `${m}:${String(s).padStart(2, '0')}/mi`;
}

export default async function RacesPage() {
  const auth = await requireActiveUser();

  // Anchor "today" in the user's local tz, then convert to a UTC-
  // midnight ms for date math. Date.now() floats in real time and
  // can land on a different UTC day than the user's local day,
  // making daysAway round differently on /races vs /races/[slug]
  // for the same race date (the 89 vs 90 mismatch).
  const todayLocalISO = todayISO(userTimezone(auth.location));
  const todayMs = Date.parse(todayLocalISO + 'T00:00:00Z');

  // ── 1. Upcoming + saved races from the `races` table ──
  interface RaceRow { slug: string; meta: { name: string; date: string; distanceMi: number; goalDisplay?: string; priority?: 'A'|'B'|'C' }; actual_result: { finishS?: number; paceSPerMi?: number } | null }
  const savedRaces = await query<RaceRow>(
    `SELECT slug, meta, actual_result
       FROM races
      WHERE user_uuid = $1 OR user_uuid IS NULL`,
    [auth.id],
  );

  const upcoming: UpcomingRace[] = savedRaces
    .filter((r) => Date.parse(r.meta.date) >= todayMs)
    .sort((a, b) => Date.parse(a.meta.date) - Date.parse(b.meta.date))
    .map((r) => {
      const daysAway = Math.max(0, Math.round((Date.parse(r.meta.date) - todayMs) / 86400000));
      const dist = r.meta.distanceMi;
      const distLabel = dist >= 26.1 ? `Marathon · ${dist.toFixed(2)} mi`
        : dist >= 13.0 ? `Half Marathon · ${dist.toFixed(2)} mi`
        : dist >= 6.1 ? `10K · ${dist.toFixed(2)} mi`
        : dist >= 3.0 ? `5K · ${dist.toFixed(2)} mi`
        : `${dist.toFixed(1)} mi`;
      return {
        name: r.meta.name,
        date: fmtMonthDay(r.meta.date),
        daysAway,
        distanceLabel: distLabel,
        distanceMi: dist,
        goal: r.meta.goalDisplay || '—',
        priority: r.meta.priority ?? 'A',
        slug: r.slug,
      };
    });

  // ── 2. Recent races: union of races-table finishes + strava-tagged Race activities ──
  interface RaceActivityRow { id: string; data: { name?: string; startLocal?: string; date?: string; distanceMi?: number; movingTimeS?: number; paceSPerMi?: number; workoutType?: number; canonicalFinishS?: number | null; canonicalDistanceMi?: number | null; canonicalLabel?: string | null } }
  const raceActivities = await query<RaceActivityRow>(
    `SELECT id::text AS id, data
       FROM strava_activities
      WHERE (user_uuid = $1 OR user_uuid IS NULL)
        AND (data->>'workoutType')::int = 1
      ORDER BY COALESCE(data->>'date', LEFT(data->>'startLocal', 10)) DESC
      LIMIT 50`,
    [auth.id],
  );

  const recent: RecentRace[] = [
    // First: races-table entries that have an actualResult (the user logged a finish)
    ...savedRaces
      .filter((r) => r.actual_result && Date.parse(r.meta.date) < todayMs)
      .map((r): RecentRace => {
        const dist = r.meta.distanceMi;
        const finishS = Number(r.actual_result?.finishS) || 0;
        const paceSec = Number(r.actual_result?.paceSPerMi) || (finishS > 0 && dist > 0 ? Math.round(finishS / dist) : 0);
        const distLabel = dist >= 26.1 ? 'Marathon'
          : dist >= 13.0 ? 'Half Marathon'
          : dist >= 6.1 ? '10K'
          : dist >= 3.0 ? '5K'
          : `${dist.toFixed(1)} mi`;
        return {
          date: r.meta.date,
          name: r.meta.name,
          distanceLabel: distLabel,
          finish: fmtTime(finishS),
          pace: fmtPace(paceSec),
          priority: r.meta.priority ?? 'A',
        };
      }),
    // Then: Strava activities tagged as Race that aren't already in saved races (best-effort dedupe by date)
    ...raceActivities.map((a): RecentRace => {
      const dist = Number(a.data.distanceMi) || 0;
      const finishS = Number(a.data.canonicalFinishS ?? a.data.movingTimeS) || 0;
      const canonMi = Number(a.data.canonicalDistanceMi) || dist;
      const paceSec = canonMi > 0 ? Math.round(finishS / canonMi) : 0;
      const distLabel = a.data.canonicalLabel
        || (dist >= 26.1 ? 'Marathon'
          : dist >= 13.0 ? 'Half Marathon'
          : dist >= 6.1 ? '10K'
          : dist >= 3.0 ? '5K'
          : `${dist.toFixed(1)} mi`);
      return {
        date: a.data.date || (a.data.startLocal || '').slice(0, 10),
        name: a.data.name || 'Race',
        distanceLabel: distLabel,
        finish: fmtTime(finishS),
        pace: fmtPace(paceSec),
        priority: 'A',
      };
    }),
  ]
    // De-duplicate: if the same date appears in saved races + activities, keep the saved-race entry
    .filter((r, i, arr) => arr.findIndex((x) => x.date === r.date) === i)
    .sort((a, b) => Date.parse(b.date) - Date.parse(a.date))
    .slice(0, 12);

  const aRace = upcoming.find((r) => r.priority === 'A');

  // V3 · Race trajectory directional indicator (only when an A-race exists).
  // Reads L7 signal evidence layer (Signal 1 + 2 + 3). Conservative
  // gating: "ahead" needs ≥2 corroborating UP signals; "on-track" is
  // the 1-signal-up state; "behind" fires on any DOWN signal;
  // "collecting-evidence" when signals are silent OR disagree OR
  // insufficient data is available.
  const trajectory = aRace ? await computeRaceTrajectory(auth.id, new Date()).catch(() => null) : null;

  // Aggregate VDOT from this year's Strava history (best-effort per
  // canonical distance, recency-weighted, top 3 averaged). Coach uses
  // this as the STARTING POINT — specific training runs nudge it
  // forward from here as the cycle progresses.
  const vdotAgg = await computeAggregateVdot(auth.id);

  // C9 · Race projection chart · two trajectory lines (maintain + plan)
  // across weeks-to-race. Reads current VDOT + goal time, computes
  // weekly interpolation. Surface-only.
  const aRaceGoalFinishS = (() => {
    if (!aRace) return 0;
    const m = aRace.goal?.match(/^(\d{1,2}):(\d{2}):(\d{2})$/);
    if (m) return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
    const m2 = aRace.goal?.match(/^(\d{1,2}):(\d{2})$/);
    if (m2) return Number(m2[1]) * 60 + Number(m2[2]);
    return 0;
  })();
  const raceProjection = (aRace && vdotAgg && aRaceGoalFinishS > 0)
    ? computeRaceProjection(vdotAgg.value, aRace.distanceMi, aRaceGoalFinishS, Math.ceil(aRace.daysAway / 7))
    : null;

  // ── 3. PRs by canonical distance — races first, Strava fallback ──
  //
  // L5 fix (David 2026-05-19 round 2): the prior implementation read
  // ONLY from strava_activities.canonicalLabel and showed "No PRs"
  // even with 4 curated races on file. Same source-of-truth pattern
  // bug as the phantom 5K and missing Sombrero before strict Option-B.
  //
  // New order per David's spec:
  //   1. races.actual_result.finishS at canonical distance → race PR
  //   2. If no race at that distance, fastest Strava canonical best →
  //      Strava PR (labeled "training effort")
  //   3. Visual distinction: race PRs authoritative, Strava PRs
  //      provisional with "race this distance to lock it in"
  //
  // Strava PRs do NOT enter aggregate VDOT — that contract stays
  // intact in compute-vdot (strict Option-B). The PR card surfaces
  // them as fitness context only.
  function inferCanonicalLocal(distMi: number): { label: string; canonicalMi: number } | null {
    if (Math.abs(distMi - 3.107) < 0.155) return { label: '5K', canonicalMi: 3.107 };
    if (Math.abs(distMi - 6.214) < 0.31)  return { label: '10K', canonicalMi: 6.214 };
    if (Math.abs(distMi - 9.32)  < 0.47)  return { label: '15K', canonicalMi: 9.32 };
    if (Math.abs(distMi - 13.109) < 0.55) return { label: 'Half', canonicalMi: 13.109 };
    if (Math.abs(distMi - 26.219) < 1.05) return { label: 'Marathon', canonicalMi: 26.219 };
    return null;
  }

  interface RacePrRow { distance_mi: string; finish_s: string; date: string; name: string; slug: string }
  const racePrRows = await query<RacePrRow>(
    `SELECT
        COALESCE(meta->>'distanceMi', meta->>'distance_mi')::NUMERIC::TEXT AS distance_mi,
        (actual_result->>'finishS')::NUMERIC::TEXT AS finish_s,
        COALESCE(meta->>'date', '') AS date,
        COALESCE(meta->>'name', '') AS name,
        slug
       FROM races
      WHERE (user_uuid = $1 OR user_uuid IS NULL)
        AND actual_result IS NOT NULL
        AND (actual_result->>'finishS')::NUMERIC > 0`,
    [auth.id],
  );

  type PR = {
    distance: string;
    canonicalLabel: string;
    time: string;
    when: string;
    /** Raw ISO date (YYYY-MM-DD) for age-based coaching-line copy. */
    rawDate: string;
    source: 'race' | 'strava';
    raceName?: string;
    finishS: number;
    /** C5 · per-PR coaching line based on age + source + distance match. */
    coachingLine?: string;
  };
  const racePRs = new Map<string, PR>();
  for (const r of racePrRows) {
    const distMi = Number(r.distance_mi);
    const finishS = Number(r.finish_s);
    if (!Number.isFinite(distMi) || !Number.isFinite(finishS) || finishS <= 0) continue;
    const matched = inferCanonicalLocal(distMi);
    if (!matched) continue;
    const prior = racePRs.get(matched.label);
    if (!prior || finishS < prior.finishS) {
      racePRs.set(matched.label, {
        distance: matched.label === 'Half' ? '13.1 (HM)' : matched.label === 'Marathon' ? '26.2' : matched.label,
        canonicalLabel: matched.label,
        time: fmtTime(finishS),
        when: r.date ? fmtMonthDay(r.date) : '',
        rawDate: r.date ?? '',
        source: 'race',
        raceName: r.name || undefined,
        finishS,
      });
    }
  }

  // Strava fallback — only for canonical distances NOT covered by a race PR
  interface BestRow { canonical_label: string; finish_s: number; date: string }
  const bestRows = await query<BestRow>(
    `WITH bests AS (
       SELECT data->>'canonicalLabel'                    AS canonical_label,
              (data->>'canonicalFinishS')::NUMERIC       AS finish_s,
              COALESCE(data->>'date', LEFT(data->>'startLocal', 10)) AS date,
              ROW_NUMBER() OVER (PARTITION BY data->>'canonicalLabel'
                                 ORDER BY (data->>'canonicalFinishS')::NUMERIC ASC) AS rn
         FROM strava_activities
        WHERE (user_uuid = $1 OR user_uuid IS NULL)
          AND data->>'canonicalLabel' IS NOT NULL
          AND (data->>'canonicalFinishS')::NUMERIC > 0
     )
     SELECT canonical_label, finish_s::int AS finish_s, date
       FROM bests WHERE rn = 1
       ORDER BY canonical_label`,
    [auth.id],
  );

  const stravaPRs: PR[] = [];
  for (const b of bestRows) {
    if (racePRs.has(b.canonical_label)) continue;  // race PR wins
    stravaPRs.push({
      distance: b.canonical_label === 'Half' ? '13.1 (HM)' : b.canonical_label === 'Marathon' ? '26.2' : b.canonical_label,
      canonicalLabel: b.canonical_label,
      time: fmtTime(b.finish_s),
      when: b.date ? fmtMonthDay(b.date) : '',
      rawDate: b.date ?? '',
      source: 'strava',
      finishS: b.finish_s,
    });
  }

  // Combine + sort by canonical distance order (5K → Marathon).
  const distanceOrder: Record<string, number> = { '5K': 0, '10K': 1, '15K': 2, 'Half': 3, 'Marathon': 4 };
  const PRs: PR[] = [...racePRs.values(), ...stravaPRs]
    .sort((a, b) => (distanceOrder[a.canonicalLabel] ?? 99) - (distanceOrder[b.canonicalLabel] ?? 99));

  // C5 · Per-PR coaching lines — classification logic + canonical
  // strings live in lib/pr-coaching.ts (consolidated during V6).
  // This loop maps each PR to its role and pulls the canonical line.
  const goalCanonical = aRace ? inferCanonicalLocal(aRace.distanceMi)?.label : null;
  const todayMsForPr = Date.parse(todayLocalISO + 'T12:00:00Z');
  for (const pr of PRs) {
    const prMs = pr.rawDate ? Date.parse(pr.rawDate + 'T12:00:00Z') : null;
    const ageDays = prMs ? Math.round((todayMsForPr - prMs) / 86_400_000) : null;
    const isGoalDistance = !!goalCanonical && pr.canonicalLabel === goalCanonical;
    const role = classifyPR({ source: pr.source, isGoalDistance, ageDays });
    pr.coachingLine = coachingLineForPR(role);
  }

  return (
    <div className="races-v4-page">
      <Topbar activeTab="races" showAdmin={auth.is_admin} />
      <ConnectBannerIsland />

      <div className="page">

        {/* ── COACH STRIP ── */}
        <div className="coach-strip">
          <div className="coach-left">
            <div className="coach-label">
              <span className="dot-green"></span>
              COACH · RACE CALENDAR · WHAT&apos;S NEXT
            </div>
            <p className="coach-briefing">
              {aRace ? (
                <>
                  <strong>{aRace.name} is {aRace.daysAway} days out</strong> — your A-race for this cycle and the only one that counts on the fitness ledger. You&apos;re in week 1 of 14, banking base miles. First half-pace work lands at week 5 — that&apos;s where the <strong>{aRace.goal} starts to feel real</strong>. No tune-up B-race on the calendar yet; we&apos;ll slot one around week 10 if you want a dress rehearsal.
                </>
              ) : recent.length > 0 ? (
                /* E3 · no-upcoming-race + has-past-races state.
                   Acknowledges the most recent finish and prompts the
                   runner to anchor the next training cycle. */
                <>
                  Your most recent race was <strong>{recent[0].name} on {recent[0].date}</strong>. Without a new A-race on the calendar, training defaults to maintaining current fitness — no progression, no taper math, no race-specific work.{' '}
                  <strong>Set a new goal race to anchor your next cycle.</strong>{' '}
                  <a href="/races/add" style={{ color: 'var(--orange, #E85D26)', textDecoration: 'underline' }}>Add a race →</a>
                </>
              ) : (
                /* E3 · no-upcoming-race + no-past-races state.
                   Cold-start prompt with clear next action. */
                <>
                  <strong>No upcoming race set.</strong> Plan defaults to maintaining fitness — aerobic base, no progression toward a specific finish line, no race-specific intensity work.{' '}
                  <strong>Set a goal race to anchor training.</strong>{' '}
                  <a href="/races/add" style={{ color: 'var(--orange, #E85D26)', textDecoration: 'underline' }}>Add a race →</a>
                </>
              )}
            </p>
          </div>

          <div className="vdot-anchor-card">
            <div className="vdot-anchor-label">Your fitness score</div>
            <div className="vdot-anchor-row">
              <span
                className="vdot-anchor-num"
                style={{ color: vdotAgg ? '#0D0F12' : 'rgba(13,15,18,.32)' }}
              >
                {vdotAgg ? vdotAgg.value.toFixed(1) : '—'}
              </span>
            </div>
            <div className="vdot-anchor-fresh">
              <span
                className="vdot-anchor-fresh-dot"
                style={{ background: vdotAgg ? '#2CA82F' : 'rgba(13,15,18,.25)' }}
              />
              <span
                className="vdot-anchor-fresh-text"
                style={{ color: 'rgba(13,15,18,.55)' }}
              >
                {vdotAgg
                  ? `Aggregate · ${vdotAgg.sourceCount} ${vdotAgg.sourceCount === 1 ? 'effort' : 'efforts'} (${vdotAgg.windowLabel})`
                  : 'No data · sync Strava or log a race'}
              </span>
            </div>
          </div>
        </div>

        {/* ── ADD RACE CTA ── */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', margin: '12px 0 8px' }}>
          <a
            href="/races/new"
            className="add-race-cta"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8,
              fontFamily: 'Oswald, sans-serif',
              fontWeight: 600,
              fontSize: 11,
              letterSpacing: 1.6,
              textTransform: 'uppercase',
              padding: '10px 16px',
              background: '#0D0F12',
              color: '#fff',
              borderRadius: 8,
              textDecoration: 'none',
            }}
          >
            <span style={{ fontSize: 16, lineHeight: 1 }}>+</span> Add a race (GPX)
          </a>
        </div>

        {/* ── A-RACE HERO ── */}
        {aRace && (() => {
          // Build a short Bebas title from the race name initials when 3+ words,
          // otherwise just use the name. AFC HALF for "Americas Finest City" etc.
          const words = aRace.name.split(/\s+/);
          const titleText = words.length >= 3
            ? words.map((w) => w[0]).join('').toUpperCase().slice(0, 4)
            : aRace.name.toUpperCase();
          const distSub = aRace.distanceLabel.includes('Half') ? 'HALF'
            : aRace.distanceLabel.includes('Marathon') ? 'MARATHON'
            : aRace.distanceLabel.includes('10K') ? '10K'
            : aRace.distanceLabel.includes('5K') ? '5K' : '';
          const HeroWrap = aRace.slug
            ? ({ children }: { children: React.ReactNode }) => <a href={`/races/${aRace.slug}`} className="a-race-card" style={{ textDecoration: 'none', color: 'inherit', cursor: 'pointer' }}>{children}</a>
            : ({ children }: { children: React.ReactNode }) => <div className="a-race-card">{children}</div>;
          return (
          <HeroWrap>
            <div className="a-race-left">
              <div className="a-race-eyebrow">A-RACE · GOAL TIME {aRace.goal}{aRace.slug && ' · CLICK FOR FULL PLAN'}</div>
              <div className="a-race-title">{titleText}{distSub && <><br />{distSub}</>}</div>
              <div className="a-race-sub">{aRace.name} · {aRace.date.replace(/, \d{4}$/, '')}</div>
              <p className="a-race-explainer">
                The full 14-week plan points here. Once a recent race finish is logged we&apos;ll
                show your current fitness, the gap to {aRace.goal}, and the feasibility read.
              </p>

              <div className="path-stats">
                {raceProjection ? (() => {
                  // Projected finish at current VDOT (maintain line is flat;
                  // every point shares the same maintainFinishS).
                  const maintainFinishS = raceProjection.points[0]?.maintainFinishS ?? 0;
                  // Gap to goal: positive = current projection is slower than
                  // the goal (work to do); ≤0 = already at/under goal.
                  const gapS = maintainFinishS - raceProjection.goalFinishS;
                  const onTrack = gapS <= 0;
                  return (
                    <>
                      <div className="path-stat">
                        <div className="path-stat-label">Current Fitness</div>
                        <div className="path-stat-value">{maintainFinishS > 0 ? fmtTime(maintainFinishS) : '—'}</div>
                        <div className="path-stat-sub">At your current fitness score of {raceProjection.currentVdot.toFixed(1)}</div>
                      </div>
                      <div className="path-stat">
                        <div className="path-stat-label">Gap to Goal</div>
                        <div className="path-stat-value" style={{ color: onTrack ? '#1f6a21' : undefined }}>
                          {onTrack ? `−${fmtTime(Math.abs(gapS))}` : `+${fmtTime(gapS)}`}
                        </div>
                        <div className="path-stat-sub">{onTrack ? 'Ahead of goal' : 'Behind goal'}</div>
                      </div>
                    </>
                  );
                })() : (
                  <>
                    <div className="path-stat">
                      <div className="path-stat-label">Current Fitness</div>
                      <div className="path-stat-value" style={{ color: 'rgba(13,15,18,.32)' }}>—</div>
                      <div className="path-stat-sub">No data</div>
                    </div>
                    <div className="path-stat">
                      <div className="path-stat-label">Gap to Goal</div>
                      <div className="path-stat-value" style={{ color: 'rgba(13,15,18,.32)' }}>—</div>
                      <div className="path-stat-sub">No data</div>
                    </div>
                  </>
                )}
                {/* V3 · Trajectory directional indicator from L7 signals.
                    Replaces the "Feasibility · No data" stub when L7
                    evidence is available. Falls back to silent — the
                    runner sees the same "No data" placeholder until
                    signals + verdict accumulate enough to make a call.
                    Falsifier rendered INLINE under the headline (not as
                    a hover tooltip) per Rule 2 + lib/coach-voice.ts. */}
                {trajectory ? (
                  <div className="path-stat" id="trajectory-read">
                    <div className="path-stat-label">Trajectory</div>
                    <div className="path-stat-value" style={{ color: trajectoryColor(trajectory.state), fontSize: 22 }}>
                      {trajectoryShortLabel(trajectory.state)}
                    </div>
                    <div className="path-stat-sub" style={{ fontSize: 11 }}>
                      {trajectory.headline}
                    </div>
                    <div className="path-stat-falsifier" style={{
                      fontSize: 10,
                      lineHeight: 1.4,
                      marginTop: 6,
                      color: 'rgba(13,15,18,.55)',
                    }}>
                      <strong style={{ color: 'rgba(13,15,18,.75)', fontStyle: 'normal' }}>{FALSIFIER_PREFIX}</strong>{' '}
                      {trajectory.falsifier}
                    </div>
                  </div>
                ) : (
                  <div className="path-stat">
                    <div className="path-stat-label">Trajectory</div>
                    <div className="path-stat-value" style={{ color: 'rgba(13,15,18,.32)' }}>—</div>
                    <div className="path-stat-sub">No data</div>
                  </div>
                )}
              </div>
              {/* C9 · Race projection chart · two trajectories
                  (maintain at current VDOT, plan trending toward goal)
                  with goal line as horizontal reference. */}
              {raceProjection && (
                <RaceProjectionChart projection={raceProjection} />
              )}
            </div>

            <div className="a-race-right">
              <div>
                <div className="path-section-label">Path to the Line</div>
                <div className="path-progress">
                  <div className="path-progress-bar">
                    <div className="path-progress-fill" style={{ width: '7%' }}></div>
                  </div>
                  <div className="path-progress-meta">
                    <span><strong>Week 1</strong> of 14 · Base phase</span>
                    <span>7%</span>
                  </div>
                </div>

                <div style={{ marginTop: 28 }}>
                  <div className="path-section-label">Coach&apos;s Next Move</div>
                  <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 14, lineHeight: 1.55 }}>
                    Build the aerobic base for four weeks. First real threshold dose lands in
                    <strong> 24 days</strong> when the Build phase opens. That&apos;s where the half-marathon
                    pace starts to feel sustainable.
                  </p>
                </div>
              </div>

              <p className="coach-take">
                <strong>Trust the easy.</strong> The race is won in the workouts you didn&apos;t try to win.
              </p>
            </div>
          </HeroWrap>
          );
        })()}

        {/* ── UPCOMING RACES TIMELINE ── */}
        <div className="card">
          <div className="card-header">
            <div className="card-title-group">
              <div className="card-title">Upcoming Races</div>
            </div>
          </div>

          <div className="races-timeline">
            {upcoming.length === 0 ? (
              <div style={{ padding: '40px 28px', textAlign: 'center', fontFamily: 'Inter, sans-serif', fontSize: 13, color: 'rgba(13,15,18,.55)' }}>
                No upcoming races on the calendar.
              </div>
            ) : (
              <div className="races-timeline-track-area">
                <div className="races-timeline-track-line"></div>
                {/* "TODAY" marker at the left edge */}
                <div className="races-timeline-now">
                  <div className="races-timeline-now-dot" />
                  <div className="races-timeline-now-info">
                    <div className="races-timeline-now-label">Today</div>
                  </div>
                </div>
                {upcoming.map((race, i) => {
                  const maxDays = Math.max(...upcoming.map((r) => r.daysAway), 1);
                  const pos = (race.daysAway / maxDays) * 100;
                  const above = i % 2 === 0;
                  const isLast = i === upcoming.length - 1 && pos > 90;
                  const priorityClass =
                    race.priority === 'A' ? 'a' :
                    race.priority === 'B' ? 'b' : 'c';
                  const stationCls = [
                    'races-timeline-station',
                    above ? 'placement-above' : 'placement-below',
                    `priority-${priorityClass}`,
                    isLast ? 'is-last' : '',
                  ].filter(Boolean).join(' ');
                  const Wrapper = race.slug
                    ? ({ children }: { children: React.ReactNode }) => <a href={`/races/${race.slug}`} className={stationCls} style={{ left: `${pos}%`, textDecoration: 'none', color: 'inherit' }}>{children}</a>
                    : ({ children }: { children: React.ReactNode }) => <div className={stationCls} style={{ left: `${pos}%` }}>{children}</div>;
                  return (
                    <Wrapper key={`${race.name}-${race.date}`}>
                      <div className={`races-timeline-tag ${priorityClass}`}>{race.priority}</div>
                      <div className="races-timeline-station-info">
                        <div className="races-timeline-date">{race.date}</div>
                        <div className="races-timeline-name">{race.name}</div>
                        <div className="races-timeline-pace">{race.distanceLabel}</div>
                        <div className="races-timeline-goal">{race.goal !== '—' ? race.goal : ''}</div>
                        <div className="races-timeline-away">{race.daysAway}d away</div>
                      </div>
                    </Wrapper>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* ── RECENT RACES ── */}
        <div className="card">
          <div className="card-header">
            <div className="card-title-group">
              <div className="card-title">Recent Races</div>
            </div>
          </div>

          {recent.length === 0 ? (
            <div style={{ padding: '40px 28px', textAlign: 'center', fontFamily: 'Inter, sans-serif', fontSize: 13, color: 'rgba(13,15,18,.55)' }}>
              No past races logged. Add a recent race finish to set your fitness score.
            </div>
          ) : (
            <div className="races-recent-list">
              {recent.map((r) => (
                <div key={`${r.date}-${r.name}`} className={`races-recent-row ${r.currentAnchor ? 'is-anchor' : ''}`}>
                  <div className="races-recent-date">{r.date.slice(5).replace('-', '/')}</div>
                  <span className={`races-recent-priority p-${r.priority.toLowerCase()}`}>{r.priority}</span>
                  <div className="races-recent-info">
                    <div className="races-recent-name">{r.name}</div>
                    <div className="races-recent-meta">{r.distanceLabel}{r.note ? ` · ${r.note}` : ''}</div>
                  </div>
                  <div className="races-recent-time">{r.finish}</div>
                  <div className="races-recent-pace">{r.pace}</div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ── PRs ── */}
        <div className="card" id="personal-records">
          <div className="card-header">
            <div className="card-title-group">
              <div className="card-title">Personal Records</div>
              <div className="card-sub">
                Your bests by distance — race results are the real thing; training efforts are noted as context.
              </div>
            </div>
          </div>

          {PRs.length === 0 ? (
            <div style={{ padding: '40px 28px', textAlign: 'center', fontFamily: 'Inter, sans-serif', fontSize: 13, color: 'rgba(13,15,18,.55)' }}>
              No PRs yet — log past races to populate.
            </div>
          ) : (
            <div className="races-pr-grid">
              {PRs.map((pr) => (
                <div
                  key={pr.distance}
                  className={`pr-cell ${pr.source === 'race' ? 'is-current' : ''}`}
                  style={pr.source === 'strava' ? { opacity: 0.78 } : undefined}
                >
                  <div className="pr-distance">{pr.distance}</div>
                  <div className="pr-time">{pr.time}</div>
                  <div className="pr-meta">
                    {pr.when}
                    {pr.source === 'race' && pr.raceName && (
                      <> · {pr.raceName}</>
                    )}
                  </div>
                  {pr.source === 'race' ? (
                    <div
                      style={{
                        marginTop: 6,
                        fontFamily: 'Oswald, sans-serif',
                        fontSize: 9,
                        letterSpacing: 1.2,
                        color: '#1f6a21',
                        background: 'rgba(44,168,47,.10)',
                        padding: '2px 6px',
                        borderRadius: 4,
                        display: 'inline-block',
                        textTransform: 'uppercase',
                        fontWeight: 700,
                      }}
                    >
                      ✓ Chip time
                    </div>
                  ) : (
                    <div
                      style={{
                        marginTop: 6,
                        fontFamily: 'Oswald, sans-serif',
                        fontSize: 9,
                        letterSpacing: 1.2,
                        color: '#b3450a',
                        background: 'rgba(252,82,0,.08)',
                        padding: '2px 6px',
                        borderRadius: 4,
                        display: 'inline-block',
                        textTransform: 'uppercase',
                        fontWeight: 700,
                      }}
                    >
                      Training effort · race to lock in
                    </div>
                  )}
                  {/* C5 · per-PR coaching line based on age + source +
                      distance match to active goal race. */}
                  {pr.coachingLine && (
                    <div
                      style={{
                        marginTop: 8,
                        fontFamily: 'Inter, sans-serif',
                        fontSize: 11,
                        lineHeight: 1.45,
                        color: 'rgba(13,15,18,.55)',
                        fontStyle: 'italic',
                      }}
                    >
                      {pr.coachingLine}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

      </div>
    </div>
  );
}
