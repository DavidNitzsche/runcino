'use client';

import type { ReactNode } from 'react';
import Link from 'next/link';
import type { FaffSeed, EffortKey } from '@/components/faff-app/types';
import { EFF, KIT } from '@/components/faff-app/constants';
import type { WorkoutSpec } from '@/lib/faff/types';
import { computeWeekMileage } from '@/lib/faff/week-mileage';
import { Tile } from '@/components/redesign/core/Tile';
import { Badge } from '@/components/redesign/core/Badge';
import { Poster, type PosterState, type PosterStat } from '@/components/redesign/core/Poster';
import { CoachSay } from '@/components/redesign/coach/CoachSay';
import { WeekStrip, type WeekStripState } from '@/components/redesign/graphics/WeekStrip';
import { FaffChartRegistrar } from '@/components/redesign/graphics/FaffChartRegistrar';

/**
 * components/redesign/today/TodayClient.tsx
 *
 * The redesigned Today screen, wired to the SAME real seed the live
 * /today route renders (components/faff-app/seed.ts buildSeed()) — no new
 * data path, no new DB reads. Structurally ported from the outside-studio
 * handoff's WebToday.jsx (designs/design-review-0818/ui_kits/web/
 * WebToday.jsx): the Ctx/Metric helpers below are page-local in the
 * source file too (not part of the shared component library), so they're
 * reproduced here rather than "ported" as standalone components.
 *
 * Every number on this page traces to a seed field. Where the design's
 * mock had a number with no honest real-data source, the row is either
 * dropped or replaced with the closest real field — see the inline
 * comments at each such spot, and the task report for the full list.
 */

// ── EffortKey → design-system state mappings ────────────────────────────
// This app's EffortKey (recovery/easy/long/tempo/intervals/rest/race)
// doesn't line up 1:1 with the handoff's state vocabulary. recovery maps
// to 'ease' (a real, distinct gradient in the palette — see colors.css
// --g-ease) rather than being folded into 'easy'; tempo/intervals both
// read as 'quality' (the handoff's one bucket for hard non-long work).
function posterStateFor(type: EffortKey): PosterState {
  switch (type) {
    case 'easy': return 'easy';
    case 'recovery': return 'ease';
    case 'long': return 'long';
    case 'tempo': return 'quality';
    case 'intervals': return 'quality';
    case 'race': return 'race';
    case 'rest':
    default: return 'rest';
  }
}
function weekStripStateFor(type: EffortKey): WeekStripState {
  switch (type) {
    case 'easy': return 'easy';
    case 'recovery': return 'ease';
    case 'long': return 'long';
    case 'tempo': return 'quality';
    case 'intervals': return 'quality';
    case 'race': return 'race';
    case 'rest':
    default: return 'rest';
  }
}
const titleCase = (s: string) => s.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
const secToPace = (sec: number) => `${Math.floor(sec / 60)}:${String(Math.round(sec % 60)).padStart(2, '0')}`;
const shortDate = (iso: string) => {
  const d = new Date(`${iso}T12:00:00Z`);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString('en-US', { day: 'numeric', month: 'short' }).toLowerCase();
};
/** Mirrors the hr_cap_bpm / hr_target_bpm / lthr_bpm fallback chain seed.ts already
 *  uses to resolve PlannedDay.hrCap (components/faff-app/seed.ts:511-515) — same
 *  logic, just also needed here for whichever day is being read at spec level. */
function specHrCap(spec: WorkoutSpec | null | undefined): number | null {
  if (!spec) return null;
  const s = spec as unknown as { hr_cap_bpm?: number | null; hr_target_bpm?: number | null; lthr_bpm?: number | null };
  return s.hr_cap_bpm ?? s.hr_target_bpm ?? s.lthr_bpm ?? null;
}
function specPaceBand(spec: WorkoutSpec | null | undefined): [number, number] | null {
  if (!spec) return null;
  const s = spec as unknown as { pace_target_s_per_mi_lo?: number; pace_target_s_per_mi_hi?: number };
  return typeof s.pace_target_s_per_mi_lo === 'number' && typeof s.pace_target_s_per_mi_hi === 'number'
    ? [s.pace_target_s_per_mi_lo, s.pace_target_s_per_mi_hi]
    : null;
}
function bailRuleFor(spec: WorkoutSpec | null | undefined): string | null {
  const rules = (spec as unknown as { rules?: Array<{ kind: string; label: string }> } | null)?.rules;
  return rules?.find((r) => r.kind === 'bail')?.label ?? null;
}
/** Best-effort phase word out of the already-composed weekOf string
 *  ("Week 14 of 26 · Build phase" → "Build"). No new phase resolution —
 *  weekOf is the one seed field guaranteed non-null. */
