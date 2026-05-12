/**
 * /workout/[date] — single-session workout detail (placeholder).
 *
 * Canonical layout from BuildResearch/deck.html surface s3 — the
 * Tue Apr 14 threshold session. All content is static placeholder
 * until the M3 Coach pipeline wires real workouts to dates. The
 * point is to lock the visual canon in the live app so we don't
 * forget what the production page should look like.
 */

import Link from 'next/link';
import { Caption } from '../../../components/nav';
import { Topbar } from '../../components/Topbar';
import { TopbarClock } from '../../components/TopbarClock';

export default async function WorkoutDetailPage({ params }: { params: Promise<{ date: string }> }) {
  const { date } = await params;

  return (
    <>
      <Caption left="Runcino · workout" right={`WORKOUT · ${date}`} />
      <div className="stage">
        <Topbar activeTab="training" clock={<TopbarClock />} />
        <div className="body">

          {/* Breadcrumb */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: 8,
            fontFamily: 'var(--font-data)', fontSize: 10, letterSpacing: '1.6px',
            color: 'var(--color-t3)', fontWeight: 700, textTransform: 'uppercase',
            marginBottom: 14,
          }}>
            <Link href="/training" style={{ color: 'inherit' }}>Training</Link>
            <span>/</span>
            <span>Big Sur 2026</span>
            <span>/</span>
            <span>Wk 14 · taper</span>
            <span>/</span>
            <span style={{ color: 'var(--color-t1)' }}>Tue Apr 14 · threshold</span>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1.6fr 1fr', gap: 14 }}>

            {/* LEFT — workout body */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <HeroTile />
              <WhyTile />
              <StructureTile />
              <PastAttemptsTile />
            </div>

            {/* RIGHT — context column */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <SendToWatchTile />
              <ConditionsTile />
              <ShoeTile />
              <FuelingTile />
            </div>

          </div>

        </div>
      </div>
    </>
  );
}

/* ── Hero ──────────────────────────────────────────────────── */
function HeroTile() {
  return (
    <div className="tile" style={{
      padding: '24px 26px',
      background: 'linear-gradient(135deg, var(--color-l2) 0%, var(--active-wash) 100%)',
      borderColor: 'rgba(79, 143, 247, 0.25)',
    }}>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <span className="chip chip--corporate">THRESHOLD · LT2</span>
        <span className="chip">WK 14 · D2</span>
        <span className="chip chip--success">PEAK BLOCK</span>
      </div>

      <div style={{
        fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 64,
        lineHeight: 0.92, letterSpacing: '-.005em', textTransform: 'uppercase',
        marginTop: 8,
      }}>
        Threshold<br />5 × 1 mi
      </div>

      <div style={{
        fontSize: 14, color: 'var(--color-t2)', marginTop: 6, maxWidth: 520,
      }}>
        Five mile-repeats at lactate-threshold pace, 90s float recovery. The hardest session of the build and the truest fitness test before taper.
      </div>

      {/* KPI strip */}
      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 14,
        padding: '18px 0 4px', borderTop: '1px solid var(--color-l4)', marginTop: 14,
      }}>
        <Kpi value="8.0" unit="mi" label="Total distance" />
        <Kpi value="~58" unit="min" label="Duration" />
        <Kpi value="6:30" unit="/mi" label="T pace · target" accent />
        <Kpi value="160" unit="bpm" label="LTHR · ceiling" />
      </div>
    </div>
  );
}

function Kpi({ value, unit, label, accent }: { value: string; unit: string; label: string; accent?: boolean }) {
  const color = accent ? 'var(--color-corporate)' : 'var(--color-t0)';
  const subColor = accent ? 'rgba(79,143,247,.6)' : 'var(--color-t2)';
  return (
    <div>
      <div style={{
        fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 36,
        letterSpacing: '-.025em', lineHeight: 1, color,
      }}>
        {value}
        <small style={{
          fontSize: 13, color: subColor, marginLeft: 4,
          fontFamily: 'var(--font-data)', letterSpacing: '1.3px',
          textTransform: 'uppercase',
        }}>{unit}</small>
      </div>
      <Cap style={{ marginTop: 6, color: accent ? 'var(--color-corporate)' : undefined }}>{label}</Cap>
    </div>
  );
}

