/**
 * TodayLayouts — two responsive layouts of the TODAY surface.
 *
 *   Mobile (< 1100px):  the iPhone column from the deck — coach + cards stacked
 *   Desktop (≥ 1100px): two-column — hero coach voice on the left, cards rail on the right
 *
 * Both layouts receive the SAME briefing payload. The cards are reused; the
 * coach block scales up on desktop (32px → 56px lead, larger body).
 */
import type { Topic } from '@/lib/topics/types';
import { CoachBlock } from '@/components/cards/CoachBlock';
import { TopicRenderer } from '@/components/cards/TopicRenderer';

export interface TodayLayoutProps {
  lead: string;
  voice: string[];
  topics: Topic[];
  mode: string;
  briefingId: string;
  greetingName?: string;
  todayLabel: string;
  metaLine?: string;
  askPrompt: string;
  readinessScore?: number;
  readinessLabel?: string;
  /** Live state plumbed from the briefing — drives MicroStatStrip on desktop. */
  glance?: {
    sleep7Avg?: number | null;
    sleep7Deficit?: number;
    rhrCurrent?: number | null;
    rhrBaseline?: number | null;
    cadenceBaseline?: number | null;
    weekDone?: number;
    weekPlanned?: number | null;
  };
}

export function TodayLayouts(props: TodayLayoutProps) {
  return (
    <>
      <div className="layout-mobile">
        <MobileLayout {...props} />
      </div>
      <div className="layout-desktop">
        <DesktopLayout {...props} />
      </div>
      <style>{`
        .layout-mobile  { display: block; }
        .layout-desktop { display: none; }
        @media (min-width: 1100px) {
          .layout-mobile  { display: none; }
          .layout-desktop { display: block; }
        }
      `}</style>
    </>
  );
}

function MobileLayout({ lead, voice, topics, mode, briefingId, askPrompt }: TodayLayoutProps) {
  return (
    <div style={{ maxWidth: 460, margin: '0 auto', background: 'var(--bg)', paddingBottom: 40 }}>
      <CoachBlock lead={lead} voice={voice} briefingId={briefingId} askPrompt={askPrompt} />
      <div style={{ padding: '4px 24px 24px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        {topics.map((t, i) => <TopicRenderer key={i} topic={t} />)}
      </div>
    </div>
  );
}

function DesktopLayout(props: TodayLayoutProps) {
  const { lead, voice, topics, mode, briefingId, greetingName, todayLabel, metaLine, askPrompt, readinessScore, readinessLabel } = props;
  return (
    <div style={{ padding: '40px 40px 80px', maxWidth: 1440, margin: '0 auto' }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 32, alignItems: 'end', marginBottom: 28 }}>
        <div>
          <h1 style={{ fontFamily: 'var(--f-display)', fontSize: 64, lineHeight: 1, margin: 0, letterSpacing: '0.5px' }}>
            {greetingForMode(mode)} <span style={{ color: 'var(--green)' }}>{greetingName ?? 'David'}.</span>
          </h1>
          <div style={{ fontFamily: 'var(--f-body)', fontSize: 13, color: 'var(--mute)', letterSpacing: '1.6px', textTransform: 'uppercase', marginTop: 10 }}>
            {todayLabel}{metaLine ? ` · ${metaLine}` : ''}
          </div>
        </div>
        {readinessScore != null && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
            <div>
              <div style={{ fontFamily: 'var(--f-body)', fontSize: 10, fontWeight: 700, color: 'var(--mute)', letterSpacing: '1.6px', textTransform: 'uppercase' }}>READINESS</div>
              <div style={{ fontFamily: 'var(--f-display)', fontSize: 20, color: 'var(--ink)', marginTop: 2 }}>{readinessLabel ?? 'READY'}</div>
            </div>
            <ReadinessChipLg value={readinessScore} />
          </div>
        )}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: 32 }}>
        {/* Left: hero coach + micro-stat strip */}
        <div>
          <div style={{
            background: 'linear-gradient(180deg, rgba(62,189,65,0.04), rgba(62,189,65,0) 60%)',
            border: '1px solid var(--line)',
            borderRadius: 22,
            padding: '32px 36px',
          }}>
            <DesktopCoach lead={lead} voice={voice} briefingId={briefingId} askPrompt={askPrompt} />
          </div>
          <MicroStatStrip glance={props.glance} />
        </div>

        {/* Right: cards rail */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {topics.map((t, i) => <TopicRenderer key={i} topic={t} />)}
        </div>
      </div>
    </div>
  );
}

