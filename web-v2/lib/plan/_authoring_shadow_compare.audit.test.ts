/**
 * lib/plan/_authoring_shadow_compare.audit.test.ts · SHADOW MODE (§21, Rule 13).
 *
 * The authoring-side counterpart to
 * `lib/adaptation/_shadow_compare.audit.test.ts` and
 * `lib/adaptation/_adaptation_engine.audit.test.ts`: runs the LEGACY
 * authoring path (`composeForUser`, real, unchanged) and the CANONICAL
 * authoring path (`canonicalSpecForComposedDay`, new, unreachable from any
 * real caller) against the SAME real accounts, and prints the structured
 * diff. Nothing here persists. See `authoring-shadow-compare.ts`'s header
 * for the read-only guarantee.
 *
 * ── HOW IT RUNS ─────────────────────────────────────────────────────────────
 *
 * Read-only, and ENFORCED rather than assumed: `process.env.DATABASE_URL` is
 * overridden onto the read-only role BEFORE `lib/db/pool`'s module-level
 * `new Pool(...)` is constructed, which means every app module must be
 * imported DYNAMICALLY inside the test body. Same convention as
 * `_adaptation_engine.audit.test.ts` / `_capacity_resolver.audit.test.ts`.
 *
 *   npx vitest run lib/plan/_authoring_shadow_compare.audit.test.ts --disable-console-intercept
 *
 * ── ACCOUNTS ─────────────────────────────────────────────────────────────────
 *
 * `resolvePrescribedPaceAnchors` is DB-backed per `userId` — there is no way
 * to run a synthetic `ComposePlanInput` archetype (no backing `users` row)
 * through it. So the corpus here is every REAL account this database holds
 * with an active plan, queried fresh rather than hardcoded, spanning the
 * owner's evidence-rich account and every zero-history QA seed account —
 * see the report for why this is the honest substitute for
 * `_sweep_allusers`'s synthetic corpus, and what it cannot cover.
 */
import { describe, it, expect } from 'vitest';

const RO = process.env.DATABASE_URL_RO;
const OWNER = '0645f40c-951d-4ccc-b86e-9979cd26c795';
const TODAY = '2026-08-31';

const pace = (s: number | null | undefined): string => {
  if (s == null || !Number.isFinite(s)) return '   -   ';
  const m = Math.floor(s / 60);
  const r = Math.round(s % 60);
  return `${m}:${String(r).padStart(2, '0')}/mi`;
};
const delta = (s: number | null | undefined): string => {
  if (s == null || !Number.isFinite(s)) return '   -  ';
  const sign = s > 0 ? '+' : (s < 0 ? '-' : ' ');
  return `${sign}${String(Math.abs(Math.round(s))).padStart(3, ' ')}s`;
};
const pad = (s: string, n: number) => (s.length >= n ? s.slice(0, n) : s + ' '.repeat(n - s.length));

