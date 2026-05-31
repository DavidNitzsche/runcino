'use client';

/**
 * Faff Toolkit · Family J · Coach Verdict & Narration
 *
 * RunPurposeCard — pre-run "WHY THIS RUN" verdict + facts + citations.
 * RunRecapCard   — post-run verdict + facts + conditions_note + coach_tip.
 * PostRunCheckinChips — post-run execution/body chip selector with canned
 *                       coach reply via /api/checkin.
 *
 * Endpoints (unblocked as of 2026-05-31):
 *   GET /api/today/purpose?date=YYYY-MM-DD
 *   GET /api/runs/[id]/recap
 *   POST /api/checkin
 *
 * Shape matches lib/coach/{run-purpose,run-recap,checkin-reply-canned}.ts.
 */
import { useEffect, useState } from 'react';
import { CitationChip, FaEmpty, FaError, FaSkeleton, HeatBandChip, type HeatBand } from './atoms';

interface Citation { slug: string; label: string }

/* Note: as of 2026-05-31, the coach engines (run-purpose, run-recap)
   dropped citations[] from their output per the "plain English voice,
   no PhD jargon" doctrine update. We keep the optional field for
   back-compat; the UI silently hides the chip row when absent. */
interface PurposePayload {
  ok?: boolean;
  date?: string;
  type?: string;
  verdict: string;
  facts: string[];
  citations?: Citation[];
  raceDistanceMi?: number | null;
  weeksToRace?: number | null;
  heatBand?: HeatBand | null;
}

interface RecapPayload {
  ok?: boolean;
  verdict: string;
  facts: string[];
  coach_tip: string | null;
  conditions_note: string | null;
  citations?: Citation[];
  heatBand?: HeatBand | null;
}

/* ============================================================
   RunPurposeCard · pre-run brief. Lives on Today's right rail
   (replacing the static planVerdict / planRecap line).
   ============================================================ */
export function RunPurposeCard({
  date,
  initial,
  eyebrow = 'WHY THIS RUN',
}: {
  date?: string;
  initial?: PurposePayload | null;
  eyebrow?: string;
}) {
  const [data, setData] = useState<PurposePayload | null>(initial ?? null);
  const [state, setState] = useState<'idle' | 'loading' | 'error'>(initial ? 'idle' : 'loading');
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (initial) return;
    let alive = true;
    setState('loading');
    const qs = date ? `?date=${date}` : '';
    fetch(`/api/today/purpose${qs}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((j) => {
        if (alive) {
          setData(j as PurposePayload);
          setState('idle');
        }
      })
      .catch((e) => {
        if (alive) {
          setErr(e instanceof Error ? e.message : String(e));
          setState('error');
        }
      });
    return () => { alive = false; };
  }, [date, initial]);

  if (state === 'loading') {
    return (
      <div className="fa-verdict">
        <span className="eyebrow">{eyebrow}</span>
        <div style={{ marginTop: 11 }}>
          <FaSkeleton lines={3} />
        </div>
      </div>
    );
  }
  if (state === 'error') {
    return <FaError text={`Couldn't load today's purpose. ${err ?? ''}`.trim()} />;
  }
  if (!data || !data.verdict) return null;

  return (
    <article className="fa-verdict">
      <span className="eyebrow">{eyebrow}</span>
      <h2 className="vd">{data.verdict}</h2>
      {data.facts.length > 0 ? (
        <div className="facts">
          {data.facts.map((f, i) => (
            <p key={i} className="f" dangerouslySetInnerHTML={{ __html: renderInline(f) }} />
          ))}
        </div>
      ) : null}
      {data.heatBand && data.heatBand !== 'neutral' ? (
        <div style={{ marginTop: 13 }}>
          <HeatBandChip band={data.heatBand} />
        </div>
      ) : null}
      {data.citations && data.citations.length > 0 ? (
        <div className="cites fa-cite-row">
          {data.citations.map((c) => (
            <CitationChip key={c.slug} slug={c.slug} label={c.label} />
          ))}
        </div>
      ) : null}
    </article>
  );
}

/* ============================================================
   RunRecapCard · post-run verdict + conditions + coach_tip.
   Lives as the headline above splits + zones on /runs/[id].
   ============================================================ */
export function RunRecapCard({
  runId,
  initial,
  eyebrow = 'WHAT THIS RUN DID',
}: {
  runId?: string;
  initial?: RecapPayload | null;
  eyebrow?: string;
}) {
  const [data, setData] = useState<RecapPayload | null>(initial ?? null);
  const [state, setState] = useState<'idle' | 'loading' | 'error'>(initial ? 'idle' : runId ? 'loading' : 'idle');
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (initial || !runId) return;
    let alive = true;
    setState('loading');
    fetch(`/api/runs/${encodeURIComponent(runId)}/recap`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((j) => {
        if (alive) {
          setData(j as RecapPayload);
          setState('idle');
        }
      })
      .catch((e) => {
        if (alive) {
          setErr(e instanceof Error ? e.message : String(e));
          setState('error');
        }
      });
    return () => { alive = false; };
  }, [runId, initial]);

  if (state === 'loading') {
    return (
      <div className="fa-verdict">
        <span className="eyebrow">{eyebrow}</span>
        <div style={{ marginTop: 11 }}><FaSkeleton lines={3} /></div>
      </div>
    );
  }
  if (state === 'error') {
    return <FaError text={`Couldn't load the recap. ${err ?? ''}`.trim()} />;
  }
  if (!data || !data.verdict) return null;

  return (
    <article className="fa-verdict">
      <span className="eyebrow">{eyebrow}</span>
      <h2 className="vd">{data.verdict}</h2>
      {data.facts.length > 0 ? (
        <div className="facts">
          {data.facts.map((f, i) => (
            <p key={i} className="f" dangerouslySetInnerHTML={{ __html: renderInline(f) }} />
          ))}
        </div>
      ) : null}
      {data.conditions_note ? (
        <div className="fa-callout fa-callout--cond">
          <span className="ic"><FlameSmall /></span>
          <span className="tx">
            <span className="lbl">Conditions</span>
            {data.conditions_note}
          </span>
        </div>
      ) : null}
      {data.coach_tip ? (
        <div className="fa-callout fa-callout--tip">
          <span className="ic"><LightBulb /></span>
          <span className="tx">
            <span className="lbl">Next time</span>
            {data.coach_tip}
          </span>
        </div>
      ) : null}
      {data.citations && data.citations.length > 0 ? (
        <div className="cites fa-cite-row">
          {data.citations.map((c) => (
            <CitationChip key={c.slug} slug={c.slug} label={c.label} />
          ))}
        </div>
      ) : null}
    </article>
  );
}

