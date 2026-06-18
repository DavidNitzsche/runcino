'use client';

import { useEffect, useRef, useState } from 'react';

type Tweaks = { density: 'compact'|'regular'|'comfy'; corners: 'soft'|'rounded'|'sharp'; mesh: 'calm'|'balanced'|'vivid'; accent: 'ember'|'gold'|'violet'|'cool' };
const DEF: Tweaks = { density: 'regular', corners: 'rounded', mesh: 'balanced', accent: 'ember' };
const PAD = { compact: '16px', regular: '22px', comfy: '30px' };
const RAD = { soft: '22px', rounded: '16px', sharp: '8px' };

export function TweaksPanel() {
  const [open, setOpen] = useState(false);
  const [t, setT] = useState<Tweaks>(DEF);
  const panelRef = useRef<HTMLDivElement>(null);
  const headRef = useRef<HTMLDivElement>(null);

  // Restore from local storage on mount.
  useEffect(() => {
    try {
      const raw = localStorage.getItem('faffTweaks');
      if (raw) setT({ ...DEF, ...(JSON.parse(raw) as Partial<Tweaks>) });
    } catch { /* swallow */ }
  }, []);

  // Apply CSS vars + attrs to the .win shell.
  useEffect(() => {
    const win = document.querySelector('.win') as HTMLElement | null;
    if (!win) return;
    win.style.setProperty('--card-pad', PAD[t.density]);
    win.style.setProperty('--card-radius', RAD[t.corners]);
    win.setAttribute('data-mesh', t.mesh);
    win.setAttribute('data-accent', t.accent);
    try { localStorage.setItem('faffTweaks', JSON.stringify(t)); } catch { /* swallow */ }
  }, [t]);

  // Host-protocol hooks for the Claude Design preview iframe.
  useEffect(() => {
    function onMsg(e: MessageEvent) {
      const ty = (e?.data as { type?: string } | undefined)?.type;
      if (ty === '__activate_edit_mode') setOpen(true);
      else if (ty === '__deactivate_edit_mode') setOpen(false);
    }
    window.addEventListener('message', onMsg);
    try { window.parent.postMessage({ type: '__edit_mode_available' }, '*'); } catch { /* swallow */ }
    return () => window.removeEventListener('message', onMsg);
  }, []);

  // Drag the panel by its header.
  useEffect(() => {
    const head = headRef.current; const panel = panelRef.current;
    if (!head || !panel) return;
    let dragging = false, sx = 0, sy = 0, ox = 0, oy = 0;
    function down(e: PointerEvent) {
      const target = e.target as HTMLElement;
      if (target.closest('.fft-x')) return;
      dragging = true;
      const r = panel!.getBoundingClientRect();
      ox = r.left; oy = r.top; sx = e.clientX; sy = e.clientY;
      panel!.style.right = 'auto'; panel!.style.bottom = 'auto';
      panel!.style.left = ox + 'px'; panel!.style.top = oy + 'px';
      head!.setPointerCapture(e.pointerId);
    }
    function move(e: PointerEvent) {
      if (!dragging) return;
      panel!.style.left = (ox + e.clientX - sx) + 'px';
      panel!.style.top  = (oy + e.clientY - sy) + 'px';
    }
    function up() { dragging = false; }
    head.addEventListener('pointerdown', down);
    head.addEventListener('pointermove', move);
    head.addEventListener('pointerup', up);
    return () => {
      head.removeEventListener('pointerdown', down);
      head.removeEventListener('pointermove', move);
      head.removeEventListener('pointerup', up);
    };
  }, []);

  function set<K extends keyof Tweaks>(k: K, v: Tweaks[K]) {
    setT(prev => ({ ...prev, [k]: v }));
    try { window.parent.postMessage({ type: '__edit_mode_set_keys', edits: { [k]: v } }, '*'); } catch { /* swallow */ }
  }

  return (
    <div ref={panelRef} className={`fft-panel${open ? ' open' : ''}`}>
      <div className="fft-hd" ref={headRef}>
        <b>Tweaks</b>
        <button className="fft-x" aria-label="Close" onClick={() => {
          setOpen(false);
          try { window.parent.postMessage({ type: '__edit_mode_dismissed' }, '*'); } catch { /* swallow */ }
        }}>✕</button>
      </div>
      <div className="fft-body">
        <div className="fft-sect">Layout</div>
        <Seg label="Density" opts={['compact','regular','comfy']} value={t.density} onChange={(v) => set('density', v as Tweaks['density'])} />
        <Seg label="Corners" opts={['soft','rounded','sharp']}    value={t.corners} onChange={(v) => set('corners', v as Tweaks['corners'])} />
        <div className="fft-sect">Atmosphere</div>
        <Seg label="Mesh"    opts={['calm','balanced','vivid']}   value={t.mesh}    onChange={(v) => set('mesh', v as Tweaks['mesh'])} />
        <div className="fft-row col">
          <span>Accent</span>
          <div className="fft-swatches">
            {[['ember','#D03F3F'],['gold','#F0DF47'],['violet','#A78BFA'],['cool','#27B4E0']].map(([v,c]) => (
              <button key={v} title={cap(v)} style={{ background: c }} className={t.accent === v ? 'on' : ''} onClick={() => set('accent', v as Tweaks['accent'])} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
function Seg({ label, opts, value, onChange }: { label: string; opts: string[]; value: string; onChange: (v: string) => void }) {
  return (
    <div className="fft-row">
      <span>{label}</span>
      <div className="fft-seg">
        {opts.map(o => (
          <button key={o} className={value === o ? 'on' : ''} onClick={() => onChange(o)}>{cap(o)}</button>
        ))}
      </div>
    </div>
  );
}
function cap(s: string) { return s[0].toUpperCase() + s.slice(1); }
