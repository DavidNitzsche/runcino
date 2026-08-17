'use client';

/**
 * TargetsView · Wave 2 of the approved web recomposition (2026-08-17).
 *
 * Implements docs/design/web-recomposition-deck-2026-08-17.html · Decision 3,
 * approved as mocked. The page answers four questions in order:
 *
 *   1 · ANSWER    · the goal, the projection, and ONE status chip.
 *   2 · THE PATH  · the trajectory number line (GapPanel), with the
 *                   renegotiation card mounted HERE when one is pending —
 *                   beside the number it renegotiates, not floating at the
 *                   top of the page.
 *   3 · THE WORK  · test points, or an explicit BETWEEN BLOCKS state when
 *                   the active plan is a recovery bridge (or there is none)
 *                   and the next block has not opened.
 *   4 · RACES     · split into CALENDAR (role chips that state what the
 *                   generator does with each race) and RESULTS (result +
 *                   provenance chip, each row opening the retro page).
 *   5 · RECORDS   · the PR grid, anchored against the goal. Not in the
 *                   deck's mock; kept because it is live, correct, and not
 *                   in the audit's dead list. Demoted below RACES so the
 *                   deck's beat order still reads first.
 *
 * ONE status vocabulary (Decision 3b). The page used to speak three dialects
 * for one fact — StatusPill ("On track / Watching / Off track"), the
 * confidence tier word ("HIGH / MEDIUM / LOW"), and prose ("on pace / off
 * pace"). All three are gone. lib/faff/goal-status.ts is the only source,
 * and it is exported for Today's GAP tile to adopt.
 *
 * Deleted with this rebuild (verified unreferenced first): StatusPill,
 * ProjectionBand, StatusLadder, VdotSparkline, VdotDelta, and the helper
 * functions that only fed them — posturePhrase, statusWord, gapText,
 * bandCaption, pathHeadline, pathSubline, evidenceLine, vdotReadCopy,
 * lastNonNull, vdotAtDaysAgo, daysHeld. Unrendered since 2026-06-11.
 */

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { FaffSeed, GoalRace, PlanProposalSeed, RaceLite } from '../types';
import { LogNonRunSheet, NewGoalSheet } from '../toolkit';
import { GapPanel } from './GapPanel';
import { parseRaceTime } from '@/lib/training/vdot';
import { resolveGoalStatus, formatGapClock, type GoalStatusRead } from '@/lib/faff/goal-status';
import { resolveRaceRole, resolveProvenance } from '@/lib/faff/race-roles';
import { StatusChip } from '../StatusChip';

