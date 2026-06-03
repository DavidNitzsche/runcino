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

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
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

/** Strip any internal-doctrine citation from backend-authored coach-voice
 *  strings. 2026-06-01 David lock · "No citations, every anywhere for
 *  any reason." Broader than the original Research/XX rule · also
 *  covers docs/X.md, §section refs, and "per X" doctrine pointers.
 *  Defensive frontend sanitizer runs on every visible string from the
 *  readiness brief. Pair brief asks backend to author copy without
 *  citations at the source; this is the backstop until that lands.
 *  Patterns handled:
 *    " · Research/15 says ..." / " · docs/X.md §..." (middot clauses)
 *    " per Research/15" / " per docs/PLAN_ENGINE..." (inline refs)
 *    "Research/15 notes ..." / "docs/X.md notes ..." (sentence-leading)
 *    bare "Research/15", "docs/X.md", "§HRV approach" */
function stripCitations(s: string | null | undefined): string {
  if (!s) return '';
  return s
    // middot-prefixed citation clause through next period or middot
    .replace(/\s*·\s*(Research\/|docs\/)[^·.]*\./g, '.')
    .replace(/\s*·\s*(Research\/|docs\/)[^·.]*$/g, '')
    // "per <ref>" inline
    .replace(/\s+per\s+(Research\/|docs\/)[A-Za-z0-9_./-]+(\s+§[^.,]*)?/gi, '')
    // sentence-leading "<ref> says/notes/..."
    .replace(/(Research\/|docs\/)[A-Za-z0-9_./-]+\s+(says|notes|reports?|finds?|shows?|locks?|tracks?)[^.]*\.?/gi, '')
    // any bare reference + optional section
    .replace(/\b(Research\/|docs\/)[A-Za-z0-9_./-]+\b(\s*§[A-Za-z0-9 .]+)?/g, '')
    // any bare " §..." section reference left dangling
    .replace(/\s+§[A-Za-z0-9][A-Za-z0-9 .]*\b/g, '')
    // cleanup leftover whitespace + orphan punctuation
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+([.,])/g, '$1')
    .replace(/\(\s*\)/g, '')
    .trim();
}

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

