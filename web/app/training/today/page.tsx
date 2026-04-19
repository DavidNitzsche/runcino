import Link from 'next/link';
import { Nav, Footer } from '../../../components/nav';
import { generateBlock, workoutForDate } from '../../../lib/training';
import { formatPaceMi } from '../../../lib/time';

export default async function TodayWorkoutPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string }>;
}) {
  const params = await searchParams;
  const block = generateBlock({
    goalRaceName: 'Big Sur Marathon',
    goalRaceDate: '2026-04-26',
    weeksTotal: 18,
    peakMpw: 50,
    basePaceSPerMi: 526,
    hilly: true,
  });

  const date = params.date ?? block.weeks[block.weeks.length - 1].days[5].date;
  const result = workoutForDate(block, date);

  if (!result) {
    return (
      <main style={{ maxWidth: 1180, margin: '0 auto', padding: '0 32px' }}>
        <Nav active="training" />
        <section style={{ padding: '48px 0' }}>
          <h1 style={{ fontSize: 40, marginBottom: 16 }}>No workout on {date}</h1>
          <Link href="/training" className="btn btn-primary">Back to week view</Link>
        </section>
      </main>
    );
  }

  const { day, week } = result;
  const paceStr = day.targetPaceSPerMi !== null ? formatPaceMi(day.targetPaceSPerMi) : '—';

  return (
    <main style={{ maxWidth: 1180, margin: '0 auto', padding: '0 32px' }}>
      <Nav active="training" />

      <section style={{ padding: '48px 0 16px' }}>
        <Link href="/training" style={{ fontSize: 14, color: 'var(--color-ink-3)', textDecoration: 'none' }}>← Back to week</Link>
        <div className="eyebrow" style={{ marginTop: 16, marginBottom: 8 }}>
          Week {week.weekNumber} · {week.phase}
        </div>
        <h1 style={{ fontSize: 48, margin: 0 }}>
          {day.label}
        </h1>
        <div style={{ fontSize: 18, color: 'var(--color-ink-3)', marginTop: 8 }}>
          {day.dow} · {day.date} · {day.summary}
        </div>
      </section>

      <section style={{ padding: '24px 0 48px' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 0.8fr', gap: 32 }}>
          <div>
            <div className="runcino-card" style={{ marginBottom: 16 }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16 }}>
                <DetailStat label="Distance" value={`${day.distanceMi.toFixed(1)} mi`} />
                <DetailStat label="Target pace" value={paceStr} />
                <DetailStat label="HR zone" value={day.targetHrZone ?? '—'} />
                <DetailStat label="Workout type" value={day.kind.replace('_', ' ')} />
              </div>
            </div>

            <div className="runcino-card" style={{ marginBottom: 16 }}>
              <div className="eyebrow" style={{ marginBottom: 12 }}>Workout structure</div>
              <WorkoutStructure day={day} />
            </div>

            <div className="runcino-card" style={{ background: 'var(--color-paper-2)' }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 10 }}>
                <div style={{ width: 22, height: 22, borderRadius: 6, background: 'var(--color-ink)', color: 'var(--color-paper)', display: 'grid', placeItems: 'center', fontFamily: 'var(--font-display)', fontStyle: 'italic', fontWeight: 600, fontSize: 12 }}>C</div>
                <div className="eyebrow">Why this workout</div>
              </div>
              <p style={{ margin: 0, fontSize: 15, lineHeight: 1.6, color: 'var(--color-ink-2)' }}>
                {day.rationale}
              </p>
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div className="runcino-card" style={{ background: 'var(--color-ink)', color: 'var(--color-paper)', borderColor: 'var(--color-ink)' }}>
              <div className="eyebrow" style={{ color: 'var(--color-terracotta-2)', marginBottom: 8 }}>Send to Watch</div>
              <h4 style={{ color: 'var(--color-paper)', fontSize: 20, marginBottom: 8 }}>Sync as CustomWorkout</h4>
              <p style={{ color: 'var(--color-paper-3)', fontSize: 13, margin: '0 0 16px', lineHeight: 1.5 }}>
                Exports this session as a WorkoutKit CustomWorkout — same pipeline as race day. Starts with your chosen tolerance, haptics on pace drift, auto-advance through reps.
              </p>
              <button className="btn btn-accent" style={{ width: '100%' }} disabled>
                Generate .runcino-workout.json (M3 build)
              </button>
              <div style={{ fontSize: 11, color: 'var(--color-ink-4)', marginTop: 10 }}>
                Wired at M3 milestone — engine already exists in lib/training.ts
              </div>
            </div>

            <div className="runcino-card">
              <div className="eyebrow" style={{ marginBottom: 12 }}>Recent data</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: 13 }}>
                <DataRow label="Last easy run" value="Sat · 8.0 mi @ 9:20/mi" />
                <DataRow label="Resting HR (7d avg)" value="48 bpm · ↓ 2" />
                <DataRow label="HRV (7d avg)" value="58 ms · ↑ 4" />
                <DataRow label="Sleep (7d avg)" value="7h 28m · 84%" />
              </div>
              <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--color-line)', fontSize: 11, color: 'var(--color-ink-4)' }}>
                Mocked for M0. Real HealthKit data at M2.
              </div>
            </div>
          </div>
        </div>
      </section>

      <Footer tag="M3 · today's workout" />
    </main>
  );
}

