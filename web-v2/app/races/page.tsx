import Link from 'next/link';
import { TopNav } from '@/components/layout/TopNav';
import { loadRacesState, type RaceRow } from '@/lib/coach/races-state';
import { AddRaceButton } from '@/components/races/RaceCrudUI';
import { BriefingLoader } from '@/components/cards/BriefingLoader';

export const dynamic = 'force-dynamic';

const DAVID_USER_ID = process.env.DEFAULT_USER_ID ?? '0645f40c-951d-4ccc-b86e-9979cd26c795';

export default async function RacesPage() {
  const races = await loadRacesState(DAVID_USER_ID);

  return (
    <main>
      <TopNav />
      <div style={{ padding: '40px 40px 80px', maxWidth: 1440, margin: '0 auto' }}>
        <h1 style={{ fontFamily: 'var(--f-display)', fontSize: 56, lineHeight: 1, margin: 0, letterSpacing: '0.5px' }}>
          {races.aRace ? 'Races.' : "What's next?"}
        </h1>
        <div style={{ fontFamily: 'var(--f-body)', fontSize: 13, color: 'var(--mute)', letterSpacing: '1.6px', textTransform: 'uppercase', marginTop: 12, marginBottom: 28 }}>
          {races.aRaces.length > 0
            ? `${races.aRaces.length} A-RACE${races.aRaces.length === 1 ? '' : 'S'} · `
            : 'NO A-RACE SET · '}
          {races.upcomingBs.length} B-RACE{races.upcomingBs.length === 1 ? '' : 'S'} ·{' '}
          {races.upcomingCs.length} C-RACE{races.upcomingCs.length === 1 ? '' : 'S'} ·{' '}
          {races.totalPast} PAST
        </div>

        {/* Coach voice opens the page — loads async */}
        <div style={{
          background: 'linear-gradient(180deg, rgba(62,189,65,0.04), rgba(62,189,65,0) 60%)',
          border: '1px solid var(--line)', borderRadius: 18,
          padding: '4px 4px', marginBottom: 18, minHeight: 180,
        }}>
          <BriefingLoader surface="races" renderCards={false} />
        </div>

        {/* + ADD RACE — top of page so it's discoverable */}
        <div style={{ marginBottom: 18 }}><AddRaceButton /></div>

        {races.aRaces.length > 0 ? (
          <>
            {/* Closest A is the hero; any additional As stack below as smaller cards */}
            <ARaceHero race={races.aRaces[0]} />
            {races.aRaces.slice(1).map((r) => <SecondaryARace key={r.slug} race={r} />)}
          </>
        ) : <NoARacePrompt />}

        {races.upcomingBs.length > 0 && (
          <>
            <SectionLabel>UPCOMING · B-RACES</SectionLabel>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 24 }}>
              {races.upcomingBs.map((r) => <BCRaceCard key={r.slug} race={r} priority="B" />)}
            </div>
          </>
        )}

        {races.upcomingCs.length > 0 && (
          <>
            <SectionLabel>UPCOMING · C-RACES</SectionLabel>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14, marginBottom: 24 }}>
              {races.upcomingCs.map((r) => <BCRaceCard key={r.slug} race={r} priority="C" />)}
            </div>
          </>
        )}

        {races.past.length > 0 && (
          <>
            <SectionLabel>PAST</SectionLabel>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14 }}>
              {races.past.slice(0, 6).map((r) => <PastRaceCard key={r.slug} race={r} />)}
            </div>
          </>
        )}
      </div>
    </main>
  );
}

