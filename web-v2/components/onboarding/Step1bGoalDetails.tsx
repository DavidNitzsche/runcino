/**
 * Step 1b · Goal details · Lilian onboarding (no-race path).
 *
 * Reached when Step 1 → "No specific race" + Continue. Captures the
 * inputs the plan-builder needs to generate a maintenance / base block:
 *
 *   A. Time-trial goal (optional)   — distance chip + time-range chip ladder
 *   B. Weekly target (required)     — mileage chip + frequency chip
 *   C. Running history (required)   — pre-filled from Strava when connected,
 *                                     otherwise chip groups for avg weekly mi,
 *                                     longest recent run, years running
 *
 * All inputs are CHIPS, never free text (user mandate · CLAUDE.md memory
 * "Confirm the CURRENT working branch / mockup decks must be mockups").
 *
 * Continue stays disabled until B + C are satisfied. A is optional.
 *
 * Persists into profile via /api/onboarding/complete on the final submit
 * in Step 3. URL is the temp store between steps (see lib/onboarding/state).
 */

'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import {
  buildOnboardingHref,
  canAdvanceFromGoalDetails,
  TT_TIME_LADDERS,
  type OnboardingState,
  type TTDistance,
  type WeeklyMileage,
  type WeeklyFrequency,
  type HistAvg,
  type HistLong,
  type HistYears,
} from '@/lib/onboarding/state';

const TT_DISTANCES: { value: TTDistance | null; label: string }[] = [
  { value: null,  label: 'NOT YET' },
  { value: '1mi', label: '1 MI' },
  { value: '5k',  label: '5K' },
  { value: '10k', label: '10K' },
];

const WEEKLY_MI_CHIPS: { value: WeeklyMileage; label: string }[] = [
  { value: 15, label: '15' },
  { value: 25, label: '25' },
  { value: 35, label: '35' },
  { value: 45, label: '45' },
  { value: 55, label: '55+' },
];

const FREQ_CHIPS: WeeklyFrequency[] = [3, 4, 5, 6];

const HIST_AVG_CHIPS: { value: HistAvg; label: string }[] = [
  { value: '0-5',   label: '0-5' },
  { value: '5-15',  label: '5-15' },
  { value: '15-25', label: '15-25' },
  { value: '25-35', label: '25-35' },
  { value: '35+',   label: '35+' },
];

const HIST_LONG_CHIPS: { value: HistLong; label: string }[] = [
  { value: '0-3',  label: '0-3' },
  { value: '3-6',  label: '3-6' },
  { value: '6-10', label: '6-10' },
  { value: '10+',  label: '10+' },
];

const HIST_YEARS_CHIPS: { value: HistYears; label: string }[] = [
  { value: '<1',  label: '<1' },
  { value: '1-3', label: '1-3' },
  { value: '3-7', label: '3-7' },
  { value: '7+',  label: '7+' },
];

export interface Step1bGoalDetailsProps {
  initial: OnboardingState;
  /** Strava-derived history (when connected). Numbers come from the same
   *  pipeline the coach state uses. null when not connected or no data. */
  stravaHistory: {
    avgWeeklyMi: number;
    longestRecentMi: number;
  } | null;
}

