'use client';

/**
 * Drawer · the morning Readiness Brief panel.
 *
 * Recreated 2026-06-01 from David's design handoff
 * (designs/from Design agent/readiness-drawer/Readiness Brief handoff.html
 * + README.md). Replaces the previous shallow drawer (score ring + 5
 * driver bars + 7-day bar trend) with a 9-section diagnostic surface
 * that consumes seed.readinessBrief.
 *
 * Doctrine guardrails honored:
 *   1. No prescription on the panel. The drawer describes; never
 *      imperatives. Coach voice lives elsewhere.
 *   2. State both numbers, no derived deltas (on raw metrics). Pillar
 *      tiles show observedValue + baseline; never compute "−1.4h short".
 *   3. Subjective beats objective. The override block fires LOUD at the
 *      top when subjectiveOverride !== null.
 *   4. No false precision. Directional language only.
 *   5. Lead with band-aware headline + trend, not the spot number.
 *   6. No research citations rendered on this panel (per explicit
 *      product decision, even though they exist on per-pillar `citation`).
 *
 * Backend fields not yet shipped that the design references:
 *   - composition (BASELINE / NET / TODAY) · derived client-side from
 *     scoreTrend until backend ships it.
 *   - streaks[].short · backend only ships full `meaning`; we render it
 *     directly, no tap-to-expand (a follow-up brief could ask for short).
 *   - trendNote · derived client-side from scoreTrend.
 *   - coldStart object · derived from band==='no-data' as a simple
 *     state; full coldStart envelope (nightsLogged/nightsNeeded) deferred.
 *   - subjectiveCheckin · skip the morning check-in section entirely
 *     until backend ships the capture endpoint (open question #6 in
 *     readiness-brief-backend-landed.md).
 *
 * 392px right slide-out drawer. Scrollable body. Mesh re-themes via
 * data-band attribute on the drawer element (mesh transition itself
 * remains on the Shell's win container; we tint the drawer surface).
 */

import { useState } from 'react';
import type { FaffSeed, ReadinessBriefSeed } from '../types';

type Band = ReadinessBriefSeed['band'];

const BAND_COLOR: Record<Band, string> = {
  sharp:       '#34D058',
  ready:       '#3EBD41',
  moderate:    '#F3AD38',
  'pull-back': '#FC4D64',
  'no-data':   '#8A90A0',
};

/** Per-pillar band → color. The README documents pillar colors as
 *  good/ok/watch/low (visual semantic names); the type shape uses the
 *  same enum as the composite band (sharp/ready/moderate/pull-back/
 *  no-data) per pillar with its own thresholds. Map directly. */
const PILLAR_BAND_COLOR: Record<Band, string> = {
  sharp:       '#3EBD41',
  ready:       '#3EBD41',
  moderate:    '#F3AD38',
  'pull-back': '#FC4D64',
  'no-data':   '#8A90A0',
};

function contributionColor(c: number): string {
  if (c <= -8) return '#FC4D64';
  if (c < 0)   return '#FFB24D';
  if (c > 0)   return '#3EBD41';
  return '#8A90A0';
}

function fmtSignedPts(n: number): string {
  if (n > 0) return `+${n}`;
  if (n < 0) return `${n}`;  // already has minus sign
  return '0';
}

