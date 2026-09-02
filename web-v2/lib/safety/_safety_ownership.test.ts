/**
 * lib/safety/_safety_ownership.test.ts · ONE OWNER FOR "IS TRAINING SAFE?"
 *
 * BRAIN_CONSTITUTION §29 row 5. The 2026-09-02 brain scorecard graded that row
 * FAIL: "No module owns the NORMAL/CAUTION/MODIFY/STOP verdict; four surfaces
 * author it independently." This gate is what makes a FIFTH impossible to add
 * quietly, and what keeps the four that were closed from growing back.
 *
 * ── WHAT A "SECOND AUTHOR" LOOKS LIKE, AND WHY THIS IS THE RIGHT SCAN ───────
 *
 * You cannot author a safety verdict without reading one of three tables:
 * `runner_injuries`, `sick_episodes`, `niggles`. Every one of the four authors
 * the scorecard named did exactly that, and the watch's own comment says so in
 * as many words ("Read here rather than through loadGlanceState"). So the scan
 * is: every READ of those three relations outside `lib/safety/**` is
 * enumerated below with an argued reason.
 *
 * The allowlist is a RATCHET (Rule 18 §4). It may shrink, never grow, and an
 * entry whose site is now clean FAILS until it is deleted. Most entries are
 * legitimate — the runner's own CRUD over their health log, a notification
 * lifecycle read, an evidence-admissibility question — and each says which.
 * Exactly ONE is marked OPEN, and it is the watch.
 *
 * ── RULE 22 · WHAT THIS GATE CANNOT FAIL ON ────────────────────────────────
 *
 *   · It cannot see a read that does not spell the table name in a `FROM`
 *     clause on one line: a view, a CTE that aliases it earlier in the string,
 *     a table name built by concatenation, or a query assembled across lines
 *     so that `FROM` and the relation sit on different ones. It found the
 *     four known authors and every reader a hand grep found, and that is the
 *     bound of the claim.
 *   · It cannot tell a CORRECT consumer from an incorrect one. Every
 *     allowlisted site could start emitting a wrong verdict tomorrow and this
 *     stays green; only the LOCATION is pinned.
 *   · It cannot see Swift. `native-v2` renders the verdict on both devices and
 *     nothing here reads it. If the wrist ever re-derives safety in Swift,
 *     this gate is blind to it by construction.
 *   · It says nothing about REACHABILITY. A consumer could stop calling
 *     `resolveSafety` and keep its allowlist entry; the behavioural suite in
 *     `_safety_verdict.test.ts` covers the resolver, not its callers.
 *   · It cannot see a surface that authors a verdict from a signal that is not
 *     one of these three tables — a future symptom check-in, say. A new health
 *     signal has to be added to the owner AND to this scan.
 *
 * ── FALSIFICATION (Rule 18 §1) ──────────────────────────────────────────────
 *
 * Both directions were run before this file was trusted; the output is in the
 * commit message. A new unlisted read fails "every read is on the allowlist";
 * deleting a live read without deleting its row fails "every allowlist entry
 * still names a live site".
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

const ROOT = join(__dirname, '..', '..');

/** The three relations that carry a health signal. */
type SafetyTable = 'runner_injuries' | 'sick_episodes' | 'niggles';

/**
 * Why a site outside `lib/safety/**` reads a health table.
 *
 *   CRUD          — the runner's own log: create, list, clear, delete. Reads
 *                   and writes rows; authors no verdict about training.
 *   LIFECYCLE     — "does this row still stand", for a notification or an ack.
 *   OTHER_QUESTION— a genuinely different question (was this race run while
 *                   ill? is this runner returning from injury?). Constitution
 *                   §5 puts these outside Safety on purpose.
 *   CONSUMER      — asks the safety question but for a different DECISION
 *                   (should the plan change), and re-derives the signal rather
 *                   than consuming the owner. A residual, argued per entry.
 *   OPEN          — a second author of the runner-facing verdict. Must be zero
 *                   or one, and the one is named.
 */
type Posture = 'CRUD' | 'LIFECYCLE' | 'OTHER_QUESTION' | 'CONSUMER' | 'OPEN';

