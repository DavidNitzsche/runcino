'use client';

import { useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

/** + COURSE GPX — file picker, POST /api/race/gpx, router.refresh on success. */
export function GpxUploadButton({ slug, alreadyAttached }: { slug: string; alreadyAttached: boolean }) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [pending, startPending] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    setErr(null); setMsg(`Parsing ${f.name}…`);
    startPending(async () => {
      const fd = new FormData();
      fd.append('slug', slug);
      fd.append('file', f);
      try {
        const r = await fetch('/api/race/gpx', { method: 'POST', body: fd });
        const data = await r.json();
        if (!r.ok) { setErr(data.error ?? 'Upload failed'); setMsg(null); return; }
        setMsg(`✓ ${data.summary.points} points · ${data.summary.distance_mi}mi · +${data.summary.elevation_gain_ft}ft`);
        router.refresh();
      } catch (e: any) {
        setErr(e.message ?? String(e)); setMsg(null);
      } finally {
        if (fileRef.current) fileRef.current.value = '';
      }
    });
  }

  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 12 }}>
      <input
        ref={fileRef}
        type="file"
        accept=".gpx,application/gpx+xml"
        onChange={onPick}
        style={{ display: 'none' }}
      />
      <button
        onClick={() => fileRef.current?.click()}
        disabled={pending}
        style={{
          background: alreadyAttached ? 'var(--card-2)' : 'rgba(62,189,65,0.10)',
          border: `1px solid ${alreadyAttached ? 'var(--line)' : 'rgba(62,189,65,0.30)'}`,
          color: alreadyAttached ? 'var(--mute)' : 'var(--green)',
          padding: '8px 14px', borderRadius: 8,
          fontFamily: 'var(--f-label)', fontSize: 12, letterSpacing: '1.2px',
          cursor: pending ? 'default' : 'pointer', opacity: pending ? 0.6 : 1,
        }}>
        {pending ? 'UPLOADING…' : alreadyAttached ? '+ REPLACE COURSE GPX' : '+ COURSE GPX'}
      </button>
      {msg && <span style={{ color: 'var(--green)', fontSize: 11, fontFamily: 'var(--f-body)' }}>{msg}</span>}
      {err && <span style={{ color: 'var(--over)', fontSize: 11, fontFamily: 'var(--f-body)' }}>{err}</span>}
    </div>
  );
}
