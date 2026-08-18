'use client';

import type { ReactNode } from 'react';
import type { FaffSeed } from '@/components/faff-app/types';
import type { EffortKey, PhaseKey } from '@/components/faff-app/constants';
import { phaseFocus } from '@/lib/faff/phase-focus';
import { resolveRampScope } from '@/lib/faff/ramp-scope';
import { weekIntensity, EASY_SHARE_FLOOR, type IntensityDay } from '@/lib/plan/intensity-distribution';
import { Tile } from '@/components/redesign/core/Tile';
import { Badge } from '@/components/redesign/core/Badge';
import { CoachSay } from '@/components/redesign/coach/CoachSay';
import { SegmentBar } from '@/components/redesign/nav/SegmentBar';
import { FaffChartRegistrar } from '@/components/redesign/graphics/FaffChartRegistrar';

/**
 * components/redesign/block/BlockClient.tsx
 *
 * The redesigned Block screen, wired to the SAME real seed every other
 * redesign route renders (components/faff-app/seed.ts buildSeed()) — no
 * new data path. Structurally ported from the outside-studio handoff's
 * WebBlock.jsx (designs/design-review-0818/ui_kits/web/WebBlock.jsx): the
 * Ctx/Metric/WeekRow helpers below are page-local in the source file too
 * (not part of the shared component library), so they're reproduced here
 * rather than "ported" as standalone components — same idiom as
 * TodayClient / RunDetailClient.
 *
 * SCOPE / real-data sources:
 *   · seed.season.{nowIdx,raceIdx,miles,maxMi,phases,weekDays} — the real
 *     plan (training-state), same fields TrainView renders.
 *   · seed.goalRace — race name/date, same field Today renders.
 *   · seed.blockState + lib/faff/ramp-scope.ts#resolveRampScope — whether
 *     the active plan actually runs to the goal race. WebBlock.jsx's mock
 *     data assumes a single 20-week race-bound arc; the real engine also
 *     produces recovery / between-blocks plans (a 2-week post-race bridge
 *     with no phases, no peak week, nothing pointed at the goal race yet).
 *     Rendering the race-arc narrative over that data would be exactly the
 *     kind of state mismatch CLAUDE.md's "composition is state-driven, not
 *     template-driven" rule exists to prevent — so this file branches on
 *     `blockRunsToRace` the same way TrainView already does, and the
 *     between-blocks branch (BetweenBlocksBlock below) states the real
 *     window / handoff facts instead of a fabricated phase arc.
 *
 * Where the design's mock had a number with no honest real-data source
 * (the "target 20–25%" quality-share band, the static "How it's built"
 * prose), the row is replaced with the real computed/cited equivalent —
 * see the inline comments at each such spot and the task report for the
 * full list.
 */

// ── phase grouping · replicated from TrainView, not re-exported ─────────
// components/faff-app/views/TrainView.tsx keeps phaseKey / phaseGroups /
// phaseOfWeek / the peak-week and cutback-week derivations as page-local,
// non-exported functions inside a large 'use client' page component.
// Extracting them into a shared module is out of scope for this port (it
// would mean editing TrainView.tsx, a live, heavily-consumed file, for a
// screen that only reads the same three functions) — so the exact same
// conditions are reproduced here instead, with these comments as the
// tripwire: if TrainView.tsx's logic at the cited lines ever changes,
// this file's copy must change with it.

/** Resolve the PHASE constant key from a plan_phases.label string.
 *  Mirrors TrainView.tsx:119-134 verbatim. */
function phaseKey(label: string): PhaseKey {
  const s = label.toLowerCase().trim();
  if (s.startsWith('base')) return 'base';
  if (s.startsWith('quality')) return 'build';
  if (s.startsWith('race-specific') || s.startsWith('race specific')) return 'peak';
  if (s.startsWith('build')) return 'build';
  if (s.startsWith('peak')) return 'peak';
  if (s.startsWith('taper')) return 'taper';
  if (s.startsWith('race')) return 'race';
  if (s.startsWith('maintenance')) return 'maintenance';
  if (s.startsWith('recovery')) return 'recovery';
  return 'base';
}

/** Group weeks by the REAL plan_phases data from training-state, with the
 *  same proportional fallback for legacy plans with no authored phases.
 *  Mirrors TrainView.tsx:157-184 verbatim. */