function ARaceHero({ race }: { race: RaceRow }) {
  return (
    <Link href={`/races/${race.slug}`} style={{
      display: 'block',
      background: 'linear-gradient(135deg, rgba(255,136,71,0.08), rgba(255,136,71,0.02))',
      border: '1px solid rgba(255,136,71,0.30)',
      borderRadius: 22,
      padding: '32px 36px',
      marginBottom: 24,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 18 }}>
        <div>
          <span style={{ display: 'inline-block', fontFamily: 'var(--f-label)', fontSize: 11, letterSpacing: '1px', padding: '3px 8px', borderRadius: 4, background: 'rgba(255,136,71,0.18)', color: 'var(--race)' }}>A · GOAL RACE</span>
          <div style={{ fontFamily: 'var(--f-display)', fontSize: 56, color: 'var(--ink)', letterSpacing: '0.5px', lineHeight: 1, marginTop: 14 }}>
            {race.name}
          </div>
          <div style={{ fontFamily: 'var(--f-body)', fontSize: 13, color: 'var(--mute)', letterSpacing: '0.8px', textTransform: 'uppercase', marginTop: 8 }}>
            {race.distance_label ?? 'RACE'}
            {race.location ? ` · ${race.location}` : ''}
            {race.date ? ` · ${formatDate(race.date)}` : ''}
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontFamily: 'var(--f-display)', fontSize: 80, color: 'var(--race)', lineHeight: 0.95, letterSpacing: '0.5px' }}>{race.days}</div>
          <div style={{ fontFamily: 'var(--f-body)', fontSize: 11, color: 'var(--mute)', letterSpacing: '1.4px', textTransform: 'uppercase' }}>DAYS</div>
        </div>
      </div>

      {race.goal && (
        <div style={{
          display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 24,
          marginTop: 18, paddingTop: 18, borderTop: '1px solid rgba(255,255,255,0.06)',
        }}>
          <div>
            <div style={{ fontSize: 10, color: 'var(--mute)', fontWeight: 700, letterSpacing: '1.4px', textTransform: 'uppercase', marginBottom: 6 }}>GOAL</div>
            <div style={{ fontFamily: 'var(--f-display)', fontSize: 44, color: 'var(--goal)', letterSpacing: '0.5px' }}>{race.goal}</div>
            <div style={{ fontFamily: 'var(--f-body)', fontSize: 11, color: 'var(--mute)', marginTop: 4 }}>ambitious + real</div>
          </div>
        </div>
      )}
    </Link>
  );
}

function SecondaryARace({ race }: { race: RaceRow }) {
  return (
    <Link href={`/races/${race.slug}`} style={{
      display: 'block',
      background: 'linear-gradient(135deg, rgba(255,136,71,0.06), rgba(255,136,71,0.02))',
      border: '1px solid rgba(255,136,71,0.22)',
      borderRadius: 16, padding: '20px 24px', marginBottom: 16,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <span style={{ display: 'inline-block', fontFamily: 'var(--f-label)', fontSize: 10, letterSpacing: '1px', padding: '2px 7px', borderRadius: 4, background: 'rgba(255,136,71,0.18)', color: 'var(--race)' }}>A</span>
          <div style={{ fontFamily: 'var(--f-display)', fontSize: 28, color: 'var(--ink)', marginTop: 8, letterSpacing: '0.5px' }}>{race.name}</div>
          <div style={{ fontFamily: 'var(--f-body)', fontSize: 11, color: 'var(--mute)', marginTop: 4 }}>
            {race.distance_label ?? ''} {race.date ? `· ${formatDate(race.date)}` : ''}{race.goal ? ` · goal ${race.goal}` : ''}
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontFamily: 'var(--f-display)', fontSize: 44, color: 'var(--race)', lineHeight: 1 }}>{race.days}</div>
          <div style={{ fontSize: 10, color: 'var(--mute)', letterSpacing: '1.2px' }}>DAYS</div>
        </div>
      </div>
    </Link>
  );
}

