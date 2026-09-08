/**
 * WRITEIDEM-1 · TODAYWRITE-2's standing gate.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * WHAT WENT WRONG
 *
 * `POST /api/sick` and `POST /api/niggle` were bare INSERTs, and both
 * clear-paths (`DELETE`, and the `recovered`/`gone` branch of the recovery
 * routes) cleared exactly ONE row, selected `ORDER BY logged_at DESC LIMIT 1`.
 *
 * The phone bounds every authenticated request at 12 seconds
 * (`API.authedSend`, TIMEOUT-1). So a write that REACHES this server, commits,
 * and answers slowly settles on the phone as `V5WriteSettlement.didNotLand` —
 * indistinguishable from a write that never arrived. The row then offered a
 * Retry, and the retry inserted a SECOND active episode. "Recovered" cleared
 * the newer one. The FIRST stayed active forever, `GET /api/sick` kept
 * reporting it, and a runner who had said they were better stayed in forced
 * rest with no affordance anywhere to clear it.
 *
 * Reproduced end to end on a clone of the owner's production rows, with a
 * proxy that forwards the write upstream and then discards the response:
 *
 *     unfixed   active after retry = 2   active after "recovered" = 1
 *     fixed     active after retry = 1   active after "recovered" = 0
 *
 * ─────────────────────────────────────────────────────────────────────────
 * RULE 22 · WHAT THIS GATE CANNOT FAIL ON
 *
 * · It cannot fail on BEHAVIOUR. It reads source text. It proves the guard is
 *   still written down, not that Postgres still honours it — a typo inside
 *   the CTE that made `existing` never match would pass here. The behavioural
 *   proof is the live repro above, and it needs a database and a proxy, so it
 *   is not a CI gate.
 * · It cannot fail on the CLIENT half. Whether the row's copy still refrains
 *   from claiming "nothing was written" is `WriteHonestyTests`
 *   (`testNoFailureCopyAssertsWhatTheServerDid`), on the Swift side.
 * · It cannot see a NEW write route that needs the same guard. It watches the
 *   four routes this incident covered. A fifth episode-style INSERT would be
 *   invisible until someone adds it to `WATCHED`.
 * · It is not atomic-safety. The dedup is a single statement, not a unique
 *   index, so two GENUINELY concurrent identical inserts can still both land.
 *   That case degrades to the old behaviour, never worse, and the phone
 *   blocks a second submit while one is in flight.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * INJURYCHECKIN-1 (2026-09-08) · WHAT THIS GATE MISSED THE FIRST TIME.
 *
 * The paragraph above says this watches four routes, and it did — but only
 * the two REPORT routes were checked for write-dedup. The two RECOVERY
 * routes were checked for "clear-all" behaviour and nothing else, and they
 * were still bare INSERTs. A Product Experience review proved it on device:
 * one answer plus one retry after a lost response wrote two identical trend
 * rows. Exactly the same mechanism, one endpoint over, invisible because the
 * gate's own header read as if it covered all four.
 *
 * So the dedup block below now walks all four, and the refusal block is new:
 * a route that cannot succeed must SAY SO IN WORDS, because the phone keys
 * `V5WriteSettlement.refused` on the sentence rather than on the status code
 * (a bare 404 could come from a proxy). Drop the sentence and the phone
 * silently reverts to "Trying again is safe" over a request that can never
 * work — which is the defect this closes.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

const ROOT = join(__dirname, '..', '..');

const WATCHED = {
  sick: 'app/api/sick/route.ts',
  niggle: 'app/api/niggle/route.ts',
  sickRecovery: 'app/api/sick/recovery/route.ts',
  niggleRecovery: 'app/api/niggle/recovery/route.ts',
} as const;

function read(rel: string): string {
  const p = join(ROOT, rel);
  expect(existsSync(p), `WRITEIDEM-1 watches ${rel}, which no longer exists`).toBe(true);
  return readFileSync(p, 'utf8');
}

/** Strip comments, so a phrase quoted in a doc comment cannot satisfy a check. */
function code(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

describe('WRITEIDEM-1 · a retried report cannot open a second episode', () => {
  // Rule 18 §2 · liveness. A scan that reads nothing reports clean, which is
  // the worst outcome available because it also reports confidence.
  it('reads all four routes it claims to watch', () => {
    const sizes = Object.values(WATCHED).map((f) => code(read(f)).length);
    expect(sizes).toHaveLength(4);
    for (const n of sizes) expect(n).toBeGreaterThan(500);
    // INJURYCHECKIN-1 · and the module the refusal sentences live in. A
    // deleted file would otherwise make the refusal block below silently
    // scan nothing.
    expect(read('lib/health/checkin-refusal.ts').length).toBeGreaterThan(500);
  });

  // INJURYCHECKIN-1 · the two RECOVERY routes, which this gate watched for
  // clear-all behaviour and NOT for duplicate-insert protection. Same
  // 12-second-timeout mechanism, same retry, same duplicate row.
  describe('the recovery trend guard', () => {
    for (const [name, file, table] of [
      ['sick recovery', WATCHED.sickRecovery, 'sick_recovery'],
      ['niggle recovery', WATCHED.niggleRecovery, 'niggle_recovery'],
    ] as const) {
      it(`${name} does not INSERT a trend row unconditionally`, () => {
        const src = code(read(file));
        expect(src, `${file}: the dedup CTE is gone`).toMatch(/WITH existing AS/);
        expect(src, `${file}: the INSERT is no longer conditional`).toMatch(
          /WHERE NOT EXISTS \(SELECT 1 FROM existing\)/,
        );
        // The bare form this incident was.
        expect(
          new RegExp(`INSERT INTO ${table} \\([^)]*\\) VALUES \\(\\$1, \\$2\\)`).test(
            src.replace(/\s+/g, ' '),
          ),
          `${file}: the unguarded "VALUES ($1, $2)" INSERT is back — one answer\n` +
            `plus one retry writes two identical trend rows again.`,
        ).toBe(false);
        // Rule 21 · observable, exactly as the report routes are.
        expect(src, `${file}: a dedup is silent again`).toMatch(/deduplicated/);
      });

      it(`${name} keys the dedup on the RUNNER'S day, not the server's`, () => {
        // Rule 22 · the other direction. A guard keyed on the niggle and the
        // answer ALONE would silently swallow tomorrow's identical answer and
        // flatten the trend history this table exists for. And a UTC date
        // rolls at 17:00 Pacific, splitting one evening across two days.
        const src = code(read(file)).replace(/\s+/g, ' ');
        expect(src, `${file}: the dedup no longer scopes to a single day`).toMatch(
          /\(logged_at AT TIME ZONE \$3\)::date = \(now\(\) AT TIME ZONE \$3\)::date/,
        );
        expect(code(read(file)), `${file}: the day is no longer the runner's own`).toMatch(
          /runnerTimezone/,
        );
        expect(src, `${file}: the answer itself dropped out of the key`).toMatch(/AND response = \$2/);
      });
    }
  });

  // INJURYCHECKIN-1 · "there is nothing here to act on" is an ANSWER.
  describe('the permanent refusal', () => {
    for (const [name, file] of [
      ['sick recovery', WATCHED.sickRecovery],
      ['niggle recovery', WATCHED.niggleRecovery],
    ] as const) {
      it(`${name} answers a 404 with words the phone can print`, () => {
        const src = code(read(file));
        expect(
          src,
          `${file}: the 404 no longer carries a refusal sentence. The phone keys\n` +
            `V5WriteSettlement.refused on the SENTENCE, not the status code, so\n` +
            `without it the row silently goes back to "Trying again is safe" over a\n` +
            `request that structurally cannot succeed.`,
        ).toMatch(/nothingOpenBody\(/);
        // The bare form this incident was.
        expect(
          /\{ error: 'no active (niggle|sick episode)' \}, \{ status: 404 \}/.test(
            src.replace(/\s+/g, ' '),
          ),
          `${file}: the wordless 404 is back`,
        ).toBe(false);
      });
    }

    it('every refusal sentence holds in BOTH worlds the 404 covers', () => {
      // A 404 here means "nothing is open" — which happens when nothing was
      // ever flagged AND when this very runner just cleared it and the
      // answer was lost. A sentence that asserts the first would be a fresh
      // fabrication in the second, which is the class this whole change
      // closes. Read out of the module rather than restated, so the check
      // cannot agree with itself (Rule 18).
      const src = read('lib/health/checkin-refusal.ts');
      const sentences = [...src.matchAll(/'(Nothing is open[^']*)'/g)].map((m) => m[1]);
      expect(sentences.length, 'no refusal sentences found — the scan is dead').toBeGreaterThan(0);
      for (const s of sentences) {
        expect(s, `"${s}" asserts the runner never flagged one`).toMatch(/already cleared/);
        expect(s, `"${s}" invites a retry that cannot work`).not.toMatch(/try again|Trying again/i);
      }
    });
  });

  describe('the POST guard', () => {
    for (const [name, file] of [['sick', WATCHED.sick], ['niggle', WATCHED.niggle]] as const) {
      it(`${name} POST does not INSERT unconditionally`, () => {
        const src = code(read(file));
        // The guard's shape: the INSERT feeds off a SELECT that is suppressed
        // when an identical ACTIVE row already exists.
        expect(src, `${file}: the dedup CTE is gone`).toMatch(/WITH existing AS/);
        expect(src, `${file}: the INSERT is no longer conditional`).toMatch(
          /WHERE NOT EXISTS \(SELECT 1 FROM existing\)/,
        );
        expect(src, `${file}: the guard must only ever match an ACTIVE row`).toMatch(
          /cleared_at IS NULL/,
        );
        // The bare form this incident was: INSERT ... VALUES ... RETURNING id
        expect(
          /INSERT INTO (sick_episodes|niggles)[\s\S]{0,400}?VALUES \(\$1, \$1,/.test(src),
          `${file}: the unguarded "VALUES ($1, $1, …)" INSERT is back`,
        ).toBe(false);
      });

      it(`${name} POST tells the caller when it deduplicated`, () => {
        // Rule 21 · observable. A silent dedup and a silent duplicate look
        // identical from outside, which is what let this survive.
        expect(code(read(file))).toMatch(/deduplicated: true/);
      });
    }
  });

  describe('the clear path', () => {
    const CLEARS: Array<[string, string, RegExp]> = [
      ['sick DELETE', WATCHED.sick, /UPDATE sick_episodes/],
      ['niggle DELETE', WATCHED.niggle, /UPDATE niggles/],
      ['sick recovery', WATCHED.sickRecovery, /UPDATE sick_episodes/],
      ['niggle recovery', WATCHED.niggleRecovery, /UPDATE niggles/],
    ];

    for (const [name, file, table] of CLEARS) {
      it(`${name} clears EVERY active row, not the newest one`, () => {
        const src = code(read(file));
        expect(src, `${file}: the clearing UPDATE is gone`).toMatch(table);

        // THE DEFECT: clearing a single row by the id of a `LIMIT 1` select.
        // Any of these three shapes reintroduces the phantom active episode.
        for (const relic of [
          /SET cleared_at = now\(\)\s*WHERE id = \$1/,
          /SET cleared_at = now\(\)\s*WHERE id = \(/,
        ]) {
          expect(
            relic.test(src.replace(/\s+/g, ' ')),
            `${file}: clears one row by id again — an older active row becomes\n` +
              `"the episode" the moment this one is resolved, and the runner is\n` +
              `put back into forced rest with no way to clear it.`,
          ).toBe(false);
        }

        // And the positive shape: scoped to the runner, every uncleared row.
        expect(
          src.replace(/\s+/g, ' '),
          `${file}: the clear is no longer user-scoped + all-active`,
        ).toMatch(/SET cleared_at = now\(\) WHERE COALESCE\(user_uuid, user_id\) = \$1 AND cleared_at IS NULL/);
      });
    }
  });

  // Rule 22 · the other direction. A guard that refused EVERY second report
  // would pass every check above and would be its own defect: a runner whose
  // symptoms genuinely changed could never file a new one. The behavioural
  // proof is in the live repro (a report with `has_fever` flipped opens a new
  // episode); what is checkable here is that the comparison is on the
  // report's CONTENT, not merely on the runner.
  it('the guard compares the report, not just the runner', () => {
    expect(code(read(WATCHED.sick))).toMatch(/AND started = \$3/);
    expect(code(read(WATCHED.sick))).toMatch(/AND has_fever = \$4::boolean/);
    // Symptoms compared order-insensitively: the phone builds this array from
    // a Set, so two sends of ONE report can differ in element order.
    expect(code(read(WATCHED.sick))).toMatch(/jsonb_agg\(x ORDER BY x\)/);
    expect(code(read(WATCHED.niggle))).toMatch(/AND body_part = \$2/);
    expect(code(read(WATCHED.niggle))).toMatch(/AND severity = \$4::int/);
  });
});
