import { TopNav } from '@/components/layout/TopNav';
import { CourseSchematic, PacePlanTable } from '@/components/races/CourseSchematic';
import { RealRouteSvg } from '@/components/races/RealRouteSvg';
import { DeleteRaceButton, EditRaceButton } from '@/components/races/RaceCrudUI';
import { GpxUploadButton } from '@/components/races/GpxUploadButton';
import { BriefingLoader } from '@/components/cards/BriefingLoader';
import { loadRacesState } from '@/lib/coach/races-state';
import { pool } from '@/lib/db/pool';

export const dynamic = 'force-dynamic';

const DAVID_USER_ID = process.env.DEFAULT_USER_ID ?? '0645f40c-951d-4ccc-b86e-9979cd26c795';

// Race detail — proximity-adaptive surface. 4 modes keyed off days_to_race:
//   days < 0   → post-race
//   days ≤ 7   → race-week
//   days ≤ 60  → sharpening
//   else       → building
export default async function RaceDetailPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;

  const races = await loadRacesState(DAVID_USER_ID);

  // Course geometry (set if any GPX has been attached)
  const geoRow = await pool.query(
    `SELECT course_geometry, course_source FROM races WHERE slug = $1`,
    [slug]
  ).catch(() => ({ rows: [] }));
  const courseGeometry = geoRow.rows[0]?.course_geometry ?? null;
  const courseSource = geoRow.rows[0]?.course_source ?? null;

  const race = [...races.aRaces, ...races.upcomingBs, ...races.upcomingCs, ...races.past].find((r) => r?.slug === slug);
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

        {/* Coach voice for this proximity — loads async */}
        <div style={{
          background: proximity === 'race-week' || proximity === 'post-race'
            ? 'linear-gradient(180deg, rgba(255,136,71,0.06), rgba(255,136,71,0) 70%)'
            : 'linear-gradient(180deg, rgba(62,189,65,0.04), rgba(62,189,65,0) 60%)',
          border: `1px solid ${proximity === 'race-week' || proximity === 'post-race' ? 'rgba(255,136,71,0.22)' : 'var(--line)'}`,
          borderRadius: 18, padding: '4px 4px', marginBottom: 18, minHeight: 200,
        }}>
          <BriefingLoader surface="race-detail" raceSlug={slug} renderCards={false} />
        </div>

        {/* Course + pace plan — present at all proximities except deep post-race */}
        {proximity !== 'post-race' && (
          <div className="card" style={{ padding: '24px 28px', marginTop: 18 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 12, gap: 12, flexWrap: 'wrap' }}>
              <div style={{ fontFamily: 'var(--f-display)', fontSize: 22, letterSpacing: '0.5px' }}>
                {proximity === 'race-week' ? 'COURSE · PACE PLAN LOCKED' : 'COURSE'}
              </div>
              <div style={{ fontFamily: 'var(--f-body)', fontSize: 10, color: 'var(--mute)', letterSpacing: '1.2px', textTransform: 'uppercase' }}>
                {courseGeometry
                  ? `${courseGeometry.distance_mi} MI · +${courseGeometry.elevation_gain_ft} FT · ${courseSource?.toUpperCase()}`
                  : '13.1 MI · SCHEMATIC · GPX PENDING'}
              </div>
            </div>
            <div style={{ marginBottom: 14 }}>
              <GpxUploadButton slug={slug} alreadyAttached={!!courseGeometry} />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1.6fr 1fr', gap: 18 }}>
              <div style={{ background: 'rgba(255,255,255,0.02)', borderRadius: 12, padding: 12 }}>
                {courseGeometry ? <RealRouteSvg geometry={courseGeometry} /> : <CourseSchematic />}
              </div>
              <div>
                <PacePlanTable goalLabel={race.goal ?? undefined} />
              </div>
            </div>
          </div>
        )}

        {/* Post-race section — finish time + (eventually) splits */}
        {proximity === 'post-race' && (
          <div className="card" style={{ padding: '24px 28px', marginTop: 18 }}>
            <div style={{ fontFamily: 'var(--f-display)', fontSize: 22, letterSpacing: '0.5px', marginBottom: 16 }}>
              POST-RACE
            </div>
            {race.finishTime ? (
              <>
                <div style={{ fontFamily: 'var(--f-display)', fontSize: 56, color: race.pb ? 'var(--green)' : 'var(--ink)', letterSpacing: '0.5px', lineHeight: 1 }}>
                  {race.finishTime}
                </div>
                {race.pb && (
                  <div style={{ fontFamily: 'var(--f-body)', fontSize: 11, color: 'var(--green)', letterSpacing: '1.4px', marginTop: 6 }}>● PERSONAL BEST</div>
                )}
                <div style={{ fontFamily: 'var(--f-body)', fontSize: 12, color: 'var(--mute)', lineHeight: 1.6, marginTop: 18 }}>
                  Splits + actual-vs-plan show up here once a matching Strava activity is linked to this race.
                </div>
              </>
            ) : (
              <div style={{ fontFamily: 'var(--f-body)', fontSize: 13, color: 'var(--mute)', lineHeight: 1.6 }}>
                Add your finish time on the race card to populate the retrospective.
              </div>
            )}
          </div>
        )}

        {/* Footer actions */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 32, paddingTop: 18, borderTop: '1px solid var(--line-2)', gap: 12 }}>
          <a href="/races" style={{ color: 'var(--mute)', fontFamily: 'var(--f-display)', fontSize: 13, letterSpacing: '1.2px' }}>← BACK TO RACES</a>
          <div style={{ display: 'flex', gap: 8 }}>
            <EditRaceButton slug={slug} current={{
              name: race.name,
              date: race.date,
              distance_label: race.distance_label,
              priority: race.priority,
              goal: race.goal,
            }} />
            <DeleteRaceButton slug={slug} />
          </div>
        </div>
      </div>
    </main>
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
