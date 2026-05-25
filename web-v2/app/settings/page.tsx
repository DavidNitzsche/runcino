import { TopNav } from '@/components/layout/TopNav';

export const dynamic = 'force-dynamic';

// Settings stub. P6.b wires real settings (notifications time, units,
// integration toggles, account, data export, privacy).
export default function SettingsPage() {
  return (
    <main>
      <TopNav />
      <div style={{ padding: '40px 40px 80px', maxWidth: 720, margin: '0 auto' }}>
        <h1 style={{ fontFamily: 'var(--f-display)', fontSize: 56, lineHeight: 1, margin: 0, letterSpacing: '0.5px' }}>
          Settings.
        </h1>
        <p style={{ color: 'var(--mute)', fontSize: 14, marginTop: 14 }}>
          Notifications, units, integrations, account, data export, privacy.
        </p>

        <Section title="NOTIFICATIONS">
          <Row k="Briefing time"     v="07:00 local · daily" />
          <Row k="Race-week reminders" v="2 days before · enabled" />
          <Row k="Push notifications" v="Enabled" />
        </Section>

        <Section title="UNITS">
          <Row k="Distance" v="Miles" />
          <Row k="Pace"     v="min/mi" />
          <Row k="Temperature" v="°F" />
        </Section>

        <Section title="INTEGRATIONS">
          <Row k="Strava"       v="● CONNECTED" />
          <Row k="Apple Health" v="● CONNECTED" />
          <Row k="Apple Watch"  v="● PAIRED" />
        </Section>

        <Section title="ACCOUNT">
          <Row k="Email"   v="david@example.com" />
          <Row k="Plan"    v="Pro · monthly" />
          <Row k="Export data" v="Download (JSON / CSV) →" />
          <Row k="Delete account" v="Permanent · 30-day grace" />
        </Section>

        <p style={{ color: 'var(--dim)', fontSize: 11, marginTop: 32, letterSpacing: '1px', textTransform: 'uppercase' }}>
          Settings interactivity wires up in P6.b — placeholder layout matches doctrine.
        </p>
      </div>
    </main>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginTop: 32 }}>
      <div style={{ fontFamily: 'var(--f-body)', fontSize: 11, fontWeight: 700, color: 'var(--mute)', letterSpacing: '1.6px', marginBottom: 10 }}>{title}</div>
      <div className="card" style={{ padding: 0 }}>
        {children}
      </div>
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '14px 18px', borderBottom: '1px solid var(--line-2)', fontSize: 13 }}>
      <span style={{ color: 'var(--mute)' }}>{k}</span>
      <span style={{ color: 'var(--ink)', fontWeight: 500 }}>{v}</span>
    </div>
  );
}
