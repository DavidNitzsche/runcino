/**
 * /me · the runner + settings tab (paper-overhaul 2026-05-29).
 *
 * Third tab of the 3-tab structure (TODAY / PLAN / ME). This is where the
 * runner and everything they configure lives — identity, the physiology
 * anchors that drive every zone + pace, connections, notifications,
 * preferences, shoe rotation — plus the doors to the data views (LOG · the
 * full run history; HEALTH · the body-signal detail) that were demoted
 * from the top nav.
 *
 * Shell matches /today + /plan (TopNav + bare main + 1040 column). Reuses
 * the existing interactive profile components (EditableField, the Strava
 * card, NotificationSettings, shoe CRUD) — only the presentational chrome
 * is re-cut in the paper spec-sheet language (no hardcoded dark-theme
 * greys; everything is token-driven so the skin swap stays clean).
 *
 * Cardinal Rule #1 · facts only. Cardinal Rule (prohibited) · Claude never
 * changes security/permissions or account settings here — these inputs are
 * the user's own profile fields, edited by the user in their own session.
 */
import Link from 'next/link';
import { EditableField } from '@/components/profile/EditableField';
import { ProfileGapInput } from '@/components/profile/ProfileGapInput';
import { AddShoeButton, ShoeEditCard } from '@/components/profile/ShoeCrudUI';
import { SettingsLinkTrigger } from '@/components/settings/SettingsModal';
import { StravaConnectionCard } from '@/components/profile/StravaConnectionCard';
import { NotificationSettings } from '@/components/profile/NotificationSettings';
import { TopNav } from '@/components/layout/TopNav';
import { SpecLabel, Stamp } from '@/components/faff/graphic';
import { loadProfileState } from '@/lib/coach/profile-state';
import { loadStravaConnectionStatus } from '@/lib/strava/connection-status';

export const dynamic = 'force-dynamic';

const DAVID_USER_ID = process.env.DEFAULT_USER_ID ?? '0645f40c-951d-4ccc-b86e-9979cd26c795';

