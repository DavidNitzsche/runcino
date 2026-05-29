/**
 * /plan · the race-destination path (paper-overhaul 2026-05-29).
 *
 * "You signed up for a race. Here's the path to the finish line." This is
 * the middle tab of the 3-tab structure (TODAY / PLAN / ME) — it folds the
 * old /training + /races top-level tabs into one surface:
 *
 *   · RaceBib spine          — the destination (name · T-N · GOAL · status).
 *                              Same persistent header as /today; here it IS
 *                              the A-race hero (no separate hero card).
 *   · PlanArc                — the week-by-week arc from now to race day.
 *   · WeekAhead              — this week's sessions in detail.
 *   · Regenerate / Generate  — plan authoring CTAs (when race ± plan exist).
 *   · Other races + Add      — compact strip; full inventory stays on /races
 *                              (reachable via "ALL RACES →" — demoted from
 *                              the top nav, not deleted).
 *
 * Shell matches /today exactly (TopNav + bare main + 1040 column) so the
 * three tabs read as one app. Reuses the existing token-driven training /
 * race components rather than rebuilding them.
 *
 * Cardinal Rule #1 · facts only (status composes from real readiness + ACWR;
 * no LLM). Data loads are best-effort so the page never hard-fails.
 */
import Link from 'next/link';
import { TopNav } from '@/components/layout/TopNav';
import { RaceBib } from '@/components/faff/RaceBib';
import { SpecLabel } from '@/components/faff/graphic';
import { PlanArc } from '@/components/training/PlanArc';
import { WeekAhead } from '@/components/training/WeekAhead';
import { GeneratePlanCTA, RegeneratePlanButton } from '@/components/plan/GeneratePlanButton';
import { AddRaceButton } from '@/components/races/RaceCrudUI';
import { loadGlanceState } from '@/lib/coach/glance-state';
import { loadTrainingState } from '@/lib/coach/training-state';
import { loadRacesState, type RaceRow } from '@/lib/coach/races-state';
import { loadRaceHeader } from '@/lib/coach/race-header';

export const dynamic = 'force-dynamic';

const DAVID_USER_ID = process.env.DEFAULT_USER_ID ?? '0645f40c-951d-4ccc-b86e-9979cd26c795';

export default async function PlanPage() {
  const [glance, training, races] = await Promise.all([
    loadGlanceState(DAVID_USER_ID).catch(() => null),
    loadTrainingState(DAVID_USER_ID),
    loadRacesState(DAVID_USER_ID).catch(() => null),
  ]);

  // RaceBib spine — same honest header as /today (status from readiness +
  // ACWR + proj-vs-goal). Best-effort; renders base mode if no race.
  const raceHeader = glance
    ? await loadRaceHeader(DAVID_USER_ID, {
        today: glance.today,
        daysToARace: glance.daysToARace,
        nextARaceName: glance.nextARaceName,
        phaseLabel: glance.phaseLabel,
        readiness: glance.readiness,
        loadAcwr: glance.loadAcwr,
      }).catch(() => null)
    : null;

  const currentWeek = training.weeks.find((w) => w.isCurrent) ?? null;
  const hasPlan = currentWeek != null;
  const hasRace = training.race != null;

  // The race we'd anchor a NEW plan around when none is active yet.
  const anchorRace =
    training.race ??
    (races?.aRaces[0]
      ? {
          slug: races.aRaces[0].slug,
          name: races.aRaces[0].name,
          date: races.aRaces[0].date,
          goal: races.aRaces[0].goal,
          days_to_race: races.aRaces[0].days,
        }
      : null);

  // Other A-races beyond the anchored one + the next couple of B/C races —
  // a compact strip; the full inventory + past results live on /races.
  const otherRaces: RaceRow[] = races
    ? [...races.aRaces.slice(1), ...races.upcomingBs.slice(0, 2), ...races.upcomingCs.slice(0, 2)]
    : [];

  return (
    <main style={{ minHeight: '100vh', paddingBottom: 80 }}>
      <TopNav />
      <div
        style={{
          maxWidth: 1040,
          margin: '0 auto',
          padding: '28px 24px 0',
          display: 'flex',
          flexDirection: 'column',
          gap: 22,
        }}
      >
        {/* ── RACE BIB · the destination (and, when a race is set, the hero). ── */}
        {raceHeader && <RaceBib header={raceHeader} href={anchorRace ? `/races/${anchorRace.slug}` : '/plan'} />}

        {/* ── THE ARC · week-by-week path to race day. ── */}
        {hasPlan ? (
          <section style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
              <SpecLabel>THE ARC · NOW → RACE DAY</SpecLabel>
              {hasRace && training.race && <RegeneratePlanButton raceSlug={training.race.slug} />}
            </div>
            <PlanArc
              weeks={training.weeks}
              raceName={training.race?.name}
              raceDate={training.race?.date}
              raceGoal={training.race?.goal}
            />
          </section>
        ) : anchorRace ? (
          <section style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <SpecLabel>NO PLAN YET · ANCHOR ONE</SpecLabel>
            <GeneratePlanCTA raceSlug={anchorRace.slug} raceName={anchorRace.name} />
          </section>
        ) : (
          <NoRacePrompt />
        )}

        {/* ── THIS WEEK · the sessions in detail. ── */}
        {currentWeek && (
          <section style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <SpecLabel>THIS WEEK</SpecLabel>
            <WeekAhead week={currentWeek} today={training.today} planId={training.plan_id ?? undefined} />
          </section>
        )}

        {/* ── RACES · compact strip; full inventory on /races. ── */}
        <section style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
            <SpecLabel>RACES</SpecLabel>
            <Link
              href="/races"
              style={{
                fontFamily: 'var(--f-label)',
                fontSize: 11,
                fontWeight: 700,
                letterSpacing: '1.4px',
                textTransform: 'uppercase',
                color: 'var(--mute)',
                textDecoration: 'none',
              }}
            >
              ALL RACES →
            </Link>
          </div>
          {otherRaces.length > 0 && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 12 }}>
              {otherRaces.map((r) => (
                <RaceLine key={r.slug} race={r} />
              ))}
            </div>
          )}
          <div>
            <AddRaceButton />
          </div>
        </section>
      </div>

      <style>{`
        @media (max-width: 720px) {
          .plan-race-grid { grid-template-columns: 1fr !important; }
        }
      `}</style>
    </main>
  );
}

