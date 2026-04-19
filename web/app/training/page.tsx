import Link from 'next/link';
import { Nav, Footer } from '../../components/nav';
import { generateBlock, currentWeekNumber, type DayWorkout, type WeekPlan } from '../../lib/training';
import { formatPaceMi } from '../../lib/time';

export default function TrainingPage() {
  const block = generateBlock({
    goalRaceName: 'Big Sur Marathon',
    goalRaceDate: '2026-04-26',
    weeksTotal: 18,
    peakMpw: 50,
    basePaceSPerMi: 526,   // derived from LA 3:40 baseline
    hilly: true,
  });
  // Use a fixed "today" so the page is deterministic regardless of real date
  const todayISO = '2026-04-19';
  const currentWeek = currentWeekNumber(todayISO, block);
  const thisWeek = block.weeks[currentWeek - 1];
  const todayWorkout = thisWeek.days.find(d => d.date === todayISO) ?? thisWeek.days[0];

  return (
    <main style={{ maxWidth: 1180, margin: '0 auto', padding: '0 32px' }}>
      <Nav active="training" />

      <section style={{ padding: '48px 0 16px' }}>
        <div className="runcino-pill runcino-pill-sage" style={{ marginBottom: 16, display: 'inline-flex' }}>
          <span className="runcino-pill-dot" style={{ background: 'var(--color-sage)' }} /> M3 · Training capability
        </div>
        <h1 style={{ fontSize: 52, maxWidth: '24ch', margin: '0 0 12px' }}>
          No more Runna.<br />
          <span className="serif-italic">Runcino coaches every day.</span>
        </h1>
        <p style={{ fontSize: 18, color: 'var(--color-ink-3)', maxWidth: '62ch', lineHeight: 1.5 }}>
          An 18-week periodized build for Big Sur — base / build / peak / taper. Generated now by a rule-based engine; Claude-swappable when approved. Each daily workout ships to your Watch as a CustomWorkout.
        </p>
      </section>

      <section style={{ padding: '32px 0 48px' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 340px', gap: 16 }}>
          <div className="runcino-card" style={{ padding: 32 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
              <div>
                <div className="eyebrow" style={{ marginBottom: 6 }}>
                  Week {thisWeek.weekNumber} of {block.weeksTotal} · {thisWeek.phase} block
                </div>
                <h3 style={{ fontSize: 28 }}>This week</h3>
              </div>
              <div style={{ display: 'flex', gap: 16, fontSize: 13, color: 'var(--color-ink-3)' }}>
                <div>
                  <span className="font-mono" style={{ color: 'var(--color-ink)', fontWeight: 600, fontSize: 18 }}>
                    {thisWeek.totalDistanceMi}
                  </span> mi
                </div>
                <div>
                  <span className="font-mono" style={{ color: 'var(--color-ink)', fontWeight: 600, fontSize: 18 }}>
                    {thisWeek.days.filter(d => d.kind === 'rest').length}
                  </span> rest
                </div>
              </div>
            </div>

            <p style={{ color: 'var(--color-ink-3)', margin: '8px 0 24px', fontSize: 14 }}>{thisWeek.narrative}</p>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 8 }}>
              {thisWeek.days.map(d => <DayCard key={d.date} day={d} isToday={d.date === todayISO} />)}
            </div>

            <TodayCard day={todayWorkout} weekPhase={thisWeek.phase} />
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <ReadinessCard />
            <div className="runcino-card" style={{ background: 'var(--color-ink)', color: 'var(--color-paper)', borderColor: 'var(--color-ink)' }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 10 }}>
                <div style={{ width: 22, height: 22, borderRadius: 6, background: 'var(--color-terracotta)', display: 'grid', placeItems: 'center', fontFamily: 'var(--font-display)', fontStyle: 'italic', fontWeight: 600, fontSize: 12 }}>C</div>
                <div className="eyebrow" style={{ color: 'var(--color-terracotta-2)' }}>This week's logic</div>
              </div>
              <p style={{ color: 'var(--color-paper)', fontSize: 14, lineHeight: 1.55, margin: 0 }}>
                {thisWeek.narrative} Big Sur has 2,182 ft gain and Hurricane Point between miles 10-12 — Saturday's long run simulates that profile. After this peak, taper begins.
              </p>
            </div>
            <TaperCard block={block} currentWeek={currentWeek} />
          </div>
        </div>
      </section>

      <PeriodizationStrip block={block} currentWeek={currentWeek} />

      <Footer tag="M3 · training capability" />
    </main>
  );
}

function DayCard({ day, isToday }: { day: DayWorkout; isToday: boolean }) {
  const isRest = day.kind === 'rest';
  const borderColor =
    isToday ? 'var(--color-terracotta)' :
    isRest ? 'var(--color-line)' :
    'var(--color-ok)';
  const background = isToday ? 'var(--color-terracotta-3)' : 'var(--color-paper-2)';
  const href = `/training/today?date=${day.date}`;
  return (
    <Link href={href} style={{
      padding: '14px 12px',
      background,
      borderRadius: 12,
      border: `${isToday ? '2px' : '1px'} solid ${borderColor}`,
      textDecoration: 'none',
      color: 'inherit',
      display: 'block',
      transition: 'transform 120ms',
    }}>
      <div style={{ fontSize: 11, color: 'var(--color-ink-3)', fontWeight: 600, marginBottom: 6 }}>
        {day.dow} · {day.date.slice(5).replace('-', '/')}
        {isToday && <span style={{ color: 'var(--color-terracotta)', marginLeft: 4 }}>· TODAY</span>}
      </div>
      <div style={{ fontSize: 13, fontWeight: isToday ? 700 : 600, marginBottom: 4, color: isRest ? 'var(--color-ink-3)' : 'var(--color-ink)' }}>
        {day.label}
      </div>
      {!isRest && (
        <div className="font-mono" style={{ fontSize: 11, color: 'var(--color-ink-3)' }}>
          {day.distanceMi.toFixed(1)} mi
        </div>
      )}
    </Link>
  );
}

function TodayCard({ day, weekPhase }: { day: DayWorkout; weekPhase: string }) {
  const paceStr = day.targetPaceSPerMi !== null ? formatPaceMi(day.targetPaceSPerMi) : '—';
  return (
    <div style={{ marginTop: 24, padding: 24, background: '#FBF0EB', borderRadius: 16, border: '1px solid var(--color-terracotta-3)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
        <div>
          <div className="eyebrow" style={{ color: 'var(--color-terracotta)', marginBottom: 6 }}>Today · ready to start</div>
          <h4 style={{ fontSize: 22 }}>{day.label}</h4>
          <div style={{ fontSize: 13, color: 'var(--color-ink-3)', marginTop: 4 }}>{day.summary}</div>
        </div>
        <Link href={`/training/today?date=${day.date}`} className="btn btn-accent">Open workout →</Link>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16 }}>
        <Stat label="Distance" value={`${day.distanceMi.toFixed(1)} mi`} />
        <Stat label="Target pace" value={paceStr} />
        <Stat label="HR zone" value={day.targetHrZone ?? '—'} />
        <Stat label="Phase" value={weekPhase} />
      </div>

      <div style={{ marginTop: 16, paddingTop: 16, borderTop: '1px solid var(--color-terracotta-3)' }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
          <div style={{ width: 20, height: 20, borderRadius: 6, background: 'var(--color-ink)', color: 'var(--color-paper)', display: 'grid', placeItems: 'center', fontFamily: 'var(--font-display)', fontStyle: 'italic', fontWeight: 600, fontSize: 11 }}>C</div>
          <strong style={{ fontSize: 13 }}>Why this workout</strong>
        </div>
        <p style={{ fontSize: 13, color: 'var(--color-ink-2)', margin: 0, lineHeight: 1.55 }}>
          {day.rationale}
        </p>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="eyebrow" style={{ fontSize: 10, color: 'var(--color-ink-3)', marginBottom: 4 }}>{label}</div>
      <div className="font-mono" style={{ fontWeight: 500 }}>{value}</div>
    </div>
  );
}

function ReadinessCard() {
  return (
    <div className="runcino-card">
      <div className="eyebrow" style={{ marginBottom: 12 }}>Readiness · today</div>
      <div style={{ textAlign: 'center', marginBottom: 16 }}>
        <div className="font-display" style={{ fontSize: 56, fontWeight: 500, color: 'var(--color-ok)', lineHeight: 1 }}>84</div>
        <div style={{ fontSize: 12, color: 'var(--color-ink-3)', marginTop: 4 }}>out of 100 · green light</div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: 12 }}>
        <ReadinessRow label="HRV 58 ms" delta="↑ 4 ms" color="var(--color-ok)" />
        <ReadinessRow label="Sleep 7h 42m" delta="86%" color="var(--color-ok)" />
        <ReadinessRow label="Resting HR 48" delta="→ stable" color="var(--color-ok)" />
        <ReadinessRow label="7d load" delta="+12% ↑" color="var(--color-gold)" />
      </div>
      <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--color-line)', fontSize: 11, color: 'var(--color-ink-4)' }}>
        Data: mocked today; HealthKit-backed in M2
      </div>
    </div>
  );
}

