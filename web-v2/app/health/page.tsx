import { TopNav } from '@/components/layout/TopNav';
import { BarChart } from '@/components/charts/HealthBars';
import { ReadinessBreakdownView } from '@/components/readiness/ReadinessBreakdown';
import { BriefingLoader } from '@/components/cards/BriefingLoader';
import { loadHealthState, type HealthState } from '@/lib/coach/health-state';
import { loadGlanceState } from '@/lib/coach/glance-state';

export const dynamic = 'force-dynamic';

const DAVID_USER_ID = process.env.DEFAULT_USER_ID ?? '0645f40c-951d-4ccc-b86e-9979cd26c795';

export default async function HealthPage() {
  const [health, glance] = await Promise.all([
    loadHealthState(DAVID_USER_ID),
    loadGlanceState(DAVID_USER_ID).catch(() => null),
  ]);

  const headlineColor = health.watchMode === 'watch-red' ? 'var(--over)'
    : health.watchMode === 'watch-amber' ? 'var(--goal)'
    : health.watchMode === 'green' ? 'var(--green)' : 'var(--ink)';
  const headlineText = health.watchMode === 'watch-red'  ? 'Pull back.'
    : health.watchMode === 'watch-amber' ? 'Health.'
    : health.watchMode === 'green' ? "Everything's green." : 'Health.';

  return (
    <main>
      <TopNav />
      <div style={{ padding: '40px 40px 80px', maxWidth: 1440, margin: '0 auto' }}>
        <h1 style={{ fontFamily: 'var(--f-display)', fontSize: 56, lineHeight: 1, margin: 0, color: headlineColor, letterSpacing: '0.5px' }}>
          {headlineText}
        </h1>
        <div style={{ fontFamily: 'var(--f-body)', fontSize: 13, color: 'var(--mute)', letterSpacing: '1.6px', textTransform: 'uppercase', marginTop: 12, marginBottom: 28 }}>
          LONG-TERM PATTERNS · 30-DAY VIEW · WATCH MODE: {health.watchMode.toUpperCase()}
        </div>

        {/* Coach voice — loads async */}
        <div style={{
          background: health.watchMode === 'watch-red'
            ? 'linear-gradient(180deg, rgba(252,77,100,0.06), rgba(252,77,100,0) 70%)'
            : health.watchMode === 'watch-amber'
            ? 'linear-gradient(180deg, rgba(243,173,56,0.06), rgba(243,173,56,0) 70%)'
            : 'linear-gradient(180deg, rgba(62,189,65,0.04), rgba(62,189,65,0) 60%)',
          border: '1px solid var(--line)', borderRadius: 18, padding: '4px 4px',
          marginBottom: 18, minHeight: 200,
        }}>
          <BriefingLoader surface="health" renderCards={false} />
        </div>

        {/* §8.3 — readiness from glance state (no LLM needed) */}
        {glance && (
          <div className="card" style={{ padding: '24px 28px', marginBottom: 18 }}>
            <div className="card-eyebrow" style={{ color: 'var(--green)' }}>READINESS · TODAY</div>
            <ReadinessBreakdownView breakdown={glance.readiness} />
          </div>
        )}

        {health.watchItems.length > 0 && <WatchListBox items={health.watchItems} />}

        <Grid2>
          <TrendCard
            title="SLEEP · 30 DAYS" titleColor="var(--goal)"
            value={health.sleep.avg7n != null ? `${health.sleep.avg7n.toFixed(1)}h` : '—'}
            valueColor="var(--goal)"
            sub={`7-NIGHT AVG · 30D avg ${health.sleep.avg30n ?? '—'}h · −${(7.5 - (health.sleep.avg7n ?? 7.5)).toFixed(1)} vs target`}
            chart={<BarChart series={health.sleepSeries.map((d) => d.hours)} min={4} max={10} color="#F3AD38" />}
          />
          <TrendCard
            title="RESTING HR · 60 DAYS" titleColor="var(--over)"
            value={health.rhr.current != null ? `${health.rhr.current}` : '—'}
            valueColor={health.rhr.delta != null && health.rhr.delta >= 5 ? 'var(--over)' : 'var(--green)'}
            sub={`CURRENT BPM · baseline ${health.rhr.baseline ?? '—'} · ${health.rhr.delta != null ? (health.rhr.delta >= 0 ? `+${health.rhr.delta}` : `${health.rhr.delta}`) : '—'}`}
            chart={<BarChart series={health.rhrSeries.map((d) => d.bpm)} min={40} max={70} color="#FC4D64" />}
          />
        </Grid2>

        <Grid2>
          <TrendCard
            title="HRV · NIGHTLY" titleColor="var(--green)"
            value={health.hrv.current != null ? `${health.hrv.current} ms` : '—'}
            valueColor="var(--green)"
            sub={`baseline ${health.hrv.baseline ?? '—'} ms${health.hrv.pctAboveBaseline != null ? ` · +${health.hrv.pctAboveBaseline}%` : ''}`}
            chart={<BarChart series={health.hrvSeries.map((d) => d.ms)} min={30} max={100} color="#3EBD41" />}
          />
          <TrendCard
            title="WEIGHT · 30 DAYS" titleColor="var(--dist)"
            value={health.weight.current != null ? `${health.weight.current.toFixed(1)} lb` : '—'}
            valueColor="var(--ink)"
            sub={`${health.weight.delta30 != null ? (health.weight.delta30 >= 0 ? `+${health.weight.delta30}` : `${health.weight.delta30}`) : '—'} lb vs 30d ago`}
            chart={<BarChart series={health.weightSeries.map((d) => d.lb)} min={170} max={200} color="#27B4E0" />}
          />
        </Grid2>

        {/* Explainer cards from the deck (P4 unlocks /learn/ destinations) */}
        <SectionLabel>LEARN · WHY THESE METRICS</SectionLabel>
        <Grid3>
          <ExplainerCard
            term="HRV · WHAT + WHY"
            body="The time variation between heartbeats, measured overnight. Higher HRV means your nervous system is recovered and ready for hard training. It's one of the best early-warning signals we have for overtraining."
            slug="hrv"
          />
          <ExplainerCard
            term="RHR · WHAT + WHY"
            body="Resting heart rate trends downward as aerobic fitness improves — and elevates 3-5 bpm during volume jumps, illness brewing, or sleep deficit. A sustained 5+ bpm bump that doesn't resolve in a few days is the flag."
            slug="rhr"
          />
          <ExplainerCard
            term="VO2 MAX · WHAT + WHY"
            body="The peak oxygen your body can use per minute. The single best lab predictor of endurance ceiling. Apple's estimate isn't lab-grade but it's directionally honest — month-over-month moves are real."
            slug="vo2-max"
          />
        </Grid3>

        <Grid2>
          <TrendCard
            title="VO2 MAX · APPLE WATCH" titleColor="var(--learn)"
            value={health.vo2.current != null ? `${health.vo2.current.toFixed(1)}` : '—'}
            valueColor="var(--learn)"
            sub="ml/kg/min · highest reading from Apple Health"
            chart={null}
          />
          <TrendCard
            title="CADENCE · 60D" titleColor="var(--dist)"
            value={health.cadence.baseline != null ? `${health.cadence.baseline}` : '—'}
            valueColor="var(--dist)"
            sub="spm · 60-day baseline · real cadence target waits on your height"
            chart={null}
          />
        </Grid2>
      </div>
    </main>
  );
}

