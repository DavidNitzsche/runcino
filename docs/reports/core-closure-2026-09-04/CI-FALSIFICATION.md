# CI falsification · `native-check.yml` and `audit-suite.yml`

Both workflows were written on 2026-09-04 and neither had ever been made to
fail. CLAUDE.md Rule 18 names that exactly: *a gate that has never failed is a
hypothesis, not a guarantee.* This is the falsification pass, and the two
workflows are now the state they were falsified in.

Every assertion below was broken on purpose, observed failing for the intended
reason, and restored. The failure text quoted is the text the run actually
printed, not a paraphrase.

**Two real defects were found by doing this, both of which would have gone to
production green.** They are rows B3 and D0.

---

## 0 · Method, and what the method itself cannot catch

The assertion bodies were **extracted verbatim from the YAML** by
`yaml.safe_load` and executed with `bash -e`, which is the shell GitHub Actions
gives a `run:` step. Nothing was retyped, so the harness cannot drift from what
CI runs. `xcodebuild` and `vitest` were replaced by captured log fixtures of
their real output shapes; `scripts/check-watch.sh`'s verdict was produced by
**slicing the real script** (lines 211-222, 447-461, 751-763) and driving it,
rather than by hand-writing a `WATCH-GATE:` line.

The harness caught itself once, which is worth recording. The first slice of
check-watch.sh's guard-3 branch was truncated mid-`elif`, so `bash` refused the
file, the `skip` call never ran, and all three cases reported the assertion
**PASSING**. A harness that reports green because it read nothing is the same
defect it was built to look for. It was found because the baseline and the two
defect cases produced identical output — the tell is always that a gate does not
DISCRIMINATE, not that it is red or green.

**What this pass cannot tell you (Rule 22):**

- It does not prove the workflows run on GitHub. It proves the assertions
  discriminate. A YAML-level mistake — a bad `if:` expression, a runner image
  without `xcbeautify` — is outside its reach, and the first real run on `main`
  is the only thing that settles it.
- It does not prove the iPhone or Watch suites pass. Those were measured by hand
  earlier in this programme (346 and 223); this pass is about whether CI would
  NOTICE if they stopped.
- It cannot exercise the Pillow install step, which mutates the runner. It
  exercises the thing that step exists for: that guard 3 skips without Pillow
  and the job then fails (row D4).
- It says nothing about a physical device. `PHYSICAL-TESTS.md` owns that.

---

## 1 · Falsification table

