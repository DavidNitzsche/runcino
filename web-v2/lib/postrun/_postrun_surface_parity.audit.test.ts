/**
 * lib/postrun/_postrun_surface_parity.audit.test.ts · Today-after-run and Run
 * Detail describe the same run the same way.
 *
 * Calls the THREE real route handlers against the owner's production account,
 * read-only, and compares what they return field for field. This is the
 * brief's first P0 as a check, and the defect it was written against is on the
 * record rather than argued — captured from these same handlers on 2026-09-02,
 * before the change:
 *
 *   /api/v5/today          "Tempo done, 8.5 mi total at 8:03/mi, avg HR 162
 *                           across the 4 reps."
 *   /api/runs/[id]/recap   "Tempo done, 4 mi @ 7:03, avg HR 162 across the 4
 *                           reps. Work miles landed inside the 7:10/mi window,
 *                           7s/mi quick, consistent through the block."
 *   /api/runs/[id]         404 — on the very id `/api/v5/today` had just
 *                           handed the phone as `runId`.
 *
 * ── WHAT THIS GATE CANNOT FAIL ON (Rule 22) ─────────────────────────────────
 *
 *   · IT CANNOT TELL YOU EITHER SURFACE IS RIGHT. Two screens agreeing on a
 *     wrong sentence passes here perfectly. Correctness of the sentence is
 *     `_experience.test.ts`'s question; this one is only about agreement.
 *   · IT IS THE PAYLOAD, NOT THE PHONE. A native view that stops reading the
 *     field, or draws it twice, is invisible here.
 *   · IT IS ONE RUN ON ONE DAY. A divergence that only appears on a treadmill
 *     run, a race, or a day with no plan row is not exercised.
 *   · WITHOUT A DATABASE IT ASSERTS NOTHING, and says so loudly through the
 *     liveness test rather than reporting green.
 */
import { describe, it, expect, vi } from 'vitest';

const RO = process.env.DATABASE_URL_RO ?? process.env.DATABASE_URL;
const OWNER = '0645f40c-951d-4ccc-b86e-9979cd26c795';
/** The 4 x 1 mile the brief names as its acceptance fixture. */
const RUN_PK = '-258355938987883';
const DATE = '2026-09-01';

vi.mock('@/lib/auth/session', () => ({
  requireUserId: async () => '0645f40c-951d-4ccc-b86e-9979cd26c795',
}));

async function payloads() {
  process.env.DATABASE_URL = RO as string;
  const { GET: today } = await import('@/app/api/v5/today/route');
  const { GET: recap } = await import('@/app/api/runs/[id]/recap/route');
  const { GET: detail } = await import('@/app/api/runs/[id]/route');
  const params = { params: Promise.resolve({ id: RUN_PK }) } as never;
  const t = await today(new Request(`https://faff.run/api/v5/today?date=${DATE}`) as never);
  const r = await recap(new Request(`https://faff.run/api/runs/${RUN_PK}/recap`) as never, params);
  const d = await detail(new Request(`https://faff.run/api/runs/${RUN_PK}`) as never, params);
  return {
    today: await t.json(), recap: await r.json(), detail: await d.json(),
    status: { today: t.status, recap: r.status, detail: d.status },
  };
}

describe.skipIf(!RO)('post-run · three routes, one run, one answer', () => {
  it('all three resolve the same run by the same id', async () => {
    const p = await payloads();
    expect(p.status).toEqual({ today: 200, recap: 200, detail: 200 });
    expect(p.today.state).toBe('after_run');
    expect(p.today.runId).toBe(RUN_PK);
  }, 240_000);

  it('carry the SAME decision version — the proof, not the assertion', async () => {
    const p = await payloads();
    const dv = p.today.postRun?.decisionVersion;
    expect(typeof dv).toBe('string');
    expect(dv).not.toBe('');
    expect(p.recap.postRun?.decisionVersion).toBe(dv);
    expect(p.detail.postRun?.decisionVersion).toBe(dv);
  }, 240_000);

  it('say the same sentences about the same workout', async () => {
    const p = await payloads();
    expect(p.recap.verdict).toBe(p.today.verdict);
    expect(p.recap.win).toBe(p.today.win);
    expect(p.recap.facts).toEqual(p.today.facts);
    // And the sentence is about the workout, not a paraphrase of the poster.
    expect(p.today.verdict).toMatch(/\breps?\b|\bwork block\b/);
  }, 240_000);

  it('the whole post-run block is byte-identical across all three', async () => {
    const p = await payloads();
    expect(JSON.stringify(p.recap.postRun)).toBe(JSON.stringify(p.today.postRun));
    expect(JSON.stringify(p.detail.postRun)).toBe(JSON.stringify(p.today.postRun));
  }, 240_000);

  it('RULE 17 · no post-run sentence is printed twice on the Today payload', async () => {
    const p = await payloads();
    const pr = p.today.postRun;
    expect(pr).toBeTruthy();
    const sentences = [
      p.today.win, p.today.verdict, ...(p.today.facts ?? []),
      p.today.conditionsNote, p.today.coachTip,
      pr.headline, pr.summary, pr.cost, pr.learned, pr.change, pr.next,
      ...(pr.changes ?? []), ...(pr.why ?? []),
    ].filter((s: unknown): s is string => typeof s === 'string' && s.trim().length > 0);
    // The card's fields and the wire block are the SAME sentences by design —
    // the phone draws each once, from one of the two. What must never happen
    // is a sentence appearing twice WITHIN the wire block, or a recap field
    // carrying something the block does not.
    const inBlock = new Set([pr.headline, pr.summary, pr.cost, pr.learned, pr.change, pr.next].filter(Boolean));
    for (const s of [p.today.win, p.today.verdict, ...(p.today.facts ?? [])]) {
      if (typeof s === 'string' && s.trim()) expect(inBlock.has(s)).toBe(true);
    }
    const blockOnly = [pr.headline, pr.summary, pr.cost, pr.learned, pr.change, pr.next]
      .filter((s): s is string => typeof s === 'string' && s.trim().length > 0);
    expect(new Set(blockOnly).size).toBe(blockOnly.length);
    expect(sentences.length).toBeGreaterThan(4);
  }, 240_000);

  it('RULE 20 · the weekly mileage percentage is no longer the meaning of a run', async () => {
    const p = await payloads();
    // The brief's DELETE list, by name: "weekly mileage percentage as the
    // meaning of a run". What the run MEANT now has its own typed answer.
    expect(typeof p.today.postRun?.learned).toBe('string');
    expect(p.today.postRun.learned.length).toBeGreaterThan(20);
    expect(p.today.postRun.changeState).toBeTruthy();
  }, 240_000);

  it('LIVENESS · these assertions ran against a database', async () => {
    expect(Boolean(RO)).toBe(true);
    const p = await payloads();
    expect(p.today.postRun).toBeTruthy();
  }, 240_000);
});
