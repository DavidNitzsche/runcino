import { TopNav } from '@/components/layout/TopNav';
import { PhaseStrip } from '@/components/training/PhaseStrip';
import { PlanArc } from '@/components/training/PlanArc';
import { WeekAhead } from '@/components/training/WeekAhead';
import { BriefingLoader } from '@/components/cards/BriefingLoader';
import { GeneratePlanCTA, RegeneratePlanButton } from '@/components/plan/GeneratePlanButton';
import { loadTrainingState } from '@/lib/coach/training-state';
import { loadRacesState } from '@/lib/coach/races-state';

export const dynamic = 'force-dynamic';

const DAVID_USER_ID = process.env.DEFAULT_USER_ID ?? '0645f40c-951d-4ccc-b86e-9979cd26c795';

export default async function TrainingPage() {
  const [training, races] = await Promise.all([
    loadTrainingState(DAVID_USER_ID),
    loadRacesState(DAVID_USER_ID).catch(() => null),
  ]);
  // The next A race the user could anchor a new plan around
  const anchorRace = training.race
    ?? (races?.aRaces[0] ? { slug: races.aRaces[0].slug, name: races.aRaces[0].name, date: races.aRaces[0].date, goal: races.aRaces[0].goal, days_to_race: races.aRaces[0].days } : null);

  const currentWeek = training.weeks.find((w) => w.isCurrent);
  const totalWeeks = training.weeks.length;

  return (
    <main>
      <TopNav />
      <div style={{ padding: '40px 40px 80px', maxWidth: 1600, margin: '0 auto' }}>
        <h1 style={{ fontFamily: 'var(--f-display)', fontSize: 56, lineHeight: 1, margin: 0, letterSpacing: '0.5px' }}>
          {training.race && currentWeek
            ? `${training.race.days_to_race} days to ${training.race.name}.`
            : 'Training.'}
        </h1>
        <div style={{ fontFamily: 'var(--f-body)', fontSize: 13, color: 'var(--mute)', letterSpacing: '1.6px', textTransform: 'uppercase', marginTop: 12, marginBottom: 28 }}>
          {training.currentPhase ?? 'NO PLAN'}
          {currentWeek ? ` · WEEK ${currentWeek.idx}${totalWeeks ? ` OF ${totalWeeks}` : ''}` : ''}
          {training.weekPlanned != null ? ` · ${training.weekPlanned} MI PLANNED` : ''}
        </div>

        <PhaseStrip
          phases={training.phases}
          currentPhase={training.currentPhase}
          totalWeeks={training.weeks.length}
          currentWeekIdx={training.currentWeekIdx}
          raceName={training.race?.name ?? null}
          daysToRace={training.race?.days_to_race ?? null}
        />

        <PlanArc
          weeks={training.weeks}
          raceName={training.race?.name}
          raceDate={training.race?.date}
          raceGoal={training.race?.goal}
        />

        {/* Regenerate pill — only when a plan + race both exist */}
        {currentWeek && training.race && (
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 6, marginBottom: -8 }}>
            <RegeneratePlanButton raceSlug={training.race.slug} />
          </div>
        )}

        {/* Left column = Week Ahead (top) + Next Quality / Volume summary (bottom).
            Right column = Coach brief, spans both rows (grid-row: 1 / span 2)
            so the coach height never stretches the week-ahead tiles. */}
        <div style={{
          display: 'grid', gridTemplateColumns: '1.4fr 1fr',
          gridTemplateRows: 'auto auto', columnGap: 24, rowGap: 18,
          marginTop: 18, alignItems: 'start',
        }}>
          {/* TOP LEFT — Week Ahead */}
          <div style={{ gridColumn: 1, gridRow: 1 }}>
            {currentWeek ? (
              <WeekAhead week={currentWeek} today={training.today} planId={training.plan_id ?? undefined} />
            ) : anchorRace ? (
              <GeneratePlanCTA raceSlug={anchorRace.slug} raceName={anchorRace.name} />
            ) : (
              <div className="card" style={{ padding: 40 }}>
                <div className="card-eyebrow" style={{ color: 'var(--mute)' }}>NO ACTIVE PLAN</div>
                <p style={{ color: 'var(--mute)', fontSize: 14 }}>Set a race on <a href="/races" style={{ color: 'var(--learn)' }}>Races</a> and the coach will draft a plan around it.</p>
              </div>
            )}
          </div>

          {/* BOTTOM LEFT — secondary info row: next quality + week summary */}
          <div style={{ gridColumn: 1, gridRow: 2, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
            {training.nextQuality && (
              <NextQualityCard nq={training.nextQuality} />
            )}
            {currentWeek && (
              <WeekSummaryCard
                weekIdx={currentWeek.idx}
                totalWeeks={totalWeeks}
                plannedMi={currentWeek.plannedMi}
                phase={currentWeek.phase}
              />
            )}
          </div>

          {/* RIGHT — Coach brief, spans both rows */}
          <div style={{
            gridColumn: 2, gridRow: '1 / span 2',
            background: 'linear-gradient(180deg, rgba(62,189,65,0.04), rgba(62,189,65,0) 60%)',
            border: '1px solid var(--line)', borderRadius: 16,
            padding: '8px 8px', minHeight: 220, alignSelf: 'start',
          }}>
            <BriefingLoader surface="training" renderCards={false} />
          </div>
        </div>
      </div>
    </main>
  );
}