/** Format seconds → "1:34:54" or "34:54" depending on length. */
function fmtTimeFromSec(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.round(sec % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function Drawer({
  open, onClose, brief, fallbackReadiness, goalSlug,
  todayRunDone = false, todayWorkoutType = null,
  onViewFullHealth,
}: {
  open: boolean;
  onClose: () => void;
  brief: ReadinessBriefSeed | null;
  /** Legacy seed.readiness · used only when brief is null AND we still
   *  want a basic score render. Not the full diagnostic surface. */
  fallbackReadiness?: FaffSeed['readiness'];
  /** Goal race slug · enables the gap-report renegotiation flow
   *  (Choose A/B/C → PATCH /api/race/[slug]). Null on runners with
   *  no active goal race · the gap report itself won't render either,
   *  so this is only the slug for the action target. */
  goalSlug?: string | null;
  /** 2026-06-03 · today's planned run completed yet?
   *  Drives the check-in prompt framing · pre/post-run distinction. */
  todayRunDone?: boolean;
  /** 2026-06-03 · today's planned workout type (easy / long / intervals
   *  / etc) · combined with todayRunDone to author the check-in prompt. */
  todayWorkoutType?: string | null;
  onViewFullHealth: () => void;
}) {
  // Auto-expand pull-back-band pillars per README `confounders=auto`
  // rule · seed the expanded set once per brief date, then let the
  // user's clicks be authoritative. Prior implementation recomputed
  // autoExpandedKeys on every render and OR'd it into isPillarOpen
  // (bug · sticky open · the runner couldn't collapse SLEEP/HRV when
  // the day's band was pull-back). David call 2026-06-01:
  // "i cant collapse these 2"
  //
  // Re-seed when brief.date changes (new day, or a fresh fetch for the
  // same day produces the same date and is silently skipped, preserving
  // any toggles the user made in this session).
  const seedExpanded = (b: ReadinessBriefSeed | null): Set<string> => {
    if (!b) return new Set();
    const lowBand = b.band === 'pull-back' || b.band === 'moderate';
    if (!lowBand) return new Set();
    return new Set(b.pillars.filter(p => p.band === 'pull-back').map(p => p.key));
  };
  const [expandedPillars, setExpandedPillars] = useState<Set<string>>(() => seedExpanded(brief));
  const [expandedStreaks, setExpandedStreaks] = useState<Set<string>>(new Set());
  const seededDateRef = useRef<string | null>(brief?.date ?? null);
  useEffect(() => {
    if (!brief) return;
    if (seededDateRef.current === brief.date) return;
    seededDateRef.current = brief.date;
    setExpandedPillars(seedExpanded(brief));
  }, [brief]);

  const isPillarOpen = (key: string) => expandedPillars.has(key);
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

  // 2026-06-01 · composition and trendNote now ship from backend
  // (commit 463d4a4c). Previously derived client-side; the backend
  // versions compose against streak + mover context and use the
  // composer's authoritative baseline math.
  const composition = brief?.composition ?? null;
  const trendNoteText = brief?.trendNote ?? null;

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
          <ColdStart
            coldStart={brief?.coldStart ?? null}
            onConnect={onViewFullHealth}
          />
        ) : brief ? (
          <>
            {/* 1 · Subjective override callout · renders first and loud. */}
            {brief.subjectiveOverride ? (
              <OverrideCallout ov={brief.subjectiveOverride} />
            ) : null}

            {/* 2 · Hero · score ring + band eyebrow + headline + mover. */}
            <Hero brief={brief} />

            {/* 2026-06-03 · Check-in moved to TOP per David's call:
                "shouldn't 'how do you feel' be at top and not 'this
                morning'? there's been times I want to push it but
                thought since it's not morning it might mess things up."
                Prompt is now time-of-day + run-state aware · pre/post
                run + morning/afternoon/night framing. Renders right
                under the hero so it's the first thing the runner sees. */}
            {brief.subjectiveCheckin && brief.subjectiveCheckin.answered === false ? (
              <FeelingCheckin
                todayRunDone={todayRunDone}
                todayWorkoutType={todayWorkoutType}
              />
            ) : null}

            {/* 2026-06-03 · Prescription · "what should I DO today" line.
                Authored from band + active streaks + planned workout type.
                Renders right under the hero so it's the first concrete
                action the runner sees. Hidden on cold-start (band='no-data'). */}
            {brief.prescription ? <PrescriptionCard p={brief.prescription} band={brief.band} /> : null}

            {/* Gap report moved 2026-06-01 · David call · "this info
                should not be in this today panel. it can fill out
                this middle panel in training better." The component
                still lives in this file (exported below) so the
                Train view can render it inside its PROJECTION card.
                Drawer-level mount removed · the readiness drawer is
                for body-state context, not goal-tracking. */}

            {/* 3 · 14-day score trend. When the runner has fewer than
                4 days of history the bar chart is misleading (one bar
                stretched full-width, axis labels collapse to the same
                day) · show an honest building-trend message instead. */}
            <Section label="14-DAY TREND">
              {brief.scoreTrend.length >= 4 ? (
                <>
                  <ScoreTrend trend={brief.scoreTrend} />
                  {trendNoteText ? (
                    <div className="rb-trendnote">{stripCitations(trendNoteText)}</div>
                  ) : null}
                </>
              ) : (
                <div className="rb-trendnote">
                  Building trend · {brief.scoreTrend.length} day{brief.scoreTrend.length === 1 ? '' : 's'} logged. A few more snapshots and the chart will fill in.
                </div>
              )}
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
                      <span className="rb-wdot" /> <span>{stripCitations(line)}</span>
                    </div>
                  ))}
                </div>
              </Section>
            ) : null}

            {/* 8 · Morning check-in MOVED TO TOP 2026-06-03 (now renders
                right after the Hero as <FeelingCheckin />) per David's
                call: "shouldn't 'how do you feel' be at top and not
                'this morning'? there's been times I want to push it but
                thought since it's not morning it might mess things up."
                The check-in is now first-class · the runner sees it
                before scrolling through the diagnostic. */}

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
          x="42" y="42"
          textAnchor="middle" dominantBaseline="central"
          fontFamily="Oswald, sans-serif" fontSize="34" fontWeight="600"
          fill="var(--txt)"
        >
          {brief.score}
        </text>
      </svg>
      <div className="rb-hwords">
        <div className="rb-eyebrow" style={{ color: ring }}>{brief.label}</div>
        <div className="rb-headline">{stripCitations(brief.headline)}</div>
        {brief.oneLineMover ? (
          <div className="rb-mover">{stripCitations(brief.oneLineMover)}</div>
        ) : null}
      </div>
    </div>
  );
}