/* ── Why this workout ──────────────────────────────────────── */
function WhyTile() {
  return (
    <div style={{
      background: 'var(--color-l2)', borderRadius: 13, padding: '18px 20px',
      borderLeft: '3px solid var(--color-corporate)',
    }}>
      <div style={{
        fontFamily: 'var(--font-data)', fontSize: 10, letterSpacing: '1.6px',
        color: 'var(--color-corporate)', fontWeight: 700, textTransform: 'uppercase',
        marginBottom: 8,
      }}>
        Why this workout
      </div>
      <div style={{ fontSize: 14, lineHeight: 1.55, color: 'var(--color-t1)' }}>
        You&apos;ve absorbed last weekend&apos;s 22-miler clean — decoupling held at 3.4%, HR settled by Sunday night. Threshold work at the end of a peak block consolidates the aerobic ceiling you spent twelve weeks building. <b style={{ color: 'var(--color-t0)' }}>Ride the line, don&apos;t cross it</b> — the moment your shoulders tighten on rep three, you&apos;re past T pace.
      </div>
    </div>
  );
}

/* ── Structure ─────────────────────────────────────────────── */
function StructureTile() {
  return (
    <div className="tile">
      <div className="tile-h">
        <div className="tile-lbl">Structure</div>
        <Cap><b>Total · 8.0 mi</b> · ~58 min</Cap>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <Block start="0:00" name="Warm-up · 1.5 mi @ E" detail="Easy aerobic · drills + 4×30s strides at end" pace="8:30/mi" duration="~13min" />
        <Block start="0:13" name="5 × 1 mile @ T · 90s float recovery" detail="Target 6:25–6:35 · HR ≤ 162 · Float jog 9:30/mi" pace="6:30/mi" duration="~38min" highlight />
        <RepGrid />
        <Block start="0:51" name="Cool-down · 1.0 mi @ E" detail="Hands on hips, drop HR below 130" pace="9:00/mi" duration="~9min" />
      </div>
    </div>
  );
}

function Block({ start, name, detail, pace, duration, highlight }: {
  start: string; name: string; detail: string; pace: string; duration: string; highlight?: boolean;
}) {
  const c = highlight ? 'var(--color-corporate)' : undefined;
  return (
    <div style={{
      display: 'grid', gridTemplateColumns: '60px 1fr auto auto',
      gap: 14, alignItems: 'center', padding: '14px 16px',
      background: highlight ? 'var(--active-wash)' : 'var(--color-l3)',
      borderRadius: 8,
      border: highlight ? '1px solid rgba(79,143,247,.3)' : 'none',
      borderLeft: `3px solid ${highlight ? 'var(--color-corporate)' : 'var(--color-l5)'}`,
    }}>
      <span style={{
        fontFamily: 'var(--font-data)', fontSize: 11,
        color: c ?? 'var(--color-t2)', fontWeight: 700,
      }}>{start}</span>
      <div>
        <div style={{ fontSize: 14, fontWeight: highlight ? 700 : 600, color: c ?? 'var(--color-t1)' }}>
          {name}
        </div>
        <Cap style={{ marginTop: 3, color: c }}>{detail}</Cap>
      </div>
      <span style={{
        fontFamily: 'var(--font-data)', fontSize: 13,
        color: c ?? 'var(--color-t1)', fontWeight: 700,
      }}>{pace}</span>
      <span style={{
        fontFamily: 'var(--font-data)', fontSize: 11,
        color: highlight ? 'rgba(79,143,247,.7)' : 'var(--color-t2)',
      }}>{duration}</span>
    </div>
  );
}

