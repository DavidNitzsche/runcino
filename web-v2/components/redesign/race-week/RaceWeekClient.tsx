'use client';

import type { FaffSeed } from '@/components/faff-app/types';
import type { WorkoutSpec } from '@/lib/faff/types';
import { computeWeekMileage } from '@/lib/faff/week-mileage';
import { resolveBGoal } from '@/lib/race/b-goal';
import type { RaceWeekCourse } from '@/lib/faff/race-week-course';
import { Tile } from '@/components/redesign/core/Tile';
import { Badge } from '@/components/redesign/core/Badge';
import { Stat } from '@/components/redesign/core/Stat';
import { Button } from '@/components/redesign/core/Button';
import { SessionHeadline } from '@/components/redesign/core/SessionHeadline';
import { Progress } from '@/components/redesign/core/Progress';
import { CoachSay } from '@/components/redesign/coach/CoachSay';
import { RangeScale } from '@/components/redesign/graphics/RangeScale';
import { MetricRow, type MetricRowItem } from '@/components/redesign/graphics/MetricRow';
import { WeekShape, type WeekShapeDay } from '@/components/redesign/graphics/WeekShape';
import { ElevationProfile } from '@/components/redesign/graphics/ElevationProfile';
import { Alert, type AlertTone } from '@/components/redesign/feedback/Alert';
import { Silence } from '@/components/redesign/feedback/Silence';

