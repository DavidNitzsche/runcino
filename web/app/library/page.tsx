'use client';

/**
 * /library — workout type & session library.
 *
 * Mission: a reference for every workout type the engine prescribes.
 * The runner who sees "threshold_intervals" on today's prescription
 * and wonders "what is that exactly" can land here, see the doctrine
 * definition, the example session, and what it builds.
 *
 * Each card is one workout TYPE (the engine's WorkoutType union).
 * Cards include: name, what it builds, structure, target intensity,
 * doctrine citation, and an example session at a typical fitness.
 */

import Link from 'next/link';
import { Caption, Nav } from '../../components/nav';

interface WorkoutDef {
  type: string;
  name: string;
  what: string;
  builds: string;
  structure: string;
  intensity: 'easy' | 'aerobic' | 'tempo' | 'threshold' | 'vo2' | 'race' | 'rest';
  exampleAtVdot44: string;
  citation: string;
}

const INTENSITY_COLORS: Record<WorkoutDef['intensity'], string> = {
  easy:      'var(--color-success)',
  aerobic:   'var(--color-success)',
  tempo:     'var(--color-attention)',
  threshold: 'var(--color-attention)',
  vo2:       'var(--color-warning)',
  race:      'var(--color-warning)',
  rest:      'var(--color-t3)',
};