function ReadinessRow({ label, delta, color }: { label: string; delta: string; color: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
      <span style={{ color: 'var(--color-ink-3)' }}>{label}</span>
      <span style={{ color }}>{delta}</span>
    </div>
  );
}

function TaperCard({ block, currentWeek }: { block: ReturnType<typeof generateBlock>; currentWeek: number }) {
  const remaining = block.weeks.slice(currentWeek).slice(0, 4);
  return (
    <div className="runcino-card" style={{ background: 'var(--color-paper-2)' }}>
      <div className="eyebrow" style={{ marginBottom: 10 }}>Ahead</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: 13, color: 'var(--color-ink-2)' }}>
        {remaining.map(w => (
          <div key={w.weekNumber} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--color-sage)' }} />
            <span>Week {w.weekNumber}: {w.totalDistanceMi} mi, {w.phase}</span>
          </div>
        ))}
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 4 }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--color-terracotta)' }} />
          <strong>Apr 26 · {block.goalRace}</strong>
        </div>
      </div>
    </div>
  );
}

function PeriodizationStrip({ block, currentWeek }: { block: ReturnType<typeof generateBlock>; currentWeek: number }) {
  const baseWeeks = block.weeks.filter(w => w.phase === 'base').length;
  const buildWeeks = block.weeks.filter(w => w.phase === 'build').length;
  const peakWeeks = block.weeks.filter(w => w.phase === 'peak').length;
  const taperWeeks = block.weeks.filter(w => w.phase === 'taper').length;
  const W = 1000, H = 180;
  const scale = (n: number) => (n / block.weeksTotal) * W;
  const phaseColors: Record<string, string> = {
    base: 'var(--color-sage-2)',
    build: '#D4B475',
    peak: 'var(--color-terracotta-2)',
    taper: 'var(--color-terracotta)',
  };
  const phaseWidths = [baseWeeks, buildWeeks, peakWeeks, taperWeeks];
  const phaseNames: Array<'base' | 'build' | 'peak' | 'taper'> = ['base', 'build', 'peak', 'taper'];
  let x = 0;

  return (
    <section style={{ padding: '0 0 48px' }}>
      <div className="eyebrow" style={{ marginBottom: 12 }}>Big Sur build · {block.weeksTotal} weeks</div>
      <h2 style={{ fontSize: 28, marginBottom: 24 }}>Periodization, visible.</h2>
      <div className="runcino-card" style={{ padding: 32 }}>
        <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto' }}>
          {phaseNames.map((name, i) => {
            const w = scale(phaseWidths[i]);
            const rect = (
              <g key={name}>
                <rect x={x} y={40} width={w} height={60} fill={phaseColors[name]} rx={8} />
                <text x={x + w / 2} y={72} fontFamily="Fraunces" fontSize="18" fill="white" textAnchor="middle" fontWeight="500" style={{ textTransform: 'capitalize' }}>{name}</text>
                <text x={x + w / 2} y={90} fontFamily="Inter" fontSize="11" fill="white" textAnchor="middle" opacity="0.85">{phaseWidths[i]} wk</text>
              </g>
            );
            x += w;
            return rect;
          })}
          {/* current-week marker */}
          <g>
            <line x1={scale(currentWeek - 0.5)} y1="30" x2={scale(currentWeek - 0.5)} y2="120" stroke="var(--color-ink)" strokeWidth="2" />
            <polygon points={`${scale(currentWeek - 0.5) - 8},28 ${scale(currentWeek - 0.5) + 8},28 ${scale(currentWeek - 0.5)},16`} fill="var(--color-ink)" />
            <text x={scale(currentWeek - 0.5)} y="148" fontFamily="Inter" fontSize="11" fill="var(--color-ink)" textAnchor="middle" fontWeight="600">W{currentWeek} · {block.weeks[currentWeek - 1].phase}</text>
            <text x={scale(currentWeek - 0.5)} y="162" fontFamily="Inter" fontSize="10" fill="var(--color-ink-3)" textAnchor="middle">today</text>
          </g>
          {/* mileage curve */}
          <path d={'M ' + block.weeks.map((w, i) => `${scale(i) + scale(1) / 2} ${135 - w.totalDistanceMi * 0.8}`).join(' L ')}
                fill="none" stroke="var(--color-ink)" strokeWidth="1.5" opacity="0.4" />
        </svg>
      </div>
    </section>
  );
}