export function TargetsView({
  seed, onOpenRace,
}: { seed: FaffSeed; onOpenRace: (slug: string) => void; onOpenReach?: () => void }) {
  const router = useRouter();
  const goal = seed.goalRace;
  const [goalOpen, setGoalOpen] = useState(false);
  const [logOpen, setLogOpen] = useState(false);

  // The pending goal renegotiation, if the engine has written one. Mounts
  // inside THE PATH per the deck, and forces the status chip to BEHIND —
  // an unclosable gap is never dressed as anything softer.
  const renegotiation = useMemo(
    () => (seed.planProposals ?? []).find(
      (p) => p.kind === 'goal_renegotiation' && p.status === 'pending',
    ) ?? null,
    [seed.planProposals],
  );

  // === GUEST / NO-GOAL ====================================================
  if (!goal) {
    return (
      <div className="targets2">
        <div className="top">
          <div>
            <div className="date">Goal</div>
            <div className="wk">Goals &amp; races</div>
          </div>
        </div>
        <div className="t2card" style={{ padding: '36px 40px' }}>
          <div className="eyebrow">No primary goal</div>
          <div style={{ marginTop: 14, fontSize: 18, lineHeight: 1.5, color: 'rgba(255,255,255,.86)' }}>
            Set a primary race to start tracking your gap to goal.
          </div>
          <div className="raceacts" style={{ marginTop: 22 }}>
            <button type="button" className="racebtn" onClick={() => setGoalOpen(true)}>+ New goal</button>
          </div>
        </div>
        {goalOpen ? (
          <SheetOverlay onDismiss={() => setGoalOpen(false)}>
            <NewGoalSheet onSaved={() => router.refresh()} onClose={() => setGoalOpen(false)} />
          </SheetOverlay>
        ) : null}
      </div>
    );
  }

  // === DERIVED VALUES =====================================================
  const traj = goal.trajectory ?? null;
  const goalSec = parseRaceTime(goal.goal) ?? null;
  // The projected finish · trajectory first (where the plan, executed, lands
  // you on race day), current-fitness projection as the fallback.
  const projectedSec = traj?.projectedSec ?? goal.vdotProjectionSec ?? null;

  // THE single status read. Every chip on this page comes from here.
  const status = resolveGoalStatus({
    trajectory: traj,
    goalSec,
    projectionSec: goal.vdotProjectionSec ?? null,
    unclosable: renegotiation != null,
  });

  const goalPace = goalSec != null && goal.distanceMi ? paceLabel(goalSec, goal.distanceMi) : null;

  // PR anchor (which PR is closest to the goal distance) — used to highlight
  // the PR card and write the anchor line.
  const goalDist = goal.distanceMi ?? null;
  const anchorPr = goalDist != null
    ? seed.prs.find(p => prDistanceMi(p.k) === goalDist) ?? null
    : null;
  const anchorPrSec = anchorPr ? parseRaceTime(anchorPr.v) : null;
  const anchorGapSec = anchorPrSec != null && goalSec != null ? anchorPrSec - goalSec : null;

  const calendar = seed.races.filter(r => r.tag !== 'PAST');
  const results = seed.pastRaces;

  return (
    <div className="targets2">
      <div className="top">
        <div>
          <div className="date">Targets</div>
          <div className="wk">
            {goal.name}
            {goal.daysAway >= 0 ? ` · ${goal.daysAway} day${goal.daysAway === 1 ? '' : 's'}` : ''}
          </div>
        </div>
      </div>

      {/* ============ 1 · THE ANSWER ============ */}
      <div className="band">
        <div className="eyebrow-sec">The answer</div>
        <div className="t2card" style={{ padding: '26px 28px' }}>
          <div style={{ display: 'flex', gap: 44, alignItems: 'flex-end', flexWrap: 'wrap' }}>
            <div style={{ minWidth: 0 }}>
              <div style={{
                fontSize: 11, fontWeight: 700, letterSpacing: '1.6px',
                color: 'rgba(255,255,255,.78)', textTransform: 'uppercase',
              }}>
                {goal.name} · {formatDate(goal.date)}
              </div>
              <div className="goaltime" style={{ fontSize: 78, marginTop: 8 }}>{goal.goal}</div>
              <div style={{ fontSize: 12, color: 'rgba(255,255,255,.6)', marginTop: 8 }}>
                goal{goalPace ? ` · ${goalPace}` : ''}
              </div>
            </div>
            {projectedSec != null ? (
              <div style={{ paddingBottom: 6 }}>
                <div style={{
                  fontSize: 10, fontWeight: 800, letterSpacing: '1.8px',
                  color: 'rgba(255,255,255,.55)', textTransform: 'uppercase',
                }}>
                  Projected
                </div>
                <div style={{
                  fontFamily: "'Oswald', sans-serif", fontWeight: 600, fontSize: 44,
                  lineHeight: 1, marginTop: 6, fontVariantNumeric: 'tabular-nums',
                  color: status?.tone ?? '#fff',
                }}>
                  {formatClock(projectedSec)}
                </div>
                {status ? <div style={{ marginTop: 10 }}><StatusChip read={status} /></div> : null}
              </div>
            ) : status ? (
              <div style={{ paddingBottom: 6 }}><StatusChip read={status} /></div>
            ) : null}
          </div>
          <div className="goalmeta" style={{ marginTop: 18 }}>
            {goal.location ? <>{goal.location} · </> : null}
            <b>{goal.daysAway}</b> days out
          </div>
        </div>
      </div>

      {/* ============ 2 · THE PATH ============ */}
      <div className="band">
        <div className="eyebrow-sec">The path</div>
        <GapPanel
          goal={goal}
          series={seed.projectionTrend}
          anchor={seed.health?.vdotAnchor ?? null}
          status={status}
        />
        {/* The renegotiation mounts HERE · directly under the number line
            that justifies it. Deck Decision 3a. */}
        {renegotiation ? (
          <GoalRenegotiationCard
            proposal={renegotiation}
            goal={goal}
            onDone={() => router.refresh()}
          />
        ) : null}
      </div>

      {/* ============ 3 · THE WORK ============ */}
      <div className="band">
        <div className="eyebrow-sec">The work</div>
        <div className="t2card pathcard">
          {seed.blockState?.betweenBlocks ? (
            <BetweenBlocks state={seed.blockState} />
          ) : null}
          <TheWork
            recent={goal.recentTestPoints ?? []}
            next={goal.nextTestPoints ?? []}
            betweenBlocks={seed.blockState?.betweenBlocks ?? false}
            blockOpensISO={seed.blockState?.nextBlockOpensISO ?? null}
            calendar={calendar}
            onOpenRace={onOpenRace}
          />
        </div>
      </div>

      {/* ============ 4 · RACES · CALENDAR + RESULTS ============ */}
      <div className="band">
        <div className="eyebrow-sec">Races</div>
        {seed.unloggedRaceAlert ? (
          <div
            onClick={() => onOpenRace(seed.unloggedRaceAlert!.slug)}
            role="button"
            tabIndex={0}
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '10px 14px', marginBottom: 12, borderRadius: 8,
              border: '1px solid var(--goal)', background: 'rgba(243,173,56,0.08)',
              cursor: 'pointer',
            }}
          >
            <span style={{ fontSize: 13, color: 'var(--ink)' }}>
              <strong>{seed.unloggedRaceAlert.name}</strong>
              {` was ${seed.unloggedRaceAlert.daysSince} day${seed.unloggedRaceAlert.daysSince === 1 ? '' : 's'} ago. Log your result.`}
            </span>
            <span style={{ fontSize: 11, color: 'var(--goal)', fontFamily: 'var(--f-label)', letterSpacing: '1px' }}>
              LOG →
            </span>
          </div>
        ) : null}

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: 14 }}>
          <div className="t2card" style={{ padding: '20px 22px' }}>
            <SubLabel>Calendar</SubLabel>
            {calendar.length > 0 ? (
              <div style={{ marginTop: 6 }}>
                {calendar.map((r, i) => (
                  <CalendarRow key={r.slug + i} race={r} onOpen={() => onOpenRace(r.slug)} />
                ))}
              </div>
            ) : (
              <EmptyLine>Nothing on the calendar. A race is what the plan points at.</EmptyLine>
            )}
          </div>

          <div className="t2card" style={{ padding: '20px 22px' }}>
            <SubLabel>Results</SubLabel>
            {results.length > 0 ? (
              <div style={{ marginTop: 6 }}>
                {results.map((r, i) => (
                  <ResultRow key={r.slug + i} race={r} onOpen={() => onOpenRace(r.slug)} />
                ))}
              </div>
            ) : (
              <EmptyLine>No races on the record yet.</EmptyLine>
            )}
          </div>
        </div>

        <div className="raceacts">
          <button type="button" className="racebtn" onClick={() => setGoalOpen(true)}>+ New goal</button>
          <button type="button" className="racebtn" onClick={() => setLogOpen(true)}>+ Log strength / cross</button>
        </div>
      </div>

      {/* ============ 5 · RECORDS ============ */}
      {seed.prs.length > 0 ? (
        <div className="band">
          <div className="eyebrow-sec">Personal records · measured against the goal</div>
          {anchorPr && anchorGapSec != null ? (
            <div className={`anchorline ${status?.tier === 'ahead' || status?.tier === 'on-pace' ? 'ontrack' : ''}`}>
              Your {anchorPr.k.toLowerCase()} PR is <b>{anchorPr.v}</b>.
              {' '}The goal is <b>{goal.goal}</b>
              {anchorGapSec > 0 ? (
                <> · a <span className="gp">{formatGapClock(anchorGapSec)} gap</span>, about <b>{formatPerMile(anchorGapSec, goalDist!)}/mi</b>. That is the distance the build is built to close.</>
              ) : (
                <> · you are already under it by <b>{formatGapClock(-anchorGapSec)}</b>. The build is about holding that and going further.</>
              )}
            </div>
          ) : null}
          <div className="prgrid2">
            {seed.prs.map(p => {
              const isAnchor = anchorPr && p.k === anchorPr.k;
              return (
                <div className={`prt2 ${isAnchor ? 'hl' : ''}`} key={p.k}>
                  {isAnchor && anchorGapSec != null && anchorGapSec > 0 ? (
                    <span className="gapchip">−{formatGapClock(anchorGapSec)} to goal</span>
                  ) : null}
                  <div className="prd">{p.k}</div>
                  <div className="prv">{p.v}</div>
                  <div className="prm">{p.date}</div>
                </div>
              );
            })}
          </div>
        </div>
      ) : null}

      {goalOpen ? (
        <SheetOverlay onDismiss={() => setGoalOpen(false)}>
          <NewGoalSheet onSaved={() => router.refresh()} onClose={() => setGoalOpen(false)} />
        </SheetOverlay>
      ) : null}
      {logOpen ? (
        <SheetOverlay onDismiss={() => setLogOpen(false)}>
          <LogNonRunSheet onSaved={() => router.refresh()} onClose={() => setLogOpen(false)} />
        </SheetOverlay>
      ) : null}
    </div>
  );
}

