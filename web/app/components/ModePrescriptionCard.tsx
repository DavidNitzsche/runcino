'use client';

/**
 * ModePrescriptionCard — surfaces the mode-specific prescription override
 * when the coach is in INJURY / ILLNESS / RACE_DAY / RACE_WEEK / POST_RACE
 * mode. Renders ABOVE TodayCard so the runner sees the override first.
 * Today's standard prescription stays visible below for context, but the
 * card up top is the call.
 *
 * Reads from /api/coach/mode. Renders null in ACTIVE / MAINTENANCE /
 * MULTI_RACE / ONBOARDING modes (those don't override the prescription
 * — they shape the rest of the surface but Today still drives off
 * coach.prescribeWorkout).
 *
 * Per coach-layer spec §7 mode overrides.
 */

import { useEffect, useState } from 'react';

interface ModeResponse {
  ok: boolean;
  mode: string;
  modeVoice: string | null;
  overrides: {
    prescriptionSource: 'normal' | 'injury_protocol' | 'illness_rest' | 'race_morning' | null;
  };
}

const MODE_LABEL: Record<string, { eyebrow: string; tint: string }> = {
  injury:    { eyebrow: 'TODAY · INJURY PROTOCOL',  tint: '#E85D26' },
  illness:   { eyebrow: 'TODAY · REST FOR RECOVERY', tint: '#FC4D64' },
  race_day:  { eyebrow: 'TODAY · RACE DAY',          tint: '#3EBD41' },
  race_week: { eyebrow: 'TODAY · RACE WEEK',         tint: '#F3AD38' },
  post_race: { eyebrow: 'TODAY · POST-RACE WINDOW',  tint: '#008FEC' },
};

export function ModePrescriptionCard() {
  const [data, setData] = useState<ModeResponse | null>(null);

  useEffect(() => {
    fetch('/api/coach/mode').then((r) => r.json()).then((j: ModeResponse) => {
      if (j.ok) setData(j);
    }).catch(() => {});
  }, []);

  if (!data) return null;
  const label = MODE_LABEL[data.mode];
  if (!label || !data.modeVoice) return null;

  return (
    <div style={{
      background: '#fff',
      borderRadius: 14,
      padding: '18px 20px',
      marginBottom: 16,
      boxShadow: '0 1px 2px rgba(0,0,0,.04), 0 6px 20px rgba(0,0,0,.05)',
      borderLeft: `4px solid ${label.tint}`,
    }}>
      <div style={{
        fontSize: 10,
        fontWeight: 700,
        letterSpacing: 1.3,
        textTransform: 'uppercase',
        color: label.tint,
        marginBottom: 10,
      }}>
        {label.eyebrow}
      </div>
      <div style={{
        fontFamily: 'Jost, sans-serif',
        fontSize: 15,
        lineHeight: 1.55,
        color: '#080808',
      }}>
        {data.modeVoice}
      </div>
    </div>
  );
}
