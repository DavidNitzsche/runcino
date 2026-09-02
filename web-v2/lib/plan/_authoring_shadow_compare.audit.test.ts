/**
 * lib/plan/_authoring_shadow_compare.audit.test.ts · SHADOW MODE (§21, Rule 13).
 *
 * Runs the CANONICAL authoring path (real, as of AUTHORING-CANONICAL-1) and a
 * reconstruction of the LEGACY one against the same real accounts, and prints
 * the structured diff. Nothing here persists — see
 * `authoring-shadow-compare.ts`'s header for the read-only guarantee and for
 * exactly what the legacy reconstruction does and does not reproduce.
 *
 * ── HOW IT RUNS ─────────────────────────────────────────────────────────────
 *
 * Read-only, and ENFORCED rather than assumed: `process.env.DATABASE_URL` is
 * overridden onto the read-only role BEFORE `lib/db/pool`'s module-level
 * `new Pool(...)` is constructed, which means every app module must be
 * imported DYNAMICALLY inside the test body.
 *
 *   npx vitest run lib/plan/_authoring_shadow_compare.audit.test.ts --disable-console-intercept
 *
 * ── THE SKIP IS LOUD (Rule 18, audit §3.5 point 4) ──────────────────────────
 *
 * `describe.skipIf(!RO)` reported GREEN with no database, which is a gate that
 * "passes" by looking at nothing. There is now an always-running block that
 * FAILS if `DATABASE_URL_RO` is absent unless `ALLOW_AUDIT_SKIP=1` is set
 * explicitly, and prints what did not run either way.
 *
 * ── WHAT THIS FILE CANNOT FAIL ON (Rule 22) ─────────────────────────────────
 *
 *   · It cannot say which side is RIGHT. It measures.
 *   · Its DB corpus is whatever accounts this database holds — four, at the
 *     time of writing, one of them evidence-rich and three cold-start. The
 *     archetype corpus (`_authoring_shadow_compare.test.ts`) is what covers
 *     the shape space; neither covers the direct capacity rungs for a
 *     synthetic runner, because a synthetic runner has no pace corpus.
 *   · Its legacy leg reproduces a FRESH authoring exactly and a mid-block
 *     rebuild not at all, so it UNDERSTATES the divergence on a rebuild — the
 *     path where the deleted goal blend actually moved a pace.
 */
import { describe, it, expect } from 'vitest';

const RO = process.env.DATABASE_URL_RO;
const OWNER = '0645f40c-951d-4ccc-b86e-9979cd26c795';

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

/**
 * RULE 18 · LIVENESS. `describe.skipIf` is invisible in a green run, so this
 * block always runs and says what happened.
 */
describe('AUTHORING SHADOW COMPARE · liveness', () => {
  it('states whether the DB-backed comparison ran at all', () => {
    if (RO) {
      console.log('AUDIT LIVENESS · DATABASE_URL_RO present — the DB-backed comparison RAN.');
      expect(RO.length).toBeGreaterThan(10);
      return;
    }
    console.log(
      'AUDIT LIVENESS · DATABASE_URL_RO ABSENT — the DB-backed comparison DID NOT RUN.\n'
      + '  Nothing below this line is evidence about production. Set DATABASE_URL_RO, or set\n'
      + '  ALLOW_AUDIT_SKIP=1 to acknowledge the gap deliberately.',
    );
    // A silent skip that reports green is the worst outcome available, because
    // it also reports confidence.
    expect(
      process.env.ALLOW_AUDIT_SKIP === '1',
      'the authoring shadow compare cannot run without DATABASE_URL_RO, and skipping it silently '
      + 'would report green for a check that looked at nothing (Rule 18)',
    ).toBe(true);
  });
});