function phaseGroups(
  raceIdx: number,
  phases: Array<{ label: string; startWeekIdx: number; endWeekIdx: number }>,
): Array<{ phase: PhaseKey; label: string; from: number; to: number }> {
  if (phases && phases.length > 0) {
    return phases
      .filter((p) => p.startWeekIdx < raceIdx)
      .map((p) => ({
        phase: phaseKey(p.label),
        label: p.label,
        from: Math.max(0, p.startWeekIdx),
        to: Math.min(raceIdx - 1, p.endWeekIdx),
      }));
  }
  const N = raceIdx;
  const split = (frac: number) => Math.max(1, Math.round(N * frac));
  const base = split(0.45);
  const build = split(0.30);
  const peak = split(0.15);
  const groups: Array<{ phase: PhaseKey; label: string; from: number; to: number }> = [];
  let cur = 0;
  if (base > 0) { groups.push({ phase: 'base', label: 'Base', from: cur, to: Math.min(N - 1, cur + base - 1) }); cur += base; }
  if (build > 0 && cur < N) { groups.push({ phase: 'build', label: 'Build', from: cur, to: Math.min(N - 1, cur + build - 1) }); cur += build; }
  if (peak > 0 && cur < N) { groups.push({ phase: 'peak', label: 'Peak', from: cur, to: Math.min(N - 1, cur + peak - 1) }); cur += peak; }
  if (cur < N) groups.push({ phase: 'taper', label: 'Taper', from: cur, to: N - 1 });
  return groups;
}

/** Which group does week i belong to. Mirrors TrainView.tsx:186-195. */
function phaseOfWeek(
  i: number,
  raceIdx: number,
  phases: Array<{ label: string; startWeekIdx: number; endWeekIdx: number }>,
): PhaseKey {
  if (i === raceIdx) return 'race';
  const groups = phaseGroups(raceIdx, phases);
  const g = groups.find((x) => i >= x.from && i <= x.to);
  return g?.phase ?? 'base';
}

/** Peak = highest-mileage non-race, non-taper week. Mirrors TrainView.tsx:629-644
 *  (including the "a recovery/bridge block has no peak week" guard). */
function findPeakIdx(
  blockRunsToRace: boolean,
  raceIdx: number,
  miles: number[],
  phases: Array<{ label: string; startWeekIdx: number; endWeekIdx: number }>,
): number {
  if (!blockRunsToRace) return -1;
  let best = 0; let idx = -1;
  for (let i = 0; i < raceIdx; i++) {
    const ph = phaseOfWeek(i, raceIdx, phases);
    if (ph !== 'taper' && ph !== 'race' && miles[i] > best) { best = miles[i]; idx = i; }
  }
  return idx;
}

/** Cutback = pre-taper week where volume drops vs the prior week.
 *  Mirrors TrainView.tsx:646-657. */
function findCutbackSet(
  raceIdx: number,
  miles: number[],
  phases: Array<{ label: string; startWeekIdx: number; endWeekIdx: number }>,
): Set<number> {
  const s = new Set<number>();
  for (let i = 1; i < raceIdx; i++) {
    const ph = phaseOfWeek(i, raceIdx, phases);
    if (ph !== 'taper' && ph !== 'race' && miles[i] > 0 && miles[i - 1] > 0 && miles[i] < miles[i - 1]) s.add(i);
  }
  return s;
}

/** Same date formatting TrainView.tsx:2068-2077 uses — parse as LOCAL date
 *  parts, not new Date(iso) (which is UTC and can read a day early west of
 *  Greenwich). Reproduced rather than imported for the same "page-local
 *  helper, not worth a shared module" reason as the phase functions above. */
function formatDate(iso: string | null | undefined): string {
  if (!iso) return '·';
  const parts = iso.split('-').map(Number);
  if (parts.length < 3 || parts.some((n) => Number.isNaN(n))) return '·';
  const d = new Date(parts[0], parts[1] - 1, parts[2]);
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(d);
}

// ── quality classification ───────────────────────────────────────────────
// Same EffortKey → "quality" bucket TodayClient's posterStateFor /
// weekStripStateFor already use (tempo + intervals; long is its own
// category, not folded into quality). Not a new vocabulary.
function isQualityType(t: EffortKey): boolean {
  return t === 'tempo' || t === 'intervals';
}

type SeasonDay = FaffSeed['season']['weekDays'][number][number];

/** Real per-day shape lib/plan/intensity-distribution.ts#weekIntensity
 *  needs. `subLabel` reads the day's real sub_label (threaded through as
 *  `name` — components/faff-app/seed.ts:1108 sets `name: d.label ||
 *  humanName(...)`, and training-state.ts:231 sets `label: d.sub_label`),
 *  which is how weekIntensity's 'long' branch finds a real MP/HM finish
 *  segment via extractFinishSegment instead of guessing. */
function toIntensityDay(d: SeasonDay): IntensityDay {
  return { type: d.type, distanceMi: d.mi, subLabel: d.name };
}

const QUALITY_CEILING_PCT = Math.round((1 - EASY_SHARE_FLOOR) * 100); // 25

// ── page-local layout primitives (mirrors WebBlock.jsx's own Ctx / Metric) ──

function Ctx({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div style={{
      display: 'grid', gridTemplateColumns: '88px minmax(0,1fr)', gap: 'var(--sp-7)',
      alignItems: 'baseline', padding: 'var(--sp-7) 0', boxShadow: 'inset 0 1px 0 var(--rule-light)',
    }}>
      <div style={{
        fontFamily: 'var(--font-sub)', fontSize: 'var(--type-label-s)', fontWeight: 'var(--weight-label)',
        letterSpacing: 'var(--tracking-label)', textTransform: 'uppercase', color: 'var(--text-quiet)',
      }}>{label}</div>
      <div style={{ fontSize: 'var(--type-body)', lineHeight: 'var(--lh-body)', color: 'var(--text-secondary)' }}>{children}</div>
    </div>
  );
}

