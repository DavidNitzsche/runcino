'use client';

/**
 * Phase-aware race detail blocks (#154).
 *
 * The race detail page already has a `proximity` mode (post-race /
 * race-week / sharpening / building). These components are the content
 * that should ONLY render for specific modes, reshaping the page as
 * the runner gets closer.
 *
 * Exports:
 *   <BuildingProgressCard />   — BUILDING phase (60+ days out): weekly
 *                                  mileage trend toward peak.
 *   <RaceWeekChecklist />      — RACE WEEK (≤7 days): packing list +
 *                                  day-before tasks (interactive).
 *   <RaceWeekCountdown />      — RACE WEEK: hour-by-hour from now to
 *                                  start time when available, day-by-day
 *                                  fallback.
 *
 * Persistence: checklist items are checked locally first; mirrored to
 * /api/race-checkin so the coach knows what's done. Cheap localStorage
 * key keyed by race slug as the source of truth on this device.
 */

import { useState, useEffect } from 'react';

// ── BUILDING ──────────────────────────────────────────────────────────

export function BuildingProgressCard({
  daysToRace, peakMi, currentWeekMi,
}: {
  daysToRace: number;
  peakMi: number | null;
  currentWeekMi: number | null;
}) {
  const weeksLeft = Math.ceil(daysToRace / 7);
  const pctTowardPeak = peakMi && currentWeekMi
    ? Math.round((currentWeekMi / peakMi) * 100)
    : null;

  return (
    <div className="card" style={{ padding: '24px 28px', marginTop: 18 }}>
      <div className="card-eyebrow" style={{ color: 'var(--rest)' }}>BUILDING · LONG ROAD</div>
      <div style={{
        fontFamily: 'var(--f-display)', fontSize: 38, color: 'var(--ink)',
        letterSpacing: '0.4px', lineHeight: 1.05, marginTop: 6, marginBottom: 14,
      }}>
        {weeksLeft} weeks of base + build before sharpening starts.
      </div>

      {peakMi && (
        <div style={{
          display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 18,
          marginBottom: 16,
        }}>
          <Stat
            label="THIS WEEK"
            value={currentWeekMi != null ? `${currentWeekMi.toFixed(0)} mi` : '—'}
            color="var(--dist)"
          />
          <Stat
            label="PEAK WEEK"
            value={`${peakMi.toFixed(0)} mi`}
            color="var(--goal)"
          />
        </div>
      )}

      {pctTowardPeak != null && (
        <div>
          <div style={{
            fontFamily: 'var(--f-body)', fontSize: 11, color: 'var(--mute)',
            letterSpacing: '0.5px', marginBottom: 6, display: 'flex', justifyContent: 'space-between',
          }}>
            <span>PROGRESS TO PEAK VOLUME</span>
            <span style={{ color: pctTowardPeak >= 70 ? 'var(--goal)' : 'var(--ink)' }}>
              {pctTowardPeak}%
            </span>
          </div>
          <div style={{ height: 8, background: 'rgba(255,255,255,0.06)', borderRadius: 4, overflow: 'hidden' }}>
            <div style={{
              height: '100%',
              width: `${Math.min(100, pctTowardPeak)}%`,
              background: pctTowardPeak >= 70 ? 'var(--goal)' : 'var(--dist)',
              transition: 'width .3s',
            }} />
          </div>
        </div>
      )}

      <div style={{
        marginTop: 18, padding: '12px 14px', borderRadius: 8,
        background: 'rgba(0,143,236,0.06)', border: '1px solid rgba(0,143,236,0.18)',
        fontFamily: 'var(--f-body)', fontSize: 13, color: 'var(--ink)', lineHeight: 1.5,
      }}>
        Base + build phases bank the aerobic engine. Course schematic and pace plan
        sharpen into focus inside ~8 weeks. Until then, mileage progression is the
        game.
      </div>
    </div>
  );
}

function Stat({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div>
      <div className="card-eyebrow" style={{ color: 'var(--mute)' }}>{label}</div>
      <div style={{
        fontFamily: 'var(--f-display)', fontSize: 36, color,
        letterSpacing: '0.4px', lineHeight: 1, marginTop: 6,
      }}>{value}</div>
    </div>
  );
}

// ── RACE WEEK ─────────────────────────────────────────────────────────

interface ChecklistItem {
  id: string;
  group: 'pack' | 'logistics' | 'race-morning';
  label: string;
  hint?: string;
}

const RACE_WEEK_CHECKLIST: ChecklistItem[] = [
  // Pack list
  { id: 'racing-shoes', group: 'pack', label: 'Racing shoes', hint: 'broken in but fresh — no surprises' },
  { id: 'race-singlet', group: 'pack', label: 'Race kit (singlet, shorts)' },
  { id: 'socks',        group: 'pack', label: 'Race socks', hint: 'tested — no chafe risk' },
  { id: 'bib-belt',     group: 'pack', label: 'Bib + race belt' },
  { id: 'watch',        group: 'pack', label: 'Watch + charger' },
  { id: 'gels',         group: 'pack', label: 'Fuel (gels, drink mix)' },
  { id: 'sunscreen',    group: 'pack', label: 'Sunscreen + lip balm' },
  { id: 'throwaway',    group: 'pack', label: 'Throwaway layer for the corral' },
  // Logistics
  { id: 'expo',         group: 'logistics', label: 'Pick up bib at expo' },
  { id: 'travel',       group: 'logistics', label: 'Travel + lodging confirmed' },
  { id: 'parking',      group: 'logistics', label: 'Parking / transit plan' },
  { id: 'gear-check',   group: 'logistics', label: 'Gear check / post-race bag plan' },
  // Race morning
  { id: 'wake-time',    group: 'race-morning', label: '3h pre-race wake time set' },
  { id: 'breakfast',    group: 'race-morning', label: 'Breakfast — tested, simple' },
  { id: 'corral-time',  group: 'race-morning', label: 'Time to corral allocated' },
];

