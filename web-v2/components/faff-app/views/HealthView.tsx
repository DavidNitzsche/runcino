'use client';

/**
 * HealthView · big redesign per designs/from Design agent/health-page/
 * (handed off 2026-06-01). The "all-knowing" recovery dashboard.
 *
 * Architecture · glance → scan → drill:
 *   1. GLANCE · hero (gauge + drivers + 7-day trend) · one focal point
 *   2. SCAN   · uniform bar-cards across labeled domains
 *   3. DRILL  · tap-to-expand on tiles (preserved from prior view)
 *
 * Page order (top → bottom):
 *   - Header
 *   - HERO (3-col: gauge · drivers · aerobic+trend)
 *   - THE STORY + WATCHING TOMORROW (2-col intelligence row)
 *   - RECOVERY PHASE (rendered when seed.health.recoveryPhase exists)
 *   - BODY metric grid (bar-cards)
 *   - SLEEP STAGES (split out from BODY · architecture line + 4 stage tiles)
 *   - FORM metric grid
 *   - DEEPER INSIGHTS (training form · vs last build · DOW · predictors ·
 *                       heat · cycle-female-only)
 *
 * Per the doctrine: every section degrades to ABSENT (not a placeholder)
 * when its field is null. Sections that need backend wiring that hasn't
 * landed yet (recoveryPhase, aerobicFitness, forecasts, blockComparison,
 * dowPatterns, qualityPredictors, heatAcclim, cycle) simply don't render
 * for the current data shape.
 */
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { FaffSeed, HealthMetric, DriverRow } from '../types';
import { ManualHealthSheet } from '../toolkit';

// Status palette · matches the design tokens. HealthMetric.status uses
// 'warn' (not 'watch') so the keys align with that union; 'bad' is kept
// as a separate constant for the "below target" red since HealthMetric
// has no equivalent · `warn` covers both watch and bad cases per the
// existing data shape.
const STATUS: Record<'good' | 'warn' | 'neutral', string> = {
  good: '#5fd06a', warn: '#F3AD38', neutral: '#5bbfb0',
};
// Standalone colors for the non-HealthMetric paths (gauge bands, driver
// thresholds, recovery percentages).
const COLOR_BAD = '#FC4D64';
const COLOR_GOOD = '#5fd06a';
const COLOR_WATCH = '#F3AD38';
const COLOR_TEAL = '#5bbfb0';
// Readiness band colors · also from the design
const BAND: Record<string, string> = {
  sharp: '#34D058', ready: '#3EBD41', moderate: '#F3AD38',
  'pull-back': '#FC4D64', 'no-data': '#8A90A0',
};

function fmtValue(m: HealthMetric): string {
  // 2026-06-03 · honest empty state · when the source signal isn't
  // tracked (watch not worn, no Apple Health connection, etc.) we
  // render an em-dash rather than the placeholder 0 the seed carries
  // for shape stability. Backend ships noData=true on the metric so
  // every reader (web tile, iPhone Health page, brief copy) can opt in.
  if (m.noData) return '—';
  const v = m.current;
  if (m.clock) {
    const h = Math.floor(v);
    const mn = Math.round((v - h) * 60);
    return `${h}:${String(mn).padStart(2, '0')}`;
  }
  return v.toFixed(m.decimals ?? 0);
}

function avg(a: number[]): number {
  if (!a.length) return 0;
  return a.reduce((s, v) => s + v, 0) / a.length;
}

/** Bar-card · the canonical metric tile (replaces the smooth-line spark).
 *  14 mini bars · last bar = today, colored by status · others muted ·
 *  optional dashed target line · caption + status tag at the bottom. */
