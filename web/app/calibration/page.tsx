'use client';

/**
 * /calibration — every personalized dial in one place.
 *
 * Mission: show every personalized setting (pace zones, HR zones,
 * fueling rate, hydration rate, taper depth, long-run cap, easy-
 * share target) with how each was DERIVED + the doctrine citation
 * + a "recalibrate" affordance when stale.
 *
 * Doctrine traceability is the point — every value on this page
 * has its source visible, so the runner can audit what's driving
 * their training.
 *
 * Hub dependencies: state.runner (profile), state.coach (phase +
 * vdot snapshot + race data), doctrine constants.
 */

import Link from 'next/link';
import { Caption, Nav } from '../../components/nav';
import { HubProvider, useHub } from '../../lib/hub-provider';
import {
  HRMAX_ZONES_5,
  POLARIZED_DISTRIBUTION,
  TAPER_VOLUME_REDUCTION,
  RACE_PRIORITY_RECOVERY,
  PRE_RACE_HYDRATION,
  FLUID_DURING_RACE,
} from '../../coach/doctrine';
import { LONG_RUN_PHASE_SPEC, LONG_RUN_HARD_CAP_MULTIPLIER, longRunTargetMi, TRAINING_PULSE_TO_ENGINE_PHASE, type EnginePhase } from '../../lib/long-run-cap';
import { ageFromBirthDate, resolveHrmax } from '../../lib/runner-profile';

export default function CalibrationPage() {
  return (
    <HubProvider>
      <CalibrationInner />
    </HubProvider>
  );
}