function RepGrid() {
  const reps = [
    { n: 1, pace: '6:30' },
    { n: 2, pace: '6:30' },
    { n: 3, pace: '6:30' },
    { n: 4, pace: '6:30' },
    { n: 5, pace: '≤ 6:30', press: true },
  ];
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5,1fr)', gap: 6, padding: '0 4px' }}>
      {reps.map(r => (
        <div key={r.n} style={{
          background: 'var(--color-l3)', borderRadius: 6, padding: '9px 10px', textAlign: 'center',
          border: r.press ? '1px solid rgba(245,197,24,.4)' : '1px solid transparent',
        }}>
          <Cap style={{ marginBottom: 4, color: r.press ? 'var(--milestone)' : undefined }}>
            Rep {r.n}
          </Cap>
          <div style={{
            fontFamily: 'var(--font-data)', fontSize: 13, fontWeight: 700,
            color: r.press ? 'var(--milestone)' : 'var(--color-t1)',
          }}>{r.pace}</div>
        </div>
      ))}
    </div>
  );
}

/* ── Past attempts ─────────────────────────────────────────── */
function PastAttemptsTile() {
  const rows = [
    { date: '2026.01.21', pace: '6:51', hr: '158', dec: '+2.1%', note: 'Cold start · windy' },
    { date: '2026.02.04', pace: '6:48', hr: '159', dec: '+1.8%', note: 'Solid' },
    { date: '2026.02.25', pace: '6:44', hr: '160', dec: '+1.5%', note: 'Race week before Salinas' },
    { date: '2026.03.10', pace: '6:41', hr: '160', dec: '+1.2%', note: 'Track · windless' },
  ];
  return (
    <div className="tile">
      <div className="tile-h">
        <div>
          <div className="tile-sub">Past attempts at this type</div>
          <div style={{ fontSize: 11, color: 'var(--color-t3)', marginTop: 4 }}>5 × 1 mi @ T · last 6 sessions</div>
        </div>
        <span className="chip chip--success">↘ −11s/mi · 12 wk</span>
      </div>
      <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 10 }}>
        <thead>
          <tr style={{
            color: 'var(--color-t3)', fontFamily: 'var(--font-data)', fontSize: 9.5,
            letterSpacing: '1.5px', textTransform: 'uppercase', fontWeight: 700,
          }}>
            <Th>Date</Th>
            <Th>Avg T pace</Th>
            <Th>HR avg</Th>
            <Th>Decouple</Th>
            <Th>Notes</Th>
          </tr>
        </thead>
        <tbody>
          {rows.map(r => (
            <tr key={r.date} style={{ borderTop: '1px solid var(--color-l4)' }}>
              <Td mono>{r.date}</Td>
              <Td mono bold>{r.pace}</Td>
              <Td mono>{r.hr}</Td>
              <Td mono color="var(--color-success)">{r.dec}</Td>
              <Td>{r.note}</Td>
            </tr>
          ))}
          <tr style={{ borderTop: '1px solid var(--color-l4)', background: 'rgba(79,143,247,.05)' }}>
            <Td mono color="var(--color-corporate)">2026.04.14</Td>
            <Td mono color="var(--color-corporate)">— · scheduled</Td>
            <Td mono>—</Td>
            <Td mono>—</Td>
            <Td color="var(--color-corporate)">Today&apos;s session</Td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return <th style={{ textAlign: 'left', padding: '12px 14px' }}>{children}</th>;
}

function Td({ children, mono, bold, color }: { children: React.ReactNode; mono?: boolean; bold?: boolean; color?: string }) {
  return (
    <td style={{
      padding: '12px 14px',
      fontFamily: mono ? 'var(--font-data)' : 'inherit',
      fontVariantNumeric: 'tabular-nums',
      fontWeight: bold ? 700 : 400,
      color: color ?? 'var(--color-t1)',
      fontSize: 13,
    }}>{children}</td>
  );
}

