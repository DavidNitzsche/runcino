import { Nav, Footer } from '../../../components/nav';

type Source = {
  name: string;
  status: 'connected' | 'read_only' | 'no_auth' | 'pending';
  gradient: string;
  description: string;
  facts: string[];
  privacy: string;
  ctaLabel: string;
  badge: string;
  iconPath: string;
};

const SOURCES: Source[] = [
  {
    name: 'Apple HealthKit',
    status: 'connected',
    gradient: 'linear-gradient(135deg,#FF4D62,#FF8364)',
    description: 'Reads recent runs, HRV, resting HR, VO₂max estimate, sleep, training load. No writes.',
    facts: ['38 runs · 6 weeks', 'VO₂max est 52', 'HRV 58 ms (↑)', 'Last 5am · 19 Apr'],
    privacy: 'Read-only permissions. Runcino never writes to Health. Requested scopes are narrow — not "everything."',
    ctaLabel: 'Manage',
    badge: 'Connected',
    iconPath: 'M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z',
  },
  {
    name: 'Strava',
    status: 'connected',
    gradient: '#FC4C02',
    description: 'Reads past races, PRs, segment efforts, shoe mileage. Feeds race extrapolation + shoe rotation.',
    facts: ['LA Marathon 3:40 (2025)', 'Ventura Half 1:38', 'Endorphin 4 · 298 mi'],
    privacy: 'OAuth with activity:read + profile:read_all scopes. Tokens in iOS keychain. Revocable any time at strava.com/settings/apps.',
    ctaLabel: 'Manage',
    badge: 'Connected · OAuth',
    iconPath: 'M15.387 17.944l-2.089-4.116h-3.065L15.387 24l5.15-10.172h-3.066M8.75 6.7l2.777 5.464H15.7L8.75 0 1.85 12.164h4.172',
  },
  {
    name: 'Apple Calendar',
    status: 'read_only',
    gradient: 'linear-gradient(135deg,#FF9500,#FFB340)',
    description: 'Reads selected calendars. Detects conflicts with planned runs + travel around race day.',
    facts: ['3 calendars selected', '2 training blocks upcoming', 'Race travel: Apr 24–27'],
    privacy: 'Read-only, scoped to calendars you pick. Not synced, never exported.',
    ctaLabel: 'Manage',
    badge: 'Read-only',
    iconPath: 'M3 4h18v18H3z',
  },
  {
    name: 'NOAA forecast',
    status: 'no_auth',
    gradient: 'linear-gradient(135deg,#4DABE3,#A7CFE8)',
    description: 'Race-day forecast 72h / 24h / 3h before gun. Feeds morning-brief wind + temp adjustments.',
    facts: ['Big Sur 2026-04-26 · 42°F start', 'NW 8 mph', 'Overcast'],
    privacy: 'Public US government API. No auth, no account. Issues a single call with race location only.',
    ctaLabel: 'Test fetch',
    badge: 'Auto · no auth',
    iconPath: 'M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z',
  },
];

