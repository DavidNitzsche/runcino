import { TopNav } from '@/components/layout/TopNav';
import { ProfileGapInput } from '@/components/profile/ProfileGapInput';
import { EditableField } from '@/components/profile/EditableField';
import { AddShoeButton, ShoeEditCard } from '@/components/profile/ShoeCrudUI';
import { SettingsLinkTrigger } from '@/components/settings/SettingsModal';
import { StravaConnectionCard } from '@/components/profile/StravaConnectionCard';
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
        <div style={{ display: 'flex', alignItems: 'center', gap: 28, marginBottom: 44 }}>
          <div style={{
            width: 120, height: 120, borderRadius: '50%',
            background: 'linear-gradient(135deg, var(--learn), var(--race))',
            color: '#1a0f33',
            fontFamily: 'var(--f-display)', fontSize: 52,
            display: 'flex', alignItems: 'center', justifyContent: 'center', letterSpacing: '1px',
            flexShrink: 0,
          }}>
            {initials}
          </div>
          <div>
            <h1 style={{ fontFamily: 'var(--f-display)', fontSize: 72, lineHeight: 0.95, margin: 0, letterSpacing: '0.5px' }}>
              {profile.identity.full_name ?? 'Runner'}
            </h1>
            <div style={{ fontFamily: 'var(--f-body)', fontSize: 15, color: 'rgba(246,247,248,0.60)', letterSpacing: '1.6px', textTransform: 'uppercase', marginTop: 12, fontWeight: 600 }}>
              {profile.identity.sex ?? '—'} · {profile.identity.age ?? '—'} · {profile.identity.city ?? '—'}
            </div>
            {profile.nextARace && (
              <div style={{ fontFamily: 'var(--f-body)', fontSize: 14, color: 'var(--mute)', marginTop: 10 }}>
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
          <EditableField field="sex"  label="Gender"  kind="select" options={['Male','Female']} currentValue={profile.identity.sex} />
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
            field="experience_level"
            label="Experience"
            kind="richSelect"
            currentValue={profile.identity.experience_level}
            displayMap={{
              beginner: 'Beginner',
              intermediate: 'Intermediate',
              advanced: 'Advanced',
              advanced_plus: 'Sub-elite',
            }}
            contextLine="Sets your plan's volume ceiling, intensity ramp, and how aggressively the coach progresses you week-to-week."
            richOptions={[
              {
                value: 'beginner',
                label: 'BEGINNER',
                description: '0–2 years consistent running. Conservative 5–8%/wk volume progression. Quality work introduced gradually.',
              },
              {
                value: 'intermediate',
                label: 'INTERMEDIATE',
                description: '2–5 years. Standard Daniels ramp (10% rule). One quality session per week building to two.',
              },
              {
                value: 'advanced',
                label: 'ADVANCED',
                description: '5+ years with race history. Higher quality tolerance, faster ramp, 2–3 quality sessions/wk in peak.',
              },
              {
                value: 'advanced_plus',
                label: 'SUB-ELITE',
                description: 'Competitive runner, sub-3 marathon / sub-1:25 half. Aggressive volume + intensity blocks.',
              },
            ]}
          />
        </div>

        {/* PHYSIOLOGY — LTHR is primary zone anchor (Friel). MAX HR editable too.
         * #158: each card now carries source + freshness + used-for so the runner
         * understands how each number is picked and what it drives. */}
        <SectionLabel>PHYSIOLOGY · TRAINING ANCHORS</SectionLabel>
        <Grid4>
          <AnchorCard
            label="LTHR"
            value={profile.physiology.lthr != null ? `${profile.physiology.lthr} bpm` : '—'}
            source="Auto-calibrated from your threshold workouts — override if you've LT-tested"
            usedFor="HR zones (Z1–Z5 from Friel)"
            editable={
              <EditableField
                field="lthr" label="LTHR" kind="number"
                currentValue={profile.physiology.lthr} unitLabel="bpm"
                hint="Drives all HR zone bands"
              />
            }
          />
          <AnchorCard
            label="Max HR"
            value={profile.physiology.max_hr != null ? `${profile.physiology.max_hr} bpm` : '—'}
            source="Set by you (or estimated from age — rough)"
            usedFor="HR zone ceiling (Z5 cap), age-grade fallback"
            editable={
              <EditableField
                field="hrmax_observed" label="Max HR" kind="number"
                currentValue={profile.physiology.max_hr} unitLabel="bpm"
                hint="Sets the Z5 ceiling"
              />
            }
          />
          <AnchorCard
            label="RESTING HR"
            value={profile.physiology.rhr != null ? `${profile.physiology.rhr} bpm` : '—'}
            source={profile.physiology.rhr ? '60-day mean from your watch' : 'Pending — needs 60 days of wear'}
            usedFor="Readiness baseline (RHR deviation flags fatigue)"
          />
          <AnchorCard
            label="VDOT"
            value={profile.physiology.vdot != null ? String(profile.physiology.vdot) : '—'}
            source={profile.physiology.vdot != null
              ? 'Best race performance in last 6 months (auto-updated)'
              : 'Needs a race finish to compute'}
            usedFor="Pace zones (E/M/T/I/R), race-pace prediction"
          />
        </Grid4>

        {/* Live zone table — recomputes from LTHR/MaxHR every render */}
        {profile.physiology.zones && (
          <div className="card" style={{ marginTop: 14, padding: '22px 26px' }}>
            <div className="card-eyebrow" style={{ color: 'var(--green)', fontSize: 12 }}>
              HR ZONES · {profile.physiology.zones.method === 'lthr-friel' ? 'LTHR-ANCHORED (FRIEL)' : '%MHR FALLBACK'}
              {' · '}{profile.physiology.zones.anchor.label} {profile.physiology.zones.anchor.bpm}
            </div>
            <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 12, fontFamily: 'var(--f-body)', fontSize: 14 }}>
              <tbody>
                {profile.physiology.zones.zones.map((z) => (
                  <tr key={z.idx} style={{ borderBottom: '1px solid var(--line-2)' }}>
                    <td style={{ padding: '12px 12px', fontFamily: 'var(--f-label)', fontSize: 15, color: 'var(--green)', letterSpacing: '0.5px', width: 60 }}>{z.shortLabel}</td>
                    <td style={{ padding: '12px 12px', fontFamily: 'var(--f-label)', fontSize: 16, color: 'var(--ink)', width: 150 }}>{z.label}</td>
                    <td style={{ padding: '12px 12px', fontFamily: 'var(--f-body)', fontSize: 14, color: 'var(--ink)', width: 150, fontWeight: 600 }}>
                      {z.idx === 1 ? `< ${z.upper} bpm`
                        : z.idx === 5 ? `> ${z.lower} bpm`
                        : `${z.lower}–${z.upper} bpm`}
                    </td>
                    <td style={{ padding: '12px 12px', fontSize: 13, color: 'rgba(246,247,248,0.72)', lineHeight: 1.5 }}>{z.purpose}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div style={{ fontSize: 12.5, color: 'var(--mute)', marginTop: 14, lineHeight: 1.55 }}>
              {profile.physiology.lthr_method ? `LTHR source: ${profile.physiology.lthr_method}. ` : ''}
              Re-test LTHR every 6-12 weeks for the most accurate zones.
            </div>
          </div>
        )}

        {/* PHYSIOLOGY · MEASURED */}
        <SectionLabel>PHYSIOLOGY · MEASURED</SectionLabel>
        <Grid4>
          <FieldCard k="VO2 MAX"    v={profile.physiology.vo2 != null ? profile.physiology.vo2.toFixed(1) : '—'}  hint={profile.physiology.vo2 ? 'APPLE WATCH' : 'PENDING'} />
          <FieldCard k="WEIGHT"     v={profile.physiology.weight_lb != null ? `${profile.physiology.weight_lb} lb` : '—'} hint={profile.physiology.weight_lb ? 'APPLE HEALTH' : 'PENDING'} />
        </Grid4>

        {/* CONNECTIONS — real data-presence check. Strava gets the rich
         * StravaConnectionCard (#161) with auto-push toggle + privacy +
         * title format + recent-pushes widget. */}
        <SectionLabel>CONNECTIONS</SectionLabel>
        <div style={{ marginBottom: 14 }}>
          <StravaConnectionCard initial={{
            connected: profile.connections.strava.connected,
            lastSyncAgo: profile.connections.strava.note.replace(/^Last sync /, ''),
          }} />
        </div>
        <Grid3>
          <ConnCard name="Apple Health" sub={profile.connections.appleHealth.note} connected={profile.connections.appleHealth.connected} />
          <ConnCard name="Apple Watch"  sub={profile.connections.appleWatch.note}  connected={profile.connections.appleWatch.connected} />
        </Grid3>

        {/* PREFERENCES — from user_settings (edit via settings modal) */}
        <SectionLabel>PREFERENCES · <SettingsLinkTrigger>EDIT →</SettingsLinkTrigger></SectionLabel>
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
  return <div style={{ fontFamily: 'var(--f-body)', fontSize: 13, fontWeight: 700, color: 'rgba(246,247,248,0.65)', letterSpacing: '1.6px', textTransform: 'uppercase', margin: '36px 0 14px' }}>{children}</div>;
}
function Grid3({ children }: { children: React.ReactNode }) { return <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14 }}>{children}</div>; }
function Grid4({ children }: { children: React.ReactNode }) { return <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14 }}>{children}</div>; }
function Grid5({ children }: { children: React.ReactNode }) { return <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 14 }}>{children}</div>; }

