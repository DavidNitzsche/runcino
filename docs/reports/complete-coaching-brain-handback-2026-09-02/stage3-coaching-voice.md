# Stage 3 handback · the coaching explanation contract

Branch `stage3/coaching-voice` · NOT merged · base `ae238b98` · head `bd5c22bb`

Two commits: `0d4f3498` (the work), `bd5c22bb` (a liveness floor set from a
measured count instead of the edge).

---

## 0 · PASS / FAIL / PARTIAL, per the brief's §11 opener

| Surface | Verdict | On what evidence |
|---|---|---|
| Today (before run) | **PASS** | The Layer-1 "why" no longer carries engine taxonomy. Verified through the REAL `/api/v5/today` handler against the owner's account, read-only, on 7 consecutive days. Before/after strings in §7. |
| Today (after run) | **PARTIAL** | Its strings are scanned clean by the live audit (2026-09-01, a completed threshold day). Its composers (`run-recap`, `run-win`) are NOT on the explanation contract and still author their own verdicts. |
| Run Detail | **FAIL (untouched)** | Consumes `/api/runs/[id]` and `/api/runs/[id]/recap`, both outside `app/api/v5` and therefore outside this branch's file boundary. Not migrated, not scanned live. |
| Plan / Block | **PARTIAL** | The coaching thesis reaches "Where this goes" — confirmed on screen by the coordinator, not by me. Block's own `coachLine` is still authored in `lib/plan/v5-block.ts`, outside this boundary. |
| Progress / Races | **PARTIAL** | The design's own preview samples modelled `VDOT`-leaking copy and were rewritten; the real backend never emitted VDOT there (grep-verified, §8). Race outlook is not on the contract. |
| Decisions / refusals | **PARTIAL** | The contract expresses the distinction (`intent: REFUSE` + `certainty: UNKNOWN`, and a refusal may not carry an action — both gated). No live decision card consumes it. |
| Notifications | **FAIL (untouched)** | `lib/notifications/templates.ts` is in the shell gate's scope and clean; nothing is on the contract. |
| Watch | **FAIL (untouched)** | `lib/watch/**` is outside this branch's boundary. No cross-surface version check exists. |
| Spoken guidance | **N/A this stage** | The contract's `spoken` block is defined and audited (length, language) but has no producer. Deliberately made OPTIONAL rather than fabricated — see §4. |
| Accessibility | **PARTIAL** | `accessibilitySummary` is required by the contract and audited for prohibited language, and the corpus asserts modelled values are spoken as "estimated". No VoiceOver capture was taken. |
| Uncertainty semantics | **PASS for the contract, PARTIAL for the app** | `certaintyHedge` is the single source of a hedge; `UNKNOWN` with a non-REFUSE intent is a gate failure. Only Today's `why` supplies a real certainty. |

---

## 1 · SHAs

- Starting: `ae238b98` (Stage 2 merge).
- Ending: `bd5c22bb`, pushed to `origin/stage3/coaching-voice`.
- **Deployed: none.** This branch is not merged and `main` has not moved for it.
  The pre-push hook ran `next build` and reported `✓ next build green`, which
  is evidence about the build and not about production (Rule 19).

---

## 2 · Previous voice-composer map

Surveyed before changing anything. What actually reaches the runner:

**The live v5 phone shell has three tabs** — `today`, `block`, `races`
(`FaffApp.swift:277`). It consumes `/api/v5/today`, `/api/v5/block`,
`/api/v5/races`, `/api/v5/race/{slug}`, `/api/runs/{id}`,
`/api/runs/{id}/recap`.

**It does NOT consume `/api/briefing`, `/api/today/purpose` or
`/api/readiness/brief`.** Those reach `TodayView.swift`,
`MorningBriefBlock.swift`, `TodayPreRunBodyV3.swift` and `HealthView.swift`,
which are the v4 shell, reachable only under `-faffLegacy`.

**This makes three of the brief's P1 findings partly stale**, and it is worth
saying plainly rather than implementing around: "Remove raw readiness scores
from Layer 1 morning brief", "Replace the system is firing", and the
session-cue scolding all live on composers the shipping iPhone does not
render. They are still real defects — they reach the paused web frontend, the
legacy shell, and any future consumer — and I fixed them. But nobody's phone
was showing "readiness 83 · the system is firing" this week.