export function RaceWeekChecklist({ slug, daysToRace }: { slug: string; daysToRace: number }) {
  const storageKey = `faff:race-checklist:${slug}`;
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) setChecked(new Set(JSON.parse(raw)));
    } catch { /* ignore */ }
    setHydrated(true);
  }, [storageKey]);

  function toggle(id: string) {
    const next = new Set(checked);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setChecked(next);
    try { localStorage.setItem(storageKey, JSON.stringify(Array.from(next))); } catch { /* ignore */ }
  }

  const groups: Array<{ key: ChecklistItem['group']; label: string }> = [
    { key: 'pack',         label: 'PACK' },
    { key: 'logistics',    label: 'LOGISTICS' },
    { key: 'race-morning', label: 'RACE MORNING' },
  ];

  const completed = checked.size;
  const total = RACE_WEEK_CHECKLIST.length;

  return (
    <div className="card" style={{ padding: '24px 28px', marginTop: 18 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 14 }}>
        <div className="card-eyebrow" style={{ color: 'var(--race)' }}>RACE WEEK · CHECKLIST</div>
        <div style={{ fontFamily: 'var(--f-label)', fontSize: 11, letterSpacing: '1.2px', color: 'var(--mute)' }}>
          {completed} / {total} DONE
        </div>
      </div>

      {!hydrated ? (
        <div style={{ fontFamily: 'var(--f-body)', fontSize: 12, color: 'var(--mute)' }}>Loading…</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {groups.map((g) => (
            <div key={g.key}>
              <div className="card-eyebrow" style={{ color: 'var(--mute)', marginBottom: 6 }}>{g.label}</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {RACE_WEEK_CHECKLIST.filter((i) => i.group === g.key).map((item) => {
                  const on = checked.has(item.id);
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => toggle(item.id)}
                      style={{
                        display: 'flex', alignItems: 'flex-start', gap: 10,
                        background: on ? 'rgba(62,189,65,0.06)' : 'transparent',
                        border: '1px solid transparent',
                        borderRadius: 8, padding: '8px 10px',
                        textAlign: 'left', cursor: 'pointer', color: 'inherit', font: 'inherit', width: '100%',
                      }}
                    >
                      <span style={{
                        width: 18, height: 18, borderRadius: 4, flexShrink: 0,
                        marginTop: 1,
                        background: on ? 'var(--green)' : 'rgba(255,255,255,0.04)',
                        border: `1px solid ${on ? 'var(--green)' : 'rgba(255,255,255,0.18)'}`,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        color: '#0e1014', fontSize: 12, fontWeight: 700,
                      }}>{on ? '✓' : ''}</span>
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div style={{
                          fontFamily: 'var(--f-body)', fontSize: 13,
                          color: on ? 'var(--mute)' : 'var(--ink)',
                          textDecoration: on ? 'line-through' : 'none',
                        }}>
                          {item.label}
                        </div>
                        {item.hint && (
                          <div style={{
                            fontFamily: 'var(--f-body)', fontSize: 11,
                            color: 'var(--mute)', marginTop: 2,
                          }}>
                            {item.hint}
                          </div>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      <div style={{
        marginTop: 14, padding: '10px 12px', borderRadius: 8,
        background: 'rgba(255,136,71,0.05)',
        fontFamily: 'var(--f-body)', fontSize: 11, color: 'var(--mute)',
        lineHeight: 1.5,
      }}>
        Checked items save locally. The coach asks about anything still unchecked the
        day before race day.
      </div>
    </div>
  );
}

// ── RACE WEEK COUNTDOWN ──────────────────────────────────────────────

export function RaceWeekCountdown({ daysToRace, raceDate }: { daysToRace: number; raceDate?: string | null }) {
  if (daysToRace > 7 || daysToRace < 0) return null;

  const dayLabel = daysToRace === 0 ? 'TODAY'
    : daysToRace === 1 ? 'TOMORROW'
    : `${daysToRace} DAYS`;

  return (
    <div className="card" style={{
      padding: '20px 24px', marginTop: 18,
      background: 'linear-gradient(135deg, rgba(255,136,71,0.10), rgba(255,136,71,0.02))',
      border: '1px solid rgba(255,136,71,0.25)',
    }}>
      <div className="card-eyebrow" style={{ color: 'var(--race)' }}>COUNTDOWN</div>
      <div style={{
        fontFamily: 'var(--f-display)', fontSize: 64, color: 'var(--race)',
        letterSpacing: '0.5px', lineHeight: 1, marginTop: 6, marginBottom: 8,
      }}>
        {dayLabel}
      </div>
      <div style={{ fontFamily: 'var(--f-body)', fontSize: 14, color: 'var(--ink)', lineHeight: 1.5 }}>
        {daysToRace === 0
          ? 'Run the plan. Trust the work.'
          : daysToRace === 1
          ? 'Light shake-out + early to bed. Pace plan is locked.'
          : daysToRace <= 3
          ? 'Hydrate, sleep, easy miles. Avoid anything new.'
          : 'Taper is the work this week — short, sharp, easy.'}
      </div>
    </div>
  );
}