// ============================ STATUS CHIP ============================
// 2026-08-17 · Wave 1 integration · StatusChip moved to
// components/faff-app/StatusChip.tsx so Today's GAP tile can render the
// identical chip without importing a component out of this view. Re-exported
// here so existing importers keep working. (The import above is what gives
// this module the local binding its own JSX uses; a bare `export … from`
// would re-export the name without defining it here.)
export { StatusChip };

// ============================ RENEGOTIATION ============================
/**
 * The goal renegotiation, mounted beside the number it renegotiates.
 *
 * TODO(wave-1-integration): Wave 1 is landing a shared CoachDecisionCard
 * with exactly this grammar (deck Decision 2 · eyebrow names the kind, left
 * accent carries the state, verb buttons in coach voice, never
 * Accept/Dismiss). When it exists, swap this inline card for it and delete
 * this component — the props map 1:1 (kind, eyebrow, title, body, actions).
 * Rendered inline for now so Targets is complete without a cross-wave
 * dependency.
 *
 * Accept path is the existing goal edit · PATCH /api/race/[slug]
 * { goalSec, source: 'renegotiate' }, named by the proposal payload itself
 * (RenegotiationReasons.accept_path). Holding the goal dismisses the
 * proposal through the standard POST /api/plan/proposal seam.
 */
