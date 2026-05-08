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
  const conflicts = detectConflicts(inWindow);

  // Annual stats — race counts in the trailing 12 months.
  const trailing12 = hub.races.filter(r => {
    const t = Date.parse(r.meta.date + 'T12:00:00Z');
    return t >= todayMs - 365 * 86_400_000 && t <= todayMs + 365 * 86_400_000;
  });
  const aCount = trailing12.filter(r => (r.meta.priority ?? 'A') === 'A').length;
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
  // Compute timeline span: 30 days before earliest visible race → 30 days after latest.
  const earliest = Math.min(...races.map(r => Date.parse(r.meta.date)));
  const latest = Math.max(...races.map(r => Date.parse(r.meta.date)));
  const startMs = earliest - 30 * 86_400_000;
  const endMs = latest + 60 * 86_400_000;
  const totalDays = Math.max(1, (endMs - startMs) / 86_400_000);
  const todayPctRaw = ((Date.parse(todayISO + 'T12:00:00Z') - startMs) / 86_400_000) / totalDays * 100;
  const todayPct = Math.max(0, Math.min(100, todayPctRaw));

  return (
    <div className="tile" style={{ padding: '20px 22px' }}>
      <div className="tile-h">
        <div>
          <div className="tile-sub">Calendar timeline</div>
          <div className="tile-lbl">{races.length} race{races.length === 1 ? '' : 's'} · {Math.round(totalDays)} days span</div>
        </div>
      </div>
      <div style={{ position: 'relative', height: 80, marginTop: 16, background: 'var(--color-l2)', borderRadius: 8, overflow: 'hidden' }}>
        {/* Phase segments */}
        {segments.map((s, i) => {
          if (!s.startISO || !s.endISO) return null;
          const sMs = Date.parse(s.startISO + 'T12:00:00Z');
          const eMs = Date.parse(s.endISO + 'T12:00:00Z');
          const left = ((sMs - startMs) / 86_400_000) / totalDays * 100;
          const width = ((eMs - sMs) / 86_400_000) / totalDays * 100;
          if (width <= 0) return null;
          const segColor = s.kind === 'BUILD' ? 'rgba(62,189,65,.18)'
                         : s.kind === 'TAPER' ? 'rgba(243,173,59,.30)'
                         : s.kind === 'POST_RACE' ? 'rgba(252,77,84,.16)'
                         : s.kind === 'GAP' ? 'rgba(255,255,255,.04)'
                         : 'rgba(120,120,120,.10)';
          return (
            <div key={i} title={`${s.kind} · ${s.startISO} → ${s.endISO}${s.raceContext ? ` (for ${s.raceContext})` : ''}`} style={{
              position: 'absolute', left: `${left}%`, width: `${width}%`,
              top: 0, bottom: 0, background: segColor,
            }} />
          );
        })}
        {/* Today line */}
        <div style={{
          position: 'absolute', left: `${todayPct}%`, top: 0, bottom: 0,
          width: 2, background: 'var(--color-warning)', boxShadow: '0 0 6px rgba(252,77,84,.6)',
        }}>
          <div style={{
            position: 'absolute', top: -16, left: -18,
            fontFamily: 'var(--font-data)', fontSize: 8.5, fontWeight: 700, letterSpacing: '1.4px',
            color: 'var(--color-warning)',
          }}>TODAY</div>
        </div>
        {/* Race markers */}
        {races.map(r => {
          const rMs = Date.parse(r.meta.date + 'T12:00:00Z');
          const left = ((rMs - startMs) / 86_400_000) / totalDays * 100;
          const priority = r.meta.priority ?? 'A';
          const color = priority === 'A' ? 'var(--color-warning)'
                      : priority === 'B' ? 'var(--color-attention)'
                      : 'var(--color-corporate)';
          const isPast = r.meta.date < todayISO;
          return (
            <Link key={r.slug} href={`/races/${r.slug}`} title={`${r.meta.name} · ${r.meta.date}`} style={{
              position: 'absolute', left: `${left}%`,
              top: 8, bottom: 8, width: 12,
              transform: 'translateX(-50%)',
              background: color,
              borderRadius: 3,
              opacity: isPast ? 0.5 : 1,
              border: '2px solid var(--color-l1)',
              cursor: 'pointer',
              transition: 'all 0.15s',
            }}>
              <div style={{
                position: 'absolute', top: -22, left: 0,
                transform: 'translateX(-50%)',
                fontFamily: 'var(--font-data)', fontSize: 8.5, fontWeight: 700, letterSpacing: '1px',
                color, whiteSpace: 'nowrap',
              }}>
                {priority}
              </div>
              <div style={{
                position: 'absolute', bottom: -32, left: 0,
                transform: 'translateX(-50%) rotate(-15deg)',
                fontFamily: 'var(--font-display)', fontSize: 11, fontWeight: 700,
                color: 'var(--color-t1)', whiteSpace: 'nowrap',
                transformOrigin: 'top left',
              }}>
                {r.meta.name.slice(0, 18)}{r.meta.name.length > 18 ? '…' : ''}
              </div>
            </Link>
          );
        })}
      </div>
      <div style={{ marginTop: 28, display: 'flex', gap: 14, flexWrap: 'wrap', fontSize: 10.5, color: 'var(--color-t3)', fontFamily: 'var(--font-data)', letterSpacing: '1.3px', textTransform: 'uppercase' }}>
        <LegendSwatch color="rgba(62,189,65,.4)" label="Build" />
        <LegendSwatch color="rgba(243,173,59,.6)" label="Taper" />
        <LegendSwatch color="rgba(252,77,84,.4)" label="Post-race" />
        <LegendSwatch color="rgba(255,255,255,.1)" label="Gap" />
      </div>
    </div>
  );
}

function LegendSwatch({ color, label }: { color: string; label: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
      <div style={{ width: 14, height: 8, background: color, borderRadius: 2 }} />
      <span>{label}</span>
    </div>
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
      <div style={{ marginTop: 10, fontFamily: 'var(--font-data)', fontSize: 9, fontWeight: 700, letterSpacing: '1.4px', color: 'var(--color-corporate)' }}>
        RESEARCH/00b · MULTI_RACE_CADENCE
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
      <div className="tile-h"><div className="tile-lbl">Annual race load</div></div>
      <StatRow label="A-races" value={aCount} target={`max ${aMax}`} warn={aOver} />
      <StatRow label="B-races" value={bCount} target={`${bRecLow}-${bRecHigh} typical`} warn={bUnder} />
      <StatRow label="C-races" value={cCount} target="" />
      <StatRow label="Marathons" value={marathonCount} target="" />
      <StatRow label="Half-marathons" value={halfCount} target="" />
      <div style={{ marginTop: 8, fontFamily: 'var(--font-data)', fontSize: 9, fontWeight: 700, letterSpacing: '1.4px', color: 'var(--color-corporate)' }}>
        RESEARCH/00b · MULTI_RACE_CADENCE
      </div>
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
          const priority = r.meta.priority ?? 'A';
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
          const priority = r.meta.priority ?? 'A';
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
