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
  type RaceHistoryEntry,
  type RaceHistoryDistance,
  type RaceHistoryWhen,
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

  // 2026-06-10 · race paths walk this step too (current volume + history
  // seed the race-prep ramp — a cold-start race plan from zero base
  // fails the progression validator). Copy + the TT section flex by
  // path: a runner with a race date doesn't need a time-trial goal.
  const isRacePath = state.distance !== 'none' && state.distance !== 'coached' && state.distance != null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
      <h1 style={{
        fontFamily: 'var(--f-display)',
        fontWeight: 700,
        letterSpacing: '-0.015em',
        lineHeight: 0.86,
        fontSize: 'clamp(40px, 7vw, 68px)',
        margin: 0,
        color: 'var(--ink)',
      }}>
        {isRacePath ? <>Where are<br />you now?</> : <>Just running.<br />Tell us how.</>}
      </h1>

      <p style={{
        fontFamily: 'var(--f-body)',
        fontSize: 17,
        lineHeight: 1.55,
        color: 'var(--ink)',
        margin: '20px 0 28px',
        maxWidth: 520,
      }}>
        {isRacePath
          ? 'Quick picks. The plan ramps from here, not from zero.'
          : 'Three quick picks. The plan builds around them, no typing.'}
      </p>

      {/* ── Section A · TIME-TRIAL GOAL (optional · no-race path only —
            a race-path runner already named their goal on step 1) ──── */}
      {!isRacePath && (
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
      )}

      {/* ── NEW · RACE HISTORY (optional · TASK B4) ─────────────────
          Self-reported PRs at any distance · drives voice-band
          calibration / guided / challenge band selection. Up to 3
          entries. Empty → "first race ever" → calibration mode. */}
      <RaceHistorySection
        entries={state.raceHistory}
        onChange={(entries) => setState({ ...state, raceHistory: entries })}
      />

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
          color: 'var(--mute)',
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
        color: 'var(--ink)',
        marginBottom: 10,
        display: 'flex',
        alignItems: 'baseline',
        gap: 10,
      }}>
        <span>{header}</span>
        {optional && (
          <span style={{
            color: 'var(--dim)',
            fontSize: 9,
            letterSpacing: '1.4px',
          }}>OPTIONAL</span>
        )}
        {required && (
          <span style={{
            color: 'var(--dim)',
            fontSize: 9,
            letterSpacing: '1.4px',
          }}>REQUIRED</span>
        )}
      </div>
      <div style={{
        background: 'var(--card-2)',
        border: '1px solid var(--line)',
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
      color: 'var(--dim)',
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
        background: active ? 'rgba(255,255,255,0.96)' : 'var(--card-2)',
        border: `1px solid ${active ? 'rgba(255,255,255,0.96)' : 'var(--line)'}`,
        borderRadius: 999,
        padding: '9px 14px',
        fontFamily: 'var(--f-body)',
        fontWeight: 700,
        fontSize: 12,
        letterSpacing: '1.2px',
        textTransform: 'uppercase',
        color: active ? '#2a1a5a' : 'var(--ink)',
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
            color: 'var(--mute)',
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
      background: 'var(--card-2)',
      border: '1px solid var(--line)',
      borderRadius: 12,
      padding: '12px 14px',
    }}>
      <div style={{
        fontFamily: 'var(--f-display)',
        fontWeight: 700,
        letterSpacing: '-0.015em',
        fontSize: 30,
        color: 'var(--ink)',
        lineHeight: 1,
      }}>
        {value}
        <span style={{
          fontSize: 12,
          letterSpacing: '1.2px',
          marginLeft: 5,
          color: 'var(--mute)',
          fontFamily: 'var(--f-body)',
        }}>{unit}</span>
      </div>
      <div style={{
        fontFamily: 'var(--f-body)',
        fontWeight: 700,
        fontSize: 9,
        letterSpacing: '1.4px',
        textTransform: 'uppercase',
        color: 'var(--dim)',
        marginTop: 6,
      }}>
        {label}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// RACE HISTORY · 2026-06-03 · TASK B4 from onboarding-master-execution