export function Drawer({
  open, onClose, brief, fallbackReadiness, onViewFullHealth,
}: {
  open: boolean;
  onClose: () => void;
  brief: ReadinessBriefSeed | null;
  /** Legacy seed.readiness · used only when brief is null AND we still
   *  want a basic score render. Not the full diagnostic surface. */
  fallbackReadiness?: FaffSeed['readiness'];
  onViewFullHealth: () => void;
}) {
  const [expandedPillars, setExpandedPillars] = useState<Set<string>>(new Set());
  const [expandedStreaks, setExpandedStreaks] = useState<Set<string>>(new Set());

  // Auto-expand pull-back-band pillars when the day's band is pull-back
  // or moderate (per README `confounders=auto` rule). README phrases this
  // as "low-band pillars" using the visual semantic name; the actual
  // type uses pull-back for the worst band. Computed once per render
  // against the current brief; merged with user-toggled expansions.
  const autoExpandedKeys = brief && (brief.band === 'pull-back' || brief.band === 'moderate')
    ? new Set(brief.pillars.filter(p => p.band === 'pull-back').map(p => p.key))
    : new Set<string>();

  const isPillarOpen = (key: string) => expandedPillars.has(key) || autoExpandedKeys.has(key);
  const togglePillar = (key: string) => {
    const next = new Set(expandedPillars);
    if (next.has(key)) next.delete(key); else next.add(key);
    setExpandedPillars(next);
  };
  const toggleStreak = (key: string) => {
    const next = new Set(expandedStreaks);
    if (next.has(key)) next.delete(key); else next.add(key);
    setExpandedStreaks(next);
  };

  // Composition derivation · BASELINE = average of scoreTrend excluding
  // today, NET = today - baseline, TODAY = score. Backend doesn't ship
  // this as a structured field yet (queued); derive here so the panel
  // shows the math.
  const composition = (() => {
    if (!brief || brief.scoreTrend.length < 2) return null;
    const past = brief.scoreTrend.slice(0, -1);
    const baseline = Math.round(past.reduce((s, p) => s + p.score, 0) / past.length);
    const net = brief.score - baseline;
    return { baseline, net, today: brief.score };
  })();

  const trendNoteText = (() => {
    if (!brief || brief.scoreTrend.length < 4) return null;
    const past = brief.scoreTrend.slice(0, -1);
    const priorAvg = Math.round(past.reduce((s, p) => s + p.score, 0) / past.length);
    const delta = brief.score - priorAvg;
    if (Math.abs(delta) <= 2) return `Holding around ${priorAvg}. Steady week.`;
    if (delta > 0) return `Up from a ${priorAvg} average. Trending into a peak.`;
    return `Down from a ${priorAvg} average. Watch the load.`;
  })();

  // Cold-start / no-data short-circuit. Replaces the body with an
  // encouraging empty state (per README §"Special state: cold start").
  // Full coldStart object (nightsLogged/nightsNeeded) not on the seed
  // yet · we surface a simple variant.
  const isColdStart = !brief || brief.band === 'no-data';

  return (
    <>
      <div className={`scrim${open ? ' show' : ''}`} onClick={onClose} />
      <div className={`drawer rbrief${open ? ' open' : ''}`} data-band={brief?.band ?? 'no-data'}>
        <div className="dh">
          <div className="dt">READINESS · TODAY</div>
          <div className="dx" onClick={onClose} role="button" tabIndex={0} aria-label="Close">
            <svg viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
          </div>
        </div>

        {isColdStart ? (
          <ColdStart score={fallbackReadiness?.score ?? brief?.score ?? 0} onConnect={onViewFullHealth} />
        ) : brief ? (
          <>
            {/* 1 · Subjective override callout · renders first and loud. */}
            {brief.subjectiveOverride ? (
              <OverrideCallout ov={brief.subjectiveOverride} />
            ) : null}

            {/* 2 · Hero · score ring + band eyebrow + headline + mover. */}
            <Hero brief={brief} />

            {/* 3 · 14-day score trend. */}
            <Section label="14-DAY TREND">
              <ScoreTrend trend={brief.scoreTrend} />
              {trendNoteText ? (
                <div className="rb-trendnote">{trendNoteText}</div>
              ) : null}
            </Section>

            {/* 4 · Streak banners. */}
            {brief.streaks.length > 0 ? (
              <Section label="STREAKS">
                {brief.streaks.map((s, i) => (
                  <StreakRow
                    key={`${s.pillar}-${i}`}
                    streak={s}
                    open={expandedStreaks.has(`${s.pillar}-${i}`)}
                    onToggle={() => toggleStreak(`${s.pillar}-${i}`)}
                  />
                ))}
              </Section>
            ) : null}

            {/* 5 · 5 pillars · tap to expand. */}
            <Section label="WHAT'S DRIVING IT" right="weighted contribution">
              <div className="rb-pillars">
                {brief.pillars.map(p => (
                  <PillarRow
                    key={p.key}
                    pillar={p}
                    band={brief.band}
                    open={isPillarOpen(p.key)}
                    onToggle={() => togglePillar(p.key)}
                  />
                ))}
              </div>
            </Section>

            {/* 6 · Composition line · derived from scoreTrend. */}
            {composition ? (
              <div className="rb-composition">
                BASELINE <b>{composition.baseline}</b> · NET{' '}
                <b style={{ color: contributionColor(composition.net) }}>
                  {fmtSignedPts(composition.net)}
                </b>{' '}
                · TODAY <b style={{ color: BAND_COLOR[brief.band] }}>{composition.today}</b>
              </div>
            ) : null}

            {/* 7 · Watch tomorrow. */}
            {brief.watchTomorrow.length > 0 ? (
              <Section label="WATCH TOMORROW">
                <div className="rb-watch">
                  {brief.watchTomorrow.map((line, i) => (
                    <div className="rb-wrow" key={i}>
                      <span className="rb-wdot" /> <span>{line}</span>
                    </div>
                  ))}
                </div>
              </Section>
            ) : null}

            {/* 8 · Morning check-in · deferred until backend ships the
                subjectiveCheckin capture (open question #6). When ready
                I'll add a new section here gated on
                brief.subjectiveCheckin?.answered === false. */}

            {/* 9 · View full health link. */}
            <div className="dlink" onClick={onViewFullHealth} role="button" tabIndex={0}>
              View full health{' '}
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg>
            </div>
          </>
        ) : null}
      </div>
    </>
  );
}