function BarCard({ m, onClick, active }: { m: HealthMetric; onClick?: () => void; active?: boolean }) {
  const series = m.series.slice(-14);
  const baseColor = STATUS[m.status] ?? STATUS.neutral;
  // HealthMetric.status is 'good' | 'warn' | 'neutral'. The chip text
  // depends on targetKind so it matches the caption · "BELOW BASELINE"
  // when the caption is "baseline 54ms", "BELOW TARGET" when the caption
  // is "target 7:30", "BELOW AVG" when "7d avg 1800kcal". Old code always
  // said "below target" / "on target" which contradicted baseline tiles
  // (HRV / RHR / wrist-temp / resp-rate / spo2 all caption baseline but
  // chip claimed target). 2026-06-03 · David's Health page QC.
  const TARGET_NOUN: Record<NonNullable<HealthMetric['targetKind']> | 'default', string> = {
    baseline: 'baseline', target: 'target', avg7: 'avg', default: 'target',
  };
  const targetNoun = TARGET_NOUN[m.targetKind ?? 'default'];
  // 2026-06-03 · "below" was lying about direction for low-is-better
  // metrics. David's RHR is 50 bpm vs baseline 45 bpm · he's ABOVE
  // baseline (higher RHR = worse), but the chip read "BELOW BASELINE".
  // Same bug on Awake (above 30 min = warn), Resp Rate (above baseline
  // = warn). Generic "off ${noun}" is direction-agnostic and honest for
  // every metric · the COLOR (yellow) still communicates "this is the
  // concerning state."
  const STATUS_TXT: Record<HealthMetric['status'], string> = {
    good: `on ${targetNoun}`, warn: `off ${targetNoun}`, neutral: 'steady',
  };
  // Local scale so the bars use the full mini-chart height
  let lo = series.length ? Math.min(...series) : 0;
  let hi = series.length ? Math.max(...series) : 1;
  if (m.target != null) { lo = Math.min(lo, m.target); hi = Math.max(hi, m.target); }
  const pad = (hi - lo) * 0.18 || 1;
  lo -= pad; hi += pad;
  const span = (hi - lo) || 1;
  const tlinePct = m.target != null
    ? 100 - (8 + ((m.target - lo) / span) * 92)
    : null;
  // 2026-06-03 · target source labeling. `m.targetKind` differentiates
  // runner-baseline (HRV/RHR/wrist-temp) from research-target (sleep
  // 7.5h, cadence 170spm) from 7-day-avg (active energy). Old caption
  // said "target X" universally · misleading when the comparator was
  // actually the runner's own baseline.
  const targetValStr = m.target != null
    ? (m.clock ? fmtClock(m.target) : m.target.toFixed(m.decimals ?? 0))
    : null;
  const targetPrefix = m.targetKind === 'baseline'
    ? 'baseline'
    : m.targetKind === 'avg7'
      ? '7d avg'
      : 'target';
  const caption = targetValStr != null
    ? `${targetPrefix} ${targetValStr}`
    : m.band
      ? `band ${m.band[0]}–${m.band[1]}`
      : '30-day';
  return (
    <div
      className={`hmc${active ? ' on' : ''}${onClick ? ' clickable' : ''}`}
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
    >
      <div className="hmc-top">
        <span className="hmc-k">
          <span className="dot" style={{ background: baseColor }} />
          {m.label.replace(' MAX', '')}
        </span>
      </div>
      <div className="hmc-v">
        {fmtValue(m)}
        {m.unit ? <small>{m.unit}</small> : null}
      </div>
      <div className="hmc-bars">
        {tlinePct != null ? (
          <span className="hmc-tline" style={{ top: `${tlinePct}%` }} />
        ) : null}
        {/* 2026-06-03 · only show the "no data yet" empty-state when the
            tile truly has NO value · `m.noData` is the canonical signal
            from the producer. Previously this triggered on
            `series.length === 0` which fired for tiles that DO carry a
            current value but no 14d trend yet (MAX HR, LIGHT SLEEP,
            AWAKE, HRV CV before 21d history). Those rendered the value
            in the headline AND "no data yet" in the chart band —
            contradictory. Now those tiles just show the value with an
            empty band, no chart placeholder. */}
        {series.length === 0 && m.noData ? (
          <span className="hmc-empty">no data yet</span>
        ) : series.length === 0 ? (
          <span className="hmc-empty hmc-empty-trend">trend builds with daily syncs</span>
        ) : null}
        {series.map((v, i) => {
          const h = series.length > 1 ? 8 + ((v - lo) / span) * 92 : 50;
          const isToday = i === series.length - 1;
          return (
            <i
              key={i}
              style={{
                height: `${h}%`,
                background: isToday ? baseColor : 'rgba(255,255,255,.16)',
              }}
            />
          );
        })}
      </div>
      <div className="hmc-cap">
        <span className="lo">{caption}</span>
        <span className="st" style={{ color: baseColor }}>
          {m.noData ? 'no data' : STATUS_TXT[m.status]}
        </span>
      </div>
    </div>
  );
}

function fmtClock(v: number): string {
  const h = Math.floor(v);
  const mn = Math.round((v - h) * 60);
  return `${h}:${String(mn).padStart(2, '0')}`;
}

