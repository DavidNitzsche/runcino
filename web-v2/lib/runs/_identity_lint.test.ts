/**
 * A RUN HAS THREE NAMES, AND A READER MUST ANSWER TO ALL OF THEM.
 *
 * `runs` carries a bigint primary key, a `data.id` the ingest layer composed
 * ("{uuid}-{date}#{hhmm}"), and a `data.activityId` for anything that came
 * from Strava. Different writers file under different ones — that is not a
 * bug to be stamped out, it is the shape of a system with four ingest paths
 * and eight years of history.
 *
 * What IS a bug is a reader that picks one with `??`. On 2026-08-24 the owner
 * logged an effort of 3; it was written under the run's primary key, and the
 * Today route looked it up under `data.activityId ?? data.id ?? runRow.id`.
 * `data.id` exists on watch rows, so the ladder stopped one rung early and
 * found nothing. The value was saved, correct, and unreachable, and the row
 * went on offering to log an effort he had already given.
 *
 * Exactly the shape of the clock-ladder defect this repo spent the day
 * removing: a precedence chain over spellings of one fact, where the winner
 * depends on which keys a particular row happens to carry.
 *
 * A reader keyed on a run's identity matches the SET. The rows are unique per
 * (user, activity), so matching all three cannot pick up someone else's.
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const WEB = path.resolve(__dirname, '../..');
const ROOTS = ['app', 'lib'].map((d) => path.join(WEB, d));

/** Tables whose rows are keyed by a run's identity rather than by its row id. */
const IDENTITY_KEYED = ['post_run_rpe'];

function sourceFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      // `._*` — the WP volume writes an AppleDouble sidecar beside every file.
      if (e.name.startsWith('._') || e.name === 'node_modules') continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.(ts|tsx)$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)) out.push(p);
    }
  };
  for (const r of ROOTS) if (fs.existsSync(r)) walk(r);
  return out;
}

const rel = (p: string) => path.relative(WEB, p).split(path.sep).join('/');

/**
 * Argued exemptions. Each must say why a single key is correct THERE.
 * The list may shrink; it may not grow quietly.
 */
const ALLOW: Record<string, string> = {
  'app/api/runs/[id]/rpe/route.ts':
    'THE WRITER, plus its own GET. Both are handed one id by the client and must use exactly that one — the UPSERT target has to be a single value, and a GET that widened its match could answer with a row the caller did not ask about. It already matches BOTH user columns, which is the half that matters here.',
  'lib/strava/pullSync.ts':
    "THE IMPORTER. Its dedup reads under `match.id` alone, which is a real gap: a run the runner already answered under its primary key can collect a second row from Strava. Its user match has since been widened; the ID spelling is still single, which is the remaining gap. It is left because the Today read now prefers a non-auto-imported answer, so a duplicate cannot displace him. Do not delete this entry without widening that dedup to the id SET.",
  'lib/strava/push.ts':
    'Takes the id as a parameter from its caller rather than choosing one, so there is no ladder here to get wrong. It already matches both user columns.',
};

describe('identity lint · a reader answers to every name a run has', () => {
  it('no reader picks one identity with ?? and queries a single key', () => {
    const violations: string[] = [];
    for (const file of sourceFiles()) {
      const r = rel(file);
      if (ALLOW[r]) continue;
      const src = fs.readFileSync(file, 'utf8');
      if (!IDENTITY_KEYED.some((t) => src.includes(t))) continue;

      // A ladder over two or more spellings of the run's identity.
      const ladder = /activityId\s*\?\?|\bdata\.id\s*\?\?|\.id\s*\?\?\s*\w*[Rr]ow/.test(src);
      // ...and a lookup that only ever binds one of them.
      const matchesSet = src.includes('ANY($') || src.includes('= ANY(');
      if (ladder && !matchesSet) {
        violations.push(`${r} — chooses one identity with ?? and matches a single activity_id`);
      }
    }
    expect(violations,
      'a run identity read through a ?? ladder. Match the SET of ids, or add an argued exemption.',
    ).toEqual([]);
  });

  it('a reader is never narrower about the user than its writer', () => {
    // `post_run_rpe.user_id` is TEXT for legacy reasons and older rows carry
    // 'me'; `user_uuid` was added later. The writer matches both. A reader
    // that matches only one turns a saved answer into an unsaved one.
    const violations: string[] = [];
    for (const file of sourceFiles()) {
      const r = rel(file);
      const src = fs.readFileSync(file, 'utf8');
      if (!IDENTITY_KEYED.some((t) => src.includes(t))) continue;
      for (const m of src.matchAll(/FROM\s+post_run_rpe[\s\S]{0,260}?(?=`)/g)) {
        const q = m[0];
        if (!/WHERE|AND/i.test(q)) continue;
        if (q.includes('user_uuid') && !q.includes('user_id')) {
          violations.push(`${r} — reads post_run_rpe by user_uuid only; the writer matches both`);
        }
      }
    }
    expect(violations,
      'a reader narrower about the user than the writer that filled the table.',
    ).toEqual([]);
  });

  it('the exemption list has no stale entries', () => {
    const stale = Object.keys(ALLOW).filter((f) => !fs.existsSync(path.join(WEB, f)));
    expect(stale, 'an exempted file is gone; delete its entry').toEqual([]);
  });
});
