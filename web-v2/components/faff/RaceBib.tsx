/**
 * RaceBib · the persistent race-bib header — the SPINE of the app.
 * Paper-overhaul 2026-05-29 (docs/DESIGN_OVERHAUL_2026-05-29.md §4).
 *
 * Boarding-pass band: a ticket stub (T-N countdown) torn from the main
 * panel (race name + GOAL / PROJ / status instrument row). Pure
 * presentational — renders the `RaceHeader` view-model from
 * lib/coach/race-header.ts. Three modes:
 *   · race — T-N stub + name + goal/proj/status
 *   · base — phase-only (no race anchored)
 *   · (time-goal collapses into `race` shape upstream)
 *
 * Race-week (T-7…T-0) tints the accent race-orange.
 */
import Link from 'next/link';
import type { RaceHeader } from '@/lib/coach/race-header';
import { RegistrationDot, SpecLabel, Stamp, toneColor } from './graphic';

const NOTCH = 7; // perforation notch diameter

export function RaceBib({ header, href = '/plan' }: { header: RaceHeader; href?: string }) {
  if (header.mode === 'base') return <BaseBib phase={header.phaseLabel} />;

  const raceWeek = header.tMinus != null && header.tMinus <= 7;
  const stubAccent = raceWeek ? 'var(--race)' : 'var(--ink)';

  return (
    <Link href={href} aria-label="Open plan" style={{ display: 'block', textDecoration: 'none' }}>
      <div
        style={{
          position: 'relative',
          display: 'flex',
          alignItems: 'stretch',
          background: 'var(--card)',
          border: '1px solid var(--line)',
          borderRadius: 14,
          boxShadow: 'var(--shadow-panel)',
          overflow: 'hidden',
          // race-week: faint orange wash behind the whole bib
          backgroundImage: raceWeek
            ? 'linear-gradient(90deg, color-mix(in srgb, var(--race) 7%, transparent), transparent 55%)'
            : undefined,
        }}
      >
        {/* ── ticket stub · the T-N countdown ── */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
            alignItems: 'center',
            minWidth: 116,
            padding: '16px 18px',
            gap: 2,
          }}
        >
          <span style={{ fontFamily: 'var(--f-label)', fontSize: 11, fontWeight: 700, letterSpacing: '2px', color: 'var(--mute)' }}>
            T−
          </span>
          <span
            className="tabular"
            style={{
              fontFamily: 'var(--f-display)',
              fontWeight: 700,
              fontSize: 58,
              lineHeight: 0.82,
              letterSpacing: '-0.02em',
              color: stubAccent,
            }}
          >
            {header.tMinus}
          </span>
          <span style={{ fontFamily: 'var(--f-label)', fontSize: 9, fontWeight: 700, letterSpacing: '1.6px', color: 'var(--mute)', marginTop: 2 }}>
            {header.tMinus === 1 ? 'DAY TO RACE' : 'DAYS TO RACE'}
          </span>
        </div>

        {/* ── perforation ── */}
        <Perforation />

        {/* ── main panel · race name + instrument row ── */}
        <div style={{ flex: 1, minWidth: 0, padding: '14px 18px', display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 9 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12 }}>
            <h2
              style={{
                margin: 0,
                fontFamily: 'var(--f-display)',
                fontWeight: 700,
                fontSize: 'clamp(20px, 3.2vw, 30px)',
                lineHeight: 0.92,
                letterSpacing: '-0.012em',
                color: 'var(--ink)',
                textTransform: 'uppercase',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              {header.raceName}
            </h2>
            {header.dateLabel && (
              <span style={{ flexShrink: 0 }}>
                <Stamp tone={raceWeek ? 'race' : 'mute'}>{header.dateLabel}</Stamp>
              </span>
            )}
          </div>

          {/* instrument row */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 0, flexWrap: 'wrap', rowGap: 6 }}>
            {header.goalLabel && <Instrument label="GOAL" value={header.goalLabel} />}
            {header.projLabel && (
              <>
                <Divider />
                <Instrument label="PROJ" value={header.projLabel} />
              </>
            )}
            {header.statusLabel && (
              <>
                <Divider />
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}>
                  <RegistrationDot tone={header.statusTone} size={9} ring />
                  <span
                    style={{
                      fontFamily: 'var(--f-label)',
                      fontSize: 12,
                      fontWeight: 700,
                      letterSpacing: '1.4px',
                      color: toneColor(header.statusTone),
                    }}
                  >
                    {header.statusLabel}
                  </span>
                </span>
              </>
            )}
          </div>
        </div>
      </div>
    </Link>
  );
}

function Instrument({ label, value }: { label: string; value: string }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'baseline', gap: 6 }}>
      <SpecLabel>{label}</SpecLabel>
      <span
        className="tabular"
        style={{ fontFamily: 'var(--f-display)', fontWeight: 700, fontSize: 17, letterSpacing: '-0.01em', color: 'var(--ink)' }}
      >
        {value}
      </span>
    </span>
  );
}

function Divider() {
  return <span aria-hidden style={{ width: 1, height: 14, background: 'var(--line)', margin: '0 14px' }} />;
}

/** Boarding-pass perforation: dashed rule with a notch top + bottom. */
function Perforation() {
  return (
    <div style={{ position: 'relative', width: 1, alignSelf: 'stretch' }}>
      <div style={{ position: 'absolute', inset: 0, borderLeft: '1.5px dashed var(--line)' }} />
      <span
        aria-hidden
        style={{
          position: 'absolute',
          top: -NOTCH / 2,
          left: -NOTCH / 2,
          width: NOTCH,
          height: NOTCH,
          borderRadius: '50%',
          background: 'var(--bg-page)',
          border: '1px solid var(--line)',
        }}
      />
      <span
        aria-hidden
        style={{
          position: 'absolute',
          bottom: -NOTCH / 2,
          left: -NOTCH / 2,
          width: NOTCH,
          height: NOTCH,
          borderRadius: '50%',
          background: 'var(--bg-page)',
          border: '1px solid var(--line)',
        }}
      />
    </div>
  );
}

/** Base mode — no race anchored. Phase is the hero. */
function BaseBib({ phase }: { phase: string | null }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 14,
        background: 'var(--card)',
        border: '1px solid var(--line)',
        borderRadius: 14,
        boxShadow: 'var(--shadow-panel)',
        padding: '16px 20px',
      }}
    >
      <RegistrationDot tone="learn" size={9} ring />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <SpecLabel>NO RACE ANCHORED · TRAINING BY PHASE</SpecLabel>
        <span
          style={{
            fontFamily: 'var(--f-display)',
            fontWeight: 700,
            fontSize: 26,
            lineHeight: 0.92,
            letterSpacing: '-0.012em',
            color: 'var(--ink)',
            textTransform: 'uppercase',
          }}
        >
          {phase ?? 'BASE'} PHASE
        </span>
      </div>
    </div>
  );
}