function GoalRenegotiationCard({
  proposal, goal, onDone,
}: {
  proposal: PlanProposalSeed;
  goal: GoalRace;
  onDone: () => void;
}) {
  const [busy, setBusy] = useState<null | 'hold' | 'move'>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const reasons = proposal.reasons ?? {};
  const alternatives = (reasons as { alternatives?: Record<string, { sec: number; display: string; label: string }> }).alternatives ?? null;
  // The engine recommends the B band · where the evidence says the runner is
  // tracking. It never picks for them; this is the button's default.
  const suggested = alternatives?.b ?? null;
  const raceSlug = typeof (reasons as { race_slug?: unknown }).race_slug === 'string'
    ? (reasons as { race_slug: string }).race_slug
    : goal.slug;
  const trajectorySec = typeof (reasons as { trajectory_sec?: unknown }).trajectory_sec === 'number'
    ? (reasons as { trajectory_sec: number }).trajectory_sec
    : null;

  if (done) return null;

  async function hold() {
    setBusy('hold'); setError(null);
    try {
      const r = await fetch('/api/plan/proposal', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: proposal.id, action: 'dismiss' }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok && !(j as { ok?: boolean }).ok) throw new Error(`HTTP ${r.status}`);
      setDone(true);
      onDone();
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
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ goalSec: suggested.sec, source: 'renegotiate' }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok && !(j as { ok?: boolean }).ok) throw new Error(`HTTP ${r.status}`);
      // The goal edit fires an auto-rebuild · reload so every pace on the
      // page comes from the new target rather than the old one.
      window.location.reload();
    } catch (e) {
      setBusy(null);
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <div
      role="region"
      aria-label="Goal renegotiation"
      style={{
        marginTop: 14,
        background: 'rgba(20,22,28,.55)',
        border: '1px solid rgba(255,255,255,.1)',
        borderLeft: '4px solid #F3AD38',
        borderRadius: 16,
        padding: '20px 22px',
      }}
    >
      <div style={{
        fontSize: 10, fontWeight: 800, letterSpacing: '1.8px',
        color: '#F3AD38', textTransform: 'uppercase',
      }}>
        Coach · needs a decision
      </div>
      <div style={{
        fontFamily: "'Oswald', sans-serif", fontWeight: 600, fontSize: 21,
        letterSpacing: '.4px', textTransform: 'uppercase', margin: '10px 0 8px',
      }}>
        Your {shortRaceName(goal.name)} goal needs a call
      </div>
      <div style={{ fontSize: 14, color: '#C7CBD4', lineHeight: 1.55, maxWidth: 640 }}>
        {trajectorySec != null
          ? `Evidence says ${formatClock(trajectorySec)} against your ${goal.goal} goal. `
          : `The projection has sat past your ${goal.goal} goal for long enough that the runway cannot close it. `}
        Hold the goal and the plan keeps writing to it. Move the target and the paces get honest.
        {suggested ? ` The ${goal.goal} stays on the board as the season ambition.` : ''}
      </div>
      <div style={{ display: 'flex', gap: 10, marginTop: 16, alignItems: 'center', flexWrap: 'wrap' }}>
        <button type="button" onClick={hold} disabled={busy != null} style={renegBtn(busy != null)}>
          {busy === 'hold' ? 'Holding…' : `Hold ${goal.goal}`}
        </button>
        {suggested ? (
          <button type="button" onClick={move} disabled={busy != null} style={renegBtn(busy != null)}>
            {busy === 'move' ? 'Moving…' : `Move to ${suggested.display}`}
          </button>
        ) : null}
        <span style={{
          fontSize: 11, fontWeight: 700, letterSpacing: '1.2px',
          color: 'rgba(255,255,255,.5)', textTransform: 'uppercase', marginLeft: 'auto',
        }}>
          Decide later
        </span>
      </div>
      {suggested && alternatives?.c ? (
        <div style={{ marginTop: 12, fontSize: 12, color: 'rgba(255,255,255,.55)' }}>
          {suggested.label} · {suggested.display}. Safe floor {alternatives.c.display}.
        </div>
      ) : null}
      {error ? (
        <div style={{ marginTop: 10, fontSize: 11.5, color: '#FC4D64' }}>Could not save: {error}</div>
      ) : null}
    </div>
  );
}