function DetailStat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="eyebrow" style={{ fontSize: 10, marginBottom: 6 }}>{label}</div>
      <div className="font-mono" style={{ fontSize: 18, fontWeight: 500, textTransform: 'capitalize' }}>{value}</div>
    </div>
  );
}

function DataRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
      <span style={{ color: 'var(--color-ink-3)' }}>{label}</span>
      <span className="font-mono" style={{ color: 'var(--color-ink)' }}>{value}</span>
    </div>
  );
}

function WorkoutStructure({ day }: { day: ReturnType<typeof workoutForDate> extends (infer T | null) ? T extends { day: infer D } ? D : never : never }) {
  if (day.kind === 'rest') {
    return <p style={{ color: 'var(--color-ink-3)', margin: 0 }}>Rest day. Go for a walk or skip entirely — the plan builds in recovery.</p>;
  }

  const segments = structureFor(day);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {segments.map((s, i) => (
        <div key={i} style={{
          display: 'flex',
          justifyContent: 'space-between',
          padding: 12,
          background: 'var(--color-paper-2)',
          borderRadius: 10,
          borderLeft: `3px solid ${s.color}`,
        }}>
          <div>
            <div style={{ fontWeight: 500, fontSize: 14 }}>{s.label}</div>
            {s.detail && <div className="font-mono" style={{ fontSize: 12, color: 'var(--color-ink-3)', marginTop: 2 }}>{s.detail}</div>}
          </div>
          <div className="font-mono" style={{ fontSize: 14, fontWeight: 500, color: 'var(--color-ink)' }}>
            {s.amount}
          </div>
        </div>
      ))}
    </div>
  );
}

type DayRaw = { kind: string; distanceMi: number; targetPaceSPerMi: number | null };
function structureFor(day: DayRaw): Array<{ label: string; detail?: string; amount: string; color: string }> {
  const pace = day.targetPaceSPerMi !== null ? formatPaceMi(day.targetPaceSPerMi) : '—';
  switch (day.kind) {
    case 'easy':
    case 'recovery':
      return [
        { label: day.kind === 'recovery' ? 'Recovery pace' : 'Easy pace', detail: `whole run at ${pace}`, amount: `${day.distanceMi.toFixed(1)} mi`, color: 'var(--color-sage)' },
      ];
    case 'long':
    case 'long_hilly':
      return [
        { label: 'Warmup', detail: 'easier first mile', amount: '1.0 mi', color: 'var(--color-sage)' },
        { label: day.kind === 'long_hilly' ? 'Long run (hilly)' : 'Long run', detail: `target ${pace}`, amount: `${(day.distanceMi - 1).toFixed(1)} mi`, color: 'var(--color-terracotta)' },
      ];
    case 'tempo': {
      const work = Math.max(1, Math.round(day.distanceMi * 0.6));
      const warm = Math.max(1, Math.round((day.distanceMi - work) / 2));
      const cool = day.distanceMi - work - warm;
      return [
        { label: 'Warmup easy', amount: `${warm.toFixed(1)} mi`, color: 'var(--color-sage)' },
        { label: 'Tempo block', detail: `at ${pace}`, amount: `${work.toFixed(1)} mi`, color: 'var(--color-terracotta)' },
        { label: 'Cooldown easy', amount: `${cool.toFixed(1)} mi`, color: 'var(--color-sage)' },
      ];
    }
    case 'intervals': {
      const reps = Math.max(4, Math.min(8, Math.round(day.distanceMi * 0.7)));
      return [
        { label: 'Warmup easy', amount: '1.5 mi', color: 'var(--color-sage)' },
        { label: `${reps} × 800m`, detail: `at ${pace} · 400m jog between`, amount: `${(reps * 0.5 + (reps - 1) * 0.25).toFixed(1)} mi`, color: 'var(--color-terracotta)' },
        { label: 'Cooldown easy', amount: '1.0 mi', color: 'var(--color-sage)' },
      ];
    }
    case 'strides':
      return [
        { label: 'Easy run', detail: `at conversational pace`, amount: `${day.distanceMi.toFixed(1)} mi`, color: 'var(--color-sage)' },
        { label: '6 × 20s strides', detail: `near ${pace} · full recovery between`, amount: 'end of run', color: 'var(--color-terracotta)' },
      ];
    default:
      return [
        { label: day.kind, amount: `${day.distanceMi.toFixed(1)} mi`, color: 'var(--color-sage)' },
      ];
  }
}
