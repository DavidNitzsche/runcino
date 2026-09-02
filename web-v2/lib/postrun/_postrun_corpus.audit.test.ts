/**
 * lib/postrun/_postrun_corpus.audit.test.ts · every run this runner has, put
 * through the post-run composer.
 *
 * `_experience.test.ts` is fixtures and says so. This is the other half: it
 * walks the owner's real canonical rows — every source, every shape, planned
 * and unplanned, outdoor and treadmill, with phases and without — and asserts
 * the composer never says anything it has not earned on ANY of them.
 *
 * Rule 15 is why this exists in this form. A corpus that cannot express a
 * runner with a history tests nothing about a mechanism gated on one, and the
 * shapes that break a composer are the ones nobody thought to invent: a run
 * with `phases: []` from an Apple Watch, a treadmill row with three phases and
 * no GPS, a 0.84-mile walk-shaped activity, a long run whose only phase is the
 * whole run.
 *
 * ── WHAT THIS GATE CANNOT FAIL ON (Rule 22) ─────────────────────────────────
 *
 *   · IT CANNOT TELL YOU A VERDICT IS RIGHT. It is a conformance sweep: it
 *     asserts the composer's OUTPUT is well-formed and internally consistent,
 *     not that "controlled work" was the correct thing to say.
 *   · IT IS ONE RUNNER. Every row is `dnitch85@me.com`'s. A shape only another
 *     account produces is invisible here.
 *   · IT CANNOT SEE A MISSING STATE. There is no race and no injury-return run
 *     in this window, so those arms of the composer are exercised only by the
 *     fixtures. Named rather than implied.
 *   · IT IS THE PAYLOAD, NOT THE PHONE.
 */
import { describe, it, expect } from 'vitest';
import { pool } from '@/lib/db/pool';
import { loadPostRunExperience } from './load';
import { auditExplanation, layerOne } from '@/lib/faff/explanation';
import { scanLayerOne, scanPunctuation } from '@/lib/faff/coach-lexicon';
import type { PostRunExperienceV1 } from './experience';

const RO = process.env.DATABASE_URL_RO ?? process.env.DATABASE_URL;
const OWNER = '0645f40c-951d-4ccc-b86e-9979cd26c795';
/** Enough to span every shape in this account without walking three years. */
const WINDOW = 40;

async function recentRunIds(): Promise<Array<{ id: string; date: string }>> {
  const r = await pool.query<{ id: string; d: string }>(
    `SELECT id::text AS id, COALESCE(data->>'date', LEFT(data->>'startLocal',10)) AS d
       FROM runs
      WHERE user_uuid = $1 AND NOT (data ? 'mergedIntoId')
      ORDER BY d DESC
      LIMIT ${WINDOW}`,
    [OWNER],
  );
  return r.rows.map((x) => ({ id: x.id, date: x.d }));
}

/** Every string a runner reads on this object. Explicit paths, not a walk —
 *  a recursive walk would also pick up ids, versions and enum codes and drown
 *  a real finding in noise. */
function readable(x: PostRunExperienceV1): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  const push = (p: string, v: unknown) => {
    if (typeof v === 'string' && v.trim()) out.push([p, v]);
  };
  push('execution.headline', x.execution.headline);
  push('execution.summary', x.execution.summary);
  push('cost.summary', x.cost.summary);
  push('evidence.runnerSummary', x.evidence.runnerSummary);
  push('plan.runnerSummary', x.plan.runnerSummary);
  push('next.summary', x.next.summary);
  for (const [i, c] of x.plan.changes.entries()) push(`plan.changes[${i}]`, c);
  push('briefing.verdict', x.briefing.verdict);
  push('briefing.reason', x.briefing.reason);
  push('briefing.consequence', x.briefing.consequence);
  push('briefing.accessibilitySummary', x.briefing.accessibilitySummary);
  for (const [i, w] of (x.briefing.whyNot ?? []).entries()) push(`briefing.whyNot[${i}]`, w.display);
  return out;
}

