'use client';

import { useRouter } from 'next/navigation';
import { useState, type ReactNode } from 'react';
import {
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
import { redesignOnboardingHref } from '@/components/redesign/onboarding/href';
import { Tile } from '@/components/redesign/core/Tile';
import { Radio } from '@/components/redesign/core/Radio';
import { Stepper } from '@/components/redesign/core/Stepper';
import { Input } from '@/components/redesign/core/Input';
import { Button } from '@/components/redesign/core/Button';
import { Stat } from '@/components/redesign/core/Stat';
import { CoachSay } from '@/components/redesign/coach/CoachSay';
import { OnboardingSidebar } from '@/components/redesign/onboarding/OnboardingSidebar';

/**
 * components/redesign/onboarding/Step1bGoalDetailsRedesign.tsx
 *
 * Reskin of the live components/onboarding/Step1bGoalDetails.tsx. No
 * mock in this batch's two source files covers this exact step (both
 * WebOnboarding.jsx and WebDayOne.jsx only render a single simplified
 * "what I need from you" form, not this step's real four sections) — so
 * this composes the SAME real sections (time-trial goal, race history,
 * weekly target, running history) through the shared component library,
 * choosing the closest-fit primitive per field per WebOnboarding.jsx's
 * own precedent:
 *
 *   · Every enumerated single-choice chip ladder (TT distance/time,
 *     histAvg, histLong, histYears, race-history distance/when) →
 *     Radio. The live component renders these as pill "chips"; this
 *     library has no dedicated Chip primitive, and Radio's own doc
 *     comment says it's for exactly this ("one of a small set, where
 *     the choice reshapes the plan... the five onboarding modes").
 *     WebOnboarding.jsx itself never reaches for SegmentBar (documented
 *     for "2 to 4 mutually exclusive VIEWS of the same data, not
 *     navigation") for a choice like this, so Radio stays consistent
 *     with the mock's own vocabulary.
 *   · weeklyFreq (WeeklyFrequency, integer 3-6 in this step's own UI) →
 *     Stepper — a literal match to WebOnboarding.jsx's own "consistent"
 *     mode: `<Stepper label="Days per week" value={4} min={2} max={7}/>`.
 *   · weeklyMi (WeeklyMileage, chip values 15/25/35/45/55/65/75/85/95 — uniform
 *     step-10) → Stepper(min=15,max=55,step=10). The live component's
 *     own WEEKLY_MI_CHIPS array only offers these five values (the 0/5
 *     true-beginner values exist on the type but aren't rendered by
 *     this step's real chip UI either — a pre-existing gap in the real
 *     component, not something introduced here; ported faithfully, not
 *     silently "fixed").
 *   · Strava-derived history (avgWeeklyMi/longestRecentMi) → Stat, same
 *     primitive WebOnboarding.jsx's sidebar already uses for a labeled
 *     number.
 *
 * Field contract identical to the live step: same OnboardingState
 * shape, same canAdvanceFromGoalDetails gate, same race-history
 * entries[]/add/remove/editor local-state shape. Read-only until
 * Continue — no network write on this screen at all.
 */

const TT_DISTANCES: { value: TTDistance | null; label: string }[] = [
  { value: null, label: 'Not yet' },
  { value: '1mi', label: '1 mile' },
  { value: '5k', label: '5K' },
  { value: '10k', label: '10K' },
];

const WEEKLY_MI_MIN: WeeklyMileage = 15;
// HIGHVOL-1 (2026-08-19) · the stepper stopped at 55, so a sub-elite or elite
// weekly volume (Research/00a §"Volume table") could not be stated at all.
const WEEKLY_MI_MAX: WeeklyMileage = 95;
const WEEKLY_FREQ_MIN: WeeklyFrequency = 3;
const WEEKLY_FREQ_MAX: WeeklyFrequency = 6;

const HIST_AVG_CHIPS: { value: HistAvg; label: string }[] = [
  { value: '0-5', label: '0-5 mi' },
  { value: '5-15', label: '5-15 mi' },
  { value: '15-25', label: '15-25 mi' },
  { value: '25-35', label: '25-35 mi' },
  { value: '35+', label: '35-45 mi' },
  { value: '45-60', label: '45-60 mi' },
  { value: '60-80', label: '60-80 mi' },
  { value: '80+', label: '80+ mi' },
];
const HIST_LONG_CHIPS: { value: HistLong; label: string }[] = [
  { value: '0-3', label: '0-3 mi' },
  { value: '3-6', label: '3-6 mi' },
  { value: '6-10', label: '6-10 mi' },
  { value: '10-16', label: '10-16 mi' },
  { value: '16-22', label: '16-22 mi' },
  { value: '22+', label: '22+ mi' },
];
const HIST_YEARS_CHIPS: { value: HistYears; label: string }[] = [
  { value: '<1', label: 'Under a year' },
  { value: '1-3', label: '1 to 3 years' },
  { value: '3-7', label: '3 to 7 years' },
  { value: '7+', label: '7+ years' },
];
const RACE_HISTORY_DISTANCES: { value: RaceHistoryDistance; label: string }[] = [
  { value: '5k', label: '5K' },
  { value: '10k', label: '10K' },
  { value: 'half', label: 'Half' },
  { value: 'marathon', label: 'Marathon' },
  { value: 'other', label: 'Other' },
];
const RACE_HISTORY_WHEN: { value: RaceHistoryWhen; label: string }[] = [
  { value: '<6mo', label: 'Under 6 months ago' },
  { value: '6-12mo', label: '6 to 12 months ago' },
  { value: '1-2yr', label: '1 to 2 years ago' },
  { value: '2+yr', label: '2+ years ago' },
];
const RACE_HISTORY_MAX = 3;

export interface Step1bGoalDetailsRedesignProps {
  initial: OnboardingState;
  stravaHistory: { avgWeeklyMi: number; longestRecentMi: number } | null;
}

export function Step1bGoalDetailsRedesign({ initial, stravaHistory }: Step1bGoalDetailsRedesignProps) {
  const router = useRouter();
  const [state, setState] = useState<OnboardingState>(initial);
  const [editingHistory, setEditingHistory] = useState(false);
  const [adding, setAdding] = useState<RaceHistoryEntry | null>(null);

  const showStravaHistory = stravaHistory != null && !editingHistory;
  const canAdvance = canAdvanceFromGoalDetails(state);
  const isRacePath = state.distance !== 'none' && state.distance !== 'coached' && state.distance != null;
  const ladder = state.ttDistance ? TT_TIME_LADDERS[state.ttDistance] : [];

  function onContinue() {
    if (!canAdvance) return;
    router.push(redesignOnboardingHref(state, { step: 'signals' }));
  }

  function startAdd() {
    setAdding({ distance: '5k', timeSec: 0, whenRaced: '<6mo' });
  }
  function confirmAdd() {
    if (!adding) return;
    if (adding.timeSec <= 0) return;
    if (adding.distance === 'other' && (!adding.otherDistanceMi || adding.otherDistanceMi <= 0)) return;
    setState({ ...state, raceHistory: [...state.raceHistory, adding].slice(0, RACE_HISTORY_MAX) });
    setAdding(null);
  }
  function removeEntry(idx: number) {
    setState({ ...state, raceHistory: state.raceHistory.filter((_, i) => i !== idx) });
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: 'var(--sp-6)', alignItems: 'start' }}>
      <Tile pad="lg" radius="2xl">
        <div className="faff-display" style={{ fontSize: 'var(--type-display-3)', lineHeight: 'var(--lh-display-3)' }}>
          {isRacePath ? 'Where are you now?' : 'Just running. Tell us how.'}
        </div>
        <CoachSay size="sm" attribution={null} style={{ padding: 'var(--sp-6) 0 var(--sp-8)' }}>
          {isRacePath
            ? 'Quick picks. The plan ramps from here, not from zero.'
            : 'A few quick picks. The plan builds around them, no typing required.'}
        </CoachSay>

        {!isRacePath && (
          <Section header="Want to hit a time?" tag="Optional">
            <div style={{ display: 'grid', gap: 'var(--sp-5)' }}>
              {TT_DISTANCES.map((d) => (
                <Radio key={String(d.value ?? 'none')} checked={state.ttDistance === d.value}
                  onChange={() => setState({ ...state, ttDistance: d.value, ttTime: null })} label={d.label} />
              ))}
            </div>
            {state.ttDistance && ladder.length > 0 && (
              <div style={{ marginTop: 'var(--sp-7)' }}>
                <SubLabel>Time range</SubLabel>
                <div style={{ display: 'grid', gap: 'var(--sp-5)', marginTop: 'var(--sp-4)' }}>
                  {ladder.map((t) => (
                    <Radio key={t} checked={state.ttTime === t} onChange={() => setState({ ...state, ttTime: t })} label={t} />
                  ))}
                </div>
              </div>
            )}
          </Section>
        )}

        <Section header="Have you raced before?" tag="Optional">
          {state.raceHistory.length === 0 && !adding && (
            <Button variant="secondary" size="sm" onClick={startAdd}>Add a race result</Button>
          )}
          {state.raceHistory.length > 0 && !adding && (
            <div style={{ display: 'grid', gap: 'var(--sp-5)' }}>
              {state.raceHistory.map((e, i) => (
                <RaceHistoryRow key={i} entry={e} onRemove={() => removeEntry(i)} />
              ))}
              {state.raceHistory.length < RACE_HISTORY_MAX && (
                <Button variant="ghost" size="sm" onClick={startAdd}>+ Add another</Button>
              )}
            </div>
          )}
          {adding && (
            <RaceHistoryEditor entry={adding} onChange={setAdding} onConfirm={confirmAdd} onCancel={() => setAdding(null)} />
          )}
        </Section>

        <Section header="How much per week?" tag="Required">
          <Stepper label="Weekly mileage you can hold" value={state.weeklyMi ?? WEEKLY_MI_MIN}
            min={WEEKLY_MI_MIN} max={WEEKLY_MI_MAX} step={10} unit="mi"
            helper="Something you could repeat next week without thinking about it."
            onChange={(v) => setState({ ...state, weeklyMi: v as WeeklyMileage })} />
          <Stepper label="Days per week" value={state.weeklyFreq ?? WEEKLY_FREQ_MIN}
            min={WEEKLY_FREQ_MIN} max={WEEKLY_FREQ_MAX} step={1} unit="days"
            helper="I only ever place sessions on days you can run."
            onChange={(v) => setState({ ...state, weeklyFreq: v as WeeklyFrequency })}
            style={{ marginTop: 'var(--sp-7)' }} />
        </Section>

        <Section header="Where are you now?" tag="Required">
          {showStravaHistory ? (
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 'var(--sp-6)' }}>
                <SubLabel>From Strava</SubLabel>
                <Button variant="ghost" size="sm" onClick={() => setEditingHistory(true)}>Edit</Button>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--sp-7)' }}>
                <Tile tone="raised" pad="sm" flat><Stat label="Avg · last 4 wks" value={stravaHistory!.avgWeeklyMi} unit="mi/wk" size="sm" /></Tile>
                <Tile tone="raised" pad="sm" flat><Stat label="Longest recent run" value={stravaHistory!.longestRecentMi} unit="mi" size="sm" /></Tile>
              </div>
            </div>
          ) : (
            <>
              <SubLabel>Avg weekly mi · last 4 weeks</SubLabel>
              <div style={{ display: 'grid', gap: 'var(--sp-5)', marginTop: 'var(--sp-4)' }}>
                {HIST_AVG_CHIPS.map((c) => (
                  <Radio key={c.value} checked={state.histAvg === c.value} onChange={() => setState({ ...state, histAvg: c.value })} label={c.label} />
                ))}
              </div>
              <div style={{ marginTop: 'var(--sp-7)' }}>
                <SubLabel>Longest recent run</SubLabel>
                <div style={{ display: 'grid', gap: 'var(--sp-5)', marginTop: 'var(--sp-4)' }}>
                  {HIST_LONG_CHIPS.map((c) => (
                    <Radio key={c.value} checked={state.histLong === c.value} onChange={() => setState({ ...state, histLong: c.value })} label={c.label} />
                  ))}
                </div>
              </div>
              <div style={{ marginTop: 'var(--sp-7)' }}>
                <SubLabel>Years running</SubLabel>
                <div style={{ display: 'grid', gap: 'var(--sp-5)', marginTop: 'var(--sp-4)' }}>
                  {HIST_YEARS_CHIPS.map((c) => (
                    <Radio key={c.value} checked={state.histYears === c.value} onChange={() => setState({ ...state, histYears: c.value })} label={c.label} />
                  ))}
                </div>
              </div>
            </>
          )}
        </Section>

        <div style={{ display: 'flex', gap: 'var(--sp-5)', marginTop: 'var(--sp-10)' }}>
          <Button onClick={onContinue} disabled={!canAdvance}>Continue</Button>
        </div>
      </Tile>

      <OnboardingSidebar whatYouGet={isRacePath
        ? 'A full periodized block into race day — base, build, peak, and a taper.'
        : 'Base and quality weeks, no taper until a race date exists.'} />
    </div>
  );
}

