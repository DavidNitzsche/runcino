/**
 * POST /api/race/[slug]/autofill
 *
 * The "killer" race-page feature (David 2026-06-17): Claude reads the official
 * race site — or finds it by name — and extracts race-day logistics: start
 * time, corral/wave, start-line location, parking, shuttle, packet pickup, the
 * official URL, and concise general notes.
 *
 * It returns a PROPOSAL the runner reviews and confirms on the phone; it does
 * NOT write to the race. The client PATCHes the chosen fields via /api/race
 * (the same logistics keys the inline editor uses), so the runner is always in
 * the loop and nothing is silently overwritten.
 *
 * Gated on ANTHROPIC_API_KEY — the FIRST LLM call in the stack. When the key
 * isn't set the route returns { available: false } so the client degrades to
 * the manual editor. Uses the Anthropic Messages API directly (raw fetch, no
 * SDK dep) with the web_search server tool so Claude can both find the race by
 * name and read its pages, then a forced extraction tool for clean structure.
 */
import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/lib/db/pool';
import { requireUserId } from '@/lib/auth/session';
import { elevationGainFt } from '@/lib/race/gpx-parser';

export const dynamic = 'force-dynamic';
export const maxDuration = 60; // web search + extraction can take 10-40s

interface AutofillProposal {
  startTime: string | null;
  wave: string | null; // corral
  bib: string | null;
  location: string | null; // start line / venue
  parking: string | null;
  shuttle: string | null;
  packetPickup: string | null;
  officialUrl: string | null;
  notes: string | null;
  summary: string | null; // "what to expect" blurb, grounded in OUR terrain
  aidStations: string | null; // water / aid / on-course support
}

/**
 * Compact, AUTHORITATIVE terrain summary from the stored GPX so the blurb's
 * elevation claims come from the runner's actual course, not the website's
 * marketing copy. Net change by quarter gives Claude the course's shape
 * ("drops hard early, flat middle, rise at the finish") to write something
 * specific. Returns null when there's no usable elevation track.
 */
function buildTerrainHint(geo: unknown, distMi: number | null): string | null {
  if (!geo || typeof geo !== 'object') return null;
  const tp = (geo as { trackPoints?: Array<{ ele?: number | null }> }).trackPoints ?? [];
  const eles = tp.map((p) => p?.ele).filter((e): e is number => typeof e === 'number');
  if (eles.length < 4) return null;
  const ft = (m: number) => Math.round(m * 3.28084);
  const startFt = ft(eles[0]);
  const finishFt = ft(eles[eles.length - 1]);
  const net = finishFt - startFt;
  const gain = elevationGainFt(eles);
  const at = (frac: number) => eles[Math.min(eles.length - 1, Math.max(0, Math.round(frac * (eles.length - 1))))];
  const q = (a: number, b: number) => ft(at(b) - at(a));
  const sgn = (n: number) => (n > 0 ? `+${n}` : `${n}`);
  const distStr = distMi && distMi > 0 ? `${distMi.toFixed(1)} mi, ` : '';
  return (
    `AUTHORITATIVE course terrain from the runner's GPX (use THIS for any elevation claim, not the website): ` +
    `${distStr}${gain} ft total climb, net ${sgn(net)} ft (${startFt} ft start to ${finishFt} ft finish). ` +
    `Net elevation change by quarter: Q1 ${sgn(q(0, 0.25))} ft, Q2 ${sgn(q(0.25, 0.5))} ft, Q3 ${sgn(q(0.5, 0.75))} ft, Q4 ${sgn(q(0.75, 1))} ft.`
  );
}

// Forced extraction tool · Claude calls this exactly once with what it found.
const EXTRACT_TOOL = {
  name: 'race_logistics',
  description:
    'Record the race-day logistics found for this race. Use null for any field you cannot confirm from the official source — never guess or infer.',
  input_schema: {
    type: 'object',
    properties: {
      startTime: { type: ['string', 'null'], description: 'Gun/start time, e.g. "7:00 AM". The first wave start if multiple.' },
      wave: { type: ['string', 'null'], description: 'Corral/wave assignment or how corrals are assigned, e.g. "Corral B" or "Seeded by predicted time".' },
      bib: { type: ['string', 'null'], description: 'Bib number — almost always null (personal, not on the public site).' },
      location: { type: ['string', 'null'], description: 'Start line / venue, e.g. "Balboa Park, San Diego, CA".' },
      parking: { type: ['string', 'null'], description: 'Parking info — where to park, cost, lots, restrictions.' },
      shuttle: { type: ['string', 'null'], description: 'Shuttle / transport to the start, with times if stated.' },
      packetPickup: { type: ['string', 'null'], description: 'Packet/bib pickup — where and when (expo dates/times). Note if no race-day pickup.' },
      officialUrl: { type: ['string', 'null'], description: 'The canonical official race website URL.' },
      notes: { type: ['string', 'null'], description: 'Other important race-day notes: gear check, corral cutoff, course closures, weather norms. Keep to a couple of sentences.' },
      aidStations: { type: ['string', 'null'], description: 'On-course aid: where water/electrolyte stations are (mile markers or spacing like "every ~2 mi") and what is provided (water, sports drink, gels, etc.). One concise line.' },
      summary: { type: ['string', 'null'], description: 'A 2-3 sentence "what to expect": the course\'s character and TERRAIN REALITY (use the provided GPX terrain data, not the website), plus one tactical note that fits the terrain. Coach voice: direct, factual, no hype, no exclamation marks, no emoji, no em dashes.' },
    },
    required: ['startTime', 'wave', 'bib', 'location', 'parking', 'shuttle', 'packetPickup', 'officialUrl', 'notes', 'aidStations', 'summary'],
  },
} as const;