| # | Assertion | Defect introduced | Observed failure text | Restored |
|---|---|---|---|---|
| **A1** | `native-check.yml` · iPhone test-count floor | Log fixture reading `Executed 0 tests` under `** TEST SUCCEEDED **` — the shape a target that stopped being built prints | `iPhone tests executed: 0 (floor 250)` / `::error title=iPhone suite did not really run::Executed 0 tests, floor is 250.` — exit 1 | yes |
| **A2** | same | Log fixture with **no** `Executed` line at all | `iPhone tests executed: <no summary line in the log> (floor 250)` then the same `::error` — exit 1 | yes |
| **A3** | same, other direction | Healthy 346-test log | `iPhone tests executed: 346 (floor 250)` — exit 0 | n/a |
| **B1** | `native-check.yml` · Watch swift-testing count | Log with only the XCTest `Executed 0 tests` line and no Swift Testing summary | `swift-testing: <none>` / `watch tests executed: <no swift-testing summary line> (floor 150)` / `::error title=Watch suite did not really run::Executed 0 tests, floor is 150.` — exit 1 | yes |
| **B2** | same | Suite shrunk to `Test run with 12 tests in 1 suites` | `watch tests executed: 12 (floor 150)` / `::error … Executed 12 tests, floor is 150.` — exit 1 | yes |
| **B3** | same — **REAL DEFECT FOUND** | The same 12-test log, with xcodebuild's own timestamp prefix: `2026-09-04 09:10:03.552 xcodebuild[4471:88231] ✔ Test run with 12 tests …` | **Before the fix: exit 0, step GREEN.** `head -1` took the first number on the line — `2026` — and compared `2026 >= 150`. After the fix: `watch tests executed: 12 (floor 150)` — exit 1 | defect fixed, not restored |
| **B4** | same, other direction | Healthy 223-case log | `watch tests executed: 223 (floor 150)` — exit 0 | n/a |
| **D0** | `native-check.yml` · `WATCH-GATE: OK` grep — **REAL DEFECT FOUND** | None needed. `check-watch.sh:134` reads `SIM="${WATCH_SIM:-DC794E30-…-05DC44E39A75}"`, a UDID captured on a developer's Mac; the job booted a **runtime-resolved** UDID and never set `WATCH_SIM`. On a hosted runner those cannot be the same device, so guard 3's "is it booted" test is false on every run | The gate would have printed `WATCH-GATE: PARTIAL · … NOT checked: guard 3 board geometry (no booted 46mm simulator)` on **every** run and the step would have been red **forever**, for an environmental reason — the same false-red class the workflow's own signing note is about | defect fixed |
| **D1** | same | Guard 3 skipped: `$SIM` not in the booted list | `watch gate verdict: PARTIAL` / `::error title=Board geometry did not run::WATCH-GATE: PARTIAL · passed what ran; NOT checked: guard 3 board geometry (no booted 46mm simulator)` — exit 1 | yes |
| **D2** | same | Guard 3 skipped by `--fast` | `::error title=Board geometry did not run::WATCH-GATE: PARTIAL · … NOT checked: guard 3 board geometry (--fast)` — exit 1 | yes |
| **D3** | same | A guard found something: `WATCH-GATE: FAIL`, script exit 1 | `watch gate verdict: FAIL` / `::error title=Watch conformance gate failed::WATCH-GATE: FAIL · see the WATCH FAIL lines above` — exit 1 | yes |
| **D4** | same | `WATCH-GATE: UNRUNNABLE`, script exit 3 | `::error title=Watch gate could not run::… no guard executed — xcodebuild is not installed` / `No guard executed at all. That is not a pass.` — exit 1 | yes |
| **D5** | same | Script dies before the verdict (`xcodegen: command not found`, exit 127) — **no `WATCH-GATE:` line at all** | `watch gate verdict: <no WATCH-GATE line at all>` / `::error title=Watch gate printed no verdict::check-watch.sh emitted no 'WATCH-GATE:' line.` — exit 1 | yes |
| **D6** | guard 3's third precondition | `python3` shimmed so `import PIL` fails, **with a genuinely booted simulator** so the boot branch cannot be what fires | `watch · render SKIPPED · python3 has no Pillow` → `WATCH-GATE: PARTIAL · … NOT checked: guard 3 board geometry (no Pillow)` → step exit 1 by D1's branch. This is why the Pillow install step exists | yes |
| **D7** | same, other direction | Booted simulator, nothing skipped | `watch gate verdict: OK` / `all four guards executed, board geometry included.` — exit 0 | n/a |
| **F1** | `native-check.yml` · boot step | Boot a device that does not exist | `Invalid device or device pair: DEADBEEF-…` / `Invalid device: DEADBEEF-…` — **exit 148**. The line this replaced, `xcrun simctl boot "$W" \|\| true`, was run against the same device in the same session: **exit 0, green** | yes |
| **F2** | same, other direction | A genuinely booted device | `Device already booted, nothing to do.` then the independent `simctl list devices booted` confirmation — exit 0 | n/a |
| **E1** | `audit-suite.yml` · missing credential | `DATABASE_URL_RO` empty | `::error title=Production audits did not run::DATABASE_URL_RO is not set.` … `A production audit that did not run is a FAILURE, not a PASS.`; `present=no` recorded; verdict step then prints `AUDIT-SUITE: BLOCKED_MISSING_CREDENTIAL` — exit 1 | yes |
| **E2** | same, other direction | A placeholder non-empty value (no real credential was used anywhere in this pass) | `credential present`, `present=yes` — exit 0 | n/a |
| **E3** | `audit-suite.yml` · "audits actually executed" floor | `Test Files 28 skipped (28)` / `Tests 0 passed \| 419 skipped (419)`, vitest exit 0 — the exact false green the job exists to close | `audit assertions executed: 0 (floor 20)` / `AUDIT-SUITE: FAIL` / `Only 0 audit assertions ran (floor 20). The credential is set but the suite skipped anyway — that is the false green again.` — exit 1 | yes |
| **E4** | same | 26 of 28 files vanish: `Tests 6 passed (6)` | `AUDIT-SUITE: FAIL` / `Only 6 audit assertions ran (floor 20).` — exit 1 | yes |
| **E5** | same | Run step never completed — no `/tmp/audits.rc` | `AUDIT-SUITE: FAIL` / `The audit run did not complete — no exit code was recorded. Treated as a failure, never as a skip.` — exit 1 | yes |
| **E6** | same — **defect in the reason line** | Audits ran and found a real defect: `Tests 9 failed \| 203 passed (212)`, vitest exit 1 | State was correctly `FAIL`, but the sentence read `vitest exited 1. **0** assertions passed before it stopped` — the anchored `Tests +[0-9]+ passed` pattern does not match the `N failed \| M passed` shape. A false sentence about a measurement (Rule 16). Fixed; now reads `203 assertions passed before it stopped` | defect fixed |
| **E7** | `audit-suite.yml` · tri-state contract | Mutant that assigns a **fourth** state (`STATE="PASS"` → `STATE="MOSTLY_PASS"`) on an otherwise healthy 212-assertion run that would have been `PASS` | `::error title=Verdict logic broke::computed state 'MOSTLY_PASS' is not one of the three.` — exit 1, and `$GITHUB_STEP_SUMMARY` was left **empty**: no state was published | yes |
| **E8** | same, other direction | 212 assertions passed, vitest exit 0 | `AUDIT-SUITE: PASS` / `212 production-backed audit assertions ran and passed.` — exit 0 | n/a |