Prose mass, measured: `run-recap.ts` ~100 templates, `readiness-brief.ts` ~70,
`health-actions.ts` ~60, `run-win.ts` ~42, `checkin-reply-canned.ts` ~35.
`/api/v5/today` is the single widest confluence — it pulls `run-purpose`,
`run-recap`, `run-win`, `recap-voice`, `why-voice`, `fitness-read` and
`v5-today` into one payload.

---

## 3 · Final canonical ownership map

| Question | Owner after this stage |
|---|---|
| Which words may a coach never say | `web-v2/lib/faff/coach-lexicon.ts` — **one list**, where there were four |
| What shape does a coaching message have | `web-v2/lib/faff/explanation.ts` |
| What does Today's "why" SAY | `web-v2/lib/faff/why-voice.ts#explainWhy` — the register |
| WHICH capacity is limiting | `lib/training/coaching-thesis.ts` — the claim, unchanged |
| Does a sentence break the voice | `auditExplanation` (runtime) + `check-coach-voice.sh` (literals) |

**The word list had four homes and they disagreed.** Audited before writing
anything: `check-coach-voice.sh`'s inline awk lists (the only build-blocking
one, 35 hype + 13 scolding + 12 app-voice), `scripts/voice-eval/run.mjs`'s
10-entry `BANNED_PHRASES` (unwired), `web-v2/scripts/voice-eval/
scenarios.json`'s per-scenario arrays (unwired, its own README calls it
"smoke-grade"), and private copies inside `_training_lead.test.ts`,
`goal-status.test.ts` and `glance-adapter.test.ts`. **None of the four
contained "bail", "cook the back half", "don't get fancy", "bury yourself" or
"junk mile"**, all of which were live in shipped copy that morning.

`check-coach-voice.sh` now PARSES `coach-lexicon.ts` at build time and builds
its awk lists from it. Rule 18: read the list out of the source rather than
hardcode both sides.

---

## 4 · The typed contract, and where it deviates from the brief

`web-v2/lib/faff/explanation.ts`, `EXPLANATION_MODEL_VERSION = 'expl-1'`.
Shape as §3 specifies: `intent`, `certainty`, `verdict`/`reason`/
`consequence`/`action`, typed `facts`, `whyNot`, `accessibilitySummary`,
`detail`, plus `id` / `modelVersion` / `decisionVersion`.

**One deviation, argued in the code: `spoken` is OPTIONAL.** The brief has it
required. The first consumer is Today's "About" block, which is read on a
screen and never spoken, and its sentence is routinely longer than a wrist cue
may be. The three available answers were fabricate a cue, truncate one (which
changes meaning silently), or say there is not one. Absent is honest and is
distinguishable from empty — Rule 11 applied to the contract itself.

**`decisionVersion` is real, not decorative.** Assembled in the route from the
identities of the decisions the sentence explains:

```
plan:<activePlanId>|day:<dateISO>|thesis:<thesisModelVersion>@<resolvedAt>
```

`thesis:no-thesis` is a value, not a placeholder — a day the thesis does not
speak on IS a different decision from one it does.

### It is WIRED, and that was forced on me by a gate, correctly

`composeWhy` is now a thin renderer over `explainWhy` + `layerOne`. That was
not the first draft. The first draft had the contract sitting beside the
composer with only tests using it, and `check-generated-content.sh` GUARD 5
failed the prebuild:

```
MODULES NOTHING IMPORTS:
  web-v2/lib/faff/coach-lexicon.ts  [dead-root]
  web-v2/lib/faff/explanation.ts  [test-only]

This is the lib/plan/block-preview.ts shape: a module built to answer
something, with a test proving it answers it, and no caller.
```

That gate was right and it is the Rule 21 failure this repo is named for. The
fix was to wire it, not to add an exemption. The rendered string is
byte-identical after the refactor — re-verified on the same seven live days.

**No app release is needed.** The change is a STRING into a wire field the app
already renders (`V5Today.why` → `TodayBeforeV5.swift:549`, under "About").
The distinction that cost two earlier reports their conclusion: a string into
an existing field ships with the server; a new structured field does not.

---

## 5 · Migrated consumers

**One.** Today's "why", `/api/v5/today` → `V5Today.why`.

Stated plainly because the alternative is the exact failure mode this brief
exists to fix: Run Detail, Watch, notifications, decision cards and the race
outlook still author their own prose. Three of those five are outside this
branch's file boundary.

## 6 · Removed duplicate / static composers