function CalibrationInner() {
  const hub = useHub();

  if (!hub) {
    return (
      <Shell>
        <div style={{ minHeight: 480 }} aria-busy="true" />
      </Shell>
    );
  }

  const profile = hub.profile;
  const vdot = hub.coach.vdot ?? null;
  const phase = hub.coach.today?.phase ?? null;
  const longestRecent = hub.coach.state?.volume?.longestLast28Mi ?? 0;

  // Profile-derived values
  const age = profile ? ageFromBirthDate(profile.birthDate) : null;
  const hrmax = profile ? resolveHrmax(profile) : null;
  // Karvonen LTHR estimate: ~0.85 × HRR + RHR. Falls back to 80%
  // hrmax when RHR is missing — same logic as engine's hard-effort
  // gate. Doctrine: research/01 §LT2 ~ 80-85% HRmax.
  const lthrEstimate = (() => {
    if (!hrmax) return null;
    if (profile?.rhrBpm) {
      const hrr = hrmax.bpm - profile.rhrBpm;
      return { bpm: Math.round(profile.rhrBpm + hrr * 0.85), source: 'karvonen_estimate' as const };
    }
    return { bpm: Math.round(hrmax.bpm * 0.80), source: 'pct_hrmax_80_estimate' as const };
  })();

  return (
    <Shell>
      <div style={{ marginBottom: 18 }}>
        <div style={{ fontFamily: 'var(--font-data)', fontSize: 10, letterSpacing: '1.6px', color: 'var(--color-attention)', fontWeight: 700 }}>
          PERSONAL CALIBRATION
        </div>
        <h1 style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 36, letterSpacing: '-.005em', margin: '6px 0 4px' }}>
          Every dial, one canvas
        </h1>
        <div style={{ fontSize: 13, color: 'var(--color-t2)', maxWidth: 640, lineHeight: 1.55 }}>
          Each setting drives a piece of your training. Every value below has a source — tap to see how it was derived. When something looks off, recalibrate at the source rather than fighting the prescription.
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: 14, marginBottom: 14 }}>

        {/* VDOT */}
        <SettingTile
          title="VDOT"
          value={vdot ? vdot.vdot.toFixed(1) : '—'}
          unit=""
          freshness={vdot?.freshness ?? null}
          source={vdot ? `From ${vdot.source.name} on ${vdot.source.date} (${vdot.source.daysAgo}d ago)` : 'No anchored race'}
          citation="Research/01 §VDOT"
          stale={vdot?.freshness === 'stale' || vdot?.freshness === 'expired' || !vdot}
          recalibrateHref="/training"
          recalibrateLabel={vdot ? 'Run a field test' : 'Anchor a race'}
        >
          {vdot && (
            <div style={{ fontSize: 11.5, color: 'var(--color-t2)', lineHeight: 1.5 }}>
              {vdot.tierLabel} · {vdot.freshnessNote}
            </div>
          )}
        </SettingTile>

        {/* Pace zones */}
        <SettingTile
          title="Pace zones (E/M/T/I/R)"
          value={vdot ? '5 bands' : '—'}
          unit=""
          source={vdot ? `Daniels paces from VDOT ${vdot.vdot.toFixed(1)}` : 'Need a fresh VDOT to derive paces'}
          citation="Research/01 §pace zones"
          stale={!vdot || vdot.freshness === 'stale' || vdot.freshness === 'expired'}
          recalibrateHref="/training"
          recalibrateLabel={vdot ? 'Anchor a fresher race' : 'Anchor a race'}
        >
          {vdot && <PaceZoneTable paces={vdot.paces} />}
        </SettingTile>

        {/* HR max */}
        <SettingTile
          title="HRmax"
          value={hrmax ? String(hrmax.bpm) : '—'}
          unit="bpm"
          source={hrmax
            ? hrmax.source === 'measured' ? 'Measured value from your profile' : `Tanaka estimate: 208 − 0.7 × ${age} = ${hrmax.bpm}`
            : 'Profile incomplete (no birthday or measured HRmax)'}
          citation="Tanaka 2001 / Research/24"
          stale={!hrmax || hrmax.source === 'tanaka_estimate'}
          recalibrateHref="/profile"
          recalibrateLabel={hrmax?.source === 'measured' ? 'Update profile' : 'Add measured HRmax'}
        >
          {hrmax && (
            <div style={{ fontSize: 11.5, color: 'var(--color-t2)', lineHeight: 1.5 }}>
              {hrmax.source === 'measured'
                ? 'Measured values are accurate to ±2 bpm. Estimate-based zones drift.'
                : 'Tanaka estimate has SE ±10 bpm — replace with a lab or field-test value for tighter zones.'}
            </div>
          )}
        </SettingTile>

        {/* HR zones */}
        <SettingTile
          title="HR zones (5-zone)"
          value={hrmax ? '5 bands' : '—'}
          unit=""
          source={hrmax ? `% × ${hrmax.bpm} HRmax` : 'Need HRmax to derive zones'}
          citation="Research/24 §HRMAX_ZONES_5"
          stale={!hrmax}
          recalibrateHref="/profile"
          recalibrateLabel="Profile"
        >
          {hrmax && <HrZoneTable hrmax={hrmax.bpm} />}
        </SettingTile>

        {/* LTHR */}
        <SettingTile
          title="LTHR (lactate threshold HR)"
          value={lthrEstimate ? String(lthrEstimate.bpm) : '—'}
          unit="bpm"
          source={lthrEstimate
            ? lthrEstimate.source === 'karvonen_estimate'
              ? `Karvonen: ${profile?.rhrBpm} + 0.85 × (HRR ${hrmax!.bpm - profile!.rhrBpm!}) = ${lthrEstimate.bpm}`
              : `80% × ${hrmax!.bpm} HRmax (RHR not on file)`
            : 'Need HRmax + RHR for a tight LTHR estimate'}
          citation="Research/01 §LT2"
          stale={!lthrEstimate || lthrEstimate.source === 'pct_hrmax_80_estimate'}
          recalibrateHref="/profile"
          recalibrateLabel={profile?.rhrBpm ? 'Update profile' : 'Add resting HR'}
        >
          <div style={{ fontSize: 11.5, color: 'var(--color-t2)', lineHeight: 1.5 }}>
            Used by the engine&apos;s &ldquo;yesterday was hard&rdquo; gate. Replace with a lab LT test for top accuracy.
          </div>
        </SettingTile>

        {/* Long-run cap */}
        {phase && longestRecent > 0 && (
          <SettingTile
            title="Long-run cap (next week)"
            value={longRunTargetMi(phase as EnginePhase, longestRecent).toFixed(1)}
            unit="mi"
            source={`${LONG_RUN_PHASE_SPEC[phase as EnginePhase]?.multiplier} × peak ${longestRecent.toFixed(1)} mi (28-day max), floor ${LONG_RUN_PHASE_SPEC[phase as EnginePhase]?.floorMi} mi`}
            citation="Research/01 §13.1 single-session-spike"
            stale={false}
          >
            <div style={{ fontSize: 11.5, color: 'var(--color-t2)', lineHeight: 1.5 }}>
              Hard ceiling: never &gt;{((LONG_RUN_HARD_CAP_MULTIPLIER - 1) * 100).toFixed(0)}% of recent peak ({(longestRecent * LONG_RUN_HARD_CAP_MULTIPLIER).toFixed(1)} mi) regardless of phase.
            </div>
          </SettingTile>
        )}

        {/* Easy-share target */}
        {phase && (
          <SettingTile
            title="Easy-share target"
            value={String(easySharePctFor(phase))}
            unit="%"
            source={`Phase: ${phase}. Polarized distribution baseline ${POLARIZED_DISTRIBUTION.value.easyPct}% easy / ${POLARIZED_DISTRIBUTION.value.hardPct}% hard, adjusted for phase.`}
            citation="Research/00a §3.1 polarized + Research/00b §load"
            stale={false}
          >
            <div style={{ fontSize: 11.5, color: 'var(--color-t2)', lineHeight: 1.5 }}>
              The dashboard&apos;s easy-ratio tile compares your last 14d against this target.
            </div>
          </SettingTile>
        )}

        {/* Taper depth */}
        <SettingTile
          title="Taper volume reduction"
          value={`${TAPER_VOLUME_REDUCTION.value.totalReductionPctLow}–${TAPER_VOLUME_REDUCTION.value.totalReductionPctHigh}`}
          unit="%"
          source="Doctrine baseline. Final-week reduction depends on race priority and individual response."
          citation="Research/14 §taper volume"
          stale={false}
        >
          <div style={{ fontSize: 11.5, color: 'var(--color-t2)', lineHeight: 1.5 }}>
            A-race: full taper. B-race: {RACE_PRIORITY_RECOVERY.value.B.taperBeforeDays}. C-race: {RACE_PRIORITY_RECOVERY.value.C.taperBeforeDays}.
          </div>
        </SettingTile>

        {/* Pre-race hydration */}
        <SettingTile
          title="Pre-race hydration (2-4h)"
          value={`${PRE_RACE_HYDRATION.value.twoToFourHourPre.volumeMlPerKgLow}–${PRE_RACE_HYDRATION.value.twoToFourHourPre.volumeMlPerKgHigh}`}
          unit="ml/kg"
          source="Doctrine standard window 2-4 h before race start"
          citation="Research/19 §pre-race hydration"
          stale={false}
        >
          <div style={{ fontSize: 11.5, color: 'var(--color-t2)', lineHeight: 1.5 }}>
            Plus {PRE_RACE_HYDRATION.value.twoToFourHourPre.sodiumMgLow}–{PRE_RACE_HYDRATION.value.twoToFourHourPre.sodiumMgHigh} mg sodium. {PRE_RACE_HYDRATION.value.twoToFourHourPre.sodiumLoadingNote}
          </div>
        </SettingTile>

        {/* During-race hydration — temperate band, marathon */}
        <SettingTile
          title="During-race hydration · marathon · temperate"
          value={`${FLUID_DURING_RACE.value.marathon.temperate.lowMlPerHr}–${FLUID_DURING_RACE.value.marathon.temperate.highMlPerHr}`}
          unit="ml/hr"
          source="Doctrine baseline for a marathon in 50-65°F. Other distance × temp combinations live on the race detail page."
          citation="Research/19 §during-race fluid table"
          stale={false}
        >
          <div style={{ fontSize: 11.5, color: 'var(--color-t2)', lineHeight: 1.5 }}>
            Calibrate your own sweat rate via the protocol on the race-day hydration tile.
          </div>
        </SettingTile>

      </div>

      <Footnote />

    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <>
      <Caption left="Runcino · calibration" right="EVERY DIAL" />
      <div className="stage">
        <Nav active="calibration" />
        <div className="body">{children}</div>
      </div>
    </>
  );
}

