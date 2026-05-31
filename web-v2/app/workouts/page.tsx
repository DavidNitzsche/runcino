/**
 * /workouts — the runner-facing workout library browser.
 *
 * Surfaces the 54-row workout_library catalog (Research/04 vocabulary +
 * Research/22 templates). Grouped by family (recovery, easy, threshold,
 * vo2max, …) with a chip showing how many entries per family. Each card
 * shows the prescription_text + the typical dose + the citation, so a
 * runner browsing the library can see exactly what a "5×800m @ I · 90s
 * jog" is and where the doctrine comes from.
 *
 * No detail page yet — the prescription_text + structure are enough to
 * see at a glance. When the coach starts surfacing "here's the workout
 * we just prescribed you" deep-links, /workouts/[slug] will follow.
 */
import { TopNav } from '@/components/layout/TopNav';
import { pool } from '@/lib/db/pool';

export const dynamic = 'force-dynamic';

interface LibraryRow {
  slug: string;
  name: string;
  family: string;
  prescription_text: string;
  notes: string | null;
  pace_zones: string[];
  is_quality: boolean;
  is_long: boolean;
  distance_focus: string[];
  level_fit: string[];
  phase_fit: string[];
  frequency_max_per_week: number;
  citation: string;
}

// Display labels for raw family codes — keeps the SQL canonical name
// while showing the runner human copy.
const FAMILY_LABEL: Record<string, string> = {
  recovery: 'RECOVERY',
  easy: 'EASY',
  medium_long: 'MEDIUM LONG',
  long: 'LONG',
  threshold: 'THRESHOLD',
  vo2max: 'VO2 MAX',
  speed: 'SPEED',
  hills: 'HILLS',
  fartlek: 'FARTLEK',
  combo: 'COMBO',
  marathon_specific: 'MARATHON SPECIFIC',
  cutdown: 'CUTDOWN',
  ladder: 'LADDER',
  race_specific: 'RACE SPECIFIC',
  base_building: 'BASE BUILDING',
  maintenance: 'MAINTENANCE',
  walk_run: 'WALK / RUN',
  race: 'RACE',
  shakeout: 'SHAKEOUT',
  rest: 'REST',
};

// Effort color per family — pulls from the locked palette in the design
// brief. Quality work warms (copper/red), easy/recovery cools (teal),
// long is honey/amber.
const FAMILY_COLOR: Record<string, string> = {
  recovery: '#56B7B0',
  easy: '#56B7B0',
  medium_long: '#F3AD38',
  long: '#F3AD38',
  threshold: '#D27B3A',
  vo2max: '#FC4D64',
  speed: '#FC4D64',
  hills: '#D27B3A',
  fartlek: '#D27B3A',
  combo: '#D27B3A',
  marathon_specific: '#F3AD38',
  cutdown: '#D27B3A',
  ladder: '#FC4D64',
  race_specific: '#F3AD38',
  base_building: '#56B7B0',
  maintenance: '#56B7B0',
  walk_run: '#8B95A7',
  race: '#FC4D64',
  shakeout: '#56B7B0',
  rest: '#8B95A7',
};

// Family ordering — easy/recovery first (most frequent), quality next,
// race-specific tail. Mirrors how a runner thinks about their week.
const FAMILY_ORDER = [
  'recovery', 'easy', 'medium_long', 'long', 'base_building',
  'threshold', 'vo2max', 'speed', 'hills', 'fartlek', 'cutdown', 'ladder', 'combo',
  'marathon_specific', 'race_specific', 'race',
  'maintenance', 'walk_run', 'shakeout', 'rest',
];

async function loadLibrary(): Promise<LibraryRow[]> {
  try {
    const r = await pool.query<LibraryRow>(
      `SELECT slug, name, family, prescription_text, notes,
              pace_zones, is_quality, is_long, distance_focus,
              level_fit, phase_fit, frequency_max_per_week, citation
         FROM workout_library
        WHERE active = TRUE
        ORDER BY family, name`,
    );
    return r.rows;
  } catch {
    return [];
  }
}