type MetricHue = 'easy' | 'quality' | 'long' | 'rest' | 'phase';

function Metric({ hue, label, value, unit, foot, children, span = 1 }: {
  hue: MetricHue; label: string; value: ReactNode; unit?: string; foot: string[];
  children?: ReactNode; span?: 1 | 2;
}) {
  return (
    <div style={{
      boxSizing: 'border-box', background: 'var(--material-tile)', borderRadius: 'var(--radius-xl)',
      boxShadow: 'var(--elevation-raised)', padding: 'var(--sp-7)', display: 'flex', flexDirection: 'column',
      gap: 'var(--sp-5)', gridColumn: `span ${span}`, minWidth: 0, minHeight: 270, overflow: 'hidden',
    }}>
      <div style={{ flex: '0 0 auto' }}>
        <div style={{
          fontFamily: 'var(--font-sub)', fontSize: 'var(--type-label)', fontWeight: 'var(--weight-label)',
          letterSpacing: 'var(--tracking-label)', textTransform: 'uppercase', lineHeight: '20px', color: 'var(--text-secondary)',
        }}>{label}</div>
        <div className="faff-value" style={{ fontSize: 'var(--type-value-2)', lineHeight: 1.05, color: `var(--state-${hue}-ink)` }}>
          {value}
          {unit && (
            <span style={{
              fontFamily: 'var(--font-sub)', fontSize: 'var(--type-label)', fontWeight: 'var(--weight-label)',
              letterSpacing: 'var(--tracking-label)', textTransform: 'uppercase', marginLeft: 6,
            }}>{unit}</span>
          )}
        </div>
      </div>
      <div style={{ flex: '1 1 auto', minHeight: 0, display: 'flex' }}>{children}</div>
      <div style={{
        flex: '0 0 auto', height: 20, display: 'flex', justifyContent: 'space-between', gap: 'var(--sp-7)',
        fontFamily: 'var(--font-sub)', fontSize: 'var(--type-label-s)', fontWeight: 'var(--weight-label)',
        letterSpacing: 'var(--tracking-label)', textTransform: 'uppercase', lineHeight: '20px', color: 'var(--text-secondary)',
      }}>
        {foot.map((f, i) => <span key={i}>{f}</span>)}
      </div>
    </div>
  );
}

type WeekRowData = {
  week: string;
  phase: string;
  mi: number;
  flag?: 'Now' | 'Peak' | 'Cutback';
  qualityDays: number;
  longMi: number;
};

function WeekRow({ w, last, maxMi }: { w: WeekRowData; last: boolean; maxMi: number }) {
  const isNow = w.flag === 'Now';
  return (
    <div style={{
      display: 'grid', gridTemplateColumns: '104px 128px minmax(0,1fr) 160px 88px',
      gap: 'var(--sp-8)', alignItems: 'center', padding: 'var(--sp-6) var(--sp-8)',
      boxShadow: last ? 'none' : 'inset 0 -1px 0 var(--rule-light)',
      background: isNow ? 'var(--material-tile-raised)' : 'transparent',
    }}>
      <span className="faff-value" style={{ fontSize: 'var(--type-value-4)', color: isNow ? 'var(--state-quality-ink)' : 'var(--text-primary)' }}>{w.week}</span>
      <span style={{
        fontFamily: 'var(--font-sub)', fontSize: 'var(--type-label-s)', fontWeight: 'var(--weight-label)',
        letterSpacing: 'var(--tracking-label)', textTransform: 'uppercase', color: 'var(--text-quiet)',
      }}>{w.phase}{w.flag && w.flag !== 'Now' ? ` · ${w.flag}` : ''}</span>
      <span style={{ display: 'block', height: 8, borderRadius: 'var(--radius-pill)', background: 'var(--material-track)' }}>
        <span style={{
          display: 'block', height: '100%', width: `${Math.round((w.mi / Math.max(maxMi, 1)) * 100)}%`,
          borderRadius: 'var(--radius-pill)', background: 'var(--state-long)',
        }} />
      </span>
      <span style={{ fontSize: 'var(--type-meta)', color: 'var(--text-quiet)' }}>
        {w.qualityDays} quality &middot; {w.longMi} mi long
      </span>
      <span style={{ textAlign: 'right' }}>
        <span className="faff-value" style={{ fontSize: 'var(--type-value-4)', color: isNow ? 'var(--state-quality-ink)' : 'var(--text-primary)' }}>{w.mi}</span>
        <span style={{
          fontFamily: 'var(--font-sub)', fontSize: 'var(--type-label-s)', fontWeight: 'var(--weight-label)',
          letterSpacing: 'var(--tracking-label)', textTransform: 'uppercase', marginLeft: 5, color: 'var(--text-quiet)',
        }}>mi</span>
      </span>
    </div>
  );
}