function phaseWordFrom(weekOf: string): string | null {
  const m = weekOf.match(/·\s*([A-Za-z]+)\s*phase/i);
  return m ? m[1] : null;
}

// ── page-local layout primitives (mirrors WebToday.jsx's own Ctx / Metric) ──

function Ctx({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div style={{
      display: 'grid', gridTemplateColumns: '74px minmax(0,1fr)', gap: 'var(--sp-7)',
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

function Metric({ hue, label, value, unit, foot, children, span = 1, sub }: {
  hue: MetricHue; label: string; value: ReactNode; unit?: string; foot: string[];
  children?: ReactNode; span?: 1 | 2; sub?: string;
}) {
  const u = 'var(--u,20px)';
  return (
    <div style={{
      boxSizing: 'border-box', background: 'var(--material-tile)', borderRadius: 'var(--radius-xl)',
      boxShadow: 'var(--elevation-raised)', padding: 'var(--sp-7)', display: 'flex', flexDirection: 'column',
      gap: 'var(--sp-5)', gridColumn: `span ${span}`, minWidth: 0, minHeight: 270, overflow: 'hidden',
    }}>
      <div style={{ flex: '0 0 auto' }}>
        <div style={{
          fontFamily: 'var(--font-sub)', fontSize: 'var(--type-label)', fontWeight: 'var(--weight-label)',
          letterSpacing: 'var(--tracking-label)', textTransform: 'uppercase', lineHeight: u, color: 'var(--text-secondary)',
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
        {sub && <div style={{ fontSize: 'var(--type-label-s)', color: 'var(--text-quiet)', marginTop: 4 }}>{sub}</div>}
      </div>
      <div style={{ flex: '1 1 auto', minHeight: 0, display: 'flex', marginTop: 0 }}>{children}</div>
      <div style={{
        flex: '0 0 auto', height: u, display: 'flex', justifyContent: 'space-between', gap: 'var(--sp-7)',
        fontFamily: 'var(--font-sub)', fontSize: 'var(--type-label-s)', fontWeight: 'var(--weight-label)',
        letterSpacing: 'var(--tracking-label)', textTransform: 'uppercase', lineHeight: u, color: 'var(--text-secondary)',
      }}>
        {foot.map((f, i) => <span key={i}>{f}</span>)}
      </div>
    </div>
  );
}

export function TodayClient({ seed, easyCeilingPct, easyFloorPct }: {
  seed: FaffSeed;
  /** EASY_HRMAX_CEILING_PCT / EASY_HRMAX_FLOOR_PCT (lib/coach/easy-discipline.ts),
   *  read server-side and passed down. That module also exports loadEasyDiscipline,
   *  which pulls in the pg pool — importing it directly from this 'use client'
   *  component bundles 'pg' (and its 'fs' dependency) into client JS and breaks the
   *  build. The two constants travel as plain number props instead. */
  easyCeilingPct: number;
  easyFloorPct: number;
}) {
  const today = seed.week[seed.todayIdx];
  const result = seed.results[seed.todayIdx];
  const isDone = !!today?.done;
  const isRest = today?.type === 'rest';

  const phaseWord = phaseWordFrom(seed.weekOf);

  // ── Poster (hero) ────────────────────────────────────────────────────
  const posterTag = `${isDone ? 'Done' : 'Today'} · ${seed.topDate}`;
  const posterVerb = today?.name || (today ? titleCase(today.type) : 'Rest');
  const posterDose = today && !isRest && today.dist && today.dist.trim() !== '·' ? `${today.dist} mi` : null;
  const posterRx = isDone
    ? (seed.morningBrief?.sentences.recap ?? result?.recap ?? null)
    : (seed.morningBrief?.sentences.today ?? (today ? EFFCoach(today.type) : null));

  const band = today ? specPaceBand(today.workoutSpec) : null;
  const hrCap = today?.hrCap ?? (today ? specHrCap(today.workoutSpec) : null);
  const paceStatFallback = today && today.pace && !['·', ' · ', 'Rest'].includes(today.pace) ? today.pace : null;
  const plannedStats: PosterStat[] | null = isDone || !today
    ? null
    : band
      ? [
          { v: secToPace(band[0]), l: 'Pace band low' },
          { v: secToPace(band[1]), l: 'Pace band high' },
          ...(hrCap != null ? ([{ v: String(hrCap), l: 'HR ceiling' }] as PosterStat[]) : []),
        ]
      : paceStatFallback
        ? [
            { v: paceStatFallback, l: 'Target pace' },
            ...(hrCap != null ? ([{ v: String(hrCap), l: 'HR ceiling' }] as PosterStat[]) : []),
          ]
        : null;
  const doneStats: PosterStat[] | null = isDone && result
    ? [
        ...(result.apace && result.apace !== '·' ? ([{ v: result.apace, l: 'Avg pace' }] as PosterStat[]) : []),
        ...(result.hr ? ([{ v: String(result.hr), l: 'Avg HR' }] as PosterStat[]) : []),
        ...(result.peak ? ([{ v: String(result.peak), l: 'Peak HR' }] as PosterStat[]) : []),
      ]
    : null;

  // ── Why today / How it went side card ───────────────────────────────
  const bailRule = today ? bailRuleFor(today.workoutSpec) : null;
  const nextBig = seed.week
    .slice(seed.todayIdx + 1)
    .find((d) => d.type === 'long' || d.type === 'race' || d.type === 'tempo' || d.type === 'intervals');
  const coachLine = isDone
    ? (seed.morningBrief?.sentences.recap ?? result?.recap ?? null)
    : (seed.morningBrief?.paragraph ?? (today ? EFFCoach(today.type) : null));

  // ── Weekly volume ────────────────────────────────────────────────────
  const weekDaysForMileage = seed.season.weekDays?.[seed.season.nowIdx] ?? [];
  const weekMileage = computeWeekMileage(
    weekDaysForMileage.map((w) => ({ dateISO: w.date ?? null, plannedMi: w.mi, doneMi: w.doneMi ?? 0, type: w.type })),
    { todayISO: seed.todayISO },
  );
  const volMax = Math.max(1, ...seed.volumeBars.map((v) => v.mi), weekMileage.plannedMi);
  const volDomainHi = Math.ceil((volMax * 1.1) / 5) * 5;

  // ── Resting HR pillar (readinessBrief) ──────────────────────────────
  const rhrPillar = seed.readinessBrief?.pillars.find((p) => p.key === 'rhr') ?? null;

  // ── Projected finish (goal race) ────────────────────────────────────
  const goal = seed.goalRace;
  const trendVals = seed.projectionTrend.map((p) => p.projectionSec);
  const hasProjection = !!goal?.projected && seed.projectionTrend.length > 0;

  return (
    <div style={{ display: 'grid', gap: 'var(--stack-gap)', maxWidth: 1360, margin: '0 auto', padding: 'var(--sp-9)' }}>
      <FaffChartRegistrar />

      <header style={{ display: 'grid', gap: 'var(--sp-2)' }}>
        <div className="faff-kicker">{seed.topDate}</div>
        <div className="faff-display" style={{ fontSize: 'var(--type-display-3)' }}>Today</div>
        <div style={{ color: 'var(--text-quiet)', fontSize: 'var(--type-body-s)' }}>{seed.weekOf}</div>
      </header>

      <div style={{ display: 'grid', gridTemplateColumns: '1.35fr 1fr', gap: 'var(--stack-gap)', alignItems: 'stretch' }}>
        {today && (
          <Poster
            state={isDone ? 'done' : posterStateFor(today.type)}
            tag={posterTag}
            verb={posterVerb}
            dose={posterDose}
            rx={posterRx}
            phase={seed.weekOf}
            stats={isDone ? doneStats : plannedStats}
          />
        )}

        {/* 2026-08-18 · real trigger for the Run Action (skip/move) sheet
            — TodayClient previously had none, leaving /today/run-action
            unreachable from the UI. Only offered for a real, not-yet-done,
            non-rest day (skipping/moving a rest day or an already-logged
            run doesn't mean anything). */}
        {!isDone && today && today.type !== 'rest' && (
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <Link href="/today/run-action" style={{
              fontFamily: 'var(--font-sub)', fontSize: 'var(--type-label-s)', fontWeight: 'var(--weight-label)',
              letterSpacing: 'var(--tracking-label)', textTransform: 'uppercase', color: 'var(--text-quiet)',
              textDecoration: 'none',
            }}>
              Skip or move →
            </Link>
          </div>
        )}

        {isDone ? (
          <Tile pad="lg" radius="l" style={{ display: 'flex', flexDirection: 'column' }}>
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 'var(--sp-6)' }}>
              <div className="faff-display" style={{ fontSize: 'var(--type-display-3)', flex: '1 1 auto', minWidth: 0 }}>How it went</div>
              <Badge tone="signal">Logged</Badge>
            </div>
            <div style={{ marginTop: 'var(--sp-6)' }}>
              {result && today && (
                <Ctx label="Actual">
                  {today.dist} mi{result.time !== '·' ? ` in ${result.time}` : ''}{result.apace !== '·' ? ` · ${result.apace}/mi average.` : '.'}
                </Ctx>
              )}
              {result && !!result.hr && (
                <Ctx label="HR">
                  Averaged <strong style={{ color: 'var(--text-primary)' }}>{result.hr}</strong>
                  {result.peak ? `, peaked at ${result.peak}` : ''}
                  {hrCap != null ? ` — ${result.peak && result.peak > hrCap ? 'over' : 'under'} the ${hrCap} ceiling.` : '.'}
                </Ctx>
              )}
              {result?.recap && result.recap.trim() && (
                <Ctx label="Recap">{result.recap}</Ctx>
              )}
            </div>
            {coachLine && (
              <CoachSay attribution="Coach" size="md" style={{ marginTop: 'auto', padding: 'var(--sp-9) 0 0' }}>{coachLine}</CoachSay>
            )}
          </Tile>
        ) : (
          <Tile pad="lg" radius="l" style={{ display: 'flex', flexDirection: 'column' }}>
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 'var(--sp-6)' }}>
              <div className="faff-display" style={{ fontSize: 'var(--type-display-3)' }}>Why today</div>
              <Badge tone="neutral">{phaseWord ?? 'Plan'}</Badge>
            </div>
            <div style={{ marginTop: 'var(--sp-6)' }}>
              {seed.morningBrief?.sentences.today && (
                <Ctx label="Purpose">{seed.morningBrief.sentences.today}</Ctx>
              )}
              {bailRule && <Ctx label="Bail rule">{bailRule}</Ctx>}
              {nextBig && (
                <Ctx label="Next up">
                  {titleCase(nextBig.dw)} — {nextBig.name}{nextBig.dist && nextBig.dist.trim() !== '·' ? `, ${nextBig.dist} mi` : ''}.
                </Ctx>
              )}
            </div>
            {coachLine && (
              <CoachSay attribution="Coach" size="md" style={{ marginTop: 'auto', padding: 'var(--sp-9) 0 0' }}>{coachLine}</CoachSay>
            )}
          </Tile>
        )}
      </div>

      <Tile pad="md" radius="l">
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 'var(--sp-5)', padding: '0 var(--sp-2)', marginBottom: 'var(--sp-6)' }}>
          <span className="faff-value" style={{ fontSize: 'var(--type-value-3)' }}>{weekMileage.actualMi}</span>
          <span style={{ fontSize: 'var(--type-body-s)', color: 'var(--text-quiet)' }}>of {weekMileage.plannedMi} mi this week</span>
        </div>
        <WeekStrip
          inset
          days={seed.week.map((d) => {
            const isPast = d.iso ? d.iso < seed.todayISO : false;
            return {
              dow: titleCase(d.dw),
              date: String(d.dn),
              mi: d.type === 'rest' ? null : (parseFloat(d.dist) || null),
              state: weekStripStateFor(d.type),
              status: d.type === 'rest' ? 'Rest' : titleCase(EFF[d.type].lbl),
              today: d.today,
              done: d.done,
              // A day is "missed" (strikethrough) when explicitly skipped, or when it's a
              // past prescribed day that never got run — genuinely missed, not fabricated.
              missed: !!d.skipped || (isPast && !d.done && d.type !== 'rest'),
            };
          })}
        />
      </Tile>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,minmax(0,1fr))', gap: 'var(--stack-gap)', alignItems: 'stretch' }}>

        {/* Readiness · own score against its own 0-100 scale, not an invented personal band. */}
        <Metric hue="easy" label="Readiness" value={seed.readiness.score} foot={[`baseline ${Math.round(seed.readiness.baseline)}`, seed.readiness.label]}>
          <faff-chart type="ring" values={JSON.stringify([seed.readiness.score])} domain="[0,100]" hue="easy" />
        </Metric>

        {/* Weekly volume · seed.volumeBars (8-week strip, real) + computeWeekMileage
            (the app's single "miles this week" definition — lib/faff/week-mileage.ts). */}
        <Metric hue="long" label="Weekly volume" value={weekMileage.actualMi} unit="mi" span={2}
          foot={['recent weeks of the block', `0 — ${volDomainHi} mi`]}>
          <faff-chart type="bars"
            values={JSON.stringify(seed.volumeBars.map((v) => v.mi))}
            domain={JSON.stringify([0, volDomainHi])}
            labels={JSON.stringify(seed.volumeBars.map((v) => v.label))}
            hue="long" />
        </Metric>

        {/* Easy days · HONESTY GAP (see task report). No per-day HR% observation is in the
            seed — that requires lib/coach/easy-discipline.ts:loadEasyDiscipline, which runs
            several DB queries and isn't in buildSeed()'s output. Rather than fabricate a
            daily reading, this card shows the real doctrine band the engine enforces
            (EASY_HRMAX_FLOOR_PCT / EASY_HRMAX_CEILING_PCT) with no invented chart. */}
        <Metric hue="quality" label="Easy days" value={`≤${Math.round(easyCeilingPct * 100)}`} unit="% max hr"
          sub={`Doctrine floor ${Math.round(easyFloorPct * 100)}%`}
          foot={[`floor ${Math.round(easyFloorPct * 100)}%`, `ceiling ${Math.round(easyCeilingPct * 100)}%`]}>
          <div style={{ alignSelf: 'center', fontSize: 'var(--type-label-s)', color: 'var(--text-quiet)', lineHeight: 1.5 }}>
            No live daily read wired yet — this is the doctrine ceiling itself, not a computed number.
          </div>
        </Metric>

        {/* Projected finish · seed.goalRace + seed.projectionTrend (real projection_snapshots
            series). Omitted entirely when there's no goal race with a projection yet. */}
        {hasProjection && goal && (
          <Metric hue="phase" label="Projected finish" value={goal.projected} span={2}
            sub={goal.delta ?? undefined}
            foot={[`goal ${goal.goal}`, `${goal.daysAway} days left`]}>
            <faff-chart type="line"
              values={JSON.stringify(trendVals)}
              labels={JSON.stringify([shortDate(seed.projectionTrend[0].date), 'now'])}
              hue="phase" />
          </Metric>
        )}

        {/* Resting HR · seed.readinessBrief's rhr pillar (real, from readiness-brief.ts). */}
        {rhrPillar && (
          <Metric hue="rest" label="Resting hr" value={rhrPillar.observedValue} span={2} sub={rhrPillar.observedSub}
            foot={[rhrPillar.baseline, `${rhrPillar.trend.length} days`]}>
            <faff-chart type="line"
              values={JSON.stringify(rhrPillar.trend.map((t) => t.value))}
              labels={JSON.stringify([rhrPillar.trend.length ? shortDate(rhrPillar.trend[0].date) : '', 'today'])}
              hue="rest" />
          </Metric>
        )}
      </div>
    </div>
  );
}

/** Canonical KIT coach line for a type — real authored copy (components/faff-app/constants.ts),
 *  used only as the fallback when the server-composed morningBrief hasn't resolved for this
 *  visitor. Never invented per-page. */
function EFFCoach(type: EffortKey): string {
  return KIT[type].coach;
}