export default async function WorkoutsLibraryPage() {
  const rows = await loadLibrary();

  // Group by family in canonical order.
  const groups = new Map<string, LibraryRow[]>();
  for (const r of rows) {
    if (!groups.has(r.family)) groups.set(r.family, []);
    groups.get(r.family)!.push(r);
  }
  const orderedFamilies = FAMILY_ORDER.filter((f) => groups.has(f))
    .concat(Array.from(groups.keys()).filter((f) => !FAMILY_ORDER.includes(f)));

  return (
    <main>
      <TopNav />
      <div style={{ padding: '40px 40px 80px', maxWidth: 1100, margin: '0 auto' }}>
        <div style={{
          color: 'var(--learn, #5b8def)',
          fontSize: 11, letterSpacing: '1.6px',
          textTransform: 'uppercase', fontWeight: 700,
        }}>
          WORKOUT LIBRARY
        </div>
        <h1 style={{
          fontFamily: 'var(--f-display)',
          fontSize: 56, letterSpacing: '0.5px',
          margin: '8px 0 12px', lineHeight: 1.05,
        }}>
          Every workout the coach knows
        </h1>
        <p style={{
          fontFamily: 'var(--f-body)',
          fontSize: 15, lineHeight: 1.55,
          color: 'var(--mute)',
          maxWidth: 680,
          margin: '0 0 36px',
        }}>
          The doctrine catalog. {rows.length} entries across {groups.size} families,
          each one sourced from Research/04 (vocabulary) or Research/22
          (per-distance templates). When the coach builds your plan, it
          picks from this exact list.
        </p>

        {rows.length === 0 ? (
          <div style={{
            padding: 40, textAlign: 'center', color: 'var(--mute)',
            background: 'var(--surface-1, #161A22)',
            border: '1px solid var(--border-low, #222630)',
            borderRadius: 12,
          }}>
            Library not seeded yet. Migration 125_workout_library hasn&apos;t been populated.
          </div>
        ) : (
          orderedFamilies.map((family) => {
            const items = groups.get(family) ?? [];
            const label = FAMILY_LABEL[family] ?? family.toUpperCase().replace(/_/g, ' ');
            const color = FAMILY_COLOR[family] ?? '#8B95A7';
            return (
              <section key={family} style={{ marginBottom: 40 }}>
                <div style={{
                  display: 'flex', alignItems: 'baseline', gap: 12,
                  marginBottom: 14,
                  borderLeft: `3px solid ${color}`,
                  paddingLeft: 12,
                }}>
                  <div style={{
                    fontFamily: 'var(--f-label)',
                    fontSize: 13, letterSpacing: '1.8px', fontWeight: 700,
                    color: color,
                  }}>
                    {label}
                  </div>
                  <div style={{ color: 'var(--mute)', fontSize: 11, letterSpacing: '0.8px' }}>
                    {items.length} workout{items.length === 1 ? '' : 's'}
                  </div>
                </div>
                <div style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))',
                  gap: 12,
                }}>
                  {items.map((w) => (
                    <article
                      key={w.slug}
                      style={{
                        padding: '16px 18px 14px',
                        background: 'var(--surface-1, #161A22)',
                        border: '1px solid var(--border-low, #222630)',
                        borderRadius: 12,
                        display: 'flex', flexDirection: 'column', gap: 10,
                      }}
                    >
                      <div>
                        <div style={{
                          fontFamily: 'var(--f-body)',
                          fontSize: 16, fontWeight: 600, color: 'var(--ink)',
                          lineHeight: 1.3, marginBottom: 4,
                        }}>
                          {w.name}
                        </div>
                        <div style={{
                          display: 'flex', gap: 6, flexWrap: 'wrap',
                          marginTop: 6,
                        }}>
                          {w.is_quality && (
                            <span style={{
                              fontSize: 9, letterSpacing: '1px', fontWeight: 700,
                              padding: '2px 6px', borderRadius: 3,
                              background: 'rgba(252,77,100,0.18)',
                              color: '#FC4D64',
                            }}>
                              QUALITY
                            </span>
                          )}
                          {w.is_long && (
                            <span style={{
                              fontSize: 9, letterSpacing: '1px', fontWeight: 700,
                              padding: '2px 6px', borderRadius: 3,
                              background: 'rgba(243,173,56,0.18)',
                              color: '#F3AD38',
                            }}>
                              LONG
                            </span>
                          )}
                          {w.pace_zones.slice(0, 3).map((z) => (
                            <span
                              key={z}
                              style={{
                                fontSize: 9, letterSpacing: '1px', fontWeight: 700,
                                padding: '2px 6px', borderRadius: 3,
                                background: 'rgba(255,255,255,0.06)',
                                color: 'var(--mute)',
                              }}
                            >
                              {z}
                            </span>
                          ))}
                        </div>
                      </div>

                      <div style={{
                        fontFamily: 'var(--f-mono, "JetBrains Mono", monospace)',
                        fontSize: 12, color: color, lineHeight: 1.5,
                        padding: '8px 10px',
                        background: 'rgba(0,0,0,0.2)',
                        borderRadius: 6,
                      }}>
                        {w.prescription_text}
                      </div>

                      {w.notes ? (
                        <div style={{
                          fontFamily: 'var(--f-body)',
                          fontSize: 12, color: 'var(--mute)', lineHeight: 1.5,
                        }}>
                          {w.notes}
                        </div>
                      ) : null}

                      <div style={{
                        display: 'flex', justifyContent: 'space-between',
                        alignItems: 'flex-end', gap: 10,
                        marginTop: 'auto',
                      }}>
                        <div style={{
                          display: 'flex', gap: 4, flexWrap: 'wrap',
                        }}>
                          {w.distance_focus.slice(0, 4).map((d) => (
                            <span
                              key={d}
                              style={{
                                fontSize: 9, letterSpacing: '0.8px', fontWeight: 600,
                                color: 'var(--mute)',
                                padding: '2px 5px', borderRadius: 3,
                                border: '1px solid rgba(255,255,255,0.10)',
                                textTransform: 'uppercase',
                              }}
                            >
                              {d}
                            </span>
                          ))}
                        </div>
                        <div style={{
                          fontSize: 9, color: 'var(--mute)',
                          letterSpacing: '0.4px', opacity: 0.6,
                          textAlign: 'right',
                        }}>
                          {w.citation}
                        </div>
                      </div>
                    </article>
                  ))}
                </div>
              </section>
            );
          })
        )}
      </div>
    </main>
  );
}
