# BRAIN v2.1.1 — Controlled Errata

**Scope: three corrections to `docs/audit-2026-09-10-brain-adaptation-forensic-audit-v2.1-FINAL.md` ("Brain v2.1"). Everything else in that document stands unchanged and is not reproduced here.** This is a patch, not a rewrite — read it alongside Brain v2.1, not in place of it. No new investigation was performed for items 1 or 3; item 2 is a presentation/framing correction of data this track already held. No code changes, migrations, or production writes.

---

## 1. C-race frequency-cap conclusion — SUPERSEDED

Brain v2.1 §11.4 stated: *"No such [frequency-cap copy] branch exists at the pinned commit... Mark this claim wrong."* **This is superseded.** Coach v2.1 executed current `origin/main` directly and located the real branch, which both changes the schedule and assigns:

```
victim.notes = 'Off. Race week for a tune-up · rest is the work now.';
```

This output survives through `finalizeComposedPlan` into the live plan-notes path — it is not a dead or unreachable code path.

**Execution results, as reported:**
- Standard shape (`qualityDows:[2,4]`, `frequency:3-7`): **0/140 hits** — never fires under ordinary plan configuration.
- Edge shape (`qualityDows:[]`, `frequency:2-3`): **18/56 hits, all C-priority** — fires reliably under this narrow, less-common configuration.

**Corrected framing, precise:**
- Normal C-race plan treatment (the scheduling behavior itself: pure cutback, no taper, doctrine-cited) **remains correct** — this was never in dispute and stands exactly as found in earlier passes.
- The frequency-cap **notes** defect is real and live, but **narrowly scoped**: it only fires under the edge condition above (empty `qualityDows` + a 2-3 day weekly frequency), not under standard plan shapes.
- **Not a current TestFlight blocker** — it produces a plan note under a narrow, less-common configuration; it does not corrupt scheduling.
- **Has no permanent regression coverage** — nothing currently guards against this recurring or worsening.
- The distinction that must not collapse: **normal Plan-generator scheduling semantics for a C-race are correct; a separate, narrow-edge-case defect exists in what NOTE text gets attached under specific configurations.** These are two different facts about two different code paths, not one finding.

This corrects Brain v2.1 §11.4 and its corresponding severity-table entry ("Tune-up race frequency-cap copy branch — Removed, does not exist"). That row should now read: **P3 — real, narrow-edge-case notes defect, confirmed by direct execution, no regression coverage, not release-blocking.**

---

## 2. Historical mutation table — corrected

Brain v2.1 §3, row 1, is corrected as follows:

- **Row 1's applied-event date is 2026-05-24 08:24:22 only.** The earlier "2026-05-21 / 05-24" dual-date note is removed — 05-21/05-22 belong only to the 8 separate, non-applied `seen`-status rows from the same mechanism, not to this applied row. They remain relevant background (cited once, below) but do not belong in row 1's own date field.
- **Exact transitions restored** (previously abbreviated to just the after-value):
  - Row 1: `original_distance_mi=11` → proposed `12.1` → **stored `12.0`** (workout `946dad0c...`).
  - Row 2: `original_distance_mi=4.5` → proposed `4.9` → **stored `5.0`** (workout `ec7ae0eb...`).

**Corrected count and framing.** The table is **6 confirmed applied events plus 1 disputed historical assertion** — not an undifferentiated "7 events":
- **6 confirmed applied**: the 2 `positive-drift` rows above; the 2026-06-02 volume rebuild; the 2026-08-25 duration-up rebuild; the 2026-08-26 duration-down rebuild; the 2026-09-03 `silent_rebuild`.
- **1 disputed historical assertion**: the 2026-09-02 "76 workouts" re-anchor — its mechanism CLASS is real and independently corroborated as closed 2026-09-05, but the specific scope (76 workouts, that date) is not verifiable from the current schema and must continue to be cited as disputed, not confirmed.

**Mechanism-class count, corrected and made explicit.** Brain v2.1's summary line ("7 named rows across 5 distinct mechanisms") was internally inconsistent with its own grouped table structure. **Stated convention, used consistently here: `drift_cron_auto`'s three fired sub-kinds (`volume_drift`, `long_drift`, `easy_drift`) are counted as ONE mechanism class with three fired instances**, matching how the table itself groups them (one retired cron, one retirement date, one shared audit-trail gap). Under this convention: **4 mechanism classes** — `positive-drift`; `drift_cron_auto` (3 fired instances); the disputed re-anchor; `silent_rebuild`. (If a reader prefers to count the three `drift_cron_auto` sub-kinds separately, the total is 6 mechanism classes — either convention is defensible, but only one should be used at a time, and this document uses the 4-class/grouped convention throughout.)

**P0 renamed.** Brain v2.1's "`coach_intents` gap for automatic upward events" is corrected to **"`coach_intents` gap for automatic plan mutations"** (dropping "upward" specifically), because the pattern it names now includes the 2026-08-26 event, which is a **downward** mutation. The finding is about `coach_intents` failing to record automatic plan mutations regardless of direction — not specifically upward ones. Severity (P0) and scope (now 3 confirmed `drift_cron_auto` instances, plus `positive-drift`'s separate zero-trace history) are unchanged.

---

## 3. Provenance — Brain v2.1's final identifiers, recorded

Brain v2.1 (`docs/audit-2026-09-10-brain-adaptation-forensic-audit-v2.1-FINAL.md`) left its own commit/hash fields as placeholders, to be filled in after that commit landed. They are recorded here rather than by editing that already-committed file (amending a landed commit is avoided per this track's own standing discipline):

| Field | Value | Type |
|---|---|---|
| Brain v2.1's final commit | `506e518d65c17820ac5dc102ab71a94b015feffe` | git commit SHA |
| Brain v2.1 report file hash | `9a4e3498cb6ea9e96614205be12f0490ec12aa7a` | **git-object hash** (`git hash-object`, SHA-1 — a git blob identifier, not a cryptographic file-content hash) |
| Brain v2.1 delta-log file hash | `4953becfe61432824d54bbefca96c47187376abd` | **git-object hash** (`git hash-object`, SHA-1) |

Git-object hashes are distinct from and not a substitute for SHA-256 content hashes — this document's own final SHA-256 hashes are reported separately, below, after this file's content and commit are both finalized.

---

*End of errata. Everything in Brain v2.1 not named above stands exactly as written there.*