function renegBtn(busy: boolean): React.CSSProperties {
  return {
    fontFamily: "'Inter', sans-serif",
    fontSize: 11, fontWeight: 800, letterSpacing: '1.4px', textTransform: 'uppercase',
    color: '#F3AD38', background: 'none',
    border: '1px solid rgba(243,173,56,.5)', borderRadius: 11,
    padding: '11px 18px',
    cursor: busy ? 'wait' : 'pointer',
    opacity: busy ? 0.6 : 1,
  };
}

// ============================ BETWEEN BLOCKS ============================
/**
 * The honest empty state for THE WORK · deck Decision 3.
 *
 * A recovery block has no quality in it by design, so the test-point list
 * is legitimately empty. Saying that out loud beats rendering a blank card
 * that reads like a broken page.
 */
function BetweenBlocks({ state }: { state: FaffSeed['blockState'] }) {
  const line = (() => {
    const opens = state.nextBlockOpensISO ? formatDate(state.nextBlockOpensISO) : null;
    const outPart = state.weeksOutAtOpen != null && state.goalName
      ? `, ${state.weeksOutAtOpen} week${state.weeksOutAtOpen === 1 ? '' : 's'} out`
      : '';

    if (state.reason === 'recovery' && state.windowStartISO && state.windowEndISO) {
      const window = `Recovery window ${formatDate(state.windowStartISO)} to ${formatDate(state.windowEndISO)}`;
      if (opens && state.goalName) {
        return `${window} · ${shortRaceName(state.goalName)} block opens ${opens}${outPart}`;
      }
      return opens ? `${window} · next block opens ${opens}` : window;
    }
    if (state.reason === 'block-over') {
      return state.goalName && opens
        ? `Last block is done. The ${shortRaceName(state.goalName)} block opens ${opens}${outPart}`
        : 'Last block is done. The next one has not been written yet.';
    }
    return state.goalName
      ? `No block running. Build one and the work toward ${shortRaceName(state.goalName)} starts showing up here.`
      : 'No block running. Set a goal race and the work starts showing up here.';
  })();

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap',
      padding: '12px 14px', marginBottom: 18,
      background: 'rgba(39,180,224,.06)',
      border: '1px solid rgba(39,180,224,.25)',
      borderRadius: 12,
    }}>
      <span style={{
        display: 'inline-flex', alignItems: 'center',
        fontSize: 10, fontWeight: 800, letterSpacing: '1px', textTransform: 'uppercase',
        color: '#27B4E0', border: '1px solid rgba(39,180,224,.4)',
        background: 'rgba(39,180,224,.08)', borderRadius: 9, padding: '5px 10px',
        whiteSpace: 'nowrap',
      }}>
        Between blocks
      </span>
      <span style={{ fontSize: 13, color: '#C7CBD4', minWidth: 0 }}>{line}</span>
    </div>
  );
}