// ─────────────────────────────────────────────────────────────────

const RACE_HISTORY_DISTANCES: { value: RaceHistoryDistance; label: string }[] = [
  { value: '5k',       label: '5K' },
  { value: '10k',      label: '10K' },
  { value: 'half',     label: 'HALF' },
  { value: 'marathon', label: 'MARATHON' },
  { value: 'other',    label: 'OTHER' },
];

const RACE_HISTORY_WHEN: { value: RaceHistoryWhen; label: string }[] = [
  { value: '<6mo',   label: '< 6 MO' },
  { value: '6-12mo', label: '6-12 MO' },
  { value: '1-2yr',  label: '1-2 YR' },
  { value: '2+yr',   label: '2+ YR' },
];

const RACE_HISTORY_MAX = 3;

/** Pre-baked time ladders per distance · chip values like "22:00" stored
 *  as label, value = numeric seconds. */
const RACE_HISTORY_TIME_LADDERS: Record<Exclude<RaceHistoryDistance, 'other'>, Array<{ label: string; sec: number }>> = {
  '5k': [
    { label: 'Sub-18', sec: 17 * 60 + 30 },
    { label: '18-20', sec: 19 * 60 },
    { label: '20-22', sec: 21 * 60 },
    { label: '22-25', sec: 23 * 60 + 30 },
    { label: '25-28', sec: 26 * 60 + 30 },
    { label: '28-32', sec: 30 * 60 },
    { label: '32+',   sec: 34 * 60 },
  ],
  '10k': [
    { label: 'Sub-40', sec: 39 * 60 },
    { label: '40-45',  sec: 42 * 60 + 30 },
    { label: '45-50',  sec: 47 * 60 + 30 },
    { label: '50-60',  sec: 55 * 60 },
    { label: '60+',    sec: 65 * 60 },
  ],
  'half': [
    { label: 'Sub-1:25', sec: 85 * 60 },
    { label: '1:25-1:35', sec: 90 * 60 },
    { label: '1:35-1:50', sec: 100 * 60 },
    { label: '1:50-2:10', sec: 120 * 60 },
    { label: '2:10+',     sec: 130 * 60 },
  ],
  'marathon': [
    { label: 'Sub-3:00', sec: 175 * 60 },
    { label: '3:00-3:30', sec: 195 * 60 },
    { label: '3:30-4:00', sec: 225 * 60 },
    { label: '4:00-4:30', sec: 255 * 60 },
    { label: '4:30-5:30', sec: 300 * 60 },
    { label: '5:30+',     sec: 330 * 60 },
  ],
};