`bash -n` passes on every `run:` block in both files; both parse under
`yaml.safe_load`.

---

## 2 · The two real defects, in full

### B3 · the watch count assertion green-lit a 12-test run

```
N=$(echo "$LINE" | grep -oE '[0-9]+' | head -1)
```

`head -1` takes the first number **on the line**, not the first number in
`Test run with N tests`. `xcodebuild` prefixes its own output with a timestamp
and a pid, so against

```
2026-09-04 09:10:03.552 xcodebuild[4471:88231] ✔ Test run with 12 tests in 1 suites passed after 2.1 seconds.
```

it read `2026`, compared `2026 >= 150`, and passed a watch suite that had
collapsed from 223 cases to 12. A liveness guard whose whole job is to separate
"223 ran" from "0 ran" would have certified a 95% collapse as healthy.

The number is now anchored to the phrase:

```
N=$(printf '%s' "$LINE" | grep -oE 'Test run with [0-9]+' | grep -oE '[0-9]+' || true)
```

This is Rule 18's "read the number out of the source at run time" applied to a
log: the count must come from the same token that names it.

### D0 · the conformance gate could never have printed OK on a hosted runner

`scripts/check-watch.sh:134`:

```bash
SIM="${WATCH_SIM:-DC794E30-23E7-475B-AECD-05DC44E39A75}"
```

That UDID is a specific simulator on a specific developer Mac. The job resolved
its own watch UDID at runtime (correctly — a hard-coded destination is the false
red the workflow header warns about), booted **that** device, and then invoked
`check-watch.sh` without telling it which device had been booted. Guard 3's
`simctl list devices booted | grep -q "$SIM"` would have been false on every
hosted run, the gate would have returned `PARTIAL`, and `grep -q 'WATCH-GATE:
OK'` would have been red permanently.

Two more preconditions were unmet in the same step, each independently enough
to force `PARTIAL`:

- **Pillow.** Guard 3 measures rendered boards with `PIL`. The macOS runner
  image does not carry it and nothing installed it (row D6).
- **The boot itself.** `xcrun simctl boot "$W" || true` followed by `sleep 20`
  swallowed a boot failure outright. Row F1 shows the same nonexistent device
  producing exit 0 under the old line and exit 148 under the new one.

Fixed by supplying all three preconditions and then reading the verdict WORD
rather than grepping for one string:

- `WATCH_SIM` is exported to the resolved UDID — the override the script already
  documents, so no change to `check-watch.sh` was needed.
- Pillow is installed and its version printed.
- The boot uses `simctl bootstatus -b` (which blocks and reports failure) and
  then **independently** re-confirms the device is in the booted list, because
  trusting one command's exit code about its own success is how `|| true` got
  there in the first place.
- The gate step now branches on `OK` / `PARTIAL` / `FAIL` / `UNRUNNABLE` /
  no-verdict-line, with a distinct message each. `PARTIAL` is a failure and says
  so in those words: *"PARTIAL means a guard was SKIPPED, not that it passed."*

**Board geometry can no longer silently skip.** If the simulator does not boot,
the job fails at the boot step. If it boots and guard 3 skips anyway, the job
fails at the gate step and names which precondition went missing.

---

## 3 · The tri-state in `audit-suite.yml`

The job now ends printing exactly one of three words, on stdout and in
`$GITHUB_STEP_SUMMARY`:

```
PASS                        the audits ran against production and every assertion held
FAIL                        the audits ran and something is wrong
BLOCKED_MISSING_CREDENTIAL  the audits did NOT run
```

Rule 11 is the reason. "It passed", "it failed" and "it never ran" are three
facts; the job had two words for them, and the missing third is precisely the
state that let 28 production audits skip silently while three of them were red
against production for a full day.

Structure, and why it is two steps:

- **`Is the credential present`** classifies and records `present=yes|no`. It
  **does not exit non-zero.** A first step that fails skips every later step —
  including the one that writes the summary — and a job whose only signal is a
  red X cannot distinguish a found defect from an absent credential. It reads
  emptiness only; the value is never echoed, never written to a step output,
  never put in the summary.
