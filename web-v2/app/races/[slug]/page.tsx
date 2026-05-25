import { TopNav } from '@/components/layout/TopNav';
import { CourseSchematic, PacePlanTable } from '@/components/races/CourseSchematic';
import { loadRacesState } from '@/lib/coach/races-state';
import { generateBriefing } from '@/lib/coach/engine';

export const dynamic = 'force-dynamic';

const DAVID_USER_ID = process.env.DEFAULT_USER_ID ?? '0645f40c-951d-4ccc-b86e-9979cd26c795';

// Race detail — proximity-adaptive surface. 4 modes keyed off days_to_race:
//   days < 0   → post-race
//   days ≤ 7   → race-week
//   days ≤ 60  → sharpening
//   else       → building
export default async function RaceDetailPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;

  const [races, briefing] = await Promise.all([
    loadRacesState(DAVID_USER_ID),
    generateBriefing(DAVID_USER_ID, 'race-detail', slug).catch(() => null),
  ]);

  const race = [races.aRace, ...races.upcomingBs, ...races.upcomingCs, ...races.past].find((r) => r?.slug === slug);
  if (!race) {
    return (
      <main>
        <TopNav />
        <div style={{ padding: 40, maxWidth: 1440 }}>
          <h1 style={{ fontFamily: 'var(--f-display)', fontSize: 56 }}>Race not found</h1>
          <p style={{ color: 'var(--mute)' }}>Slug: {slug}</p>
        </div>
      </main>
    );
  }

  const proximity = race.days < 0 ? 'post-race'
    : race.days <= 7 ? 'race-week'
    : race.days <= 60 ? 'sharpening'
    : 'building';
  const isA = race.priority === 'A';
  const goalTone = proximity === 'race-week' ? 'RACE WEEK'
    : proximity === 'sharpening' ? 'SHARPENING'
    : proximity === 'building'   ? 'BUILDING'
    : 'POST-RACE';

  return (
    <main>
      <TopNav />
      <div style={{ padding: '40px 40px 80px', maxWidth: 1440, margin: '0 auto' }}>
        {/* Header — priority tag + name + countdown */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24 }}>
          <div>
            <span style={{
              display: 'inline-block', fontFamily: 'var(--f-display)', fontSize: 11, letterSpacing: '1px',
              padding: '3px 8px', borderRadius: 4,
              background: isA ? 'rgba(255,136,71,0.18)' : 'rgba(243,173,56,0.18)',
              color: isA ? 'var(--race)' : 'var(--goal)',
            }}>
              {race.priority ?? 'C'} · {goalTone}
            </span>
            <h1 style={{ fontFamily: 'var(--f-display)', fontSize: 56, lineHeight: 1, margin: '14px 0 0', letterSpacing: '0.5px' }}>
              {race.name}
            </h1>
            <div style={{ fontFamily: 'var(--f-body)', fontSize: 13, color: 'var(--mute)', letterSpacing: '0.8px', textTransform: 'uppercase', marginTop: 8 }}>
              {race.distance_label ?? 'RACE'}
              {race.location ? ` · ${race.location}` : ''}
              {race.date ? ` · ${formatDate(race.date)}` : ''}
              {race.goal ? ` · GOAL ${race.goal}` : ''}
            </div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontFamily: 'var(--f-display)', fontSize: 120, color: proximityColor(proximity), lineHeight: 0.95, letterSpacing: '0.5px' }}>
              {Math.abs(race.days)}
            </div>
            <div style={{ fontFamily: 'var(--f-body)', fontSize: 13, color: 'var(--mute)', letterSpacing: '1.4px', textTransform: 'uppercase' }}>
              {proximity === 'post-race' ? 'DAYS AGO' : 'DAYS'}
            </div>
          </div>
        </div>

        {/* Coach voice for this proximity */}
        {briefing && <CoachIntro briefing={briefing} proximity={proximity} />}

        {/* Course + pace plan — present at all proximities except deep post-race */}
        {proximity !== 'post-race' && (
          <div className="card" style={{ padding: '24px 28px', marginTop: 18 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 12 }}>
              <div style={{ fontFamily: 'var(--f-display)', fontSize: 22, letterSpacing: '0.5px' }}>
                {proximity === 'race-week' ? 'COURSE · PACE PLAN LOCKED' : 'COURSE'}
              </div>
              <div style={{ fontFamily: 'var(--f-body)', fontSize: 10, color: 'var(--mute)', letterSpacing: '1.2px', textTransform: 'uppercase' }}>
                13.1 MI · MOSTLY FLAT · +224 FT
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1.6fr 1fr', gap: 18 }}>
              <div style={{ background: 'rgba(255,255,255,0.02)', borderRadius: 12, padding: 12 }}>
                <CourseSchematic />
              </div>
              <div>
                <PacePlanTable goalLabel={race.goal ?? undefined} />
              </div>
            </div>
          </div>
        )}

        {/* Post-race section — splits + reflection (P4 will wire actual splits when activity is matched) */}
        {proximity === 'post-race' && (
          <div className="card" style={{ padding: '24px 28px', marginTop: 18 }}>
            <div style={{ fontFamily: 'var(--f-display)', fontSize: 22, letterSpacing: '0.5px', marginBottom: 16 }}>
              POST-RACE
            </div>
            <div style={{ fontFamily: 'var(--f-body)', fontSize: 13, color: 'var(--mute)', lineHeight: 1.6 }}>
              Splits + actual-vs-plan wire in P4 once the race-day strava_activity is linked.
              {race.finishTime ? (
                <div style={{ fontFamily: 'var(--f-display)', fontSize: 44, color: 'var(--green)', marginTop: 12 }}>
                  {race.finishTime}
                </div>
              ) : null}
            </div>
          </div>
        )}
      </div>
    </main>
  );
}

