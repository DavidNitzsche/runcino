'use client';

import { useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import type { FaffSeed, GoalRace, PlanProposalSeed } from '@/components/faff-app/types';
import type { CoachLogKind } from '@/lib/coach/coach-log';
import { parseRaceTime } from '@/lib/training/vdot';
import { resolveGoalStatus, formatGapClock, type GoalStatusRead } from '@/lib/faff/goal-status';
import { Tile } from '@/components/redesign/core/Tile';
import { Badge } from '@/components/redesign/core/Badge';
import { Button } from '@/components/redesign/core/Button';
import { CoachDecision, type CoachDecisionKind, type CoachDecisionOption } from '@/components/redesign/coach/CoachDecision';
import { LogEntry, type LogEntryKind } from '@/components/redesign/coach/LogEntry';
import { SegmentBar } from '@/components/redesign/nav/SegmentBar';
import { FaffChartRegistrar } from '@/components/redesign/graphics/FaffChartRegistrar';

/**
 * components/redesign/season/SeasonClient.tsx
 *
 * The redesigned Season screen, wired to the SAME real seed every other
 * redesign route renders (components/faff-app/seed.ts buildSeed()) — no
 * new data path. Structurally ported from the outside-studio handoff's
 * WebSeason.jsx (designs/design-review-0818/ui_kits/web/WebSeason.jsx):
 * the Metric layout primitive is page-local in the source file too (not
 * part of the shared component library), so it is reproduced here rather
 * than "ported" as a standalone component — same idiom as
 * TodayClient / BlockClient / RunDetailClient.
 *
 * ── FORK DECISION (task asked to re-examine Block's blockRunsToRace fork) ──
 * BlockClient forks on lib/faff/ramp-scope.ts#resolveRampScope because
 * every element on that page (the phase arc, the peak/cutback weeks, the
 * weeks table) is WEEK-INDEXED off the active plan — genuinely fabricated
 * shape when the active plan is a recovery bridge that doesn't run to the
 * goal race.
 *
 * Season is a different zoom level: despite the name, WebSeason.jsx's
 * composition (hero gap panel, projection trend, VDOT-required, confidence,
 * gap-breakdown bars, upcoming calendar, the log, the lever) is entirely
 * GOAL-RACE-scoped, not BLOCK-scoped. None of seed.season's week/phase
 * arrays are read by this file. The trajectory/confidence/gap-breakdown
 * fields on seed.goalRace are computed the same way whether the runner is
 * mid-block or between blocks (lib/training/goal-projection.ts only cares
 * about VDOT + goal date, not active-plan phase state) — so the
 * blockRunsToRace fork does not apply here; forking on it would be
 * cargo-culting Block's guard onto a page it doesn't protect.
 *
 * The state that actually drives Season's shape is "does a real
 * goal-projection story exist" — so this file forks on `seed.goalRace`
 * itself (NoGoalSeason below) and then guards each panel independently on
 * the specific real field it needs (trajectory / confidenceLabel /
 * driftSignals / a pending goal_renegotiation proposal), per CLAUDE.md's
 * per-finding context-filter rule: a parent guard doesn't protect every
 * child element, each one applies its own.
 *
 * ── REAL DATA SOURCES ──
 *   · seed.goalRace — name/date/goal/projected/trajectory/confidenceLabel/
 *     confidenceInterval/driftSignals/courseImpactSec/conditionsImpactSec/
 *     executionBufferSec/levers. All real, computed server-side in
 *     seed.ts by lib/training/goal-projection.ts + the GapPanel chunk
 *     resolvers (course-impact.ts, race-conditions.ts, pacing-discipline.ts,
 *     projection-levers.ts).
 *   · seed.projectionTrend — daily projection_snapshots series for the
 *     goal race's distance. Same field TodayClient's "Projected finish"
 *     chart already reads.
 *   · seed.planProposals — the SAME pending-proposal list TargetsView and
 *     TrainView read to find a pending `goal_renegotiation` (see
 *     lib/plan/goal-renegotiation.ts). When one is pending, the hero
 *     CoachDecision wires REAL Hold/Move buttons to the exact endpoints
 *     TargetsView's GoalRenegotiationCard uses — see the "CoachDecision
 *     data source" note below.
 *   · seed.coachLog — the real coach's-log feed (lib/coach/coach-log.ts),
 *     already computed into the seed (loadCoachLog(userId, {limit:8})).
 *     Feeds LogEntry directly — no new plumbing needed.
 *   · seed.races — the real calendar (RaceLite[], priority A/B/C), same
 *     field TargetsView's CALENDAR reads. Feeds "Upcoming".
 *   · seed.health.vdotAnchor — real VDOT provenance (ageDays/tier), feeds
 *     the Confidence metric's foot label.
 *
 * ── CoachDecision data source (the task's flagged open question) ──
 * WebSeason.jsx's CoachDecision ("Hold the goal / Move the goal / Decide
 * later", footer "if you move it, here is the band") is NOT a fabricated
 * flow — it maps 1:1 onto a real, already-shipped mechanism:
 * lib/plan/goal-renegotiation.ts writes a pending `plan_proposals` row
 * (kind='goal_renegotiation') when the gap has read 'unclosable' for 5+
 * consecutive snapshot days, carrying real A/B/C alternative-time bands
 * from the gap report. components/faff-app/views/TargetsView.tsx already
 * renders this exact decision inline (GoalRenegotiationCard) with two real
 * endpoints:
 *   · Hold  → POST /api/plan/proposal { id, action: 'dismiss' }
 *   · Move  → PATCH /api/race/{slug} { goalSec, source: 'renegotiate' }
 * This file wires the SAME two endpoints (see `hold`/`move` below) rather
 * than inventing a new one, so accepting/dismissing here has the identical
 * real effect it has on Targets/Train — one mechanism, three renderings.
 * "Decide later" stays inert (no onClick), matching both the source mock
 * and the legacy inline card (there it's plain text, not a button).
 *
 * When there is NO pending renegotiation (the common case — most days the
 * gap hasn't been unclosable for 5 straight days), the hero card
 * degrades to a real but non-actionable read off seed.goalRace's own
 * status fields (kind='proposal' when watching/behind with no proposal
 * yet, kind='applied' when on-pace/ahead) rather than showing an inert
 * copy of the mock's fabricated-looking three-button ask. See
 * `goalDecisionContent` below.
 *
 * ── HONESTY GAPS ──
 *   · Confidence metric — the mock's "0.62" is a fabricated 0-1 score.
 *     lib/training/goal-projection.ts#computeConfidenceLabel only ever
 *     produces a CATEGORICAL tier (HIGH/MEDIUM/LOW), never a continuous
 *     number — mapping it onto a fixed ring percentage (e.g. high=90) would
 *     manufacture a precision the engine doesn't have. Same treatment
 *     TodayClient gave "Easy days" (doctrine ceiling, no invented chart):
 *     this card shows the real word + descriptor + detail, no ring.
 *   · "34 runs" in the mock's confidence foot has no real analog (no
 *     module counts "runs feeding this VDOT read"); replaced with the real
 *     vdotAnchor.ageDays / .tier (lib/training's actual provenance fields).
 *   · SegmentBar ("season / block / all") carries no onChange, same
 *     limitation-ported-faithfully call RunDetailClient/BlockClient made —
 *     the source mock itself never authors content for the other views.
 *   · "The lever" button is ported inert exactly as WebSeason.jsx has it
 *     (no onClick in the source either); when the real lever carries a
 *     `linkTo` (e.g. `/races/{slug}`, which next.config's redirect maps to
 *     the real `/goal/{slug}` page), the button becomes a real link instead
 *     of staying inert — an upgrade over the source, not a gap.
 */

// ── page-local layout primitives (mirrors WebSeason.jsx's own Metric) ──

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

/** Same date formatting BlockClient uses (TrainView.tsx:2068-2077's
 *  local-date-parts parse, not new Date(iso) which is UTC and can read a
 *  day early west of Greenwich). Reproduced for the same page-local
 *  reason cited there. */
function formatDate(iso: string | null | undefined): string {
  if (!iso) return '·';
  const parts = iso.split('-').map(Number);
  if (parts.length < 3 || parts.some((n) => Number.isNaN(n))) return '·';
  const d = new Date(parts[0], parts[1] - 1, parts[2]);
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(d);
}

/** CoachLogKind (8 real kinds, lib/coach/coach-log.ts) → LogEntryKind (the
 *  5 kinds the ported LogEntry component's KIND table supports). The two
 *  2026-08-18 firing-policy kinds (fitness_evidence, threshold_pattern,
 *  race_replacement) have no exact analog in the smaller ported vocabulary
 *  — mapped to their closest real cousin rather than invented as new kinds
 *  on a locked shared component. loadCoachLog's own reader defaults an
 *  unrecognized kind to 'week_close'; this mirrors that same fallback
 *  discipline for the one kind with no reasonable cousin. */
function toLogEntryKind(kind: CoachLogKind): LogEntryKind {
  switch (kind) {
    case 'week_close': return 'week-close';
    case 'phase_boundary': return 'phase';
    case 'first_ever': return 'first';
    case 'fitness_shift': return 'fitness';
    case 'easy_discipline': return 'discipline';
    case 'fitness_evidence': return 'fitness'; // a session's fitness signal, same bucket as fitness_shift
    case 'threshold_pattern': return 'discipline'; // a sustained per-domain pattern, same framing as easy_discipline
    case 'race_replacement': return 'week-close'; // no cousin — same fallback loadCoachLog's own reader uses
    default: return 'week-close';
  }
}

/** Widening/closing streak off the real daily projection series — same
 *  "derived from real weeks, not copied prose" discipline BlockClient's
 *  shapeCopy/qualityCopy use. Walks the trailing days of seed.projectionTrend
 *  and counts how many in a row moved the same direction relative to the
 *  goal. Returns null when there's not enough history to say anything
 *  (fewer than 2 real snapshots) — callers render nothing rather than a
 *  fabricated "steady" line. */
function projectionStreak(
  trend: FaffSeed['projectionTrend'],
  goalSec: number | null,
): { direction: 'widening' | 'closing' | 'holding'; days: number } | null {
  if (goalSec == null) return null;
  const gaps = trend
    .filter((p) => p.projectionSec != null)
    .map((p) => (p.projectionSec as number) - goalSec);
  if (gaps.length < 2) return null;
  let days = 1;
  let dir: 'widening' | 'closing' | 'holding' = 'holding';
  for (let i = gaps.length - 1; i > 0; i -= 1) {
    const delta = gaps[i] - gaps[i - 1];
    const stepDir = delta > 0.5 ? 'widening' : delta < -0.5 ? 'closing' : 'holding';
    if (i === gaps.length - 1) {
      dir = stepDir;
      if (dir === 'holding') break;
      continue;
    }
    if (stepDir !== dir) break;
    days += 1;
  }
  return { direction: dir, days };
}

export function SeasonClient({ seed }: { seed: FaffSeed }) {
  const goal = seed.goalRace;
  if (!goal) return <NoGoalSeason seed={seed} />;
  return <GoalSeason seed={seed} goal={goal} />;
}

// ─────────────────────────────────────────────────────────────────────────
// The normal case: a real goal race with a real projection story.
// ─────────────────────────────────────────────────────────────────────────
function GoalSeason({ seed, goal }: { seed: FaffSeed; goal: GoalRace }) {
  const router = useRouter();
  const goalSec = parseRaceTime(goal.goal);
  const projSec = parseRaceTime(goal.projected) ?? null;

  const renegotiation = (seed.planProposals ?? []).find(
    (p) => p.kind === 'goal_renegotiation' && p.status === 'pending',
  ) ?? null;

  // ONE status vocabulary (lib/faff/goal-status.ts) — the same read
  // TargetsView / TrainView / Today's GAP tile all resolve to, so this
  // page never states a fourth dialect for the same fact.
  const status = resolveGoalStatus({
    trajectory: goal.trajectory ?? null,
    goalSec,
    projectionSec: goal.vdotProjectionSec ?? null,
    unclosable: renegotiation != null,
  });

  const weeksOut = Math.round(goal.daysAway / 7);
  const streak = projectionStreak(seed.projectionTrend, goalSec);

  // ── Where the gap sits · same formula seed.ts uses right before it
  // feeds lib/coach/projection-levers.ts (components/faff-app/seed.ts
  // ~2580-2586) — reproduced here rather than re-exported since it is a
  // few lines of arithmetic over fields already on the seed, not worth a
  // new shared module for one page. ──
  const totalGapSec = goalSec != null && projSec != null ? Math.max(0, projSec - goalSec) : null;
  const courseImpSec = goal.courseImpactSec ?? 0;
  const condImpSec = goal.conditionsImpactSec ?? 0;
  const execImpSec = goal.executionBufferSec ?? 30;
  const fitnessGapSec = totalGapSec != null ? Math.max(0, totalGapSec - courseImpSec - condImpSec - execImpSec) : null;

  const vdotAnchor = seed.health?.vdotAnchor ?? null;

  return (
    <div style={{ display: 'grid', gap: 'var(--stack-gap)', maxWidth: 1360, margin: '0 auto', padding: 'var(--sp-9)' }}>
      <FaffChartRegistrar />

      <div style={{ display: 'grid', gridTemplateColumns: '1.35fr 1fr', gap: 'var(--stack-gap)', alignItems: 'stretch' }}>
        <GoalHero goal={goal} weeksOut={weeksOut} status={status} router={router} />
        <GoalDecision goal={goal} status={status} renegotiation={renegotiation} router={router} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,minmax(0,1fr))', gap: 'var(--stack-gap)', alignItems: 'stretch' }}>
        {/* Projection · seed.projectionTrend (real projection_snapshots series,
            same field TodayClient's "Projected finish" chart reads). Omitted
            when there's no history to draw (cold-start / no snapshots yet). */}
        {seed.projectionTrend.length > 0 && (
          <Metric hue="phase" label="Projection" value={goal.projected ?? '·'} span={2}
            foot={[
              `${seed.projectionTrend.length} days of reads`,
              streak ? `${streak.direction} · ${streak.days} day${streak.days === 1 ? '' : 's'}` : 'not enough history yet',
            ]}>
            <faff-chart type="line"
              values={JSON.stringify(seed.projectionTrend.map((p) => p.projectionSec ?? 0))}
              labels={JSON.stringify([formatDate(seed.projectionTrend[0].date), 'today'])}
              hue="phase" />
          </Metric>
        )}

        {/* Fitness required · seed.goalRace.trajectory (real, lib/training/
            fitness-trajectory.ts). Null at cold-start / no race date — omit
            rather than fabricate a VDOT gap. */}
        {goal.trajectory && (
          <Metric hue="quality" label="Fitness required" value={goal.trajectory.currentVdot.toFixed(1)} unit="vdot"
            foot={[
              `${goal.name.split(' ').slice(0, 2).join(' ')} needs ${goal.trajectory.goalVdot.toFixed(1)}`,
              goal.trajectory.gapVdot > 0 ? `+${goal.trajectory.gapVdot.toFixed(1)} to go` : 'already there',
            ]}>
            <faff-chart type="ring"
              values={JSON.stringify([goal.trajectory.currentVdot])}
              domain={JSON.stringify([30, Math.max(goal.trajectory.goalVdot, goal.trajectory.currentVdot, 30)])}
              hue="quality" />
          </Metric>
        )}

        {/* Confidence · HONESTY GAP (see file header). goal-projection.ts only
            ever produces a categorical HIGH/MEDIUM/LOW tier, never a 0-1
            score — no ring, real word + real detail, same treatment
            TodayClient gave "Easy days". */}
        {goal.confidenceLabel && (
          <Metric hue="rest" label="Confidence" value={goal.confidenceLabel.word}
            foot={[
              vdotAnchor ? `anchor ${vdotAnchor.ageDays}d · ${vdotAnchor.tier}` : 'anchor unknown',
              goal.confidenceLabel.descriptor,
            ]}>
            <div style={{ alignSelf: 'center', fontSize: 'var(--type-label-s)', color: 'var(--text-quiet)', lineHeight: 1.5 }}>
              {goal.confidenceLabel.detail}. No numeric confidence score is computed — the engine only grades this HIGH / MEDIUM / LOW.
            </div>
          </Metric>
        )}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,minmax(0,1fr))', gap: 'var(--stack-gap)', alignItems: 'start' }}>
        {/* Where the gap sits · real per-race GapPanel chunks (course-impact.ts,
            race-conditions.ts, pacing-discipline.ts) + the fitness remainder,
            same arithmetic seed.ts runs before projection-levers.ts. Omitted
            when there's no goal time / projection to split. */}
        {fitnessGapSec != null && (
          <Metric hue="long" label="Where the gap sits" value={formatGapClock(fitnessGapSec)} unit="of it is fitness"
            foot={['fit · exec · course · cond', 'mm:ss']}>
            <faff-chart type="bars"
              values={JSON.stringify([fitnessGapSec / 60, execImpSec / 60, courseImpSec / 60, condImpSec / 60])}
              domain={JSON.stringify([0, Math.max(1, (totalGapSec ?? 0) / 60 * 1.15)])}
              labels={JSON.stringify(['fitness', 'execution', 'course', 'conditions'])}
              hue="long" />
          </Metric>
        )}

        <UpcomingPanel seed={seed} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,minmax(0,1fr))', gap: 'var(--stack-gap)', alignItems: 'start' }}>
        <LogPanel seed={seed} />
        <LeverPanel goal={goal} />
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Hero mesh panel · the season's one fact, off real goalRace + status fields.
// ─────────────────────────────────────────────────────────────────────────
function GoalHero({ goal, weeksOut, status, router }: {
  goal: GoalRace; weeksOut: number; status: GoalStatusRead | null; router: ReturnType<typeof useRouter>;
}) {
  const headline = status?.tier === 'ahead'
    ? (status.gapLabel ? `${status.gapLabel} ahead` : 'Ahead')
    : status?.tier === 'on-pace'
      ? 'On pace'
      : status?.gapLabel
        ? <>{status.gapLabel}<br />to close</>
        : 'No read yet';

  const body = goal.projected
    ? status && status.tier !== 'ahead' && status.tier !== 'on-pace'
      ? `The plan projects ${goal.projected}. You asked for ${goal.goal}.`
      : `The plan projects ${goal.projected}, inside your ${goal.goal} goal.`
    : 'No fitness read yet to project this goal from.';

  // A div, not an <a> — the "See results" pill needs its own real link
  // nested inside the clickable card area, and nested <a> tags are invalid
  // markup. router.push keeps this a real client-side navigation to the
  // real /goal/[slug] page (same route ActivityClient already links to).
  return (
    <div
      role="link"
      tabIndex={0}
      onClick={() => router.push(`/goal/${goal.slug}`)}
      onKeyDown={(e) => { if (e.key === 'Enter') router.push(`/goal/${goal.slug}`); }}
      style={{
        position: 'relative', overflow: 'hidden', borderRadius: 'var(--radius-2xl)',
        background: 'var(--g-quality)', color: 'var(--text-on-mesh)', padding: 'var(--sp-10)',
        display: 'flex', flexDirection: 'column', minHeight: 430, cursor: 'pointer',
      }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 'var(--sp-7)' }}>
        <div style={{
          fontFamily: 'var(--font-sub)', fontSize: 'var(--type-label)', fontWeight: 'var(--weight-label)',
          letterSpacing: 'var(--tracking-label)', textTransform: 'uppercase', opacity: 0.85,
        }}>{goal.name} · {formatDate(goal.date)}</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-6)', flex: '0 0 auto' }}>
          <span style={{
            fontFamily: 'var(--font-sub)', fontSize: 'var(--type-label-s)', fontWeight: 'var(--weight-label)',
            letterSpacing: 'var(--tracking-label)', textTransform: 'uppercase', opacity: 0.7, whiteSpace: 'nowrap',
          }}>A race · {weeksOut} week{weeksOut === 1 ? '' : 's'} out</span>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); router.push('/goal'); }}
            style={{
              background: 'rgba(255,255,255,.16)', border: 0, cursor: 'pointer', color: '#fff',
              padding: 'var(--sp-4) var(--sp-6)', borderRadius: 'var(--radius-pill)', whiteSpace: 'nowrap',
              fontFamily: 'var(--font-sub)', fontSize: 'var(--type-label-s)', fontWeight: 'var(--weight-label)',
              letterSpacing: 'var(--tracking-label)', textTransform: 'uppercase',
            }}>See results →</button>
        </div>
      </div>
      <div className="faff-display" style={{ fontSize: 'var(--type-display-1)', lineHeight: 0.92, marginTop: 'var(--sp-8)' }}>{headline}</div>
      <div style={{ fontSize: 'var(--type-body)', lineHeight: 'var(--lh-body)', marginTop: 'var(--sp-7)', maxWidth: '42ch', opacity: 0.94 }}>
        {body}
      </div>
      <div style={{ marginTop: 'auto', display: 'grid', gridTemplateColumns: 'repeat(3,minmax(0,1fr))', gap: 'var(--sp-7)' }}>
        {[
          [goal.projected ?? '·', 'Projected'],
          [goal.goal, 'Goal'],
          [goal.confidenceLabel?.word ?? '·', goal.confidenceLabel ? 'Confidence' : 'Confidence · no read'],
        ].map(([v, l], i) => (
          <div key={l} style={{ opacity: i === 2 ? 0.72 : 1 }}>
            <div className="faff-value" style={{ fontSize: 'var(--type-value-3)' }}>{v}</div>
            <div style={{
              fontFamily: 'var(--font-sub)', fontSize: 'var(--type-label-s)', fontWeight: 'var(--weight-label)',
              letterSpacing: 'var(--tracking-label)', textTransform: 'uppercase', marginTop: 4, opacity: 0.85,
            }}>{l}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// The CoachDecision · real goal_renegotiation proposal when pending, a
// real-but-inert status read otherwise. See file header note.
// ─────────────────────────────────────────────────────────────────────────
function GoalDecision({ goal, status, renegotiation, router }: {
  goal: GoalRace; status: GoalStatusRead | null;
  renegotiation: PlanProposalSeed | null;
  router: ReturnType<typeof useRouter>;
}) {
  const [busy, setBusy] = useState<null | 'hold' | 'move'>(null);
  const [error, setError] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState(false);

  if (renegotiation && !dismissed) {
    const reasons = renegotiation.reasons ?? {};
    const alternatives = (reasons as {
      alternatives?: Record<'a' | 'b' | 'c', { sec: number; display: string; label: string }>;
    }).alternatives ?? null;
    const suggested = alternatives?.b ?? null;
    const raceSlug = typeof (reasons as { race_slug?: unknown }).race_slug === 'string'
      ? (reasons as { race_slug: string }).race_slug
      : goal.slug;

    // Real endpoints — the same two TargetsView's GoalRenegotiationCard
    // uses (lib/plan/goal-renegotiation.ts's own accept_path). See the
    // file header's "CoachDecision data source" note.
    async function hold() {
      setBusy('hold'); setError(null);
      try {
        const r = await fetch('/api/plan/proposal', {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ id: renegotiation!.id, action: 'dismiss' }),
        });
        const j = await r.json().catch(() => ({}));
        if (!r.ok && !(j as { ok?: boolean }).ok) throw new Error(`HTTP ${r.status}`);
        setDismissed(true);
        router.refresh();
      } catch (e) {
        setBusy(null);
        setError(e instanceof Error ? e.message : String(e));
      }
    }
    async function move() {
      if (!suggested) return;
      setBusy('move'); setError(null);
      try {
        const r = await fetch(`/api/race/${raceSlug}`, {
          method: 'PATCH', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ goalSec: suggested.sec, source: 'renegotiate' }),
        });
        const j = await r.json().catch(() => ({}));
        if (!r.ok && !(j as { ok?: boolean }).ok) throw new Error(`HTTP ${r.status}`);
        // The goal edit fires an auto-rebuild — reload so every pace on
        // the page comes from the new target, same mechanic
        // GoalRenegotiationCard uses.
        window.location.reload();
      } catch (e) {
        setBusy(null);
        setError(e instanceof Error ? e.message : String(e));
      }
    }

    const options: CoachDecisionOption[] = [
      { label: busy === 'hold' ? 'Holding…' : `Hold ${goal.goal}`, onClick: busy ? undefined : hold },
      ...(suggested ? [{ label: busy === 'move' ? 'Moving…' : `Move to ${suggested.display}`, onClick: busy ? undefined : move }] : []),
      { label: 'Decide later' },
    ];

    return (
      <CoachDecision
        kind="decision"
        options={options}
        footer={suggested ? (
          <div style={{ background: 'var(--surface-tile)', borderRadius: 'var(--radius-l)', padding: 'var(--sp-7)' }}>
            <div style={{
              fontFamily: 'var(--font-sub)', fontSize: 'var(--type-label-s)', fontWeight: 'var(--weight-label)',
              letterSpacing: 'var(--tracking-label)', textTransform: 'uppercase', color: 'var(--text-quiet)',
            }}>If you move it, here is the band</div>
            <div className="faff-value" style={{ fontSize: 'var(--type-value-3)', marginTop: 4 }}>
              {suggested.display}{alternatives?.c ? ` · ${alternatives.c.display}` : ''}
            </div>
            <div style={{ marginTop: 'var(--sp-6)', fontSize: 'var(--type-label-s)', color: 'var(--text-quiet)' }}>
              {goal.goal} stays on the board as the season ambition.
            </div>
            {error && <div style={{ marginTop: 'var(--sp-5)', fontSize: 'var(--type-label-s)', color: 'var(--fault)' }}>Could not save: {error}</div>}
          </div>
        ) : error ? (
          <div style={{ fontSize: 'var(--type-label-s)', color: 'var(--fault)' }}>Could not save: {error}</div>
        ) : null}
      >
        Your {goal.name.split(' ').slice(0, 2).join(' ')} goal needs a call. {renegotiation.message || `The plan projects ${goal.projected} against your ${goal.goal} goal.`}
      </CoachDecision>
    );
  }

  // No pending renegotiation — a real, non-actionable read off the goal's
  // own status fields, rather than an inert copy of the mock's three-button
  // ask (see file header note).
  const content = goalDecisionContent(goal, status);
  if (!content) return <Tile pad="lg" radius="l" />;
  return (
    <CoachDecision kind={content.kind}>
      {content.body}
    </CoachDecision>
  );
}