/** Hero gauge · large ring with the score in the middle, arc colored by band. */
function HeroGauge({ score, band }: { score: number; band: string }) {
  const stroke = BAND[band] ?? BAND['no-data'];
  const dash = 628.3;
  const offset = dash - (Math.max(0, Math.min(100, score)) / 100) * dash;
  return (
    <div className="hh-gauge">
      <svg viewBox="0 0 240 240" width="100%" height="100%">
        <circle cx="120" cy="120" r="100" fill="none" stroke="rgba(255,255,255,.1)" strokeWidth="16" />
        <circle
          cx="120" cy="120" r="100" fill="none"
          stroke={stroke} strokeWidth="16" strokeLinecap="round"
          strokeDasharray={dash} strokeDashoffset={offset}
          transform="rotate(-90 120 120)"
          style={{ filter: `drop-shadow(0 0 9px ${stroke}73)` }}
        />
      </svg>
      <div className="hh-gauge-cv">
        <span className="hh-num">{Math.round(score)}</span>
      </div>
    </div>
  );
}

/** Driver row · status dot + label + observed/baseline + center-anchored
 *  contribution bar + big signed pts. */
function DriverRowEl({ d }: { d: DriverRow }) {
  const ptsAbs = Math.abs(d.pts);
  const col = d.pts <= -8 ? COLOR_BAD
    : d.pts < 0 ? COLOR_WATCH
    : d.pts > 0 ? COLOR_GOOD
    : '#8aa0a0';
  const width = Math.min(46, ptsAbs * 3.2 + 4);
  const sign = d.pts > 0 ? '+' : d.pts < 0 ? '−' : '';
  return (
    <div className="hdrv">
      <div className="hdrv-l">
        <div className="hdrv-n">
          <span className="hdrv-dot" style={{ background: col }} />
          {d.name}
        </div>
        <div className="hdrv-v">{d.why}</div>
      </div>
      <span className="hdrv-bar">
        <span className="ax" />
        {d.pts !== 0 ? (
          <i
            style={{
              [d.pts > 0 ? 'left' : 'right']: '50%',
              width: `${width}%`,
              background: col,
              boxShadow: `0 0 8px -2px ${col}`,
            } as React.CSSProperties}
          />
        ) : null}
      </span>
      <span className="hdrv-p" style={{ color: col }}>{sign}{ptsAbs}</span>
    </div>
  );
}

/** Streak sparkline · per-pillar bars showing the metric's recent values
 *  with a dashed baseline. Trailing below-baseline bars red. */
function StreakSparkline({
  pillar, days, baseline, series, note,
}: {
  pillar: string; days: number; baseline: number | null; series: number[]; note: string;
}) {
  if (series.length === 0) return null;
  const all = baseline != null ? [...series, baseline] : series;
  let lo = Math.min(...all);
  let hi = Math.max(...all);
  const pad = (hi - lo) * 0.2 || 1;
  lo -= pad; hi += pad;
  const span = (hi - lo) || 1;
  const baselinePct = baseline != null ? 100 - ((baseline - lo) / span) * 100 : null;
  return (
    <div className="hstk">
      <div className="hstk-h">
        <span className="hstk-k">{pillar.toUpperCase()}</span>
        <span className="hstk-d"><b>{days} days</b> below · {note}</span>
      </div>
      <div className="hstk-sp">
        {baselinePct != null ? (
          <span className="hstk-base" style={{ top: `${baselinePct}%` }} />
        ) : null}
        {series.map((v, i) => {
          const h = 8 + ((v - lo) / span) * 92;
          const isStreakDay = i >= series.length - days;
          return (
            <i
              key={i}
              style={{
                height: `${h}%`,
                background: isStreakDay ? COLOR_BAD : 'rgba(255,255,255,.18)',
              }}
            />
          );
        })}
      </div>
    </div>
  );
}