const ALLOWLIST: ReadonlyArray<{
  file: string; table: SafetyTable; hits: number; posture: Posture; reason: string;
}> = [
  /* ── the runner's own health log · CRUD ─────────────────────────────── */
  {
    file: 'app/api/injuries/route.ts', table: 'runner_injuries', hits: 1, posture: 'CRUD',
    reason: 'GET lists the runner\'s own injuries, POST logs one. The write '
      + 'side of the signal the owner reads. Authors no verdict.',
  },
  {
    file: 'app/api/injuries/[id]/route.ts', table: 'runner_injuries', hits: 2, posture: 'CRUD',
    reason: 'Fetch / update / delete one injury row. Two hits: the SELECT and '
      + 'the DELETE. Authors no verdict.',
  },
  {
    file: 'app/api/niggle/route.ts', table: 'niggles', hits: 2, posture: 'CRUD',
    reason: 'Log a niggle and clear the previous one. Authors no verdict.',
  },
  {
    file: 'app/api/niggle/history/route.ts', table: 'niggles', hits: 2, posture: 'CRUD',
    reason: 'The runner reading back their own niggle history. Authors no verdict.',
  },
  {
    file: 'app/api/niggle/recovery/route.ts', table: 'niggles', hits: 1, posture: 'CRUD',
    reason: 'Clears an active niggle on the runner\'s own say-so. Authors no verdict.',
  },
  {
    file: 'app/api/sick/route.ts', table: 'sick_episodes', hits: 2, posture: 'CRUD',
    reason: 'Log an illness and clear the previous one. Authors no verdict.',
  },
  {
    file: 'app/api/sick/recovery/route.ts', table: 'sick_episodes', hits: 1, posture: 'CRUD',
    reason: 'The daily better/same/worse/recovered trend write. Authors no verdict.',
  },

  /* ── notification lifecycle ─────────────────────────────────────────── */
  {
    file: 'app/api/cron/notifications/route.ts', table: 'niggles', hits: 1, posture: 'LIFECYCLE',
    reason: 'Enqueues the day-after check-in for a niggle that is still open. '
      + 'Asks whether a ROW stands, not whether training may proceed.',
  },
  {
    file: 'app/api/cron/notifications/route.ts', table: 'sick_episodes', hits: 1, posture: 'LIFECYCLE',
    reason: 'Same as the niggle row above, for an illness episode. Asks whether the row still stands so a check-in can be enqueued; authors no verdict about whether training may proceed.',
  },
  {
    file: 'app/api/notifications/ack/route.ts', table: 'sick_episodes', hits: 1, posture: 'LIFECYCLE',
    reason: 'Resolves the episode a lock-screen acknowledgement refers to.',
  },
  {
    file: 'app/api/notifications/ack/route.ts', table: 'niggles', hits: 1, posture: 'LIFECYCLE',
    reason: 'Same as the illness row above, for a niggle. Resolves the row a lock-screen acknowledgement refers to; authors no verdict about whether training may proceed.',
  },

  /* ── a genuinely different question ─────────────────────────────────── */
  {
    file: 'lib/race/representativeness-inputs.ts', table: 'sick_episodes', hits: 1, posture: 'OTHER_QUESTION',
    reason: 'WAS THIS RACE RUN WHILE ILL — evidence admissibility, historical, '
      + 'per-race. Safety answers "may training proceed TODAY"; this answers '
      + '"how much should this past result count". Different owner by §5.',
  },
  {
    file: 'lib/race/representativeness-inputs.ts', table: 'niggles', hits: 1, posture: 'OTHER_QUESTION',
    reason: 'Same as the illness row above, for a niggle logged around a past race. Evidence admissibility for one historical result, not a verdict about training today.',
  },
  {
    file: 'app/api/v5/races/route.ts', table: 'runner_injuries', hits: 1, posture: 'OTHER_QUESTION',
    reason: '`detectReturningFromInjury` — includes injuries RESOLVED within '
      + '30 days, which the today-verdict deliberately does not. It grades the '
      + 'race schedule, not the day. Already Rule 11 clean (returns null on a '
      + 'failed read rather than minting "no injury").',
  },
  {
    file: 'lib/coach/easy-discipline.ts', table: 'sick_episodes', hits: 1, posture: 'OTHER_QUESTION',
    reason: 'Builds the illness windows an easy-pace finding must be filtered '
      + 'THROUGH — the per-finding context filter locked 2026-05-19 round 4. '
      + 'Historical windows, not a verdict about today.',
  },
  {
    file: 'lib/coach/convergence-loader.ts', table: 'sick_episodes', hits: 1, posture: 'OTHER_QUESTION',
    reason: 'Illness as one input to the readiness convergence state '
      + '(Constitution §2.D). Readiness and Safety are separate concepts and '
      + 'the Constitution keeps them separate; this is the readiness side.',
  },

  /* ── consumers that re-derive rather than consume · RESIDUAL ─────────── */
  /*
   * CLOSED 2026-09-02 (RUNNER-OWNS-READINESS) · three `lib/plan/adapt.ts` rows
   * stood here — `niggles`, `sick_episodes` and `runner_injuries`, each one a
   * CONSUMER that re-derived the safety signal instead of consuming
   * `resolveSafety`, each argued as "outside the closing agent's file
   * boundary". They are not migrated; they are GONE. The owner ruled that
   * readiness, illness, injury and a reported niggle stop influencing training
   * decisions, so `detectNiggleReported`, `detectSickEpisodeActive` and
   * `detectInjuryActive` are deleted along with their triggers and their
   * `actionsForTrigger` limbs. `lib/plan/adapt.ts` reads none of the three
   * health tables any more, which is why these rows had to go: this allowlist
   * is a ratchet and a row whose site is clean fails until it is deleted.
   */
  {
    file: 'lib/plan/injury-builder.ts', table: 'runner_injuries', hits: 1, posture: 'CONSUMER',
    reason: 'The return-to-run ladder needs the injury ROW (site, severity, '
      + 'expected return), not the verdict. REWORDED 2026-09-02: this used to '
      + 'say it "runs only on an ACCEPTED `injury_adjust` proposal", and the '
      + 'adapter can no longer produce that proposal at all — `detectInjuryActive` '
      + 'and its `actionsForTrigger` limb are deleted, so nothing writes an '
      + '`injury_adjust` row and the 184 historical ones (0 accepted) are the '
      + 'last there will be. The builder is RETAINED because it is not that '
      + 'arm: it is the walk-run plan mode the runner CHOOSES, entered from '
      + 'the runner\'s own selection rather than from the engine deciding he is '
      + 'hurt, which is exactly the distinction the owner\'s ruling draws. It '
      + 'still needs the injury row to size the ladder.',
  },
  {
    file: 'lib/plan/return-checkin-store.ts', table: 'runner_injuries', hits: 1, posture: 'CONSUMER',
    reason: 'Stores the better/same/worse check-in against the injury row. '
      + 'Needs the row id, not the verdict.',
  },

  /* ── THE LAST SECOND AUTHOR · CLOSED 2026-09-02 (SAFETYSTOP-1) ────────
   *
   * `lib/watch/build-workout.ts` held two OPEN rows here, and their own text
   * said they were "the row that should be DELETED when the watch delegates".
   * The watch delegates. `loadNoSessionReason`'s `runner_injuries` and
   * `sick_episodes` point reads are gone; it takes a `SafetyResolution` and
   * translates it into the No-session board's vocabulary only. The runnable
   * workout is gated on the owner's own `mayEmitRunnableWorkout` and
   * `mayEmitQualityWorkout` rather than on a posture the wrist re-read.
   *
   * Deleted rather than flipped to CONSUMER because the file no longer
   * touches either table at all, and the staleness check below fails on a row
   * naming a read that does not exist. `lib/watch/_safety_stop.test.ts` is
   * what now asserts the wrist cannot ship a session Safety refused. */
];

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    // `startsWith('.')` also drops the `._foo.ts` AppleDouble sidecars this
    // exFAT volume writes beside every file. Without it the local file count
    // is double what CI sees and any liveness floor tuned locally fails on CI.
    if (name === 'node_modules' || name === '.next' || name.startsWith('.')) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) sourceFiles(p, out);
    else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}