// ============================ THE WORK ============================
/**
 * Recent + next test points. Between blocks the plan has no quality to
 * point at, so the upcoming races become the test points — which is what
 * they are: the next honest reads on fitness before the goal race.
 */
function TheWork({
  recent, next, betweenBlocks, blockOpensISO, calendar, onOpenRace,
}: {
  recent: NonNullable<GoalRace['recentTestPoints']>;
  next: NonNullable<GoalRace['nextTestPoints']>;
  betweenBlocks: boolean;
  blockOpensISO: string | null;
  calendar: RaceLite[];
  onOpenRace: (slug: string) => void;
}) {
  // Between blocks with nothing planned, the tune-ups on the calendar are
  // the test points. Never invented: these are real races on the record.
  const raceTestPoints = betweenBlocks && next.length === 0
    ? calendar.filter(r => (r.priority ?? 'C') !== 'A')
    : [];

  const hasSomething = recent.length > 0 || next.length > 0 || raceTestPoints.length > 0;
  if (!hasSomething) {
    return (
      <EmptyLine>
        No test points yet. The next quality session or race is what moves the projection.
      </EmptyLine>
    );
  }

  const showBoth = recent.length > 0 && (next.length > 0 || raceTestPoints.length > 0);

  return (
    <div className={`testgrid ${showBoth ? '' : 'one'}`}>
      {recent.length > 0 ? (
        <div className="tcol">
          <h4>Recent test points</h4>
          {recent.map((tp, i) => (
            <div className="trow" key={'r' + i}>
              <span className="td">{formatTestDate(tp.dateISO)}</span>
              <span className="tl">{splitLabel(tp.label)}</span>
              <span className="tpace">{tp.actualPace ?? '·'}</span>
              <span className={`verdict ${tp.verdict ?? 'on'}`}>
                {tp.verdict === 'slow' ? (
                  <>Slow</>
                ) : tp.verdict === 'fast' ? (
                  <>Fast</>
                ) : (
                  <>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M20 6L9 17l-5-5" />
                    </svg>
                    On
                  </>
                )}
              </span>
            </div>
          ))}
        </div>
      ) : null}

      {next.length > 0 ? (
        <div className="tcol">
          <h4>Next test points</h4>
          {next.map((tp, i) => (
            <div className="trow next" key={'n' + i}>
              <span className="td">{formatTestDate(tp.dateISO)}</span>
              <span className="tl">
                {splitLabel(tp.label)}
                {tp.passCriteria ? (
                  <span style={{ display: 'block', fontSize: 11, color: 'var(--mute, #8B909C)', marginTop: 2 }}>
                    passes at ≤ {fmtPaceShort(tp.passCriteria.paceMaxSPerMi)}/mi
                    {tp.passCriteria.hrMaxBpm != null ? ` · avgHr ≤ ${tp.passCriteria.hrMaxBpm}` : ''}
                  </span>
                ) : null}
              </span>
            </div>
          ))}
        </div>
      ) : raceTestPoints.length > 0 ? (
        <div className="tcol">
          <h4>Next test points</h4>
          {raceTestPoints.map((r, i) => {
            const role = resolveRaceRole(r.priority, { ownGoal: r.ownGoal });
            const wk = weekOfBlock(blockOpensISO, r.dateISO);
            return (
              <div
                className="trow next"
                key={'rt' + i}
                onClick={() => onOpenRace(r.slug)}
                role="button"
                tabIndex={0}
                style={{ cursor: 'pointer', gridTemplateColumns: '80px 1fr 54px' }}
              >
                <span className="td">{r.dateISO ? formatTestDate(r.dateISO) : '·'}</span>
                <span className="tl">
                  {r.name}
                  <span style={{ display: 'block', fontSize: 11, color: 'var(--mute, #8B909C)', marginTop: 2 }}>
                    {role.line}
                  </span>
                </span>
                {wk != null ? (
                  <span className="tpace" style={{ color: 'rgba(255,255,255,.5)', fontSize: 12 }}>WK {wk}</span>
                ) : null}
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

// ============================ RACE ROWS ============================
function CalendarRow({ race, onOpen }: { race: RaceLite; onOpen: () => void }) {
  const role = resolveRaceRole(race.priority, { ownGoal: race.ownGoal });
  return (
    <div
      onClick={onOpen}
      role="button"
      tabIndex={0}
      style={raceRowStyle}
    >
      <RoleChip role={role.role} tone={role.tone} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13.5, fontWeight: 600, color: '#fff' }}>{race.name}</div>
        <div style={{ fontSize: 11, color: 'rgba(255,255,255,.6)', marginTop: 2 }}>{role.line}</div>
      </div>
      <div style={{
        fontFamily: "'Oswald', sans-serif", fontWeight: 600, fontSize: 15,
        color: '#C7CBD4', textAlign: 'right', whiteSpace: 'nowrap',
      }}>
        {race.dateISO ? formatDate(race.dateISO).toUpperCase() : race.days}
        <span style={{
          display: 'block', fontFamily: "'Inter', sans-serif", fontSize: 9.5,
          fontWeight: 700, letterSpacing: '1px', color: 'rgba(255,255,255,.5)',
          textTransform: 'uppercase',
        }}>
          {role.tag}
        </span>
      </div>
    </div>
  );
}

function ResultRow({ race, onOpen }: { race: FaffSeed['pastRaces'][number]; onOpen: () => void }) {
  const role = resolveRaceRole(race.priority);
  const prov = resolveProvenance(race.provenance);
  return (
    <div
      onClick={onOpen}
      role="button"
      tabIndex={0}
      style={raceRowStyle}
    >
      <RoleChip role={role.role} tone={role.tone} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13.5, fontWeight: 600, color: '#fff', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          {race.name}
          {prov ? (
            <span style={{
              fontSize: 9.5, fontWeight: 800, letterSpacing: '1px', textTransform: 'uppercase',
              color: prov.tone, border: `1px solid ${prov.tone}66`, background: `${prov.tone}14`,
              borderRadius: 7, padding: '3px 7px', whiteSpace: 'nowrap',
            }}>
              {prov.label}
            </span>
          ) : null}
        </div>
        <div style={{ fontSize: 11, color: 'rgba(255,255,255,.6)', marginTop: 2 }}>
          {[race.dateISO ? formatDate(race.dateISO) : null, race.pace ? `${race.pace} /mi` : null, 'Retro ›']
            .filter(Boolean).join(' · ')}
        </div>
      </div>
      <div style={{
        fontFamily: "'Oswald', sans-serif", fontWeight: 600, fontSize: 15,
        color: race.result ? '#fff' : 'rgba(255,255,255,.45)',
        textAlign: 'right', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums',
      }}>
        {race.result ?? 'No result'}
        <span style={{
          display: 'block', fontFamily: "'Inter', sans-serif", fontSize: 9.5,
          fontWeight: 700, letterSpacing: '1px', color: 'rgba(255,255,255,.5)',
          textTransform: 'uppercase',
        }}>
          {prov ? prov.source : 'log it'}
        </span>
      </div>
    </div>
  );
}

const raceRowStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 14,
  padding: '13px 4px',
  borderBottom: '1px solid rgba(255,255,255,.05)',
  cursor: 'pointer',
};

function RoleChip({ role, tone }: { role: 'A' | 'B' | 'C'; tone: string }) {
  const solid = role === 'A';
  return (
    <span style={{
      fontFamily: "'Oswald', sans-serif", fontWeight: 600, fontSize: 15,
      width: 30, height: 30, borderRadius: 8,
      display: 'flex', alignItems: 'center', justifyContent: 'center', flex: '0 0 auto',
      color: solid ? '#fff' : tone,
      background: solid ? tone : `${tone}26`,
      border: solid ? `1px solid ${tone}` : `1px solid ${tone}66`,
    }}>
      {role}
    </span>
  );
}

// ============================ SMALL PARTS ============================
function SubLabel({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      fontSize: 10, fontWeight: 800, letterSpacing: '1.8px',
      color: '#F3AD38', textTransform: 'uppercase',
    }}>
      {children}
    </div>
  );
}

function EmptyLine({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontSize: 12.5, color: 'rgba(255,255,255,.55)', padding: '14px 4px 4px', lineHeight: 1.5 }}>
      {children}
    </div>
  );
}

function SheetOverlay({ children, onDismiss }: { children: React.ReactNode; onDismiss: () => void }) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      style={{
        position: 'fixed', inset: 0, zIndex: 50,
        display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
        background: 'rgba(0,0,0,.55)',
      }}
      onClick={onDismiss}
    >
      <div style={{ width: '100%', maxWidth: 520 }} onClick={(e) => e.stopPropagation()}>
        {children}
      </div>
    </div>
  );
}