/* ── Send to Watch (CTA) ───────────────────────────────────── */
function SendToWatchTile() {
  return (
    <div style={{
      background: 'var(--color-corporate)', borderRadius: 13, padding: '20px 22px',
      color: '#fff', display: 'flex', flexDirection: 'column', gap: 14,
      position: 'relative', overflow: 'hidden',
    }}>
      <div style={{
        position: 'absolute', top: -30, right: -30, width: 140, height: 140,
        borderRadius: '50%', background: 'rgba(255,255,255,.06)',
      }} />
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <div style={{
            fontFamily: 'var(--font-data)', fontSize: 10, letterSpacing: '1.7px',
            fontWeight: 700, textTransform: 'uppercase', opacity: 0.75,
          }}>
            Ready when you are
          </div>
          <div style={{
            fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 30,
            lineHeight: 1, letterSpacing: '.005em', textTransform: 'uppercase', marginTop: 8,
          }}>
            Send to watch
          </div>
        </div>
        <div style={{
          width: 36, height: 36, borderRadius: 8,
          background: 'rgba(255,255,255,.18)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 14,
        }}>↗</div>
      </div>
      <div style={{ fontSize: 12.5, lineHeight: 1.5, opacity: 0.85 }}>
        Workout file pushed via Garmin Connect IQ. Active workout view loads on watch with per-rep targets and audio cues.
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <button disabled style={{
          flex: 1, padding: '10px 14px', borderRadius: 100,
          background: 'rgba(255,255,255,.16)', color: '#fff',
          border: '1px solid rgba(255,255,255,.18)',
          fontFamily: 'inherit', fontSize: 13, fontWeight: 600,
          cursor: 'not-allowed',
        }}>Send</button>
        <button disabled style={{
          padding: '10px 18px', borderRadius: 100,
          background: 'rgba(255,255,255,.06)', color: '#fff',
          border: '1px solid rgba(255,255,255,.18)',
          fontFamily: 'var(--font-data)', fontSize: 12, fontWeight: 700,
          cursor: 'not-allowed',
        }}>.fit</button>
      </div>
      <div style={{
        fontFamily: 'var(--font-data)', fontSize: 9.5, letterSpacing: '1.4px',
        textTransform: 'uppercase', fontWeight: 700, opacity: 0.6,
        paddingTop: 8, borderTop: '1px solid rgba(255,255,255,.18)',
      }}>
        Last sync · Garmin · 14 min ago
      </div>
    </div>
  );
}

/* ── Conditions ────────────────────────────────────────────── */
function ConditionsTile() {
  return (
    <div className="tile">
      <div className="tile-h">
        <div>
          <div className="tile-sub">Conditions · run window</div>
          <div style={{ fontSize: 11, color: 'var(--color-t3)', marginTop: 4 }}>Tue 6:30 AM · Kezar Loop</div>
        </div>
        <span className="chip chip--success">IDEAL</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
        <svg width="46" height="46" viewBox="0 0 32 32" fill="none">
          <circle cx="16" cy="16" r="6" fill="var(--milestone)" />
          <g stroke="var(--milestone)" strokeWidth="2" strokeLinecap="round">
            <line x1="16" y1="3" x2="16" y2="6" />
            <line x1="16" y1="26" x2="16" y2="29" />
            <line x1="3" y1="16" x2="6" y2="16" />
            <line x1="26" y1="16" x2="29" y2="16" />
            <line x1="6.5" y1="6.5" x2="8.5" y2="8.5" />
            <line x1="23.5" y1="23.5" x2="25.5" y2="25.5" />
            <line x1="6.5" y1="25.5" x2="8.5" y2="23.5" />
            <line x1="23.5" y1="8.5" x2="25.5" y2="6.5" />
          </g>
        </svg>
        <div style={{ flex: 1 }}>
          <div style={{
            fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 36,
            lineHeight: 1, letterSpacing: '-.025em',
          }}>
            54°
            <small style={{
              fontSize: 13, color: 'var(--color-t2)', fontWeight: 500, marginLeft: 5,
              fontFamily: 'var(--font-data)', letterSpacing: '1.3px', textTransform: 'uppercase',
            }}>F</small>
          </div>
          <Cap style={{ marginTop: 5 }}>Clear · 4 mph SE · 60% hum</Cap>
        </div>
      </div>
      <div style={{
        display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10,
        paddingTop: 14, marginTop: 14, borderTop: '1px solid var(--color-l4)',
      }}>
        <div>
          <Cap>Dew point</Cap>
          <div style={{
            fontFamily: 'var(--font-data)', fontSize: 14, color: 'var(--color-t1)',
            fontWeight: 700, marginTop: 3,
          }}>42° · low</div>
        </div>
        <div>
          <Cap>Air quality</Cap>
          <div style={{
            fontFamily: 'var(--font-data)', fontSize: 14, color: 'var(--color-success)',
            fontWeight: 700, marginTop: 3,
          }}>AQI 28</div>
        </div>
      </div>
    </div>
  );
}

