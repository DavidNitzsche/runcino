'use client';

/**
 * /season — strategic race calendar.
 *
 * Mission: show the runner's season as an arc, not a list.
 *
 * Surfaces:
 *   - Horizontal timeline of upcoming races (12-month forward view)
 *   - Phase blocks between races (BUILD / TAPER / POST_RACE / GAP)
 *   - Conflict warnings when races violate MULTI_RACE_CADENCE
 *     spacing rules (Research/00b)
 *   - A/B/C priority tagging
 *   - Annual race-load summary (counts vs doctrine recommendations)
 *
 * Hub dependencies: hub.races (all upcoming + recent), MULTI_RACE_CADENCE,
 * POST_RACE_BY_DISTANCE doctrine.
 */

import Link from 'next/link';
import { Caption, Nav } from '../../components/nav';
import { HubProvider, useHub } from '../../lib/hub-provider';
import { MULTI_RACE_CADENCE, POST_RACE_BY_DISTANCE } from '../../coach/doctrine';
import { postRaceDistanceBand } from '../../lib/recovery-distance';
import type { SavedRace } from '../../lib/storage-types';

export default function SeasonPage() {
  return (
    <HubProvider>
      <SeasonPageInner />
    </HubProvider>
  );
}

function SeasonPageInner() {
  const hub = useHub();
  if (!hub) {
    return (
      <Shell>
        <div style={{ minHeight: 480 }} aria-busy="true" />
      </Shell>
    );
  }

  const todayISO = hub.meta.cacheDate;
  const todayMs = Date.parse(todayISO + 'T12:00:00Z');
  const oneYearOutMs = todayMs + 365 * 86_400_000;
  const sixMonthsAgoMs = todayMs - 180 * 86_400_000;

  // Pull races within the visible window (6mo back → 12mo forward).
  // Sorted chronologically.
  const inWindow = hub.races
    .filter(r => {
      const t = Date.parse(r.meta.date + 'T12:00:00Z');
      return t >= sixMonthsAgoMs && t <= oneYearOutMs;
    })
    .sort((a, b) => Date.parse(a.meta.date) - Date.parse(b.meta.date));

  const upcoming = inWindow.filter(r => Date.parse(r.meta.date + 'T12:00:00Z') >= todayMs);
  const past = inWindow.filter(r => Date.parse(r.meta.date + 'T12:00:00Z') < todayMs);

  // Build the segment list: between every pair of races, what's the
  // training phase? Plus pre-first and post-last segments.
  const segments = buildSegments(inWindow, todayISO);

  // Conflict detection: pairs of races too close per MULTI_RACE_CADENCE.
  // Only alerts on conflicts involving at least one FUTURE race —
  // surfacing a tight gap between two past races is not actionable
  // (the runner already lived through it). Pairs that span past→future
  // still alert because the past race's recovery affects the upcoming one.
  const conflicts = detectConflicts(inWindow).filter(c => {
    const aIsFuture = c.a.meta.date >= todayISO;
    const bIsFuture = c.b.meta.date >= todayISO;
    return aIsFuture || bIsFuture;
  });

  // Annual stats — race counts in the trailing 12 months.
  const trailing12 = hub.races.filter(r => {
    const t = Date.parse(r.meta.date + 'T12:00:00Z');
    return t >= todayMs - 365 * 86_400_000 && t <= todayMs + 365 * 86_400_000;
  });
  const aCount = trailing12.filter(r => (r.meta.priority ?? 'C') === 'A').length;
  const bCount = trailing12.filter(r => r.meta.priority === 'B').length;
  const cCount = trailing12.filter(r => r.meta.priority === 'C').length;
  const marathonCount = trailing12.filter(r => r.meta.distanceMi >= 22).length;
  const halfCount = trailing12.filter(r => r.meta.distanceMi >= 11 && r.meta.distanceMi < 22).length;

  return (
    <Shell>
      <div style={{ marginBottom: 18 }}>
        <div style={{ fontFamily: 'var(--font-data)', fontSize: 10, letterSpacing: '1.6px', color: 'var(--color-attention)', fontWeight: 700 }}>
          STRATEGIC SEASON
        </div>
        <h1 style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 36, letterSpacing: '-.005em', margin: '6px 0 4px' }}>
          The arc of your year
        </h1>
        <div style={{ fontSize: 13, color: 'var(--color-t2)', maxWidth: 640, lineHeight: 1.55 }}>
          Each race is a chapter; the spaces between are the build. The page surfaces season shape — phases, gaps, conflicts — so a multi-race year reads as a strategy, not a list.
        </div>
      </div>

      <Timeline races={inWindow} todayISO={todayISO} segments={segments} />

      {/* Priority overload callout — when EVERY race is marked A,
          the runner has no realistic build cycle. Doctrine caps A-races
          at 2/year. This is the most actionable insight on /season,
          so it deserves a banner near the top, not a small stat. */}
      {aCount > MULTI_RACE_CADENCE.value.aRaceMaxPerYear && (
        <div className="tile" style={{
          marginTop: 14, padding: '16px 20px',
          borderLeft: '3px solid var(--color-warning)',
          background: 'rgba(252, 77, 84, 0.06)',
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
            <div>
              <div className="tile-sub" style={{ color: 'var(--color-warning)' }}>
                Priority overload · {aCount} A-races flagged in 12 months (max {MULTI_RACE_CADENCE.value.aRaceMaxPerYear})
              </div>
              <div style={{ fontFamily: 'var(--font-display)', fontSize: 17, fontWeight: 700, color: 'var(--color-t0)', marginTop: 4, lineHeight: 1.3 }}>
                Every race is marked priority A. That makes none of them priority A.
              </div>
            </div>
          </div>
          <div style={{ fontSize: 13, color: 'var(--color-t1)', lineHeight: 1.55, marginTop: 8 }}>
            Max 2 A-races per year (full taper, peak day, full recovery). Recommended split: 2 A-races + {MULTI_RACE_CADENCE.value.bRacePerYear.low}-{MULTI_RACE_CADENCE.value.bRacePerYear.high} B-races (1-week taper, 60-70% of A-recovery) + C-races as workouts. Re-prioritize your races on the index page so the engine knows where to peak you and where to ride through.
          </div>
        </div>
      )}

      {conflicts.length > 0 && <ConflictsCard conflicts={conflicts} />}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 14, marginTop: 14 }}>
        <SeasonStatsCard
          aCount={aCount} bCount={bCount} cCount={cCount}
          marathonCount={marathonCount} halfCount={halfCount}
        />
        <UpcomingListCard upcoming={upcoming} todayISO={todayISO} />
        {past.length > 0 && <RecentListCard past={past} todayISO={todayISO} />}
      </div>

      <Footnote />
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <>
      <Caption left="Runcino · season" right="STRATEGIC ARC" />
      <div className="stage">
        <Nav active="season" />
        <div className="body">{children}</div>
      </div>
    </>
  );
}