/* ============================================================
   Section · label + optional right caption + children.
   ============================================================ */
function Section({ label, right, children }: {
  label: string;
  right?: string;
  children: React.ReactNode;
}) {
  return (
    <>
      <div className="rb-dcl-row">
        <div className="dcl">{label}</div>
        {right ? <span className="rb-dcl-r">{right}</span> : null}
      </div>
      {children}
    </>
  );
}

/* ============================================================
   Hero · 84px ring (number only, no inside label) + band eyebrow
   + Inter 600 16.5px headline + oneLineMover.
   ============================================================ */
function Hero({ brief }: { brief: ReadinessBriefSeed }) {
  const band = brief.band;
  const ring = BAND_COLOR[band];
  const r = 35;
  const c = 2 * Math.PI * r;  // 220 per README
  const dashoffset = c - c * (brief.score / 100);
  return (
    <div className="rb-hero">
      <svg className="rb-ring" width="84" height="84" viewBox="0 0 84 84" aria-hidden="true">
        <circle cx="42" cy="42" r={r} fill="none" stroke="rgba(255,255,255,.14)" strokeWidth="6" />
        <circle
          cx="42" cy="42" r={r}
          fill="none"
          stroke={ring}
          strokeWidth="6"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={dashoffset}
          transform="rotate(-90 42 42)"
        />
        <text
          x="42" y="48" textAnchor="middle"
          fontFamily="Oswald, sans-serif" fontSize="34" fontWeight="600"
          fill="var(--txt)"
        >
          {brief.score}
        </text>
      </svg>
      <div className="rb-hwords">
        <div className="rb-eyebrow" style={{ color: ring }}>{brief.label}</div>
        <div className="rb-headline">{brief.headline}</div>
        {brief.oneLineMover ? (
          <div className="rb-mover">{brief.oneLineMover}</div>
        ) : null}
      </div>
    </div>
  );
}

/* ============================================================
   OverrideCallout · subjectiveOverride.
   ============================================================ */
function OverrideCallout({ ov }: { ov: NonNullable<ReadinessBriefSeed['subjectiveOverride']> }) {
  return (
    <div className="rb-override">
      <div className="rb-ov-tag">
        <span className="rb-ov-dot" />
        SUBJECTIVE OVERRIDE
      </div>
      <div className="rb-ov-scores">
        <div className="rb-ov-cell">
          <div className="rb-ov-n">{ov.subjectiveScore}</div>
          <div className="rb-ov-l">HOW YOU FEEL</div>
        </div>
        <div className="rb-ov-vs">vs</div>
        <div className="rb-ov-cell rb-dim">
          <div className="rb-ov-n">{ov.objectiveScore}</div>
          <div className="rb-ov-l">THE NUMBERS</div>
        </div>
      </div>
      <div className="rb-ov-advice">{ov.advice}</div>
    </div>
  );
}

/* ============================================================
   ScoreTrend · 14-day bar chart, today highlighted with glow.
   ============================================================ */