/* ============================================================
   PrescriptionCard · "what should I DO today" line.
   2026-06-03 · authored by readiness-brief composePrescription · band-
   aware + streak-aware + planned-workout-aware. Renders right under
   the Hero so it's the first concrete action the runner sees.
   ============================================================ */
function PrescriptionCard({ p, band }: {
  p: NonNullable<ReadinessBriefSeed['prescription']>;
  band: ReadinessBriefSeed['band'];
}) {
  const accent = BAND_COLOR[band] ?? '#8A90A0';
  return (
    <div
      style={{
        marginTop: 14,
        padding: '12px 14px',
        borderRadius: 12,
        background: 'rgba(255,255,255,.04)',
        border: `1px solid ${accent}33`,
        borderLeft: `3px solid ${accent}`,
      }}
    >
      <div style={{
        fontSize: 10, fontWeight: 700, letterSpacing: 1.2,
        color: 'rgba(255,255,255,.55)', marginBottom: 6,
      }}>
        WHAT TO DO TODAY
      </div>
      <div style={{
        fontFamily: 'var(--font-display, Oswald, sans-serif)',
        fontSize: 17, lineHeight: 1.3, color: '#fff', marginBottom: 6,
      }}>
        {p.action}
      </div>
      <div style={{ fontSize: 12, color: 'rgba(255,255,255,.55)', lineHeight: 1.4 }}>
        {p.why}
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
      <div className="rb-ov-advice">{stripCitations(ov.advice)}</div>
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
   StreakRow · banner showing `short` by default, expanding to
   `meaning` on tap. Both fields ship from backend at commit
   463d4a4c.
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
      <div className="rb-streak-short">{stripCitations(streak.short)}</div>
      {open ? (
        <div className="rb-streak-body">{stripCitations(streak.meaning)}</div>
      ) : null}
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
  // Confounder split · only likely. "ALSO WORTH CHECKING" block was
  // dropped 2026-06-01 (David call · "just noise"). We surface only
  // the confounders the engine marks as likely behind this signal,
  // not every alternative the model could think of.
  const likely = pillar.confounders.filter(c => c.likely);
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
            {/* 2026-06-03 · skip baseline when it equals observedSub.
                For HRV/RHR/HR_recovery the engine sets both to the same
                "baseline Xms" string, producing a visible duplicate
                ("37ms · baseline 56ms · baseline 56ms"). For sleep/load
                the two fields carry different framing (sub = delta,
                baseline = target / sweet-spot) and stay distinct. */}
            {pillar.baseline && pillar.baseline !== pillar.observedSub
              ? <> · {pillar.baseline}</>
              : null}
          </div>
          <div className="rb-pil-meaning">{stripCitations(pillar.meaning)}</div>
          <PillarHistory trend={pillar.trend} observedValue={pillar.observedValue} accent={dot} />
          {likely.length > 0 ? (
            <div className="rb-pil-conf">
              <div className="rb-conf-h">MOST LIKELY BEHIND IT</div>
              {likely.map((c, i) => (
                <div className="rb-conf-row" key={`l-${i}`}>
                  {/* 2026-06-03 · render categoryTag (the cause: SLEEP /
                      LOAD / STRESS / etc) instead of pillar (which was
                      always the parent pillar key · self-referential and
                      misleading). Was: "MOST LIKELY BEHIND IT · HRV ·
                      Sleep deficit · check the sleep tile" · the "HRV"
                      chip read as "HRV is the cause" when the cause is
                      actually SLEEP. Now: "MOST LIKELY BEHIND IT · SLEEP ·
                      Sleep deficit · check the sleep tile". */}
                  <span className="rb-conf-k rb-conf-likely">{c.categoryTag ?? c.pillar.toUpperCase()}</span>
                  <span className="rb-conf-x">{stripCitations(c.explanation)}</span>
                </div>
              ))}
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
   ColdStart · band==='no-data' or null brief. Backend ships the
   coldStart envelope with nightsLogged / nightsNeeded / note /
   healthConnected as of commit 463d4a4c. The ring shows progress
   toward `nightsNeeded` (7); the note is composer-authored coach
   voice; the CTA only renders when HealthKit isn't connected.
   ============================================================ */
function ColdStart({ coldStart, onConnect }: {
  coldStart: NonNullable<ReadinessBriefSeed['coldStart']> | null;
  onConnect: () => void;
}) {
  const logged = coldStart?.nightsLogged ?? 0;
  const needed = coldStart?.nightsNeeded ?? 7;
  const remaining = Math.max(0, needed - logged);
  const note = coldStart?.note ??
    'A few more nights of sleep + HRV data and the morning brief will fill in.';
  const healthConnected = coldStart?.healthConnected ?? false;
  // Progress ring: stroke goes around as nights accumulate.
  const r = 50;
  const circ = 2 * Math.PI * r;
  const pct = needed > 0 ? Math.min(1, logged / needed) : 0;
  const offset = circ - circ * pct;
  return (
    <div className="rb-cold">
      <div className="rb-cold-ring">
        <svg width="120" height="120" viewBox="0 0 120 120" aria-hidden="true">
          <circle cx="60" cy="60" r={r} fill="none" stroke="rgba(255,255,255,0.10)" strokeWidth="8" />
          {pct > 0 ? (
            <circle
              cx="60" cy="60" r={r}
              fill="none"
              stroke="#48B3B5"
              strokeWidth="8"
              strokeLinecap="round"
              strokeDasharray={circ}
              strokeDashoffset={offset}
              transform="rotate(-90 60 60)"
            />
          ) : null}
        </svg>
        <div className="rb-cold-n">
          <b>{logged}</b>
          <small>of {needed}</small>
        </div>
      </div>
      <h2 className="rb-cold-h">Building your baseline.</h2>
      <p className="rb-cold-p">{stripCitations(note)}</p>
      {remaining > 0 ? (
        <div className="rb-cold-rem">
          {remaining} MORE NIGHT{remaining === 1 ? '' : 'S'} TO YOUR FIRST READINESS SCORE
        </div>
      ) : null}
      {!healthConnected ? (
        <button type="button" className="rb-cold-cta" onClick={onConnect}>
          Connect Apple Health to skip the wait
        </button>
      ) : null}
    </div>
  );
}

/* ============================================================
   FeelingCheckin · time-of-day + run-state aware check-in.
   2026-06-03 · replaces MorningCheckin per David's feedback ·
   "shouldn't 'how do you feel' be at top and not 'this morning'?"

   Authors the question text based on:
     · current local hour
     · whether today's planned run is done (todayRunDone)
     · what the planned workout was (todayWorkoutType)

   Prompts cover every realistic time/state combination so the runner
   never has to wonder "is it appropriate to log right now?" Whatever
   time you tap, the question fits. The check-in's rating math is
   unchanged · time context is captured in the row's created_at and
   informs voice tone downstream.
   ============================================================ */
function FeelingCheckin({ todayRunDone, todayWorkoutType }: {
  todayRunDone: boolean;
  todayWorkoutType: string | null;
}) {
  const [saving, setSaving] = useState<number | null>(null);
  const [done, setDone] = useState<{ rating: number; willOverride: boolean } | null>(null);
  const [err, setErr] = useState<string | null>(null);

  // Author prompt + label based on time + run state.
  const hour = new Date().getHours();
  const isMorning   = hour >= 4  && hour < 12;
  const isAfternoon = hour >= 12 && hour < 17;
  const isEvening   = hour >= 17 && hour < 22;
  // Late night (22-3) folds into "tonight" framing.
  const planned = (todayWorkoutType ?? '').toLowerCase();
  const isRestDay = planned === 'rest' || planned === '';

  let label: string;
  let question: string;
  if (todayRunDone) {
    label = 'POST-RUN CHECK-IN';
    question = 'How are you feeling after the run?';
  } else if (isMorning && !isRestDay) {
    label = 'CHECK-IN';
    question = 'How are you feeling heading into today?';
  } else if (isAfternoon && !isRestDay) {
    label = 'CHECK-IN';
    question = 'How are you feeling this afternoon?';
  } else if (isEvening) {
    label = 'CHECK-IN';
    question = 'How are you feeling tonight?';
  } else if (isRestDay) {
    label = 'CHECK-IN';
    question = 'How are you feeling today?';
  } else {
    label = 'CHECK-IN';
    question = 'How are you feeling right now?';
  }

  async function submit(rating: number) {
    setSaving(rating);
    setErr(null);
    try {
      const r = await fetch('/api/readiness/subjective', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ rating }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok && !(j as { ok?: boolean }).ok) {
        throw new Error((j as { error?: string }).error ?? `HTTP ${r.status}`);
      }
      setDone({
        rating,
        willOverride: !!(j as { willTriggerOverride?: boolean }).willTriggerOverride,
      });
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(null);
    }
  }

  if (done) {
    return (
      <div className="rb-checkin rb-checkin-done" style={{ marginTop: 14 }}>
        <div className="dcl">{label}</div>
        <div className="rb-checkin-msg">
          Logged · <b>{done.rating}/10</b>.
          {done.willOverride
            ? ' Your read disagrees with the numbers — yours wins on the next refresh.'
            : ' In line with today\'s read.'}
        </div>
      </div>
    );
  }

  return (
    <div className="rb-checkin" style={{ marginTop: 14 }}>
      <div className="dcl">{label}</div>
      <div className="rb-checkin-q">{question}</div>
      <div className="rb-checkin-scale">
        {[2, 4, 6, 8, 10].map((n) => (
          <button
            key={n}
            type="button"
            className="rb-checkin-btn"
            disabled={saving !== null}
            onClick={() => submit(n)}
          >
            {saving === n ? '…' : n}
          </button>
        ))}
      </div>
      <div className="rb-checkin-note">
        When your read disagrees with the numbers, yours wins.
      </div>
      {err ? <div className="rb-checkin-err">Could not save · {err}</div> : null}
    </div>
  );
}

/* ============================================================
   GapReportCard · "am I on track for my race goal?"
   Backend ships gapReport on every brief load (commit 237be875).
   6 sections, conditionally rendered:
     1. Headline · always · status-tinted
     2. Confidence band · when confidenceBand is non-null
     3. What closes it · always · 1-3 authored bullets
     4. Alternative ranges · when alternativeRanges is non-null ·
        interactive Choose buttons when daysToRenegotiate === 0
     5. Risk flags · when riskFlags has entries
     6. Citation footer · always · small
   Doctrine source: docs/PLAN_ENGINE_ARCHITECTURE.md §Phase 2.3
   ============================================================ */
type GapReport = NonNullable<ReadinessBriefSeed['gapReport']>;

const GAP_STATUS_COLOR: Record<GapReport['status'], string> = {
  closing:    '#3EBD41',
  static:     '#8A90A0',
  widening:   '#F3AD38',
  unclosable: '#FC4D64',
};

export function GapReportCard({ report, goalSlug }: {
  report: GapReport;
  goalSlug: string | null;
}) {
  const router = useRouter();
  const accent = GAP_STATUS_COLOR[report.status];
  const renegotiateNow = report.daysToRenegotiate === 0;

  // Renegotiation flow · click a Choose button → PATCH the race goal
  // → backend fires fireAutoRebuild → router.refresh re-pulls the seed
  // → the gap report reflects the new goal on next render.
  const [choosing, setChoosing] = useState<'a' | 'b' | 'c' | null>(null);
  const [chooseErr, setChooseErr] = useState<string | null>(null);
  async function chooseGoal(option: 'a' | 'b' | 'c') {
    if (!goalSlug || !report.alternativeRanges) return;
    const target = report.alternativeRanges[option];
    if (!target) return;
    setChoosing(option);
    setChooseErr(null);
    try {
      const r = await fetch(`/api/race/${encodeURIComponent(goalSlug)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ goalSec: target.sec, source: 'renegotiate' }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !(j as { ok?: boolean }).ok) {
        throw new Error((j as { error?: string }).error ?? `HTTP ${r.status}`);
      }
      router.refresh();
    } catch (e) {
      setChooseErr(e instanceof Error ? e.message : String(e));
    } finally {
      setChoosing(null);
    }
  }

  return (
    <div className="rb-gap" style={{ borderColor: `${accent}55` }}>
      {/* Section 1 · Headline · status-tinted */}
      <div className="rb-gap-headline" style={{ color: accent }}>
        {stripCitations(report.headline)}
      </div>

      {/* Section 2 · Confidence band · 3 stops on a horizontal axis */}
      {report.confidenceBand ? (
        <div className="rb-gap-band">
          <div className="dcl rb-gap-band-label">CONFIDENCE BAND</div>
          <div className="rb-gap-band-row">
            <div className="rb-gap-band-stop">
              <div className="t">{fmtTimeFromSec(report.confidenceBand.p25Sec)}</div>
              <div className="k">p25</div>
            </div>
            <div className="rb-gap-band-line" style={{ background: `${accent}55` }} />
            <div className="rb-gap-band-stop rb-gap-band-mid">
              <div className="t">{fmtTimeFromSec(report.confidenceBand.medianSec)}</div>
              <div className="k">median</div>
            </div>
            <div className="rb-gap-band-line" style={{ background: `${accent}55` }} />
            <div className="rb-gap-band-stop">
              <div className="t">{fmtTimeFromSec(report.confidenceBand.p75Sec)}</div>
              <div className="k">p75</div>
            </div>
          </div>
        </div>
      ) : null}

      {/* Section 3 · What closes it · authored bullets */}
      {report.whatClosesIt.length > 0 ? (
        <div className="rb-gap-closes">
          <div className="dcl">WHAT CLOSES IT</div>
          {report.whatClosesIt.map((line, i) => (
            <div className="rb-gap-bullet" key={i}>
              <span className="dot" /> <span>{stripCitations(line)}</span>
            </div>
          ))}
        </div>
      ) : null}

      {/* Section 4 · Alternative ranges · informational or interactive */}
      {report.alternativeRanges ? (
        <div className="rb-gap-ranges">
          <div className="rb-gap-ranges-h">
            <div className="dcl">REALISTIC OUTCOMES</div>
            {renegotiateNow && goalSlug ? (
              <span className="rb-gap-ranges-hint">Adjust goal →</span>
            ) : null}
          </div>
          {(['a', 'b', 'c'] as const).map((key) => {
            const opt = report.alternativeRanges![key];
            return (
              <div className="rb-gap-range-row" key={key}>
                <span className="rb-gap-range-k">{key.toUpperCase()}</span>
                <span className="rb-gap-range-t">{fmtTimeFromSec(opt.sec)}</span>
                <span className="rb-gap-range-l">{opt.label}</span>
                {renegotiateNow && goalSlug ? (
                  <button
                    type="button"
                    className="rb-gap-choose"
                    disabled={choosing !== null}
                    onClick={() => chooseGoal(key)}
                  >
                    {choosing === key ? 'Setting…' : 'Choose'}
                  </button>
                ) : null}
              </div>
            );
          })}
          {chooseErr ? (
            <div className="rb-gap-err">Could not update goal · {chooseErr}</div>
          ) : null}
        </div>
      ) : null}

      {/* Section 5 · Risk flags */}
      {report.riskFlags.length > 0 ? (
        <div className="rb-gap-risks">
          <div className="dcl">PLAN RISKS</div>
          {report.riskFlags.map((line, i) => (
            <div className="rb-gap-bullet" key={i}>
              <span className="dot rb-gap-risk-dot" /> <span>{stripCitations(line)}</span>
            </div>
          ))}
        </div>
      ) : null}

      {/* Section 6 · Citation footer removed 2026-06-01 (David lock ·
          "No citations, every anywhere for any reason"). The backend
          gap-report brief asked for the docs/PLAN_ENGINE_ARCHITECTURE
          reference as a "trust contract" footer but the locked rule
          overrides · no doctrine references on the runner's screen,
          ever. Field stays on the seed payload for diagnostics but
          never renders. */}
    </div>
  );
}
