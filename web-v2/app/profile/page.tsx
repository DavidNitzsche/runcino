import { TopNav } from '@/components/layout/TopNav';
import { ProfileGapInput } from '@/components/profile/ProfileGapInput';
import { EditableField } from '@/components/profile/EditableField';
import { AddShoeButton, ShoeEditCard } from '@/components/profile/ShoeCrudUI';
import { loadProfileState, type ProfileState } from '@/lib/coach/profile-state';

export const dynamic = 'force-dynamic';

const DAVID_USER_ID = process.env.DEFAULT_USER_ID ?? '0645f40c-951d-4ccc-b86e-9979cd26c795';

export default async function ProfilePage({ searchParams }: { searchParams: Promise<{ gap?: string }> }) {
  const sp = await searchParams;
  const focusedGap = sp.gap ?? null;
  const profile = await loadProfileState(DAVID_USER_ID);
  const initials = (profile.identity.full_name ?? 'DN').split(/\s+/).map((p) => p[0]).join('').slice(0, 2).toUpperCase();

  return (
    <main>
      <TopNav />
      <div style={{ padding: '40px 40px 80px', maxWidth: 1440, margin: '0 auto' }}>
        {/* IDENTITY */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 24, marginBottom: 36 }}>
          <div style={{
            width: 96, height: 96, borderRadius: '50%',
            background: 'linear-gradient(135deg, var(--learn), var(--race))',
            color: '#1a0f33',
            fontFamily: 'var(--f-display)', fontSize: 42,
            display: 'flex', alignItems: 'center', justifyContent: 'center', letterSpacing: '1px',
          }}>
            {initials}
          </div>
          <div>
            <h1 style={{ fontFamily: 'var(--f-display)', fontSize: 56, lineHeight: 1, margin: 0, letterSpacing: '0.5px' }}>
              {profile.identity.full_name ?? 'Runner'}
            </h1>
            <div style={{ fontFamily: 'var(--f-body)', fontSize: 14, color: 'var(--mute)', letterSpacing: '1.6px', textTransform: 'uppercase', marginTop: 8 }}>
              {profile.identity.sex ?? '—'} · {profile.identity.age ?? '—'} · {profile.identity.city ?? '—'}
            </div>
            {profile.nextARace && (
              <div style={{ fontFamily: 'var(--f-body)', fontSize: 12, color: 'var(--mute)', marginTop: 6 }}>
                Training for{' '}
                <span style={{ color: 'var(--race)', fontWeight: 600 }}>
                  {profile.nextARace.name} · {profile.nextARace.days_to_race} days
                </span>
                {profile.nextARace.goal ? ` · goal ${profile.nextARace.goal}` : ''}
              </div>
            )}
          </div>
        </div>

        {/* PERSONAL — all fields editable inline */}
        <SectionLabel>PERSONAL</SectionLabel>
        <Grid4>
          <FieldCard k="NAME" v={profile.identity.full_name ?? '—'} />
          <EditableField field="sex"  label="Sex"  kind="select" options={['Male','Female','Other']} currentValue={profile.identity.sex} />
          <EditableField field="age"  label="Age"  kind="number" currentValue={profile.identity.age} />
          {profile.identity.height_cm != null
            ? <EditableField field="height_cm" label="Height" kind="number" currentValue={profile.identity.height_cm} unitLabel="cm" />
            : <ProfileGapInput field="height_cm" label="Height" why="Unlocks cadence target" focused={focusedGap === 'height_cm'} />
          }
        </Grid4>

        {/* City editable on its own row so it has room */}
        <div style={{ marginTop: 14 }}>
          <EditableField field="city" label="City" kind="text" currentValue={profile.identity.city} />
        </div>

        {/* PHYSIOLOGY DERIVED */}
        <SectionLabel>PHYSIOLOGY · DERIVED</SectionLabel>
        <Grid5>
          <FieldCard k="MAX HR"     v={profile.physiology.max_hr != null ? `${profile.physiology.max_hr} bpm` : '—'} hint={profile.physiology.max_hr ? 'OBSERVED' : 'PENDING'} />
          <FieldCard k="RESTING HR" v={profile.physiology.rhr != null ? `${profile.physiology.rhr} bpm` : '—'}   hint={profile.physiology.rhr ? '60-DAY MEAN' : 'PENDING'} />
          <FieldCard k="VO2 MAX"    v={profile.physiology.vo2 != null ? profile.physiology.vo2.toFixed(1) : '—'}  hint={profile.physiology.vo2 ? 'APPLE WATCH' : 'PENDING'} />
          <FieldCard k="VDOT"       v="—" hint="FROM RACE PBS (P4.b)" />
          <FieldCard k="WEIGHT"     v={profile.physiology.weight_lb != null ? `${profile.physiology.weight_lb} lb` : '—'} hint={profile.physiology.weight_lb ? 'APPLE HEALTH' : 'PENDING'} />
        </Grid5>

        {/* CONNECTIONS — wires in P6 */}
        <SectionLabel>CONNECTIONS</SectionLabel>
        <Grid3>
          <ConnCard name="Strava" sub="Auto-sync via OAuth" connected />
          <ConnCard name="Apple Health" sub="Sleep / HRV / RHR / weight / VO2" connected />
          <ConnCard name="Apple Watch" sub="Paired via WatchConnectivity" connected />
        </Grid3>

        {/* PREFERENCES — stub for P6 */}
        <SectionLabel>PREFERENCES</SectionLabel>
        <Grid4>
          <FieldCard k="LONG RUN DAY" v="Sunday" />
          <FieldCard k="QUALITY DAYS" v="Tue · Thu" />
          <FieldCard k="UNITS"        v="Miles · °F" />
          <FieldCard k="REST DAY"     v="Saturday" />
        </Grid4>

        {/* SHOES — click any to edit, retire, log */}
        <SectionLabel>SHOE ROTATION · {profile.shoes.length} ACTIVE</SectionLabel>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 12 }}>
          {profile.shoes.map((s) => <ShoeEditCard key={s.id} shoe={s} />)}
        </div>
        <div style={{ marginTop: 12 }}>
          <AddShoeButton />
        </div>
        <div style={{ fontFamily: 'var(--f-body)', fontSize: 12, color: 'var(--mute)', marginTop: 14, lineHeight: 1.55 }}>
          Click any shoe to edit mileage or retire. Coach only chimes in here when there's a real flag.
        </div>
      </div>
    </main>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <div style={{ fontFamily: 'var(--f-body)', fontSize: 11, fontWeight: 700, color: 'var(--mute)', letterSpacing: '1.6px', textTransform: 'uppercase', margin: '24px 0 12px' }}>{children}</div>;
}
function Grid3({ children }: { children: React.ReactNode }) { return <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14 }}>{children}</div>; }
function Grid4({ children }: { children: React.ReactNode }) { return <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14 }}>{children}</div>; }
function Grid5({ children }: { children: React.ReactNode }) { return <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 14 }}>{children}</div>; }