/** Compact race line — priority dot + name + distance/date + countdown. */
function RaceLine({ race }: { race: RaceRow }) {
  const tone =
    race.priority === 'A' ? 'var(--race)' : race.priority === 'B' ? 'var(--goal)' : 'var(--learn)';
  return (
    <Link
      href={`/races/${race.slug}`}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        background: 'var(--card)',
        border: '1px solid var(--line)',
        borderLeft: `3px solid ${tone}`,
        borderRadius: 12,
        boxShadow: 'var(--shadow-card)',
        padding: '12px 14px',
        textDecoration: 'none',
        minWidth: 0,
      }}
    >
      <span
        style={{
          fontFamily: 'var(--f-label)',
          fontSize: 10,
          fontWeight: 700,
          letterSpacing: '1px',
          color: tone,
          flexShrink: 0,
        }}
      >
        {race.priority ?? '·'}
      </span>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div
          style={{
            fontFamily: 'var(--f-display)',
            fontWeight: 700,
            fontSize: 16,
            letterSpacing: '-0.01em',
            color: 'var(--ink)',
            textTransform: 'uppercase',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {race.name}
        </div>
        <div style={{ fontFamily: 'var(--f-body)', fontSize: 10.5, color: 'var(--mute)', letterSpacing: '0.4px', marginTop: 2 }}>
          {race.distance_label ?? '—'}
        </div>
      </div>
      <div style={{ textAlign: 'right', flexShrink: 0 }}>
        <span className="tabular" style={{ fontFamily: 'var(--f-display)', fontWeight: 700, fontSize: 22, color: tone, lineHeight: 1 }}>
          {race.days}
        </span>
        <span style={{ fontFamily: 'var(--f-label)', fontSize: 9, fontWeight: 700, letterSpacing: '1px', color: 'var(--dim)', display: 'block' }}>
          {race.days === 1 ? 'DAY' : 'DAYS'}
        </span>
      </div>
    </Link>
  );
}

function NoRacePrompt() {
  return (
    <section
      style={{
        background: 'var(--card)',
        border: '1px solid var(--line)',
        borderRadius: 16,
        boxShadow: 'var(--shadow-panel)',
        padding: '28px 30px',
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
      }}
    >
      <SpecLabel>NO RACE ANCHORED</SpecLabel>
      <p style={{ margin: 0, fontFamily: 'var(--f-body)', fontSize: 14, lineHeight: 1.55, color: 'var(--ink)' }}>
        Pick the next race to anchor a plan around — the coach drafts the whole
        path from where you are today to the start line.
      </p>
      <div style={{ marginTop: 6 }}>
        <AddRaceButton />
      </div>
    </section>
  );
}