**None removed.** `derivePurpose`'s static family text is still the floor when
nothing better exists — it is now reached only as `fallback`, behind the plan
row's own note and the thesis's session name, and the explanation carries
`certainty: 'TENTATIVE'` when no thesis spoke. The brief asks for family copy
to be "an explicit low-confidence fallback"; that is now true structurally,
but it is not LABELLED as such to the runner. Open.

`thesisLeadClause` in `lib/training/coaching-thesis.ts` now has **zero
callers**. I did not delete it: `lib/training/**` is outside this branch's
boundary. **Flagged for whoever owns that file.**

---

## 7 · Before / after, every string changed

### The one that was on the runner's screen

Measured through the real route handler, real account, read-only role,
2026-09-02:

```
BEFORE  "Durability is the limiter right now, and this is the session that
         moves it. Keep it conversational throughout."          (2026-09-06)
        "Durability is the limiter right now, so that is what the block is
         building toward. Medium hill repeats."                 (2026-09-03)
        "Durability is the limiter right now, so that is what the block is
         building toward. Continuous tempo."                    (2026-09-08)

AFTER   "Holding your pace late in a race is the thing to move right now, and
         this is the session that does it. Keep it conversational throughout."
        "Holding your pace late in a race is the thing to move right now, so
         that is what the block is building toward. Medium hill repeats."
        "Holding your pace late in a race is the thing to move right now, so
         that is what the block is building toward. Continuous tempo."
```

"Limiter" is Layer-3 taxonomy in a Layer-1 sentence.
`PRODUCT_UX_SIMPLIFICATION_DOCTRINE.md` forbids it outright and the brief's §4
lists "Coaching Thesis taxonomy" by name.

**Two reasons nothing caught it, and both are CLAUDE.md rules.**
`check-coach-voice.sh` scans string literals, and this sentence is assembled at
run time from fragments that are each clean — its own header names that as its
blind spot. And `_today_thesis.audit.test.ts` **asserted** it:
`expect(body.why.toLowerCase()).toContain('limiter')`. A gate was REQUIRING
the defect, because the same reasoning wrote the test and the code (Rule 22).
That assertion is now inverted, with the history in the comment.

### The rest

| File | Before | After |
|---|---|---|
| `session-cue.ts` | "Bail if it feels off." | "Stop the session if it feels off." |
| | "Drift early and you cook the back half." | "Drift early and the last reps pay for it." |
| | "Bail if form breaks before the count." | "End the rep if form breaks before the set does." |
| | "Rep one sets the ceiling · hit the count." | "Rep one sets the ceiling, so open conservative." |
| `run-purpose.ts` | "…for the hard stuff coming up · don't get fancy." | "…for the hard work coming up." |
| | "Better to nail it than try too hard and bury yourself." | "Controlled beats fast here." |
| | "The variety is the workout. Don't overthink it." | "The variety is the workout. There is no split to hit." |
| | "You don't need a junk mile to feel productive. Resting IS the work today." | "Resting is the work today. The adaptation happens now, not on the run." |
| `morning-brief.ts` | "readiness 91 · the system is firing" | "you are well recovered" |
| | "readiness 83 · solid" | "recovery looks normal" |
| | "readiness 61 · keep the easy parts genuinely easy" | "keep the easy parts genuinely easy" |
| | "readiness 44 · low, so listen on the way · the plan stands" | "recovery is down, so listen on the way · the plan stands" |
| | "8.1 mi tempo went in the book yesterday." | "You ran 8.1 mi yesterday, a tempo." |
| | "Tune-up today · sharp, not heroic." | "Tune-up today · short and sharp, nothing to prove." |
| `readiness-brief.ts` | "Send it. Plan as scheduled." / "SHARP band · system is firing · don't hold back." | "Run the session as prescribed." / "Recovery is good · take the targets as written." |
| | "Sharp · The system is firing." | "Sharp · You are well recovered." |
| | "Big week recently · sweet spot is 1.0-1.3" | "This week ran well above your recent normal" |
| | "Long layoff before this week · low chronic28" | "A long layoff sits behind this week, so the baseline is thin" |
| | "Race week · taper drops ACWR by design" | "Race week · the taper is meant to drop the load" |
| `acknowledge.ts` | "Yesterday went in the book clean." | "Yesterday came out clean." |
| `coach-log.ts` | "A zero week went in the book." | "No miles this week." |
| `run-recap.ts` | "that's execution, not surrender" | removed; the sentence states what happened |
| | "smart, not a fail" | removed; same reason |
| | "the bail line tripped and you pushed through" | "…and you kept going" |
| `glance-adapter.ts` | "Bail if grade jumps to 5" | "Stop the run if grade jumps to 5" |
| `RacesV5.swift` | "VDOT reads at 51.2 against a goal that only needed 49.8" (preview sample) | "your current read projects about three minutes faster than Sub 3:30" |
| | "VDOT 47.9" / "VDOT 46.2" / "VDOT 43.8" | "1:36 half equivalent" / "40:30 10k equivalent" / "3:44 marathon equivalent" |