function CoachIntro({ briefing, proximity }: { briefing: Awaited<ReturnType<typeof generateBriefing>>; proximity: string }) {
  const color = proximity === 'race-week' || proximity === 'post-race' ? 'var(--race)' : 'var(--green)';
  const bg = proximity === 'race-week' || proximity === 'post-race'
    ? 'linear-gradient(180deg, rgba(255,136,71,0.06), rgba(255,136,71,0) 70%)'
    : 'linear-gradient(180deg, rgba(62,189,65,0.04), rgba(62,189,65,0) 60%)';
  return (
    <div style={{
      background: bg,
      border: `1px solid ${proximity === 'race-week' || proximity === 'post-race' ? 'rgba(255,136,71,0.22)' : 'var(--line)'}`,
      borderRadius: 18, padding: '24px 28px', marginBottom: 18,
    }}>
      <div style={{ fontFamily: 'var(--f-body)', fontSize: 10, fontWeight: 700, color, letterSpacing: '1.8px', textTransform: 'uppercase', marginBottom: 12 }}>
        COACH · {proximity.toUpperCase()}
      </div>
      {briefing.lead && (
        <div style={{ fontFamily: 'var(--f-display)', fontSize: 28, color: 'var(--ink)', lineHeight: 1.1, marginBottom: 10 }}>
          {briefing.lead}
        </div>
      )}
      {briefing.voice.map((p, i) => (
        <p key={i} style={{ fontFamily: 'var(--f-body)', fontSize: 14, lineHeight: 1.6, color: 'rgba(246,247,248,0.86)', margin: '0 0 8px' }}>{p}</p>
      ))}
    </div>
  );
}

function proximityColor(p: string): string {
  switch (p) {
    case 'race-week': return 'var(--race)';
    case 'post-race': return 'var(--green)';
    case 'sharpening': return 'var(--learn)';
    default: return 'var(--race)';
  }
}

function formatDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  const months = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
  return `${months[m - 1]} ${d}, ${y}`;
}
