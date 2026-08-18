'use client';

import type { ReactNode } from 'react';
import type { FaffSeed } from '@/components/faff-app/types';
import type { PhaseKey } from '@/components/faff-app/constants';
import type { WorkoutSpec } from '@/lib/faff/types';
import { resolveRampScope } from '@/lib/faff/ramp-scope';
import { computeWeekMileage } from '@/lib/faff/week-mileage';
import { Tile } from '@/components/redesign/core/Tile';
import { Badge, type BadgeTone } from '@/components/redesign/core/Badge';
import { CoachSay } from '@/components/redesign/coach/CoachSay';
import { WeekShape, type WeekShapeDay } from '@/components/redesign/graphics/WeekShape';
import { LogEntry, type LogEntryKind } from '@/components/redesign/coach/LogEntry';
import { RangeScale } from '@/components/redesign/graphics/RangeScale';
import { MetricRow, type MetricRowItem } from '@/components/redesign/graphics/MetricRow';
import { TrendBars } from '@/components/redesign/graphics/TrendBars';

/**
 * components/redesign/block/WeekDetailClient.tsx
 *
 * The redesigned Week Detail screen — Level 2 of Block: one week's full
 * detail, reached by clicking a row in Block's "Every week" table
 * (components/redesign/block/BlockClient.tsx's WeekRow, now linked to
 * `/redesign/block/week/[idx]`). Structurally ported from the outside-studio
 * handoff's WebWeekDetail.jsx (designs/design-review-0818/ui_kits/web/
 * WebWeekDetail.jsx) — a page-local composition using ALREADY-PORTED shared
 * components (Tile, Badge, CoachSay, WeekShape, LogEntry, RangeScale,
 * MetricRow, TrendBars), same idiom as BlockClient / RunDetailClient.
 *
 * SCOPE / real-data sources — every number traces to a seed field:
 *   · seed.season.weekDays[idx] — the week's real per-day plan + execution
 *     (dow/type/name/mi/doneMi/done/paceSec/donePaceSec/doneAvgHr/
 *     doneSplits/adaptation/workoutSpec), same fields Block and RunDetail
 *     already render.
 *   · seed.season.{miles,maxMi,phases,raceIdx,nowIdx} + seed.blockState via
 *     lib/faff/ramp-scope.ts#resolveRampScope — same real/between-blocks
 *     branch BlockClient uses, so a recovery week never gets the race-arc
 *     narrative (phase/peak/cutback) BlockClient itself would not draw for
 *     it either.
 *   · lib/faff/week-mileage.ts#computeWeekMileage — the app's single
 *     "miles this week" definition, applied to this specific week's days
 *     instead of only the current week (Today's only use of it).
 *
 * The phase/peak/cutback helpers below are copy-verbatim from BlockClient's
 * own page-local copies (which themselves mirror TrainView.tsx — see that
 * file's comments), not exported and re-imported, for the same reason
 * BlockClient didn't extract them from TrainView: this is a screen touching
 * shared logic without editing the live, heavily-consumed page that owns
 * it. If TrainView.tsx's cited logic changes, BlockClient.tsx's copy and
 * this file's copy both need to change with it.
 *
 * HONESTY GAPS (also called out in the task's commit message):
 *   · Quality-session pace BANDS. tempo/threshold/intervals WorkoutSpecs
 *     carry a single target pace (tempo_pace_s_per_mi / rep_pace_s_per_mi),
 *     never a lo/hi band like easy/long/recovery specs do — so unlike the
 *     mock's invented {low,high} band, the RangeScale here shows the real
 *     single target as a tick mark (`target`), not a shaded band. Sessions
 *     prescribed `by_effort` (no pace at all — hills/fartlek, or a runner
 *     with no measured fitness yet) carry no target and render no scale,
 *     same "plain value, no fabricated band" discipline RunDetailClient
 *     and TodayClient already established.
 *   · The MP/HM "finish" row only renders when the long run's WorkoutSpec
 *     is `kind:'long'` AND carries real `finish_mi`/`finish_pace_s_per_mi`
 *     (a structured D1 finish block) — most easy/base-only long-run weeks
 *     will show zero or one quality item, not always two. An honest empty
 *     state ("No structured quality session this week") replaces the row
 *     rather than a placeholder.
 *   · A landed quality/finish session's ACTUAL pace is the average of the
 *     last N whole-mile splits (`doneSplits`), not a precise re-isolation
 *     of the work segment — the closest real signal available without a
 *     server-side re-derivation, same order of approximation
 *     intensity-distribution.ts already documents for hard-mile counting.
 *   · "What changed" only lists real `weekDays[idx][*].adaptation` rows
 *     (`wasAdapted === true`). A week with no adaptation history renders a
 *     quiet "No adaptations recorded" line — never a fabricated entry to
 *     match the mock's always-populated log.
 */

