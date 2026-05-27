import { TopNav } from '@/components/layout/TopNav';
import { loadRunDetail } from '@/lib/coach/run-state';

export const dynamic = 'force-dynamic';

const DAVID_USER_ID = process.env.DEFAULT_USER_ID ?? '0645f40c-951d-4ccc-b86e-9979cd26c795';

export default async function RunDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const run = await loadRunDetail(DAVID_USER_ID, id);

  if (!run) {
    return (
      <main>
        <TopNav />
        <div style={{ padding: '40px 40px', maxWidth: 1440 }}>
          <a href="/today" style={{ color: 'var(--mute)', fontFamily: 'var(--f-label)', fontSize: 14, letterSpacing: '1.2px' }}>← BACK</a>
          <h1 style={{ fontFamily: 'var(--f-display)', fontSize: 56, marginTop: 20 }}>Run not found</h1>
          <p style={{ color: 'var(--mute)' }}>id: {id}</p>
        </div>
      </main>
    );
  }

  return (
    <main>
      <TopNav />
      <div style={{ padding: '40px 40px 80px', maxWidth: 1100, margin: '0 auto' }}>
        <a href="/today" style={{ color: 'var(--mute)', fontFamily: 'var(--f-label)', fontSize: 14, letterSpacing: '1.2px' }}>← BACK</a>
        <div style={{ fontFamily: 'var(--f-body)', fontSize: 11, color: 'var(--mute)', letterSpacing: '1.6px', textTransform: 'uppercase', marginTop: 20 }}>
          {run.date}
        </div>
        <h1 style={{ fontFamily: 'var(--f-display)', fontSize: 56, margin: '8px 0 24px', letterSpacing: '0.5px', lineHeight: 1 }}>
          {run.name ?? `${run.distance_mi.toFixed(1)} MI`}
        </h1>

        {/* Hero stats */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14, marginBottom: 24 }}>
          <BigStat v={run.distance_mi.toFixed(1)} u="miles" color="var(--dist)" />
          {run.pace        && <BigStat v={run.pace}        u="avg pace" color="var(--green)" />}
          {run.time_moving && <BigStat v={run.time_moving} u="moving"   color="var(--ink)" />}
          {run.hr_avg != null && <BigStat v={String(run.hr_avg)} u="avg hr" color="var(--mute)" />}
        </div>

        {/* Splits — bar per mile by pace */}
        {run.splits.length > 0 && (
          <div className="card" style={{ padding: '20px 24px', marginBottom: 14 }}>
            <div className="card-eyebrow" style={{ color: 'var(--green)' }}>SPLITS · PACE PER MILE</div>
            <SplitsBars splits={run.splits} />
          </div>
        )}

        {/* HR zone bars */}
        {run.hrZonePcts.z2 + run.hrZonePcts.z3 + run.hrZonePcts.z4 + run.hrZonePcts.z5 > 0 && (
          <div className="card" style={{ padding: '20px 24px', marginBottom: 14 }}>
            <div className="card-eyebrow" style={{ color: 'var(--goal)' }}>HR · TIME IN ZONE</div>
            <HRZones pcts={run.hrZonePcts} />
          </div>
        )}

        {/* Conditions */}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 6 }}>
          {run.cadence_avg && <Chip k="CAD" v={String(run.cadence_avg)} />}
          {run.temp_f != null && <Chip warm>{run.temp_f}° · {run.temp_f >= 75 ? 'warm' : 'cool'}</Chip>}
          {run.elev_gain_ft != null && <Chip k="GAIN" v={`${run.elev_gain_ft}ft`} />}
        </div>
      </div>
    </main>
  );
}

function BigStat({ v, u, color }: { v: string; u: string; color: string }) {
  return (
    <div className="card" style={{ padding: '14px 16px' }}>
      <div style={{ fontFamily: 'var(--f-display)', fontSize: 36, color, lineHeight: 1 }}>{v}</div>
      <div style={{ fontFamily: 'var(--f-body)', fontSize: 10, color: 'var(--mute)', letterSpacing: '1.2px', textTransform: 'uppercase', marginTop: 4 }}>{u}</div>
    </div>
  );
}

function SplitsBars({ splits }: { splits: { mile: number; pace: string | null; hr: number | null; cadence: number | null }[] }) {
  const paces = splits.map((s) => parsePace(s.pace)).filter((p): p is number => p != null);
  if (paces.length === 0) return <div style={{ color: 'var(--mute)', fontSize: 11 }}>(no pace data)</div>;
  const minP = Math.min(...paces);
  const maxP = Math.max(...paces);
  const range = Math.max(60, maxP - minP);

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'end', gap: 2, height: 60, marginTop: 8 }}>
        {splits.map((s) => {
          const p = parsePace(s.pace) ?? maxP;
          // faster = taller. normalize.
          const norm = 1 - Math.min(1, (p - minP) / range);
          return (
            <div key={s.mile} style={{
              flex: 1, height: `${20 + norm * 70}%`,
              background: s.mile === splits.length ? 'var(--goal)' : 'var(--green)',
              borderRadius: '2px 2px 0 0', opacity: 0.85,
            }} />
          );
        })}
      </div>
      <div style={{ display: 'flex', gap: 2, marginTop: 4 }}>
        {splits.map((s) => (
          <div key={s.mile} style={{ flex: 1, textAlign: 'center', fontFamily: 'var(--f-body)', fontSize: 9, color: 'var(--mute)' }}>
            {s.mile}
          </div>
        ))}
      </div>
    </div>
  );
}

function HRZones({ pcts }: { pcts: { z1: number; z2: number; z3: number; z4: number; z5: number } }) {
  const colors = { z1: 'var(--rest)', z2: 'var(--green)', z3: 'var(--goal)', z4: 'var(--over)', z5: 'var(--over)' };
  return (
    <div>
      <div style={{ display: 'flex', height: 10, borderRadius: 5, overflow: 'hidden', marginTop: 8 }}>
        {(['z1','z2','z3','z4','z5'] as const).map((z) => {
          if (pcts[z] <= 0) return null;
          return <div key={z} style={{ flex: pcts[z], background: colors[z] }} />;
        })}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontFamily: 'var(--f-body)', fontSize: 9, color: 'var(--mute)', marginTop: 4, letterSpacing: '0.5px' }}>
        {(['z1','z2','z3','z4','z5'] as const).map((z) => (
          <span key={z}>{z.toUpperCase()} {Math.round(pcts[z])}%</span>
        ))}
      </div>
    </div>
  );
}

function Chip({ k, v, warm, children }: { k?: string; v?: string; warm?: boolean; children?: React.ReactNode }) {
  return (
    <span style={{
      background: warm ? 'rgba(243,173,56,0.08)' : 'rgba(255,255,255,0.04)',
      border: warm ? '1px solid rgba(243,173,56,0.30)' : '1px solid var(--line)',
      borderRadius: 999, padding: '6px 11px', fontSize: 11, color: warm ? 'var(--goal)' : 'var(--ink)',
    }}>
      {k && <span style={{ color: 'var(--mute)', marginRight: 4, fontSize: 9, letterSpacing: '1px', textTransform: 'uppercase' }}>{k}</span>}
      {v && <span style={{ fontWeight: 600 }}>{v}</span>}
      {children}
    </span>
  );
}

// "8:50" → 530 seconds
function parsePace(s: string | null | undefined): number | null {
  if (!s) return null;
  const m = s.match(/^(\d+):(\d{2})$/);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}