/**
 * components/redesign/race-week/RaceWeekClient.tsx
 *
 * The redesigned Race Week screen — a special mode shown only in the final
 * ~7 days before a goal race (app/redesign/race-week/page.tsx gates entry
 * on the same threshold every other race-week consumer in this codebase
 * uses; see that file's header comment for the full citation). Structurally
 * ported from the outside-studio handoff's WebRaceWeek.jsx (designs/
 * design-review-0818/ui_kits/web/WebRaceWeek.jsx): all 12 components it
 * names (Tile, Stat, RangeScale, MetricRow, SessionHeadline, CoachSay,
 * Button, WeekShape, Badge, Alert, ElevationProfile, Progress) were already
 * on `main` before this task — none built here.
 *
 * Unlike Today / Block / Activity / Run Detail, this is NEW real logic, not
 * a re-skin of something already wired: race-week mode has never been built
 * on any surface (backlog "Wave 3-4: race-week mode"). Every field below
 * traces to a seed field, a canonical resolver already used elsewhere in
 * this codebase, or a small new server-side query in lib/faff/race-week-
 * course.ts (see that file's header for exactly what's new vs reused).
 *
 * ── Real data sources, per element ─────────────────────────────────────
 *
 *   · Hero kicker / SessionHeadline / MetricRow (pace band, HR ceiling) —
 *     seed.week[seed.todayIdx].workoutSpec, the SAME real prescribed
 *     workout Today reads (components/redesign/today/TodayClient.tsx's
 *     specPaceBand/specHrCap, reproduced here — page-local helper, not a
 *     shared module, same idiom TodayClient/RunDetailClient/BlockClient
 *     already established for this exact pair of functions).
 *   · "Days to gun" — the `daysToRace` prop, computed server-side in
 *     page.tsx via lib/faff/race-countdown.ts (the canonical resolver).
 *   · "Taper week X of Y" badge — seed.season.phases, the real plan_phases
 *     rows (same source BlockClient's phaseGroups reads); only rendered
 *     when the plan actually authored a phase labelled "taper" covering
 *     the current week. No proportional-fallback taper guess — a plan
 *     with no authored taper phase just doesn't get the badge.
 *   · "The week into the gun" WeekShape — seed.week (the same real 7-day
 *     window TodayClient's WeekStrip renders) for the day-by-day bars;
 *     seed.season.weekDays[nowIdx] + computeWeekMileage (the app's one
 *     "miles this week" definition, lib/faff/week-mileage.ts) for the
 *     planned-mi badge — same split TodayClient already uses.
 *   · Course / ElevationProfile — `course` prop, from
 *     lib/faff/race-week-course.ts#loadRaceWeekCourse. Honesty-gated on
 *     `course.points`: null when no real GPS track is on file for this
 *     race (course_source is null/'stub' or races.course_geometry has no
 *     usable trackPoints) — the Silence fallback states that plainly
 *     rather than drawing a fabricated profile.
 *   · "Race plan" A/B target — goal.effectiveTarget (the ONE effective-
 *     race-target resolver the watch payload + execution plan + race
 *     detail page already pace off) for the A target, lib/race/b-goal.ts
 *     #resolveBGoal (the ONE B·SAFE resolver, same one GapPanel's
 *     race-week card and the race-detail page use) for B. Endpoints show
 *     the real stated goal (goal.goal) and the real VDOT projection
 *     (goal.projected) — never fabricated reference points.
 *   · Readiness — seed.readiness.score (the same 0-100 score Today's
 *     Readiness tile renders) + seed.readinessBrief.composition.baseline
 *     (real 14-day rolling baseline, lib/coach/readiness-brief.ts) as a
 *     single reference mark. The mock's "Your normal 54 · 72" personal
 *     band has no seed equivalent — readiness-brief.ts computes one
 *     baseline number, not a low/high personal range — so this shows the
 *     baseline as a mark, not a fabricated band. See the HONESTY GAP note
 *     below for the card this replaces entirely.
 *   · Race admin checklist — `course.registered` / `course.bib` /
 *     `course.gunTimeSet` (lib/faff/race-week-course.ts, all real
 *     races.meta fields). The mock's 4-item checklist ("bib collected ·
 *     shuttle booked · fuelling plan set · gear bag") has no backing data
 *     for "shuttle booked" or "fuelling plan set" anywhere in the schema
 *     — those two rows are dropped rather than invented; the checklist is
 *     3 real items, not a fabricated 4.
 *   · Alert — seed.readinessBrief.actions filtered to signal ===
 *     'race_week' (lib/coach/health-actions.ts's real race-week guard,
 *     confirmed at health-actions.ts ~line 672: the taper-noise
 *     suppression note and the gun-time-missing nag, both computed
 *     server-side, never invented here). Zero, one, or two Alerts render
 *     depending on what actually fired for this account today — the mock's
 *     weather copy ("Weather is still moving") has no seed equivalent (no
 *     race-day forecast is threaded onto the seed) and is not reproduced.
 *
 * ── HONESTY GAP · dropped entirely, not faked ──────────────────────────
 * The mock's "Fitness evidence" card (a VDOT-anchor-race staleness window,
 * "72 days · confirmed", RangeScale mode="window") has no seed field or
 * resolver behind it. lib/coach/fitness-evidence.ts exists in this repo but
 * is a different concept entirely (a single execution finding about a
 * workout pace coming apart, wired to the coach log) — not an anchor-race
 * evidence-age window. Rather than repurpose that module's name to fake
 * this card, or invent a new decay model, the card is dropped. If a real
 * VDOT-evidence-window resolver gets built later, this is the card to wire
 * it into.
 *
 * ── Verification limitation · read before touching this file ──────────
 * David is not currently in race week (CIM is ~110 days out this session),
 * so this branch has never rendered against his real account and could
 * not be — the negative case (app/redesign/race-week/page.tsx's EmptyState
 * for "not race week right now") is the only part of this feature that was
 * exercised against real, live account state. This component itself was
 * verified by a full manual trace against realistic synthetic data
 * shaped like David's own account 5 days out from Americas Finest City
 * (2026-08-16, a real past race on file) — reconstructing what
 * seed.goalRace / seed.week / seed.season / seed.readinessBrief would have
 * carried for that window from the real historical rows — plus `tsc`'s
 * full structural check against the real FaffSeed / RaceWeekCourse /
 * HealthAction types. There is deliberately no query-param or dev-flag
 * preview bypass in page.tsx: a bypass reachable in production would let
 * this fabricated-scenario view render against a real signed-in session,
 * which is exactly the kind of "looks live, isn't" surface CLAUDE.md's
 * race-data honesty rules exist to prevent. Give this screen a real
 * spot-check once the account is genuinely within 7 days of the CIM goal
 * race (~13 weeks from this session).
 */

// ── real-spec extraction, reproduced from TodayClient/RunDetailClient ────
// (page-local helper in every consumer so far — not worth a shared module
// for two one-line field reads. specPaceBand mirrors TodayClient.tsx's
// specPaceBand; specHrCap mirrors seed.ts's own hr_cap_bpm/hr_target_bpm/
// lthr_bpm fallback chain, components/faff-app/seed.ts:511-515.)
function specPaceBand(spec: WorkoutSpec | null | undefined): [number, number] | null {
  if (!spec) return null;
  const s = spec as unknown as { pace_target_s_per_mi_lo?: number; pace_target_s_per_mi_hi?: number };
  return typeof s.pace_target_s_per_mi_lo === 'number' && typeof s.pace_target_s_per_mi_hi === 'number'
    ? [s.pace_target_s_per_mi_lo, s.pace_target_s_per_mi_hi]
    : null;
}
function specHrCap(spec: WorkoutSpec | null | undefined): number | null {
  if (!spec) return null;
  const s = spec as unknown as { hr_cap_bpm?: number | null; hr_target_bpm?: number | null; lthr_bpm?: number | null };
  return s.hr_cap_bpm ?? s.hr_target_bpm ?? s.lthr_bpm ?? null;
}

