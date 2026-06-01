/**
 * GET    /api/injuries  — { injuries: InjuryRow[] }   open (resolved_date NULL)
 *                                                     + recently-resolved (<30d)
 * POST   /api/injuries  — body { body_part, severity, started_iso?, side?, notes?,
 *                                expected_return_iso?, return_protocol? }
 *                         Returns { ok: true, injury: InjuryRow }
 *
 * "Injury" = the escalation surface above a niggle. When a row exists with
 * `resolved_date IS NULL`, lib/plan/adapt.ts.detectInjuryActive() flags
 * the runner as INJURY-mode and lib/plan/injury-builder.ts will generate
 * a walk-run scaffold on accept. The whole pipeline was blocked on the
 * absence of this route — SymptomReportSheet had nowhere to POST.
 *
 * Schema (live DB, 2026-05-31):
 *   id integer PK · user_id text · user_uuid uuid · site text NOT NULL
 *   severity text NOT NULL DEFAULT 'minor'    -- enum {minor,moderate,major}
 *   return_protocol text · notes text
 *   start_date date NOT NULL DEFAULT CURRENT_DATE
 *   expected_return_date date · resolved_date date
 *   created_at timestamptz NOT NULL DEFAULT now()
 *
 * Severity translation: the iPhone sheet talks in a 1-10 pain scale (the
 * runner-anchored scale used by niggles + the research/05 watchword
 * "pain ≥ 4/10 stops the session"). The DB enum is text {minor,moderate,
 * major}. Map:
 *   1-3  → minor
 *   4-6  → moderate
 *   7-10 → major
 * The string form is what injury-builder.ts reads to pick a 2/3/4-week
 * walk-run scaffold, so the mapping must be consistent here.
 *
 * The `site` column is plain English (e.g. "right calf"). The route
 * composes it from body_part + optional side ("calf" + "right" → "right
 * calf"). Per the voice doctrine that landed in c14df7c5, server-supplied
 * labels stay in runner language — no ICD codes, no medical jargon.
 *
 * Auth: requireUserId(req) — same pattern as /api/runs/[id]/route.ts.
 * Defensive types: every field optional in the decoder, sensible
 * defaults, a clear 4xx with a JSON body that names the missing field
 * rather than a 500.
 */
import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/lib/db/pool';
import { requireUserId } from '@/lib/auth/session';

interface InjuryPostBody {
  body_part?: string | null;
  side?: 'left' | 'right' | 'both' | null;
  severity?: number | string | null;
  started_iso?: string | null;
  notes?: string | null;
  expected_return_iso?: string | null;
  return_protocol?: string | null;
}

type SeverityEnum = 'minor' | 'moderate' | 'major';

/** Map the runner-facing 1-10 pain scale to the DB enum. Out-of-range
 *  numbers clamp to the nearest bucket; non-numeric strings already in
 *  the enum pass through; everything else falls to 'minor' (the table
 *  default, so the row still inserts cleanly). */
function normalizeSeverity(s: unknown): SeverityEnum {
  if (typeof s === 'string') {
    const t = s.trim().toLowerCase();
    if (t === 'minor' || t === 'moderate' || t === 'major') return t;
    const n = Number(t);
    if (Number.isFinite(n)) return bucketFromScore(n);
  }
  if (typeof s === 'number' && Number.isFinite(s)) return bucketFromScore(s);
  return 'minor';
}
function bucketFromScore(n: number): SeverityEnum {
  if (n <= 3) return 'minor';
  if (n <= 6) return 'moderate';
  return 'major';
}

/** Compose a plain-English site label from body_part + optional side.
 *  "calf" + "right" → "right calf". Trim defensively; the schema column
 *  is NOT NULL so an empty body_part is a 400 caught upstream. */
function composeSite(bodyPart: string, side: string | null | undefined): string {
  const part = bodyPart.trim().toLowerCase();
  if (!side) return part;
  const s = String(side).trim().toLowerCase();
  if (s === 'left' || s === 'right' || s === 'both') return `${s} ${part}`;
  return part;
}