function RaceHistorySection({
  entries, onChange,
}: {
  entries: RaceHistoryEntry[];
  onChange: (next: RaceHistoryEntry[]) => void;
}) {
  // null = no entry being edited · the section shows "Yes / No, first race"
  // when collapsed AND empty. Once at least one entry is added, the
  // collapsed state shows the entries with an "+ Add another" affordance.
  const [adding, setAdding] = useState<RaceHistoryEntry | null>(null);
  // 2026-06-10 (David sandbox QC: "NO FIRST RACE is not allowing me to
  // select") · the chip was a hardcoded-inactive no-op because the DATA
  // answer is just the empty array. The runner still needs the tap to
  // land — explicit selection state, payload unchanged.
  const [declaredFirstRace, setDeclaredFirstRace] = useState(false);
  const isEmpty = entries.length === 0;

  function startAdd() {
    setDeclaredFirstRace(false);
    setAdding({ distance: '5k', timeSec: 0, whenRaced: '<6mo' });
  }
  function confirmAdd() {
    if (!adding) return;
    if (adding.timeSec <= 0) return;
    if (adding.distance === 'other' && (!adding.otherDistanceMi || adding.otherDistanceMi <= 0)) return;
    onChange([...entries, adding].slice(0, RACE_HISTORY_MAX));
    setAdding(null);
  }
  function cancelAdd() {
    setAdding(null);
  }
  function removeEntry(idx: number) {
    onChange(entries.filter((_, i) => i !== idx));
  }

  return (
    <Section header="RACE HISTORY" optional>
      {isEmpty && !adding && (
        <div>
          <SubLabel>HAVE YOU RACED BEFORE?</SubLabel>
          <ChipRow>
            <Chip
              active={declaredFirstRace}
              onClick={() => setDeclaredFirstRace(true)}
              label="No, first race"
            />
            <Chip active={false} onClick={startAdd} label="Yes — add PR" />
          </ChipRow>
        </div>
      )}

      {entries.length > 0 && !adding && (
        <div>
          <SubLabel>YOUR RACES</SubLabel>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {entries.map((e, i) => (
              <RaceHistoryRow key={i} entry={e} onRemove={() => removeEntry(i)} />
            ))}
          </div>
          {entries.length < RACE_HISTORY_MAX && (
            <div style={{ marginTop: 10 }}>
              <Chip active={false} onClick={startAdd} label="+ Add another" />
            </div>
          )}
        </div>
      )}

      {adding && (
        <RaceHistoryEditor
          entry={adding}
          onChange={setAdding}
          onConfirm={confirmAdd}
          onCancel={cancelAdd}
        />
      )}
    </Section>
  );
}

function RaceHistoryRow({ entry, onRemove }: { entry: RaceHistoryEntry; onRemove: () => void }) {
  const distLabel = entry.distance === 'other'
    ? `${entry.otherDistanceMi}mi`
    : entry.distance.toUpperCase();
  const timeLabel = formatRaceTime(entry.timeSec);
  const whenLabel = (RACE_HISTORY_WHEN.find((w) => w.value === entry.whenRaced)?.label ?? '').toLowerCase();
  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      background: 'var(--card-2)',
      border: '1px solid var(--line)',
      borderRadius: 12,
      padding: '10px 14px',
    }}>
      <div style={{
        fontFamily: 'var(--f-body)',
        fontWeight: 700,
        fontSize: 13,
        color: 'var(--ink)',
        letterSpacing: 0.3,
      }}>
        {distLabel} · {timeLabel}
        <span style={{
          fontWeight: 400,
          color: 'var(--mute)',
          marginLeft: 8,
          fontSize: 11,
          textTransform: 'lowercase',
        }}>{whenLabel}</span>
      </div>
      <button
        type="button"
        onClick={onRemove}
        style={{
          background: 'transparent',
          border: 'none',
          color: 'var(--mute)',
          fontFamily: 'var(--f-body)',
          fontSize: 11,
          letterSpacing: 0.2,
          cursor: 'pointer',
          textDecoration: 'underline',
          padding: 0,
        }}
      >remove</button>
    </div>
  );
}

