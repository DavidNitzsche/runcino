'use client';

/**
 * /research — browseable doctrine.
 *
 * The 33 topic files in coach/doctrine/ surfaced as a card grid.
 * Each card opens to a topic detail view (/research/[topic]) that
 * dumps the file's exported constants + their citations.
 *
 * Why: trust is built by transparency. The runner trusts the coach
 * more when they can read the rules driving the prescription. Plus:
 * self-education path — the app becomes a textbook the runner can
 * study.
 */

import Link from 'next/link';
import { Caption, Nav } from '../../components/nav';

// Each topic maps to a coach/doctrine/<name>.ts file. The blurb is
// the runner-facing one-liner; the research link is the upstream
// markdown number.
const TOPICS: Array<{
  slug: string;
  title: string;
  blurb: string;
  research: string;
  category: 'physiology' | 'training' | 'nutrition' | 'recovery' | 'mental' | 'gear' | 'environment';
}> = [
  { slug: 'pace_zones',     title: 'Pace zones',          blurb: 'Daniels E/M/T/I/R bands derived from VDOT.',                        research: 'Research/01', category: 'training' },
  { slug: 'hr_zones',       title: 'Heart-rate zones',    blurb: '5-zone, 7-zone, Karvonen-derived zones from HRmax + RHR.',          research: 'Research/03', category: 'training' },
  { slug: 'intensity',      title: 'Intensity distribution', blurb: 'Polarized 80/20 vs threshold 70/30 vs pyramidal.',                research: 'Research/00a', category: 'training' },
  { slug: 'volume',         title: 'Volume + ACWR',       blurb: 'Acute:chronic load ratio, weekly mileage caps, progression rules.', research: 'Research/00b', category: 'training' },
  { slug: 'workouts',       title: 'Workout types',       blurb: 'Long, threshold, VO2, MP-specific — what each one builds.',         research: 'Research/00b', category: 'training' },
  { slug: 'plan_templates', title: 'Plan templates',      blurb: 'Daniels A/B/C, Pfitz 18/55, Hanson, custom — when each fits.',      research: 'Research/00b', category: 'training' },
  { slug: 'taper',          title: 'Taper',               blurb: 'Volume cuts, intensity preservation, the pre-race sharpening curve.', research: 'Research/14', category: 'training' },
  { slug: 'race_prediction',title: 'Race prediction',     blurb: 'Riegel + course adjustments to forecast finish times.',             research: 'Research/01', category: 'training' },
  { slug: 'pacing',         title: 'Pacing strategy',     blurb: 'Even effort vs even split vs negative split decisions.',            research: 'Research/00a', category: 'training' },
  { slug: 'race_week',      title: 'Race week',           blurb: 'Day-by-day taper protocol, last hard workout, shakeout.',           research: 'Research/14', category: 'training' },

  { slug: 'recovery',       title: 'Daily recovery',      blurb: 'Sleep, fueling, easy-day pacing — the daily basics.',               research: 'Research/00b', category: 'recovery' },
  { slug: 'recovery_protocols', title: 'Recovery protocols', blurb: 'Cutbacks, post-race ladders, MULTI_RACE_CADENCE, biomarkers.',  research: 'Research/00b', category: 'recovery' },
  { slug: 'post_race',      title: 'Post-race',           blurb: 'Day-1 → week-12 reverse-taper protocols by race distance.',         research: 'Research/00b', category: 'recovery' },
  { slug: 'injury_return',  title: 'Injury return',       blurb: 'Return-to-run protocols after layoff, rebuild ladders.',           research: 'Research/00b', category: 'recovery' },
  { slug: 'load',           title: 'Load management',     blurb: 'TRIMP, sRPE, ACWR — quantifying training stress.',                  research: 'Research/00b', category: 'recovery' },

  { slug: 'fueling',        title: 'Fueling',             blurb: 'Carb loading, in-race g/hr, gel timing, GI tolerance.',             research: 'Research/19', category: 'nutrition' },
  { slug: 'hydration',      title: 'Hydration',           blurb: 'Pre-race + during-race fluid + sodium, EAH risk factors.',          research: 'Research/19', category: 'nutrition' },

  { slug: 'strength',       title: 'Strength training',   blurb: 'Compound lifts, periodization, plyometrics for distance runners.', research: 'Research/22', category: 'training' },
  { slug: 'cross_training', title: 'Cross-training',      blurb: 'Bike, swim, elliptical — when they substitute, when they don\'t.', research: 'Research/22', category: 'training' },
  { slug: 'mobility',       title: 'Mobility',            blurb: 'Pre-run dynamic, post-run static, daily desk mobility.',            research: 'Research/22', category: 'training' },

  { slug: 'mental',         title: 'Mental training',     blurb: 'PETTLEP imagery, race-day mindset, pre-race anxiety protocols.',   research: 'Research/15', category: 'mental' },

  { slug: 'shoes',          title: 'Shoes',               blurb: 'Daily-trainer rotation, race shoes, mileage tracking, retire signals.', research: 'Research/16', category: 'gear' },
  { slug: 'wearables',      title: 'Wearables',           blurb: 'HRV, RHR, sleep, body battery — what to trust, what to ignore.',    research: 'Research/04', category: 'gear' },

  { slug: 'weather',        title: 'Weather',             blurb: 'Heat slowdown formulas, dewpoint thresholds, wind, altitude.',      research: 'Research/06', category: 'environment' },
  { slug: 'heat',           title: 'Heat acclimation',    blurb: 'How to acclimate, how long it lasts, when it actually matters.',   research: 'Research/06', category: 'environment' },
  { slug: 'travel',         title: 'Travel + jet lag',    blurb: 'Time-zone protocols, race-day arrival timing, sleep restoration.', research: 'Research/13', category: 'environment' },
  { slug: 'course',         title: 'Course-specific',     blurb: 'Hill cost, downhill quad-bomb risk, surface, GPS-vs-actual.',       research: 'Research/06', category: 'environment' },

  { slug: 'age',            title: 'Age effects',         blurb: 'How VDOT decays with age, recovery scaling per decade.',           research: 'Research/24', category: 'physiology' },
  { slug: 'masters',        title: 'Masters runners',     blurb: '40+ specifics: longer recovery, strength priority, injury patterns.', research: 'Research/24', category: 'physiology' },
  { slug: 'sex',            title: 'Sex differences',     blurb: 'Cycle-aware training, female-specific recovery, fueling needs.',   research: 'Research/24', category: 'physiology' },
  { slug: 'cadence',        title: 'Cadence',             blurb: 'SPM by height/age/level, drift signals, when to intervene.',       research: 'Research/00a', category: 'physiology' },
  { slug: 'grading',        title: 'VDOT grading',        blurb: 'Tier classification (novice/intermediate/advanced/elite) + age-graded VDOT.', research: 'Research/24', category: 'physiology' },
];

