import Link from 'next/link';
import { Nav, Footer } from '../../components/nav';
import { listRaces } from '../../lib/db/repo';
import { formatHMS } from '../../lib/time';

export const dynamic = 'force-dynamic';

function formatRaceDate(iso: string): string {
  const d = new Date(iso + 'T12:00:00Z');
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function statusPill(status: string) {
  const map: Record<string, { bg: string; fg: string; label: string }> = {
    planned: { bg: 'var(--color-paper-2)', fg: 'var(--color-ink-3)', label: 'Planned' },
    completed: { bg: 'rgba(125,153,107,0.18)', fg: 'var(--color-sage)', label: 'Completed' },
    archived: { bg: 'var(--color-paper-2)', fg: 'var(--color-ink-4)', label: 'Archived' },
  };
  const m = map[status] ?? map.planned;
  return (
    <span style={{
      padding: '3px 10px',
      borderRadius: 999,
      fontSize: 11,
      fontWeight: 600,
      letterSpacing: '0.04em',
      textTransform: 'uppercase',
      background: m.bg,
      color: m.fg,
    }}>{m.label}</span>
  );
}

export default async function RacesPage() {
  const races = await listRaces();
  const planned = races.filter(r => r.status === 'planned');
  const completed = races.filter(r => r.status === 'completed' || r.status === 'archived');

  return (
    <main style={{ maxWidth: 1180, margin: '0 auto', padding: '0 32px' }}>
      <Nav active="races" />

      <section style={{ padding: '48px 0 24px' }}>
        <div className="eyebrow" style={{ marginBottom: 12 }}>Race plan</div>
        <h1 style={{ fontSize: 52, maxWidth: '22ch', margin: '0 0 16px' }}>
          One done.<br />
          <span className="serif-italic">What's next?</span>
        </h1>
        <p style={{ fontSize: 18, color: 'var(--color-ink-3)', maxWidth: '58ch', lineHeight: 1.5 }}>
          Every race you plan with Runcino lives here — upcoming targets and the ones you've already run, with their plans and (eventually) the live stats from your Watch.
        </p>
        <div style={{ marginTop: 24 }}>
          <Link href="/" className="btn btn-accent btn-lg">+ Plan a new race</Link>
        </div>
      </section>

      <section style={{ padding: '24px 0 16px' }}>
        <div className="eyebrow" style={{ marginBottom: 16 }}>Upcoming · {planned.length}</div>
        {planned.length === 0 ? (
          <div className="runcino-card" style={{ background: 'var(--color-paper-2)', textAlign: 'center', padding: 32 }}>
            <div style={{ color: 'var(--color-ink-3)', marginBottom: 12 }}>Nothing on the calendar yet.</div>
            <Link href="/" className="btn btn-ghost">Plan your next race →</Link>
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 16 }}>
            {planned.map(r => (
              <RaceCard key={r.id} slug={r.slug} name={r.name} date={r.raceDate} status={r.status} goalFinishS={r.goalFinishS} />
            ))}
          </div>
        )}
      </section>

      <section style={{ padding: '32px 0 64px' }}>
        <div className="eyebrow" style={{ marginBottom: 16 }}>Run · {completed.length}</div>
        {completed.length === 0 ? (
          <div style={{ color: 'var(--color-ink-3)', fontSize: 14 }}>No completed races yet.</div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 16 }}>
            {completed.map(r => (
              <RaceCard key={r.id} slug={r.slug} name={r.name} date={r.raceDate} status={r.status} goalFinishS={r.goalFinishS} />
            ))}
          </div>
        )}
      </section>

      <Footer tag="races" />
    </main>
  );
}

function RaceCard({
  slug, name, date, status, goalFinishS,
}: {
  slug: string;
  name: string;
  date: string;
  status: string;
  goalFinishS: number | null;
}) {
  return (
    <Link href={`/races/${slug}`} className="runcino-card" style={{ textDecoration: 'none', color: 'inherit', display: 'block' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
        <div className="font-mono" style={{ fontSize: 12, color: 'var(--color-ink-3)' }}>{formatRaceDate(date)}</div>
        {statusPill(status)}
      </div>
      <h3 style={{ fontSize: 20, marginBottom: 8, lineHeight: 1.2 }}>{name}</h3>
      <div style={{ display: 'flex', gap: 12, fontSize: 13, color: 'var(--color-ink-3)' }}>
        {goalFinishS && <span className="font-mono">goal {formatHMS(goalFinishS)}</span>}
      </div>
    </Link>
  );
}