const WORKOUTS: WorkoutDef[] = [
  {
    type: 'rest',
    name: 'Rest day',
    what: 'No running. Walking, mobility, light stretching are fine. Sleep + food + fluids are the actual training input today.',
    builds: 'Adaptation. The body assembles fitness DURING recovery, not during the run. Skip recovery and you trade fitness for fatigue.',
    structure: 'No structure. The session is doing nothing.',
    intensity: 'rest',
    exampleAtVdot44: 'Walk 20 min · 10 min hip flexor + ankle mobility · 8 hr sleep target',
    citation: 'Research/00b §Recovery basics',
  },
  {
    type: 'recovery',
    name: 'Recovery run',
    what: 'Very easy circulation run. Slower than easy. Conversational without the slightest strain. The point is blood flow, not training stimulus.',
    builds: 'Active recovery between hard sessions. Aerobic base maintenance with near-zero training cost.',
    structure: 'Continuous easy run, 2-4 mi, no quality, no progression.',
    intensity: 'easy',
    exampleAtVdot44: '3 mi @ 9:30-10:00/mi · sub-zone-2 HR · zero strides',
    citation: 'Research/00a §Recovery zone',
  },
  {
    type: 'easy',
    name: 'Easy run',
    what: 'The default aerobic run. Conversational throughout. ~70% of weekly mileage lives here in a polarized plan.',
    builds: 'Aerobic base. Capillary density. Mitochondrial efficiency. The slow-build foundation that EVERYTHING else stands on.',
    structure: 'Continuous, 4-7 mi, even pace.',
    intensity: 'easy',
    exampleAtVdot44: '5 mi @ 9:00-9:30/mi · zone 2 HR · optional 4×30s strides at the end',
    citation: 'Research/01 §E pace',
  },
  {
    type: 'general_aerobic',
    name: 'General aerobic',
    what: 'A notch above easy. Slightly faster (still aerobic), longer than recovery. Often the "default training day".',
    builds: 'Aerobic capacity. Mid-zone-2 stimulus that keeps building base without the cost of harder work.',
    structure: 'Continuous, 5-8 mi, steady aerobic effort.',
    intensity: 'aerobic',
    exampleAtVdot44: '6 mi @ 8:30-9:00/mi · zone 2 HR · steady throughout',
    citation: 'Research/01 §M-E spectrum',
  },
  {
    type: 'medium_long',
    name: 'Medium-long run',
    what: 'Bridges easy and long. Mid-week sustained aerobic block.',
    builds: 'Aerobic endurance with less recovery cost than a true long run. Useful for high-mileage weeks.',
    structure: 'Continuous, 7-12 mi, steady easy-aerobic pace.',
    intensity: 'aerobic',
    exampleAtVdot44: '9 mi @ 8:30-9:00/mi · conversational throughout',
    citation: 'Research/00b §Volume + Long Run',
  },
  {
    type: 'long_steady',
    name: 'Long run',
    what: 'The week\'s anchor session. Time-on-feet at a conversational pace. Builds muscular and metabolic endurance.',
    builds: 'Glycogen storage capacity. Connective tissue resilience. Mental durability. Marathon specificity (for marathon training).',
    structure: 'Continuous, 12-20+ mi, conversational throughout.',
    intensity: 'aerobic',
    exampleAtVdot44: '14 mi @ 8:30-9:00/mi · steady; fuel/hydrate as you would on race day',
    citation: 'Research/00b §The Long Run',
  },
  {
    type: 'long_progression',
    name: 'Long progression',
    what: 'Long run that finishes faster than it starts. Last 2-4 mi at marathon pace or just below.',
    builds: 'Closing-mile fitness. Teaches the body to run on tired legs without falling apart.',
    structure: 'Easy 60-70%, then gradual build, last block at MP.',
    intensity: 'tempo',
    exampleAtVdot44: '12 mi: 8 mi @ 8:30/mi → 4 mi @ 7:30/mi (MP)',
    citation: 'Research/00b §Long Run Variations',
  },
  {
    type: 'long_mp_block',
    name: 'Long with MP blocks',
    what: 'Long run with one or two sustained marathon-pace segments embedded. Race-specific specificity for marathoners.',
    builds: 'Marathon-pace efficiency. Race-day fueling rehearsal. Confidence at goal pace under fatigue.',
    structure: 'Easy warmup, MP block (e.g. 4-8 mi), easy float, optional second MP block, easy cooldown.',
    intensity: 'tempo',
    exampleAtVdot44: '14 mi: 3 mi easy, 6 mi @ 7:30/mi (MP), 5 mi easy',
    citation: 'Research/00b §MP-Specific',
  },
  {
    type: 'long_fast_finish',
    name: 'Long fast-finish',
    what: 'Long run with a HARD final 2-3 miles. Tougher than progression — the close is at threshold, not MP.',
    builds: 'Race-specific late-race grit. Glycogen-depleted hard running.',
    structure: 'Easy 75-85%, last 2-3 mi at threshold pace.',
    intensity: 'threshold',
    exampleAtVdot44: '12 mi: 9 mi @ 8:30/mi, 3 mi @ 7:00/mi (T pace)',
    citation: 'Research/00b §Long Run Variations',
  },
  {
    type: 'tempo_continuous',
    name: 'Tempo run',
    what: 'Continuous comfortably-hard effort. "Comfortably hard" = you can speak in short phrases, not full sentences.',
    builds: 'Lactate threshold. Tolerance for race-specific race pace (mostly half-marathon).',
    structure: 'Warmup → 3-6 mi at T pace → cooldown.',
    intensity: 'tempo',
    exampleAtVdot44: '7 mi total: 1.5 mi WU, 4 mi @ 7:00-7:15/mi (T pace), 1.5 mi CD',
    citation: 'Research/01 §T pace',
  },
  {
    type: 'threshold_intervals',
    name: 'Threshold intervals',
    what: 'Threshold pace work broken into reps with short floats. Lets you accumulate more T-time than continuous tempo without the cost.',
    builds: 'Lactate threshold. Tolerance for sustained hard running.',
    structure: 'Warmup → 4-6 × 5-15 min @ T with 1-3 min float jog → cooldown.',
    intensity: 'threshold',
    exampleAtVdot44: '5 × 1 mi @ 7:00/mi w/ 90s float · 1.5 mi WU + 1 mi CD = 8 mi total',
    citation: 'Research/01 §T intervals',
  },
  {
    type: 'sub_threshold',
    name: 'Sub-threshold',
    what: 'Reps just below T pace (5-15 sec/mi slower). Big aerobic stimulus, low recovery cost.',
    builds: 'Aerobic ceiling without burning out the runner. Norwegian-style "low cost / high yield" session.',
    structure: 'Warmup → 6-12 × 1-2 km at sub-T → cooldown.',
    intensity: 'tempo',
    exampleAtVdot44: '8 × 1 km @ 7:15/mi w/ 60s float · ~7 mi total',
    citation: 'Research/00b §Norwegian Method',
  },
  {
    type: 'vo2',
    name: 'VO2 intervals',
    what: 'Fast, short reps at 5K-3K race pace. The session that pushes the aerobic ceiling.',
    builds: 'VO2max. Top-end aerobic capacity. Mile/5K race speed.',
    structure: 'Warmup → 5-8 × 800-1200m at I pace w/ near-equal recovery → cooldown.',
    intensity: 'vo2',
    exampleAtVdot44: '6 × 1000m @ 6:30/mi (I pace) w/ 3 min jog · 7 mi total',
    citation: 'Research/01 §I pace',
  },
  {
    type: 'marathon_specific',
    name: 'Marathon-specific',
    what: 'A sustained block at marathon goal pace. Cornerstone of the final 6-8 weeks of marathon prep.',
    builds: 'Race-pace neuromuscular pattern. Fueling/cadence/form rehearsal at MP.',
    structure: 'Warmup → 6-12 mi at MP → cooldown.',
    intensity: 'tempo',
    exampleAtVdot44: '11 mi: 1.5 mi WU, 8 mi @ 7:30/mi (MP), 1.5 mi CD',
    citation: 'Research/00b §MP-Specific',
  },
  {
    type: 'marathon_specific_combo',
    name: 'MP combo',
    what: 'Marathon-pace work mixed with paces faster than MP. Sharpening tool late in a build.',
    builds: 'Pace flexibility around MP. Late-race surge capability.',
    structure: '4 mi @ MP + 2 mi @ T + 2 mi @ MP, in various combinations.',
    intensity: 'tempo',
    exampleAtVdot44: '10 mi: 3 mi @ MP, 2 mi @ T, 3 mi @ MP, 2 mi CD',
    citation: 'Research/00b §MP Combos',
  },
  {
    type: 'strides',
    name: 'Strides',
    what: '4-8 short, controlled accelerations (~20 sec each) at the end of an easy run. Not all-out, not slow.',
    builds: 'Neuromuscular freshness. Form patterns. Cheap speed maintenance — almost zero training cost.',
    structure: 'After easy run: 4-8 × 20-30 sec accelerations to ~mile pace, full recovery between.',
    intensity: 'easy',
    exampleAtVdot44: 'After 4 mi easy: 6 × 20 sec strides @ ~5:30/mi, walk back recovery',
    citation: 'Research/01 §Strides',
  },
  {
    type: 'hill_sprints',
    name: 'Hill sprints',
    what: 'Short, max-effort hill sprints with full recovery. Pure neuromuscular + power session.',
    builds: 'Strength. Power. Neuromuscular recruitment. Bonus injury-resistance.',
    structure: '5-10 × 8-15 sec hill sprints with 2-3 min walk-back recovery.',
    intensity: 'vo2',
    exampleAtVdot44: 'After 2 mi WU: 8 × 10 sec hill sprints @ all-out, 2 min walk-back',
    citation: 'Research/22 §Strength + Power',
  },
  {
    type: 'shakeout',
    name: 'Shakeout',
    what: 'Very short, very easy run. Pre-race or day-after-race. Just turn the legs over.',
    builds: 'Nothing trainable — but it loosens the legs and signals "today is race day".',
    structure: 'Continuous, 2-3 mi, conversational, 0 strides.',
    intensity: 'easy',
    exampleAtVdot44: '2 mi @ 9:30-10:00/mi · whatever feels right',
    citation: 'Research/14 §Race-week shakeout',
  },
  {
    type: 'race',
    name: 'Race',
    what: 'Race day. The session that all the others were preparing for.',
    builds: 'Confidence (in winning). Calibration (in losing). Either way: a fresh VDOT anchor.',
    structure: 'The race. Whatever pacing strategy the plan calls for.',
    intensity: 'race',
    exampleAtVdot44: 'Half marathon @ 7:00/mi target, even effort, fuel at 30/60/90 min',
    citation: 'Research/14 §Race day',
  },
];