// ============================ HELPERS ============================

function formatDate(iso: string) {
  // noon-UTC anchor on the date part so the label never shifts a day by timezone.
  const d = new Date(iso.slice(0, 10) + 'T12:00:00Z');
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }).format(d);
}

function formatTestDate(iso: string): string {
  const d = new Date(iso.slice(0, 10) + 'T12:00:00Z');
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC',
  }).format(d);
}

/** h:mm:ss / m:ss finish-time format. */
function formatClock(sec: number): string {
  const t = Math.max(0, Math.round(sec));
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = t % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

function paceLabel(totalSec: number, distanceMi: number): string {
  const perMi = totalSec / Math.max(distanceMi, 0.01);
  const m = Math.floor(perMi / 60);
  const s = Math.round(perMi % 60);
  return `${m}:${String(s).padStart(2, '0')} /mi`;
}

function formatPerMile(gapSec: number, distMi: number): string {
  return `${Math.round(gapSec / distMi)}s`;
}

/** "430 → 7:10" · pace shorthand for the pass-criteria line. */
function fmtPaceShort(sPerMi: number): string {
  const m = Math.floor(sPerMi / 60);
  const s = Math.round(sPerMi % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

/** Split "8mi tempo · 5 mi @ T" into a headline and a dimmer aside. */
function splitLabel(label: string): React.ReactNode {
  const i = label.indexOf(' · ');
  if (i === -1) return label;
  return <>{label.slice(0, i)}<small> · {label.slice(i + 3)}</small></>;
}

/** First two words of a race name · "California International Marathon" in
 *  a sentence is noise; "California International" carries it. */
function shortRaceName(name: string): string {
  const parts = name.trim().split(/\s+/);
  return parts.length <= 2 ? name : parts.slice(0, 2).join(' ');
}

/** Which week of the upcoming block a date lands in. Null when the block
 *  has no opening date, or the date is before it opens. */
function weekOfBlock(blockOpensISO: string | null, dateISO: string | null | undefined): number | null {
  if (!blockOpensISO || !dateISO) return null;
  const open = Date.parse(blockOpensISO.slice(0, 10) + 'T12:00:00Z');
  const d = Date.parse(dateISO.slice(0, 10) + 'T12:00:00Z');
  if (!Number.isFinite(open) || !Number.isFinite(d) || d < open) return null;
  return Math.floor((d - open) / (7 * 86400000)) + 1;
}

/** PR label → distance in miles. Returns null for unknown labels. */
function prDistanceMi(label: string): number | null {
  const s = label.toLowerCase().trim();
  if (s === '5k') return 3.10686;
  if (s === '10k') return 6.21371;
  if (s === 'half' || s === 'half marathon') return 13.1094;
  if (s === 'marathon' || s === 'full') return 26.2188;
  return null;
}
