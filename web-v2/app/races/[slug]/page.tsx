import { FaffPageShell } from '@/components/faff/FaffPageShell';
import { TopNav } from '@/components/layout/TopNav';
import { CourseSchematic } from '@/components/races/CourseSchematic';
import { PacePlanElevation } from '@/components/races/PacePlanElevation';
import {
  BuildingProgressCard, RaceWeekChecklist, RaceWeekCountdown,
} from '@/components/races/PhaseAwareBlocks';
import { RaceDayTimeline } from '@/components/races/RaceDayTimeline';
import { RealRouteSvg } from '@/components/races/RealRouteSvg';
import { DeleteRaceButton, EditRaceButton } from '@/components/races/RaceCrudUI';
import { GpxUploadButton } from '@/components/races/GpxUploadButton';
import { GpxFinderButton } from '@/components/races/GpxFinderButton';
import { RaceRetrospectiveForm } from '@/components/races/RaceRetrospectiveForm';
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
//
// 2026-05-28 — Phase 22 (race-day timeline):
//   Header replaced with the shared FaffPageShell so /races/[slug] aligns
//   with the rest of the secondary surfaces (training, races index, log,
//   health, profile). The countdown lives in the accent slot as a chip.
//   <RaceDayTimeline> sits directly under the band — it self-gates to A
//   races in the T-7 → T+14 window so the existing chrome below it
//   continues to work for B/C / sharpening / building states.
export default async function RaceDetailPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;

  // Audit 2026-05-27: races + geometry were two sequential awaits, doubling
  // FCP latency on race detail. They're independent — parallelize.
  const [races, geoRow] = await Promise.all([
    loadRacesState(DAVID_USER_ID),
    pool.query(
      `SELECT course_geometry, course_source FROM races WHERE slug = $1`,
      [slug]
    ).catch(() => ({ rows: [] as any[] })),
  ]);
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

  // Eyebrow assembly — caps-tracked metadata strip that sits below the
  // hero headline inside FaffPageShell's band.
  const eyebrowParts: string[] = [
    `${race.priority ?? 'C'} · ${goalTone}`,
  ];
  if (race.distance_label) eyebrowParts.push(race.distance_label.toUpperCase());
  if (race.location)       eyebrowParts.push(race.location.toUpperCase());
  if (race.date)           eyebrowParts.push(formatDate(race.date));
  if (race.goal)           eyebrowParts.push(`GOAL ${race.goal}`);

  return (
    <FaffPageShell
      title={race.name}
      eyebrow={eyebrowParts.join(' · ')}
      accent={<CountdownChip days={race.days} proximity={proximity} isA={isA} />}
    >
      {/* T-7 → T+14 race-day arc — gates internally on priority + window. */}
      <RaceDayTimeline race={race} daysUntil={race.days} />

      {/* Coach voice for this proximity — loads async */}
      <div style={{
        background: proximity === 'race-week' || proximity === 'post-race'
          ? 'linear-gradient(180deg, rgba(255,136,71,0.06), rgba(255,136,71,0) 70%)'
          : 'linear-gradient(180deg, rgba(62,189,65,0.04), rgba(62,189,65,0) 60%)',
        borderTop: '1px solid var(--line)',
        borderLeft: `3px solid ${proximity === 'race-week' || proximity === 'post-race' ? 'var(--race)' : 'var(--green)'}`,
        padding: '10px 12px', marginBottom: 18, minHeight: 200,
      }}>
        <BriefingLoader surface="race-detail" raceSlug={slug} renderCards={false} />
      </div>

      {/* #154 phase-aware blocks — only render for matching proximity */}
      {proximity === 'building' && (
        <BuildingProgressCard
          daysToRace={race.days}
          peakMi={null}
          currentWeekMi={null}
        />
      )}
      {proximity === 'race-week' && (
        <>
          <RaceWeekCountdown daysToRace={race.days} raceDate={race.date ?? null} />
          <RaceWeekChecklist slug={slug} daysToRace={race.days} />
        </>
      )}

      {/* Course + pace plan — present at all proximities except deep post-race */}
      {proximity !== 'post-race' && (
        <div style={{ borderTop: '1px solid var(--line)', padding: '20px 0 4px', marginTop: 18 }}>
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
          <div style={{ marginBottom: 14, display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
            <GpxFinderButton
              slug={slug}
              raceName={race.name}
              distanceMi={courseGeometry?.distance_mi ?? (race.distance_label?.toLowerCase().includes('half') ? 13.1 : race.distance_label?.toLowerCase().includes('marathon') ? 26.2 : null)}
            />
            <GpxUploadButton slug={slug} alreadyAttached={!!courseGeometry} />
          </div>
          <div style={{ background: 'var(--card-2)', border: '1px solid var(--line-2)', borderRadius: 4, padding: 12, marginBottom: 14 }}>
            {courseGeometry ? <RealRouteSvg geometry={courseGeometry} /> : <CourseSchematic />}
          </div>
          {/* P47 — elevation-overlay pace plan replaces the old side table. */}
          <PacePlanElevation
            geometry={courseGeometry}
            distanceMi={courseGeometry?.distance_mi ?? (race.distance_label?.toLowerCase().includes('half') ? 13.1 : race.distance_label?.toLowerCase().includes('marathon') ? 26.2 : 13.1)}
            goalLabel={race.goal ?? undefined}
          />
        </div>
      )}

      {/* Post-race section — retro form (finish, PB, felt, exec, notes) */}
      {proximity === 'post-race' && (
        <div style={{ borderTop: '2px solid var(--ink)', padding: '20px 0 4px', marginTop: 18 }}>
          <div style={{ fontFamily: 'var(--f-display)', fontSize: 22, letterSpacing: '0.5px', marginBottom: 4 }}>
            POST-RACE
          </div>
          {race.finishTime && (
            <div style={{ marginBottom: 12 }}>
              <div style={{ fontFamily: 'var(--f-display)', fontSize: 56, color: race.pb ? 'var(--green)' : 'var(--ink)', letterSpacing: '0.5px', lineHeight: 1 }}>
                {race.finishTime}
              </div>
              {race.pb && (
                <div style={{ fontFamily: 'var(--f-body)', fontSize: 11, color: 'var(--green)', letterSpacing: '1.4px', marginTop: 6 }}>● PERSONAL BEST</div>
              )}
            </div>
          )}
          <RaceRetrospectiveForm slug={slug} existing={{
            finishTime: race.finishTime ?? null,
            pb: race.pb ?? null,
            retroFelt: (race as any).retroFelt ?? null,
            retroExecution: (race as any).retroExecution ?? null,
            retroNotes: (race as any).retroNotes ?? null,
          }} />
        </div>
      )}

      {/* Footer actions */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 32, paddingTop: 18, borderTop: '1px solid var(--line-2)', gap: 12 }}>
        <a href="/races" style={{ color: 'var(--mute)', fontFamily: 'var(--f-label)', fontSize: 13, letterSpacing: '1.2px' }}>← BACK TO RACES</a>
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
    </FaffPageShell>
  );
}