function WeekSummaryCard({ weekIdx, totalWeeks, plannedMi, phase }: {
  weekIdx: number; totalWeeks: number; plannedMi: number; phase: string;
}) {
  return (
    <div className="card" style={{ padding: '20px 24px' }}>
      <div className="card-eyebrow" style={{ color: 'var(--dist)' }}>THIS WEEK · {phase}</div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <div style={{ fontFamily: 'var(--f-display)', fontSize: 24, color: 'var(--ink)', letterSpacing: '0.5px' }}>
            WEEK {weekIdx + 1}
          </div>
          <div style={{ fontFamily: 'var(--f-body)', fontSize: 11, color: 'var(--mute)', marginTop: 4, letterSpacing: '0.5px' }}>
            OF {totalWeeks} · {phase.toUpperCase()} BLOCK
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 4, color: 'var(--dist)' }}>
          <span style={{ fontFamily: 'var(--f-display)', fontSize: 44, lineHeight: 1 }}>{plannedMi.toFixed(plannedMi % 1 === 0 ? 0 : 1)}</span>
          <span style={{ fontFamily: 'var(--f-body)', fontSize: 10, fontWeight: 700, color: 'var(--mute)', letterSpacing: '1.2px', textTransform: 'uppercase' }}>MI PLANNED</span>
        </div>
      </div>
    </div>
  );
}

function NextQualityCard({ nq }: { nq: { date: string; dow: number; type: string; label: string | null; mi: number } }) {
  return (
    <div className="card" style={{ padding: '20px 24px' }}>
      <div className="card-eyebrow" style={{ color: 'var(--goal)' }}>NEXT QUALITY · {dowLabel(nq.dow)}</div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <div style={{ fontFamily: 'var(--f-display)', fontSize: 24, color: 'var(--ink)', letterSpacing: '0.5px' }}>
            {(nq.label ?? nq.type).toUpperCase()}
          </div>
          <div style={{ fontFamily: 'var(--f-body)', fontSize: 11, color: 'var(--mute)', marginTop: 4, letterSpacing: '0.5px' }}>
            {nq.date} · {nq.type.toUpperCase()}
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 4, color: 'var(--goal)' }}>
          <span style={{ fontFamily: 'var(--f-display)', fontSize: 44, lineHeight: 1 }}>{nq.mi}</span>
          <span style={{ fontFamily: 'var(--f-body)', fontSize: 10, fontWeight: 700, color: 'var(--mute)', letterSpacing: '1.2px', textTransform: 'uppercase' }}>MI</span>
        </div>
      </div>
    </div>
  );
}

function dowLabel(dow: number): string {
  return ['SUN','MON','TUE','WED','THU','FRI','SAT'][dow] ?? '';
}