interface Segment {
  startISO: string;
  endISO: string;
  kind: 'POST_RACE' | 'BUILD' | 'TAPER' | 'GAP' | 'PAST';
  raceContext: string | null;
}

function buildSegments(races: SavedRace[], todayISO: string): Segment[] {
  if (races.length === 0) return [];
  const segs: Segment[] = [];
  for (let i = 0; i < races.length; i++) {
    const r = races[i];
    const next = races[i + 1] ?? null;

    // Post-race recovery window after this race (up to recoveryDaysHi).
    const postRaceDays = POST_RACE_BY_DISTANCE.value[postRaceDistanceBand(r.meta.distanceMi)].totalRecoveryDaysNoQualityHigh;
    const postRaceEnd = isoOffset(r.meta.date, postRaceDays);

    if (r.meta.date >= todayISO) {
      // Future race: taper window in the 14d before, build before that.
      const taperStart = isoOffset(r.meta.date, -14);
      const buildStart = i === 0 ? todayISO : segs[segs.length - 1]?.endISO ?? todayISO;
      if (buildStart < taperStart) {
        segs.push({ startISO: buildStart, endISO: taperStart, kind: 'BUILD', raceContext: r.meta.name });
      }
      segs.push({ startISO: taperStart, endISO: r.meta.date, kind: 'TAPER', raceContext: r.meta.name });
    } else {
      segs.push({ startISO: i === 0 ? '' : segs[segs.length - 1]?.endISO ?? '', endISO: r.meta.date, kind: 'PAST', raceContext: r.meta.name });
    }

    // Post-race window after this race
    if (next) {
      // Cap the post-race window at when the next race's taper begins.
      const nextTaperStart = isoOffset(next.meta.date, -14);
      const cappedPostEnd = postRaceEnd < nextTaperStart ? postRaceEnd : nextTaperStart;
      segs.push({ startISO: r.meta.date, endISO: cappedPostEnd, kind: 'POST_RACE', raceContext: r.meta.name });
      // Any gap remaining between post-race end and next taper is BUILD
      if (cappedPostEnd < nextTaperStart) {
        segs.push({ startISO: cappedPostEnd, endISO: nextTaperStart, kind: 'BUILD', raceContext: next.meta.name });
      }
    } else {
      segs.push({ startISO: r.meta.date, endISO: postRaceEnd, kind: 'POST_RACE', raceContext: r.meta.name });
      // Open gap after the last race
      const horizon = isoOffset(todayISO, 365);
      if (postRaceEnd < horizon) {
        segs.push({ startISO: postRaceEnd, endISO: horizon, kind: 'GAP', raceContext: null });
      }
    }
  }
  return segs;
}