function FieldCard({ k, v, hint }: { k: string; v: string; hint?: string }) {
  return (
    <div className="card" style={{ padding: '18px 22px' }}>
      <div style={{ fontFamily: 'var(--f-label)', fontSize: 11, color: 'var(--mute)', letterSpacing: '1.4px', textTransform: 'uppercase', marginBottom: 8, fontWeight: 700 }}>{k}</div>
      <div style={{ fontFamily: 'var(--f-display)', fontSize: 28, color: 'var(--ink)', letterSpacing: '0.5px', lineHeight: 1.1 }}>{v}</div>
      {hint && <div style={{ fontFamily: 'var(--f-label)', fontSize: 11, color: 'var(--green)', marginTop: 6, letterSpacing: '1px' }}>{hint}</div>}
    </div>
  );
}

/**
 * AnchorCard (#158) — training anchor with source + freshness + used-for.
 * Used for the four PHYSIOLOGY · TRAINING ANCHORS cards (LTHR, MAX HR,
 * RESTING HR, VDOT). Answers the runner's question "how is this picked
 * and what does it change?"
 */
function AnchorCard({
  label, value, source, freshness, usedFor, editable,
}: {
  label: string;
  value: string;
  source: string;     // "Auto-calibrated from your threshold workouts" / "Set by you"
  freshness?: string; // "Last updated 8 days ago" — null for always-fresh stats like VDOT-from-race
  usedFor: string;    // "HR zones (Z1–Z5 from Friel)"
  editable?: React.ReactNode; // optional <EditableField/> for fields the user can manually override
}) {
  if (editable) return <>{editable}</>;
  return (
    <div className="card" style={{ padding: '18px 22px' }}>
      <div style={{ fontFamily: 'var(--f-label)', fontSize: 11, color: 'var(--mute)', letterSpacing: '1.4px', textTransform: 'uppercase', marginBottom: 8, fontWeight: 700 }}>
        {label}
      </div>
      <div style={{ fontFamily: 'var(--f-display)', fontSize: 28, color: 'var(--ink)', letterSpacing: '0.5px', lineHeight: 1.1 }}>
        {value}
      </div>
      <div style={{
        fontFamily: 'var(--f-body)', fontSize: 11, lineHeight: 1.5,
        color: 'var(--mute)', marginTop: 8,
      }}>
        {source}{freshness ? ` · ${freshness}` : ''}
      </div>
      <div style={{
        fontFamily: 'var(--f-body)', fontSize: 10, color: 'var(--dim)',
        marginTop: 4, letterSpacing: '0.4px',
      }}>
        Used for {usedFor}
      </div>
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
    <div className="card" style={{ padding: '18px 22px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
      <div>
        <div style={{ fontFamily: 'var(--f-display)', fontSize: 22, color: 'var(--ink)', letterSpacing: '0.3px' }}>{name}</div>
        <div style={{ fontSize: 12, color: 'var(--mute)', marginTop: 4 }}>{sub}</div>
      </div>
      <span style={{ color: connected ? 'var(--green)' : 'var(--mute)', fontSize: 12, letterSpacing: '1.2px', fontWeight: 600 }}>
        ● {connected ? 'CONNECTED' : 'NOT CONNECTED'}
      </span>
    </div>
  );
}
