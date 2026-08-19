'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Sheet } from '@/components/redesign/feedback/Sheet';
import { Input } from '@/components/redesign/core/Input';
import { Button } from '@/components/redesign/core/Button';

/**
 * components/redesign/log/LogSheetClient.tsx
 *
 * The redesigned Log Sheet screen — manually logging a run that wasn't
 * auto-captured by Strava/watch (treadmill, forgot to start the watch,
 * indoor session). Structurally ported from the outside-studio handoff's
 * WebLogSheet.jsx (designs/design-review-0818/ui_kits/web/WebLogSheet.jsx),
 * mounted in the shared Sheet shell, 2026-08-18.
 *
 * Wired to the real write path: POST /api/run/manual
 * (web-v2/app/api/run/manual/route.ts). That route's request body is the
 * data contract this form is built against — see the honesty-gap notes
 * below for exactly where this form diverges from the WebLogSheet.jsx mock
 * to stay honest about what /api/run/manual actually accepts and persists.
 *
 * HONESTY GAPS vs. the mock (see commit message for the full account):
 *
 *   · Effort (1-10 Stepper) and "How did it feel" (Select) — DROPPED. The
 *     route's insert (`data` object, route.ts:67-94) has no field for
 *     either; there is nowhere in `runs.data` for a manually-logged
 *     effort/feel rating to land. Same principle RunDetailClient.tsx
 *     applies to the design's fabricated 1-10 "Effort" score: don't build
 *     UI that pretends to save something the backend silently discards.
 *
 *   · The "Apple Watch already captured pace/HR — you're only confirming
 *     how it felt" banner — DROPPED. That banner describes WebLogSheet's
 *     OTHER mode (editing/confirming an auto-captured run passed in via
 *     the `run` prop). This task is specifically the "wasn't auto-captured"
 *     path — POST /api/run/manual — where there is no watch data to
 *     confirm; showing that banner here would be a lie.
 *
 *   · Date — ADDED. The mock has no date field (the source component's
 *     kicker takes the date from the `run` prop when editing an existing
 *     day). /api/run/manual requires `date` (`if (!body.date ...)
 *     return 400`) — a required field the mock doesn't show must still be
 *     present per this task's data contract, so a date input was added,
 *     defaulting to today.
 *
 *   · avg_hr_bpm, elev_gain_ft, name — accepted by the route (all
 *     optional, all validated/defaulted server-side) but NOT exposed as
 *     inputs in this pass, matching the mock's scope (distance, duration,
 *     note only, of the fields that survive the effort/feel cut). Left
 *     for a follow-up if David wants manual HR/elevation entry — noting
 *     this here rather than silently building past what the mock asked
 *     for.
 *
 *   · Duration — the mock's free-text "min:sec" field (e.g. "52:10") is
 *     kept as-is for input UX, then parsed to the decimal-minutes float
 *     `duration_min` the route expects (`Math.round(Number(body.
 *     duration_min) * 60)` — route.ts:28).
 *
 *   · Notes — mock's "Note (optional)" field maps directly to the route's
 *     optional `notes` field.
 */

function todayLocalISO(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** "52:10" → 52.1667 (decimal minutes). "1:02:10" → 62.1667. Plain "45" →
 *  45. Returns null on anything that doesn't parse — caller treats that
 *  as a validation error rather than silently sending garbage. */
function parseDurationMin(input: string): number | null {
  const s = input.trim();
  if (!s) return null;
  if (s.includes(':')) {
    const parts = s.split(':').map((p) => Number(p));
    if (parts.length === 2 && parts.every((p) => Number.isFinite(p))) {
      const [m, sec] = parts;
      return m + sec / 60;
    }
    if (parts.length === 3 && parts.every((p) => Number.isFinite(p))) {
      const [h, m, sec] = parts;
      return h * 60 + m + sec / 60;
    }
    return null;
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

export function LogSheetClient() {
  const router = useRouter();
  const [date, setDate] = useState(todayLocalISO());
  const [distance, setDistance] = useState('');
  const [duration, setDuration] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function close() {
    router.back();
  }

  async function handleSave() {
    setError(null);

    if (!date) {
      setError('Pick a date.');
      return;
    }
    const distanceMi = Number(distance.trim());
    if (!distance.trim() || !Number.isFinite(distanceMi) || distanceMi <= 0) {
      setError('Enter a distance greater than zero.');
      return;
    }
    let durationMin: number | null = null;
    if (duration.trim()) {
      durationMin = parseDurationMin(duration);
      if (durationMin == null) {
        setError('Duration should look like 52:10 (min:sec).');
        return;
      }
    }

    setBusy(true);
    try {
      const res = await fetch('/api/run/manual', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          date,
          distance_mi: distanceMi,
          ...(durationMin != null ? { duration_min: durationMin } : {}),
          ...(notes.trim() ? { notes: notes.trim() } : {}),
        }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.ok) {
        setError(json?.error ?? 'Could not save that run.');
        return;
      }
      if (json.dropped) {
        // route.ts's sub-threshold guard: distanceMi < 0.25 AND durationSec
        // < 180 both fail → the row was never written. Say so plainly
        // rather than routing to a run detail page that doesn't exist.
        setError("That's too short to log as a run — check the distance and duration.");
        return;
      }
      router.push(`/runs/${encodeURIComponent(json.id)}`);
    } catch {
      setError('Could not reach the server. Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet
      title="Log a run"
      kicker="Manual entry"
      onClose={close}
      footer={
        <>
          <Button variant="ghost" onClick={close} disabled={busy}>Discard</Button>
          <Button variant="primary" onClick={handleSave} disabled={busy}>{busy ? 'Saving…' : 'Save run'}</Button>
        </>
      }
    >
      {error && (
        <div style={{ fontSize: 'var(--type-label-s)', color: 'var(--fault)' }}>{error}</div>
      )}
      <Input full label="Date" value={date} onChange={setDate} type="date" />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,minmax(0,1fr))', gap: 'var(--sp-6)' }}>
        <Input full label="Distance" value={distance} onChange={setDistance} unit="mi" type="text" placeholder="6.0" />
        <Input full label="Duration" value={duration} onChange={setDuration} unit="min:sec" type="text" placeholder="52:10"
          helper="Optional" />
      </div>
      <Input full label="Note (optional)" value={notes} onChange={setNotes} helper="Anything the coach should know" />
    </Sheet>
  );
}
