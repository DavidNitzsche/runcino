/**
 * lib/verify/ro-credential.ts · which connection string a VERIFICATION process
 * should connect with, as a pure decision over the environment.
 *
 * AUDITRO-1 (2026-09-13), extracted AUDITRO-2 (2026-09-13).
 *
 * ── WHY THIS IS A FUNCTION AND NOT THREE LINES IN `vitest.setup.ts` ─────────
 *
 * It was three lines in `vitest.setup.ts`, and its gate
 * (`_audit_credential_binding.audit.test.ts`) could only assert them in a
 * process that actually had `DATABASE_URL_RO` set. In `test-full` — which has
 * no secrets by design — the gate opened with `if (!process.env
 * .DATABASE_URL_RO) return;` and reported green having asserted nothing, which
 * is the precise shape AUDITRO-1 itself was written about. A rule whose check
 * only runs where the rule is already satisfied is not a check (Rule 20).
 *
 * As a pure function over an environment it is passed, the decision can be
 * exercised for ALL THREE credential shapes in every job, with no credential
 * at all, and the live process is then checked against the same one function
 * rather than against a re-typed copy of its logic (Rule 16).
 *
 * ── THE THREE FACTS (RULE 11) ───────────────────────────────────────────────
 *
 *   keep-explicit   · `DATABASE_URL` is already set. A developer machine's
 *                     `.env.local`, or a harness pointing at a loopback
 *                     scratch database, must always win — this never clobbers.
 *   bind-read-only  · only `DATABASE_URL_RO` is set. This is the CI audit job.
 *                     Every `*.audit.test.ts` gates itself on `DATABASE_URL_RO`
 *                     while `lib/db/pool.ts` connects on `DATABASE_URL`, so
 *                     without this the skip-guard opens, the file runs, and the
 *                     pool falls back to a localhost default.
 *   no-credential   · neither is set. `test-full` by design. Not an error and
 *                     not a binding — the suite is overwhelmingly pure and must
 *                     stay runnable with no database at all.
 *
 * "Configured but unreachable" was a FOURTH state this used to be able to
 * produce silently. It cannot any more: after the setup file applies this
 * decision, asking again must never answer `bind-read-only`, and that is what
 * the gate asserts in every environment.
 */

export type CredentialBinding =
  | { action: 'keep-explicit'; reason: string }
  | { action: 'bind-read-only'; reason: string }
  | { action: 'no-credential'; reason: string };

/**
 * The environment this decision reads. It looks at exactly two keys —
 * `DATABASE_URL` and `DATABASE_URL_RO` — but is typed as a readonly string
 * dictionary rather than an interface naming just those two, for one reason:
 * `NodeJS.ProcessEnv` is not assignable to an all-optional interface with no
 * index signature (TS2559, "no properties in common"), and the whole point of
 * this function is that `vitest.setup.ts` passes it the LIVE `process.env`
 * while the gate passes it synthetic shapes. A cast at either call site would
 * put the two on different types, which is how they drift.
 */
export type CredentialEnv = Readonly<Record<string, string | undefined>>;

export function resolveCredentialBinding(env: CredentialEnv): CredentialBinding {
  if (env.DATABASE_URL) {
    return {
      action: 'keep-explicit',
      reason: 'DATABASE_URL is set explicitly; never clobbered.',
    };
  }
  if (env.DATABASE_URL_RO) {
    return {
      action: 'bind-read-only',
      reason:
        'DATABASE_URL_RO is set and DATABASE_URL is not — bind the read-only ' +
        'credential so lib/db/pool connects to the database the audits skip on.',
    };
  }
  return {
    action: 'no-credential',
    reason: 'Neither DATABASE_URL nor DATABASE_URL_RO is set; nothing to bind.',
  };
}