function goalDecisionContent(
  goal: GoalRace, status: GoalStatusRead | null,
): { kind: CoachDecisionKind; body: string } | null {
  if (!status) {
    return goal.projected
      ? null
      : { kind: 'applied', body: `Not enough of a fitness read yet to project ${goal.name}. Keep logging — the projection turns on once there's a race or qualifying run to anchor it.` };
  }
  if (status.tier === 'ahead' || status.tier === 'on-pace') {
    return {
      kind: 'applied',
      body: goal.projectionSummary ?? `The plan is writing to your ${goal.goal} goal and the projection agrees. Nothing to decide.`,
    };
  }
  // watching / behind, no proposal pending yet.
  const drift = goal.driftSignals?.[0]?.detail;
  return {
    kind: 'proposal',
    body: drift
      ? `${status.word === 'BEHIND' ? 'Behind' : 'Watching'} the ${goal.goal} goal · ${drift} The engine writes a revised-target call once this holds for a few more days.`
      : `${status.word === 'BEHIND' ? 'Behind' : 'Watching'} the ${goal.goal} goal. Not sustained long enough yet for the engine to propose a revised target.`,
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Upcoming · real seed.races (RaceLite[]), filtered to non-past, sorted.
// ─────────────────────────────────────────────────────────────────────────
function UpcomingPanel({ seed }: { seed: FaffSeed }) {
  const upcoming = (seed.races ?? [])
    .filter((r) => r.tag !== 'PAST' && r.dateISO)
    .sort((a, b) => (a.dateISO ?? '').localeCompare(b.dateISO ?? ''))
    .slice(0, 5);

  const dotColor = (p: 'A' | 'B' | 'C' | null | undefined) =>
    p === 'A' ? 'var(--state-race)' : p === 'B' ? 'var(--state-quality)' : 'var(--ink-4)';

  return (
    <div style={{
      boxSizing: 'border-box', background: 'var(--material-tile)', borderRadius: 'var(--radius-xl)',
      boxShadow: 'var(--elevation-raised)', padding: 'var(--sp-7)', display: 'flex', flexDirection: 'column',
      gap: 'var(--sp-4)', minWidth: 0, minHeight: 270, overflow: 'hidden',
    }}>
      <div style={{
        fontFamily: 'var(--font-sub)', fontSize: 'var(--type-label)', fontWeight: 'var(--weight-label)',
        letterSpacing: 'var(--tracking-label)', textTransform: 'uppercase', color: 'var(--text-secondary)',
      }}>Upcoming</div>
      {upcoming.length === 0 ? (
        <div style={{ fontSize: 'var(--type-label-s)', color: 'var(--text-quiet)' }}>No races on the calendar yet.</div>
      ) : (
        <div style={{ display: 'grid', gap: 'var(--sp-6)' }}>
          {upcoming.map((r) => (
            <div key={r.slug} style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-5)' }}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', flex: '0 0 auto', background: dotColor(r.priority) }} />
              <span style={{
                fontSize: 'var(--type-body-s)', flex: '1 1 auto', minWidth: 0, overflow: 'hidden',
                textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}>{r.name}</span>
              <span style={{ fontSize: 'var(--type-label-s)', color: 'var(--text-quiet)', flex: '0 0 auto' }}>{formatDate(r.dateISO)}</span>
            </div>
          ))}
        </div>
      )}
      <a href="/goal" style={{
        alignSelf: 'flex-start', marginTop: 'var(--sp-4)', background: 'none', border: 0, cursor: 'pointer',
        padding: 0, color: 'var(--text-quiet)', fontFamily: 'var(--font-sub)', fontSize: 'var(--type-label-s)',
        fontWeight: 'var(--weight-label)', letterSpacing: 'var(--tracking-label)', textTransform: 'uppercase',
        textDecoration: 'none',
      }}>See results →</a>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// The log · real seed.coachLog (lib/coach/coach-log.ts, already computed
// into the seed — no new plumbing).
// ─────────────────────────────────────────────────────────────────────────
function LogPanel({ seed }: { seed: FaffSeed }) {
  const entries = seed.coachLog ?? [];
  return (
    <Tile radius="l" style={{ minHeight: 0 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
        <div style={{
          fontFamily: 'var(--font-sub)', fontSize: 'var(--type-label)', fontWeight: 'var(--weight-label)',
          letterSpacing: 'var(--tracking-label)', textTransform: 'uppercase', color: 'var(--text-secondary)',
        }}>The log</div>
        {/* Inert · the source mock never authors content for the other two
            views either (see file header's honesty-gap note). */}
        <SegmentBar value="season" options={['season', 'block', 'all']} />
      </div>
      {entries.length === 0 ? (
        <div style={{ padding: 'var(--sp-8) 0', fontSize: 'var(--type-label-s)', color: 'var(--text-quiet)' }}>
          Nothing logged yet.
        </div>
      ) : (
        entries.slice(0, 5).map((e) => (
          <LogEntry key={e.id} kind={toLogEntryKind(e.kind)} date={formatDate(e.dateISO)}>{e.body}</LogEntry>
        ))
      )}
    </Tile>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// The lever · real seed.goalRace.levers (lib/coach/projection-levers.ts).
// ─────────────────────────────────────────────────────────────────────────
function LeverPanel({ goal }: { goal: GoalRace }) {
  const lever = (goal.levers ?? [])[0];
  if (!lever) return null;
  return (
    <Tile radius="l">
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 'var(--sp-6)' }}>
        <div style={{
          fontFamily: 'var(--font-sub)', fontSize: 'var(--type-label)', fontWeight: 'var(--weight-label)',
          letterSpacing: 'var(--tracking-label)', textTransform: 'uppercase', color: 'var(--text-secondary)',
        }}>The lever</div>
        <Badge tone="neutral">{lever.controllability}</Badge>
      </div>
      <div style={{ fontSize: 'var(--type-say-3)', lineHeight: 'var(--lh-say-3)', marginTop: 'var(--sp-5)', textWrap: 'pretty' }}>
        {lever.detail}
      </div>
      <div style={{ marginTop: 'var(--sp-7)' }}>
        {/* linkTo, when present, is a real surface (next.config's redirect
            maps /races/:slug → /goal/:slug) — an upgrade over the source
            mock, whose "Show me the change" button carries no onClick at
            all (see file header note). */}
        {lever.linkTo ? (
          <a href={lever.linkTo} style={{ textDecoration: 'none' }}>
            <Button variant="secondary" size="sm">Show me the change</Button>
          </a>
        ) : (
          <Button variant="secondary" size="sm">Show me the change</Button>
        )}
      </div>
    </Tile>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// No goal race set. Nothing in WebSeason.jsx's composition (gap panel,
// projection, fitness-required, confidence, lever) has anything honest to
// draw without one — degrade to the real season-agnostic content only
// (the log, upcoming calendar) instead of fabricating a goal.
// ─────────────────────────────────────────────────────────────────────────
function NoGoalSeason({ seed }: { seed: FaffSeed }) {
  return (
    <div style={{ display: 'grid', gap: 'var(--stack-gap)', maxWidth: 1360, margin: '0 auto', padding: 'var(--sp-9)' }}>
      <FaffChartRegistrar />
      <Tile pad="lg" radius="2xl">
        <div className="faff-display" style={{ fontSize: 'var(--type-display-3)' }}>No goal race set</div>
        <div style={{ fontSize: 'var(--type-body)', lineHeight: 'var(--lh-body)', marginTop: 'var(--sp-6)', maxWidth: '48ch', color: 'var(--text-secondary)' }}>
          The season view tracks a goal race's projection against what you asked for. Set a primary race to start tracking it.
        </div>
        <div style={{ marginTop: 'var(--sp-8)' }}>
          <a href="/goal" style={{ textDecoration: 'none' }}>
            <Button variant="primary" size="sm">Set a goal</Button>
          </a>
        </div>
      </Tile>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,minmax(0,1fr))', gap: 'var(--stack-gap)', alignItems: 'start' }}>
        <LogPanel seed={seed} />
        <UpcomingPanel seed={seed} />
      </div>
    </div>
  );
}