function Section({ header, tag, children }: { header: string; tag: 'Optional' | 'Required'; children: ReactNode }) {
  return (
    <div style={{ marginTop: 'var(--sp-9)' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 'var(--sp-5)', marginBottom: 'var(--sp-6)' }}>
        <span style={{ fontSize: 'var(--type-label)', color: 'var(--text-secondary)' }}>{header}</span>
        <span style={{ fontSize: 'var(--type-label-s)', color: 'var(--text-quiet)' }}>{tag}</span>
      </div>
      <Tile tone="raised" pad="sm" flat>{children}</Tile>
    </div>
  );
}

function SubLabel({ children }: { children: ReactNode }) {
  return <span style={{ fontSize: 'var(--type-label-s)', color: 'var(--text-quiet)' }}>{children}</span>;
}

function formatRaceTime(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function RaceHistoryRow({ entry, onRemove }: { entry: RaceHistoryEntry; onRemove: () => void }) {
  const distLabel = entry.distance === 'other' ? `${entry.otherDistanceMi}mi` : entry.distance.toUpperCase();
  const whenLabel = RACE_HISTORY_WHEN.find((w) => w.value === entry.whenRaced)?.label ?? '';
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
      <span style={{ fontSize: 'var(--type-body-s)' }}>
        {distLabel} · {formatRaceTime(entry.timeSec)}
        <span style={{ color: 'var(--text-quiet)', marginLeft: 8, fontSize: 'var(--type-label-s)' }}>{whenLabel}</span>
      </span>
      <Button variant="ghost" size="sm" onClick={onRemove}>Remove</Button>
    </div>
  );
}