export default async function MePage({ searchParams }: { searchParams: Promise<{ gap?: string }> }) {
  const sp = await searchParams;
  const focusedGap = sp.gap ?? null;
  const profile = await loadProfileState(DAVID_USER_ID);
  const stravaConnState = await loadStravaConnectionStatus(DAVID_USER_ID)
    .then((s) => s.state)
    .catch(() => undefined);

  const initials = (profile.identity.full_name ?? 'DN')
    .split(/\s+/)
    .map((p) => p[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

  const metaParts = [
    profile.identity.sex ?? null,
    profile.identity.age != null ? `${profile.identity.age} YRS` : null,
    profile.identity.city ?? null,
  ].filter(Boolean) as string[];

  return (
    <main style={{ minHeight: '100vh', paddingBottom: 80 }}>
      <TopNav />
      <div
        style={{
          maxWidth: 1040,
          margin: '0 auto',
          padding: '28px 24px 0',
          display: 'flex',
          flexDirection: 'column',
          gap: 26,
        }}
      >
        {/* ── IDENTITY HEADER ── */}
        <header
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 18,
            paddingBottom: 24,
            borderBottom: '1px solid var(--line)',
          }}
        >
          <div
            aria-hidden
            style={{
              width: 76,
              height: 76,
              borderRadius: '50%',
              background: 'linear-gradient(135deg, var(--learn), var(--race))',
              color: '#fff',
              fontFamily: 'var(--f-display)',
              fontWeight: 700,
              fontSize: 32,
              letterSpacing: '0.5px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            {initials}
          </div>
          <div style={{ minWidth: 0, flex: 1 }}>
            <h1
              style={{
                margin: 0,
                fontFamily: 'var(--f-display)',
                fontWeight: 700,
                fontSize: 'clamp(28px, 5vw, 44px)',
                lineHeight: 0.92,
                letterSpacing: '-0.015em',
                color: 'var(--ink)',
                textTransform: 'uppercase',
              }}
            >
              {profile.identity.full_name ?? 'YOUR PROFILE'}
            </h1>
            {metaParts.length > 0 && (
              <div style={{ marginTop: 8 }}>
                <SpecLabel>{metaParts.join('  ·  ')}</SpecLabel>
              </div>
            )}
            {profile.nextARace && (
              <div style={{ marginTop: 10, display: 'inline-flex' }}>
                <Stamp tone="race">
                  TRAINING FOR {profile.nextARace.name} · {profile.nextARace.days_to_race}D
                  {profile.nextARace.goal ? ` · ${profile.nextARace.goal}` : ''}
                </Stamp>
              </div>
            )}
          </div>
        </header>

        {/* ── PERSONAL ── */}
        <Section label="PERSONAL">
          <Grid min={200}>
            <EditableField field="sex" label="Gender" kind="select" options={['Male', 'Female']} currentValue={profile.identity.sex} />
            <EditableField
              field="birthday"
              label="Birthday"
              kind="text"
              currentValue={profile.identity.birthday}
              displayValue={formatBirthday(profile.identity.birthday)}
              unitLabel={profile.identity.age != null ? `(age ${profile.identity.age})` : ''}
            />
            {profile.identity.height_cm != null ? (
              <EditableField
                field="height_cm"
                label="Height"
                kind="number"
                currentValue={profile.identity.height_cm}
                displayValue={formatHeightFtIn(profile.identity.height_cm)}
              />
            ) : (
              <ProfileGapInput field="height_cm" label="Height" why="Unlocks cadence target" focused={focusedGap === 'height_cm'} />
            )}
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
                { value: 'beginner', label: 'BEGINNER', description: '0–2 years consistent running. Conservative 5–8%/wk volume progression. Quality work introduced gradually.' },
                { value: 'intermediate', label: 'INTERMEDIATE', description: '2–5 years. Standard Daniels ramp (10% rule). One quality session per week building to two.' },
                { value: 'advanced', label: 'ADVANCED', description: '5+ years with race history. Higher quality tolerance, faster ramp, 2–3 quality sessions/wk in peak.' },
                { value: 'advanced_plus', label: 'SUB-ELITE', description: 'Competitive runner, sub-3 marathon / sub-1:25 half. Aggressive volume + intensity blocks.' },
              ]}
            />
          </Grid>
        </Section>

        {/* ── PHYSIOLOGY · TRAINING ANCHORS ── */}
        <Section label="PHYSIOLOGY · TRAINING ANCHORS">
          <Grid min={200}>
            <EditableField field="lthr" label="LTHR" kind="number" currentValue={profile.physiology.lthr} unitLabel="bpm" hint="Drives all HR zone bands" />
            <EditableField field="hrmax_observed" label="Max HR" kind="number" currentValue={profile.physiology.max_hr} unitLabel="bpm" hint="Sets the Z5 ceiling" />
            <AnchorCard
              label="RESTING HR"
              value={profile.physiology.rhr != null ? `${profile.physiology.rhr} bpm` : '—'}
              note={profile.physiology.rhr ? '60-day mean from your watch' : 'Pending — needs 60 days of wear'}
              usedFor="Readiness baseline"
            />
            <AnchorCard
              label="VDOT"
              value={profile.physiology.vdot != null ? String(profile.physiology.vdot) : '—'}
              note={profile.physiology.vdot != null ? 'Best race in last 6 months (auto)' : 'Needs a race finish to compute'}
              usedFor="Pace zones · race prediction"
            />
          </Grid>

          {profile.physiology.zones && (
            <div
              style={{
                marginTop: 16,
                borderTop: '1px solid var(--line)',
                paddingTop: 16,
              }}
            >
              <SpecLabel>
                HR ZONES · {profile.physiology.zones.method === 'lthr-friel' ? 'LTHR-ANCHORED (FRIEL)' : '%MHR FALLBACK'} ·{' '}
                {profile.physiology.zones.anchor.label} {profile.physiology.zones.anchor.bpm}
              </SpecLabel>
              <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 12, fontFamily: 'var(--f-body)', fontSize: 13 }}>
                <tbody>
                  {profile.physiology.zones.zones.map((z) => (
                    <tr key={z.idx} style={{ borderBottom: '1px solid var(--line-2)' }}>
                      <td style={{ padding: '10px 10px', fontFamily: 'var(--f-label)', fontSize: 13, fontWeight: 700, letterSpacing: '0.5px', color: 'var(--green)', width: 52 }}>{z.shortLabel}</td>
                      <td style={{ padding: '10px 10px', fontFamily: 'var(--f-label)', fontSize: 14, color: 'var(--ink)', width: 140 }}>{z.label}</td>
                      <td className="tabular" style={{ padding: '10px 10px', fontFamily: 'var(--f-body)', fontSize: 13, color: 'var(--ink)', width: 130, fontWeight: 600 }}>
                        {z.idx === 1 ? `< ${z.upper} bpm` : z.idx === 5 ? `> ${z.lower} bpm` : `${z.lower}–${z.upper} bpm`}
                      </td>
                      <td style={{ padding: '10px 10px', fontSize: 12, color: 'var(--mute)', lineHeight: 1.5 }}>{z.purpose}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div style={{ fontFamily: 'var(--f-body)', fontSize: 12, color: 'var(--mute)', marginTop: 12, lineHeight: 1.5 }}>
                {profile.physiology.lthr_method ? `LTHR source: ${profile.physiology.lthr_method}. ` : ''}
                Re-test LTHR every 6–12 weeks for the most accurate zones.
              </div>
            </div>
          )}
        </Section>

        {/* ── PHYSIOLOGY · MEASURED ── */}
        <Section label="PHYSIOLOGY · MEASURED">
          <Grid min={200}>
            <FieldCard k="VO2 MAX" v={profile.physiology.vo2 != null ? profile.physiology.vo2.toFixed(1) : '—'} hint={profile.physiology.vo2 ? 'APPLE WATCH' : 'PENDING'} />
            <FieldCard k="WEIGHT" v={profile.physiology.weight_lb != null ? `${profile.physiology.weight_lb} lb` : '—'} hint={profile.physiology.weight_lb ? 'APPLE HEALTH' : 'PENDING'} />
          </Grid>
        </Section>

        {/* ── CONNECTIONS ── */}
        <Section label="CONNECTIONS">
          <div style={{ marginBottom: 12 }}>
            <StravaConnectionCard
              initial={{
                connected: profile.connections.strava.connected,
                lastSyncAgo: profile.connections.strava.note.replace(/^Last sync /, ''),
                state: stravaConnState,
              }}
            />
          </div>
          <Grid min={240}>
            <ConnCard name="Apple Health" sub={profile.connections.appleHealth.note} connected={profile.connections.appleHealth.connected} />
            <ConnCard name="Apple Watch" sub={profile.connections.appleWatch.note} connected={profile.connections.appleWatch.connected} />
          </Grid>
        </Section>

        {/* ── NOTIFICATIONS ── */}
        <Section label="NOTIFICATIONS">
          <NotificationSettings />
        </Section>

        {/* ── PREFERENCES ── */}
        <Section label={<>PREFERENCES · <SettingsLinkTrigger>EDIT →</SettingsLinkTrigger></>}>
          <Grid min={200}>
            <FieldCard k="LONG RUN DAY" v={dayLabel(profile.preferences.long_run_day)} />
            <FieldCard k="QUALITY DAYS" v={profile.preferences.quality_days.map(dayShort).join(' · ') || '—'} />
            <FieldCard k="UNITS" v={`${profile.preferences.units_distance === 'mi' ? 'Miles' : 'Km'} · °${profile.preferences.units_temp}`} />
            <FieldCard k="REST DAY" v={dayLabel(profile.preferences.rest_day)} />
          </Grid>
        </Section>

        {/* ── SHOE ROTATION ── */}
        <Section label={`SHOE ROTATION · ${profile.shoes.length} ACTIVE`}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 12 }}>
            {profile.shoes.map((s) => (
              <ShoeEditCard key={s.id} shoe={s} />
            ))}
          </div>
          <div style={{ marginTop: 12 }}>
            <AddShoeButton />
          </div>
        </Section>

        {/* ── YOUR DATA · the demoted data views, still one tap away ── */}
        <Section label="YOUR DATA">
          <Grid min={240}>
            <DataLink href="/log" title="LOG" sub="Full run history · filter by type, phase, shoe" />
            <DataLink href="/health" title="HEALTH" sub="Body signals in detail · sleep, RHR, HRV, load" />
          </Grid>
        </Section>
      </div>
    </main>
  );
}

