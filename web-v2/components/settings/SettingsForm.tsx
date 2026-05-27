'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import type { UserSettings } from '@/lib/coach/settings';

const DOWS = [
  { v: 'sun', l: 'Sunday' },   { v: 'mon', l: 'Monday' }, { v: 'tue', l: 'Tuesday' },
  { v: 'wed', l: 'Wednesday' }, { v: 'thu', l: 'Thursday' }, { v: 'fri', l: 'Friday' },
  { v: 'sat', l: 'Saturday' },
];

export function SettingsForm({ initial }: { initial: UserSettings }) {
  const router = useRouter();
  const [s, setS] = useState<UserSettings>(initial);
  const [saving, startSaving] = useTransition();
  const [ack, setAck] = useState<string | null>(null);

  function patch<K extends keyof UserSettings>(key: K, value: UserSettings[K]) {
    const next = { ...s, [key]: value };
    setS(next);
    setAck(null);
    startSaving(async () => {
      try {
        const r = await fetch('/api/settings', {
          method: 'PATCH', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ [key]: value }),
        });
        if (r.ok) {
          setAck(`Saved ${String(key).replace(/_/g, ' ')}.`);
          setTimeout(() => setAck(null), 2000);
          router.refresh();
        } else {
          setAck("(couldn't save)");
        }
      } catch { setAck("(couldn't save)"); }
    });
  }

  function toggleQuality(d: UserSettings['quality_days'][number]) {
    const has = s.quality_days.includes(d);
    const next = has ? s.quality_days.filter((x) => x !== d) : [...s.quality_days, d];
    patch('quality_days', next as any);
  }

  return (
    <div style={{ marginTop: 28 }}>
      <Section title="NOTIFICATIONS">
        <Row k="Briefing time" v={
          <input
            type="time"
            value={s.briefing_time}
            onChange={(e) => patch('briefing_time', e.target.value)}
            style={inputStyle()}
          />
        } />
        <Row k="Push notifications" v={
          <Toggle on={s.push_enabled} onChange={(v) => patch('push_enabled', v)} />
        } />
      </Section>

      <Section title="UNITS">
        <Row k="Distance" v={
          <Picker value={s.units_distance} options={['mi', 'km']} onChange={(v) => patch('units_distance', v as any)} />
        } />
        <Row k="Pace" v={
          <Picker value={s.units_pace} options={['min_per_mi', 'min_per_km']} labels={['min/mi', 'min/km']}
            onChange={(v) => patch('units_pace', v as any)} />
        } />
        <Row k="Temperature" v={
          <Picker value={s.units_temp} options={['F', 'C']} onChange={(v) => patch('units_temp', v as any)} />
        } />
      </Section>

      <Section title="WEEK SHAPE">
        <Row k="Long run day" v={
          <select value={s.long_run_day} onChange={(e) => patch('long_run_day', e.target.value as any)} style={inputStyle()}>
            {DOWS.map((d) => <option key={d.v} value={d.v}>{d.l}</option>)}
          </select>
        } />
        <Row k="Quality days" v={
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            {DOWS.map((d) => (
              <button key={d.v} onClick={() => toggleQuality(d.v as any)} style={{
                background: s.quality_days.includes(d.v as any) ? 'rgba(243,173,56,0.18)' : 'transparent',
                border: `1px solid ${s.quality_days.includes(d.v as any) ? 'var(--goal)' : 'var(--line)'}`,
                color: s.quality_days.includes(d.v as any) ? 'var(--goal)' : 'var(--mute)',
                padding: '4px 10px', borderRadius: 6,
                fontFamily: 'var(--f-label)', fontSize: 11, letterSpacing: '1px', cursor: 'pointer',
              }}>{d.v.toUpperCase()}</button>
            ))}
          </div>
        } />
        <Row k="Rest day" v={
          <select value={s.rest_day} onChange={(e) => patch('rest_day', e.target.value as any)} style={inputStyle()}>
            {DOWS.map((d) => <option key={d.v} value={d.v}>{d.l}</option>)}
          </select>
        } />
      </Section>

      <Section title="INTEGRATIONS">
        <Row k="Strava"       v={<Pill>● CONNECTED</Pill>} />
        <Row k="Apple Health" v={<Pill>● CONNECTED</Pill>} />
        <Row k="Apple Watch"  v={<Pill>● PAIRED</Pill>} />
        <Row k="" v={<div style={{ fontSize: 11, color: 'var(--dim)' }}>Real OAuth landing in P8.</div>} />
      </Section>

      {ack && (
        <div style={{
          position: 'fixed', bottom: 24, right: 24,
          background: 'var(--green)', color: '#001',
          padding: '10px 18px', borderRadius: 8,
          fontFamily: 'var(--f-label)', fontSize: 12, letterSpacing: '1.2px',
          zIndex: 100,
        }}>{ack}</div>
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginTop: 32 }}>
      <div style={{ fontFamily: 'var(--f-body)', fontSize: 11, fontWeight: 700, color: 'var(--mute)', letterSpacing: '1.6px', marginBottom: 10 }}>{title}</div>
      <div className="card" style={{ padding: 0 }}>{children}</div>
    </div>
  );
}

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 18px', borderBottom: '1px solid var(--line-2)', fontSize: 13 }}>
      <span style={{ color: 'var(--mute)' }}>{k}</span>
      <div>{v}</div>
    </div>
  );
}

function Picker<T extends string>({ value, options, labels, onChange }: { value: T; options: T[]; labels?: string[]; onChange: (v: T) => void }) {
  return (
    <div style={{ display: 'flex', gap: 4 }}>
      {options.map((o, i) => {
        const selected = o === value;
        return (
          <button key={o} onClick={() => onChange(o)} style={{
            // Selected: solid green fill + dark ink (high contrast).
            // Unselected: subtle bg + clearer body ink so it reads as a button.
            background: selected ? 'var(--green)' : 'rgba(255,255,255,0.04)',
            border: `1px solid ${selected ? 'var(--green)' : 'rgba(255,255,255,0.12)'}`,
            color: selected ? '#0a0a0c' : 'rgba(246,247,248,0.82)',
            padding: '7px 14px', borderRadius: 7,
            fontFamily: 'var(--f-label)', fontSize: 12, letterSpacing: '1.2px',
            fontWeight: selected ? 700 : 500,
            cursor: 'pointer', transition: 'all .12s',
          }}>{(labels?.[i] ?? o).toUpperCase()}</button>
        );
      })}
    </div>
  );
}

function Toggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button onClick={() => onChange(!on)} style={{
      width: 40, height: 22, borderRadius: 11,
      background: on ? 'var(--green)' : 'rgba(255,255,255,0.08)',
      border: 'none', cursor: 'pointer', position: 'relative',
      transition: 'background .15s',
    }}>
      <span style={{
        position: 'absolute', top: 2, left: on ? 20 : 2,
        width: 18, height: 18, borderRadius: '50%', background: '#fff',
        transition: 'left .15s',
      }} />
    </button>
  );
}

function Pill({ children }: { children: React.ReactNode }) {
  return <span style={{ color: 'var(--green)', fontSize: 11, letterSpacing: '1px' }}>{children}</span>;
}

function inputStyle(): React.CSSProperties {
  return {
    fontFamily: 'var(--f-body)', fontSize: 12, color: 'var(--ink)',
    background: 'rgba(255,255,255,0.04)', border: '1px solid var(--line)',
    borderRadius: 6, padding: '4px 8px',
  };
}