**BAIL survives in exactly one place** — `run-recap.ts`'s taken-bail line —
because it is the literal label on the race control the runner pressed, which
is the one exemption the brief grants it. The lexicon term is `"bail if"`,
chosen narrowly so it misses `"You took the bail"`.

Six tests pinned the old copy and were updated with the reason inline. One of
them is itself a Rule 22 exhibit: `run-purpose.test.ts` asserted
`/recovering for the hard stuff|don't get fancy/` — **the scold satisfied half
the assertion**, so a version of the code that only ever scolded would have
passed a test named "emphasizes recovery".

---

## 8 · Cross-surface consistency matrix

| Claim | Today | Block | Watch | Notifications |
|---|---|---|---|---|
| Which capacity is limiting | `thesis.primaryLimiter`, rendered in runner language by `why-voice` | `thesis.coachLine`, verbatim from the resolver | — | — |
| Explanation version | `plan|day|thesis@resolvedAt` | not carried | not carried | not carried |
| Prohibited language | audited at runtime + literals | literals only | literals only | literals only |

**The version check the brief asks for cannot be performed yet**, because only
one surface carries a version. That is the honest state; a matrix of one row
is not a matrix.

One thing verified and worth recording: the real `/api/v5/races` and
`/api/v5/race/[slug]` routes **never emit VDOT in runner copy** — every hit in
those files is a code comment. The eight VDOT strings the new jargon guard
found in `RacesV5.swift` were all inside `RacesV5Sample`, the preview fixture
set. They are not on anyone's screen. I rewrote them anyway, because they are
the design's own model of what that sentence should say and the next person to
implement it would have copied them.

---

## 9 · Accessibility

- `accessibilitySummary` is required on every explanation and is scanned for
  prohibited language and punctuation by `auditExplanation`.
- The corpus asserts every `MODELLED` fact renders with a modelled mark — the
  `~` glyph or the word "estimate"/"modelled" — so VoiceOver reads the meaning
  rather than the punctuation (brief §8).
- The corpus asserts a decision button names its consequence, not `OK`/`Done`.
- **No VoiceOver output was captured.** Not done, not claimed.

---

## 10 · Golden corpus and prohibited-language results

`web-v2/lib/faff/_voice_corpus.test.ts` — 18 fixtures covering the brief's §5
state matrix plus the data-quality states §7 names (outage, treadmill, taper,
missing data). **35 assertions, all passing.**

It asserts, per §7: verdict leads; Layer 1 is at most two sentences; no
prohibited language in any runner-readable field; fact/model/goal grammar
stays distinct and nothing turns an estimate into "your new goal"; the hedge
matches the certainty; a refusal carries no action and a decision request
does; every certainty and every intent is exercised.

**And it asserts its own balance (Rule 22):** four or more held/refused
fixtures, four or more supported/changed, neither side more than twice the
other. A voice suite written by someone afraid of false praise contains
nothing but refusals and would pass an app that can only refuse.

`web-v2/lib/faff/_coach_lexicon.test.ts` — 6 tests. Proves the shell gate's
parse and the TypeScript module agree term-for-term; that no band parses
empty; that the shell script still contains the extraction this test
reproduces; that no term is under four characters (`atl` was dropped before
shipping because "greatly" contains it, and `greatly`/`neatly`/`atlas` are
asserted clean); and that "limiter" is in the Layer-1 half and NOT the
file-wide half.

`web-v2/lib/faff/_voice_live.audit.test.ts` — the REAL route, the owner's real
account, read-only role, seven consecutive days. **64 runner-readable strings
scanned, zero findings.**

---

## 11 · Falsified gates

Every one run against the code, output pasted into `0d4f3498`'s commit
message. Summary:

| # | Falsification | Result |
|---|---|---|
| 1 | hype + macho string added to `lib/faff/state-tokens.ts` | `✗ hype` and `✗ macho`, both named, correct file:line |
| 2 | `"Your VDOT reads 47.9 today."` in a Layer-1 file | `✗ engine jargon` |
| 3 | the SAME string in `lib/plan`, declared out of the jargon guard's scope | **PASSES** (as designed), and the same file still fails guards 1-6 with an exclamation mark and hype |
| 4 | `band: 'macho'` renamed so the band parses empty | `the macho band parsed EMPTY out of coach-lexicon.ts` |
| 5 | `lib/coach` removed from `targets()` | `scanned 227 …, floor is 255. A gate that looks at fewer files than it used to is not passing, it is blind.` |

Restored after each: `check-coach-voice OK · 303 user-facing source file(s)
clean`.

`_voice_corpus.test.ts` carries **ten more in-file falsifications of
`auditExplanation` itself** — hype, macho, Layer-3 jargon, exclamation mark,
unmarked modelled value, refusal-with-retry, UNKNOWN-dressed-as-conclusion,
a sentence printed twice, a paragraph in a spoken cue, a missing decision
version. Without these, 18 green fixtures would prove nothing about an auditor
that returns `[]` for everything.

### What the gates cannot fail on

- **`check-coach-voice.sh`** cannot grade tone; every band is a fixed phrase
  list. It cannot see a sentence assembled at run time. Its jargon guard runs
  on a NARROWER scope than its other five — the v5 phone, `lib/faff`,
  `app/api/v5`, notification templates — so a real VDOT leak authored inside
  `lib/plan` and rendered on Today passes it. That narrowing is argued in the
  script: run at full scope the guard produced 69 findings, of which the large
  majority were SQL, doctrine citations, log lines and internal
  `coach_intents.reason` strings, and a guard that reports sixty non-defects
  to catch nine real ones gets an allowlist bolted on within a week.
- **`_voice_corpus.test.ts`** cannot catch a wrong verdict, and it is
  fixtures — Rule 13 clause 2 says fixtures skip the paths that break.
- **`_voice_live.audit.test.ts`** is the payload, not the phone. It is one
  account and seven days; injury, illness, off-season and race day are not
  exercised. It only walks the fields named in `readableStrings`, so a new
  prose field on the wire is invisible until someone adds it there.
- **`coach-lexicon.ts`** is excluded from the shell gate's own scan, because
  it is the list of forbidden words. Real runner copy could hide there.

---

## 12 · Verification

| Check | Result |
|---|---|
| `npx tsc --noEmit` | clean |
| `npm run prebuild` (18 gates) | `EXIT=0` — palette, spacing, modelled-mark, **coach-voice (303 files)**, doctrine (328 citations), wire-keys, generated-content, surface-sweep, xcodeproj-sync, swallowed-failure, derived-consistency, automatic-mutations, normal-window, goal-immutability, anchor-derivation, client-graph, coercion, goal-pace-leak |
| `vitest lib/faff lib/coach` | 1088 passed |
| pre-push hook | `✓ next build green` |
| `check-watch.sh` | `watch OK · 195 test cases; 20 boards inside Apple's content box` |
| Live audit vs production (read-only) | 7 days, 64 strings, 0 findings |

Production was read-only throughout (`DATABASE_URL=$DATABASE_URL_RO`). No plan
rebuild was triggered. No writes.

### Device rendering — NOT done, and here is the honest account

I took simulator screenshots early in the session and they **prove nothing
about this work**. The build installed on `793CC699` is a DEV build pointed at
`http://localhost:3111`; nothing was listening, so every fetch had been
failing for hours and the app was painting a twelve-hour `AppCache` entry from
2026-09-01. That is why its Today showed the September 1 run and its Block
header said September 1. I did not discover that myself — the coordinator did,
and told me mid-task.

I chose the coordinator's option 1: **verify server-side and say device
rendering is pending.** Port 3111 has one owner and it is the integration
worktree.

So, precisely: **the composer returns the new sentence** — proven through the
real route handler with real data. **The screen has not been observed showing
it.** Those are different sentences and this stage only earns the first.

---

## 13 · Still partial, duplicated or unverified

### Blocking (something is wrong, or a claim cannot be made)