function RaceHistoryEditor({
  entry, onChange, onConfirm, onCancel,
}: {
  entry: RaceHistoryEntry;
  onChange: (e: RaceHistoryEntry) => void;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const isStandardDist = entry.distance !== 'other';
  const ladder = isStandardDist
    ? RACE_HISTORY_TIME_LADDERS[entry.distance as Exclude<RaceHistoryDistance, 'other'>]
    : [];

  const canConfirm = entry.timeSec > 0
    && (entry.distance !== 'other' || (entry.otherDistanceMi != null && entry.otherDistanceMi > 0));

  return (
    <div>
      <SubLabel>DISTANCE</SubLabel>
      <ChipRow>
        {RACE_HISTORY_DISTANCES.map((d) => (
          <Chip
            key={d.value}
            active={entry.distance === d.value}
            onClick={() => onChange({
              ...entry,
              distance: d.value,
              timeSec: 0,  // reset when distance changes (different ladders)
              otherDistanceMi: d.value === 'other' ? entry.otherDistanceMi : undefined,
            })}
            label={d.label}
          />
        ))}
      </ChipRow>

      {entry.distance === 'other' && (
        <div style={{ marginTop: 12 }}>
          <SubLabel>DISTANCE · MILES</SubLabel>
          <input
            type="number"
            inputMode="decimal"
            min={0.5}
            max={200}
            step={0.1}
            placeholder="e.g. 50"
            value={entry.otherDistanceMi ?? ''}
            onChange={(ev) => {
              const v = Number(ev.target.value);
              onChange({ ...entry, otherDistanceMi: Number.isFinite(v) ? v : undefined });
            }}
            style={{
              background: 'var(--card-2)',
              border: '1px solid var(--line)',
              borderRadius: 10,
              padding: '10px 12px',
              fontFamily: 'var(--f-body)',
              fontWeight: 700,
              fontSize: 15,
              color: 'var(--ink)',
              width: 140,
            }}
          />
        </div>
      )}

      {isStandardDist && ladder.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <SubLabel>FINISH TIME</SubLabel>
          <ChipRow>
            {ladder.map((t) => (
              <Chip
                key={t.label}
                active={entry.timeSec === t.sec}
                onClick={() => onChange({ ...entry, timeSec: t.sec })}
                label={t.label}
              />
            ))}
          </ChipRow>
        </div>
      )}

      {entry.distance === 'other' && (
        <div style={{ marginTop: 12 }}>
          <SubLabel>FINISH TIME · HH:MM</SubLabel>
          <input
            type="text"
            inputMode="numeric"
            placeholder="e.g. 8:30"
            onChange={(ev) => {
              const sec = parseHmToSec(ev.target.value);
              if (sec != null) onChange({ ...entry, timeSec: sec });
            }}
            style={{
              background: 'var(--card-2)',
              border: '1px solid var(--line)',
              borderRadius: 10,
              padding: '10px 12px',
              fontFamily: 'var(--f-body)',
              fontWeight: 700,
              fontSize: 15,
              color: 'var(--ink)',
              width: 140,
            }}
          />
        </div>
      )}

      <div style={{ marginTop: 12 }}>
        <SubLabel>WHEN</SubLabel>
        <ChipRow>
          {RACE_HISTORY_WHEN.map((w) => (
            <Chip
              key={w.value}
              active={entry.whenRaced === w.value}
              onClick={() => onChange({ ...entry, whenRaced: w.value })}
              label={w.label}
            />
          ))}
        </ChipRow>
      </div>

      <div style={{ marginTop: 14, display: 'flex', gap: 10 }}>
        <button
          type="button"
          onClick={onCancel}
          style={{
            background: 'transparent',
            border: '1px solid var(--line)',
            borderRadius: 10,
            padding: '8px 16px',
            fontFamily: 'var(--f-body)',
            fontWeight: 700,
            fontSize: 12,
            letterSpacing: 1,
            textTransform: 'uppercase',
            color: 'var(--mute)',
            cursor: 'pointer',
          }}
        >Cancel</button>
        <button
          type="button"
          disabled={!canConfirm}
          onClick={onConfirm}
          style={{
            background: canConfirm ? 'var(--ink)' : 'rgba(255,255,255,0.15)',
            border: 'none',
            borderRadius: 10,
            padding: '8px 16px',
            fontFamily: 'var(--f-body)',
            fontWeight: 700,
            fontSize: 12,
            letterSpacing: 1,
            textTransform: 'uppercase',
            color: canConfirm ? '#2a1a5a' : 'var(--mute)',
            cursor: canConfirm ? 'pointer' : 'not-allowed',
            opacity: canConfirm ? 1 : 0.6,
          }}
        >Save</button>
      </div>
    </div>
  );
}

function formatRaceTime(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function parseHmToSec(input: string): number | null {
  const m = input.trim().match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (!m) return null;
  const h = parseInt(m[1], 10);
  const mm = parseInt(m[2], 10);
  const s = m[3] ? parseInt(m[3], 10) : 0;
  if (mm >= 60 || s >= 60) return null;
  return h * 3600 + mm * 60 + s;
}
