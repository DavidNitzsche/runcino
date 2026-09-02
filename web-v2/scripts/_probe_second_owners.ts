/**
 * SECOND-OWNER-1 / B5 · production probe for the reference runner.
 *
 * Read-only. Run with `bash web-v2/scripts/_ro.sh scripts/_probe_second_owners.ts`,
 * which binds DATABASE_URL to the `faff_readonly` role.
 *
 * Prints, for the owner's own account and today:
 *   · the canonical pace anchors, and what the card surfaces now show
 *   · what the iPhone Today route and the Poster fallback would render
 *   · both VDOT snapshot readers, side by side (B5)
 */
import { resolvePrescribedPaceAnchors } from '@/lib/training/load-prescription-anchors';
import { cardPaceTargets } from '@/lib/training/prescriptions';
import { loadGlanceState } from '@/lib/coach/glance-state';
import { buildPoster, resolveDayState } from '@/lib/faff/glance-adapter';
import { resolveCurrentVdotSnapshot } from '@/lib/training/projection-snapshots';

const UID = '0645f40c-951d-4ccc-b86e-9979cd26c795';
const fmt = (s: number | null | undefined) =>
  s == null ? 'null' : `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')} (${Math.round(s)})`;

(async () => {
  const g = await loadGlanceState(UID);
  console.log('today =', g.today, '· lthr =', g.lthr, '· raceGoalDistanceMi =', g.raceGoalDistanceMi);
  console.log('GlanceState.paceAnchors.ok =', g.paceAnchors.ok);

  const anchors = g.paceAnchors.ok ? g.paceAnchors.anchors : null;
  console.log('--- canonical anchors (resolvePrescribedPaceAnchors) ---');
  if (anchors) {
    console.log('  threshold ', fmt(anchors.thresholdSecPerMi));
    console.log('  interval  ', fmt(anchors.intervalSecPerMi));
    console.log('  repetition', fmt(anchors.repetitionSecPerMi));
    console.log('  marathon  ', fmt(anchors.marathonSecPerMi), 'range', anchors.marathonRangeSecPerMi);
    console.log('  easyCeil  ', fmt(anchors.easyCeilingSecPerMi));
    console.log('  shakeCeil ', fmt(anchors.shakeoutCeilingSecPerMi));
  } else {
    console.log('  REFUSED', JSON.stringify(g.paceAnchors));
  }

  const dp = cardPaceTargets({ lthr: g.lthr, anchors });
  console.log('--- cardPaceTargets (what the card surfaces now read) ---');
  console.log('  thresholdSec      ', fmt(dp.thresholdSec));
  console.log('  tempoSec          ', fmt(dp.tempoSec));
  console.log('  intervalSec       ', fmt(dp.intervalSec));
  console.log('  repSec            ', fmt(dp.repSec));
  console.log('  marathonSec       ', fmt(dp.marathonSec));
  console.log('  easyCeilingSec    ', fmt(dp.easyCeilingSec));
  console.log('  shakeoutCeilingSec', fmt(dp.shakeoutCeilingSec));
  console.log('  aerobicCapBpm     ', dp.aerobicCapBpm);
  console.log('  (no easy band, no long band — refused by design)');

  const poster = buildPoster(g, resolveDayState(g));
  console.log('--- Poster (glance-adapter) ---');
  console.log('  state      ', poster.state);
  console.log('  statTrio   ', JSON.stringify(poster.stat_trio));
  console.log('  breakdown  ', JSON.stringify(poster.workout_breakdown));

  /* THE BRANCH THIS CHANGE ACTUALLY MOVES.
   *
   * Every row on the owner's live plan carries an authored `workout_spec`, so
   * the Poster above renders the spec-driven path and the goal-derived ladder
   * was LATENT for him — the audit says so and this confirms it. The fallback
   * fires for any day whose spec was null'd by a post-authoring mutation.
   *
   * This is his REAL account, his real week, with the one field the mutation
   * would clear set to null. Not a fixture (Rule 13 point 2): every other
   * input — distance, type, LTHR, the resolved anchors — is production. */
  const noSpec = {
    ...g,
    weekDays: g.weekDays.map((d) => (d.isToday ? { ...d, plannedSpec: null } : d)),
  };
  const posterNoSpec = buildPoster(noSpec, resolveDayState(noSpec));
  console.log('--- Poster · SPEC-LESS day (the branch this change moves) ---');
  console.log('  breakdown  ', JSON.stringify(posterNoSpec.workout_breakdown));

  /* ── B5 · the canonical snapshot read ───────────────────────────────────
   *
   * `loadLatestVdotWithAnchor` is not imported here on purpose: it is a
   * delegating shell with no query of its own, so a "side by side" would be
   * comparing the resolver with itself. `_vdot_snapshot_owner.test.ts` is what
   * asserts that, and importing the shell here would (correctly) fail it. */
  console.log('--- B5 · resolveCurrentVdotSnapshot ---');
  console.log('  ', JSON.stringify(await resolveCurrentVdotSnapshot(UID, g.today)));
  process.exit(0);
})();
