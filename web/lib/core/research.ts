/**
 * lib/core/research.ts
 *
 * GPX-first strategy:
 *   1. Find official race website
 *   2. Hunt for a downloadable GPX (official site → Strava → AllTrails → Komoot)
 *   3. From official site, read race logistics (aid stations, warnings, course type)
 *
 * If a gpx_url is returned, the server downloads + parses it to get the
 * authoritative distance, coords, and elevation. Research only needs to
 * cover what the GPX can't tell us: aid stations, course type, warnings.
 *
 * Every nullable field is null because Claude could not verify it —
 * not because it doesn't exist. Throws only if distance_mi is
 * unresolvable (plan is impossible without it).
 */

import type { CourseResearch } from './types';

const ANTHROPIC_API = 'https://api.anthropic.com/v1/messages';

// In-process cache — survives across requests on the same server instance.
// Keyed by "race_name_lowercase|YYYY-MM-DD". Cleared on process restart.
const researchCache = new Map<string, CourseResearch>();

const SYSTEM_PROMPT = `
You are a race research assistant for faff.run, a runner's race planning tool.
Use web_search to find race logistics from the official race website.
The runner may have already uploaded their own GPX file — your job is the information
that the GPX can't tell us: aid stations, course warnings, and race logistics.

## Search strategy

**STEP 1 — Find the official race website**
Search "[race name] official site" or "[race name] [year] registration".
Identify the official race domain (e.g. bigsurmarathon.org, lamarathon.com).

**STEP 2 — Read the official website for race logistics**
From the official race website find:
- Aid station mile markers from the CURRENT YEAR's athlete guide / course map PDF
- Course type: point-to-point, loop, or out-and-back
- Start and finish location names
- Start and finish coordinates (from official course map or embedded Google Map)
- Elevation gain/loss from the official course profile (summary stats, not the shape)
- Any course route or finish line changes in the last 3 years

**STEP 3 — Cross-check against the runner's GPX (if provided in the user message)**
If the user message includes GPX data (distance, gain, start coords), compare against
what you found on the official site. Flag any significant discrepancies in research_notes
and course_warnings (e.g. wrong course year, out-and-back vs point-to-point mismatch).

## Hard rules
1. Never invent a fact. Null means "could not verify from a citable source."
2. primary_source_url must be the official race domain — not a blog, not a race aggregator.
3. aid_station_miles only from the official race website or official course map PDF.
4. Return ONLY valid JSON — no markdown fences, no commentary before or after.

## Output schema

{
  "race_name": string,
  "slug": string (kebab-case),
  "distance_mi": number (required — best known value; 26.2188 for marathon, 13.1094 for half),
  "distance_m": number,
  "course_type": "point_to_point" | "loop" | "out_and_back",
  "total_gain_ft": number | null,   // always set both gain AND loss together, or null both
  "total_loss_ft": number | null,   // never set one without the other
  "net_elevation_ft": number | null,
  "start_coords": {"lat": number, "lon": number} | null,
  "finish_coords": {"lat": number, "lon": number} | null,
  "start_location_name": string | null,
  "finish_location_name": string | null,
  "aid_station_miles": [number, ...] | null,
  "gpx_url": string | null,
  "typical_date": string | null,
  "course_warnings": [string, ...],
  "source_urls": [string, ...],
  "primary_source_url": string | null,
  "flagged_fields": [string, ...],
  "research_notes": string
}

flagged_fields: list each null field that you couldn't verify.
research_notes: describe your GPX search effort — what you tried, what you found, what failed.
`.trim();

export interface GpxContext {
  distanceMi: number;
  gainFt: number;
  lossFt: number;
  startLat: number;
  startLon: number;
  finishLat: number;
  finishLon: number;
}