function SettingTile({
  title, value, unit, source, citation, stale, freshness, recalibrateHref, recalibrateLabel, children,
}: {
  title: string;
  value: string;
  unit: string;
  source: string;
  citation: string;
  stale: boolean;
  freshness?: 'fresh' | 'stale_soon' | 'stale' | 'expired' | null;
  recalibrateHref?: string;
  recalibrateLabel?: string;
  children?: React.ReactNode;
}) {
  const freshnessColor = freshness === 'fresh' ? 'var(--color-success)'
                       : freshness === 'stale_soon' ? 'var(--color-attention)'
                       : freshness === 'stale' ? 'var(--color-attention)'
                       : freshness === 'expired' ? 'var(--color-warning)'
                       : null;
  return (
    <div className="tile" style={{ display: 'flex', flexDirection: 'column', gap: 10, borderLeft: stale ? '3px solid var(--color-attention)' : undefined }}>
      <div className="tile-h" style={{ alignItems: 'flex-start' }}>
        <div className="tile-sub">{title}</div>
        {freshness && freshnessColor && (
          <span style={{
            fontFamily: 'var(--font-data)', fontSize: 8.5, fontWeight: 700, letterSpacing: '1px',
            padding: '3px 7px', borderRadius: 3,
            border: `1px solid ${freshnessColor}`, color: freshnessColor,
          }}>{freshness.replace('_', ' ').toUpperCase()}</span>
        )}
      </div>

      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
        <div style={{
          fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 40,
          letterSpacing: '-.025em', lineHeight: 1, color: 'var(--color-t0)',
          fontVariantNumeric: 'tabular-nums',
        }}>
          {value}
        </div>
        {unit && (
          <div style={{
            fontFamily: 'var(--font-data)', fontSize: 12, fontWeight: 700,
            letterSpacing: '1.4px', color: 'var(--color-t3)', textTransform: 'uppercase',
          }}>{unit}</div>
        )}
      </div>

      {children}

      <div style={{ marginTop: 'auto', display: 'flex', flexDirection: 'column', gap: 6, paddingTop: 10, borderTop: '1px solid var(--color-l4)' }}>
        <div style={{ fontSize: 11, color: 'var(--color-t2)', lineHeight: 1.45 }}>
          <span style={{ fontFamily: 'var(--font-data)', fontSize: 9, fontWeight: 700, letterSpacing: '1.4px', color: 'var(--color-t3)', textTransform: 'uppercase', marginRight: 6 }}>SOURCE</span>
          {source}
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center' }}>
          {/* Citation hidden — site-wide visual cleanup. Doctrine
              traceability still in code via cite() in coach/doctrine/. */}
          {stale && recalibrateHref && (
            <Link href={recalibrateHref} style={{ fontFamily: 'var(--font-data)', fontSize: 10, fontWeight: 700, letterSpacing: '1.2px', color: 'var(--color-attention)', textDecoration: 'none' }}>
              {recalibrateLabel ?? 'RECALIBRATE'} →
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}

function PaceZoneTable({ paces }: { paces: import('../../lib/vdot').DanielsPaceSet }) {
  const rows: Array<{ label: string; band: { lowS: number; highS: number }; meaning: string }> = [
    { label: 'E', band: paces.E, meaning: 'Easy / aerobic' },
    { label: 'M', band: paces.M, meaning: 'Marathon pace' },
    { label: 'T', band: paces.T, meaning: 'Threshold' },
    { label: 'I', band: paces.I, meaning: 'Interval / VO2' },
    { label: 'R', band: paces.R, meaning: 'Repetition' },
  ];
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      {rows.map(r => (
        <div key={r.label} style={{
          display: 'grid', gridTemplateColumns: '32px 1fr auto', gap: 8, alignItems: 'baseline',
          padding: '6px 10px', background: 'var(--color-l3)', borderRadius: 4,
        }}>
          <div style={{ fontFamily: 'var(--font-display)', fontSize: 14, fontWeight: 800, color: 'var(--color-corporate)' }}>{r.label}</div>
          <div style={{ fontSize: 11, color: 'var(--color-t2)' }}>{r.meaning}</div>
          <div style={{ fontFamily: 'var(--font-data)', fontSize: 12, fontWeight: 800, color: 'var(--color-t0)', fontVariantNumeric: 'tabular-nums' }}>
            {formatPace(r.band.lowS)}-{formatPace(r.band.highS)}/mi
          </div>
        </div>
      ))}
    </div>
  );
}

function HrZoneTable({ hrmax }: { hrmax: number }) {
  const zones: Array<['recovery' | 'easy' | 'aerobic_tempo' | 'threshold' | 'vo2max', number]> =
    [['recovery', 1], ['easy', 2], ['aerobic_tempo', 3], ['threshold', 4], ['vo2max', 5]];
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      {zones.map(([key, n]) => {
        const z = HRMAX_ZONES_5.value[key];
        return (
          <div key={key} style={{
            display: 'grid', gridTemplateColumns: '40px 1fr auto', gap: 8, alignItems: 'baseline',
            padding: '6px 10px', background: 'var(--color-l3)', borderRadius: 4,
          }}>
            <div style={{ fontFamily: 'var(--font-display)', fontSize: 13, fontWeight: 800, color: 'var(--color-corporate)' }}>Z{n}</div>
            <div style={{ fontSize: 11, color: 'var(--color-t2)', textTransform: 'capitalize' }}>{key.replace('_', ' ')}</div>
            <div style={{ fontFamily: 'var(--font-data)', fontSize: 11, fontWeight: 800, color: 'var(--color-t0)', fontVariantNumeric: 'tabular-nums' }}>
              {Math.round(hrmax * z.pctLow / 100)}-{Math.round(hrmax * z.pctHigh / 100)}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function easySharePctFor(phase: string): number {
  const map: Record<string, number> = {
    TAPER:            78,
    PEAK:             75,
    BUILD:            70,
    BASE:             80,
    BASE_MAINTENANCE: 78,
    POST_RACE:        90,
    REBUILD:          85,
  };
  return map[phase] ?? 80;
}

function formatPace(secPerMi: number): string {
  const m = Math.floor(secPerMi / 60);
  const s = Math.round(secPerMi % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

function Footnote() {
  return (
    <div className="tile" style={{ background: 'var(--color-l1)', borderStyle: 'dashed', textAlign: 'center', padding: 18 }}>
      <div style={{ fontSize: 12, color: 'var(--color-t2)', lineHeight: 1.6 }}>
        Calibration is the heart of personalized coaching. When a number above looks off, recalibrate at the source — race a fresh field test to update VDOT, run a sweat-rate protocol to update hydration, measure your HRmax in a lab to tighten zones. Every pace and load downstream follows.
      </div>
    </div>
  );
}
