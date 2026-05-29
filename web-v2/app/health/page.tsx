import { BarChart } from '@/components/charts/HealthBars';
import { ReadinessBreakdownView } from '@/components/readiness/ReadinessBreakdown';
import { BriefingLoader } from '@/components/cards/BriefingLoader';
import { LearnCardTrigger } from '@/components/learn/LearnModal';
import { FaffPageShell } from '@/components/faff/FaffPageShell';
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
    <FaffPageShell
      title={headlineText}
      titleColor={headlineColor}
      eyebrow={`LONG-TERM PATTERNS · 30-DAY VIEW · WATCH MODE: ${health.watchMode.toUpperCase()}`}
    >
        {/* Coach voice — loads async */}
        <div style={{
          background: health.watchMode === 'watch-red'
            ? 'linear-gradient(180deg, rgba(252,77,100,0.06), rgba(252,77,100,0) 70%)'
            : health.watchMode === 'watch-amber'
            ? 'linear-gradient(180deg, rgba(243,173,56,0.06), rgba(243,173,56,0) 70%)'
            : 'linear-gradient(180deg, rgba(62,189,65,0.04), rgba(62,189,65,0) 60%)',
          borderTop: '1px solid var(--line)',
          borderLeft: `3px solid ${headlineColor}`,
          padding: '10px 12px',
          marginBottom: 18, minHeight: 200,
        }}>
          <BriefingLoader surface="health" renderCards={false} />
        </div>

        {/* §8.3 — readiness from glance state (no LLM needed) */}
        {glance && (
          <div style={{ borderTop: '1px solid var(--line)', padding: '18px 0', marginBottom: 18 }}>
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
            narrative={sleepNarrative(health.sleep.avg7n)}
            sub={`7-NIGHT AVG · 30D avg ${health.sleep.avg30n ?? '—'}h · target 7.5h`}
            chart={<BarChart series={health.sleepSeries.map((d) => d.hours)} min={4} max={10} color="var(--goal)" unit="h" baseline={7.5} />}
          />
          <TrendCard
            title="RESTING HR · 60 DAYS" titleColor="var(--over)"
            value={health.rhr.current != null ? `${health.rhr.current}` : '—'}
            valueColor={health.rhr.delta != null && health.rhr.delta >= 5 ? 'var(--over)' : 'var(--green)'}
            narrative={rhrNarrative(health.rhr.delta)}
            sub={`CURRENT BPM · baseline ${health.rhr.baseline ?? '—'} · 60-day window`}
            chart={<BarChart series={health.rhrSeries.map((d) => d.bpm)} min={40} max={70} color="var(--over)" unit="bpm" baseline={health.rhr.baseline ?? undefined} xLabel="60D AGO → TODAY" />}
          />
        </Grid2>

        <Grid2>
          <TrendCard
            title="HRV · NIGHTLY" titleColor="var(--green)"
            value={health.hrv.current != null ? `${health.hrv.current} ms` : '—'}
            valueColor="var(--green)"
            narrative={hrvNarrative(health.hrv.pctAboveBaseline)}
            sub={`baseline ${health.hrv.baseline ?? '—'} ms`}
            chart={<BarChart series={health.hrvSeries.map((d) => d.ms)} min={30} max={100} color="var(--green)" unit="ms" baseline={health.hrv.baseline ?? undefined} />}
          />
          <TrendCard
            title="WEIGHT · 30 DAYS" titleColor="var(--dist)"
            value={health.weight.current != null ? `${health.weight.current.toFixed(1)} lb` : '—'}
            valueColor="var(--ink)"
            narrative={weightNarrative(health.weight.delta30)}
            sub={`${health.weight.delta30 != null ? (health.weight.delta30 >= 0 ? `+${health.weight.delta30}` : `${health.weight.delta30}`) : '—'} lb vs 30d ago`}
            chart={<BarChart series={health.weightSeries.map((d) => d.lb)} min={170} max={200} color="var(--dist)" unit="lb" />}
          />
        </Grid2>

        {/* Explainer cards open the article as a modal — never leave /health */}
        <SectionLabel>LEARN · WHY THESE METRICS</SectionLabel>
        <Grid3>
          <LearnCardTrigger
            term="HRV · WHAT + WHY"
            body="The time variation between heartbeats, measured overnight. Higher HRV means your nervous system is recovered and ready for hard training. It's one of the best early-warning signals we have for overtraining."
            slug="hrv"
          />
          <LearnCardTrigger
            term="RHR · WHAT + WHY"
            body="Resting heart rate trends downward as aerobic fitness improves — and elevates 3-5 bpm during volume jumps, illness brewing, or sleep deficit. A sustained 5+ bpm bump that doesn't resolve in a few days is the flag."
            slug="rhr"
          />
          <LearnCardTrigger
            term="VO2 MAX · WHAT + WHY"
            body="The peak oxygen your body can use per minute. The single best lab predictor of endurance ceiling. Apple's estimate isn't lab-grade but it's directionally honest — month-over-month moves are real."
            slug="vo2-max"
          />
        </Grid3>

        {/* VO2 + CADENCE have no trend chart yet — use the smaller StatCard
         *  so the card height matches the content. */}
        <Grid2>
          <StatCard
            title="VO2 MAX · APPLE WATCH" titleColor="var(--learn)"
            value={health.vo2.current != null ? `${health.vo2.current.toFixed(1)}` : '—'}
            valueColor="var(--learn)"
            narrative={vo2Narrative(health.vo2.current)}
            sub="ml/kg/min · highest reading from Apple Health"
          />
          <StatCard
            title="CADENCE · 60D" titleColor="var(--dist)"
            value={health.cadence.baseline != null ? `${health.cadence.baseline}` : '—'}
            valueColor="var(--dist)"
            narrative={cadenceNarrative(health.cadence.baseline)}
            sub="spm · 60-day running baseline · target band 170–180 spm"
          />
        </Grid2>
    </FaffPageShell>
  );
}