/* ============================================================
   PostRunCheckinChips · execution + body chip groups + canned reply.
   POSTs to /api/checkin which returns the canned coach_reply.
   ============================================================ */
const EXECUTION_OPTS = ['solid', 'fine', 'rough', 'cut short'];
const BODY_OPTS = ['legs heavy', 'breathing labored', 'felt smooth', 'side stitch', 'cramp'];

export function PostRunCheckinChips({
  runId,
  onComplete,
}: {
  runId: string;
  onComplete?: (reply: string) => void;
}) {
  const [execution, setExecution] = useState<string | null>(null);
  const [body, setBody] = useState<string[]>([]);
  const [reply, setReply] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  function toggleBody(b: string) {
    setBody((cur) => (cur.includes(b) ? cur.filter((x) => x !== b) : [...cur, b]));
  }

  async function submit() {
    if (!execution) return;
    setBusy(true);
    setErr(null);
    try {
      const r = await fetch('/api/checkin', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ run_id: runId, execution, body_chips: body }),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = await r.json();
      const reply = typeof j.coach_reply === 'string' ? j.coach_reply : null;
      setReply(reply);
      if (reply && onComplete) onComplete(reply);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  if (reply) {
    return (
      <div className="fa-reply" role="status">
        <span className="av">F</span>
        <span className="tx">{reply}</span>
      </div>
    );
  }

  return (
    <div className="fa-checkchips">
      <div className="q">How did it go?</div>
      <div className="grp">
        {EXECUTION_OPTS.map((o) => (
          <button
            key={o}
            type="button"
            className={`c${execution === o ? ' sel' : ''}`}
            onClick={() => setExecution(o)}
          >
            {o}
          </button>
        ))}
      </div>
      <div className="q">Body</div>
      <div className="grp">
        {BODY_OPTS.map((o) => (
          <button
            key={o}
            type="button"
            className={`c${body.includes(o) ? ' sel' : ''}`}
            onClick={() => toggleBody(o)}
          >
            {o}
          </button>
        ))}
      </div>
      {err ? <p className="fa-prov" style={{ color: 'var(--over)' }}>{err}</p> : null}
      <button
        type="button"
        className="fa-submit"
        onClick={submit}
        disabled={!execution || busy}
      >
        {busy ? 'Saving…' : 'Submit'}
      </button>
    </div>
  );
}

/* ============================================================
   Helpers
   ============================================================ */
function renderInline(s: string): string {
  // Tiny safe transform · supports *bold* markers from the coach engine.
  const esc = s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  return esc.replace(/\*([^*]+)\*/g, '<b>$1</b>');
}

function FlameSmall() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M8 14c2.8 0 5-2 5-4.5 0-2-1.5-3-2-4-1 1-2 2-3 2-2 0-2.5-2-2.5-2S3 7 3 9.5 5.2 14 8 14z" />
    </svg>
  );
}
function LightBulb() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 11h4M7 14h2M8 2a4 4 0 014 4c0 1.5-1 2.5-2 4h-4c-1-1.5-2-2.5-2-4a4 4 0 014-4z" />
    </svg>
  );
}