async function readJson<T>(req: NextRequest): Promise<Partial<T>> {
  try {
    const text = await req.text();
    if (!text) return {};
    return JSON.parse(text) as Partial<T>;
  } catch {
    return {};
  }
}

const SELECT_INJURY_COLS = `
  id, site, severity, return_protocol, notes,
  start_date::text AS start_date,
  expected_return_date::text AS expected_return_date,
  resolved_date::text AS resolved_date,
  created_at
`;

export async function GET(req: NextRequest) {
  const auth = await requireUserId(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth;
  try {
    // Open injuries (resolved_date NULL) plus anything resolved in the
    // last 30 days — the iPhone history view wants both, and a recently-
    // healed injury still informs return-to-run framing.
    const rows = (await pool.query(
      `SELECT ${SELECT_INJURY_COLS}
         FROM runner_injuries
        WHERE user_uuid = $1
          AND (resolved_date IS NULL OR resolved_date >= CURRENT_DATE - INTERVAL '30 days')
        ORDER BY (resolved_date IS NULL) DESC, start_date DESC`,
      [userId],
    )).rows;
    return NextResponse.json({ injuries: rows }, {
      headers: { 'Cache-Control': 'private, no-cache, must-revalidate' },
    });
  } catch (err: any) {
    // Same lenient posture as /api/sick GET — return an empty list +
    // warning rather than 500ing so the iPhone history view degrades
    // gracefully on a transient DB hiccup.
    return NextResponse.json({ injuries: [], warning: err?.message ?? String(err) });
  }
}

export async function POST(req: NextRequest) {
  const auth = await requireUserId(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth;
  const body = await readJson<InjuryPostBody>(req);

  // body_part is the only truly-required field — severity defaults to
  // minor, started_iso defaults to today (schema default). Surface a
  // precise 4xx rather than letting the NOT NULL site column 500 the
  // request.
  const bodyPart = typeof body.body_part === 'string' ? body.body_part.trim() : '';
  if (!bodyPart) {
    return NextResponse.json(
      { error: 'missing required field', need: ['body_part'] },
      { status: 400 },
    );
  }
  // started_iso must be YYYY-MM-DD if provided; otherwise the column
  // defaults to CURRENT_DATE.
  let startISO: string | null = null;
  if (typeof body.started_iso === 'string' && body.started_iso.trim()) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(body.started_iso.trim())) {
      return NextResponse.json(
        { error: 'started_iso must be YYYY-MM-DD' },
        { status: 400 },
      );
    }
    startISO = body.started_iso.trim();
  }
  let expectedReturnISO: string | null = null;
  if (typeof body.expected_return_iso === 'string' && body.expected_return_iso.trim()) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(body.expected_return_iso.trim())) {
      return NextResponse.json(
        { error: 'expected_return_iso must be YYYY-MM-DD' },
        { status: 400 },
      );
    }
    expectedReturnISO = body.expected_return_iso.trim();
  }

  const severity = normalizeSeverity(body.severity);
  const site = composeSite(bodyPart, body.side ?? null);
  const notes = typeof body.notes === 'string' && body.notes.trim() ? body.notes.trim() : null;
  const returnProtocol = typeof body.return_protocol === 'string' && body.return_protocol.trim()
    ? body.return_protocol.trim()
    : null;

  try {
    const ins = await pool.query(
      `INSERT INTO runner_injuries
         (user_id, user_uuid, site, severity, return_protocol, notes,
          start_date, expected_return_date)
       VALUES ('me', $1, $2, $3, $4, $5,
               COALESCE($6::date, CURRENT_DATE), $7::date)
       RETURNING ${SELECT_INJURY_COLS}`,
      [userId, site, severity, returnProtocol, notes, startISO, expectedReturnISO],
    );
    return NextResponse.json({ ok: true, injury: ins.rows[0] });
  } catch (err: any) {
    return NextResponse.json({
      error: 'injury insert failed',
      detail: err?.message ?? String(err),
    }, { status: 500 });
  }
}

export const dynamic = 'force-dynamic';