function MicroStatStrip({ glance }: { glance?: TodayLayoutProps['glance'] }) {
  const g = glance ?? {};

  // Sleep
  const sleepV = g.sleep7Avg != null ? `${g.sleep7Avg.toFixed(1)}h` : '—';
  const sleepD = g.sleep7Avg != null
    ? (g.sleep7Avg < 7.5 ? `−${(7.5 - g.sleep7Avg).toFixed(1)} vs target` : 'at target')
    : '';
  const sleepColor = g.sleep7Avg != null && g.sleep7Avg < 7.5 ? 'var(--goal)' : 'var(--green)';

  // RHR
  const rhrV = g.rhrCurrent != null ? `${g.rhrCurrent} bpm` : '—';
  const rhrDelta = g.rhrCurrent != null && g.rhrBaseline != null ? (g.rhrCurrent - g.rhrBaseline) : null;
  const rhrD = rhrDelta == null ? ''
    : rhrDelta >= 5  ? `+${rhrDelta} vs baseline`
    : rhrDelta > 0   ? `+${rhrDelta} vs baseline`
    : rhrDelta < 0   ? `${rhrDelta} vs baseline`
                     : 'at baseline';
  const rhrWarn = rhrDelta != null && rhrDelta >= 5;
  const rhrColor = rhrWarn ? 'var(--over)' : 'var(--green)';

  // Cadence
  const cadV = g.cadenceBaseline != null ? `${g.cadenceBaseline} spm` : '—';

  // Week
  const wkV = g.weekDone != null && g.weekPlanned != null
    ? `${g.weekDone} / ${g.weekPlanned}`
    : '—';

  return (
    <div style={{ marginTop: 24, display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14 }}>
      <MicroStat k="SLEEP · 7N"    v={sleepV} delta={sleepD} color={sleepColor} />
      <MicroStat k="RHR"           v={rhrV}   delta={rhrD}   color={rhrColor} warn={rhrWarn} />
      <MicroStat k="CADENCE · 60D" v={cadV}   delta="60d baseline" color="var(--green)" />
      <MicroStat k="WEEK MI"       v={wkV}    delta="week in progress" color="var(--rest)" />
    </div>
  );
}

function MicroStat({ k, v, delta, color, warn }: { k: string; v: string; delta: string; color: string; warn?: boolean }) {
  return (
    <div className="card" style={{ padding: '14px 16px' }}>
      <div style={{ fontFamily: 'var(--f-body)', fontSize: 9, fontWeight: 700, color: 'var(--mute)', letterSpacing: '1.4px', textTransform: 'uppercase' }}>{k}</div>
      <div style={{ fontFamily: 'var(--f-display)', fontSize: 28, color, lineHeight: 1, marginTop: 4 }}>{v}</div>
      <div style={{ fontFamily: 'var(--f-body)', fontSize: 10, color: warn ? color : 'var(--mute)', marginTop: 4 }}>{delta}</div>
    </div>
  );
}

function DesktopCoach({ lead, voice, briefingId, askPrompt }: { lead: string; voice: string[]; briefingId: string; askPrompt: string }) {
  // Reuse the CoachBlock but inside this container its lead/voice sizes scale up
  // via CSS custom properties. (The CoachBlock currently uses fixed sizes —
  // wrap it for now; full refactor to use these vars lands in P2.b.)
  return (
    <div style={{ position: 'relative' }}>
      <style>{`
        .layout-desktop .layout-desktop_coach h2 { font-size: 52px !important; }
        .layout-desktop .layout-desktop_coach p { font-size: 16px !important; line-height: 1.65 !important; }
      `}</style>
      <div className="layout-desktop_coach">
        <CoachBlock lead={lead} voice={voice} briefingId={briefingId} askPrompt={askPrompt} />
      </div>
    </div>
  );
}

function greetingForMode(mode: string): string {
  switch (mode) {
    case 'post-run':  return 'Nice work,';
    case 'pre-run':   return 'Morning,';
    case 'rest-day':  return 'Rest today,';
    case 'race-day':  return 'Today,';
    default:          return 'Hi';
  }
}

function ReadinessChipLg({ value }: { value: number }) {
  const r = 26;
  const C = 2 * Math.PI * r;
  const off = C * (1 - value / 100);
  const color = value >= 85 ? 'var(--green)' : value >= 65 ? 'var(--goal)' : 'var(--over)';
  return (
    <div style={{ width: 64, height: 64, position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <svg viewBox="0 0 64 64" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', transform: 'rotate(-90deg)' }}>
        <circle cx="32" cy="32" r={r} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="4" />
        <circle cx="32" cy="32" r={r} fill="none" stroke={color} strokeWidth="4" strokeLinecap="round" strokeDasharray={C} strokeDashoffset={off} />
      </svg>
      <div style={{ fontFamily: 'var(--f-display)', fontSize: 26, color, letterSpacing: '0.5px' }}>{value}</div>
    </div>
  );
}
