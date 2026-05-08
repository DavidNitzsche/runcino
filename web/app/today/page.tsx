'use client';

/**
 * /today — radically simple "just tell me what to do" view.
 *
 * Mission: when the runner is rushed (between meetings, before a
 * run, on the trailhead with cold fingers), this is the page that
 * answers "what's today?" in one screen with zero scroll on a
 * phone. Everything else lives elsewhere.
 *
 * Layout:
 *   - Big workout-of-the-day hero (type, distance, pace, HR zone)
 *   - Voice paragraph from coach.briefDailyTraining
 *   - Readiness chip (one line, click to expand)
 *   - RPE input (post-run; visible all day)
 *   - "More detail" link to /workout/[today]
 *
 * No fun-stats. No charts. No fueling tables. No timeline. The
 * radically-simple page is intentional restraint.
 */

import Link from 'next/link';
import { Caption, Nav } from '../../components/nav';
import { HubProvider, useHub } from '../../lib/hub-provider';
import { ReadinessBanner } from '../../components/coaching/ReadinessBanner';
import { CoachDailyBrief } from '../../components/coaching/CoachDailyBrief';
import { RpeInput } from '../../components/RpeInput';

export default function TodayPage() {
  return (
    <HubProvider>
      <TodayInner />
    </HubProvider>
  );
}

function TodayInner() {
  const hub = useHub();
  if (!hub) {
    return (
      <Shell>
        <div style={{ minHeight: 480 }} aria-busy="true" />
      </Shell>
    );
  }

  const t = hub.coach.today?.today ?? null;
  const phase = hub.coach.today?.phase ?? null;
  const modeDetail = hub.coach.today?.modeDetail ?? '';
  const rationale = hub.coach.today?.rationale ?? '';
  const todayISO = hub.meta.cacheDate;
  const dailyBrief = hub.coach.dailyBrief ?? null;
  const readiness = hub.coach.coach?.readiness?.answer ?? null;
  const existingRpe = hub.recentRpe.find(e => e.workoutDate === todayISO) ?? null;

  if (!t) {
    return (
      <Shell>
        <div className="tile" style={{ padding: 32, textAlign: 'center' }}>
          <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 24, color: 'var(--color-t0)' }}>
            No prescription yet
          </div>
          <div style={{ fontSize: 13, color: 'var(--color-t2)', marginTop: 8 }}>
            Connect Strava and add a goal race so the coach can plan today.
          </div>
        </div>
      </Shell>
    );
  }

  const paceLabel = t.paceTargetSPerMi
    ? `${formatPace(t.paceTargetSPerMi.lowS)}–${formatPace(t.paceTargetSPerMi.highS)}/mi`
    : null;
  const accent: string = (() => {
    const ty: string = t.type;
    if (ty === 'rest') return 'var(--color-t3)';
    if (ty === 'recovery' || ty === 'general_aerobic' || ty === 'easy' || ty === 'shakeout') return 'var(--color-success)';
    if (ty === 'long_steady' || ty === 'long_progression' || ty === 'medium_long') return 'var(--color-corporate)';
    return 'var(--color-attention)';
  })();

  return (
    <Shell>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14, maxWidth: 720 }}>

        <div style={{ marginBottom: 4 }}>
          <div style={{ fontFamily: 'var(--font-data)', fontSize: 10, letterSpacing: '1.6px', color: accent, fontWeight: 700 }}>
            TODAY · {phase ?? ''}
          </div>
          {modeDetail && (
            <div style={{ fontSize: 12, color: 'var(--color-t2)', marginTop: 2 }}>
              {modeDetail}
            </div>
          )}
        </div>

        {/* Hero */}
        <div className="tile" style={{
          padding: '28px 32px',
          background: t.type === 'rest' ? 'var(--color-l2)' : `linear-gradient(135deg, var(--color-l2) 0%, ${accent}15 100%)`,
          borderColor: `${accent}60`,
        }}>
          <div style={{
            fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 64,
            lineHeight: 0.92, letterSpacing: '-.005em', color: 'var(--color-t0)',
            textTransform: 'uppercase',
          }}>
            {t.label}
          </div>
          <div style={{
            display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))', gap: 14,
            paddingTop: 18, marginTop: 14, borderTop: '1px solid var(--color-l4)',
          }}>
            <Kpi value={t.distanceMi.toFixed(1)} unit="mi" label="Distance" />
            {paceLabel && <Kpi value={paceLabel} unit="" label="Pace target" accent />}
            {t.hrZone && <Kpi value={`Z${t.hrZone}`} unit="" label="HR zone" />}
          </div>
          {t.description && (
            <div style={{ fontSize: 14, color: 'var(--color-t1)', marginTop: 16, lineHeight: 1.55 }}>
              {t.description}
            </div>
          )}
        </div>

        {/* Voice brief */}
        {dailyBrief && (
          <CoachDailyBrief brief={dailyBrief} engineRationale={rationale} />
        )}

        {/* Readiness — one-line summary, click to expand signals */}
        {readiness && <ReadinessBanner readiness={readiness} />}

        {/* RPE — visible all day, useful to log post-run */}
        {t.type !== 'rest' && (
          <div className="tile" style={{
            borderStyle: existingRpe ? 'solid' : 'dashed',
            borderColor: existingRpe ? 'var(--color-l4)' : 'var(--color-attention)',
          }}>
            <RpeInput workoutDate={todayISO} existing={existingRpe} />
          </div>
        )}

        {/* More-detail escape hatch */}
        <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
          <Link href={`/workout/${todayISO}`} className="btn btn--ghost">Full workout detail →</Link>
          <Link href="/training" className="btn btn--ghost">Training</Link>
        </div>

      </div>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <>
      <Caption left="Runcino · today" right="JUST TELL ME" />
      <div className="stage">
        <Nav active="overview" />
        <div className="body">{children}</div>
      </div>
    </>
  );
}

function Kpi({ value, unit, label, accent }: { value: string; unit: string; label: string; accent?: boolean }) {
  const color = accent ? 'var(--color-corporate)' : 'var(--color-t0)';
  const subColor = accent ? 'rgba(79,143,247,.6)' : 'var(--color-t2)';
  return (
    <div>
      <div style={{
        fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 30,
        letterSpacing: '-.025em', lineHeight: 1, color,
        fontVariantNumeric: 'tabular-nums',
      }}>
        {value}
        {unit && <small style={{
          fontSize: 12, color: subColor, marginLeft: 4,
          fontFamily: 'var(--font-data)', letterSpacing: '1.3px',
          textTransform: 'uppercase',
        }}>{unit}</small>}
      </div>
      <div style={{
        marginTop: 5, fontFamily: 'var(--font-data)', fontSize: 9,
        letterSpacing: '1.4px', color: accent ? 'var(--color-corporate)' : 'var(--color-t3)',
        fontWeight: 700, textTransform: 'uppercase',
      }}>{label}</div>
    </div>
  );
}

function formatPace(secPerMi: number): string {
  const m = Math.floor(secPerMi / 60);
  const s = Math.round(secPerMi % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}
