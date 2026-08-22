/**
 * lib/faff/_refusal_wire.test.ts · RULE THREE, end to end.
 *
 *   "A refusal is a correct answer, not an empty state, and must not look
 *    like the data-outage screen."
 *
 * ── the production shape this pins ──────────────────────────────────────
 *
 * A route returned `{ error: 'no_pace_change' }` with a 404. The phone reads
 * `reason`. So a decline the engine had understood perfectly well arrived at
 * the screen as a failed read and drew the outage note — "we just cannot see
 * it" — over a Retry button that could only ever decline again. The bug was
 * not in either half. It was in the seam, and neither half's own tests could
 * see it, because each was correct on its own terms.
 *
 * That is why this file asserts on BOTH sides of the wire in one place: the
 * server's shape, and the client's read of it. Three of the four defects
 * found in the 2026-08-21 copy audit lived in exactly that gap:
 *
 *   · `AddRaceV5.save()` threw away the `refusal` the transport had gone to
 *     the trouble of preserving, so every decline drew the outage ErrorNote.
 *   · `API.v5` (GET) read `reason` only, while `v5Write` read `refusal ??
 *     reason` — one key away from a clinician-gated GET wearing the outage.
 *   · `/api/runs/[id]`, `/api/race` and `/api/race/result` answered with bare
 *     machine text (`{ error: 'run not found' }`) and no sentence at all.
 *
 * ── how it checks ───────────────────────────────────────────────────────
 *
 * Source scans, same precedent as `_surface_contracts.test.ts` (which greps
 * the two view files) and `lib/doctrine/_doctrine_lint.test.ts` (which scans
 * for recurring defect shapes). Vitest here runs in `node` with no DOM and no
 * Swift toolchain, so a rendered assertion is not available. The shapes are
 * distinctive enough that a grep is a real gate — and the point of this file
 * is the SEAM, which is a property of two source texts agreeing.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

const WEB = path.join(__dirname, '..', '..');
const NATIVE = path.join(WEB, '..', 'native-v2', 'Faff', 'Faff');

const read = (p: string) => readFileSync(p, 'utf8');

/** Strip comments so a note ABOUT the bug cannot satisfy — or trip — a grep
 *  looking FOR the bug. Same guard `_surface_contracts.test.ts` uses. */
function codeOnly(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^[ \t]*\/\/.*$/gm, '');
}

// ── 1 · every decline carries a sentence ─────────────────────────────────

/** Routes the PHONE reads. A 4xx from any of these is decoded by
 *  `API.V5Fetch` / `API.V5Write` / `API.createRace`, all of which need a
 *  non-empty `reason` (or `refusal`) or they fall through to `.failed`. */
function phoneFacingRoutes(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    if (!existsSync(dir)) return;
    for (const entry of readdirSync(dir)) {
      if (entry.startsWith('._')) continue;
      const full = path.join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (entry === 'route.ts') out.push(full);
    }
  };
  walk(path.join(WEB, 'app', 'api', 'v5'));
  for (const rel of [
    ['app', 'api', 'race', 'route.ts'],
    ['app', 'api', 'race', 'result', 'route.ts'],
    ['app', 'api', 'runs', '[id]', 'route.ts'],
  ]) {
    const full = path.join(WEB, ...rel);
    if (existsSync(full)) out.push(full);
  }
  return out.sort();
}

/** The codes that mean THE ENGINE DECIDED. 401/403 are authentication and
 *  have their own handling; 5xx is an outage by definition and `API.v5`
 *  correctly maps it to `.failed`. */
const DECIDED = /status:\s*(400|404|409|422)\b/;

