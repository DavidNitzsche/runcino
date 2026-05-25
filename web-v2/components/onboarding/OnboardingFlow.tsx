'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

const STEPS = ['Connect', 'Goal', 'Race', 'Confirm'] as const;
type Step = typeof STEPS[number];

export function OnboardingFlow() {
  const router = useRouter();
  const [step, setStep] = useState<Step>('Connect');
  const [stravaConnected, setStrava] = useState(false);
  const [appleConnected, setApple] = useState(false);
  const [goalDistance, setGoalDistance] = useState<'5K' | '10K' | 'half' | 'full' | null>('half');
  const [goalTime, setGoalTime] = useState('');
  const [raceName, setRaceName] = useState('');
  const [raceDate, setRaceDate] = useState('');
  const [saving, startSaving] = useTransition();
  const [saveError, setSaveError] = useState<string | null>(null);

  const idx = STEPS.indexOf(step);

  // Persist everything we collected. Idempotent — re-running just upserts.
  async function persistAndContinue() {
    setSaveError(null);
    startSaving(async () => {
      try {
        // 1. Save race (if provided)
        if (raceName && raceDate) {
          const distLabel = goalDistance === 'full' ? 'Marathon'
            : goalDistance === 'half' ? 'Half Marathon'
            : goalDistance ?? null;
          const r = await fetch('/api/race', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              name: raceName,
              date: raceDate,
              distance_label: distLabel,
              priority: 'A',                       // first race = A by default
              goal: goalTime || null,
            }),
          });
          if (!r.ok) throw new Error('Could not save race');
        }

        // 2. (Connection state is best stored when real OAuth lands;
        //     for now we just don't persist them — no fake CONNECTED bits)

        // Route the user home.
        router.push('/today');
      } catch (e: any) {
        setSaveError(e.message ?? String(e));
      }
    });
  }

  return (
    <div style={{ marginTop: 32 }}>
      {/* Step indicator */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 32 }}>
        {STEPS.map((s, i) => (
          <div key={s} style={{
            flex: 1, height: 4, borderRadius: 2,
            background: i <= idx ? 'var(--green)' : 'rgba(255,255,255,0.08)',
          }} />
        ))}
      </div>

      <div className="card" style={{ padding: '28px 32px' }}>
        {step === 'Connect' && (
          <>
            <h2 style={{ fontFamily: 'var(--f-display)', fontSize: 32, margin: 0, letterSpacing: '0.5px' }}>Connect your data.</h2>
            <p style={{ color: 'var(--mute)', fontSize: 14, lineHeight: 1.6, marginTop: 10 }}>
              Strava for runs, Apple Health for sleep / HRV / RHR / weight. The coach reads both.
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 18 }}>
              <ConnectRow name="Strava" connected={stravaConnected} onClick={() => setStrava(true)} />
              <ConnectRow name="Apple Health" connected={appleConnected} onClick={() => setApple(true)} />
            </div>
            <NavBtns onNext={() => setStep('Goal')} canAdvance={stravaConnected || appleConnected} />
          </>
        )}

        {step === 'Goal' && (
          <>
            <h2 style={{ fontFamily: 'var(--f-display)', fontSize: 32, margin: 0, letterSpacing: '0.5px' }}>What's the goal?</h2>
            <p style={{ color: 'var(--mute)', fontSize: 14, lineHeight: 1.6, marginTop: 10 }}>
              Distance first. We'll dial in the time at the next step.
            </p>
            <div style={{ display: 'flex', gap: 8, marginTop: 18, flexWrap: 'wrap' }}>
              {(['5K', '10K', 'half', 'full'] as const).map((d) => (
                <button key={d} onClick={() => setGoalDistance(d)}
                  style={{
                    background: goalDistance === d ? 'rgba(62,189,65,0.12)' : 'transparent',
                    border: `1px solid ${goalDistance === d ? 'var(--green)' : 'var(--line)'}`,
                    color: goalDistance === d ? 'var(--green)' : 'var(--ink)',
                    padding: '10px 18px', borderRadius: 8,
                    fontFamily: 'var(--f-display)', fontSize: 14, letterSpacing: '1.2px',
                    cursor: 'pointer',
                  }}>
                  {d.toUpperCase()}
                </button>
              ))}
            </div>
            <div style={{ marginTop: 18 }}>
              <label style={{ display: 'block', fontFamily: 'var(--f-body)', fontSize: 11, color: 'var(--mute)', letterSpacing: '1.4px', textTransform: 'uppercase', marginBottom: 6 }}>
                Target time (optional)
              </label>
              <input
                type="text" placeholder="e.g. 1:30:00"
                value={goalTime} onChange={(e) => setGoalTime(e.target.value)}
                style={{
                  fontFamily: 'var(--f-display)', fontSize: 22, color: 'var(--ink)',
                  background: 'rgba(255,255,255,0.04)', border: '1px solid var(--line)',
                  borderRadius: 8, padding: '8px 12px', width: '100%', letterSpacing: '0.5px',
                }}
              />
            </div>
            <NavBtns onBack={() => setStep('Connect')} onNext={() => setStep('Race')} canAdvance={!!goalDistance} />
          </>
        )}

        {step === 'Race' && (
          <>
            <h2 style={{ fontFamily: 'var(--f-display)', fontSize: 32, margin: 0, letterSpacing: '0.5px' }}>Pick the race.</h2>
            <p style={{ color: 'var(--mute)', fontSize: 14, lineHeight: 1.6, marginTop: 10 }}>
              Name + date. (Search/import will land in P6.b — for now, just type.)
            </p>
            <input
              type="text" placeholder="Race name" value={raceName}
              onChange={(e) => setRaceName(e.target.value)}
              style={{
                fontFamily: 'var(--f-display)', fontSize: 22, color: 'var(--ink)',
                background: 'rgba(255,255,255,0.04)', border: '1px solid var(--line)',
                borderRadius: 8, padding: '10px 14px', width: '100%', marginTop: 18,
              }}
            />
            <input
              type="date" value={raceDate} onChange={(e) => setRaceDate(e.target.value)}
              style={{
                fontFamily: 'var(--f-body)', fontSize: 14, color: 'var(--ink)',
                background: 'rgba(255,255,255,0.04)', border: '1px solid var(--line)',
                borderRadius: 8, padding: '10px 14px', width: '100%', marginTop: 10,
              }}
            />
            <NavBtns
              onBack={() => setStep('Goal')}
              onNext={() => setStep('Confirm')}
              canAdvance={!!raceName && !!raceDate}
              skipLabel="Skip — I'll add one later"
              onSkip={() => setStep('Confirm')}
            />
          </>
        )}

        {step === 'Confirm' && (
          <>
            <h2 style={{ fontFamily: 'var(--f-display)', fontSize: 32, margin: 0, letterSpacing: '0.5px' }}>Ready.</h2>
            <p style={{ color: 'var(--mute)', fontSize: 14, lineHeight: 1.6, marginTop: 10 }}>
              First briefing builds from what's already in Strava + Apple Health. Updates land daily.
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 18, fontSize: 13 }}>
              <Summary k="STRAVA"        v={stravaConnected ? 'CONNECTED' : 'SKIPPED'} />
              <Summary k="APPLE HEALTH"  v={appleConnected ? 'CONNECTED' : 'SKIPPED'} />
              <Summary k="GOAL DISTANCE" v={goalDistance ? goalDistance.toUpperCase() : '—'} />
              <Summary k="GOAL TIME"     v={goalTime || '—'} />
              <Summary k="RACE"          v={raceName ? `${raceName} · ${raceDate}` : '— (no race set yet)'} />
            </div>
            {saveError && (
              <div style={{ color: 'var(--over)', fontSize: 12, marginTop: 12, fontStyle: 'italic' }}>
                {saveError}
              </div>
            )}
            <NavBtns
              onBack={() => setStep('Race')}
              onNext={persistAndContinue}
              nextLabel={saving ? 'SAVING…' : 'GO TO TODAY'}
              canAdvance={!saving}
            />
          </>
        )}
      </div>
    </div>
  );
}