/* ── Suggested shoe ────────────────────────────────────────── */
function ShoeTile() {
  return (
    <div className="tile" style={{ background: 'var(--color-l2)' }}>
      <div className="tile-h">
        <div>
          <div className="tile-sub">Suggested shoe</div>
          <div style={{ fontSize: 11, color: 'var(--color-t3)', marginTop: 4 }}>For tempo / threshold sessions</div>
        </div>
        <span className="chip chip--success">FRESH</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
        <div style={{
          width: 64, height: 42, borderRadius: 8,
          background: 'linear-gradient(135deg, #0c1827, #1d3656)',
          border: '1px solid var(--color-l5)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <svg width="40" height="22" viewBox="0 0 40 22" fill="none">
            <path d="M2 16 Q5 10 12 11 L26 9 Q34 9 38 14 L38 18 H2 Z" fill="#fff" opacity="0.85" />
            <path d="M14 12 L20 11 L24 11" stroke="var(--color-corporate)" strokeWidth="1.5" />
          </svg>
        </div>
        <div style={{ flex: 1 }}>
          <div style={{
            fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 18,
            lineHeight: 1.05, letterSpacing: '-.005em',
          }}>Nike Pegasus 41</div>
          <Cap style={{ marginTop: 5 }}>Daily trainer · 212 mi</Cap>
          <div style={{ height: 5, background: 'var(--color-l4)', borderRadius: 3, marginTop: 8, overflow: 'hidden' }}>
            <div style={{
              height: '100%', width: '53%',
              background: 'linear-gradient(90deg, var(--color-success), var(--milestone))',
            }} />
          </div>
          <div style={{
            display: 'flex', justifyContent: 'space-between',
            fontFamily: 'var(--font-data)', fontSize: 9.5, letterSpacing: '1.3px',
            color: 'var(--color-t3)', fontWeight: 700, textTransform: 'uppercase',
            marginTop: 6,
          }}>
            <span>53% used</span>
            <span>188 mi remaining</span>
          </div>
        </div>
      </div>
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        paddingTop: 14, marginTop: 14, borderTop: '1px solid var(--color-l4)',
        fontSize: 12, color: 'var(--color-t2)',
      }}>
        <span>Vaporfly 4 reserved for Big Sur</span>
        <span style={{ color: 'var(--color-corporate)', fontWeight: 600 }}>Change →</span>
      </div>
    </div>
  );
}

/* ── Fueling note ──────────────────────────────────────────── */
function FuelingTile() {
  return (
    <div className="tile">
      <div className="tile-h">
        <div>
          <div className="tile-sub">Fueling note</div>
          <div style={{ fontSize: 11, color: 'var(--color-t3)', marginTop: 4 }}>Pre-session · 60min out</div>
        </div>
      </div>
      <div style={{ fontSize: 13.5, color: 'var(--color-t1)', lineHeight: 1.55 }}>
        Workout sits at threshold for ~38 minutes — glycogen-dependent. <b style={{ color: 'var(--color-t0)' }}>200–250 cal carb</b> 60 min pre (oats + banana). Caffeine optional. Skip the gel mid-workout; this is a flushing rep, not a fuel test.
      </div>
      <div style={{
        display: 'flex', justifyContent: 'space-between',
        fontFamily: 'var(--font-data)', fontSize: 10, letterSpacing: '1.5px',
        color: 'var(--color-t3)', fontWeight: 700, textTransform: 'uppercase',
        marginTop: 14, paddingTop: 14, borderTop: '1px solid var(--color-l4)',
      }}>
        <span>Hydration</span>
        <span style={{ color: 'var(--color-t1)' }}>16 oz · 30 min pre</span>
      </div>
    </div>
  );
}

/* ── Caption helper ────────────────────────────────────────── */
function Cap({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div style={{
      fontFamily: 'var(--font-data)', fontSize: 9.5, letterSpacing: '1.5px',
      color: 'var(--color-t3)', fontWeight: 700, textTransform: 'uppercase',
      ...style,
    }}>{children}</div>
  );
}