1. **A failed day-fetch renders the PREVIOUS day's content under the NEW day's
   label, with no signal at all.** `SurfaceStoreV5.swift:200` — `case .failed:
   stale = true`, and the model is left alone. `stale` is read only through
   `isOutage`, which is `model == nil && stale && absentReason == nil`, so
   once a model exists nothing renders and nothing warns. Meanwhile the
   header and the week strip are driven by the host's own `@State
   viewingDate`, which has already moved.

   I observed exactly this on the simulator: tapping 5 September (a REST day,
   0 mi) left the hero reading `THRESHOLD · 8.50 mi · 1:08:23 · 8:03/mi` with
   `Heart rate, max 172 bpm` — 1 September's completed run — under the label
   `UPCOMING` and with the 5th highlighted. The TRIGGER that night was the
   dead dev server, not a production defect, and I say so rather than
   overclaiming. **The mechanism is a code fact independent of the trigger**,
   grep-verified, and it is Rule 11 (a failed read presenting as content) plus
   Rule 16 (a surface about an entity must resolve THAT entity) plus Rule 20
   (`stale` is a flag with no reader).

   I did NOT fix it, and the reason is a genuine decision with two defensible
   answers. Drive the strip and the label off `surface.model?.dateISO` instead
   of `viewingDate` and the two can never disagree — but on an UNCACHED day
   the strip would then wait for the network before moving, which contradicts
   David's own stated preference recorded at `SurfaceStoreV5.swift:93`
   ("Click on the days needs to feel like it pushes the data change"). The
   alternative is to revert `viewingDate` on failure and show an `ErrorNote`.
   Per the operating boundaries, that is a decision to flag, not one to take
   unilaterally on the primary screen — and I could not render-verify either
   option tonight.

2. **`thesisLeadClause` in `lib/training/coaching-thesis.ts` now has zero
   callers.** Outside this branch's boundary; needs deleting by its owner.
   `check-generated-content` GUARD 5 does not currently flag it because the
   module has other live exports.

3. **No cross-surface version check exists.** One surface carries a
   `decisionVersion`. The brief's §7 gate ("different prescription/explanation
   versions between phone and Watch payloads") cannot be written until at
   least two do, and `lib/watch/**` is outside this boundary.

### Non-blocking (known, argued, safe to carry)

4. **The contract has one consumer.** Run Detail, Watch, notifications,
   decision cards and race outlook still author their own prose. Three of the
   five are outside this branch's file boundary.
5. **Static family text is a structural fallback but is not LABELLED as one.**
   `derivePurpose`'s copy is reached only behind the plan row's note and the
   thesis's session name, and the explanation carries `TENTATIVE` when no
   thesis spoke. The runner is not told the sentence is generic.
6. **The jargon guard's narrowed scope**, argued in §11. A VDOT leak authored
   in `lib/plan` and rendered on Today would pass.
7. **`projection-levers.ts:219` still says "don't over-cook the taper".** Same
   register as "cook the back half"; the lexicon term is narrow enough to miss
   it, deliberately, and I left the copy alone rather than widening a term at
   the end of a session. It reaches Targets, not the v5 phone.
8. **A rest day can still open on the QUALITY phase sentence.** 2026-09-05 in
   the live audit returns "You're in the part of the block where the hard
   sessions do the work." on a rest day. Clean by every band, and arguably
   wrong. Pre-existing; not this stage's change.
9. **`web-v2/scripts/voice-eval/` and `scripts/voice-eval/` are both still
   unwired**, and both still carry their own private phrase lists. The
   lexicon supersedes them; deleting them is a separate call.
10. **`fact-reciter.ts` still renders `label: 'VDOT'`.** It is outside the
    jargon guard's narrowed scope, its own header says it is facts and not
    prose, and its consumers are `/api/briefing` and `/api/coach/facts` —
    the paused web frontend and a diagnostic route. Left alone deliberately.

### Corrections to the brief, with evidence

- **§1 gap 1 — "Coaching Thesis has no live consumer" is out of date.** It has
  two: Today's `why` on the days it speaks on, and Block's "Where this goes"
  (confirmed on screen by the coordinator).
- **§1 gap 4 and much of P1 point at surfaces the shipping phone does not
  render.** Detailed in §2. Fixed anyway; the scale of the win is smaller than
  the brief implies.
- **Rule 16's own worked example is already fixed.** The brief and CLAUDE.md
  both cite the recap printing "kept it aerobic" unconditionally. It is gated
  at `run-recap.ts:1002` (`aerobicEarned`) with a falsifying test in
  `_recap_aerobic.test.ts` built from the owner's real 13.5-mile run.
- **The brief's §3 `spoken` cannot be required.** §4 above.