describe.skipIf(!RO)('AUTHORING SHADOW COMPARE · canonical authoring vs the legacy cascade', () => {
  it("runs against the owner's real account and reports the full structured diff", async () => {
    process.env.DATABASE_URL = RO;

    const { runAuthoringShadowCompare, aggregate } = await import('./authoring-shadow-compare');
    const result = await runAuthoringShadowCompare({ userId: OWNER, raceSlug: 'cim' });

    console.log('\n══ AUTHORING SHADOW COMPARE · owner (cim) ══════════════════════');
    if (!result.ok) {
      console.log(`REFUSED: ${result.reason}`);
      expect.fail(`composeForUser refused for the owner's own active-plan race: ${result.reason}`);
    }

    console.log(`account ${result.userId} · today ${result.todayISO} · mode ${result.mode} · ${result.totalWeeks} weeks · race distance ${result.raceDistanceMi}mi`);
    console.log(
      `LEGACY pricing: threshold ${pace(result.legacy.thresholdSecPerMi)} · interval ${pace(result.legacy.intervalSecPerMi)} `
      + `· marathon ${pace(result.legacy.marathonSecPerMi)} (${result.legacy.marathonAtGoalPace ? 'AT THE GOAL PACE' : 'T+18 population offset'}) `
      + `· I-pace eligible ${result.legacy.iPaceEligible}`,
    );

    if (!result.anchorRead.ok) {
      console.log(`\nCANONICAL LEG REFUSED (Rule 11 · not coerced): ${result.anchorRead.reason} — ${result.anchorRead.detail}`);
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

    const agg = aggregate(result.days);

    // ── THE WHOLE-BLOCK HEADLINE · audit §8 point 2 ──────────────────────────
    // The branch report headlined a QUALITY-DAYS-ONLY proxy, which omitted the
    // eleven long runs carrying 93% of the volume-weighted divergence. This
    // is every priced day, and |Δ| rather than a signed mean (§8 minor), so a
    // +200 and a −200 cannot cancel.
    console.log('\nWHOLE-BLOCK HEADLINE (ALL priced days, |Δ| — a signed mean lets divergences cancel):');
    console.log(`  ${agg.pricedDays} priced days over ${agg.pricedMi} mi`);
    console.log(`  mean |Δ| ${delta(agg.meanAbsDeltaSPerMi)} · mean signed Δ ${delta(agg.meanSignedDeltaSPerMi)}`);
    console.log(`  volume-weighted Σ|Δ|×mi ${agg.volumeWeightedAbsSMi.toFixed(0)} s·mi · signed ${agg.volumeWeightedSignedSMi.toFixed(0)} s·mi`);
    console.log(`  volume-weighted mean |Δ| ${delta(agg.volumeWeightedMeanAbsSPerMi)}`);
    console.log(`  MAX |Δ| ${delta(agg.maxAbsDeltaSPerMi)} on ${agg.maxAbsDeltaDays.length} day(s):`);
    for (const d of agg.maxAbsDeltaDays) {
      console.log(`    wk${d.weekIdx} ${d.type} ${d.distanceMi.toFixed(1)}mi · ${pace(d.legacy.paceTargetSPerMi)} → ${pace(d.canonical.paceTargetSPerMi)} · ${d.subLabel ?? ''}`);
    }

    // ── BY DAY TYPE · audit §8 point 2, so no group can be omitted again ─────
    console.log('\nBY DAY TYPE (sorted by volume-weighted |Δ| — the long runs cannot hide here):');
    for (const t of agg.byType) {
      console.log(`  ${pad(t.type, 18)} ${String(t.days).padStart(3)} days ${t.mi.toFixed(1).padStart(7)} mi · mean Δ ${delta(t.meanDelta)} · Σ|Δ|×mi ${t.sumAbsSMi.toFixed(0).padStart(6)} s·mi`);
    }

    console.log('\nBY PHASE (mean |Δ|):');
    for (const p of agg.byPhase) console.log(`  ${pad(p.phase, 18)} ${String(p.days).padStart(3)} days · mean |Δ| ${delta(p.meanAbsDelta)}`);

    // ── BAND EDGES · audit §8 point 3, printed as "-" in the branch report ───
    console.log('\nBAND EDGES (easy / long / shakeout / recovery — the 45 easy days the old table showed as "-"):');
    for (const b of agg.bands) {
      console.log(
        `  ${pad(b.type, 12)} ×${String(b.days).padStart(3)} · legacy ${pace(b.legacyLo)}–${pace(b.legacyHi)} `
        + `· canonical ${pace(b.canonicalLo)}–${pace(b.canonicalHi)} · Δ(lo) ${delta(b.deltaLo)}`,
      );
    }

    console.log('\nRACE ROW (READ-ONLY COMPARE · Phase 3 owns race pricing; nothing here changes it):');
    if (agg.raceRows.length === 0) console.log('  no race rows in this block');
    for (const r of agg.raceRows) {
      console.log(`  wk${r.weekIdx} ${r.type}: legacy ${pace(r.legacy)} · canonical ${pace(r.canonical)} · Δ ${delta(r.delta)}`);
    }

    console.log('\nWARM-UP / COOL-DOWN (mean, quality days) and HR GUIDANCE:');
    console.log(`  warmup  legacy ${agg.warmupCooldown.legacyWu?.toFixed(2) ?? '-'}mi · canonical ${agg.warmupCooldown.canonicalWu?.toFixed(2) ?? '-'}mi`);
    console.log(`  cooldown legacy ${agg.warmupCooldown.legacyCd?.toFixed(2) ?? '-'}mi · canonical ${agg.warmupCooldown.canonicalCd?.toFixed(2) ?? '-'}mi`);
    console.log(`  hr_cap_bpm divergences: ${agg.hrDivergences} (a function of lthr/maxHr only — any nonzero count is a finding)`);
    console.log(`  persisted distance_mi divergences (spec-summed total): ${agg.totalMiDivergences}`);

    // ── STRUCTURE · audit §8 point 5, the class the old file could not see ───
    console.log('\nVOLUME / STRUCTURE (both legs RE-COMPOSED · the class the previous version could not see at all):');
    console.log(pad('wk', 4) + pad('phase', 16) + pad('legacy mi', 11) + pad('canon mi', 11) + pad('legacy long', 13) + pad('canon long', 12) + 'Q days L/C');
    for (let i = 0; i < Math.max(result.legacyWeeks.length, result.canonicalWeeks.length); i++) {
      const l = result.legacyWeeks[i];
      const c = result.canonicalWeeks[i];
      console.log(
        pad(String(i), 4) + pad(c?.phase ?? l?.phase ?? '-', 16)
        + pad(String(l?.weeklyMi ?? '-'), 11) + pad(String(c?.weeklyMi ?? '-'), 11)
        + pad(String(l?.longMi ?? '-'), 13) + pad(String(c?.longMi ?? '-'), 12)
        + `${l?.qualityDays ?? '-'} / ${c?.qualityDays ?? '-'}`,
      );
    }
    const totalLegacyMi = result.legacyWeeks.reduce((s, w) => s + w.weeklyMi, 0);
    const totalCanonMi = result.canonicalWeeks.reduce((s, w) => s + w.weeklyMi, 0);
    console.log(`  TOTAL BLOCK VOLUME: legacy ${totalLegacyMi.toFixed(1)} mi · canonical ${totalCanonMi.toFixed(1)} mi · Δ ${(totalCanonMi - totalLegacyMi).toFixed(1)} mi`);
    console.log(`\nSTRUCTURAL DIFFS: ${result.structural.length}`);
    for (const d of result.structural.slice(0, 40)) {
      console.log(`  wk${d.weekIdx} ${d.field}: ${d.legacy} → ${d.canonical}`);
    }
    if (result.structural.length > 40) console.log(`  … and ${result.structural.length - 40} more`);

    // ── ASSERTIONS · properties that would be defects on EITHER side ─────────
    expect(result.days.length).toBeGreaterThan(0);
    // hr_cap_bpm is a pure function of LTHR and HRmax; the anchors argument
    // never reaches it. Any divergence is a real defect, not a difference of
    // opinion — asserted rather than printed.
    expect(agg.hrDivergences, 'hr_cap_bpm moved · it is a function of lthr/maxHr only and the anchors never reach it').toBe(0);
    // Rule 11 · one side silently null and the other populated is a real
    // defect (a branch one leg took that the other did not).
    for (const d of result.days) {
      const legacyHas = d.legacy.paceTargetSPerMi != null;
      const canonicalHas = d.canonical.paceTargetSPerMi != null;
      if (legacyHas !== canonicalHas) {
        console.log(`ASYMMETRIC NULL: wk${d.weekIdx} ${d.type} ${d.subLabel ?? ''} — legacy ${legacyHas ? 'has' : 'lacks'} a pace, canonical ${canonicalHas ? 'has' : 'lacks'} one`);
      }
    }
  }, 60_000);

  it('runs against every other real account with an active plan (the DB-backed corpus)', async () => {
    process.env.DATABASE_URL = RO;
    const { pool } = await import('@/lib/db/pool');
    const { runAuthoringShadowCompare, aggregate } = await import('./authoring-shadow-compare');

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
      if (!result.ok) { console.log(`  ${r.email}: composeForUser refused — ${result.reason}`); continue; }
      if (!result.anchorRead.ok) {
        refusals++;
        console.log(`  ${r.email}: canonical leg REFUSED — ${result.anchorRead.reason} (${result.anchorRead.detail})`);
        continue;
      }
      ok++;
      const a = result.anchorRead.anchors;
      const agg = aggregate(result.days);
      console.log(
        `\n  ${r.email}: ${result.mode} · ${result.totalWeeks}wk · threshold sourceMode=${a.basis.threshold.sourceMode} conf=${a.basis.threshold.confidence.toFixed(2)}`,
      );
      console.log(`    legacy T ${pace(result.legacy.thresholdSecPerMi)} → canonical T ${pace(a.thresholdSecPerMi)} · easy ceil ${pace(a.easyCeilingSecPerMi)} · marathon ${pace(a.marathonSecPerMi)}`);
      console.log(`    ${agg.pricedDays} priced days / ${agg.pricedMi} mi · mean |Δ| ${delta(agg.meanAbsDeltaSPerMi)} · vol-weighted mean |Δ| ${delta(agg.volumeWeightedMeanAbsSPerMi)} · MAX |Δ| ${delta(agg.maxAbsDeltaSPerMi)}`);
      console.log(`    structural diffs ${result.structural.length} · hr divergences ${agg.hrDivergences} · distance_mi divergences ${agg.totalMiDivergences}`);
      for (const t of agg.byType.slice(0, 4)) {
        console.log(`      ${pad(t.type, 16)} ${String(t.days).padStart(3)}d · mean Δ ${delta(t.meanDelta)} · Σ|Δ|×mi ${t.sumAbsSMi.toFixed(0)}`);
      }
      // Same defect assertion as the owner block: HR must not move.
      expect(agg.hrDivergences, `${r.email}: hr_cap_bpm moved`).toBe(0);
    }
    console.log(`\n${ok} account(s) produced a full comparison, ${refusals} refused at the canonical anchor stage, ${rows.length - ok - refusals} refused at composeForUser.`);
    expect(rows.length).toBeGreaterThan(0);
  }, 120_000);
});