export default function LibraryPage() {
  return (
    <>
      <Caption left="Runcino · library" right="WORKOUT TYPES" />
      <div className="stage">
        <Nav active="training" />
        <div className="body">

          <div style={{ marginBottom: 24 }}>
            <div style={{ fontFamily: 'var(--font-data)', fontSize: 10, letterSpacing: '1.6px', color: 'var(--color-attention)', fontWeight: 700 }}>
              WORKOUT LIBRARY
            </div>
            <h1 style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 36, letterSpacing: '-.005em', margin: '6px 0 4px' }}>
              Every session, what it builds
            </h1>
            <div style={{ fontSize: 13, color: 'var(--color-t2)', maxWidth: 640, lineHeight: 1.55 }}>
              Whenever the engine prescribes a session you don&apos;t recognize, look it up here. Each entry: what it is, what it builds, the structure, an example at VDOT 44, and the doctrine citation.
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(380px, 1fr))', gap: 12 }}>
            {WORKOUTS.map(w => (
              <div key={w.type} className="tile" style={{
                padding: '18px 20px',
                display: 'flex', flexDirection: 'column', gap: 10,
                borderLeft: `3px solid ${INTENSITY_COLORS[w.intensity]}`,
              }}>
                <div className="tile-h">
                  <div>
                    <div style={{ fontFamily: 'var(--font-display)', fontSize: 18, fontWeight: 700, color: 'var(--color-t0)' }}>
                      {w.name}
                    </div>
                    <div style={{ fontFamily: 'var(--font-data)', fontSize: 9, fontWeight: 700, letterSpacing: '1.2px', color: 'var(--color-t3)', marginTop: 2 }}>
                      type: <span style={{ color: 'var(--color-t1)' }}>{w.type}</span>
                    </div>
                  </div>
                  <span style={{
                    fontFamily: 'var(--font-data)', fontSize: 9, fontWeight: 700, letterSpacing: '1.2px',
                    padding: '3px 7px', borderRadius: 3,
                    border: `1px solid ${INTENSITY_COLORS[w.intensity]}`, color: INTENSITY_COLORS[w.intensity],
                    textTransform: 'uppercase',
                  }}>{w.intensity}</span>
                </div>
                <div style={{ fontSize: 12.5, color: 'var(--color-t1)', lineHeight: 1.5 }}>
                  {w.what}
                </div>
                <Field label="Builds" value={w.builds} />
                <Field label="Structure" value={w.structure} />
                <Field label="Example · VDOT 44" value={w.exampleAtVdot44} mono />
                <div style={{ marginTop: 'auto', display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', paddingTop: 6, borderTop: '1px solid var(--color-l4)' }}>
                  <Link href={`/research/workouts`} style={{
                    fontFamily: 'var(--font-data)', fontSize: 9, fontWeight: 700, letterSpacing: '1.4px', color: 'var(--color-corporate)',
                    textDecoration: 'none',
                  }}>
                    {w.citation} →
                  </Link>
                </div>
              </div>
            ))}
          </div>

        </div>
      </div>
    </>
  );
}

function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <div style={{ fontFamily: 'var(--font-data)', fontSize: 9, fontWeight: 700, letterSpacing: '1.4px', color: 'var(--color-t3)', textTransform: 'uppercase', marginBottom: 3 }}>
        {label}
      </div>
      <div style={{
        fontSize: mono ? 11.5 : 12, color: 'var(--color-t2)', lineHeight: 1.5,
        fontFamily: mono ? 'var(--font-data)' : undefined,
      }}>
        {value}
      </div>
    </div>
  );
}