const titleCase = (s: string) => s.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());

/** "8:09" from seconds-per-mile. Mirrors RunDetailClient.tsx's paceLabel. */
function paceLabel(spm: number | null | undefined): string | null {
  if (!spm || spm <= 0) return null;
  const total = Math.round(spm);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

/** "3:12:45" / "45:12" from seconds. Mirrors lib/training/vdot.ts's
 *  formatRaceTime — reproduced locally rather than imported so this
 *  'use client' file never risks pulling that module's wider import
 *  surface into the browser bundle (same caution TodayClient.tsx's header
 *  comment documents for lib/coach/easy-discipline.ts). */
function fmtClock(sec: number | null | undefined): string | null {
  if (sec == null || !isFinite(sec) || sec <= 0) return null;
  const s = Math.round(sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(ss).padStart(2, '0')}` : `${m}:${String(ss).padStart(2, '0')}`;
}

/** Real taper-phase position, or null when the plan never authored a
 *  phase labelled "taper" covering the current week. Deliberately does
 *  NOT fall back to BlockClient's proportional phase-split — that
 *  fallback is right for rendering a whole plan's phase arc, wrong for a
 *  single badge that should simply not appear when there's nothing
 *  authored to report. */
function taperBadge(nowIdx: number, phases: FaffSeed['season']['phases']): string | null {
  const p = phases.find((ph) => nowIdx >= ph.startWeekIdx && nowIdx <= ph.endWeekIdx);
  if (!p || !p.label.toLowerCase().trim().startsWith('taper')) return null;
  const week = nowIdx - p.startWeekIdx + 1;
  const total = p.endWeekIdx - p.startWeekIdx + 1;
  return `Taper week ${week} of ${total}`;
}

const ALERT_TONE: Record<string, AlertTone> = {
  urgent: 'fault',
  high: 'attention',
  medium: 'attention',
  low: 'info',
  'on-course': 'info',
};

export function RaceWeekClient({ seed, daysToRace, course }: {
  seed: FaffSeed;
  /** 0-7, guaranteed by page.tsx's gate before this component ever renders. */
  daysToRace: number;
  course: RaceWeekCourse | null;
}) {
  const goal = seed.goalRace!; // page.tsx only renders this component when goal is non-null
  // seed.week[todayIdx] is typed non-optional (no noUncheckedIndexedAccess
  // in tsconfig) but can be genuinely absent at runtime on a malformed
  // week array — same defensive `today?.` chaining TodayClient.tsx uses
  // throughout for this identical read.
  const today = seed.week[seed.todayIdx];

  // ── Hero ────────────────────────────────────────────────────────────
  const taper = taperBadge(seed.season.nowIdx, seed.season.phases);
  const headlineType = today ? (today.name || titleCase(today.type)) : 'Rest';
  const headlineDose = today && today.dist && today.dist.trim() !== '·' ? `${today.dist} mi` : null;

  const band = today ? specPaceBand(today.workoutSpec) : null;
  const hrCap = today?.hrCap ?? (today ? specHrCap(today.workoutSpec) : null);

  const paceItem: MetricRowItem | null = band
    ? (() => {
        const pad = Math.max(20, (band[1] - band[0]) * 0.6);
        const min = band[0] - pad;
        const max = band[1] + pad;
        return {
          label: 'Pace band', sub: 'Today’s prescribed range',
          value: `${paceLabel(band[0])} · ${paceLabel(band[1])}`,
          scale: <RangeScale style={{ marginTop: 0 }} min={min} max={max} band={{ low: band[0], high: band[1] }}
            endpoints={[paceLabel(min) ?? '', paceLabel(max) ?? '']} hue="pace" />,
        };
      })()
    : today?.pace && !['·', ' · ', 'Rest'].includes(today.pace)
      ? { label: 'Pace band', sub: 'Today’s target', value: today.pace }
      : null;

  const hrItem: MetricRowItem | null = hrCap != null
    ? (() => {
        const zoneLow = Math.max(80, hrCap - 60);
        const max = hrCap + 10;
        return {
          label: 'Ceiling', sub: 'Zone cap for today',
          value: String(hrCap), unit: 'bpm',
          scale: <RangeScale style={{ marginTop: 0 }} mode="ceiling" min={zoneLow} max={max}
            band={{ low: zoneLow, high: hrCap }} endpoints={[String(zoneLow), String(max)]} hue="heart" />,
        };
      })()
    : null;

  const gunItem: MetricRowItem = {
    label: 'Days to gun', sub: daysToRace === 0 ? 'Today' : daysToRace === 1 ? 'Tomorrow' : taper ?? undefined,
    value: String(daysToRace),
    scale: <RangeScale style={{ marginTop: 0 }} mode="progress" min={0} max={7} value={7 - daysToRace}
      endpoints={['Race week opens', 'Race day']} hue="race" />,
  };
  const metricItems = [paceItem, hrItem, gunItem].filter((x): x is MetricRowItem => x != null);

  // ── Coach line · real season sentence + a real, computed volume-drop
  //    read (block peak week vs this week), never copy-pasted mock prose.
  const raceIdx = seed.season.raceIdx;
  const miles = seed.season.miles;
  const peakMi = raceIdx > 0 ? Math.max(0, ...miles.slice(0, raceIdx)) : 0;
  const thisWeekMi = miles[seed.season.nowIdx] ?? 0;
  const volumeDropPct = peakMi > 0 && thisWeekMi < peakMi ? Math.round((1 - thisWeekMi / peakMi) * 100) : null;
  const coachLine = [
    seed.morningBrief?.sentences.season,
    volumeDropPct != null && volumeDropPct > 0
      ? `Volume is down ${volumeDropPct}% from this block’s peak week · the fitness is already banked, this week only protects it.`
      : null,
  ].filter((s): s is string => !!s).join(' ') || (seed.morningBrief?.paragraph ?? `${goal.name} is ${daysToRace} days out.`);

  // ── The week into the gun ─────────────────────────────────────────────
  const weekDaysForMileage = seed.season.weekDays?.[seed.season.nowIdx] ?? [];
  const weekMileage = computeWeekMileage(
    weekDaysForMileage.map((w) => ({ dateISO: w.date ?? null, plannedMi: w.mi, doneMi: w.doneMi ?? 0, type: w.type })),
    { todayISO: seed.todayISO },
  );
  const weekShapeDays: WeekShapeDay[] = seed.week.map((d) => ({
    load: parseFloat(d.dist) || 0,
    quality: d.type === 'race',
    today: !!d.today,
    future: d.iso ? d.iso > seed.todayISO : false,
    label: `${titleCase(d.dw)} · ${d.name || titleCase(d.type)}`,
  }));

  // ── Race plan · A/B target, the same resolvers GapPanel's race-week
  //    card and the race-detail page already pace off.
  const aSec = goal.effectiveTarget?.targetSec ?? null;
  const bResolved = resolveBGoal({ effectiveTargetSec: aSec, storedBGoalSec: goal.goalSafeSec ?? null });
  const aStr = fmtClock(aSec);
  const bStr = fmtClock(bResolved.sec);
  const planValue = aStr && bStr ? `${aStr} · ${bStr}` : (aStr ?? goal.goal ?? '·');
  const planSub = aSec != null
    ? (goal.effectiveTarget?.source === 'projection' ? 'Paced off your projection, not the stated goal' : 'Band, not a single number')
    : 'No evidence-based target yet';
  const planPad = aSec != null && bResolved.sec != null ? Math.max(60, (bResolved.sec - aSec) * 1.2) : 300;
  const planMin = aSec != null ? Math.max(0, aSec - planPad) : 0;
  const planMax = bResolved.sec != null ? bResolved.sec + planPad : (aSec ?? planPad) + planPad;

  // ── Readiness ──────────────────────────────────────────────────────
  const baseline = seed.readinessBrief?.composition?.baseline;

  // ── Race admin · 3 real fields, not the mock's fabricated 4 ─────────
  const adminChecks = [
    { label: 'Registered', done: course?.registered === true },
    { label: 'Bib assigned', done: !!course?.bib },
    { label: 'Gun time set', done: !!course?.gunTimeSet },
  ];
  const adminDone = adminChecks.filter((c) => c.done).length;
  const doneLabels = adminChecks.filter((c) => c.done).map((c) => c.label.toLowerCase());
  const missingLabels = adminChecks.filter((c) => !c.done).map((c) => c.label.toLowerCase());
  const adminBody = missingLabels.length === 0
    ? 'Registered · bib assigned · gun time set.'
    : `${doneLabels.length ? doneLabels.join(' · ') + ' done · ' : ''}${missingLabels.join(' · ')} still open.`;

  // ── Alert · real race_week actions only ───────────────────────────
  const raceWeekActions = (seed.readinessBrief?.actions ?? []).filter((a) => a.signal === 'race_week');

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1.6fr 1fr', gap: 'var(--sp-6)', alignItems: 'start', maxWidth: 1360, margin: '0 auto', padding: 'var(--sp-9)' }}>
      <div style={{ display: 'grid', gap: 'var(--sp-4)' }}>
        <Tile pad="lg" radius="2xl">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
            <div style={{
              fontSize: 'var(--type-kicker)', letterSpacing: 'var(--tracking-kicker)',
              textTransform: 'uppercase', color: 'var(--signal)',
            }}>Race week · {seed.topDate}</div>
            <div style={{ display: 'flex', gap: 8 }}>
              <Badge tone="signal">A race</Badge>
              {taper && <Badge tone="quiet">{taper}</Badge>}
            </div>
          </div>
          <SessionHeadline style={{ marginTop: 'var(--sp-7)' }} type={headlineType} dose={headlineDose} />
          {metricItems.length > 0 && <MetricRow style={{ marginTop: 'var(--sp-9)' }} items={metricItems} />}
          <CoachSay size="lg" style={{ padding: 'var(--sp-11) 0 var(--sp-6)' }}>{coachLine}</CoachSay>
          <div style={{ display: 'flex', gap: 'var(--sp-5)' }}>
            {/* Inert · same "no confirmed live destination yet" call
                BlockClient's WeeksTable SegmentBar and RunDetailClient's
                pace/HR SegmentBar already made. Wire to /redesign/races/
                [slug] once that route lands. */}
            <Button variant="secondary" size="md">Review the race plan</Button>
          </div>
        </Tile>

        <Tile>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ fontSize: 'var(--type-label)', color: 'var(--text-secondary)' }}>The week into the gun</div>
            <Badge tone="quiet">{weekMileage.plannedMi} mi planned</Badge>
          </div>
          <WeekShape style={{ marginTop: 'var(--sp-7)' }} height={80} days={weekShapeDays}
            labels={seed.week.map((d) => titleCase(d.dw).slice(0, 1))} />
        </Tile>

        <Tile>
          <div style={{ fontSize: 'var(--type-label)', color: 'var(--text-secondary)' }}>Course · {goal.name}</div>
          {course?.points ? (
            <ElevationProfile style={{ marginTop: 'var(--sp-7)' }} height={120} points={course.points}
              footnotes={[
                course.netElevFt != null ? `Net ${course.netElevFt >= 0 ? '+' : ''}${course.netElevFt} ft` : 'Net unknown',
                course.gainFt != null ? `Gain ${course.gainFt} ft` : 'Gain unknown',
              ]} />
          ) : (
            <Silence style={{ marginTop: 'var(--sp-7)' }} reason={`No GPS course on file for ${goal.name} yet.`} />
          )}
        </Tile>
      </div>

      <div style={{ display: 'grid', gap: 'var(--sp-4)' }}>
        <Tile>
          <Stat label="Race plan" sub={planSub} value={planValue} size="sm" />
          <RangeScale min={planMin} max={planMax}
            band={aSec != null && bResolved.sec != null ? { low: aSec, high: bResolved.sec } : null}
            target={aSec ?? undefined}
            endpoints={[`${goal.goal} goal`, goal.projected ? `${goal.projected} projection` : 'No projection yet']} />
        </Tile>

        <Tile>
          <Stat label="Readiness" sub="Against your own normal" value={seed.readiness.score} size="md" />
          <RangeScale min={0} max={100} value={seed.readiness.score} endpoints={['0', '100']}
            centerLabel={baseline != null ? `Baseline ${Math.round(baseline)}` : null} />
        </Tile>

        <Tile>
          <div style={{ fontSize: 'var(--type-label)', color: 'var(--text-secondary)' }}>Race admin</div>
          <div style={{ display: 'grid', gap: 'var(--sp-6)', marginTop: 'var(--sp-7)' }}>
            <Progress value={adminDone} max={3} label="Ready to race" tail={`${adminDone} of 3`} />
            <div style={{ fontSize: 'var(--type-body-s)', color: 'var(--text-secondary)', lineHeight: 'var(--lh-body-s)' }}>
              {adminBody}
            </div>
          </div>
        </Tile>

        {raceWeekActions.map((a) => (
          <Alert key={a.signal + a.action} tone={ALERT_TONE[a.priority] ?? 'info'}>
            {a.action}
          </Alert>
        ))}
      </div>
    </div>
  );
}