const TABLE_READ = /\bFROM\s+(runner_injuries|sick_episodes|niggles)\b/gi;

describe('Safety ownership · one author for NORMAL/CAUTION/MODIFY/STOP', () => {
  const files = [
    ...sourceFiles(join(ROOT, 'lib')),
    ...sourceFiles(join(ROOT, 'app')),
  ];

  it('LIVENESS · the scanner actually read source (Rule 18 §2)', () => {
    expect(files.length).toBeGreaterThan(400);
    // and it can see the owner, so a rename of `lib/safety` cannot make this
    // gate report clean by scanning a tree with nothing in it.
    expect(files.some((f) => f.endsWith(join('lib', 'safety', 'load-safety.ts')))).toBe(true);
  });

  const found = new Map<string, number>();       // "file|table" -> hits
  for (const f of files) {
    const rel = f.slice(ROOT.length + 1);
    readFileSync(f, 'utf8').split('\n').forEach((line) => {
      const t = line.trimStart();
      if (t.startsWith('*') || t.startsWith('//')) return;
      TABLE_READ.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = TABLE_READ.exec(line))) {
        const key = `${rel}|${m[1].toLowerCase()}`;
        found.set(key, (found.get(key) ?? 0) + 1);
      }
    });
  }

  it('LIVENESS · the pattern still matches the owner itself', () => {
    // If the predicate stops matching, this gate reports clean while seeing
    // nothing — the worst outcome available, because it also reports
    // confidence. The owner is the probe.
    expect(found.get('lib/safety/load-safety.ts|runner_injuries')).toBe(1);
    expect(found.get('lib/safety/load-safety.ts|sick_episodes')).toBe(1);
    expect(found.get('lib/safety/load-safety.ts|niggles')).toBe(1);
  });

  it('every health-table read outside lib/safety is on the allowlist', () => {
    const unlisted: string[] = [];
    for (const [key, hits] of found) {
      const [file, table] = key.split('|');
      if (file.startsWith(join('lib', 'safety') + '/') || file.startsWith('lib/safety/')) continue;
      const row = ALLOWLIST.find((a) => a.file === file && a.table === table);
      if (!row) unlisted.push(`${file} reads ${table} (${hits}x) with no allowlist entry`);
      else if (row.hits !== hits) {
        unlisted.push(`${file} reads ${table} ${hits}x, allowlist says ${row.hits}x`);
      }
    }
    expect(unlisted).toEqual([]);
  });

  it('RATCHET · every allowlist entry still names a live site (Rule 18 §4)', () => {
    const stale = ALLOWLIST
      .filter((a) => !found.has(`${a.file}|${a.table}`))
      .map((a) => `${a.file} no longer reads ${a.table} — delete this entry`);
    expect(stale).toEqual([]);
  });

  it('at most ONE module is still a second author of the verdict', () => {
    // `lib/watch/build-workout.ts`, two rows. When the watch delegates, both
    // rows go and this number becomes 0. It may never rise.
    const open = ALLOWLIST.filter((a) => a.posture === 'OPEN');
    expect(new Set(open.map((o) => o.file)).size).toBeLessThanOrEqual(1);
    expect(open.length).toBeLessThanOrEqual(2);
  });

  it('every allowlist entry carries an argued reason (Rule 18 §4)', () => {
    const thin = ALLOWLIST.filter((a) => a.reason.trim().length < 60);
    expect(thin.map((t) => t.file)).toEqual([]);
  });
});