// ── presentational helpers · paper spec-sheet, all token-driven ──

function Section({ label, children }: { label: React.ReactNode; children: React.ReactNode }) {
  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ fontFamily: 'var(--f-label)', fontSize: 11, fontWeight: 700, letterSpacing: '1.6px', textTransform: 'uppercase', color: 'var(--mute)' }}>
        {label}
      </div>
      {children}
    </section>
  );
}

function Grid({ children, min }: { children: React.ReactNode; min: number }) {
  return <div style={{ display: 'grid', gridTemplateColumns: `repeat(auto-fill, minmax(${min}px, 1fr))`, gap: 12 }}>{children}</div>;
}

function FieldCard({ k, v, hint }: { k: string; v: string; hint?: string }) {
  return (
    <div style={{ borderTop: '1px solid var(--line)', padding: '13px 0 4px' }}>
      <div style={{ fontFamily: 'var(--f-label)', fontSize: 10.5, fontWeight: 700, letterSpacing: '1.4px', textTransform: 'uppercase', color: 'var(--mute)', marginBottom: 8 }}>{k}</div>
      <div style={{ fontFamily: 'var(--f-display)', fontWeight: 700, fontSize: 26, letterSpacing: '-0.01em', color: 'var(--ink)', lineHeight: 1.05 }}>{v}</div>
      {hint && <div style={{ fontFamily: 'var(--f-label)', fontSize: 9.5, fontWeight: 700, letterSpacing: '1px', color: 'var(--green)', marginTop: 6 }}>{hint}</div>}
    </div>
  );
}