function detectConflicts(races: SavedRace[]): Array<{ a: SavedRace; b: SavedRace; daysBetween: number; severity: 'risk' | 'warn'; message: string }> {
  const out: Array<{ a: SavedRace; b: SavedRace; daysBetween: number; severity: 'risk' | 'warn'; message: string }> = [];
  for (let i = 0; i < races.length - 1; i++) {
    const a = races[i];
    const b = races[i + 1];
    const days = Math.round((Date.parse(b.meta.date) - Date.parse(a.meta.date)) / 86_400_000);
    const aIsMar = a.meta.distanceMi >= 22;
    const bIsMar = b.meta.distanceMi >= 22;
    const aIsHalf = a.meta.distanceMi >= 11 && a.meta.distanceMi < 22;
    const bIsHalf = b.meta.distanceMi >= 11 && b.meta.distanceMi < 22;
    if (aIsMar && bIsMar && days < 56) {
      const r = MULTI_RACE_CADENCE.value.marathonSpacingRisk.find(x => {
        const m = x.spacing.match(/(\d+)-(\d+)/);
        if (!m) return x.spacing.startsWith('<') && days < Number(x.spacing.replace(/[^\d]/g, ''));
        return days >= Number(m[1]) && days < Number(m[2]);
      });
      out.push({ a, b, daysBetween: days, severity: 'risk', message: r?.risk ?? 'Marathons too close — recovery overlap' });
    } else if (aIsHalf && bIsHalf && days < MULTI_RACE_CADENCE.value.halfMinSpacingWeeks.low * 7) {
      out.push({ a, b, daysBetween: days, severity: 'warn', message: `Half-marathons normally ${MULTI_RACE_CADENCE.value.halfMinSpacingWeeks.low}-${MULTI_RACE_CADENCE.value.halfMinSpacingWeeks.high} weeks apart — this gap is ${Math.round(days / 7)} weeks` });
    } else if (aIsMar && days < 28) {
      out.push({ a, b, daysBetween: days, severity: 'risk', message: 'Race within 4 weeks of a marathon — full marathon recovery (21-28d) hasn\'t completed' });
    }
  }
  return out;
}