/** ~5 evenly spaced week-number ticks for the bars chart's x-axis. The
 *  mock hardcodes ["1","5","10","15","20"] for its fixed 20-week demo
 *  block; real blocks vary in length, so this generalizes the same idea
 *  (first week, last week, evenly spaced between) to any N. */
function weekTickLabels(n: number): string[] {
  if (n <= 1) return ['1'];
  if (n <= 5) return Array.from({ length: n }, (_, i) => String(i + 1));
  const steps = 4;
  const ticks = new Set<number>([1, n]);
  for (let k = 1; k < steps; k += 1) ticks.add(Math.round((k * (n - 1)) / steps) + 1);
  return Array.from(ticks).sort((a, b) => a - b).map(String);
}

export function BlockClient({ seed }: { seed: FaffSeed }) {
  const { nowIdx, raceIdx, miles, maxMi, phases: realPhases, weekDays } = seed.season;
  const goal = seed.goalRace;

  // 2026-08-17 · same gate TrainView's ramp uses (lib/faff/ramp-scope.ts):
  // the active plan only "runs to the race" when the race actually falls
  // inside it. A recovery / bridge block (this file's between-blocks
  // branch) has no phase arc, no peak week, no cutback weeks — rendering
  // WebBlock.jsx's race-arc narrative over it would fabricate a shape the
  // plan doesn't have.
  const ramp = resolveRampScope({ blockState: seed.blockState, raceIdx, goalName: goal?.name ?? null });
  const { blockRunsToRace } = ramp;

  if (!blockRunsToRace) {
    return <BetweenBlocksBlock seed={seed} ramp={ramp} />;
  }

  return <RaceBoundBlock seed={seed} nowIdx={nowIdx} raceIdx={raceIdx} miles={miles} maxMi={maxMi} realPhases={realPhases} weekDays={weekDays} goal={goal} />;
}