export function Step1bGoalDetails({ initial, stravaHistory }: Step1bGoalDetailsProps) {
  const router = useRouter();
  const [state, setState] = useState<OnboardingState>(initial);
  // Local-only flag: when the runner taps "edit" on the Strava card, we hide
  // the Strava numbers and surface the chip groups so they can override.
  const [editingHistory, setEditingHistory] = useState(false);

  const showStravaHistory = stravaHistory != null && !editingHistory;
  const canAdvance = canAdvanceFromGoalDetails(state);

  function pickTtDistance(v: TTDistance | null) {
    // Clear the time when distance changes (different ladders).
    setState({ ...state, ttDistance: v, ttTime: null });
  }

  function pickTtTime(v: string) {
    setState({ ...state, ttTime: v });
  }

  function pickWeeklyMi(v: WeeklyMileage) {
    setState({ ...state, weeklyMi: v });
  }

  function pickWeeklyFreq(v: WeeklyFrequency) {
    setState({ ...state, weeklyFreq: v });
  }

  function pickHistAvg(v: HistAvg) {
    setState({ ...state, histAvg: v });
  }

  function pickHistLong(v: HistLong) {
    setState({ ...state, histLong: v });
  }

  function pickHistYears(v: HistYears) {
    setState({ ...state, histYears: v });
  }

  function onContinue() {
    if (!canAdvance) return;
    router.push(buildOnboardingHref(state, { step: 'signals' }));
  }

  const ladder = state.ttDistance ? TT_TIME_LADDERS[state.ttDistance] : [];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
      <h1 style={{
        fontFamily: 'var(--f-display)',
        fontWeight: 700,
        letterSpacing: '-0.015em',
        lineHeight: 0.86,
        fontSize: 'clamp(40px, 7vw, 68px)',
        margin: 0,
        color: '#fff',
      }}>
        Just running.<br />Tell us how.
      </h1>

      <p style={{
        fontFamily: 'var(--f-body)',
        fontSize: 17,
        lineHeight: 1.55,
        color: 'rgba(255,255,255,0.86)',
        margin: '20px 0 28px',
        maxWidth: 520,
      }}>
        Three quick picks. The plan builds around them, no typing.
      </p>

      {/* ── Section A · TIME-TRIAL GOAL (optional) ─────────────────── */}
      <Section header="WANT TO HIT A TIME?" optional>
        <ChipRow>
          {TT_DISTANCES.map((d) => (
            <Chip
              key={String(d.value ?? 'none')}
              active={state.ttDistance === d.value}
              onClick={() => pickTtDistance(d.value)}
              label={d.label}
            />
          ))}
        </ChipRow>
        {state.ttDistance && ladder.length > 0 && (
          <div style={{ marginTop: 12 }}>
            <SubLabel>TIME RANGE</SubLabel>
            <ChipRow>
              {ladder.map((t) => (
                <Chip
                  key={t}
                  active={state.ttTime === t}
                  onClick={() => pickTtTime(t)}
                  label={t.toUpperCase()}
                />
              ))}
            </ChipRow>
          </div>
        )}
      </Section>

      {/* ── Section B · WEEKLY TARGET (required) ───────────────────── */}
      <Section header="HOW MUCH PER WEEK?" required>
        <SubLabel>MILES</SubLabel>
        <ChipRow>
          {WEEKLY_MI_CHIPS.map((m) => (
            <Chip
              key={m.value}
              active={state.weeklyMi === m.value}
              onClick={() => pickWeeklyMi(m.value)}
              label={`${m.label} MI`}
            />
          ))}
        </ChipRow>
        <div style={{ marginTop: 12 }}>
          <SubLabel>DAYS / WEEK</SubLabel>
          <ChipRow>
            {FREQ_CHIPS.map((f) => (
              <Chip
                key={f}
                active={state.weeklyFreq === f}
                onClick={() => pickWeeklyFreq(f)}
                label={`${f} DAYS`}
              />
            ))}
          </ChipRow>
        </div>
      </Section>

      {/* ── Section C · RUNNING HISTORY (required) ──────────────────── */}
      <Section header="WHERE ARE YOU NOW?" required>
        {showStravaHistory ? (
          <StravaHistoryCard
            avgWeeklyMi={stravaHistory!.avgWeeklyMi}
            longestRecentMi={stravaHistory!.longestRecentMi}
            onEdit={() => setEditingHistory(true)}
          />
        ) : (
          <>
            <SubLabel>AVG WEEKLY MI · LAST 4 WEEKS</SubLabel>
            <ChipRow>
              {HIST_AVG_CHIPS.map((c) => (
                <Chip
                  key={c.value}
                  active={state.histAvg === c.value}
                  onClick={() => pickHistAvg(c.value)}
                  label={`${c.label} MI`}
                />
              ))}
            </ChipRow>
            <div style={{ marginTop: 12 }}>
              <SubLabel>LONGEST RECENT RUN</SubLabel>
              <ChipRow>
                {HIST_LONG_CHIPS.map((c) => (
                  <Chip
                    key={c.value}
                    active={state.histLong === c.value}
                    onClick={() => pickHistLong(c.value)}
                    label={`${c.label} MI`}
                  />
                ))}
              </ChipRow>
            </div>
            <div style={{ marginTop: 12 }}>
              <SubLabel>YEARS RUNNING</SubLabel>
              <ChipRow>
                {HIST_YEARS_CHIPS.map((c) => (
                  <Chip
                    key={c.value}
                    active={state.histYears === c.value}
                    onClick={() => pickHistYears(c.value)}
                    label={c.label}
                  />
                ))}
              </ChipRow>
            </div>
          </>
        )}
      </Section>

      <div style={{ flex: 1 }} />

      <button
        type="button"
        onClick={onContinue}
        disabled={!canAdvance}
        style={{
          background: canAdvance ? '#fff' : 'rgba(255,255,255,0.35)',
          color: '#2a1a5a',
          fontFamily: 'var(--f-display)',
          fontWeight: 700,
          letterSpacing: '-0.015em',
          fontSize: 22,
          padding: 18,
          borderRadius: 16,
          textAlign: 'center',
          textTransform: 'uppercase',
          border: 'none',
          cursor: canAdvance ? 'pointer' : 'not-allowed',
          maxWidth: 480,
          opacity: canAdvance ? 1 : 0.6,
          marginTop: 24,
        }}
      >
        Continue
      </button>
      <a
        href={buildOnboardingHref(initial, { step: 'goal' })}
        style={{
          marginTop: 14,
          fontFamily: 'var(--f-body)',
          fontSize: 13,
          color: 'rgba(255,255,255,0.7)',
          textAlign: 'left',
          textDecoration: 'underline',
          maxWidth: 480,
        }}
      >
        ← Back
      </a>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// Local layout primitives — match Step1Goal's style so the chip caps,
// borders, radii feel native to the rest of the deck.
// ─────────────────────────────────────────────────────────────────

function Section({
  header, optional, required, children,
}: {
  header: string;
  optional?: boolean;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div style={{ marginBottom: 22, maxWidth: 560 }}>
      <div style={{
        fontFamily: 'var(--f-body)',
        fontWeight: 700,
        fontSize: 11,
        letterSpacing: '2.2px',
        textTransform: 'uppercase',
        color: '#fff',
        marginBottom: 10,
        display: 'flex',
        alignItems: 'baseline',
        gap: 10,
      }}>
        <span>{header}</span>
        {optional && (
          <span style={{
            color: 'rgba(255,255,255,0.5)',
            fontSize: 9,
            letterSpacing: '1.4px',
          }}>OPTIONAL</span>
        )}
        {required && (
          <span style={{
            color: 'rgba(255,255,255,0.5)',
            fontSize: 9,
            letterSpacing: '1.4px',
          }}>REQUIRED</span>
        )}
      </div>
      <div style={{
        background: 'rgba(255,255,255,0.06)',
        border: '1px solid rgba(255,255,255,0.14)',
        borderRadius: 14,
        padding: 14,
      }}>
        {children}
      </div>
    </div>
  );
}

function SubLabel({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      fontFamily: 'var(--f-body)',
      fontWeight: 700,
      fontSize: 9,
      letterSpacing: '1.6px',
      textTransform: 'uppercase',
      color: 'rgba(255,255,255,0.6)',
      marginBottom: 8,
    }}>
      {children}
    </div>
  );
}