describe.skipIf(!RO)('post-run · the whole corpus of this runner s real runs', () => {
  it('composes every run without a defect, and never claims what it cannot measure', async () => {
    process.env.DATABASE_URL = RO as string;
    const ids = await recentRunIds();
    const defects: string[] = [];
    let composed = 0;
    let stringsSeen = 0;
    const statuses = new Map<string, number>();
    const roles = new Map<string, number>();

    for (const { id, date } of ids) {
      const x = await loadPostRunExperience(OWNER, { runId: id });
      if (!x) { defects.push(`${date} ${id}: composed nothing for a canonical row`); continue; }
      composed += 1;
      statuses.set(x.execution.status, (statuses.get(x.execution.status) ?? 0) + 1);
      roles.set(x.evidence.role, (roles.get(x.evidence.role) ?? 0) + 1);

      // 1 · the voice contract, on the real strings.
      for (const d of auditExplanation(x.briefing)) {
        defects.push(`${date}: briefing.${d.field} — ${d.problem}`);
      }
      const strings = readable(x);
      stringsSeen += strings.length;
      for (const [path, s] of strings) {
        for (const f of scanLayerOne(s)) defects.push(`${date}: ${path} — ${f.band}: "${f.term}"`);
        for (const p of scanPunctuation(s)) defects.push(`${date}: ${path} — ${p}`);
      }

      // 2 · RULE 16 · a sentence about a measurement is gated on it.
      if (x.cost.summary != null && x.cost.hrBpm == null) {
        defects.push(`${date}: a cost sentence with no heart rate behind it`);
      }
      if (x.cost.summary != null && x.cost.ceilingBpm == null) {
        defects.push(`${date}: a cost sentence with no prescribed ceiling behind it`);
      }
      if (x.cost.summary == null && x.cost.status !== 'UNKNOWN') {
        defects.push(`${date}: cost status ${x.cost.status} with nothing said`);
      }
      // The reading and its scope travel together or not at all.
      if ((x.cost.hrBpm == null) !== (x.cost.hrScope == null)) {
        defects.push(`${date}: a heart rate without a scope, or a scope without a reading`);
      }

      // 3 · RULE 11 · a refusal reads as an answer, never as a failure.
      if (x.evidence.role === 'UNREAD' && x.plan.status !== 'UNKNOWN') {
        defects.push(`${date}: evidence unread but the plan claims ${x.plan.status}`);
      }
      if (x.plan.status !== 'UPDATED' && x.plan.changes.length > 0) {
        defects.push(`${date}: plan says ${x.plan.status} and still lists ${x.plan.changes.length} change(s)`);
      }
      if (x.evidence.beliefChanged) {
        // Nothing in this layer may move a belief. `beliefChanged` exists so a
        // future Runner Model change has somewhere honest to say so; a `true`
        // from THIS composer would mean it started deciding.
        defects.push(`${date}: the post-run layer claimed a belief changed`);
      }
      if (x.plan.sealedHistoryChanged as boolean) {
        defects.push(`${date}: sealed history reported as changed`);
      }

      // 4 · RULE 17 · Layer 1 does not say the same thing twice.
      const l1 = layerOne(x.briefing);
      const sentences = l1.split(/(?<=\.)\s+/).map((s) => s.trim().toLowerCase()).filter(Boolean);
      if (new Set(sentences).size !== sentences.length) {
        defects.push(`${date}: layer one repeats itself — ${JSON.stringify(l1)}`);
      }

      // 5 · every surface-facing string is non-empty where the type promises one.
      if (!x.execution.headline.trim()) defects.push(`${date}: empty headline`);
      if (!x.execution.summary.trim()) defects.push(`${date}: empty summary`);
      if (!x.evidence.runnerSummary.trim()) defects.push(`${date}: empty evidence summary`);
      if (!x.plan.runnerSummary.trim()) defects.push(`${date}: empty plan summary`);
      if (x.decisionVersion.split('|').length !== 4) {
        defects.push(`${date}: decisionVersion is not the four-part identity — ${x.decisionVersion}`);
      }
    }

    // LIVENESS · Rule 18 clause 2. A sweep that opened nothing reports clean
    // AND reports confidence, which is the worst outcome available.
    expect(composed, 'composed nothing — this sweep asserted nothing').toBeGreaterThanOrEqual(30);
    expect(stringsSeen).toBeGreaterThanOrEqual(composed * 4);

    // COVERAGE, stated in paths reached rather than cases run (Rule 15).
    // eslint-disable-next-line no-console
    console.log('post-run corpus · execution statuses', JSON.stringify([...statuses]),
      '· evidence roles', JSON.stringify([...roles]),
      `· ${composed} runs, ${stringsSeen} runner-readable strings`);

    expect(defects, `${defects.length} finding(s):\n  ${defects.join('\n  ')}`).toEqual([]);
  }, 900_000);
});