function RaceHistoryEditor({ entry, onChange, onConfirm, onCancel }: {
  entry: RaceHistoryEntry;
  onChange: (e: RaceHistoryEntry) => void;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const canConfirm = entry.timeSec > 0 && (entry.distance !== 'other' || (entry.otherDistanceMi != null && entry.otherDistanceMi > 0));
  return (
    <div style={{ display: 'grid', gap: 'var(--sp-6)' }}>
      <div>
        <SubLabel>Distance</SubLabel>
        <div style={{ display: 'grid', gap: 'var(--sp-5)', marginTop: 'var(--sp-4)' }}>
          {RACE_HISTORY_DISTANCES.map((d) => (
            <Radio key={d.value} checked={entry.distance === d.value} label={d.label}
              onChange={() => onChange({ ...entry, distance: d.value, timeSec: 0, otherDistanceMi: d.value === 'other' ? entry.otherDistanceMi : undefined })} />
          ))}
        </div>
      </div>
      {entry.distance === 'other' ? (
        <>
          <Input label="Distance" unit="mi" type="number" value={entry.otherDistanceMi ?? ''}
            onChange={(v) => onChange({ ...entry, otherDistanceMi: Number(v) || undefined })} />
          <Input label="Finish time" placeholder="e.g. 8:30" value={formatRaceTime(entry.timeSec) === '0:00' ? '' : formatRaceTime(entry.timeSec)}
            onChange={(v) => {
              const m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(v.trim());
              if (!m) return;
              const h = parseInt(m[1], 10); const mm = parseInt(m[2], 10); const s = m[3] ? parseInt(m[3], 10) : 0;
              if (mm >= 60 || s >= 60) return;
              onChange({ ...entry, timeSec: h * 3600 + mm * 60 + s });
            }} />
        </>
      ) : (
        <div>
          <SubLabel>Finish time</SubLabel>
          <div style={{ display: 'grid', gap: 'var(--sp-5)', marginTop: 'var(--sp-4)' }}>
            {(entry.distance === '5k' || entry.distance === '10k' || entry.distance === 'half' || entry.distance === 'marathon') && (
              <TimeLadder distance={entry.distance} timeSec={entry.timeSec} onPick={(sec) => onChange({ ...entry, timeSec: sec })} />
            )}
          </div>
        </div>
      )}
      <div>
        <SubLabel>When</SubLabel>
        <div style={{ display: 'grid', gap: 'var(--sp-5)', marginTop: 'var(--sp-4)' }}>
          {RACE_HISTORY_WHEN.map((w) => (
            <Radio key={w.value} checked={entry.whenRaced === w.value} label={w.label} onChange={() => onChange({ ...entry, whenRaced: w.value })} />
          ))}
        </div>
      </div>
      <div style={{ display: 'flex', gap: 'var(--sp-5)' }}>
        <Button variant="ghost" size="sm" onClick={onCancel}>Cancel</Button>
        <Button variant="secondary" size="sm" disabled={!canConfirm} onClick={onConfirm}>Save</Button>
      </div>
    </div>
  );
}

/** Pre-baked finish-time ladders per standard race distance. Same bands
 *  the live RaceHistoryEditor offers (Step1bGoalDetails.tsx
 *  RACE_HISTORY_TIME_LADDERS), reproduced verbatim. */
const RACE_HISTORY_TIME_LADDERS: Record<'5k' | '10k' | 'half' | 'marathon', Array<{ label: string; sec: number }>> = {
  '5k': [
    { label: 'Sub-18', sec: 17 * 60 + 30 }, { label: '18-20', sec: 19 * 60 }, { label: '20-22', sec: 21 * 60 },
    { label: '22-25', sec: 23 * 60 + 30 }, { label: '25-28', sec: 26 * 60 + 30 }, { label: '28-32', sec: 30 * 60 }, { label: '32+', sec: 34 * 60 },
  ],
  '10k': [
    { label: 'Sub-40', sec: 39 * 60 }, { label: '40-45', sec: 42 * 60 + 30 }, { label: '45-50', sec: 47 * 60 + 30 },
    { label: '50-60', sec: 55 * 60 }, { label: '60+', sec: 65 * 60 },
  ],
  half: [
    { label: 'Sub-1:25', sec: 85 * 60 }, { label: '1:25-1:35', sec: 90 * 60 }, { label: '1:35-1:50', sec: 100 * 60 },
    { label: '1:50-2:10', sec: 120 * 60 }, { label: '2:10+', sec: 130 * 60 },
  ],
  marathon: [
    { label: 'Sub-3:00', sec: 175 * 60 }, { label: '3:00-3:30', sec: 195 * 60 }, { label: '3:30-4:00', sec: 225 * 60 },
    { label: '4:00-4:30', sec: 255 * 60 }, { label: '4:30-5:30', sec: 300 * 60 }, { label: '5:30+', sec: 330 * 60 },
  ],
};

function TimeLadder({ distance, timeSec, onPick }: { distance: '5k' | '10k' | 'half' | 'marathon'; timeSec: number; onPick: (sec: number) => void }) {
  return (
    <>
      {RACE_HISTORY_TIME_LADDERS[distance].map((t) => (
        <Radio key={t.label} checked={timeSec === t.sec} label={t.label} onChange={() => onPick(t.sec)} />
      ))}
    </>
  );
}