function WatchListBox({ items }: { items: HealthState['watchItems'] }) {
  return (
    <div style={{
      marginBottom: 18,
      borderTop: '1px solid var(--line)',
      borderLeft: '3px solid var(--goal)',
      background: 'rgba(243,173,56,0.04)',
      padding: '16px 14px',
    }}>
      <div className="card-eyebrow" style={{ color: 'var(--goal)' }}>
        WATCH LIST · {items.length} {items.length === 1 ? 'ITEM' : 'ITEMS'}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 18, marginTop: 8 }}>
        {items.map((item, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: item.status === 'red' ? 'var(--over)' : 'var(--goal)', marginTop: 6, flexShrink: 0 }} />
            <div>
              <div style={{ fontFamily: 'var(--f-label)', fontSize: 16, color: 'var(--ink)' }}>{item.label}</div>
              <div style={{ fontSize: 11.5, color: 'var(--mute)', lineHeight: 1.55, marginTop: 4 }}>{item.note}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * TrendCard (#156 / #166) — chart IS the card's visual identity.
 *
 * Layout: header (~140px) sits on top of a tall chart (~200px). Total
 * card height is content-driven, no min-height padding to fake-fill.
 * Charts get real space to breathe — previously they were a tiny strip
 * with dead space below. The CHART carries the visual weight.
 *
 * For statistic cards with no trend data (VO2, CADENCE), use <StatCard />
 * instead — same eyebrow + hero + narrative + sub, smaller height,
 * no chart slot.
 */
function TrendCard({
  title, titleColor, value, valueColor, sub, narrative, chart,
}: {
  title: string;
  titleColor: string;
  value: string;
  valueColor: string;
  sub: string;
  /** One bold trend sentence — "Sleep debt has grown 3 nights running" etc. */
  narrative?: string;
  chart: React.ReactNode;
}) {
  return (
    <div style={{ borderTop: '1px solid var(--line)', padding: '18px 0 0', display: 'flex', flexDirection: 'column' }}>
      <div className="card-eyebrow" style={{ color: titleColor, marginBottom: 10 }}>{title}</div>

      {/* Hero number — proper editorial scale */}
      <div style={{
        fontFamily: 'var(--f-display)',
        fontSize: 88,
        color: valueColor,
        letterSpacing: '0.5px',
        lineHeight: 0.95,
        marginBottom: 8,
      }}>
        {value}
      </div>

      {/* Trend insight — the punchline */}
      {narrative && (
        <div style={{
          fontFamily: 'var(--f-body)',
          fontSize: 14,
          fontWeight: 600,
          color: 'var(--ink)',
          lineHeight: 1.4,
          marginBottom: 6,
        }}>
          {narrative}
        </div>
      )}

      {/* Sub line — precision specs */}
      <div style={{
        fontFamily: 'var(--f-body)',
        fontSize: 11,
        color: 'var(--mute)',
        letterSpacing: '0.4px',
        marginBottom: 16,
        lineHeight: 1.4,
      }}>
        {sub}
      </div>

      {/* Chart fills the bottom — big enough to actually read */}
      <div style={{ flex: 1, minHeight: 180 }}>
        {chart}
      </div>
    </div>
  );
}

/**
 * StatCard — for /health stats with no trend chart yet (VO2, CADENCE).
 * Just eyebrow + hero + narrative + sub. Sits ~180-200px tall — sized
 * to its content, not inflated to TrendCard height.
 */
function StatCard({
  title, titleColor, value, valueColor, sub, narrative,
}: {
  title: string;
  titleColor: string;
  value: string;
  valueColor: string;
  sub: string;
  narrative?: string;
}) {
  return (
    <div style={{ borderTop: '1px solid var(--line)', padding: '18px 0 0' }}>
      <div className="card-eyebrow" style={{ color: titleColor, marginBottom: 10 }}>{title}</div>
      <div style={{
        fontFamily: 'var(--f-display)',
        fontSize: 72,
        color: valueColor,
        letterSpacing: '0.5px',
        lineHeight: 0.95,
        marginBottom: 8,
      }}>
        {value}
      </div>
      {narrative && (
        <div style={{
          fontFamily: 'var(--f-body)',
          fontSize: 14, fontWeight: 600,
          color: 'var(--ink)', lineHeight: 1.4, marginBottom: 4,
        }}>
          {narrative}
        </div>
      )}
      <div style={{
        fontFamily: 'var(--f-body)', fontSize: 11,
        color: 'var(--mute)', letterSpacing: '0.4px', lineHeight: 1.4,
      }}>
        {sub}
      </div>
    </div>
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

/**
 * Narrative builders (#156). One bold sentence per metric — the actual
 * coaching insight. These are deterministic plain-English summaries; the
 * coach voice on /today still does the full prose, but every dashboard
 * card stands alone with a useful sentence.
 */
function sleepNarrative(avg7n: number | null | undefined): string {
  if (avg7n == null) return 'Need 7+ nights of sleep data before this gets useful.';
  const debt = +(7.5 - avg7n).toFixed(1);
  if (debt >= 1.5) return `${(debt * 7).toFixed(0)}h short of target for the week — watch for fatigue creep.`;
  if (debt >= 0.5) return `Mildly short of target — recoverable with one solid night.`;
  if (debt <= -0.3) return `Sleeping above target. Recovery's on your side this week.`;
  return `Sitting right at the target line. Hold it.`;
}

function rhrNarrative(delta: number | null | undefined): string {
  if (delta == null) return 'Resting HR baseline still forming — needs more data.';
  if (delta >= 5) return `+${delta} bpm above baseline — stress, sleep, or accumulating load. Watch tomorrow.`;
  if (delta >= 2) return `Slightly elevated — typical mid-week, but flag it if it doesn't settle.`;
  if (delta <= -2) return `Below baseline — strong recovery signal.`;
  return `At baseline — typical resting cardio.`;
}

function hrvNarrative(pctAboveBaseline: number | null | undefined): string {
  if (pctAboveBaseline == null) return 'HRV trend forming — needs more nights of data.';
  if (pctAboveBaseline >= 5) return `+${pctAboveBaseline}% above baseline — fresh recovery, you can press today.`;
  if (pctAboveBaseline >= -3) return `Within normal nightly variance — system's stable.`;
  if (pctAboveBaseline >= -10) return `${pctAboveBaseline}% below baseline — could be stress, sleep, or accumulating load. Watch tomorrow.`;
  return `${pctAboveBaseline}% below baseline — strong signal to back off if it persists.`;
}

function vo2Narrative(v: number | null | undefined): string {
  if (v == null) return 'No reading yet — needs a few outdoor runs on the watch.';
  if (v >= 60) return 'Elite-adjacent aerobic ceiling.';
  if (v >= 50) return 'Strong aerobic engine — well above the average runner.';
  if (v >= 40) return 'Solid recreational range — room to grow with consistent base work.';
  return 'Foundational range — base mileage is the biggest lever here.';
}

function cadenceNarrative(c: number | null | undefined): string {
  if (c == null) return 'Needs more cadence data from recent runs.';
  if (c >= 175) return 'Efficient turnover — well-tuned stride.';
  if (c >= 165) return 'In the optimal band — keep it here.';
  if (c >= 155) return 'A touch low — shorter, quicker steps will lift it.';
  return 'Low — overstriding likely. Worth a form drill block.';
}

function weightNarrative(delta30: number | null | undefined): string {
  if (delta30 == null) return 'Need at least two weighings 30 days apart to read the trend.';
  if (Math.abs(delta30) < 0.5) return 'Stable over the last month — no flags.';
  if (delta30 <= -3) return `Down ${Math.abs(delta30).toFixed(1)} lb in 30 days — make sure fueling's keeping up with training load.`;
  if (delta30 <= -1) return `Trending down — gradual, in range for a training block.`;
  if (delta30 >= 3) return `Up ${delta30.toFixed(1)} lb in 30 days — track whether it's deliberate.`;
  return `Up slightly over the month.`;
}