// ─────────────────────────────────────────────────────────────────────────
// The normal case: an active plan whose last week IS race week.
// ─────────────────────────────────────────────────────────────────────────
function RaceBoundBlock({ seed, nowIdx, raceIdx, miles, maxMi, realPhases, weekDays, goal }: {
  seed: FaffSeed;
  nowIdx: number; raceIdx: number; miles: number[]; maxMi: number;
  realPhases: FaffSeed['season']['phases']; weekDays: FaffSeed['season']['weekDays'];
  goal: FaffSeed['goalRace'];
}) {
  const groups = phaseGroups(raceIdx, realPhases);
  const curGroup = groups.find((g) => nowIdx >= g.from && nowIdx <= g.to) ?? groups[groups.length - 1] ?? null;
  const curPhaseKey: PhaseKey = curGroup?.phase ?? phaseOfWeek(nowIdx, raceIdx, realPhases);
  const phaseAuthored = phaseFocus(curPhaseKey, goal);

  const peakIdx = findPeakIdx(true, raceIdx, miles, realPhases);
  const cutbackSet = findCutbackSet(raceIdx, miles, realPhases);

  // ── Hero (mesh) ─────────────────────────────────────────────────────
  const totalWeeks = raceIdx + 1;
  const weekWithinPhase = curGroup ? nowIdx - curGroup.from + 1 : null;
  const phaseLenWeeks = curGroup ? curGroup.to - curGroup.from + 1 : null;

  // ── Quality share · current week, real doctrine ceiling ─────────────
  // HONESTY GAP (see task report): the design mock shows "target 20—25%"
  // as if that band were cited doctrine. lib/plan/intensity-distribution.ts
  // (2026-08-17, DOCTRINE.intensity-easy-share-floor in lib/doctrine/
  // registry.ts) is real and IS enforced in the generator — but it states
  // a FLOOR on easy share (>=75%), not a symmetric target band on quality
  // share. 1 - 0.75 = 25% is a real, cited CEILING (the generator corrects
  // a plan UP to it and never trims a plan already above it), not a
  // "20-25%" target range. The foot label states the real ceiling only.
  const curWeekIntensity = weekIntensity({ days: (weekDays[nowIdx] ?? []).map(toIntensityDay) });
  const qualitySharePct = Math.round((1 - curWeekIntensity.easyShare) * 100);

  // ── Long run trajectory across the block ─────────────────────────────
  const longRunSeries = miles.map((_, i) => (weekDays[i] ?? []).find((d) => d.type === 'long')?.mi ?? 0);
  const longRunThisWeek = longRunSeries[nowIdx] ?? 0;
  const peakLongRunMi = Math.max(0, ...longRunSeries.slice(0, raceIdx));

  // ── "How it's built" · derived from real weeks, not copied prose ─────
  const weeklyQualityCounts = Array.from({ length: raceIdx }, (_, i) => (weekDays[i] ?? []).filter((d) => isQualityType(d.type)).length);
  const nonZeroCounts = weeklyQualityCounts.filter((n) => n > 0);
  const typicalQualityDays = nonZeroCounts.length
    ? mode(nonZeroCounts)
    : 0;
  const anyBackToBack = Array.from({ length: raceIdx }, (_, i) => weekDays[i] ?? []).some((days) => {
    for (let d = 1; d < days.length; d += 1) if (isQualityType(days[d].type) && isQualityType(days[d - 1].type)) return true;
    return false;
  });

  const cutbackIdxs = Array.from(cutbackSet).sort((a, b) => a - b);
  const cutbackGaps = cutbackIdxs.slice(1).map((v, i) => v - cutbackIdxs[i]);
  const regularCutbackEvery = cutbackGaps.length > 0 && cutbackGaps.every((g) => g === cutbackGaps[0]) ? cutbackGaps[0] : null;

  const shapeCopy = cutbackIdxs.length === 0
    ? 'No scheduled cutback weeks in this block yet — volume steps up week over week.'
    : regularCutbackEvery != null
      ? `Volume steps up, then comes down every ${regularCutbackEvery}th week on purpose — that's where the buildup turns into fitness.`
      : `${cutbackIdxs.length} cutback week${cutbackIdxs.length === 1 ? '' : 's'} in this block (week${cutbackIdxs.length === 1 ? '' : 's'} ${cutbackIdxs.map((i) => i + 1).join(', ')}) bring the volume down before the next step up.`;

  const qualityCopy = typicalQualityDays > 0
    ? `Usually ${typicalQualityDays} hard day${typicalQualityDays === 1 ? '' : 's'} a week, ${anyBackToBack ? 'occasionally back to back' : 'never back to back'}. Everything else is easy enough to hold a conversation.`
    : 'No structured hard days in this block yet — everything is easy or long.';

  const nextRaceWeeks = peakIdx >= 0 ? raceIdx - peakIdx : null;

  const coachLine = weekWithinPhase != null && phaseLenWeeks != null
    ? `Week ${weekWithinPhase} of ${phaseLenWeeks} in ${phaseAuthored.name.toLowerCase()}. ${phaseAuthored.focus}`
    : phaseAuthored.focus;

  return (
    <div style={{ display: 'grid', gap: 'var(--stack-gap)', maxWidth: 1360, margin: '0 auto', padding: 'var(--sp-9)' }}>
      <FaffChartRegistrar />

      <div style={{ display: 'grid', gridTemplateColumns: '1.35fr 1fr', gap: 'var(--stack-gap)', alignItems: 'stretch' }}>
        <div style={{
          position: 'relative', overflow: 'hidden', borderRadius: 'var(--radius-2xl)',
          background: 'var(--g-quality)', color: 'var(--text-on-mesh)',
          padding: 'var(--sp-10)', display: 'flex', flexDirection: 'column', minHeight: 420,
        }}>
          <div style={{
            fontFamily: 'var(--font-sub)', fontSize: 'var(--type-label)', fontWeight: 'var(--weight-label)',
            letterSpacing: 'var(--tracking-label)', textTransform: 'uppercase', opacity: 0.85,
          }}>
            {goal ? `${goal.name} · ${formatDate(goal.date)} · ${totalWeeks} weeks` : `${totalWeeks}-week block`}
          </div>
          <div className="faff-display" style={{ fontSize: 'var(--type-display-1)', lineHeight: 0.92, marginTop: 'var(--sp-7)' }}>
            {phaseAuthored.name.charAt(0)}{phaseAuthored.name.slice(1).toLowerCase()}<br />block
          </div>
          <div className="faff-value" style={{ fontSize: 'var(--type-value-2)', marginTop: 'var(--sp-7)' }}>Wk {nowIdx + 1} of {totalWeeks}</div>
          <div style={{ fontSize: 'var(--type-body)', lineHeight: 'var(--lh-body)', marginTop: 'var(--sp-7)', maxWidth: '40ch', opacity: 0.94 }}>
            {phaseAuthored.focus}
          </div>
          <div style={{ marginTop: 'auto', display: 'grid', gridTemplateColumns: `repeat(${Math.max(groups.length, 1)},minmax(0,1fr))`, gap: 'var(--sp-7)' }}>
            {groups.map((g) => {
              const isPast = g.to < nowIdx;
              const isCur = nowIdx >= g.from && nowIdx <= g.to;
              const status = isPast ? 'closed' : isCur ? `week ${nowIdx - g.from + 1}` : '';
              const weeksN = g.to - g.from + 1;
              return (
                <div key={`${g.label}-${g.from}`} style={{ opacity: isCur ? 1 : 0.62 }}>
                  <div style={{ height: 3, borderRadius: 2, background: 'currentColor', opacity: isPast ? 1 : isCur ? 0.8 : 0.35, marginBottom: 'var(--sp-5)' }} />
                  <div style={{
                    fontFamily: 'var(--font-sub)', fontSize: 'var(--type-label-s)', fontWeight: 'var(--weight-label)',
                    letterSpacing: 'var(--tracking-label)', textTransform: 'uppercase',
                  }}>{g.label}</div>
                  <div style={{ fontSize: 'var(--type-meta)', marginTop: 2, opacity: 0.85 }}>{weeksN} wk{status ? ` · ${status}` : ''}</div>
                </div>
              );
            })}
          </div>
        </div>

        <Tile pad="lg" radius="l" style={{ display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 'var(--sp-6)' }}>
            <div className="faff-display" style={{ fontSize: 'var(--type-display-3)' }}>How it&rsquo;s built</div>
            <Badge tone="neutral">On plan</Badge>
          </div>
          <div style={{ marginTop: 'var(--sp-6)' }}>
            <Ctx label="Shape">{shapeCopy}</Ctx>
            <Ctx label="Quality">{qualityCopy}</Ctx>
            {peakIdx >= 0 && (
              <Ctx label="Peak">
                Week {peakIdx + 1} at <strong style={{ color: 'var(--text-primary)' }}>{miles[peakIdx]} mi</strong>
                {peakLongRunMi > 0 ? <> with a {peakLongRunMi} mi long run</> : null}.
                {nextRaceWeeks != null ? <> Then {nextRaceWeeks} week{nextRaceWeeks === 1 ? '' : 's'} to race day.</> : null}
              </Ctx>
            )}
          </div>
          <CoachSay attribution="Coach" size="md" style={{ marginTop: 'auto', padding: 'var(--sp-9) 0 0' }}>{coachLine}</CoachSay>
        </Tile>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,minmax(0,1fr))', gap: 'var(--stack-gap)', alignItems: 'stretch' }}>
        {/* Planned volume · seed.season.miles (real, whole block) + maxMi (real headroom-padded max). */}
        <Metric hue="long" label="Planned volume" value={miles[nowIdx] ?? 0} unit="mi this week" span={2}
          foot={[`wk ${nowIdx + 1} of ${totalWeeks}`, `0 — ${maxMi} mi`]}>
          <faff-chart type="bars" values={JSON.stringify(miles)} domain={JSON.stringify([0, maxMi])}
            labels={JSON.stringify(weekTickLabels(miles.length))} hue="long" />
        </Metric>

        {/* Quality share · real per-day spec split (lib/plan/intensity-distribution.ts),
            not the mock's invented "target 20-25%" band. Ring domain is a plain 0-100%
            visual scale (the metric's own true range), not an invented ceiling. */}
        <Metric hue="quality" label="Quality share" value={qualitySharePct} unit="%"
          foot={[`ceiling ${QUALITY_CEILING_PCT}%`, 'this week']}>
          <faff-chart type="ring" values={JSON.stringify([qualitySharePct])} domain="[0,100]" hue="quality" />
        </Metric>

        {/* Long run · real per-week long-run mi across the whole block. Domain omitted
            (auto-scales from values) rather than copying the mock's fixed [6,28] band —
            same choice TodayClient's rhr-trend line chart already makes. */}
        <Metric hue="phase" label="Long run" value={longRunThisWeek} unit="mi"
          foot={['wk 1 — race day', `peak ${peakLongRunMi} mi`]}>
          <faff-chart type="line" values={JSON.stringify(longRunSeries)} hue="phase" />
        </Metric>
      </div>

      <WeeksTable
        raceIdx={raceIdx} maxMi={maxMi} nowIdx={nowIdx} peakIdx={peakIdx} cutbackSet={cutbackSet}
        miles={miles} weekDays={weekDays} realPhases={realPhases}
      />
    </div>
  );
}