function ChipRow({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      display: 'flex',
      flexWrap: 'wrap',
      gap: 8,
    }}>
      {children}
    </div>
  );
}

function Chip({
  active, onClick, label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        background: active ? 'rgba(255,255,255,0.96)' : 'rgba(255,255,255,0.08)',
        border: `1px solid ${active ? 'rgba(255,255,255,0.96)' : 'rgba(255,255,255,0.18)'}`,
        borderRadius: 999,
        padding: '9px 14px',
        fontFamily: 'var(--f-body)',
        fontWeight: 700,
        fontSize: 12,
        letterSpacing: '1.2px',
        textTransform: 'uppercase',
        color: active ? '#2a1a5a' : 'rgba(255,255,255,0.92)',
        cursor: 'pointer',
        whiteSpace: 'nowrap',
      }}
    >
      {label}
    </button>
  );
}

function StravaHistoryCard({
  avgWeeklyMi, longestRecentMi, onEdit,
}: {
  avgWeeklyMi: number;
  longestRecentMi: number;
  onEdit: () => void;
}) {
  return (
    <div>
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: 12,
      }}>
        <SubLabel>FROM STRAVA</SubLabel>
        <button
          type="button"
          onClick={onEdit}
          style={{
            background: 'transparent',
            border: 'none',
            color: 'rgba(255,255,255,0.7)',
            fontFamily: 'var(--f-body)',
            fontSize: 11,
            letterSpacing: '0.2px',
            cursor: 'pointer',
            textDecoration: 'underline',
            padding: 0,
          }}
        >
          edit
        </button>
      </div>
      <div style={{
        display: 'grid',
        gridTemplateColumns: '1fr 1fr',
        gap: 12,
      }}>
        <StatBlock value={`${avgWeeklyMi}`} unit="MI/WK" label="AVG · LAST 4 WKS" />
        <StatBlock value={`${longestRecentMi}`} unit="MI" label="LONGEST RECENT RUN" />
      </div>
    </div>
  );
}

function StatBlock({
  value, unit, label,
}: {
  value: string;
  unit: string;
  label: string;
}) {
  return (
    <div style={{
      background: 'rgba(255,255,255,0.06)',
      border: '1px solid rgba(255,255,255,0.16)',
      borderRadius: 12,
      padding: '12px 14px',
    }}>
      <div style={{
        fontFamily: 'var(--f-display)',
        fontWeight: 700,
        letterSpacing: '-0.015em',
        fontSize: 30,
        color: '#fff',
        lineHeight: 1,
      }}>
        {value}
        <span style={{
          fontSize: 12,
          letterSpacing: '1.2px',
          marginLeft: 5,
          color: 'rgba(255,255,255,0.7)',
          fontFamily: 'var(--f-body)',
        }}>{unit}</span>
      </div>
      <div style={{
        fontFamily: 'var(--f-body)',
        fontWeight: 700,
        fontSize: 9,
        letterSpacing: '1.4px',
        textTransform: 'uppercase',
        color: 'rgba(255,255,255,0.55)',
        marginTop: 6,
      }}>
        {label}
      </div>
    </div>
  );
}