function Timeline({ races, todayISO, segments }: { races: SavedRace[]; todayISO: string; segments: Segment[] }) {
  if (races.length === 0) {
    return (
      <div className="tile" style={{ padding: 32, textAlign: 'center' }}>
        <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 24 }}>No races on the calendar</div>
        <div style={{ fontSize: 13, color: 'var(--color-t2)', marginTop: 8, maxWidth: 480, margin: '8px auto 0' }}>
          Add a race to start building a season arc — even a single A-race anchors the build, taper, and recovery into a story.
        </div>
        <Link href="/races/new" className="btn btn--primary" style={{ marginTop: 18 }}>+ Add race</Link>
      </div>
    );
  }

  // Replaced the position-absolute calendar strip with a clean
  // chronological vertical timeline. The previous strip had rotated
  // labels stacked diagonally, race markers overlapping at dense
  // months, "today" line floating mid-bar — the runner correctly
  // flagged it as "haggard, ugly, nothing looks right."
  // Now: race rows separated by phase-block segments so the season
  // reads top-to-bottom as a story, not a cramped horizontal bar.

  // segments param retained for back-compat with caller signature
  // — future iteration brings phase chips back per row.
  void segments;
  const todayMs = Date.parse(todayISO + 'T12:00:00Z');
  const racesPast = races.filter(r => Date.parse(r.meta.date) < todayMs).sort((a, b) => Date.parse(b.meta.date) - Date.parse(a.meta.date)); // most recent first
  const racesFuture = races.filter(r => Date.parse(r.meta.date) >= todayMs).sort((a, b) => Date.parse(a.meta.date) - Date.parse(b.meta.date));

  return (
    <div className="tile" style={{ padding: '20px 22px' }}>
      <div className="tile-h">
        <div>
          <div className="tile-sub">Season timeline</div>
          <div className="tile-lbl">{racesPast.length} past · {racesFuture.length} ahead</div>
        </div>
      </div>

      <div style={{ marginTop: 18, display: 'flex', flexDirection: 'column', gap: 0 }}>
        {/* Future races (chronological) */}
        {racesFuture.map((r, i) => {
          const daysAway = Math.round((Date.parse(r.meta.date) - todayMs) / 86_400_000);
          const prevRace = i === 0 ? null : racesFuture[i - 1];
          const gapDays = prevRace
            ? Math.round((Date.parse(r.meta.date) - Date.parse(prevRace.meta.date)) / 86_400_000)
            : daysAway;
          // For the first race ahead, gapDays = days from today.
          // For subsequent races, gap from the prior race.
          const gapLabel = i === 0
            ? `${daysAway} days from today`
            : `${gapDays} days after ${prevRace!.meta.name}`;
          return (
            <div key={r.slug}>
              <PhaseGap label={gapLabel} kind={i === 0 ? 'NOW' : 'GAP'} />
              <RaceRow race={r} todayISO={todayISO} />
            </div>
          );
        })}

        {/* Past races (most recent first) */}
        {racesPast.length > 0 && (
          <>
            <div style={{
              padding: '14px 0 6px',
              fontFamily: 'var(--font-data)', fontSize: 10, fontWeight: 700,
              letterSpacing: '1.4px', color: 'var(--color-t3)', textTransform: 'uppercase',
              borderTop: '1px solid var(--color-l4)',
              marginTop: 18,
            }}>
              Recent finishes
            </div>
            {racesPast.slice(0, 6).map(r => (
              <RaceRow key={r.slug} race={r} todayISO={todayISO} />
            ))}
          </>
        )}
      </div>

    </div>
  );
}

function PhaseGap({ label, kind }: { label: string; kind: 'NOW' | 'GAP' }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 12,
      padding: '8px 0',
    }}>
      <div style={{
        width: 4, height: 28, borderRadius: 2,
        background: kind === 'NOW' ? 'var(--color-warning)' : 'var(--color-l4)',
      }} />
      <div style={{
        fontFamily: 'var(--font-data)', fontSize: 11, color: 'var(--color-t2)',
        letterSpacing: '0.6px',
      }}>
        {kind === 'NOW' && <span style={{ color: 'var(--color-warning)', fontWeight: 700, marginRight: 6 }}>TODAY</span>}
        {label}
      </div>
    </div>
  );
}

