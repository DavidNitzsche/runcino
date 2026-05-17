# Race Data Verification — Rebuild Prompt

Stop. Don't write any code yet.

Everything we've built for race data has failed. Course routes are wrong, aid stations are hallucinated, elevation is off, landmarks don't exist or are in the wrong place. I'm done patching it. I need it rebuilt, and I need it accurate.

This is a personal-use running web app. Accuracy beats coverage. I would rather have five races with perfect data than fifty with garbage.

You will work in four phases. Do not skip ahead. Do not start coding until I approve the plan in Phase 3.

---

## Phase 1 — Audit and rip out

Read the current race data implementation end to end. Every file that touches:

- Course routes / GPX / polylines
- Aid stations
- Elevation profiles
- Landmarks and callouts
- Course metadata (distance, start/finish, certification)

For each one, write up:
- What it does
- Where its data comes from
- Why it's producing wrong output

Don't fix anything. Don't refactor. The goal is a clear-eyed inventory of what gets deleted.

Output: a written audit. No code changes yet.

---

## Phase 2 — Research, deeply

You're going to do real research, not pattern-match. The reason previous attempts failed is that the team (you, prior sessions) reached for the easy answer. There is no single API for race data. Stop looking for one.

Investigate every source below. For each, write up:
- How it's accessed (API, scrape, manual download, PDF parse)
- What it actually contains vs. what it claims to contain
- How reliable it is
- How it fails
- What it costs (rate limits, paid tiers, ToS issues)

### Sources to investigate

**Official race sources**
- Race websites — course maps (PDF, image, embedded), GPX downloads, athlete guides, course descriptions
- Athlete guide PDFs specifically — this is where aid stations actually live
- Race social media for last-minute course changes

**Course certification bodies**
- USATF certified course database (https://www.usatf.org/products-and-services/course-certification)
- AIMS certified courses
- World Athletics certified courses
- What data is actually exposed and is it machine-readable

**GPX / route file sources**
- Strava routes API and segment API — what's available, auth requirements, rate limits
- Garmin Connect course sharing
- AllTrails, Komoot, RunGo, Plotaroute, GPSies (defunct?), MapMyRun
- Race-published GPX files (often on event pages)

**Registration platforms**
- Athlinks, RunSignup, RaceRoster, UltraSignup — what course data their event pages expose, scrape feasibility

**Elevation**
- Open-Topo-Data (free, multiple DEM datasets)
- Mapbox Terrain-RGB tiles
- Google Elevation API (paid, accurate)
- USGS 3DEP for US races
- SRTM data
- Compare: GPS-recorded elevation from a Strava activity vs. DEM resample of the same coordinates. Quantify the difference.

**Landmarks and infrastructure**
- OpenStreetMap via Overpass API — water fountains, restrooms, named landmarks, parks, intersections
- Mapbox Places, Google Places — for named POIs along the route
- Buffering strategy: how wide a corridor around the route line do you query

**PDF extraction for aid stations**
- pdf-parse, pdfjs-dist, pdfplumber-equivalents in JS, or shell out to Python
- LLM extraction with a strict JSON schema
- Image-based athlete guides — OCR (Tesseract, cloud OCR) + LLM extraction
- How to handle conflicts between guide PDF and course map

**Big-race canonical sources**
- For CIM, Big Sur, LA Marathon, NYC, Boston, Chicago, London, Berlin, Tokyo — what is the actual canonical source? Sometimes it's the race itself, sometimes it's a third party that's more reliable.

For each source, give me: confidence rating, failure modes, integration cost.

---

## Phase 3 — Plan

Before any code, write a plan that covers all of the following. I will read this and push back. Do not start building until I've approved it.

1. **Data model.** Exact schema for a "verified race." Every field, types, optionality, units, provenance metadata. Show the JSON shape.

2. **Source hierarchy.** Per field, the order of sources you'll consult and the rule for picking among them. Example: `elevation_profile` → DEM resample of canonical GPX (primary) → published race profile (validation) → Strava community route DEM resample (fallback). Be explicit about every field.

3. **Verification strategy.** When two sources disagree, what happens. Which conflicts block publication, which get logged, which get auto-resolved.

4. **Aid station extraction approach.** Be specific. PDF source → parser → LLM extraction prompt → schema → human review queue. Show the schema. Show the prompt skeleton.

5. **Elevation approach.** Which DEM, which API, smoothing strategy, how you handle gaps, how you validate against published total gain.

6. **Landmark approach.** Overpass query template, route corridor width, filtering rules (which OSM tags count as a landmark worth surfacing), naming and deduplication.

7. **Manual override / lock mechanism.** How I mark a race as personally verified. How locked data survives re-imports. How I edit a single field without re-verifying the whole race. Where the override lives in the data model.

8. **Validation test suite.** Run before any race is marked `verified: true`. At minimum:
   - Course distance within ±0.1 mi of advertised
   - Aid station count and spacing within plausible bounds (e.g., 1–3 mi apart for road races, longer for trail/ultras)
   - Total elevation gain within ±10% of published value
   - Start/finish coordinates within X meters of advertised location
   - All landmarks within Y meters of the route line
   - No duplicate aid stations
   - GPX has no obvious teleport jumps

9. **Provenance and observability.** Every data point carries `source`, `fetched_at`, `confidence`, `method`. There's a debug view that shows me where every value came from for a given race. Logs surface every fallback and every conflict.

10. **Dependencies.** Exact list of libraries you'll add, why each, what they replace. Prefer well-maintained, prefer small surface area.

11. **What you're deleting.** List every file or function from Phase 1 that gets removed.

12. **Out of scope.** Things you considered and explicitly chose not to do, with reasoning.

Output: a planning document. Wait for my approval.

---

## Phase 4 — Build

Only after I approve Phase 3.

- Build it cleanly. Modular. Each source is its own adapter with a common interface.
- Tests on the verification logic. Real tests, not assertion theater.
- Logging that lets me trace any data point back to its source.
- A debug/admin view showing the provenance and validation status of every race.
- Seed it with two races I'll specify, end to end, and show me the verified output.

---

## Hard rules

- **Accuracy is non-negotiable.** If a field can't be backed by at least one authoritative source, it is marked unverified and hidden from the user-facing UI until I confirm it.
- **No fabrication.** No inferred aid stations. No interpolated landmarks. No trusting GPS-recorded elevation. No "this is probably close enough."
- **Show your work.** Every claim in your audit, research, and plan cites the source. When you tell me something works a certain way, link the docs.
- **No silent fallbacks.** If a primary source fails and you fall back, log it loudly. I want to see it.
- **Per-race human-in-the-loop is fine.** This is a personal app. If a race needs me to upload a PDF or paste a GPX URL once, that's acceptable. The point is the *output* is right, not that the *input* is fully automatic.

---

## Start with Phase 1

Do not jump to Phase 4. Do not start "exploring solutions" by writing code. Read the existing code, write the audit, and stop. We'll go from there.