describe('Safety vocabulary · declared once', () => {
  const files = [
    ...sourceFiles(join(ROOT, 'lib')),
    ...sourceFiles(join(ROOT, 'app')),
  ];

  /**
   * The §2.E four-value union, in any order, as a TypeScript union of string
   * literals. `lib/adaptation/adaptation-model.ts` uses `'MODIFY'` inside a
   * different four-value union (STAY/PROGRESS/MODIFY/PROTECT — the adaptation
   * ladder), so matching a single literal would produce a false positive; the
   * pattern requires the two values unique to Safety, CAUTION and STOP.
   */
  const SAFETY_UNION = /'CAUTION'[\s\S]{0,80}?'STOP'|'STOP'[\s\S]{0,80}?'CAUTION'/;

  it('only lib/safety declares the NORMAL/CAUTION/MODIFY/STOP vocabulary', () => {
    const offenders = files
      .filter((f) => !f.includes(join('lib', 'safety')))
      .filter((f) => {
        const src = readFileSync(f, 'utf8')
          .replace(/\/\*[\s\S]*?\*\//g, '')
          .replace(/^[ \t]*\/\/.*$/gm, '');
        return SAFETY_UNION.test(src);
      })
      .map((f) => f.slice(ROOT.length + 1));
    expect(offenders).toEqual([]);
  });

  it('LIVENESS · the pattern matches the owner (Rule 18 §2)', () => {
    const owner = readFileSync(join(ROOT, 'lib', 'safety', 'safety-verdict.ts'), 'utf8');
    expect(SAFETY_UNION.test(owner)).toBe(true);
  });

  it('the deleted inline authors have not grown back', () => {
    // `verdictBySeverity` was the iPhone's inline object literal keyed on
    // injury severity. It is gone; the sentence lives in `safetyVerdictLine`.
    // Comments stripped first: the route's own header NAMES the literal it
    // deleted, and a source-text gate that reads commentary about code
    // instead of code fails on its own explanation. This one did, on its
    // first run.
    const route = readFileSync(join(ROOT, 'app', 'api', 'v5', 'today', 'route.ts'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^[ \t]*\/\/.*$/gm, '');
    expect(route).not.toContain('verdictBySeverity');
    expect(route).toContain('safetyVerdictLine');
    // and the route no longer reads a health table at all
    expect(route).not.toMatch(/FROM\s+(runner_injuries|sick_episodes|niggles)\b/);
  });

  it('glance-state consumes the owner instead of reading the tables', () => {
    const glance = readFileSync(join(ROOT, 'lib', 'coach', 'glance-state.ts'), 'utf8');
    expect(glance).toContain('classifySafety');
    expect(glance).toContain('loadSafetyInputs');
    expect(glance).not.toMatch(/FROM\s+(runner_injuries|sick_episodes|niggles)\b/);
  });
});