function BCRaceCard({ race, priority }: { race: RaceRow; priority: 'B' | 'C' }) {
  const color = priority === 'B' ? 'var(--goal)' : 'var(--learn)';
  const bg = priority === 'B' ? 'rgba(243,173,56,0.18)' : 'rgba(176,132,255,0.18)';
  return (
    <Link href={`/races/${race.slug}`} className="card" style={{ display: 'block' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <span style={{ display: 'inline-block', fontFamily: 'var(--f-label)', fontSize: 11, letterSpacing: '1px', padding: '3px 8px', borderRadius: 4, background: bg, color }}>{priority}</span>
          <div style={{ fontFamily: 'var(--f-display)', fontSize: 22, color: 'var(--ink)', marginTop: 8 }}>{race.name}</div>
          <div style={{ fontSize: 10, color: 'var(--mute)', marginTop: 4 }}>
            {race.distance_label ?? '—'}{race.date ? ` · ${formatDate(race.date)}` : ''}
          </div>
        </div>
        <div style={{ fontFamily: 'var(--f-display)', fontSize: 26, color, lineHeight: 1 }}>{race.days}d</div>
      </div>
    </Link>
  );
}

function PastRaceCard({ race }: { race: RaceRow }) {
  const finish = race.finishTime ?? (race.matchedRun ? '—' : null);
  return (
    <Link href={`/races/${race.slug}`} className="card" style={{
      padding: '16px 18px', display: 'block',
      background: race.pb ? 'linear-gradient(135deg, rgba(62,189,65,0.06), rgba(62,189,65,0.01))' : 'rgba(255,255,255,0.025)',
      border: race.pb ? '1px solid rgba(62,189,65,0.30)' : '1px solid var(--line)',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontFamily: 'var(--f-label)', fontSize: 17, color: 'var(--ink)', letterSpacing: '0.3px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {race.name}
          </div>
          <div style={{ fontSize: 10, color: 'var(--mute)', letterSpacing: '1.2px', marginTop: 4 }}>
            {race.date ? formatDate(race.date) : ''}
            {race.distance_label ? ` · ${race.distance_label.toUpperCase()}` : ''}
          </div>
        </div>
        {race.pb && (
          <span style={{
            background: 'rgba(62,189,65,0.18)', color: 'var(--green)',
            padding: '2px 7px', borderRadius: 4, fontSize: 9, fontWeight: 800, letterSpacing: '1.2px',
          }}>PB</span>
        )}
      </div>

      {finish && (
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginTop: 10 }}>
          <span style={{ fontFamily: 'var(--f-display)', fontSize: 28, color: race.pb ? 'var(--green)' : 'var(--ink)', letterSpacing: '0.5px', lineHeight: 1 }}>
            {finish}
          </span>
          {race.matchedRun?.pace && (
            <span style={{ fontFamily: 'var(--f-body)', fontSize: 11, color: 'var(--mute)', letterSpacing: '0.5px' }}>
              {race.matchedRun.pace} /mi
            </span>
          )}
        </div>
      )}

      {race.matchedRun && (
        <div style={{ display: 'flex', gap: 14, marginTop: 8, fontFamily: 'var(--f-body)', fontSize: 10, color: 'var(--mute)', letterSpacing: '0.5px' }}>
          {race.matchedRun.avg_hr      != null && <span><span style={{ color: 'rgba(246,247,248,0.55)' }}>HR</span> <span style={{ color: 'var(--ink)' }}>{race.matchedRun.avg_hr}</span></span>}
          {race.matchedRun.cadence     != null && <span><span style={{ color: 'rgba(246,247,248,0.55)' }}>CAD</span> <span style={{ color: 'var(--ink)' }}>{race.matchedRun.cadence}</span></span>}
          {race.matchedRun.elev_gain_ft!= null && race.matchedRun.elev_gain_ft > 0 && <span><span style={{ color: 'rgba(246,247,248,0.55)' }}>↑</span> <span style={{ color: 'var(--ink)' }}>{race.matchedRun.elev_gain_ft}ft</span></span>}
        </div>
      )}
    </Link>
  );
}

function NoARacePrompt() {
  return (
    <div className="card" style={{ padding: '28px 32px', marginBottom: 24 }}>
      <div className="card-eyebrow" style={{ color: 'var(--mute)' }}>NO RACE ON THE BOOKS</div>
      <p style={{ color: 'rgba(246,247,248,0.86)', fontSize: 14, lineHeight: 1.6 }}>
        Pick the next race to anchor a plan around — tap <span style={{ color: 'var(--green)', fontWeight: 600 }}>+ ADD RACE</span> above.
      </p>
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      fontFamily: 'var(--f-body)', fontSize: 11, fontWeight: 700, color: 'var(--mute)',
      letterSpacing: '1.6px', textTransform: 'uppercase', margin: '24px 0 12px',
    }}>{children}</div>
  );
}

function formatDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  const months = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
  return `${months[m - 1]} ${d}`;
}
