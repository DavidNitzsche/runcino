import { TopNav } from '@/components/layout/TopNav';
import { PhaseStrip } from '@/components/training/PhaseStrip';
import { PlanArc } from '@/components/training/PlanArc';
import { WeekAhead } from '@/components/training/WeekAhead';
import { BriefingLoader } from '@/components/cards/BriefingLoader';
import { loadTrainingState } from '@/lib/coach/training-state';

export const dynamic = 'force-dynamic';

const DAVID_USER_ID = process.env.DEFAULT_USER_ID ?? '0645f40c-951d-4ccc-b86e-9979cd26c795';

export default async function TrainingPage() {
  const training = await loadTrainingState(DAVID_USER_ID);

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

        <PhaseStrip phases={training.phases} currentPhase={training.currentPhase} />

        <PlanArc
          weeks={training.weeks}
          raceName={training.race?.name}
          raceDate={training.race?.date}
          raceGoal={training.race?.goal}
        />

        <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: 24, marginTop: 18 }}>
          {currentWeek ? (
            <WeekAhead week={currentWeek} today={training.today} planId={training.plan_id ?? undefined} />
          ) : (
            <div className="card" style={{ padding: 40 }}>
              <div className="card-eyebrow" style={{ color: 'var(--mute)' }}>NO ACTIVE PLAN</div>
              <p style={{ color: 'var(--mute)', fontSize: 14 }}>Set a goal and a race to generate a plan. (P6 wires the generator.)</p>
            </div>
          )}

          <div style={{
            background: 'linear-gradient(180deg, rgba(62,189,65,0.04), rgba(62,189,65,0) 60%)',
            border: '1px solid var(--line)', borderRadius: 16,
            padding: '8px 8px', minHeight: 220,
          }}>
            <BriefingLoader surface="training" renderCards={false} />
          </div>
        </div>

        {training.nextQuality && (
          <div style={{ marginTop: 18 }}>
            <NextQualityCard nq={training.nextQuality} />
          </div>
        )}
      </div>
    </main>
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