function AnchorCard({ label, value, note, usedFor }: { label: string; value: string; note: string; usedFor: string }) {
  return (
    <div style={{ borderTop: '1px solid var(--line)', padding: '13px 0 4px' }}>
      <div style={{ fontFamily: 'var(--f-label)', fontSize: 10.5, fontWeight: 700, letterSpacing: '1.4px', textTransform: 'uppercase', color: 'var(--mute)', marginBottom: 8 }}>{label}</div>
      <div style={{ fontFamily: 'var(--f-display)', fontWeight: 700, fontSize: 26, letterSpacing: '-0.01em', color: 'var(--ink)', lineHeight: 1.05 }}>{value}</div>
      <div style={{ fontFamily: 'var(--f-body)', fontSize: 11, lineHeight: 1.45, color: 'var(--mute)', marginTop: 8 }}>{note}</div>
      <div style={{ fontFamily: 'var(--f-body)', fontSize: 10, color: 'var(--dim)', marginTop: 4, letterSpacing: '0.3px' }}>Used for {usedFor}</div>
    </div>
  );
}

function ConnCard({ name, sub, connected }: { name: string; sub: string; connected: boolean }) {
  return (
    <div style={{ borderTop: '1px solid var(--line)', padding: '13px 0', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontFamily: 'var(--f-display)', fontWeight: 700, fontSize: 19, letterSpacing: '-0.01em', color: 'var(--ink)', textTransform: 'uppercase' }}>{name}</div>
        <div style={{ fontFamily: 'var(--f-body)', fontSize: 11.5, color: 'var(--mute)', marginTop: 3 }}>{sub}</div>
      </div>
      <span style={{ flexShrink: 0, fontFamily: 'var(--f-label)', fontSize: 10, fontWeight: 700, letterSpacing: '1.2px', color: connected ? 'var(--green)' : 'var(--dim)' }}>
        ● {connected ? 'CONNECTED' : 'NOT CONNECTED'}
      </span>
    </div>
  );
}

function DataLink({ href, title, sub }: { href: string; title: string; sub: string }) {
  return (
    <Link
      href={href}
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 10,
        borderTop: '1px solid var(--line)',
        padding: '13px 0',
        textDecoration: 'none',
      }}
    >
      <div style={{ minWidth: 0 }}>
        <div style={{ fontFamily: 'var(--f-display)', fontWeight: 700, fontSize: 22, letterSpacing: '-0.01em', color: 'var(--ink)', textTransform: 'uppercase' }}>{title}</div>
        <div style={{ fontFamily: 'var(--f-body)', fontSize: 11.5, color: 'var(--mute)', marginTop: 3 }}>{sub}</div>
      </div>
      <span style={{ flexShrink: 0, fontFamily: 'var(--f-display)', fontWeight: 700, fontSize: 20, color: 'var(--mute)' }}>→</span>
    </Link>
  );
}

const DAY_NAMES: Record<string, [string, string]> = {
  sun: ['Sunday', 'Sun'], mon: ['Monday', 'Mon'], tue: ['Tuesday', 'Tue'],
  wed: ['Wednesday', 'Wed'], thu: ['Thursday', 'Thu'], fri: ['Friday', 'Fri'], sat: ['Saturday', 'Sat'],
};
function dayLabel(d: string): string { return DAY_NAMES[d]?.[0] ?? d; }
function dayShort(d: string): string { return DAY_NAMES[d]?.[1] ?? d; }

function formatHeightFtIn(cm: number | null | undefined): string {
  if (cm == null || !Number.isFinite(cm) || cm <= 0) return '—';
  const totalInches = Math.round(cm / 2.54);
  const ft = Math.floor(totalInches / 12);
  const inch = totalInches % 12;
  return `${ft}′ ${inch}″`;
}

function formatBirthday(iso: string | null | undefined): string {
  if (!iso) return '—';
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return iso;
  return `${m[2]}-${m[3]}-${m[1]}`;
}