function FieldCard({ k, v, hint }: { k: string; v: string; hint?: string }) {
  return (
    <div className="card" style={{ padding: '14px 16px' }}>
      <div style={{ fontFamily: 'var(--f-body)', fontSize: 9, color: 'var(--mute)', letterSpacing: '1.4px', textTransform: 'uppercase', marginBottom: 6 }}>{k}</div>
      <div style={{ fontFamily: 'var(--f-display)', fontSize: 20, color: 'var(--ink)' }}>{v}</div>
      {hint && <div style={{ fontFamily: 'var(--f-body)', fontSize: 9, color: 'var(--green)', marginTop: 4, letterSpacing: '1px' }}>{hint}</div>}
    </div>
  );
}

function ConnCard({ name, sub, connected }: { name: string; sub: string; connected: boolean }) {
  return (
    <div className="card" style={{ padding: '14px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
      <div>
        <div style={{ fontFamily: 'var(--f-display)', fontSize: 18 }}>{name}</div>
        <div style={{ fontSize: 10, color: 'var(--mute)', marginTop: 2 }}>{sub}</div>
      </div>
      <span style={{ color: connected ? 'var(--green)' : 'var(--mute)', fontSize: 11, letterSpacing: '1px' }}>
        ● {connected ? 'CONNECTED' : 'NOT CONNECTED'}
      </span>
    </div>
  );
}