export default function IntegrationsPage() {
  return (
    <main style={{ maxWidth: 1180, margin: '0 auto', padding: '0 32px' }}>
      <Nav active="settings" />

      <section style={{ padding: '48px 0 16px' }}>
        <div className="runcino-pill runcino-pill-sage" style={{ marginBottom: 16, display: 'inline-flex' }}>
          <span className="runcino-pill-dot" style={{ background: 'var(--color-sage)' }} /> M2 · Auto-ingestion
        </div>
        <h1 style={{ fontSize: 52, maxWidth: '24ch', margin: '0 0 12px' }}>
          Stop typing numbers.<br />
          <span className="serif-italic">Your phone already knows them.</span>
        </h1>
        <p style={{ fontSize: 18, color: 'var(--color-ink-3)', maxWidth: '62ch', lineHeight: 1.5 }}>
          HealthKit, Strava, Apple Calendar, and NOAA together replace the manual fitness form. Runcino reads once per race-prep session, writes nothing back without permission.
        </p>
      </section>

      <section style={{ padding: '32px 0 48px' }}>
        <div className="runcino-card" style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{ padding: '24px 32px', background: 'var(--color-paper-2)', borderBottom: '1px solid var(--color-line)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <div className="eyebrow" style={{ marginBottom: 6 }}>Data sources</div>
              <h4 style={{ fontSize: 20 }}>Four connections. Each is opt-in.</h4>
            </div>
            <span className="runcino-pill">Last synced · 6 min ago</span>
          </div>
          {SOURCES.map((s, i) => (
            <SourceRow key={s.name} source={s} isLast={i === SOURCES.length - 1} />
          ))}
        </div>
      </section>

      <section style={{ padding: '0 0 48px' }}>
        <div className="runcino-card" style={{ background: 'var(--color-paper-2)', padding: 32, display: 'grid', gridTemplateColumns: '48px 1fr', gap: 20, alignItems: 'start' }}>
          <div style={{ width: 48, height: 48, borderRadius: 12, background: 'var(--color-terracotta-3)', color: 'var(--color-terracotta)', display: 'grid', placeItems: 'center' }}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="11" width="18" height="11" rx="2" />
              <path d="M7 11V7a5 5 0 0 1 10 0v4" />
            </svg>
          </div>
          <div>
            <h4 style={{ marginBottom: 12 }}>Privacy model</h4>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, color: 'var(--color-ink-2)', fontSize: 14, lineHeight: 1.6 }}>
              {SOURCES.map(s => (
                <div key={s.name}><strong>{s.name}</strong> — {s.privacy}</div>
              ))}
              <div>
                <strong>Claude API</strong> — the only outbound call. Sends a compact numeric summary (no names, no locations beyond city-level). Cached to reduce token spend.
              </div>
            </div>
          </div>
        </div>
      </section>

      <section style={{ padding: '0 0 96px' }}>
        <div className="runcino-card" style={{ background: 'var(--color-ink)', color: 'var(--color-paper)', borderColor: 'var(--color-ink)', padding: 32 }}>
          <div className="eyebrow" style={{ color: 'var(--color-terracotta-2)', marginBottom: 12 }}>Implementation status</div>
          <h3 style={{ color: 'var(--color-paper)', marginBottom: 16, fontSize: 24 }}>Where each source actually works today</h3>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24, color: 'var(--color-paper-3)', fontSize: 14, lineHeight: 1.6 }}>
            <div>
              <strong style={{ color: 'var(--color-paper)' }}>Live right now</strong>
              <ul style={{ margin: '8px 0 0', paddingLeft: 20 }}>
                <li><strong style={{ color: 'var(--color-paper)' }}>NOAA weather</strong> — <code className="font-mono">/api/weather?lat=36.56&amp;lon=-121.92</code> returns real forecast data (try it)</li>
              </ul>
            </div>
            <div>
              <strong style={{ color: 'var(--color-paper)' }}>Needs iOS work (M2 milestone)</strong>
              <ul style={{ margin: '8px 0 0', paddingLeft: 20 }}>
                <li>HealthKit — <code className="font-mono">HKHealthStore.requestAuthorization</code> on iOS, then samples via <code className="font-mono">HKSampleQuery</code></li>
                <li>Apple Calendar — <code className="font-mono">EKEventStore.requestAccess</code>, read-only</li>
              </ul>
            </div>
            <div>
              <strong style={{ color: 'var(--color-paper)' }}>Needs OAuth registration</strong>
              <ul style={{ margin: '8px 0 0', paddingLeft: 20 }}>
                <li>Strava — you register a Strava App at strava.com/settings/api, drop client_id + secret into .env.local, OAuth redirect handler scaffolded</li>
              </ul>
            </div>
            <div>
              <strong style={{ color: 'var(--color-paper)' }}>Research + reasoning</strong>
              <ul style={{ margin: '8px 0 0', paddingLeft: 20 }}>
                <li>Claude API — wired end-to-end in <code className="font-mono">/api/goal</code>, <code className="font-mono">/api/brief</code>, <code className="font-mono">/api/research</code>, <code className="font-mono">/api/retrospective</code>. Stub fallbacks ship when ANTHROPIC_API_KEY is empty.</li>
              </ul>
            </div>
          </div>
        </div>
      </section>

      <Footer tag="M2 · integrations" />
    </main>
  );
}

function SourceRow({ source, isLast }: { source: Source; isLast: boolean }) {
  return (
    <div style={{
      padding: '28px 32px',
      borderBottom: isLast ? 'none' : '1px solid var(--color-line)',
      display: 'grid',
      gridTemplateColumns: '56px 1fr auto',
      gap: 20,
      alignItems: 'center',
    }}>
      <div style={{ width: 56, height: 56, borderRadius: 14, background: source.gradient, display: 'grid', placeItems: 'center' }}>
        <svg width="28" height="28" viewBox="0 0 24 24" fill={source.name === 'Strava' ? 'white' : 'none'} stroke={source.name === 'Strava' ? 'none' : 'white'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d={source.iconPath} />
        </svg>
      </div>
      <div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 4 }}>
          <h4 style={{ fontSize: 18 }}>{source.name}</h4>
          <span className="runcino-pill runcino-pill-sage">
            <span className="runcino-pill-dot" style={{ background: 'var(--color-sage)' }} />
            {source.badge}
          </span>
        </div>
        <p style={{ margin: 0, fontSize: 13, color: 'var(--color-ink-3)', lineHeight: 1.5 }}>{source.description}</p>
        <div style={{ display: 'flex', gap: 16, marginTop: 10, fontSize: 12, color: 'var(--color-ink-3)' }}>
          {source.facts.map(f => <span key={f}>{f}</span>)}
        </div>
      </div>
      <button className="btn btn-ghost">{source.ctaLabel}</button>
    </div>
  );
}