function ScoreTrend({ trend }: { trend: ReadinessBriefSeed['scoreTrend'] }) {
  if (!trend.length) return null;
  const todayIdx = trend.length - 1;
  // Domain clamped 35-95, mapped to 14%-100% bar fill per README.
  const barHeight = (score: number) => {
    const clamped = Math.max(35, Math.min(95, score));
    return 14 + ((clamped - 35) / 60) * 86;
  };
  const fmtAxis = (iso: string) => {
    const d = new Date(iso + 'T12:00:00Z');
    if (!Number.isFinite(d.getTime())) return iso;
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }).toUpperCase();
  };
  return (
    <>
      <div className="rb-bars">
        {trend.map((p, i) => {
          const color = BAND_COLOR[(p.band as Band) ?? 'no-data'];
          const isToday = i === todayIdx;
          return (
            <i
              key={p.date}
              className={isToday ? 'rb-bar-today' : ''}
              style={{
                height: `${barHeight(p.score)}%`,
                background: color,
                color,
                opacity: isToday ? 1 : 0.5,
                boxShadow: isToday ? '0 0 9px -1px currentColor' : undefined,
              }}
            />
          );
        })}
      </div>
      <div className="rb-bars-axis">
        <span>{fmtAxis(trend[0].date)}</span>
        <span>TODAY</span>
      </div>
    </>
  );
}

/* ============================================================
   StreakRow · banner with optional tap-to-expand meaning.
   Backend ships only `meaning` (no `short`) so default state shows
   the full meaning; tap-to-expand is a no-op visually but still
   present for future short-vs-meaning separation.
   ============================================================ */
function StreakRow({ streak, open, onToggle }: {
  streak: ReadinessBriefSeed['streaks'][number];
  open: boolean;
  onToggle: () => void;
}) {
  const isDown = streak.direction === 'below';
  const bgClass = isDown ? 'rb-streak rb-streak-down' : 'rb-streak rb-streak-up';
  const arrow = isDown ? '↓' : '↑';
  const dirLabel = isDown ? 'days below' : 'days above';
  return (
    <div className={bgClass}>
      <button
        type="button"
        className="rb-streak-h"
        onClick={onToggle}
        aria-expanded={open}
      >
        <span className="rb-streak-k">{streak.pillar.toUpperCase()}</span>
        <span className="rb-streak-dir">
          {arrow} {streak.days} {dirLabel}
        </span>
        <span className={`rb-chev${open ? ' open' : ''}`} aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M6 9l6 6 6-6"/></svg>
        </span>
      </button>
      <div className="rb-streak-body">{streak.meaning}</div>
    </div>
  );
}

/* ============================================================
   PillarRow · collapsed row + tap-to-expand detail.
   ============================================================ */