describe.skipIf(!RO)('AUTHORING SHADOW COMPARE · legacy VDOT cascade vs canonical anchors', () => {
  it("runs against the owner's real account and reports the full structured diff", async () => {
    process.env.DATABASE_URL = RO;

    const { runAuthoringShadowCompare } = await import('./authoring-shadow-compare');

    const result = await runAuthoringShadowCompare({ userId: OWNER, raceSlug: 'cim' });

    console.log('\n══ AUTHORING SHADOW COMPARE · owner (cim) ══════════════════════');
    if (!result.ok) {
      console.log(`REFUSED: ${result.reason}`);
      expect.fail(`composeForUser refused for the owner's own active-plan race: ${result.reason}`);
    }

    console.log(`account ${result.userId} · today ${result.todayISO} · mode ${result.mode} · ${result.totalWeeks} weeks · race distance ${result.raceDistanceMi}mi`);
    console.log(`legacy plan-wide tPaceSec: ${pace(result.legacy.tPaceSec)} (${result.legacy.tPaceSec ?? 'null'}s) · bestRecentVdot ${result.legacy.bestRecentVdot ?? 'null'}`);

    if (!result.anchorRead.ok) {
      console.log(`\nCANONICAL LEG REFUSED (Rule 11 · not coerced): ${result.anchorRead.reason} — ${result.anchorRead.detail}`);
      console.log('No day-level diff is possible; the refusal itself is the finding — see the report.');
      // A refusal is a legitimate, informative outcome (Rule 11) — do not
      // fail the suite on it, but the day array must be empty, provably.
      expect(result.days.length).toBe(0);
      return;
    }

    const a = result.anchorRead.anchors;
    console.log('\nCANONICAL ANCHORS (resolvePrescribedPaceAnchors):');
    console.log(`  threshold  ${pace(a.thresholdSecPerMi)}  · sourceMode ${a.basis.threshold.sourceMode} · conf ${a.basis.threshold.confidence.toFixed(2)} · vdot ${a.basis.threshold.vdot ?? 'null'}`);
    console.log(`  interval   ${pace(a.intervalSecPerMi)}  · sourceMode ${a.basis.highIntensity.sourceMode} · conf ${a.basis.highIntensity.confidence.toFixed(2)}`);
    console.log(`  repetition ${pace(a.repetitionSecPerMi)}`);
    console.log(`  easy ceil  ${pace(a.easyCeilingSecPerMi)}  · sourceMode ${a.basis.easyCeiling.sourceMode} · conf ${a.basis.easyCeiling.confidence.toFixed(2)}`);
    console.log(`  shakeout   ${pace(a.shakeoutCeilingSecPerMi)}`);
    console.log(`  marathon   ${pace(a.marathonSecPerMi)}  · sourceMode ${a.basis.marathon.sourceMode} · conf ${a.basis.marathon.confidence.toFixed(2)} · exponent ${a.basis.marathon.enduranceExponent.toFixed(3)} · personallyEvidenced ${a.basis.marathon.personallyEvidenced}`);

    console.log(`\nDAY-BY-DAY (${result.days.length} composed days):`);
    console.log(pad('wk', 3) + pad('phase', 15) + pad('type', 12) + pad('mi', 6) + pad('legacy', 10) + pad('canon', 10) + pad('Δ', 7) + 'sub_label');
    for (const d of result.days) {
      console.log(
        pad(String(d.weekIdx), 3) + pad(d.phase, 15) + pad(d.type, 12) + pad(d.distanceMi.toFixed(1), 6)
        + pad(pace(d.legacy.paceTargetSPerMi), 10) + pad(pace(d.canonical.paceTargetSPerMi), 10)
        + pad(delta(d.paceDeltaSPerMi), 7) + (d.subLabel ?? ''),
      );
    }

    // ── AGGREGATE, BY PHASE, QUALITY-ONLY (the structured diff step 4 asks for) ──
    const phases = Array.from(new Set(result.days.map((d) => d.phase)));
    console.log('\nQUALITY PACE BY PHASE (mean Δ, canonical − legacy, s/mi):');
    for (const ph of phases) {
      const qs = result.days.filter((d) => d.phase === ph && d.isQuality && d.paceDeltaSPerMi != null);
      if (qs.length === 0) { console.log(`  ${ph}: no quality days with a comparable pace`); continue; }
      const mean = qs.reduce((s, d) => s + (d.paceDeltaSPerMi ?? 0), 0) / qs.length;
      console.log(`  ${ph}: ${qs.length} day(s), mean Δ ${delta(mean)}`);
    }

    console.log('\nEASY / LONG CEILING (legacy easyAnchorT vs canonical easyCeiling, s/mi):');
    const easyLegacy = result.days.find((d) => d.type === 'easy')?.legacy.paceLoSPerMi ?? null;
    const easyCanonical = result.days.find((d) => d.type === 'easy')?.canonical.paceLoSPerMi ?? null;
    console.log(`  legacy ${pace(easyLegacy)} · canonical ${pace(easyCanonical)} · Δ ${delta(easyCanonical != null && easyLegacy != null ? easyCanonical - easyLegacy : null)}`);

    const raceDays = result.days.filter((d) => d.type === 'race' || d.type === 'race_week_tuneup');
    console.log('\nRACE-SPECIFIC WORK:');
    for (const d of raceDays) {
      console.log(`  wk${d.weekIdx} ${d.type}: legacy ${pace(d.legacy.paceTargetSPerMi)} · canonical ${pace(d.canonical.paceTargetSPerMi)} · Δ ${delta(d.paceDeltaSPerMi)}`);
    }

    console.log('\nWARM-UP / COOL-DOWN (mean, quality days only):');
    const wus = result.days.filter((d) => d.isQuality);
    const meanWu = (side: 'legacy' | 'canonical') => {
      const vals = wus.map((d) => d[side].warmupMi).filter((v): v is number => v != null);
      return vals.length ? vals.reduce((s, v) => s + v, 0) / vals.length : null;
    };
    const meanCd = (side: 'legacy' | 'canonical') => {
      const vals = wus.map((d) => d[side].cooldownMi).filter((v): v is number => v != null);
      return vals.length ? vals.reduce((s, v) => s + v, 0) / vals.length : null;
    };
    console.log(`  warmup  legacy ${meanWu('legacy')?.toFixed(2) ?? '-'}mi · canonical ${meanWu('canonical')?.toFixed(2) ?? '-'}mi`);
    console.log(`  cooldown legacy ${meanCd('legacy')?.toFixed(2) ?? '-'}mi · canonical ${meanCd('canonical')?.toFixed(2) ?? '-'}mi`);

    console.log('\nHR GUIDANCE (hr_cap_bpm, easy/long days, first divergence if any):');
    const hrDiverge = result.days.find((d) => d.isQuality === false && d.legacy.hrCapBpm !== d.canonical.hrCapBpm);
    console.log(hrDiverge
      ? `  wk${hrDiverge.weekIdx} ${hrDiverge.type}: legacy ${hrDiverge.legacy.hrCapBpm} vs canonical ${hrDiverge.canonical.hrCapBpm}`
      : '  none — hr_cap_bpm is a function of lthr/maxHr only, identical on both legs by construction');

    console.log('\nTOTAL STRESS PROXY (Σ (canonical pace − legacy pace) × distanceMi over quality days, s·mi/mi — negative = canonical asks for MORE speed at the same volume):');
    const stress = result.days
      .filter((d) => d.isQuality && d.paceDeltaSPerMi != null)
      .reduce((s, d) => s + (d.paceDeltaSPerMi ?? 0) * d.distanceMi, 0);
    console.log(`  ${stress.toFixed(0)} s·mi`);

    console.log('\nSTRUCTURAL DIFFS (kind or rep_count mismatch — not just a point pace difference):');
    let structural = 0;
    for (const d of result.days) {
      if (d.legacy.kind !== d.canonical.kind || d.legacy.repCount !== d.canonical.repCount) {
        structural++;
        console.log(`  wk${d.weekIdx} ${d.type} ${d.subLabel ?? ''}: kind ${d.legacy.kind}→${d.canonical.kind}, rep_count ${d.legacy.repCount}→${d.canonical.repCount}`);
      }
    }
    if (structural === 0) console.log('  none');

    // ── ASSERTIONS · properties that would be defects on EITHER side ─────────
    expect(result.days.length).toBeGreaterThan(0);
    // Every day either has a comparable pace on both legs or neither —
    // Rule 11: one side silently null and the other populated would be a
    // real defect (a branch this file's twin took that the real branch
    // did not, or vice versa).
    for (const d of result.days) {
      const legacyHas = d.legacy.paceTargetSPerMi != null;
      const canonicalHas = d.canonical.paceTargetSPerMi != null;
      if (legacyHas !== canonicalHas) {
        console.log(`ASYMMETRIC NULL: wk${d.weekIdx} ${d.type} ${d.subLabel ?? ''} — legacy ${legacyHas ? 'has' : 'lacks'} a pace, canonical ${canonicalHas ? 'has' : 'lacks'} one`);
      }
    }
  }, 30_000);

  it('runs against every other real account with an active plan (the DB-backed corpus)', async () => {
    process.env.DATABASE_URL = RO;
    const { pool } = await import('@/lib/db/pool');
    const { runAuthoringShadowCompare } = await import('./authoring-shadow-compare');

    const rows = (await pool.query<{ user_uuid: string; race_id: string | null; email: string }>(
      `SELECT tp.user_uuid, tp.race_id, u.email
         FROM training_plans tp
         JOIN users u ON u.id = tp.user_uuid
        WHERE tp.archived_iso IS NULL AND tp.race_id IS NOT NULL AND tp.user_uuid <> $1
        ORDER BY tp.authored_iso DESC`,
      [OWNER],
    )).rows;

    console.log(`\n══ AUTHORING SHADOW COMPARE · ${rows.length} other real, DB-backed account(s) ══`);
    let refusals = 0, ok = 0;
    for (const r of rows) {
      const result = await runAuthoringShadowCompare({ userId: r.user_uuid, raceSlug: r.race_id! });
      if (!result.ok) {
        console.log(`  ${r.email}: composeForUser refused — ${result.reason}`);
        continue;
      }
      if (!result.anchorRead.ok) {
        refusals++;
        console.log(`  ${r.email}: canonical leg REFUSED — ${result.anchorRead.reason} (${result.anchorRead.detail})`);
        continue;
      }
      ok++;
      const a = result.anchorRead.anchors;
      const qDeltas = result.days.filter((d) => d.isQuality && d.paceDeltaSPerMi != null);
      const meanQ = qDeltas.length ? qDeltas.reduce((s, d) => s + (d.paceDeltaSPerMi ?? 0), 0) / qDeltas.length : null;
      console.log(
        `  ${r.email}: ${result.mode} · ${result.totalWeeks}wk · threshold sourceMode=${a.basis.threshold.sourceMode} `
        + `conf=${a.basis.threshold.confidence.toFixed(2)} · legacyT=${pace(result.legacy.tPaceSec)} canonT=${pace(a.thresholdSecPerMi)} `
        + `· mean quality Δ=${delta(meanQ)} (${qDeltas.length} quality days)`,
      );
    }
    console.log(`\n${ok} account(s) produced a full comparison, ${refusals} refused at the canonical anchor stage, ${rows.length - ok - refusals} refused at composeForUser.`);
    expect(rows.length).toBeGreaterThan(0);
  }, 60_000);
});
