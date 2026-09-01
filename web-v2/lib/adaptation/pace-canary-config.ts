/**
 * lib/adaptation/pace-canary-config.ts · THE PACE CANARY'S GATES.
 *
 * Owner-only PACE canary pathway, per the external-review spec answering
 * `docs/reports/adaptation-authority-policy-brief-2026-09-01.md`. This file
 * is deliberately the ONLY place that reads the environment for this
 * mechanism — every gate check in `pace-canary.ts` goes through
 * `resolvePaceCanaryGate`, never a scattered `process.env` read, so a future
 * audit has one place to look and one place to change.
 *
 * ── THE CONVENTION THIS FOLLOWS ─────────────────────────────────────────
 *
 * This repo has no `feature_flags` table or config service (confirmed by
 * grep before writing this file). Its existing pattern for a boolean
 * operational toggle is `process.env.X === '1'` / `=== 'true'`, read INSIDE
 * the function body rather than hoisted to a module-level constant --
 * `lib/ops/alerts.ts`'s `OPS_ALERTS_DISABLED`, `lib/auth/rate-limit.ts`'s
 * `ALLOW_OPEN_SIGNUP`. This file follows that convention exactly rather than
 * inventing a new mechanism, per the task's own instruction to prefer the
 * existing pattern.
 *
 * ── THREE INDEPENDENT GATES, ALL OFF/EMPTY BY DEFAULT ───────────────────
 *
 *   1. `PACE_CANARY_ENABLED` -- unset (falsy) by default. Must be exactly
 *      '1' to enable anything.
 *   2. `PACE_CANARY_ALLOWLIST` -- unset (empty) by default. A comma-
 *      separated list of user_uuids. Even with the flag on, a user not on
 *      this list is never eligible. The owner's account
 *      (0645f40c-951d-4ccc-b86e-9979cd26c795) is NOT pre-populated here --
 *      adding it is a deliberate, separate action, per the task's explicit
 *      instruction not to add it as part of building this infrastructure.
 *   3. `PACE_CANARY_KILL` -- an ALWAYS-WINS override. If set to '1', the
 *      canary is disabled regardless of (1) and (2). This is the fastest
 *      path to "stop this right now" -- one env var, checked first, no
 *      allowlist parsing, no DB read.
 *
 * A FOURTH, structural gate lives outside this file: `pace-canary.ts`
 * refuses to write at all while `pace_canary_applications`
 * (`db/migrations/161_pace_canary_applications.sql`) does not exist --
 * see that migration's header. That table is drafted, not applied, so this
 * gate is also closed today, independent of anything in this file.
 *
 * ── WHY THIS SATISFIES "FLIPPABLE WITHOUT A CODE DEPLOYMENT" ────────────
 *
 * Every function here reads `process.env` fresh, at call time -- nothing is
 * cached at module scope and nothing is inlined by the Next.js build (these
 * are plain server-only vars, not `NEXT_PUBLIC_*`, so webpack never bakes
 * them into a bundle). On Railway, updating an env var and restarting the
 * service is an infrastructure action, not a `git push` / `next build` --
 * it does not go through the CI/deploy pipeline Rule 19 is about. That is
 * the honest claim this file makes, and `_pace_canary.test.ts` verifies it
 * mechanically: it mutates `process.env` inside a single process and
 * observes the gate flip with no re-import, no rebuild.
 */

/** The owner's uuid, named here ONLY as a reference constant for tests and
 *  for whoever eventually performs the separate, deliberate act of
 *  allowlisting him -- NEVER read from this file's own logic, and NEVER
 *  added to `PACE_CANARY_ALLOWLIST` automatically. */
export const PACE_CANARY_OWNER_UUID_REFERENCE = '0645f40c-951d-4ccc-b86e-9979cd26c795';

export interface PaceCanaryGate {
  /** True only when PACE_CANARY_ENABLED='1' AND PACE_CANARY_KILL is not '1'. */
  enabled: boolean;
  /** True only when `userUuid` (case-insensitive, trimmed) appears in
   *  PACE_CANARY_ALLOWLIST. Independent of `enabled` -- both must be true. */
  allowlisted: boolean;
  /** True when PACE_CANARY_KILL='1' fired -- surfaced separately from
   *  `enabled` so a caller/log can say WHICH gate closed the door, per
   *  Rule 11 (a flag that is off because nobody turned it on and a flag
   *  that is off because the kill switch fired are different facts). */
  killed: boolean;
  detail: string;
}

function parseAllowlist(raw: string | undefined): Set<string> {
  if (!raw) return new Set();
  return new Set(
    raw.split(',').map((s) => s.trim().toLowerCase()).filter((s) => s.length > 0),
  );
}

/**
 * Resolve the gate for one user, reading the environment fresh. Synchronous
 * and side-effect-free -- no DB, no cache -- so it is cheap enough to call
 * before ANY other work in the canary's entry point, and safe to call in a
 * tight loop without rate-limiting itself.
 */
export function resolvePaceCanaryGate(userUuid: string): PaceCanaryGate {
  const killed = process.env.PACE_CANARY_KILL === '1';
  if (killed) {
    return { enabled: false, allowlisted: false, killed: true, detail: 'PACE_CANARY_KILL=1' };
  }

  const enabled = process.env.PACE_CANARY_ENABLED === '1';
  const allowlist = parseAllowlist(process.env.PACE_CANARY_ALLOWLIST);
  const allowlisted = allowlist.has(userUuid.trim().toLowerCase());

  return {
    enabled,
    allowlisted,
    killed: false,
    detail: enabled
      ? (allowlisted
          ? 'PACE_CANARY_ENABLED=1 and user is allowlisted'
          : 'PACE_CANARY_ENABLED=1 but user is not in PACE_CANARY_ALLOWLIST')
      : 'PACE_CANARY_ENABLED is not \'1\' (default: disabled)',
  };
}

/** Convenience for a caller that just wants the yes/no, e.g. the cron route's
 *  cheap pre-check before it bothers importing the rest of the pipeline. */
export function paceCanaryMayRunFor(userUuid: string): boolean {
  const gate = resolvePaceCanaryGate(userUuid);
  return gate.enabled && gate.allowlisted;
}