const CATEGORY_LABELS: Record<typeof TOPICS[number]['category'], string> = {
  physiology: 'PHYSIOLOGY',
  training: 'TRAINING',
  nutrition: 'NUTRITION',
  recovery: 'RECOVERY',
  mental: 'MENTAL',
  gear: 'GEAR',
  environment: 'ENVIRONMENT',
};

const CATEGORY_COLORS: Record<typeof TOPICS[number]['category'], string> = {
  physiology: 'var(--color-corporate)',
  training: 'var(--color-attention)',
  nutrition: 'var(--color-success)',
  recovery: 'var(--color-corporate)',
  mental: 'var(--color-pink, #cd317c)',
  gear: 'var(--color-t2)',
  environment: 'var(--color-warning)',
};

export default function ResearchIndexPage() {
  const cats: Array<typeof TOPICS[number]['category']> =
    ['training', 'recovery', 'nutrition', 'physiology', 'mental', 'gear', 'environment'];

  return (
    <>
      <Caption left="Runcino · research" right="DOCTRINE LIBRARY" />
      <div className="stage">
        <Nav active="overview" />
        <div className="body">

          <div style={{ marginBottom: 24 }}>
            <div style={{ fontFamily: 'var(--font-data)', fontSize: 10, letterSpacing: '1.6px', color: 'var(--color-attention)', fontWeight: 700 }}>
              DOCTRINE LIBRARY
            </div>
            <h1 style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 36, letterSpacing: '-.005em', margin: '6px 0 4px' }}>
              The research behind every prescription
            </h1>
            <div style={{ fontSize: 13, color: 'var(--color-t2)', maxWidth: 640, lineHeight: 1.55 }}>
              Every coaching decision the engine makes traces back to one of these 33 topic files. Browse to understand what&apos;s driving today&apos;s plan; cite the section when you want a deeper proof.
            </div>
          </div>

          {cats.map(cat => {
            const items = TOPICS.filter(t => t.category === cat);
            if (items.length === 0) return null;
            return (
              <div key={cat} style={{ marginBottom: 24 }}>
                <div style={{
                  fontFamily: 'var(--font-data)', fontSize: 10, letterSpacing: '1.6px',
                  color: CATEGORY_COLORS[cat], fontWeight: 700, marginBottom: 8,
                }}>
                  {CATEGORY_LABELS[cat]} · {items.length} TOPIC{items.length === 1 ? '' : 'S'}
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 10 }}>
                  {items.map(t => (
                    <Link
                      key={t.slug}
                      href={`/research/${t.slug}`}
                      className="tile"
                      style={{
                        textDecoration: 'none',
                        padding: '14px 16px',
                        display: 'flex', flexDirection: 'column', gap: 6,
                        borderLeft: `3px solid ${CATEGORY_COLORS[cat]}`,
                        transition: 'transform 0.12s, border-color 0.12s',
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
                        <div style={{ fontFamily: 'var(--font-display)', fontSize: 16, fontWeight: 700, color: 'var(--color-t0)' }}>
                          {t.title}
                        </div>
                        <div style={{ fontFamily: 'var(--font-data)', fontSize: 8.5, fontWeight: 700, letterSpacing: '1.2px', color: 'var(--color-t3)' }}>
                          {t.research}
                        </div>
                      </div>
                      <div style={{ fontSize: 12.5, color: 'var(--color-t2)', lineHeight: 1.45 }}>
                        {t.blurb}
                      </div>
                    </Link>
                  ))}
                </div>
              </div>
            );
          })}

          <div className="tile" style={{ background: 'var(--color-l1)', borderStyle: 'dashed', textAlign: 'center', padding: 18, marginTop: 14 }}>
            <div style={{ fontSize: 12, color: 'var(--color-t2)', lineHeight: 1.6 }}>
              Source files live at <code style={{ color: 'var(--color-t1)', fontFamily: 'var(--font-data)' }}>web/coach/doctrine/*.ts</code>. Each topic file exports doctrine constants with <code>cite()</code>-stamped citations back to the upstream Research/*.md.
            </div>
          </div>

        </div>
      </div>
    </>
  );
}