describe('rule three · a 4xx the phone reads carries the engine sentence', () => {
  const routes = phoneFacingRoutes();

  it('finds the routes at all', () => {
    // The trap this guards: a scan that extracts nothing and reports clean.
    expect(routes.length).toBeGreaterThanOrEqual(8);
  });

  it('every decline body has a non-empty reason or refusal', () => {
    const missing: string[] = [];
    for (const file of routes) {
      const src = codeOnly(read(file));
      // Each `NextResponse.json(` opens a body; the status that follows it,
      // before the next one opens, belongs to it.
      const chunks = src.split('NextResponse.json(');
      for (const chunk of chunks.slice(1)) {
        const m = DECIDED.exec(chunk);
        if (!m) continue;
        const body = chunk.slice(0, m.index);
        if (!/\b(reason|refusal)\s*:/.test(body)) {
          missing.push(`${path.relative(WEB, file)} · ${m[1]} · ${body.trim().slice(0, 80)}`);
        }
      }
    }
    expect(missing, `a 4xx with no sentence renders as the data-outage screen:\n${missing.join('\n')}`)
      .toEqual([]);
  });

  it('those sentences read as sentences, not as machine text', () => {
    // `{ error: 'race not found' }` was the whole bug class on three routes:
    // lowercase, no full stop, a phrase written for a log. If a reason is
    // going to be printed at a runner it has to be something a person said.
    const bad: string[] = [];
    for (const file of routes) {
      const src = codeOnly(read(file));
      // Scoped to REFUSAL bodies only. `reason` is also an ordinary payload
      // field elsewhere in these routes (`ctx.weekOff.reason` is a label,
      // not a decline), and a scan that graded those would be measuring the
      // wrong thing while looking productive.
      for (const chunk of src.split('NextResponse.json(').slice(1)) {
        const m = DECIDED.exec(chunk);
        if (!m) continue;
        const body = chunk.slice(0, m.index);
        for (const r of body.matchAll(/\b(?:reason|refusal)\s*:\s*(['"`])((?:\\.|(?!\1).)*)\1/g)) {
          const text = r[2];
          if (!text) continue;
          // A template that opens with an interpolation is composed elsewhere.
          if (text.startsWith('${')) continue;
          const startsUpper = /^[A-Z]/.test(text);
          const endsSentence = /[.?]$/.test(text);
          if (!startsUpper || !endsSentence) {
            bad.push(`${path.relative(WEB, file)} · ${JSON.stringify(text).slice(0, 90)}`);
          }
        }
      }
    }
    expect(bad, `a reason is printed at a runner, so it is copy:\n${bad.join('\n')}`).toEqual([]);
  });
});

// ── 2 · the phone reads what the server writes ───────────────────────────

describe('rule three · the client half of the seam', () => {
  const apiV5 = codeOnly(read(path.join(NATIVE, 'DesignV5', 'APIV5.swift')));
  const api = codeOnly(read(path.join(NATIVE, 'API.swift')));

  it('the GET decoder reads refusal AND reason, same as the write decoder', () => {
    // These drifted: `v5Write` learned `refusal ?? reason` when the clinician
    // gate landed and `v5` was never brought along, so a GET that declined
    // with `refusal` fell through to `.failed` and wore the outage.
    expect(apiV5).toMatch(/body\.refusal\s*\?\?\s*body\.reason/);
    expect(apiV5).toMatch(/r\.refusal\s*\?\?\s*r\.reason/);
  });

  it('createRace never prints the route`s machine `error` at a runner', () => {
    // The fallback used to be `reason ?? error`, which put "race slug
    // unavailable" and "name + date required" on screen. `error` is the
    // code; only `reason` is printable. Every route it reaches carries one.
    const block = api.slice(api.indexOf('static func createRace'), api.indexOf('static func createRace') + 2000);
    expect(block).toMatch(/json\?\["reason"\] as\? String/);
    expect(block).not.toMatch(/\?\?\s*\(json\?\["error"\] as\? String\)/);
  });
});

// ── 3 · the three states stay three ──────────────────────────────────────

describe('rule three · refusal, outage and cold start are not one nil', () => {
  const hosts = codeOnly(read(path.join(NATIVE, 'ViewsV5', 'HostsV5.swift')));
  const addRace = codeOnly(read(path.join(NATIVE, 'ViewsV5', 'AddRaceV5.swift')));
  const todayLive = codeOnly(read(path.join(NATIVE, 'ViewsV5', 'TodayBeforeLiveV5.swift')));
  const todayBefore = codeOnly(read(path.join(NATIVE, 'ViewsV5', 'TodayBeforeV5.swift')));

  it('run detail draws Silence for a refusal and the outage note for an outage', () => {
    // Both used to be a `Skeleton` that never resolved — the COLD-START
    // treatment, which claims we are still looking.
    const block = hosts.slice(hosts.indexOf('struct RunDetailHostV5'));
    expect(block).toMatch(/case \.absent\(let reason\)\?:/);
    expect(block).toMatch(/Silence\(reason: absentReason\)/);
    expect(block).toMatch(/OutageBodyV5\(copy: \.runDetail/);
  });

  it('the run log offers a retry instead of an endless skeleton', () => {
    const block = hosts.slice(hosts.indexOf('struct RunLogHostV5'), hosts.indexOf('struct RunDetailHostV5'));
    expect(block).toMatch(/OutageBodyV5\(copy: \.runLog/);
  });

  it('adding a race shows a refusal as an Alert, never the outage note', () => {
    // `ErrorNote` carries a Retry. A refusal retried is a refusal repeated.
    expect(addRace).toMatch(/if let saveRefusal \{[\s\S]{0,120}Alert\(text: saveRefusal/);
    expect(addRace).toMatch(/created\?\.refusal/);
  });

  it('a prefetch that failed does not claim the runner has nothing', () => {
    // The mirror of the headline bug and the quieter half: an OUTAGE wearing
    // the refusal's clothes. "Nothing to show yet." asserts we looked.
    expect(todayLive).toMatch(/pillarsUnread\s*=\s*p == nil/);
    expect(todayLive).toMatch(/shoesUnread\s*=\s*s == nil/);
    expect(todayBefore).toMatch(/readinessPillarsUnread/);
    expect(todayBefore).toMatch(/beforeYouGoUnread\(row\)/);
    expect(todayBefore).not.toMatch(/"Nothing to show yet\."/);
  });
});