function RaceRow({ race, todayISO }: { race: SavedRace; todayISO: string }) {
  const isPast = race.meta.date < todayISO;
  const priority = race.meta.priority ?? 'C';
  const priColor = priority === 'A' ? 'var(--color-attention)'
                : priority === 'B' ? 'var(--color-corporate)'
                : 'var(--color-t2)';
  const dateMs = Date.parse(race.meta.date + 'T12:00:00Z');
  const dateLbl = new Date(dateMs).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

  return (
    <Link href={`/races/${race.slug}`} style={{
      display: 'flex', alignItems: 'center', gap: 14,
      padding: '14px 16px',
      background: 'var(--color-l2)',
      borderLeft: `3px solid ${priColor}`,
      borderRadius: 6,
      textDecoration: 'none',
      opacity: isPast ? 0.55 : 1,
      transition: 'background 0.12s',
    }}>
      <div style={{
        width: 36, padding: '4px 0', textAlign: 'center',
        background: 'var(--color-l1)',
        borderRadius: 4, border: `1px solid ${priColor}`,
        fontFamily: 'var(--font-data)', fontWeight: 800, fontSize: 14,
        color: priColor, letterSpacing: '0.5px',
      }}>
        {priority}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontFamily: 'var(--font-display)', fontSize: 16, fontWeight: 700,
          color: 'var(--color-t0)', letterSpacing: '-.005em',
        }}>
          {race.meta.name}
        </div>
        <div style={{
          fontFamily: 'var(--font-data)', fontSize: 11, color: 'var(--color-t3)',
          letterSpacing: '0.5px', marginTop: 2,
        }}>
          {dateLbl} · {race.meta.distanceMi.toFixed(1)} mi
          {race.meta.goalDisplay ? ` · goal ${race.meta.goalDisplay}` : ''}
        </div>
      </div>
      <div style={{
        fontFamily: 'var(--font-data)', fontSize: 9.5, color: 'var(--color-t3)',
        letterSpacing: '1.2px', textTransform: 'uppercase',
        flexShrink: 0,
      }}>
        →
      </div>
    </Link>
  );
}