function PillarRow({ pillar, band: _band, open, onToggle }: {
  pillar: ReadinessBriefSeed['pillars'][number];
  band: ReadinessBriefSeed['band'];
  open: boolean;
  onToggle: () => void;
}) {
  const dot = PILLAR_BAND_COLOR[pillar.band] ?? '#8A90A0';
  const contribColor = contributionColor(pillar.weightContribution);
  const isNoData = pillar.band === 'no-data';
  const barWidth = Math.min(46, Math.abs(pillar.weightContribution) * 3.2 + 4);
  const positive = pillar.weightContribution > 0;
  // Confounder split · likely vs not-likely.
  const likely = pillar.confounders.filter(c => c.likely);
  const others = pillar.confounders.filter(c => !c.likely);
  return (
    <div className={`rb-pil${open ? ' open' : ''}${isNoData ? ' nodata' : ''}`}>
      <button
        type="button"
        className="rb-pil-row"
        onClick={() => { if (!isNoData) onToggle(); }}
        aria-expanded={open}
        disabled={isNoData}
      >
        <span className="rb-pil-dot" style={{ background: dot }} />
        <span className="rb-pil-k">{pillar.label.toUpperCase()}</span>
        <span className="rb-pil-bar">
          <span className="rb-pil-axis" />
          {!isNoData && pillar.weightContribution !== 0 ? (
            <i
              style={positive
                ? { left: '50%', width: `${barWidth}%`, background: contribColor }
                : { right: '50%', width: `${barWidth}%`, background: contribColor }
              }
            />
          ) : null}
        </span>
        <span className="rb-pil-val">
          <b>{pillar.observedValue}</b>
          <small>{pillar.baseline}</small>
        </span>
        <span className="rb-pil-c" style={{ color: contribColor }}>
          {isNoData ? '·' : fmtSignedPts(pillar.weightContribution)}
        </span>
        {!isNoData ? (
          <span className={`rb-chev${open ? ' open' : ''}`} aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M6 9l6 6 6-6"/></svg>
          </span>
        ) : null}
      </button>
      {open && !isNoData ? (
        <div className="rb-pil-detail">
          <div className="rb-pil-sub">
            {pillar.observedValue}
            {pillar.observedSub ? <> · {pillar.observedSub}</> : null}
            {pillar.baseline ? <> · {pillar.baseline}</> : null}
          </div>
          <div className="rb-pil-meaning">{pillar.meaning}</div>
          <PillarHistory trend={pillar.trend} observedValue={pillar.observedValue} accent={dot} />
          {(likely.length > 0 || others.length > 0) ? (
            <div className="rb-pil-conf">
              {likely.length > 0 ? (
                <>
                  <div className="rb-conf-h">MOST LIKELY BEHIND IT</div>
                  {likely.map((c, i) => (
                    <div className="rb-conf-row" key={`l-${i}`}>
                      <span className="rb-conf-k rb-conf-likely">{c.pillar.toUpperCase()}</span>
                      <span className="rb-conf-x">{c.explanation}</span>
                    </div>
                  ))}
                </>
              ) : null}
              {others.length > 0 ? (
                <>
                  <div className="rb-conf-h">ALSO WORTH CHECKING</div>
                  {others.map((c, i) => (
                    <div className="rb-conf-row" key={`o-${i}`}>
                      <span className="rb-conf-k">{c.pillar.toUpperCase()}</span>
                      <span className="rb-conf-x">{c.explanation}</span>
                    </div>
                  ))}
                </>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function PillarHistory({ trend, observedValue, accent }: {
  trend: Array<{ date: string; value: number }>;
  observedValue: string;
  accent: string;
}) {
  if (!trend || trend.length === 0) {
    return (
      <div className="rb-hist-empty">No history yet · fills in after a few syncs</div>
    );
  }
  const todayIdx = trend.length - 1;
  const values = trend.map(t => t.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = Math.max(1, max - min);
  // Domain with 25% padding mapped 18-100%.
  const pad = span * 0.25;
  const lo = min - pad;
  const hi = max + pad;
  const range = Math.max(1, hi - lo);
  return (
    <div className="rb-hist">
      <div className="rb-hist-cap">
        <span>14-DAY HISTORY</span>
        <span>today <b>{observedValue}</b></span>
      </div>
      <div className="rb-hist-bars">
        {trend.map((p, i) => {
          const h = 18 + ((p.value - lo) / range) * 82;
          const isToday = i === todayIdx;
          return (
            <i
              key={p.date}
              style={{
                height: `${h}%`,
                background: isToday ? accent : 'rgba(255,255,255,0.16)',
                boxShadow: isToday ? '0 0 7px -1px currentColor' : undefined,
                color: isToday ? accent : undefined,
              }}
            />
          );
        })}
      </div>
      <div className="rb-hist-axis">
        <span>14 DAYS AGO</span>
        <span>TODAY</span>
      </div>
    </div>
  );
}

/* ============================================================
   ColdStart · band==='no-data' or null brief. Simple variant
   (full coldStart envelope with nightsLogged/nightsNeeded is
   deferred backend-side).
   ============================================================ */
function ColdStart({ score, onConnect }: { score: number; onConnect: () => void }) {
  return (
    <div className="rb-cold">
      <div className="rb-cold-ring">
        <svg width="120" height="120" viewBox="0 0 120 120" aria-hidden="true">
          <circle cx="60" cy="60" r="50" fill="none" stroke="rgba(255,255,255,0.10)" strokeWidth="8" />
        </svg>
        <div className="rb-cold-n"><b>{score || '·'}</b><small>building</small></div>
      </div>
      <h2 className="rb-cold-h">Building your baseline.</h2>
      <p className="rb-cold-p">
        A few more nights of sleep + HRV data and the morning brief will fill in.
        Heart rate variability needs a stable baseline before the read is honest.
      </p>
      <button type="button" className="rb-cold-cta" onClick={onConnect}>
        Connect Apple Health to skip the wait
      </button>
    </div>
  );
}