function clean(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  // House style (coach voice): no em dashes; en dashes collapse to a hyphen so
  // ranges like "12-4 PM" still read right. Enforced here so the LLM can't
  // smuggle them in regardless of the prompt.
  let s = v.replace(/\s*—\s*/g, ', ').replace(/–/g, '-').trim();
  if (!s) return null;
  const low = s.toLowerCase();
  return low === 'null' || low === 'unknown' || low === 'n/a' ? null : s;
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const auth = await requireUserId(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth;
  const { slug } = await params;

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return NextResponse.json({ available: false });

  const body = (await req.json().catch(() => ({}))) as { url?: string; name?: string };
  let url: string | null = (body.url ?? '').trim() || null;
  let name: string | null = (body.name ?? '').trim() || null;

  // Load the stored race once · meta backfills name/url, course_geometry feeds
  // the authoritative terrain hint for the "what to expect" blurb.
  const row = (
    await pool
      .query<{ meta: Record<string, unknown> | null; course_geometry: unknown }>(
        `SELECT meta, course_geometry FROM races WHERE slug = $1 AND user_uuid = $2`,
        [slug, userId],
      )
      .catch(() => ({ rows: [] as Array<{ meta: Record<string, unknown> | null; course_geometry: unknown }> }))
  ).rows[0];
  const m = (row?.meta ?? {}) as Record<string, string | undefined>;
  name = name ?? (m.name ?? null);
  url = url ?? (m.officialUrl ?? m.website ?? null);
  if (!name && !url) {
    return NextResponse.json({ available: true, error: 'no_source', proposed: null });
  }
  const distMi = m.distanceMi != null ? Number(m.distanceMi) : null;
  const terrainHint = buildTerrainHint(row?.course_geometry, Number.isFinite(distMi) ? distMi : null);

  const target = url
    ? `the official race website ${url}${name ? ` (race name: "${name}")` : ''}`
    : `the race named "${name}" — find its official website first`;

  const system =
    'You research OFFICIAL race websites for a running app and extract race-day facts. ' +
    'Use web_search to find and read the official source; prefer the official race site over aggregators, registration portals, or news. ' +
    'Extract only facts you can confirm from the source — if a field is not stated, return null. Never guess. ' +
    'Coach voice for any prose: direct and factual, no hype, no exclamation marks, no emoji, no em dashes. ' +
    'Values render in a small mobile card, so keep them short. When done, call the race_logistics tool exactly once.';

  const userMsg =
    `Find the race-day details for ${target}. ` +
    'Return start time, corral/wave, start-line location, parking, shuttle, packet pickup, the official URL, on-course aid/water stations, a short "what to expect" summary, and any concise general notes. ' +
    (terrainHint
      ? `\n\n${terrainHint}\nUse this terrain data for the summary and any elevation claims.`
      : '');

  try {
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 1500,
        system,
        tools: [
          { type: 'web_search_20250305', name: 'web_search', max_uses: 6 },
          EXTRACT_TOOL,
        ],
        messages: [{ role: 'user', content: userMsg }],
      }),
      signal: AbortSignal.timeout(55_000),
    });

    if (!resp.ok) {
      const txt = await resp.text().catch(() => '');
      console.error('[race autofill] anthropic non-ok', resp.status, txt.slice(0, 400));
      return NextResponse.json({ available: true, error: 'llm_error', proposed: null });
    }

    const data = (await resp.json()) as { content?: Array<Record<string, any>> };
    const blocks = data.content ?? [];
    const toolUse = blocks.find((b) => b.type === 'tool_use' && b.name === 'race_logistics');
    if (!toolUse) {
      return NextResponse.json({ available: true, error: 'no_extraction', proposed: null });
    }
    const p = (toolUse.input ?? {}) as Record<string, unknown>;

    // Provenance · the URLs Claude actually read (best-effort, shape-tolerant).
    const sources: string[] = [];
    for (const b of blocks) {
      if (b.type === 'web_search_tool_result' && Array.isArray(b.content)) {
        for (const r of b.content) if (r && typeof r.url === 'string') sources.push(r.url);
      }
    }

    const proposed: AutofillProposal = {
      startTime: clean(p.startTime),
      wave: clean(p.wave),
      bib: clean(p.bib),
      location: clean(p.location),
      parking: clean(p.parking),
      shuttle: clean(p.shuttle),
      packetPickup: clean(p.packetPickup),
      officialUrl: clean(p.officialUrl) ?? url,
      notes: clean(p.notes),
      aidStations: clean(p.aidStations),
      summary: clean(p.summary),
    };

    const anyFound = Object.values(proposed).some((v) => v != null);
    return NextResponse.json({
      available: true,
      proposed: anyFound ? proposed : null,
      error: anyFound ? undefined : 'nothing_found',
      sources: Array.from(new Set(sources)).slice(0, 3),
    });
  } catch (e: unknown) {
    console.error('[race autofill] error', e instanceof Error ? e.message : String(e));
    return NextResponse.json({ available: true, error: 'exception', proposed: null });
  }
}