function ConnectRow({ name, connected, onClick }: { name: string; connected: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} className="card" style={{
      padding: '14px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      textAlign: 'left', cursor: 'pointer',
      borderColor: connected ? 'var(--green)' : 'var(--line)',
      background: connected ? 'rgba(62,189,65,0.04)' : 'var(--card)',
    }}>
      <div>
        <div style={{ fontFamily: 'var(--f-display)', fontSize: 18, color: 'var(--ink)' }}>{name}</div>
        <div style={{ fontSize: 11, color: 'var(--mute)', marginTop: 2 }}>
          {connected ? 'Connected — pulling data' : 'Tap to connect'}
        </div>
      </div>
      <span style={{ color: connected ? 'var(--green)' : 'var(--mute)', fontSize: 11, letterSpacing: '1px' }}>
        {connected ? '● CONNECTED' : '○ NOT CONNECTED'}
      </span>
    </button>
  );
}

function NavBtns({ onBack, onNext, onSkip, canAdvance, nextLabel = 'CONTINUE', skipLabel }: {
  onBack?: () => void; onNext: () => void; onSkip?: () => void;
  canAdvance?: boolean; nextLabel?: string; skipLabel?: string;
}) {
  return (
    <div style={{ display: 'flex', gap: 8, marginTop: 28 }}>
      {onBack && (
        <button onClick={onBack} style={{
          background: 'transparent', border: '1px solid var(--line)', color: 'var(--mute)',
          padding: '10px 18px', borderRadius: 8,
          fontFamily: 'var(--f-display)', fontSize: 13, letterSpacing: '1.2px', cursor: 'pointer',
        }}>BACK</button>
      )}
      {skipLabel && onSkip && (
        <button onClick={onSkip} style={{
          background: 'transparent', border: '1px solid var(--line)', color: 'var(--mute)',
          padding: '10px 14px', borderRadius: 8,
          fontFamily: 'var(--f-body)', fontSize: 12, letterSpacing: '0.5px', cursor: 'pointer',
        }}>{skipLabel}</button>
      )}
      <div style={{ flex: 1 }} />
      <button onClick={onNext} disabled={!canAdvance} style={{
        background: 'var(--green)', color: '#001', border: 'none',
        padding: '10px 20px', borderRadius: 8,
        fontFamily: 'var(--f-display)', fontSize: 13, letterSpacing: '1.2px',
        cursor: canAdvance ? 'pointer' : 'default', opacity: canAdvance ? 1 : 0.5,
      }}>{nextLabel}</button>
    </div>
  );
}

function Summary({ k, v }: { k: string; v: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid var(--line-2)' }}>
      <span style={{ color: 'var(--mute)', fontSize: 11, letterSpacing: '1.2px', textTransform: 'uppercase' }}>{k}</span>
      <span style={{ color: 'var(--ink)', fontFamily: 'var(--f-body)', fontWeight: 600 }}>{v}</span>
    </div>
  );
}