/** Countdown chip shown in the FaffPageShell accent slot — replaces the
 *  old right-aligned 120px number block. Same data, smaller footprint,
 *  consistent header chrome across surfaces. */
function CountdownChip({
  days, proximity, isA,
}: { days: number; proximity: string; isA: boolean }) {
  const color = proximityColor(proximity);
  const label = proximity === 'post-race' ? 'DAYS AGO' : 'DAYS';
  return (
    <div style={{
      display: 'inline-flex',
      flexDirection: 'column',
      alignItems: 'flex-end',
      gap: 4,
    }}>
      <div style={{
        fontFamily: 'var(--f-display)',
        fontSize: 84,
        fontWeight: 700,
        letterSpacing: '-0.015em',
        lineHeight: 0.86,
        color,
      }}>
        {Math.abs(days)}
      </div>
      <div style={{
        fontFamily: 'var(--f-body)',
        fontSize: 11,
        fontWeight: 700,
        letterSpacing: '1.4px',
        textTransform: 'uppercase',
        color: 'var(--mute)',
      }}>
        {label}
        {isA && (
          <span style={{
            marginLeft: 8,
            padding: '2px 6px',
            borderRadius: 4,
            background: 'rgba(255,136,71,0.18)',
            color: 'var(--race)',
            letterSpacing: '1px',
          }}>A</span>
        )}
      </div>
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
