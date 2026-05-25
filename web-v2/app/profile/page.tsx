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

        {/* PERSONAL — birthday auto-updates age */}
        <SectionLabel>PERSONAL</SectionLabel>
        <Grid4>
          <FieldCard k="NAME" v={profile.identity.full_name ?? '—'} />
          <EditableField field="sex"  label="Sex"  kind="select" options={['Male','Female','Other']} currentValue={profile.identity.sex} />
          <EditableField
            field="birthday" label="Birthday" kind="text"
            currentValue={profile.identity.birthday}
            unitLabel={profile.identity.age != null ? `(age ${profile.identity.age})` : ''}
          />
          {profile.identity.height_cm != null
            ? <EditableField field="height_cm" label="Height" kind="number" currentValue={profile.identity.height_cm} unitLabel="cm" />
            : <ProfileGapInput field="height_cm" label="Height" why="Unlocks cadence target" focused={focusedGap === 'height_cm'} />
          }
        </Grid4>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginTop: 14 }}>
          <EditableField field="city" label="City" kind="text" currentValue={profile.identity.city} />
          <EditableField
            field="experience_level" label="Experience" kind="select"
            options={['beginner','intermediate','advanced','advanced_plus']}
            currentValue={profile.identity.experience_level}
          />
        </div>

        {/* PHYSIOLOGY — LTHR is primary zone anchor (Friel). MAX HR editable too. */}
        <SectionLabel>PHYSIOLOGY · TRAINING ANCHORS</SectionLabel>
        <Grid4>
          <EditableField
            field="lthr" label="LTHR" kind="number"
            currentValue={profile.physiology.lthr} unitLabel="bpm"
          />
          <EditableField
            field="hrmax_observed" label="Max HR" kind="number"
            currentValue={profile.physiology.max_hr} unitLabel="bpm"
          />
          <FieldCard k="RESTING HR" v={profile.physiology.rhr != null ? `${profile.physiology.rhr} bpm` : '—'} hint={profile.physiology.rhr ? '60-DAY MEAN' : 'PENDING'} />
          <FieldCard k="VDOT" v={profile.physiology.vdot != null ? String(profile.physiology.vdot) : '—'} hint={profile.physiology.vdot != null ? 'FROM RACE PB' : 'NEEDS A RACE FINISH'} />
        </Grid4>

        {/* Live zone table — recomputes from LTHR/MaxHR every render */}
        {profile.physiology.zones && (
          <div className="card" style={{ marginTop: 14, padding: '18px 22px' }}>
            <div className="card-eyebrow" style={{ color: 'var(--green)' }}>
              HR ZONES · {profile.physiology.zones.method === 'lthr-friel' ? 'LTHR-ANCHORED (FRIEL)' : '%MHR FALLBACK'}
              {' · '}{profile.physiology.zones.anchor.label} {profile.physiology.zones.anchor.bpm}
            </div>
            <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 10, fontFamily: 'var(--f-body)', fontSize: 13 }}>
              <tbody>
                {profile.physiology.zones.zones.map((z) => (
                  <tr key={z.idx} style={{ borderBottom: '1px solid var(--line-2)' }}>
                    <td style={{ padding: '8px 10px', fontFamily: 'var(--f-display)', fontSize: 13, color: 'var(--green)', letterSpacing: '0.5px', width: 50 }}>{z.shortLabel}</td>
                    <td style={{ padding: '8px 10px', fontFamily: 'var(--f-display)', fontSize: 14, color: 'var(--ink)', width: 130 }}>{z.label}</td>
                    <td style={{ padding: '8px 10px', fontFamily: 'var(--f-body)', fontSize: 13, color: 'var(--ink)', width: 130 }}>{z.lower}–{z.upper} bpm</td>
                    <td style={{ padding: '8px 10px', fontSize: 11.5, color: 'var(--mute)', lineHeight: 1.45 }}>{z.purpose}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div style={{ fontSize: 11, color: 'var(--mute)', marginTop: 10, lineHeight: 1.5 }}>
              {profile.physiology.lthr_method ? `LTHR source: ${profile.physiology.lthr_method}. ` : ''}
              Re-test LTHR every 6-12 weeks. Cite: <a href="/learn/heart-rate-zones" style={{ color: 'var(--learn)' }}>Research/03 §6</a>.
            </div>
          </div>
        )}

        {/* PHYSIOLOGY · MEASURED */}
        <SectionLabel>PHYSIOLOGY · MEASURED</SectionLabel>
        <Grid4>
          <FieldCard k="VO2 MAX"    v={profile.physiology.vo2 != null ? profile.physiology.vo2.toFixed(1) : '—'}  hint={profile.physiology.vo2 ? 'APPLE WATCH' : 'PENDING'} />
          <FieldCard k="WEIGHT"     v={profile.physiology.weight_lb != null ? `${profile.physiology.weight_lb} lb` : '—'} hint={profile.physiology.weight_lb ? 'APPLE HEALTH' : 'PENDING'} />
        </Grid4>

        {/* CONNECTIONS — real data-presence check */}
        <SectionLabel>CONNECTIONS</SectionLabel>
        <Grid3>
          <ConnCard name="Strava"       sub={profile.connections.strava.note}      connected={profile.connections.strava.connected} />
          <ConnCard name="Apple Health" sub={profile.connections.appleHealth.note} connected={profile.connections.appleHealth.connected} />
          <ConnCard name="Apple Watch"  sub={profile.connections.appleWatch.note}  connected={profile.connections.appleWatch.connected} />
        </Grid3>

        {/* PREFERENCES — from user_settings (edit on /settings) */}
        <SectionLabel>PREFERENCES · <a href="/settings" style={{ color: 'var(--learn)', textDecoration: 'none', letterSpacing: '1.4px' }}>EDIT →</a></SectionLabel>
        <Grid4>
          <FieldCard k="LONG RUN DAY" v={dayLabel(profile.preferences.long_run_day)} />
          <FieldCard k="QUALITY DAYS" v={profile.preferences.quality_days.map(dayShort).join(' · ') || '—'} />
          <FieldCard k="UNITS"        v={`${profile.preferences.units_distance === 'mi' ? 'Miles' : 'Km'} · °${profile.preferences.units_temp}`} />
          <FieldCard k="REST DAY"     v={dayLabel(profile.preferences.rest_day)} />
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

const DAY_NAMES: Record<string, [string, string]> = {
  sun: ['Sunday', 'Sun'], mon: ['Monday', 'Mon'], tue: ['Tuesday', 'Tue'],
  wed: ['Wednesday', 'Wed'], thu: ['Thursday', 'Thu'], fri: ['Friday', 'Fri'], sat: ['Saturday', 'Sat'],
};
function dayLabel(d: string): string { return DAY_NAMES[d]?.[0] ?? d; }
function dayShort(d: string): string { return DAY_NAMES[d]?.[1] ?? d; }

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