function WatchListBox({ items }: { items: HealthState['watchItems'] }) {
  return (
    <div className="card" style={{
      marginBottom: 18,
      borderColor: 'rgba(243,173,56,0.25)',
      background: 'rgba(243,173,56,0.04)',
    }}>
      <div className="card-eyebrow" style={{ color: 'var(--goal)' }}>
        WATCH LIST · {items.length} {items.length === 1 ? 'ITEM' : 'ITEMS'}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 18, marginTop: 8 }}>
        {items.map((item, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: item.status === 'red' ? 'var(--over)' : 'var(--goal)', marginTop: 6, flexShrink: 0 }} />
            <div>
              <div style={{ fontFamily: 'var(--f-display)', fontSize: 16, color: 'var(--ink)' }}>{item.label}</div>
              <div style={{ fontSize: 11.5, color: 'var(--mute)', lineHeight: 1.55, marginTop: 4 }}>{item.note}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function TrendCard({ title, titleColor, value, valueColor, sub, chart }: { title: string; titleColor: string; value: string; valueColor: string; sub: string; chart: React.ReactNode }) {
  return (
    <div className="card" style={{ padding: '20px 24px' }}>
      <div className="card-eyebrow" style={{ color: titleColor }}>{title}</div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 14, margin: '6px 0 14px' }}>
        <span style={{ fontFamily: 'var(--f-display)', fontSize: 42, color: valueColor, letterSpacing: '0.5px' }}>{value}</span>
        <span style={{ fontFamily: 'var(--f-body)', fontSize: 12, color: 'var(--mute)', letterSpacing: '0.5px' }}>{sub}</span>
      </div>
      {chart}
    </div>
  );
}

function ExplainerCard({ term, body, slug }: { term: string; body: string; slug: string }) {
  return (
    <a href={`/learn/${slug}`} className="card" style={{
      display: 'block', padding: '18px 20px',
      background: 'rgba(176,132,255,0.04)', border: '1px solid rgba(176,132,255,0.18)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        <span style={{
          width: 18, height: 18, borderRadius: '50%', background: 'var(--learn)', color: '#1a0f33',
          fontFamily: 'var(--f-body)', fontSize: 11, fontWeight: 800,
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
        }}>ⓘ</span>
        <span style={{ fontFamily: 'var(--f-body)', fontSize: 11, fontWeight: 700, color: 'var(--learn)', letterSpacing: '1.2px' }}>{term}</span>
      </div>
      <div style={{ fontFamily: 'var(--f-body)', fontSize: 12.5, color: 'rgba(246,247,248,0.85)', lineHeight: 1.55, margin: '4px 0 8px' }}>
        {body}
      </div>
      <span style={{ fontFamily: 'var(--f-body)', fontSize: 10.5, fontWeight: 600, color: 'var(--learn)', letterSpacing: '0.5px' }}>Read the research →</span>
    </a>
  );
}

function Grid2({ children }: { children: React.ReactNode }) {
  return <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 14 }}>{children}</div>;
}
function Grid3({ children }: { children: React.ReactNode }) {
  return <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 14, marginBottom: 14 }}>{children}</div>;
}
function SectionLabel({ children }: { children: React.ReactNode }) {
  return <div style={{ fontFamily: 'var(--f-body)', fontSize: 11, fontWeight: 700, color: 'var(--mute)', letterSpacing: '1.6px', textTransform: 'uppercase', margin: '24px 0 12px' }}>{children}</div>;
}
