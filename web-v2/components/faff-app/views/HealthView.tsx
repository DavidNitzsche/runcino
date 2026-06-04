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
  const STATUS_TXT: Record<HealthMetric['status'], string> = {
    good: `on ${targetNoun}`, warn: `below ${targetNoun}`, neutral: 'steady',
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

  // Split sleep stage tiles out of BODY into their own SLEEP STAGES grid.
  const sleepKeys = new Set(['sleep_deep', 'sleep_rem', 'sleep_light', 'sleep_awake']);
  const bodyTiles = body.filter(m => !sleepKeys.has(m.k));
  const sleepTiles = body.filter(m => sleepKeys.has(m.k));

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
              // 2026-06-03 · stripped zone chip + bands reference per
              // David ("dont muddy it with all these other phases and
              // options · Talk about what is happening NOW"). Card now
              // shows the runner's actual current state with no phase
              // taxonomy or zone-band reference cluttering the read.
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
            <span className="hsynth-tag watch-tag">WATCHING TOMORROW</span>
            <div className="hwatch-list">
              {(brief.watchTomorrow ?? []).map((w, i) => (
                <div key={i} className="hwatch-row">
                  <span className="hwatch-d" />
                  <span>{w}</span>
                </div>
              ))}
              {/* 2026-06-03 · only show the empty-state line when BOTH
                  watchTomorrow notes AND forecast chips are empty.
                  Previously "Nothing flagged for tomorrow yet." rendered
                  while two FORECAST chips below contradicted it. */}
              {!brief.watchTomorrow?.length && !(brief.forecasts && brief.forecasts.length > 0) ? (
                <div className="hwatch-empty">Nothing flagged for tomorrow yet.</div>
              ) : null}
            </div>
            {brief.forecasts && brief.forecasts.length > 0 ? (
              <div className="hforecasts">
                {brief.forecasts.slice(0, 3).map((f, i) => {
                  // Pillar key → display label (HRV CV, SLEEP, etc).
                  const pillarLabels: Record<string, string> = {
                    sleep: 'SLEEP', hrv: 'HRV', rhr: 'RHR',
                    load: 'LOAD', hrv_cv: 'HRV CV', wrist_temp: 'WRIST TEMP',
                  };
                  return (
                    <span key={i} className="hfc">
                      <span className="hfc-ic">FORECAST</span>
                      <span><b>{pillarLabels[f.pillar] ?? f.pillar.toUpperCase()}</b> {f.message}</span>
                    </span>
                  );
                })}
              </div>
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
        const pcol = (p: number) => p >= 80 ? COLOR_GOOD : p >= 55 ? COLOR_WATCH : COLOR_BAD;
        // 2026-06-03 · trust the backend's `rp.dataInsufficient` flag +
        // the canonical `rp.percentRecovered == null` signal. The old
        // frontend tried to second-guess with allPillarsZero +
        // allPillarsNoData which produced "null%" when the backend
        // correctly returned dataInsufficient with pillars at null
        // (David's screenshot: server UTC tipped over to Thu Jun 4
        // before today's HK readings landed, all pillars dropped to
        // null, frontend's allPillarsZero=false → rendered "null%").
        const dataInsufficient = rp.dataInsufficient || rp.percentRecovered == null;
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
              <div className="hrecov-tl">
                <div className="hrecov-pct">
                  {dataInsufficient ? '·' : `${rp.percentRecovered}%`}
                </div>
                <div className="hrecov-day">{dayLabel}</div>
              </div>
            </div>
            <div className="hrecov-bar">
              <i style={{ width: `${dataInsufficient ? 0 : rp.percentRecovered}%` }} />
            </div>
            <div className="hrecov-grid">
              {rp.pillars.map(p => {
                const pct = p.pctRecovered;
                const hasData = pct != null;
                return (
                  <div key={p.key} className="hrcp">
                    <div className="k">{p.label}</div>
                    <div className="pb">
                      {hasData ? (
                        <i style={{ width: `${pct}%`, background: pcol(pct) }} />
                      ) : null}
                    </div>
                    <div className="pv" style={{ color: hasData ? pcol(pct) : 'rgba(255,255,255,.4)' }}>
                      {hasData ? `${pct}% back` : 'no data'}
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
        <>
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
        </>
      ) : null}

      {/* ===== SLEEP STAGES ===== */}
      {sleepTiles.length > 0 ? (
        <>
          <div className="hseclbl2">
            <span className="t">SLEEP STAGES</span>
            <span className="ln" />
          </div>
          {sleepArchitectureVerdict ? (
            <div className="harchline">
              Architecture <b>{sleepArchitectureVerdict}</b> across the last 7 nights
              {(() => {
                const deep = sleepTiles.find(m => m.k === 'sleep_deep')?.current ?? 0;
                const rem  = sleepTiles.find(m => m.k === 'sleep_rem')?.current ?? 0;
                const light = sleepTiles.find(m => m.k === 'sleep_light')?.current ?? 0;
                const awake = sleepTiles.find(m => m.k === 'sleep_awake')?.current ?? 0;
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
        </>
      ) : null}

      {/* ===== FORM ===== */}
      {form.length > 0 ? (
        <>
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
        </>
      ) : null}

      {/* ===== DEEPER INSIGHTS ===== */}
      {(trainingForm
        || seed.health.heatAcclim
        || seed.health.blockComparison
        || seed.health.dowPatterns
        || seed.health.qualityPredictors
        || (seed.user.biologicalSex === 'female' && seed.health.cyclePerformance)
      ) ? (
        <>
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
                  {seed.health.heatAcclim.rhrTrend === 'plateauing' ? 'Acclimating'
                    : seed.health.heatAcclim.rhrTrend === 'rising' ? 'Adapting'
                    : 'Stable'}
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
        </>
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
