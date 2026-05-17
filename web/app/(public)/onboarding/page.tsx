'use client';

/**
 * /onboarding — 3-step guided flow.
 *
 * Step 1: identity (name, location, age, sex)
 * Step 2: A-race (or skip for general fitness)
 * Step 3: training profile (level, long-run day, quality days, rest day)
 *
 * Submit on step 3 → POST /api/onboarding/complete → redirect to /overview.
 *
 * Required: a session cookie (middleware enforces this).
 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import '../public.css';
import './onboarding.css';

type Day = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun';
type Level = 'beginner' | 'intermediate' | 'advanced' | 'elite';

const DOW_LABEL: Record<Day, string> = { mon: 'Mon', tue: 'Tue', wed: 'Wed', thu: 'Thu', fri: 'Fri', sat: 'Sat', sun: 'Sun' };
const LEVEL_LABEL: Record<Level, string> = { beginner: 'Beginner', intermediate: 'Intermediate', advanced: 'Advanced', elite: 'Elite' };
const LEVEL_META: Record<Level, string> = {
  beginner: '10–25 mi/wk peak · Just finishing distance',
  intermediate: '25–50 mi/wk peak · Raced HM or marathon',
  advanced: '50–70 mi/wk peak · Sub-elite mileage',
  elite: '70+ mi/wk peak · Sub-1:15 HM territory',
};

export default function OnboardingPage() {
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Step 1 state
  const [name, setName] = useState('');
  const [location, setLocation] = useState('');
  const [age, setAge] = useState<string>('');
  const [sex, setSex] = useState<'M' | 'F' | null>(null);

  // Step 2 state
  const [raceName, setRaceName] = useState('');
  const [raceDate, setRaceDate] = useState('');
  const [raceDistance, setRaceDistance] = useState('HM');
  const [raceGoal, setRaceGoal] = useState('');

  // Step 3 state
  const [level, setLevel] = useState<Level>('intermediate');
  const [longRunDay, setLongRunDay] = useState<Day>('sun');
  const [qualityDays, setQualityDays] = useState<Day[]>(['tue', 'thu']);
  const [restDay, setRestDay] = useState<Day>('sat');

  function toggleQuality(d: Day) {
    setQualityDays((prev) => {
      if (prev.includes(d)) return prev.filter((x) => x !== d);
      if (prev.length >= 2) return prev; // cap at 2
      return [...prev, d];
    });
  }

  async function complete() {
    setBusy(true); setError(null);
    try {
      const res = await fetch('/api/onboarding/complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name, location,
          age: age ? parseInt(age, 10) : undefined,
          sex,
          raceName: raceName || undefined,
          raceDate: raceDate || undefined,
          raceDistance,
          raceGoal: raceGoal || undefined,
          level, longRunDay, qualityDays, restDay,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Failed to save'); setBusy(false); return;
      }
      router.push('/overview');
    } catch {
      setError('Network error'); setBusy(false);
    }
  }

  const planPreview = `14-week ${LEVEL_LABEL[level]} plan · ${DOW_LABEL[longRunDay]} long · ${qualityDays.map((d) => DOW_LABEL[d]).join('/')} quality · ${DOW_LABEL[restDay]} rest`;

  return (
    <div className="faff-public-body">
      <nav className="faff-pub-nav">
        <div className="faff-pub-nav-inner">
          <Link className="faff-logo" href="/landing">faff.run</Link>
          <span className="faff-onb-nav-meta">Just a few quick details — under 2 minutes.</span>
        </div>
      </nav>

      <div className="faff-onb-wrap">

        {/* Stepper */}
        <div className="faff-onb-stepper">
          {[1, 2, 3].map((n) => (
            <div key={n} className={`faff-onb-step-pill ${step === n ? 'active' : ''} ${step > n ? 'done' : ''}`}>
              <div className="faff-onb-step-num">{step > n ? '✓' : n}</div>
              <div className="faff-onb-step-info">
                <span className="faff-onb-step-label">Step {n}</span>
                <span className="faff-onb-step-name">{n === 1 ? 'Identity' : n === 2 ? 'Your A-race' : 'Training profile'}</span>
              </div>
            </div>
          ))}
        </div>

        <div className="faff-onb-card">

          {/* STEP 1 */}
          {step === 1 && (
            <div>
              <div className="faff-eyebrow">Identity</div>
              <h1 className="faff-onb-title">Who are we coaching?</h1>
              <p className="faff-onb-sub">Age and sex shape the max-HR estimate and recovery guidance. Location&apos;s for time zones and weather context — only the city.</p>

              <div className="faff-onb-grid-2">
                <div className="faff-form-row">
                  <label className="faff-form-label">Name</label>
                  <input className="faff-form-input" type="text" value={name} onChange={(e) => setName(e.target.value)} />
                </div>
                <div className="faff-form-row">
                  <label className="faff-form-label">Location</label>
                  <input className="faff-form-input" type="text" value={location} onChange={(e) => setLocation(e.target.value)} />
                </div>
              </div>

              <div className="faff-onb-grid-2">
                <div className="faff-form-row">
                  <label className="faff-form-label">Age</label>
                  <input className="faff-form-input" type="number" min={13} max={100} value={age} onChange={(e) => setAge(e.target.value)} />
                </div>
                <div className="faff-form-row">
                  <label className="faff-form-label">Sex</label>
                  <div className="faff-onb-pill-row" style={{ gridTemplateColumns: '1fr 1fr' }}>
                    <div className={`faff-onb-pill ${sex === 'M' ? 'selected' : ''}`} onClick={() => setSex('M')}>Male</div>
                    <div className={`faff-onb-pill ${sex === 'F' ? 'selected' : ''}`} onClick={() => setSex('F')}>Female</div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* STEP 2 */}
          {step === 2 && (
            <div>
              <div className="faff-eyebrow">Your A-race</div>
              <h1 className="faff-onb-title">What are you training for?</h1>
              <p className="faff-onb-sub">Pick the goal race that pulls the plan together. You can add B/C-races later — the coach uses the A-race as the anchor.</p>

              <div className="faff-form-row">
                <label className="faff-form-label">Race name</label>
                <input className="faff-form-input" type="text" value={raceName} onChange={(e) => setRaceName(e.target.value)} />
              </div>

              <div className="faff-onb-grid-2">
                <div className="faff-form-row">
                  <label className="faff-form-label">Race date</label>
                  <input className="faff-form-input" type="date" value={raceDate} onChange={(e) => setRaceDate(e.target.value)} />
                </div>
                <div className="faff-form-row">
                  <label className="faff-form-label">Distance</label>
                  <select className="faff-form-input" value={raceDistance} onChange={(e) => setRaceDistance(e.target.value)}>
                    <option value="5K">5K</option>
                    <option value="10K">10K</option>
                    <option value="HM">Half marathon (13.1 mi)</option>
                    <option value="M">Marathon (26.2 mi)</option>
                    <option value="ULTRA">Ultra (50K+)</option>
                    <option value="OTHER">Other</option>
                  </select>
                </div>
              </div>

              <div className="faff-form-row">
                <label className="faff-form-label">Goal finish time · HH:MM:SS</label>
                <input className="faff-form-input" type="text" value={raceGoal} onChange={(e) => setRaceGoal(e.target.value)} />
                <div className="faff-onb-help">Honest is better than ambitious. Coach will sanity-check this against your training data once a few runs land.</div>
              </div>

              <div className="faff-onb-skip">
                Don&apos;t have a race? <a href="#" onClick={(e) => { e.preventDefault(); setRaceName(''); setRaceDate(''); setRaceGoal(''); setStep(3); }}>Skip — I&apos;m training for general fitness →</a>
              </div>
            </div>
          )}

          {/* STEP 3 */}
          {step === 3 && (
            <div>
              <div className="faff-eyebrow">Training profile</div>
              <h1 className="faff-onb-title">How do you train?</h1>
              <p className="faff-onb-sub">These four prefs shape your plan. Long-run day is your weekly anchor. Quality days hold threshold + interval work. Rest is sacred. Editable any time.</p>

              <div className="faff-form-row">
                <label className="faff-form-label">Level</label>
                <div className="faff-onb-level-grid">
                  {(['beginner', 'intermediate', 'advanced', 'elite'] as Level[]).map((l) => (
                    <div key={l} className={`faff-onb-level-card ${level === l ? 'selected' : ''}`} onClick={() => setLevel(l)}>
                      <div className="faff-onb-level-name">{LEVEL_LABEL[l]}</div>
                      <div className="faff-onb-level-meta">{LEVEL_META[l]}</div>
                    </div>
                  ))}
                </div>
                <div className="faff-onb-help">Level caps weekly volume and long-run length. From the Research/00a-distance-running-training doctrine.</div>
              </div>

              <div className="faff-form-row" style={{ marginTop: 8 }}>
                <label className="faff-form-label">Long-run day</label>
                <div className="faff-onb-pill-row">
                  {(Object.keys(DOW_LABEL) as Day[]).map((d) => (
                    <div key={d} className={`faff-onb-pill ${longRunDay === d ? 'selected' : ''}`} onClick={() => setLongRunDay(d)}>{DOW_LABEL[d]}</div>
                  ))}
                </div>
              </div>

              <div className="faff-form-row">
                <label className="faff-form-label">Quality days (1–2)</label>
                <div className="faff-onb-pill-row">
                  {(Object.keys(DOW_LABEL) as Day[]).map((d) => (
                    <div key={d} className={`faff-onb-pill ${qualityDays.includes(d) ? 'selected' : ''}`} onClick={() => toggleQuality(d)}>{DOW_LABEL[d]}</div>
                  ))}
                </div>
                <div className="faff-onb-help">Threshold + interval slots. BASE uses 1, BUILD/PEAK uses 2.</div>
              </div>

              <div className="faff-form-row">
                <label className="faff-form-label">Rest day</label>
                <div className="faff-onb-pill-row">
                  {(Object.keys(DOW_LABEL) as Day[]).map((d) => (
                    <div key={d} className={`faff-onb-pill ${restDay === d ? 'selected' : ''}`} onClick={() => setRestDay(d)}>{DOW_LABEL[d]}</div>
                  ))}
                </div>
                <div className="faff-onb-help">Default is the day before the long run — protects long-run quality.</div>
              </div>

              <div className="faff-onb-summary">
                <div className="faff-onb-summary-label">Plan preview</div>
                <div className="faff-onb-summary-value">{planPreview}</div>
              </div>
            </div>
          )}

          {error && <div className="faff-form-error" style={{ marginTop: 16 }}>{error}</div>}

          {/* Actions */}
          <div className="faff-onb-actions">
            <button
              className={`faff-onb-btn back ${step === 1 ? 'invisible' : ''}`}
              type="button"
              onClick={() => setStep((s) => Math.max(1, s - 1))}
              disabled={step === 1}
            >← Back</button>
            <button
              className="faff-onb-btn primary"
              type="button"
              disabled={busy}
              onClick={() => {
                if (step < 3) setStep((s) => s + 1);
                else complete();
              }}
            >
              {step < 3 ? 'Continue →' : busy ? 'Building plan…' : 'Build my plan →'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