// ── phase grouping · copy-verbatim from BlockClient.tsx (see file doc) ────

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

function formatDate(iso: string | null | undefined): string {
  if (!iso) return '·';
  const parts = iso.split('-').map(Number);
  if (parts.length < 3 || parts.some((n) => Number.isNaN(n))) return '·';
  const d = new Date(parts[0], parts[1] - 1, parts[2]);
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(d);
}

const titleCase = (s: string) => s.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
const capitalize = (s: string) => (s.length ? s.charAt(0).toUpperCase() + s.slice(1) : s);

function paceLabel(spm: number | null | undefined): string | null {
  if (!spm || spm <= 0) return null;
  const total = Math.round(spm);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

type SeasonDay = FaffSeed['season']['weekDays'][number][number];
type PhaseGroup = { phase: PhaseKey; label: string; from: number; to: number };

// ── real pace targets, read out of the day's own WorkoutSpec ──────────────
// tempo/threshold/intervals specs carry a single target pace, never a
// lo/hi band (only easy/long-base/recovery specs do) — see file doc.
function specTargetPaceSec(spec: WorkoutSpec | null | undefined): number | null {
  if (!spec) return null;
  const s = spec as unknown as {
    kind?: string;
    tempo_pace_s_per_mi?: number | null;
    rep_pace_s_per_mi?: number | null;
    mp_pace_s_per_mi?: number | null;
  };
  switch (s.kind) {
    case 'tempo': return typeof s.tempo_pace_s_per_mi === 'number' ? s.tempo_pace_s_per_mi : null;
    case 'threshold':
    case 'intervals': return typeof s.rep_pace_s_per_mi === 'number' ? s.rep_pace_s_per_mi : null;
    case 'mp': return typeof s.mp_pace_s_per_mi === 'number' ? s.mp_pace_s_per_mi : null;
    default: return null;
  }
}

function specKindLabel(spec: WorkoutSpec | null | undefined, fallbackType: string): string {
  const kind = (spec as unknown as { kind?: string } | null)?.kind;
  switch (kind) {
    case 'threshold': return 'Threshold';
    case 'tempo': return 'Tempo';
    case 'intervals': return 'Intervals';
    case 'mp': return 'Marathon pace';
    case 'progression': return 'Progression';
    case 'fartlek': return 'Fartlek';
    default: return titleCase(fallbackType);
  }
}

// D1 · the long run's MP/HM finish block. Structured field, not string
// parsing — WorkoutSpecLong writes finish_mi / finish_pace_s_per_mi /
// finish_label together (lib/faff/types.ts), so presence of one means
// presence of all three.
function specFinish(spec: WorkoutSpec | null | undefined): { mi: number; paceSec: number; label: string } | null {
  if (!spec) return null;
  const s = spec as unknown as { kind?: string; finish_mi?: number; finish_pace_s_per_mi?: number; finish_label?: string };
  if (s.kind !== 'long') return null;
  if (typeof s.finish_mi !== 'number' || typeof s.finish_pace_s_per_mi !== 'number') return null;
  return { mi: s.finish_mi, paceSec: s.finish_pace_s_per_mi, label: s.finish_label ?? 'Finish' };
}

/** Best-effort actual pace for a landed finish segment: the average of the
 *  last N whole-mile splits. Not a precise re-isolation of the work
 *  segment (see file doc's honesty gap) — the closest real signal on hand. */
function lastSegmentPaceSec(splits: SeasonDay['doneSplits'], n: number): number | null {
  if (!splits || splits.length === 0) return null;
  const take = Math.min(Math.max(1, Math.round(n)), splits.length);
  const tail = splits.slice(-take).map((s) => s.paceSec).filter((p): p is number => typeof p === 'number' && p > 0);
  if (tail.length === 0) return null;
  return tail.reduce((a, b) => a + b, 0) / tail.length;
}

function paceScale(target: number | null, actual: number | null): ReactNode | null {
  if (target == null && actual == null) return null;
  const vals = [target, actual].filter((n): n is number => n != null);
  const lo = Math.min(...vals);
  const hi = Math.max(...vals);
  const pad = Math.max(20, (hi - lo) * 0.6);
  const min = lo - pad;
  const max = hi + pad;
  return (
    <RangeScale style={{ marginTop: 0 }} min={min} max={max} target={target ?? undefined} value={actual ?? undefined}
      endpoints={[paceLabel(min) ?? '', paceLabel(max) ?? '']} hue="pace" />
  );
}

/** "Quality this week" — up to two real items: the primary midweek quality
 *  session (tempo/intervals, same vocabulary BlockClient's isQualityType
 *  uses) and the long run's real finish segment, when either exists. */
function buildQualityItems(days: SeasonDay[]): MetricRowItem[] {
  const items: MetricRowItem[] = [];

  const primary = days.find((d) => d.type === 'tempo' || d.type === 'intervals');
  if (primary) {
    const target = specTargetPaceSec(primary.workoutSpec);
    const actual = primary.donePaceSec ?? null;
    items.push({
      label: specKindLabel(primary.workoutSpec, primary.type),
      sub: `${titleCase(primary.dow)} · ${primary.done ? 'landed' : 'scheduled'}`,
      value: actual != null ? (paceLabel(actual) ?? '—') : '—',
      unit: '/mi',
      tone: actual != null ? 'primary' : 'quiet',
      scale: paceScale(target, actual),
    });
  }

  const longDay = days.find((d) => d.type === 'long');
  if (longDay) {
    const finish = specFinish(longDay.workoutSpec);
    if (finish) {
      const actual = longDay.done ? lastSegmentPaceSec(longDay.doneSplits, finish.mi) : null;
      const label = finish.label.toUpperCase().startsWith('H') ? 'HM finish' : 'MP finish';
      items.push({
        label,
        sub: `${titleCase(longDay.dow)} · last ${finish.mi} mi`,
        value: actual != null ? (paceLabel(actual) ?? '—') : '—',
        unit: '/mi',
        tone: actual != null ? 'primary' : 'quiet',
        scale: paceScale(finish.paceSec, actual),
      });
    }
  }

  return items.slice(0, 2);
}

/** Coach-voice summary of this week's real quality/long-run execution.
 *  Short, direct, no hype — CLAUDE.md's coach-voice rule. */
function buildCoachLine(opts: {
  weekStatus: 'past' | 'current' | 'future';
  plannedMi: number; actualMi: number;
  qualityDays: SeasonDay[]; longDay: SeasonDay | undefined;
}): string {
  const { weekStatus, plannedMi, actualMi, qualityDays, longDay } = opts;
  const doneQuality = qualityDays.filter((d) => d.done).length;
  const totalQuality = qualityDays.length;

  const qualityPhrase = totalQuality > 0
    ? `${doneQuality} of ${totalQuality} quality session${totalQuality === 1 ? '' : 's'} ${weekStatus === 'future' ? 'scheduled' : 'landed'}`
    : null;

  const finish = longDay ? specFinish(longDay.workoutSpec) : null;
  const longPhrase = longDay
    ? longDay.done
      ? `the long run held at ${longDay.doneMi ?? longDay.mi} mi${finish ? `, finish at ${finish.label === 'Finish' ? 'goal pace' : finish.label.toLowerCase()}` : ''}`
      : `the long run is ${longDay.mi} mi${finish ? `, last ${finish.mi} mi at ${finish.label === 'Finish' ? 'goal pace' : finish.label.toLowerCase()}` : ''}`
    : null;

  const lead = weekStatus === 'past'
    ? `Closed at ${actualMi} of ${plannedMi} mi.`
    : weekStatus === 'current'
      ? `${actualMi} of ${plannedMi} mi logged so far.`
      : `${plannedMi} mi planned.`;

  const parts = [lead];
  if (qualityPhrase) parts.push(`${capitalize(qualityPhrase)}.`);
  if (longPhrase) parts.push(`${capitalize(longPhrase)}.`);
  return parts.join(' ');
}

function buildBlockParagraph(opts: {
  idx: number; miles: number[]; peakIdx: number; cutbackSet: Set<number>; curGroup: PhaseGroup | null;
}): string {
  const { idx, miles, peakIdx, cutbackSet, curGroup } = opts;
  const lead: string[] = [];
  if (curGroup) {
    const weekInPhase = idx - curGroup.from + 1;
    const phaseLen = curGroup.to - curGroup.from + 1;
    lead.push(`Week ${weekInPhase} of ${phaseLen} in ${curGroup.label.toLowerCase()}`);
  }
  if (cutbackSet.has(idx)) lead.push('a scheduled cutback week');
  else if (idx === peakIdx) lead.push('the peak week of the block');

  const trail: string[] = [];
  if (idx > 0 && typeof miles[idx - 1] === 'number') {
    const d = Math.round((miles[idx] - miles[idx - 1]) * 10) / 10;
    if (d !== 0) trail.push(`${Math.abs(d)} mi ${d > 0 ? 'over' : 'under'} Wk ${idx}`);
  }
  if (peakIdx >= 0 && idx !== peakIdx && typeof miles[peakIdx] === 'number') {
    const d = Math.round((miles[peakIdx] - miles[idx]) * 10) / 10;
    if (d !== 0) trail.push(`${Math.abs(d)} mi ${d > 0 ? 'under' : 'over'} the Wk ${peakIdx + 1} peak`);
  }

  const leadStr = lead.length ? `${capitalize(lead.join(', '))}.` : '';
  const trailStr = trail.length ? ` ${capitalize(trail.join(', '))}.` : '';
  const combined = `${leadStr}${trailStr}`.trim();
  return combined || 'Volume for this week, in the context of the block.';
}

function resolveBlockPosition(opts: {
  blockRunsToRace: boolean; idx: number; raceIdx: number; miles: number[]; realPhases: FaffSeed['season']['phases'];
}): { phaseLabel: string; values: number[]; highlight: number; footnotes: [string, string]; paragraph: string } {
  const { blockRunsToRace, idx, raceIdx, miles, realPhases } = opts;
  if (blockRunsToRace) {
    const groups = phaseGroups(raceIdx, realPhases);
    const curGroup = groups.find((g) => idx >= g.from && idx <= g.to) ?? null;
    const peakIdx = findPeakIdx(true, raceIdx, miles, realPhases);
    const cutbackSet = findCutbackSet(raceIdx, miles, realPhases);
    const values = miles.slice(0, raceIdx);
    return {
      phaseLabel: curGroup?.label ?? '—',
      values,
      highlight: idx,
      footnotes: ['Wk 1', curGroup ? `Wk ${values.length} · ${curGroup.label} ends Wk ${curGroup.to + 1}` : `Wk ${values.length}`],
      paragraph: buildBlockParagraph({ idx, miles, peakIdx, cutbackSet, curGroup }),
    };
  }
  const values = miles.slice(0, raceIdx + 1);
  return {
    phaseLabel: 'Recovery',
    values,
    highlight: idx,
    footnotes: ['Wk 1', `Wk ${values.length} · recovery block`],
    paragraph: buildBlockParagraph({ idx, miles, peakIdx: -1, cutbackSet: new Set(), curGroup: null }),
  };
}

type Adaptation = NonNullable<SeasonDay['adaptation']>;
type AdaptationKindT = NonNullable<Adaptation['kind']>;

/** "What changed" — real weekDays[idx][*].adaptation rows only. */
function describeAdaptation(day: SeasonDay): { kind: LogEntryKind; date: string; text: string } | null {
  const a: Adaptation | null = day.adaptation ?? null;
  if (!a || !a.wasAdapted) return null;
  const dow = titleCase(day.dow);

  let lead: string;
  switch (a.kind) {
    case 'reschedule':
      lead = a.originalDateIso
        ? `${titleCase(a.originalType ?? day.type)} moved from ${formatDate(a.originalDateIso)} to ${dow}`
        : `${titleCase(a.originalType ?? day.type)} moved to ${dow}`;
      break;
    case 'downgrade':
      lead = a.originalType
        ? `${dow} downgraded from ${titleCase(a.originalType)} to ${titleCase(day.type)}`
        : `${dow} downgraded to ${titleCase(day.type)}`;
      break;
    case 'shave':
      lead = a.originalDistanceMi != null
        ? `${dow} shaved from ${a.originalDistanceMi} to ${day.mi} mi`
        : `${dow}'s dose was shaved`;
      break;
    case 'reshape':
      lead = `${dow}'s dose was reshaped`;
      break;
    case 'mark_dirty':
    case 'other':
    default:
      lead = `${dow} was adjusted`;
  }

  const kindMap: Partial<Record<AdaptationKindT, LogEntryKind>> = {
    reschedule: 'week-close', downgrade: 'fitness', shave: 'fitness', reshape: 'fitness',
  };

  return {
    kind: (a.kind && kindMap[a.kind]) || 'week-close',
    date: a.adaptedAt ? formatDate(a.adaptedAt.slice(0, 10)) : formatDate(day.date),
    text: a.reason ? `${lead} · ${a.reason}` : `${lead}.`,
  };
}

function isNotableType(t: string): boolean {
  return t === 'tempo' || t === 'intervals' || t === 'long';
}

function buildShapeDays(days: SeasonDay[], todayISO: string, isCurrentWeek: boolean): WeekShapeDay[] {
  return days.map((d) => {
    const load = d.done && typeof d.doneMi === 'number' && d.doneMi > 0 ? d.doneMi : d.mi;
    const isToday = !!d.date && d.date === todayISO;
    const isFuture = d.date ? d.date > todayISO : !isCurrentWeek && !d.done;
    return {
      load,
      quality: isNotableType(d.type),
      today: isToday,
      future: isFuture,
      label: load > 0 ? `${titleCase(d.dow)} ${load} mi ${(d.name || titleCase(d.type)).toLowerCase()}` : undefined,
    };
  });
}

const SUBHEAD_STYLE = {
  fontFamily: 'var(--font-sub)', fontSize: 'var(--type-label)', fontWeight: 'var(--weight-label)',
  letterSpacing: 'var(--tracking-label)', textTransform: 'uppercase' as const, color: 'var(--text-secondary)',
};

export function WeekDetailClient({ seed, idx }: { seed: FaffSeed; idx: number }) {
  const { nowIdx, raceIdx, miles, weekDays, phases: realPhases } = seed.season;
  const ramp = resolveRampScope({ blockState: seed.blockState, raceIdx, goalName: seed.goalRace?.name ?? null });

  // Valid range mirrors exactly what BlockClient's own WeeksTable renders
  // (and therefore links to): 0..raceIdx-1 when the block runs to the race
  // (the race week itself is not a normal training-week row there either),
  // 0..raceIdx when it's a between-blocks / recovery arc.
  const upperBound = Math.min(
    ramp.blockRunsToRace ? raceIdx : raceIdx + 1,
    miles.length,
    weekDays.length,
  );

  if (!Number.isFinite(idx) || idx < 0 || idx >= upperBound) {
    return (
      <div style={{ display: 'grid', gap: 'var(--sp-6)', maxWidth: 1360, margin: '0 auto', padding: 'var(--sp-9)' }}>
        <div className="faff-kicker">Week</div>
        <div className="faff-display" style={{ fontSize: 'var(--type-display-3)' }}>Week not found</div>
        <div style={{ color: 'var(--text-quiet)', fontSize: 'var(--type-body-s)' }}>
          No week matched index &ldquo;{idx}&rdquo; for this plan.
        </div>
      </div>
    );
  }

  const days = weekDays[idx] ?? [];
  const plannedMi = miles[idx] ?? 0;
  const mileage = computeWeekMileage(days.map((d) => ({
    dateISO: d.date ?? null, plannedMi: d.mi, doneMi: d.doneMi ?? 0, type: d.type,
  })));
  const actualMi = mileage.actualMi;

  const weekStatus: 'past' | 'current' | 'future' = idx < nowIdx ? 'past' : idx === nowIdx ? 'current' : 'future';
  const totalWeeks = raceIdx + 1;

  const pos = resolveBlockPosition({ blockRunsToRace: ramp.blockRunsToRace, idx, raceIdx, miles, realPhases });

  const badgeTone: BadgeTone = weekStatus === 'current' ? 'attention' : weekStatus === 'past' ? 'quiet' : 'neutral';
  const badgeLabel = weekStatus === 'current' ? 'In progress' : weekStatus === 'past' ? 'Closed' : 'Upcoming';

  const qualityDays = days.filter((d) => d.type === 'tempo' || d.type === 'intervals');
  const longDay = days.find((d) => d.type === 'long');
  const qualityItems = buildQualityItems(days);
  const coachLine = buildCoachLine({ weekStatus, plannedMi, actualMi, qualityDays, longDay });
  const shapeDays = buildShapeDays(days, seed.todayISO, weekStatus === 'current');

  const adaptationEntries = days
    .map((d) => describeAdaptation(d))
    .filter((e): e is NonNullable<typeof e> => e != null);

  const headlineValue = weekStatus === 'future' ? plannedMi : actualMi;
  const headlineLabel = weekStatus === 'past' ? 'Closed at' : weekStatus === 'current' ? 'This week, so far' : 'Planned';

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1.6fr 1fr', gap: 'var(--sp-6)', alignItems: 'start', maxWidth: 1360, margin: '0 auto', padding: 'var(--sp-9)' }}>
      <div style={{ display: 'grid', gap: 'var(--sp-4)' }}>
        <Tile pad="lg" radius="2xl">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
            <div style={{
              fontSize: 'var(--type-kicker)', letterSpacing: 'var(--tracking-kicker)',
              textTransform: 'uppercase', color: 'var(--text-quiet)',
            }}>
              Wk {idx + 1} of {totalWeeks} · {pos.phaseLabel}
            </div>
            <Badge tone={badgeTone}>{badgeLabel}</Badge>
          </div>
          <div className="faff-display" style={{ fontSize: 'var(--type-display-2)', marginTop: 'var(--sp-7)' }}>
            {actualMi} of {plannedMi}<span style={{ fontSize: 'var(--type-value-3)', marginLeft: 10 }}>mi</span>
          </div>
          <RangeScale style={{ marginTop: 'var(--sp-6)' }} mode="progress" min={0} max={Math.max(plannedMi, 1)} value={actualMi} hue="long"
            endpoints={[`${actualMi} logged`, `${plannedMi} planned`]} />
          <div style={{ marginTop: 'var(--sp-9)' }}>
            <WeekShape days={shapeDays} labels={['M', 'T', 'W', 'T', 'F', 'S', 'S']} height={140} />
          </div>
          <CoachSay attribution="Coach" size="md" style={{ padding: 'var(--sp-10) 0 0' }}>{coachLine}</CoachSay>
        </Tile>

        <Tile radius="l">
          <div style={SUBHEAD_STYLE}>Quality this week</div>
          {qualityItems.length > 0 ? (
            <MetricRow style={{ marginTop: 'var(--sp-8)' }} items={qualityItems} />
          ) : (
            <div style={{ marginTop: 'var(--sp-7)', fontSize: 'var(--type-body-s)', color: 'var(--text-quiet)' }}>
              No structured quality session this week.
            </div>
          )}
        </Tile>
      </div>

      <div style={{ display: 'grid', gap: 'var(--sp-4)' }}>
        <Tile pad="lg" radius="l">
          <div style={SUBHEAD_STYLE}>Where this week sits in the block</div>
          <TrendBars style={{ marginTop: 'var(--sp-8)' }} values={pos.values} highlight={pos.highlight} height={110}
            headline={`${headlineValue} mi`} headlineLabel={headlineLabel}
            footnotes={pos.footnotes} />
          <p style={{ margin: 'var(--sp-8) 0 0', fontSize: 'var(--type-body-s)', lineHeight: 'var(--lh-body-s)', color: 'var(--text-secondary)' }}>
            {pos.paragraph}
          </p>
        </Tile>

        <Tile radius="l">
          <div style={SUBHEAD_STYLE}>What changed</div>
          {adaptationEntries.length > 0 ? (
            adaptationEntries.map((e, i) => <LogEntry key={i} kind={e.kind} date={e.date}>{e.text}</LogEntry>)
          ) : (
            <div style={{ marginTop: 'var(--sp-7)', fontSize: 'var(--type-body-s)', color: 'var(--text-quiet)' }}>
              No adaptations recorded for this week.
            </div>
          )}
        </Tile>
      </div>
    </div>
  );
}