function ConflictsCard({ conflicts }: { conflicts: Array<{ a: SavedRace; b: SavedRace; daysBetween: number; severity: 'risk' | 'warn'; message: string }> }) {
  return (
    <div className="tile" style={{
      marginTop: 14, padding: '16px 20px',
      borderLeft: '3px solid var(--color-warning)',
      background: 'rgba(252,77,84,.05)',
    }}>
      <div className="tile-sub" style={{ color: 'var(--color-warning)' }}>
        Spacing conflicts ({conflicts.length})
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 10 }}>
        {conflicts.map((c, i) => (
          <div key={i} style={{
            padding: '10px 12px', borderRadius: 6, background: 'var(--color-l2)',
            border: `1px solid ${c.severity === 'risk' ? 'rgba(252,77,84,.4)' : 'rgba(243,173,59,.3)'}`,
          }}>
            <div style={{ fontFamily: 'var(--font-display)', fontSize: 13, fontWeight: 700, color: 'var(--color-t0)' }}>
              {c.a.meta.name} → {c.b.meta.name}
            </div>
            <div style={{ fontSize: 11.5, color: 'var(--color-t2)', marginTop: 4, lineHeight: 1.5 }}>
              {c.daysBetween} days between · {c.message}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function SeasonStatsCard({ aCount, bCount, cCount, marathonCount, halfCount }: { aCount: number; bCount: number; cCount: number; marathonCount: number; halfCount: number }) {
  const aMax = MULTI_RACE_CADENCE.value.aRaceMaxPerYear;
  const bRecLow = MULTI_RACE_CADENCE.value.bRacePerYear.low;
  const bRecHigh = MULTI_RACE_CADENCE.value.bRacePerYear.high;
  const aOver = aCount > aMax;
  const bUnder = bCount < bRecLow;
  return (
    <div className="tile">
      <div className="tile-h">
        <div>
          <div className="tile-sub">Annual race load</div>
          <div className="tile-lbl">Trailing 12 months · all priorities</div>
        </div>
      </div>
      <StatRow label="A-races" value={aCount} target={`max ${aMax}`} warn={aOver} />
      <StatRow label="B-races" value={bCount} target={`${bRecLow}-${bRecHigh} typical`} warn={bUnder} />
      <StatRow label="C-races" value={cCount} target="" />
      <StatRow label="Marathons" value={marathonCount} target="" />
      <StatRow label="Half-marathons" value={halfCount} target="" />
    </div>
  );
}

function StatRow({ label, value, target, warn }: { label: string; value: number; target: string; warn?: boolean }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', padding: '8px 0', borderBottom: '1px solid var(--color-l4)' }}>
      <span style={{ fontFamily: 'var(--font-data)', fontSize: 10, letterSpacing: '1.2px', color: 'var(--color-t3)', fontWeight: 700, textTransform: 'uppercase' }}>{label}</span>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
        <span style={{
          fontFamily: 'var(--font-display)', fontSize: 18, fontWeight: 800,
          color: warn ? 'var(--color-attention)' : 'var(--color-t0)',
          fontVariantNumeric: 'tabular-nums',
        }}>{value}</span>
        {target && <span style={{ fontSize: 10, color: 'var(--color-t3)', fontFamily: 'var(--font-data)', letterSpacing: '0.6px' }}>{target}</span>}
      </div>
    </div>
  );
}

function UpcomingListCard({ upcoming, todayISO }: { upcoming: SavedRace[]; todayISO: string }) {
  return (
    <div className="tile">
      <div className="tile-h"><div className="tile-lbl">Upcoming</div></div>
      {upcoming.length === 0 && <div className="hint">No future races.</div>}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {upcoming.map(r => {
          const days = Math.round((Date.parse(r.meta.date) - Date.parse(todayISO)) / 86_400_000);
          const priority = r.meta.priority ?? 'C';
          const color = priority === 'A' ? 'var(--color-warning)' : priority === 'B' ? 'var(--color-attention)' : 'var(--color-corporate)';
          return (
            <Link key={r.slug} href={`/races/${r.slug}`} style={{
              display: 'grid', gridTemplateColumns: '40px 1fr auto', gap: 10, alignItems: 'baseline',
              padding: '10px 12px', background: 'var(--color-l2)', borderRadius: 6, textDecoration: 'none',
              borderLeft: `3px solid ${color}`,
            }}>
              <div style={{ fontFamily: 'var(--font-display)', fontSize: 14, fontWeight: 800, color }}>{priority}</div>
              <div>
                <div style={{ fontFamily: 'var(--font-display)', fontSize: 14, fontWeight: 700, color: 'var(--color-t0)' }}>{r.meta.name}</div>
                <div style={{ fontSize: 11, color: 'var(--color-t2)', marginTop: 2 }}>{r.meta.date} · {r.meta.distanceMi.toFixed(1)} mi · goal {r.meta.goalDisplay}</div>
              </div>
              <div style={{ fontFamily: 'var(--font-data)', fontSize: 12, fontWeight: 800, color: 'var(--color-t0)', fontVariantNumeric: 'tabular-nums' }}>
                {days}d
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}

function RecentListCard({ past, todayISO }: { past: SavedRace[]; todayISO: string }) {
  return (
    <div className="tile">
      <div className="tile-h"><div className="tile-lbl">Recently raced</div></div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {past.slice().reverse().slice(0, 8).map(r => {
          const days = Math.abs(Math.round((Date.parse(r.meta.date) - Date.parse(todayISO)) / 86_400_000));
          const priority = r.meta.priority ?? 'C';
          const color = priority === 'A' ? 'var(--color-warning)' : priority === 'B' ? 'var(--color-attention)' : 'var(--color-corporate)';
          return (
            <Link key={r.slug} href={`/races/${r.slug}`} style={{
              display: 'grid', gridTemplateColumns: '40px 1fr auto', gap: 10, alignItems: 'baseline',
              padding: '10px 12px', background: 'var(--color-l2)', borderRadius: 6, textDecoration: 'none',
              borderLeft: `3px solid ${color}`, opacity: 0.78,
            }}>
              <div style={{ fontFamily: 'var(--font-display)', fontSize: 14, fontWeight: 800, color }}>{priority}</div>
              <div>
                <div style={{ fontFamily: 'var(--font-display)', fontSize: 14, fontWeight: 700, color: 'var(--color-t0)' }}>{r.meta.name}</div>
                <div style={{ fontSize: 11, color: 'var(--color-t2)', marginTop: 2 }}>{r.meta.date} · {r.actualResult ? `${r.actualResult.finishDisplay}` : 'no result'}</div>
              </div>
              <div style={{ fontFamily: 'var(--font-data)', fontSize: 12, fontWeight: 800, color: 'var(--color-t3)', fontVariantNumeric: 'tabular-nums' }}>
                {days}d ago
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}

function Footnote() {
  return (
    <div className="tile" style={{ background: 'var(--color-l1)', borderStyle: 'dashed', textAlign: 'center', padding: 18, marginTop: 14 }}>
      <div style={{ fontSize: 12, color: 'var(--color-t2)', lineHeight: 1.6 }}>
        A multi-race year is a sequence of decisions. Build → Race → Recover → Build is the rhythm; the conflicts panel above flags when the rhythm is too tight to sustain.
      </div>
    </div>
  );
}

function isoOffset(iso: string, days: number): string {
  const d = new Date(iso + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