- **`Verdict`** runs `if: always()` and owns the decision, the liveness floor
  included. One place decides, per Rule 16.

`BLOCKED_MISSING_CREDENTIAL` exits non-zero. **It is never green-by-skip** —
that is the whole point, and row E1 is the evidence.

The verdict guards itself (row E7): a computed state that is not one of the
three literals aborts before anything is published. That branch is unreachable
by construction, which is exactly why it is there — the construction is what a
later edit changes.

---

## 4 · Setting up the `DATABASE_URL_RO` secret

The workflow runs with **no code changes** once this secret exists. Until then
it reports `BLOCKED_MISSING_CREDENTIAL` on every run, by design.

### The secret

| | |
|---|---|
| **Name** | `DATABASE_URL_RO` — exact, case-sensitive |
| **Kind** | Repository secret (Actions), not an environment or organization secret |
| **Value** | The read-only Postgres connection string `web-v2/.env.local` already carries under that same name |

### Click-path

1. Open the repository on GitHub.
2. **Settings** (repo-level tab, not your account settings).
3. Left sidebar → **Secrets and variables** → **Actions**.
4. **Repository secrets** tab → **New repository secret**.
5. **Name:** `DATABASE_URL_RO`
6. **Secret:** paste the connection string.
7. **Add secret**.
8. Confirm it worked by re-running the `audit-suite` workflow (**Actions** →
   **audit-suite** → **Run workflow**). The job summary should read
   `## audit-suite: PASS`. If it still says `BLOCKED_MISSING_CREDENTIAL`, the
   name is misspelled or it was added as an environment secret.

**Do not paste the value into a commit, an issue, a PR description, a chat
message, or a log.** GitHub masks a registered secret in workflow logs; nothing
masks it anywhere else. The workflow itself never echoes it — it reads only
whether the variable is empty.

### Minimum permissions

It is the existing **`faff_readonly`** role. Nothing new needs creating and no
grant needs widening.

- `CONNECT` on the database, `USAGE` on the schema.
- `SELECT` on the tables the audits read — in practice the runner-facing set:
  `runs`, `training_plans`, `plan_workouts`, `races`, `users`, `user_settings`,
  `coach_intents`, `day_actions`, `subjective_checkins`.
- **No `INSERT`, `UPDATE`, `DELETE`, `TRUNCATE`, and no DDL.** No superuser, no
  ownership, no `CREATE`.

### The second safety layer

`web-v2/lib/verify/production-barrier.ts` is independent of the grant, and
either layer alone stops a write:

- **Who is fenced** — `classifyProcess()` identifies a verification process
  structurally, from signals the runner itself sets (`VITEST`,
  `VITEST_WORKER_ID`, `NODE_ENV=test`, an argv naming vitest). Every
  `*.audit.test.ts` in this job runs under vitest, so every one is fenced.
  **There is deliberately no way to opt out** — removing it is a source edit,
  and `_production_write_barrier.test.ts` fails when it is removed.
- **What is fenced** — `classifyStatement()` is an **allow-list**: a statement
  is permitted only if it is recognisably a read (`SELECT`, `WITH` without DML,
  `SHOW`, `EXPLAIN`, transaction control, `SET`, `DISCARD`). Anything else,
  including anything unparseable, is refused. A deny-list of
  `INSERT|UPDATE|DELETE` is exactly the check a `WITH x AS (…) INSERT` slips
  past.
- **Where it is pointed** — `classifyDatabaseTarget()` judges each statement
  against the **connection it was issued on**, not against
  `process.env.DATABASE_URL`, and returns three outcomes: production, local, and
  indeterminate. Indeterminate refuses. No environment variable can mark a
  remote database writable from a verification process.
- **How it refuses** — loudly: `[write-barrier] REFUSED` on stderr, a counted
  ledger, and a thrown `ProductionWriteRefused`. Never a silent no-op.

So the credential is read-only at the role and refused at the process, and
neither depends on the other being configured correctly.

**What the barrier does not cover**, stated because a security claim with an
unstated boundary is worse than none: it cannot stop a process that never loads
it (a standalone `scripts/*.mjs` run as plain `node`), a write issued through a
channel that is not this process's `pg`, or an HTTP call to the live app —
`lib/verify/client-attestation.ts` is the sibling that covers the last of those.
None of those channels exist in this job, which runs vitest and nothing else.

---

## 5 · Reproducing this

The harness lives in the session scratchpad and is deliberately not committed —
it exists to be rebuilt from this document, not to become a second thing that
can rot. To rebuild it: load each workflow with `yaml.safe_load`, write each
step's `run:` body to a file, and execute it with `bash -e` against the log
fixtures quoted in §1. If a defect row does not reproduce, the assertion has
changed and this document is stale — which is the intended failure mode.