function mode(nums: number[]): number {
  const counts = new Map<number, number>();
  for (const n of nums) counts.set(n, (counts.get(n) ?? 0) + 1);
  let best = nums[0]; let bestCount = 0;
  for (const [n, c] of counts) if (c > bestCount) { best = n; bestCount = c; }
  return best;
}

function WeeksTable({ raceIdx, maxMi, nowIdx, peakIdx, cutbackSet, miles, weekDays, realPhases }: {
  raceIdx: number; maxMi: number; nowIdx: number; peakIdx: number; cutbackSet: Set<number>;
  miles: number[]; weekDays: FaffSeed['season']['weekDays']; realPhases: FaffSeed['season']['phases'];
}) {
  const groups = phaseGroups(raceIdx, realPhases);
  const rows: WeekRowData[] = Array.from({ length: raceIdx }, (_, i) => {
    const days = weekDays[i] ?? [];
    const grp = groups.find((g) => i >= g.from && i <= g.to);
    const flag: WeekRowData['flag'] = i === nowIdx ? 'Now' : i === peakIdx ? 'Peak' : cutbackSet.has(i) ? 'Cutback' : undefined;
    return {
      week: `Wk ${i + 1}`,
      phase: grp?.label ?? '—',
      mi: miles[i] ?? 0,
      flag,
      qualityDays: days.filter((d) => isQualityType(d.type)).length,
      longMi: days.find((d) => d.type === 'long')?.mi ?? 0,
    };
  });

  return (
    <div style={{ display: 'grid', gap: 'var(--sp-6)' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', padding: 'var(--sp-6) var(--sp-2) 0' }}>
        <div style={{
          fontFamily: 'var(--font-sub)', fontSize: 'var(--type-label)', fontWeight: 'var(--weight-label)',
          letterSpacing: 'var(--tracking-label)', textTransform: 'uppercase', color: 'var(--text-secondary)',
        }}>Every week</div>
        {/* SegmentBar carries no onChange, same as the source WebBlock.jsx
            (designs/design-review-0818/ui_kits/web/WebBlock.jsx:127) — the
            mock itself never authors "phases" / "library" content for this
            toggle to switch to, so it's ported inert rather than wired to a
            view that doesn't exist yet. Same limitation-ported-faithfully
            call RunDetailClient made for its pace/heart-rate SegmentBar. */}
        <SegmentBar value="weeks" options={['weeks', 'phases', 'library']} />
      </div>
      <Tile pad="sm" radius="xl" style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{
          display: 'grid', gridTemplateColumns: '104px 128px minmax(0,1fr) 160px 88px', gap: 'var(--sp-8)',
          padding: 'var(--sp-6) var(--sp-8)', boxShadow: 'inset 0 -1px 0 var(--rule-light)',
          fontFamily: 'var(--font-sub)', fontSize: 'var(--type-label-s)', fontWeight: 'var(--weight-label)',
          letterSpacing: 'var(--tracking-label)', textTransform: 'uppercase', color: 'var(--text-quiet)',
        }}>
          <span>Week</span><span>Phase</span><span>Volume &middot; 0 &mdash; {maxMi} mi</span><span>Shape</span><span style={{ textAlign: 'right' }}>Planned</span>
        </div>
        {rows.map((w, i) => <WeekRow key={w.week} w={w} last={i === rows.length - 1} maxMi={maxMi} />)}
      </Tile>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Between blocks: a recovery / post-block bridge, or no active plan.
// The active "plan" here (if any) is not pointed at the goal race, so
// WebBlock.jsx's race-arc narrative (phases / peak week / cutback weeks)
// does not apply — lib/faff/block-state.ts is the real source for why.
// ─────────────────────────────────────────────────────────────────────────
function BetweenBlocksBlock({ seed, ramp }: { seed: FaffSeed; ramp: ReturnType<typeof resolveRampScope> }) {
  const { nowIdx, raceIdx, miles, maxMi, weekDays } = seed.season;
  const goal = seed.goalRace;
  const totalWeeks = raceIdx + 1;

  const curWeekIntensity = weekIntensity({ days: (weekDays[nowIdx] ?? []).map(toIntensityDay) });
  const qualitySharePct = Math.round((1 - curWeekIntensity.easyShare) * 100);
  const longRunSeries = miles.map((_, i) => (weekDays[i] ?? []).find((d) => d.type === 'long')?.mi ?? 0);
  const longRunThisWeek = longRunSeries[nowIdx] ?? 0;
  const peakLongRunMi = Math.max(0, ...longRunSeries);

  const reasonLabel = ramp.label.replace('WEEKLY VOLUME · ', '');

  return (
    <div style={{ display: 'grid', gap: 'var(--stack-gap)', maxWidth: 1360, margin: '0 auto', padding: 'var(--sp-9)' }}>
      <FaffChartRegistrar />

      <div style={{ display: 'grid', gridTemplateColumns: '1.35fr 1fr', gap: 'var(--stack-gap)', alignItems: 'stretch' }}>
        <div style={{
          position: 'relative', overflow: 'hidden', borderRadius: 'var(--radius-2xl)',
          background: 'var(--g-quality)', color: 'var(--text-on-mesh)',
          padding: 'var(--sp-10)', display: 'flex', flexDirection: 'column', minHeight: 420,
        }}>
          <div style={{
            fontFamily: 'var(--font-sub)', fontSize: 'var(--type-label)', fontWeight: 'var(--weight-label)',
            letterSpacing: 'var(--tracking-label)', textTransform: 'uppercase', opacity: 0.85,
          }}>{reasonLabel}</div>
          <div className="faff-display" style={{ fontSize: 'var(--type-display-1)', lineHeight: 0.92, marginTop: 'var(--sp-7)' }}>
            Between<br />blocks
          </div>
          <div className="faff-value" style={{ fontSize: 'var(--type-value-2)', marginTop: 'var(--sp-7)' }}>Wk {nowIdx + 1} of {totalWeeks}</div>
          {/* Same wording formula TrainView.tsx:896-911 uses for this exact state
              (ramp.handoff), so the two surfaces read as one fact, not two. */}
          <div style={{ fontSize: 'var(--type-body)', lineHeight: 'var(--lh-body)', marginTop: 'var(--sp-7)', maxWidth: '40ch', opacity: 0.94 }}>
            {ramp.handoff ? (
              <>
                {ramp.handoff.windowStartISO && ramp.handoff.windowEndISO
                  ? <>Recovery window {formatDate(ramp.handoff.windowStartISO)} to {formatDate(ramp.handoff.windowEndISO)}.</>
                  : <>Current block ends {ramp.handoff.windowEndISO ? formatDate(ramp.handoff.windowEndISO) : 'shortly'}.</>}
                {ramp.handoff.goalName && ramp.handoff.opensISO ? (
                  <> {ramp.handoff.goalName} block opens {formatDate(ramp.handoff.opensISO)}
                    {ramp.handoff.weeksOutAtOpen != null ? <>, {ramp.handoff.weeksOutAtOpen} weeks out.</> : '.'}
                  </>
                ) : null}
              </>
            ) : (
              <>No active plan pointed at a goal race right now.</>
            )}
          </div>
        </div>

        <Tile pad="lg" radius="l" style={{ display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 'var(--sp-6)' }}>
            <div className="faff-display" style={{ fontSize: 'var(--type-display-3)' }}>Why this block</div>
            <Badge tone="neutral">{reasonLabel}</Badge>
          </div>
          <div style={{ marginTop: 'var(--sp-6)' }}>
            <Ctx label="Status">
              This block is not pointed at {goal?.name ?? 'the goal race'} &mdash; it exists to absorb the last one before the next build opens.
            </Ctx>
            {goal && (
              <Ctx label="Goal">
                {goal.name} is {goal.daysAway} days out{ramp.handoff?.weeksOutAtOpen != null ? <>, {ramp.handoff.weeksOutAtOpen} weeks from when the next block opens</> : null}.
              </Ctx>
            )}
          </div>
          <CoachSay attribution="Coach" size="md" style={{ marginTop: 'auto', padding: 'var(--sp-9) 0 0' }}>
            {ramp.handoff?.opensISO
              ? `Hold the volume here, not the intensity. The ${goal?.name ?? 'next'} build opens ${formatDate(ramp.handoff.opensISO)}.`
              : 'Hold the volume here, not the intensity, until the next block opens.'}
          </CoachSay>
        </Tile>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,minmax(0,1fr))', gap: 'var(--stack-gap)', alignItems: 'stretch' }}>
        <Metric hue="long" label="Planned volume" value={miles[nowIdx] ?? 0} unit="mi this week" span={2}
          foot={[`wk ${nowIdx + 1} of ${totalWeeks}`, `0 — ${maxMi} mi`]}>
          <faff-chart type="bars" values={JSON.stringify(miles)} domain={JSON.stringify([0, maxMi])}
            labels={JSON.stringify(weekTickLabels(miles.length))} hue="long" />
        </Metric>
        <Metric hue="quality" label="Quality share" value={qualitySharePct} unit="%"
          foot={[`ceiling ${QUALITY_CEILING_PCT}%`, 'this week']}>
          <faff-chart type="ring" values={JSON.stringify([qualitySharePct])} domain="[0,100]" hue="quality" />
        </Metric>
        <Metric hue="phase" label="Long run" value={longRunThisWeek} unit="mi"
          foot={['this block', `peak ${peakLongRunMi} mi`]}>
          <faff-chart type="line" values={JSON.stringify(longRunSeries)} hue="phase" />
        </Metric>
      </div>

      <BetweenBlocksWeeksTable raceIdx={raceIdx} maxMi={maxMi} nowIdx={nowIdx} miles={miles} weekDays={weekDays} />
    </div>
  );
}

function BetweenBlocksWeeksTable({ raceIdx, maxMi, nowIdx, miles, weekDays }: {
  raceIdx: number; maxMi: number; nowIdx: number; miles: number[]; weekDays: FaffSeed['season']['weekDays'];
}) {
  const rows: WeekRowData[] = Array.from({ length: raceIdx + 1 }, (_, i) => {
    const days = weekDays[i] ?? [];
    return {
      week: `Wk ${i + 1}`,
      phase: 'Recovery',
      mi: miles[i] ?? 0,
      flag: i === nowIdx ? 'Now' as const : undefined,
      qualityDays: days.filter((d) => isQualityType(d.type)).length,
      longMi: days.find((d) => d.type === 'long')?.mi ?? 0,
    };
  });
  return (
    <div style={{ display: 'grid', gap: 'var(--sp-6)' }}>
      <div style={{
        fontFamily: 'var(--font-sub)', fontSize: 'var(--type-label)', fontWeight: 'var(--weight-label)',
        letterSpacing: 'var(--tracking-label)', textTransform: 'uppercase', color: 'var(--text-secondary)',
        padding: 'var(--sp-6) var(--sp-2) 0',
      }}>This block</div>
      <Tile pad="sm" radius="xl" style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{
          display: 'grid', gridTemplateColumns: '104px 128px minmax(0,1fr) 160px 88px', gap: 'var(--sp-8)',
          padding: 'var(--sp-6) var(--sp-8)', boxShadow: 'inset 0 -1px 0 var(--rule-light)',
          fontFamily: 'var(--font-sub)', fontSize: 'var(--type-label-s)', fontWeight: 'var(--weight-label)',
          letterSpacing: 'var(--tracking-label)', textTransform: 'uppercase', color: 'var(--text-quiet)',
        }}>
          <span>Week</span><span>Phase</span><span>Volume &middot; 0 &mdash; {maxMi} mi</span><span>Shape</span><span style={{ textAlign: 'right' }}>Planned</span>
        </div>
        {rows.map((w, i) => <WeekRow key={w.week} w={w} last={i === rows.length - 1} maxMi={maxMi} />)}
      </Tile>
    </div>
  );
}