export async function researchCourse(
  raceName: string,
  raceDate: string,
  gpxContext?: GpxContext,
): Promise<CourseResearch> {
  const cacheKey = `${raceName.trim().toLowerCase()}|${raceDate}`;
  const cached = researchCache.get(cacheKey);
  if (cached) {
    console.log('[Research] Cache hit:', raceName);
    return cached;
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not set');

  const gpxSection = gpxContext
    ? `
The runner has already uploaded their GPX file for this race. Here is what the GPX shows:
- Distance: ${gpxContext.distanceMi.toFixed(2)} miles
- Elevation gain: ${Math.round(gpxContext.gainFt)} ft / loss: ${Math.round(gpxContext.lossFt)} ft
- Start coordinates: ${gpxContext.startLat.toFixed(5)}, ${gpxContext.startLon.toFixed(5)}
- Finish coordinates: ${gpxContext.finishLat.toFixed(5)}, ${gpxContext.finishLon.toFixed(5)}

Cross-check this against the official race data. Flag any significant discrepancies
(e.g. distance off by more than 0.5mi, coordinates far from the expected start/finish).
`
    : `
The runner has not uploaded a GPX file. Find distance, start/finish coordinates, and
elevation gain/loss from the official race website or course profile.
`;

  const userMessage = `Research the "${raceName}" taking place on ${raceDate}.
${gpxSection}
Find from the official race website:
1. Aid station mile markers (from the current year's athlete guide or course map)
2. Course type (point-to-point, loop, out-and-back)
3. Start and finish location names
4. Course warnings — road closures, cutoffs, weather, camber, notable climbs
5. Any course route or finish line changes in the last 3 years

Pay particular attention to: has the finish line or course route changed recently?

Return the JSON object only.`;

  const response = await fetch(ANTHROPIC_API, {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-beta': 'web-search-2025-03-05',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: 'claude-opus-4-5',
      max_tokens: 4096,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userMessage }],
      tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 6 }],
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Anthropic API ${response.status}: ${err.slice(0, 200)}`);
  }

  const data = await response.json();

  // Extract text from all content blocks
  let raw = '';
  for (const block of (data.content ?? [])) {
    if (block.type === 'text') raw += block.text;
  }

  // Strip markdown fences if present
  const jsonMatch = raw.match(/```json\s*([\s\S]*?)```/) ?? raw.match(/(\{[\s\S]*\})/);
  const jsonText = jsonMatch ? jsonMatch[1].trim() : raw.trim();

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(jsonText);
  } catch (e) {
    throw new Error(
      `Research returned invalid JSON.\nFirst 500 chars: ${jsonText.slice(0, 500)}\nParse error: ${e}`
    );
  }

  // distance_mi is required (best estimate, may be overridden by GPX later)
  const distance_mi = typeof parsed.distance_mi === 'number' ? parsed.distance_mi : null;
  if (!distance_mi || distance_mi < 1) {
    throw new Error(
      `Research could not determine race distance. research_notes: ${parsed.research_notes ?? 'none'}`
    );
  }

  // Coerce everything else — missing = null
  const research: CourseResearch = {
    race_name: String(parsed.race_name ?? raceName),
    slug: String(parsed.slug ?? raceName.toLowerCase().replace(/[^a-z0-9]+/g, '-')),
    distance_mi,
    distance_m: typeof parsed.distance_m === 'number' ? parsed.distance_m : Math.round(distance_mi * 1609.344),
    course_type: ['point_to_point', 'loop', 'out_and_back'].includes(parsed.course_type as string)
      ? (parsed.course_type as CourseResearch['course_type'])
      : 'point_to_point',
    // Pair guard: if only one of gain/loss is provided, null both to avoid inconsistency
    total_gain_ft: (typeof parsed.total_gain_ft === 'number' && typeof parsed.total_loss_ft === 'number') ? parsed.total_gain_ft : null,
    total_loss_ft: (typeof parsed.total_gain_ft === 'number' && typeof parsed.total_loss_ft === 'number') ? parsed.total_loss_ft : null,
    net_elevation_ft: typeof parsed.net_elevation_ft === 'number' ? parsed.net_elevation_ft : null,
    start_coords: isCoords(parsed.start_coords) ? parsed.start_coords as { lat: number; lon: number } : null,
    finish_coords: isCoords(parsed.finish_coords) ? parsed.finish_coords as { lat: number; lon: number } : null,
    start_location_name: typeof parsed.start_location_name === 'string' ? parsed.start_location_name : null,
    finish_location_name: typeof parsed.finish_location_name === 'string' ? parsed.finish_location_name : null,
    aid_station_miles: Array.isArray(parsed.aid_station_miles)
      ? (parsed.aid_station_miles as unknown[]).filter(x => typeof x === 'number').map(Number)
      : null,
    gpx_url: typeof parsed.gpx_url === 'string' ? parsed.gpx_url : null,
    typical_date: typeof parsed.typical_date === 'string' ? parsed.typical_date : null,
    course_warnings: Array.isArray(parsed.course_warnings)
      ? (parsed.course_warnings as unknown[]).map(String)
      : [],
    source_urls: Array.isArray(parsed.source_urls)
      ? (parsed.source_urls as unknown[]).map(String)
      : [],
    primary_source_url: typeof parsed.primary_source_url === 'string' ? parsed.primary_source_url : null,
    flagged_fields: Array.isArray(parsed.flagged_fields)
      ? (parsed.flagged_fields as unknown[]).map(String)
      : [],
    research_notes: typeof parsed.research_notes === 'string' ? parsed.research_notes : '',
  };

  researchCache.set(cacheKey, research);
  return research;
}

function isCoords(v: unknown): boolean {
  if (!v || typeof v !== 'object') return false;
  const obj = v as Record<string, unknown>;
  return typeof obj.lat === 'number' && typeof obj.lon === 'number';
}