export function HealthView({ seed }: { seed: FaffSeed }) {
  const router = useRouter();
  const { readiness, body, form, sleepArchitectureVerdict } = seed.health;
  const brief = seed.readinessBrief;
  const [logOpen, setLogOpen] = useState(false);
  const [openTile, setOpenTile] = useState<string | null>(null);

  // Split sleep tiles out of BODY into their own SLEEP STAGES grid.
  // 2026-06-04 · David: "need a sleep duration here so I can see last
  // nights sleep but also the bar chart history."  Sleep DURATION
  // (k:'sleep') moved into the same section as the stages so the runner
  // sees the total + the 4 stages side by side.  Sorted so DURATION
  // renders first (leftmost) · it's the headline number, stages are
  // the breakdown.
  const sleepKeys = new Set(['sleep', 'sleep_deep', 'sleep_rem', 'sleep_light', 'sleep_awake']);
  const sleepOrder = ['sleep', 'sleep_deep', 'sleep_rem', 'sleep_light', 'sleep_awake'];
  const bodyTiles = body.filter(m => !sleepKeys.has(m.k));
  const sleepTiles = body
    .filter(m => sleepKeys.has(m.k))
    .sort((a, b) => sleepOrder.indexOf(a.k) - sleepOrder.indexOf(b.k));

  // Band-aware verdict line under the gauge · pulls from readinessBrief
  // when present (richer narration), falls back to readiness.coach.
  const verdictText = brief?.headline ?? readiness.coach;
  const band = brief?.band ?? (
    readiness.score >= 85 ? 'sharp'
    : readiness.score >= 70 ? 'ready'
    : readiness.score >= 55 ? 'moderate'
    : 'pull-back'
  );
  const baseline = brief?.composition?.baseline ?? readiness.baseline;
  const todayScore = brief?.composition?.today ?? readiness.score;
  const net = brief?.composition?.net ?? (todayScore - baseline);

  // 7-day readiness bars · prefer brief.scoreTrend (richer), fall back to
  // readiness.trend.
  const weekScores = brief?.scoreTrend?.slice(-7).map(d => d.score) ?? readiness.trend.slice(-7);
  const weekDays = brief?.scoreTrend?.slice(-7).map(d => {
    const dt = new Date(d.date + 'T12:00:00');
    return dt.toLocaleDateString(undefined, { weekday: 'short' }).toUpperCase();
  }) ?? readiness.trendDays.slice(-7);
  const weekMin = weekScores.length ? Math.min(...weekScores) - 8 : 35;
  const weekMax = weekScores.length ? Math.max(...weekScores) + 8 : 90;

  // Streak data · combine pillar trend (from brief.pillars[].trend) with
  // streak metadata (from brief.streaks[]).
  const pillarTrends = new Map(brief?.pillars.map(p => [p.key, p]) ?? []);
  const streakRows = (brief?.streaks ?? []).filter(s => s.direction === 'below').slice(0, 3);

  // Training-form insight derived from seed.form (no backend brief needed).
  const trainingForm = seed.form?.label
    ? { label: seed.form.label, delta: seed.form.delta }
    : null;

  return (
    <>
      <div className="top">
        <div>
          <div className="date">Health</div>
          <div className="wk">Recovery &amp; form · {todayShort()}</div>
        </div>
        <button
          type="button"
          onClick={() => setLogOpen(true)}
          className="hview-logbtn"
        >
          + Log measurement
        </button>
      </div>

      {/* ===== HERO ===== */}
      <div className="hhero2">
        <div className="hhero2-grid">
          {/* Score column */}
          <div className="hh-score">
            <HeroGauge score={todayScore} band={band} />
            <div className="hh-verdict">{verdictText}</div>
            <div className="hh-base">
              14-day baseline <b>{Math.round(baseline)}</b> · today <b>{Math.round(todayScore)}</b>
              {' · '}
              <b style={{ color: net >= 0 ? COLOR_GOOD : COLOR_BAD }}>
                {net >= 0 ? '+' : '−'}{Math.abs(Math.round(net))}
              </b>
            </div>
          </div>

          {/* Drivers column */}
          <div className="hh-drivers">
            <div className="hh-lbl">WHAT IS DRIVING IT</div>
            <div className="hh-drvlist">
              {readiness.drivers.map(d => (
                <DriverRowEl key={d.name} d={d} />
              ))}
            </div>
          </div>

          {/* Right column · aerobic fitness (when present) above 7-day trend */}
          <div className="hh-week">
            {seed.health.aerobicFitness ? (() => {
              const af = seed.health.aerobicFitness;
              const delta = af.currentDriftPct - af.blockStartDriftPct;
              const absDelta = Math.abs(delta);
              // 2026-06-03 · zone chip stays (David's "you can leave the
              // BUILDING" · it tells him where his number lands) but the
              // bands "key" reference is dropped (he didn't need the
              // taxonomy).
              const arrow = delta < -0.1 ? '↓' : delta > 0.1 ? '↑' : '→';
              const arrowClass = delta < -0.1 ? 'good' : delta > 0.1 ? 'bad' : 'flat';
              const deltaLabel = absDelta < 0.1
                ? 'holding steady'
                : `${arrow} ${absDelta.toFixed(1)}pp ${delta < 0 ? 'better' : 'worse'} over ${af.weeksTracked} week${af.weeksTracked === 1 ? '' : 's'}`;
              return (
                <div className="haero">
                  <div className="haero-k">AEROBIC FITNESS · LOWER IS BETTER</div>
                  <div className="haero-v">
                    {af.blockStartDriftPct.toFixed(1)}%
                    {' → '}
                    {af.currentDriftPct.toFixed(1)}%
                  </div>
                  <div className={`haero-delta haero-delta-${arrowClass}`}>{deltaLabel}</div>
                  {af.currentZone ? (
                    <span className={`haero-chip haero-chip-${af.currentZone}`}>
                      {af.currentZone === 'race-ready' ? 'RACE-READY'
                        : af.currentZone === 'building' ? 'BUILDING'
                        : af.currentZone === 'developing' ? 'DEVELOPING'
                        : 'EARLY BASE'}
                    </span>
                  ) : null}
                  <div className="haero-m">{af.summary}</div>
                  {af.whatItIs ? (
                    <div className="haero-what">{af.whatItIs}</div>
                  ) : null}
                </div>
              );
            })() : null}
            <div className="hh-wk-head">
              {/* 2026-06-03 · honest about coverage. The label said
                  "7-DAY READINESS" even when only 3 days of trend data
                  existed (cold-start / partial backfill). Reflect actual
                  coverage so the runner doesn't read 3 bars as 7 days
                  of evidence. */}
              <span className="l">{weekScores.length === 7 ? '7-DAY' : `${weekScores.length}-DAY`} READINESS</span>
              <span className="r">
                NOW <b>{Math.round(todayScore)}</b> &nbsp;·&nbsp; AVG <b>{Math.round(avg(weekScores))}</b>
              </span>
            </div>
            <div className="hh-wkbars">
              {weekScores.map((v, i) => {
                const h = 18 + ((v - weekMin) / (weekMax - weekMin || 1)) * 82;
                const isToday = i === weekScores.length - 1;
                return (
                  <div
                    key={i}
                    className={`hh-wb${isToday ? ' now' : ''}`}
                    style={{
                      height: `${h}%`,
                      background: isToday ? (BAND[band] ?? BAND['no-data']) : 'rgba(255,255,255,.14)',
                      boxShadow: isToday ? `0 0 12px -2px ${BAND[band] ?? BAND['no-data']}` : undefined,
                    }}
                  />
                );
              })}
            </div>
            <div className="hh-wkdays">
              {weekDays.map((d, i) => <span key={i}>{d}</span>)}
            </div>
          </div>
        </div>
      </div>

      {/* ===== STORY + WATCHING (only when brief is present) ===== */}
      {brief ? (
        <div className="hstoryrow">
          <div className="hsynth">
            <span className="hsynth-tag">THE STORY</span>
            <p className="hsynth-tx">{brief.synthesis ?? brief.trendNote ?? brief.headline}</p>
            {streakRows.length > 0 ? (
              <div className="hstreaks">
                {streakRows.map((s, i) => {
                  const pillar = pillarTrends.get(s.pillar as 'sleep' | 'hrv' | 'rhr' | 'load' | 'hr_recovery');
                  const series = pillar?.trend.map(t => t.value) ?? [];
                  const baselineNum = parseFloat(pillar?.baseline?.match(/[\d.]+/)?.[0] ?? '0') || null;
                  return (
                    <StreakSparkline
                      key={`${s.pillar}-${i}`}
                      pillar={s.pillar}
                      days={s.days}
                      baseline={baselineNum}
                      series={series}
                      note={s.short}
                    />
                  );
                })}
              </div>
            ) : null}
          </div>
          <div className="hwatch">
            {/* 2026-06-03 · WHAT TO DO replaces WATCHING TOMORROW per
                David's ask: "instead of watching tomorrow · can we
                surface something about actions to take? Run slower,
                sleep more, etc whatever it is based on data."

                Each action is tied to a real trigger in
                lib/coach/health-actions.ts. The frontend just renders
                · no extrapolation. Priority chip color: urgent=red,
                high=amber, medium=yellow, low=neutral, on-course=green. */}
            <span className="hsynth-tag watch-tag">WHAT TO DO</span>
            <div className="hwatch-list">
              {(brief.actions ?? []).map((a, i) => {
                const priorityClass =
                  a.priority === 'urgent' ? 'hact-pri-urgent' :
                  a.priority === 'high' ? 'hact-pri-high' :
                  a.priority === 'medium' ? 'hact-pri-medium' :
                  a.priority === 'on-course' ? 'hact-pri-on-course' :
                  'hact-pri-low';
                const priorityLabel =
                  a.priority === 'on-course' ? 'ON COURSE' :
                  a.priority.toUpperCase();
                return (
                  <div key={i} className="hwatch-row hact-row">
                    <span className={`hact-pri ${priorityClass}`}>{priorityLabel}</span>
                    <div className="hact-body">
                      <div className="hact-action">{a.action}</div>
                      <div className="hact-cite">{a.cite}</div>
                    </div>
                  </div>
                );
              })}
              {/* Defensive empty state · should never fire (the actions
                  builder always returns at least an ON COURSE entry)
                  but keeps the panel honest if the envelope is stale. */}
              {!brief.actions?.length ? (
                <div className="hwatch-empty">Building your picture · keep syncing.</div>
              ) : null}
            </div>
            {/* 2026-06-03 · transparency line ("option C" per David) · what
                the engine is watching for and how close the runner is to
                each trigger. Tier-aware · advanced runners see 5-day
                streak thresholds, beginners see 3-day. Empty string when
                all soft rules are already at threshold (panel above
                already fired). */}
            {brief.actionsThreshold ? (
              <div className="hact-threshold">{brief.actionsThreshold}</div>
            ) : null}
          </div>
        </div>
      ) : null}

      {/* ===== RECOVERY PHASE (when present · post-hard-session) =====
          2026-06-03 · David's QC: "this whole section is nice but tbh
          it doesnt seem like its working right." Three things fixed:
            1. "Day 3 of 2 expected" math edge · dropped the /M
               framing entirely. Now reads "Day 3 since the long run"
               with no implied countdown.
            2. "Earliest quality session: YYYY-MM-DD · resume on feel"
               line · gutted per no-reactive-coach doctrine. The engine
               doesn't tell the runner when to do quality.
            3. message rephrased as conversational coach voice rather
               than data stamp · drives the headline line below the bar.
      */}
      {seed.health.recoveryPhase ? (() => {
        const rp = seed.health.recoveryPhase;
        // 2026-06-03 · severity → color · replaces the pcol(percent)
        // mapping. Backend now ships severity directly per pillar.
        const sevColor = (s: 'good' | 'watch' | 'bad' | 'no-data' | undefined) =>
          s === 'good' ? COLOR_GOOD :
          s === 'watch' ? COLOR_WATCH :
          s === 'bad' ? COLOR_BAD :
          'rgba(255,255,255,.4)';
        const dayLabel = rp.daysSince === 0
          ? 'Today'
          : rp.daysSince === 1
            ? '1 day after'
            : `${rp.daysSince} days after`;

        return (
          <div className="hrecov">
            <div className="hrecov-head">
              <div>
                <div className="hrecov-eyebrow">RECOVERING FROM</div>
                <div className="hrecov-anchor">{rp.anchor.label}</div>
              </div>
              {/* 2026-06-03 · panel-level "X%" header dropped per David's
                  "what does this mean? just sort of random..." feedback.
                  The aggregate % across mixed-unit pillars was opaque ·
                  the timeframe alone carries the temporal anchor. */}
              <div className="hrecov-tl">
                <div className="hrecov-day hrecov-day-solo">{dayLabel}</div>
              </div>
            </div>
            {/* 2026-06-03 · per-pillar bar visualization dropped · the
                statusLine below speaks for itself. Each row shows the
                actual value + the delta in plain English. */}
            <div className="hrecov-grid hrecov-grid-v2">
              {rp.pillars.map(p => {
                const hasValue = p.currentValue != null;
                const unit =
                  p.key === 'hrv' ? 'ms' :
                  p.key === 'rhr' || p.key === 'hr_recovery' ? ' bpm' :
                  p.key === 'sleep' ? 'h' : '';
                const valueStr = hasValue
                  ? p.key === 'hr_recovery'
                    ? `${p.currentValue} bpm drop`
                    : `${p.currentValue}${unit}`
                  : 'no data';
                return (
                  <div key={p.key} className="hrcp hrcp-v2">
                    <div className="hrcp-k">{p.label}</div>
                    <div className="hrcp-val">{valueStr}</div>
                    <div className="hrcp-status" style={{ color: sevColor(p.severity) }}>
                      {p.statusLine || 'no data'}
                    </div>
                  </div>
                );
              })}
            </div>
            {rp.muscleSignals?.summary ? (
              <div className="hrecov-muscle">
                <span className="md" />
                <span>{rp.muscleSignals.summary}</span>
              </div>
            ) : null}
            {/* 2026-06-03 · headline reads from rp.message (now
                conversational coach voice). Old "Earliest quality
                session · YYYY-MM-DD · resume on feel" line is gone.
                Doctrine reference below states the typical recovery
                window as info, not a countdown. */}
            <div className="hrecov-green">{rp.message}</div>
            {rp.expectedWindowDoctrine ? (
              <div className="hrecov-doc">{rp.expectedWindowDoctrine}</div>
            ) : null}
          </div>
        );
      })() : null}

      {/* ===== BODY ===== */}
      {bodyTiles.length > 0 ? (
        <div className="band">
          <div className="hseclbl2">
            <span className="t">BODY</span>
            <span className="ln" />
          </div>
          <div className="hgrid">
            {bodyTiles.map(m => (
              <BarCard
                key={m.k}
                m={m}
                active={openTile === m.k}
                onClick={() => setOpenTile(openTile === m.k ? null : m.k)}
              />
            ))}
          </div>
        </div>
      ) : null}

      {/* ===== SLEEP STAGES ===== */}
      {sleepTiles.length > 0 ? (
        <div className="band">
          <div className="hseclbl2">
            <span className="t">SLEEP STAGES</span>
            <span className="ln" />
          </div>
          {sleepArchitectureVerdict ? (
            <div className="harchline">
              Architecture <b>{sleepArchitectureVerdict}</b> across the last 7 nights
              {(() => {
                // 2026-06-05 · multi-tenant audit Pattern 4 fix · gate
                // each stage on !m.noData. seed.ts coerces null→0 for
                // shape stability, so a runner without sleep staging
                // (Strava-only, no watch) had `current: 0` on all four
                // stages with `noData: true` carried alongside. This
                // math then divided by zero and rendered "·% deep, %
                // REM" with NaN. The architecture verdict already says
                // 'healthy_architecture' or 'architecture_off' based
                // on REAL data; the percentages tail just needs to
                // skip when stages aren't measured.
                //
                // Cite: docs/2026-06-05-multi-tenant-audit.html § Pattern 4.
                const pick = (k: string): number => {
                  const m = sleepTiles.find((t) => t.k === k);
                  if (!m || m.noData) return 0;
                  return m.current ?? 0;
                };
                const deep = pick('sleep_deep');
                const rem = pick('sleep_rem');
                const light = pick('sleep_light');
                const awake = pick('sleep_awake');
                const total = deep + rem + light + awake;
                if (total > 0) {
                  const dPct = Math.round((deep / total) * 100);
                  const rPct = Math.round((rem / total) * 100);
                  return ` · ${dPct}% deep, ${rPct}% REM.`;
                }
                return '.';
              })()}
            </div>
          ) : null}
          <div className="hgrid">
            {sleepTiles.map(m => (
              <BarCard
                key={m.k}
                m={m}
                active={openTile === m.k}
                onClick={() => setOpenTile(openTile === m.k ? null : m.k)}
              />
            ))}
          </div>
        </div>
      ) : null}

      {/* ===== FORM ===== */}
      {form.length > 0 ? (
        <div className="band">
          <div className="hseclbl2">
            <span className="t">FORM</span>
            <span className="ln" />
          </div>
          <div className="hgrid">
            {form.map(m => (
              <BarCard
                key={m.k}
                m={m}
                active={openTile === m.k}
                onClick={() => setOpenTile(openTile === m.k ? null : m.k)}
              />
            ))}
          </div>
        </div>
      ) : null}

      {/* ===== DEEPER INSIGHTS ===== */}
      {(trainingForm
        || seed.health.heatAcclim
        || seed.health.blockComparison
        || seed.health.dowPatterns
        || seed.health.qualityPredictors
        || (seed.user.biologicalSex === 'female' && seed.health.cyclePerformance)
      ) ? (
        <div className="band">
          <div className="hseclbl2">
            <span className="t">DEEPER INSIGHTS</span>
            <span className="ln" />
          </div>
          <div className="hinsgrid">
            {trainingForm ? (
              <div className="hins">
                <div className="hins-k">TRAINING FORM</div>
                <div className="hins-h">
                  {trainingForm.delta >= 0 ? '+' : '−'}
                  {Math.abs(Math.round(trainingForm.delta))} · {trainingForm.label}
                </div>
                <div className="hins-m">
                  Fitness {seed.form.fitness} · Fatigue {seed.form.fatigue}.
                  {seed.form.acwr != null ? ` ACWR ${seed.form.acwr.toFixed(2)}.` : ''}
                </div>
                {/* 2026-06-03 · trimmed per David's "way too wordy" QC.
                    Keeps the band reference (the most actionable info)
                    + 1-line context. Drops the full TSB explanation. */}
                <div className="hins-what">
                  Form = Fitness − Fatigue. Negative is normal in a build.
                  <br />
                  <b>&gt;+25</b> fresh · <b>+5/+25</b> race-ready · <b>−5/+5</b> productive · <b>−5/−15</b> loaded · <b>&lt;−15</b> overreach.
                </div>
              </div>
            ) : null}
            {seed.health.blockComparison ? (
              <div className="hins">
                <div className="hins-k">VS {seed.health.blockComparison.referenceBlock.label.toUpperCase()}</div>
                <div className="hins-h">{seed.health.blockComparison.message}</div>
                {/* 2026-06-03 · per David's QC ("explain it better").
                    Show per-metric deltas + a what-is line explaining
                    the comparison window. */}
                {(() => {
                  const bc = seed.health.blockComparison!;
                  const parts: string[] = [];
                  if (bc.deltas.sleepH != null) {
                    parts.push(`Sleep ${bc.deltas.sleepH >= 0 ? '+' : ''}${bc.deltas.sleepH.toFixed(1)}h/night`);
                  }
                  if (bc.deltas.hrvMs != null) {
                    parts.push(`HRV ${bc.deltas.hrvMs >= 0 ? '+' : ''}${Math.round(bc.deltas.hrvMs)}ms`);
                  }
                  if (bc.deltas.rhrBpm != null) {
                    parts.push(`RHR ${bc.deltas.rhrBpm >= 0 ? '+' : ''}${Math.round(bc.deltas.rhrBpm)}bpm`);
                  }
                  return parts.length > 0 ? (
                    <div className="hins-m">{parts.join(' · ')}.</div>
                  ) : null;
                })()}
                <div className="hins-what">
                  Your last 4 weeks vs the 4 weeks before {seed.health.blockComparison.referenceBlock.label.replace(/ build$/, '')}.
                </div>
              </div>
            ) : null}
            {seed.health.dowPatterns && seed.health.dowPatterns.insights.length > 0 ? (
              <div className="hins">
                <div className="hins-k">DAY-OF-WEEK</div>
                <div className="hins-h">{seed.health.dowPatterns.insights[0]}</div>
                {seed.health.dowPatterns.insights.length > 1 ? (
                  <div className="hins-m">{seed.health.dowPatterns.insights.slice(1).join(' · ')}</div>
                ) : null}
              </div>
            ) : null}
            {seed.health.qualityPredictors ? (
              <div className="hins">
                <div className="hins-k">WHAT PREDICTS YOUR BEST RUNS</div>
                <div className="hins-h">{seed.health.qualityPredictors.topPredictor.metric}</div>
                <div className="hins-m">{seed.health.qualityPredictors.topPredictor.message}</div>
              </div>
            ) : null}
            {seed.health.heatAcclim ? (
              <div className="hins">
                <div className="hins-k">ENVIRONMENT · HEAT</div>
                <div className="hins-h">
                  {/* 2026-06-05 · multi-tenant audit Pattern 5 fix · null
                      rhrTrend (no RHR data to call) → 'In progress' instead
                      of defaulting to 'Stable' which silently claims falling
                      RHR. Cite: docs/2026-06-05-multi-tenant-audit.html. */}
                  {seed.health.heatAcclim.rhrTrend === 'plateauing' ? 'Acclimating'
                    : seed.health.heatAcclim.rhrTrend === 'rising' ? 'Adapting'
                    : seed.health.heatAcclim.rhrTrend === 'falling' ? 'Stable'
                    : 'In progress'}
                </div>
                <div className="hins-m">{seed.health.heatAcclim.message}</div>
              </div>
            ) : null}
            {seed.user.biologicalSex === 'female' && seed.health.cyclePerformance && seed.health.cyclePerformance.insights.length > 0 ? (
              <div className="hins">
                <div className="hins-k">CYCLE · PERFORMANCE</div>
                <div className="hins-h">{seed.health.cyclePerformance.insights[0]}</div>
                {seed.health.cyclePerformance.insights.length > 1 ? (
                  <div className="hins-m">{seed.health.cyclePerformance.insights.slice(1).join(' · ')}</div>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      {/* Manual entry sheet */}
      {logOpen ? (
        <div
          role="dialog"
          aria-modal="true"
          style={{
            position: 'fixed', inset: 0, zIndex: 50,
            display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
            background: 'rgba(0,0,0,.55)',
          }}
          onClick={() => setLogOpen(false)}
        >
          <div style={{ width: '100%', maxWidth: 520 }} onClick={(e) => e.stopPropagation()}>
            <ManualHealthSheet
              onSaved={() => router.refresh()}
              onClose={() => setLogOpen(false)}
            />
          </div>
        </div>
      ) : null}
    </>
  );
}

function todayShort(): string {
  return new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric' }).format(new Date());
}
