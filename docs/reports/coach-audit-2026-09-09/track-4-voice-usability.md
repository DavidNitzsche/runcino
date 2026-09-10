# Track 4 — coaching-copy voice/hierarchy/usability audit

2026-09-09. Read-only audit against `main`. No code, config, or DB rows were
modified. One live read-only DB session was run (`DATABASE_URL_RO`, the
role built for exactly this purpose) via the repo's own
`lib/faff/_voice_live.audit.test.ts` — its own write-barrier log confirms
8 write attempts were REFUSED and 0 issued during that run, so the account
was not mutated.

Evidence tags used below: **[SRC]** literal in source, read directly.
**[TEST]** exact string from a test's `expect(...).toBe(...)`/fixture,
produced by the real composer function. **[PROD-RO]** captured live off
David's real account (`0645f40c-951d-4ccc-b86e-9979cd26c795`) through the
real `/api/v5/today` route, over the read-only DB role, 2026-09-09.
**[RENDER]** confirmed against the actual SwiftUI call site that draws the
string. **[INF]** inference / reasoning, not a direct observation.
**[BLOCKED: reason]** could not be verified in this session, reason given.

---

## Step 3 — the em-dash / Rule 20 worked example: RESOLVED, verified

Rule 20's own worked example says a coach-voice gate excluded `lib/plan` and
1,804 rows shipped with em dashes anyway. Checked whether that is still true.

- **The gate**: `scripts/check-coach-voice.sh`. Its `targets()` function (line
  154-164) **does** scan `web-v2/lib/plan` today — added 2026-09-01, per the
  script's own inline history at lines 128-190, which quotes the falsifier
  that proved the gap (`"Great work! You crushed it — keep going."` placed in
  `lib/faff/goal-status.ts` failed; the byte-identical string in
  `lib/plan/block-preview.ts` passed before the widening).
- **Ran the gate** [SRC]: `bash scripts/check-coach-voice.sh` →
  `check-coach-voice OK · 376 user-facing source file(s) clean`. Exit 0.
- **Checked the literal em-dash count independently** [SRC], rather than
  trusting the gate alone (Rule 18 — falsify, don't just trust a green
  check): `grep` for the UTF-8 em dash across `web-v2/lib/plan/*.ts`
  (excluding `*.test.ts`) returns **3,936 raw hits**, but a second pass
  restricted to occurrences **inside a quoted string literal** (`"…"` /
  `` `…` ``, not a `//` or `/**` comment line) returns **0**. Every one of the
  3,936 is developer prose in a comment — architecture notes, incident
  post-mortems, doctrine citations (e.g. `drift-monitor.ts:206`, `:489`,
  `:832`) — which is exactly what the gate is supposed to skip, and does.
- **Conclusion**: Rule 20's named defect is closed. The 1,804-row finding was
  fixed by the 2026-09-01 scope widening plus the `RUNNERLANG-1`/`RUNNERLANG-2`
  rewrite of `lib/plan/runner-instruction.ts`'s role-line tables. No open
  em-dash leak in `lib/plan` today.

---

## Step 4 — fact / interpretation / uncertainty / action classification

Ten representative sentences, real generated output (six **[PROD-RO]**, off
today's live account; four **[TEST]**, off passing fixture assertions that
call the real composer).

| # | Sentence | F / I / U / A breakdown |
|---|---|---|
| 1 | **[PROD-RO]** 2026-09-05, Rest day: *"You're in the part of the block where the hard sessions do the work."* | INTERPRETATION (phase framing), stated as flat fact, no hedge. No FACT specific to the day. No ACTION. |
| 2 | **[PROD-RO]** 2026-09-08, after Tempo: *"Holding your pace late in a race is the thing to move right now, so that is what the block is building toward. Continuous tempo."* | Clause 1 = INTERPRETATION (the coaching-thesis `limiter` classification, stated with zero hedge — no "we think", no confidence marker). Clause 2 = FACT (session name). No explicit ACTION (the instruction lives elsewhere on the card). |
| 3 | **[PROD-RO]** 2026-09-13, race day: *"Holding your pace late in a race is the thing to move right now, and this is the session that does it. Santa Monica 10k."* | Same INTERPRETATION-as-fact clause, word-for-word identical opening to #2 five days earlier; FACT = race name. |
| 4 | **[PROD-RO]** 2026-09-18: *"Holding your pace late in a race is the thing to move right now, so that is what the block is building toward. Cruise-interval re-entry, light end."* | Same INTERPRETATION-as-fact opener as #2, verbatim, 10 days later; FACT = session name. |
| 5 | **[TEST]** `acknowledge.test.ts:80`: *"You called yesterday's tempo a grind · today stays truly easy."* | FACT (the runner's own subjective input, "grind") + ACTION ("today stays truly easy"). No interpretation asserted as fact — this is the clean pattern. |
| 6 | **[TEST]** `acknowledge.test.ts:86`: *"Yesterday's intervals took more than it should · be honest with the first reps today."* | INTERPRETATION ("took more than it should" — a judgment, unhedged) + ACTION ("be honest with the first reps"). |
| 7 | **[TEST]** `coach-log.test.ts:30`: *"Biggest week of the block · 42.1 mi · both quality days landed."* | FACT × 3, no interpretation, no action — a clean, compliant milestone statement (no hype words, matches doctrine's "trust from being right, not from cheering"). |
| 8 | **[TEST]** `coach-log.test.ts:126`: *"Longest run you have ever logged · 18 mi. Old mark 16.2."* | FACT × 2, telemetry-shaped but a genuine PR-style milestone — acceptable under doctrine's "celebrate demonstrated progress" rule. |
| 9 | **[SRC]** `web-v2/lib/plan/adapt.ts:1015`, confirmed final runner-facing text via `strip-citations.test.ts:46-48`: *"Comeback re-ramp after 10 days off: week of 2026-08-24 rescaled from 30mi toward 21mi (resume at 70% of the pre-absence 4-week average 30mi, then ≤10%/week)."* | Entirely FACT/telemetry (7 raw numbers/dates). No plain-language INTERPRETATION of what changed for the runner, no single clear ACTION. |
| 10 | **[SRC]** `web-v2/lib/plan/adapt.ts:5235-5236`, comment two lines above the string literally says *"the why is runner-facing … say what happened to THEM, not what the engine did to itself"*: `` `New race fitness · VDOT ${...} · your paces just moved.` `` | FACT (paces moved) + jargon token ("VDOT") standing in for an INTERPRETATION the sentence never actually gives in plain language. The author's own comment states the intended register and the string violates it. |

**Interpretation-stated-as-fact, flagged specifically (per the task's ask):**
Rows 1-4's opening clauses are genuine interpretive claims (a phase read, a
limiter classification) delivered with the full grammar of settled fact —
no "~", no "based on your training", no confidence qualifier of any kind.
This is **not automatically a defect**: `docs/PRODUCT_COACHING_DOCTRINE.md`
§30 explicitly models confident, unhedged declarative coaching ("Durability
is currently the limiter" is the doctrine's own canonical example, stated
flat), and Rule One's "modelled must never look measured" mark is scoped to
**numbers** (the amber `~`), not to interpretive prose. Whether rows 1-4
*should* carry a confidence signal depends on how confident the underlying
limiter/phase read actually was on those specific days, which this audit
cannot see from the wire payload alone. **Classification: BLOCKED ON BRAIN
TRUTH** — needs the Runner Model's actual confidence value behind
`thesis.limiter` on those dates to judge whether flat declarative language
was earned or overconfident.

---

## Step 5 — specific defects, with exact file:line and exact string

### Defect A (headline finding) — "VDOT" leaks past every voice gate into runner-facing copy, at six call sites, on the app's rarest and highest-trust moments

The coach-voice gate's own header (`scripts/check-coach-voice.sh` lines
292-330) states the jargon guard (which bans `VDOT`/`ACWR`/`TSB` etc.
outright, "always") runs on a **narrower scope**: native `ViewsV5`/`DesignV5`,
`web-v2/lib/faff`, `web-v2/app/api/v5`, and `notifications/templates.ts`.
`web-v2/lib/plan` and `web-v2/lib/coach` are excluded from that guard (guards
1-6 — hype/scold/em-dash/exclaim/emoji/shorthand — still apply there, but not
the jargon list). The gate's own comment calls `lib/plan`/`lib/coach`
"engine-side," and separately claims `coach_intents.reason` is "an internal
audit trail, not copy." Both of those get contradicted by the actual data
flow:

1. **[SRC]+[RENDER]** `web-v2/lib/plan/adapt.ts:5235-5236` — the function's
   own comment two lines up: *"2026-08-17 · coach-experience pass · the why is
   runner-facing (adaptation-info + the coach's log surface it): say what
   happened to THEM, not what the engine did to itself."* The code directly
   below it:
   ```
   const why = t.kind === 'pr_bank'
     ? `New race fitness · VDOT ${Number(t.evidence.new_vdot ?? 0).toFixed(1)} · your paces just moved.`
     : 'Your goal changed · plan paces re-anchored to it.';
   ```
   This `why` is written to `coach_intents.value.why` (confirmed: `adapt.ts:1696`
   comment, *"`why` is the one string the runner reads (coach_intents.value.why
   → adaptation-info → 'How it changed' surfaces)"*) and rendered verbatim by
   **[RENDER]** `native-v2/Faff/Faff/ViewsV5/DecisionHistoryV5.swift:209-210`:
   `if !decision.why.isEmpty { Text(decision.why) }`.

2. **[SRC]** `web-v2/lib/plan/adapt.ts:3305-3306` (`pr_bank` trigger reason):
   `` `New race fitness · VDOT ${bestNewVdot.toFixed(1)} vs prior ${oldVdot.toFixed(1)} (+${delta.toFixed(1)}). Paces need recompute.` ``

3. **[SRC]** `web-v2/lib/plan/adapt.ts:3749-3750` (race-slower-than-anchor trigger):
   `` `Race read slower than the plan's anchor · VDOT ${bestRaceVdot.toFixed(1)} vs ${oldVdot.toFixed(1)} (${delta.toFixed(1)}). Paces re-anchor to the result.` ``

4. **[SRC]** `web-v2/lib/plan/adapt.ts:4198-4207` — the surrounding comment
   explicitly says *"No hype, and the temptation is real here — this is good
   news and the house voice still does not celebrate. Plain statement of what
   happened."* — immediately followed by:
   ```
   reason:
     `${span.sessions} quality sessions over ${span.spanDays} days reading ahead of your last race `
     + `· VDOT ${measured.toFixed(1)} · your paces just moved. `
     + `A race or field test confirms it.`,
   ```
   "Plain statement" was the stated goal; "VDOT 45.1" is not plain.

5. **[SRC]+[RENDER]** `web-v2/lib/coach/coach-log.ts:993-999`:
   ```
   const body = rawWhy
     ? stripResearchCitations(rawWhy)
     : (vdot != null
       ? `New fitness read · VDOT ${vdot.toFixed(1)} · your paces just moved.`
       : 'Your paces were recalibrated to current fitness.');
   ```
   `stripResearchCitations` removes `Research/…` references only (verified
   against its own test suite, `strip-citations.test.ts`) — it has no jargon
   filter, so a `rawWhy` inherited from adapt.ts (defect #1 above) keeps its
   "VDOT" straight through. This `body` is pushed onto `CoachLogEntry` and
   rendered at **[RENDER]** `native-v2/Faff/Faff/Components/CoachLogCard.swift:125-126`:
   `Text(e.body)`, drawn on `TrainView.swift`.

**Why this is the top finding, not a minor jargon nit:** these are not
arbitrary strings. They are the composer for `pr_bank`/`recompute_paces` —
the mechanism that announces an **upward** adaptation (paces getting faster
because the runner earned it). Rule 21 of `CLAUDE.md` measured this
runner's real `coach_intents` history at 309 rows and found exactly **one**
`vdot_auto_recalc` event ever — meaning this exact jargon-bearing sentence is
very likely one of the only "you got fitter" messages that has ever reached
this runner's real phone. `docs/PRODUCT_COACHING_DOCTRINE.md` §30's own
canonical *good* example is "You're consistently outperforming these targets.
It's time to move them" — no jargon, plain language. The shipped
implementation of that exact doctrinal moment fails it, at every call site
that produces it, and no automated gate can see any of them, by the gate's
own documented scope decision.

**Classification: REMOVE** the "VDOT" token from all five string templates
(rewrite to something like *"Your paces just moved — recent racing/quality
work reads ahead of where they were set."*, no number needed at Layer 1).
**Also REFINE the gate**: either widen `jargon_targets()` to include
`lib/plan` and `lib/coach`, or add a targeted scan of every `why:`/`reason:`
template literal that flows into `coach_intents.value.why` before it is
persisted (the same posture `auditExplanation` already takes for Today's
"why" field, per the gate's own header note).
**Priority: high-frequency-high-trust** — low raw frequency (rare trigger),
maximal trust cost (it is the doctrine's flagship "coach notices you got
better" moment, actually observed at least once in production per Rule 21's
own audit).

### Defect B — the same VDOT-jargon shape recurs in the injury/absence-rebuild copy

**[SRC]+[RENDER]** `web-v2/lib/plan/adapt.ts:881`:
```
why: `${daysOff} days off. Plan rebuild recommended with a ${daysOff >= 42 ? '5-8' : '3-5'} point VDOT haircut before resuming. Research/01 recalibration table (layoff ≥2 weeks).`,
```
Confirmed final runner-facing text after the citation scrub, via
**[TEST]** `web-v2/lib/plan/strip-citations.test.ts:41-42`:
`stripResearchCitations(...)` on this exact template →
*"21 days off. Plan rebuild recommended with a 3-5 point VDOT haircut before
resuming."* The Research/ citation is correctly stripped; "VDOT" is not (the
scrubber only targets citations, not jargon), and this reaches the same
`coach_intents.value.why` → `DecisionHistoryV5.swift:210` render path as
Defect A. This fires exactly at a long-layoff comeback — arguably the moment
a runner most needs plain reassurance, not a jargon-bearing algorithm
parameter.

**Classification: REMOVE.** **Priority: material** (rare trigger — 14+ day
absence — but a real, confirmed leak on a trust-sensitive surface).

### Defect C — unnecessary telemetry narration in the comeback re-ramp sentence

**[SRC]+[TEST]** `web-v2/lib/plan/adapt.ts:1015`, confirmed final text via
`strip-citations.test.ts:46-48`:
*"Comeback re-ramp after 10 days off: week of 2026-08-24 rescaled from 30mi
toward 21mi (resume at 70% of the pre-absence 4-week average 30mi, then
≤10%/week)."*

Seven raw numeric facts (days off, a calendar date, two mileage figures, a
percentage, an averaging window, a rate cap) in one sentence, with no plain
statement of what it means for the runner and no single clear next action.
This is precisely what `docs/PRODUCT_UX_SIMPLIFICATION_DOCTRINE.md`'s one
rule forbids: *"Only surface information that changes what the runner should
understand or do next. Everything else stays underneath."* None of the seven
numbers here changes a decision the runner makes; they document the engine's
own math to itself.

**Classification: REFINE** — e.g. *"Your return is scaled down so volume
climbs safely. About 21 mi this week."* — one concrete, actionable number,
the internal ramp formula moved to a "why?" affordance if it needs to exist
at all. **Priority: material.**

### Defect D — a four-sentence, self-referential disclosure standing where a one-line instruction should be

**[SRC]** `web-v2/lib/plan/injury-builder.ts:585`:
```
`${resolved.protocol.label}. No running until a clinician clears it. ${resolved.protocol.clearanceGate ?? ''} Doctrine total return ${bandLabel}. This plan holds the gate and tracks the days. It does not prescribe the non-impact aerobic work the research puts in the gap, and it does not pretend the gap is not there.`
```
Breakdown: FACT (protocol label) → ACTION (no running until cleared) → FACT
("doctrine total return" band, itself a mild jargon term) → then two
sentences of INTERPRETATION **about what the app itself does and does not
do** ("This plan holds the gate…", "it does not pretend the gap is not
there") — meta-commentary about the system, not coaching about the runner.
The honesty is doctrinally correct (§30: "never pretending everything is
going amazingly when it isn't"), but stacking it as the primary line a
runner reads on an injury day is thesis-length and app-voice-adjacent
(talking about itself).

**Classification: REFINE** — keep the FACT+ACTION as the primary line; move
the two self-referential sentences to a demoted "why this looks different"
affordance rather than the calendar row's headline text.
**Priority: material** (fires only on an active injury protocol, but that is
precisely when clarity matters most).

### Defect E — one composer reimplemented twice, coincidentally in sync today

**[SRC]** `web-v2/lib/coach/morning-brief.ts:167` (`composeSeasonSentence`)
and **[SRC]** `web-v2/lib/coach/coach-log.ts:207` independently build the
identical template *"Biggest week of the block · {mi} mi · {quality
summary}."* as two separate string-formatting functions rather than one
owning composer that both call. They agree today (confirmed **[TEST]**:
`morning-brief.test.ts:109` and `coach-log.test.ts:30` assert the exact same
string for the same inputs), but nothing enforces that agreement going
forward — this is the shape Rule 16 ("one quantity, one name") exists to
prevent, one step upstream of an actual mismatch. Not yet a visible defect;
a latent one.

**Classification: UNIFY.** **Priority: polish.**

### Defect F (verification, not a new defect) — historical hype string confirmed removed

**[SRC]** Searched for the Rule 20-cited historical string ("Great work! You
crushed it — keep going.") and the broader hype-word family
(great/awesome/nice work/way to go/nailed it/etc.) across
`lib/coach`, `lib/plan`, `lib/faff`, `lib/today`, `lib/race`,
`lib/execution`, `lib/prescription` (excluding tests and the lexicon file
itself, which necessarily contains the banned words as data). Zero hits.
The only surviving reference is a comment in `web-v2/lib/faff/glance-adapter.ts:189`
explaining *why* "NAILED IT." was retired — historical documentation, not
live copy.

**Classification: KEEP (verified fixed).**

---

## Step 6 — Watch language

**[SRC]** Searched `web-v2/lib/coach` for `watch` (case-insensitive, non-test
files): every hit is about watch **data ingest** (HR samples, sync status,
dedup against Apple Watch/HealthKit rows) — no runner-facing prose composer
for the watch lives in `lib/coach`. The watch's own copy lives entirely in
the Swift target.

**The watch Swift target**: `native-v2/Faff/FaffWatch Watch App` (symlinked
to `legacy/native/Faff/FaffWatch Watch App`, an active target — build
artifacts for both `Release-watchsimulator` and `Release-iphonesimulator`
confirm it still builds).

**Is it meaningfully shorter/glanceable, or reused verbatim?**
Confirmed **meaningfully different and shorter**, not reused:

- **[SRC]** `FacesRunV6.swift:77-141` — the board is metric/label pairs, not
  prose: `WorkoutMetric(value: "168", unit: "bpm", role: "Heart rate")`,
  `WorkoutMetric(value: "1:12", role: "Time left in rep")`. No sentence at
  all reaches the always-visible face.
- **[SRC]** `SpokenCues.swift:166-297` — a **separate** formatter converts
  the board's terse label into a spoken phrase only when audio cues are on,
  and it is explicitly built to avoid dumping phone-style prose into a
  runner's ear: the file's own header (line 21) says *"'No heart signal'
  spoken into a runner's ear sounds like an [alarm]"* and the code spells
  digits into words for TTS (`"6 sec under goal"` → `"six seconds under
  goal"`, line 226-227) rather than reusing any phone sentence.
- No file under `FaffWatch Watch App` imports or references
  `lib/faff/why-voice.ts`, `lib/coach/morning-brief.ts`, or any of the
  phone "why" composers found in Steps 2 and 4.

**Classification: KEEP.** The watch surface is correctly built as its own,
shorter, purpose-specific language layer — no defect found here.

---

## Recommendation matrix

| Finding | Exact text + file:line | Classification | Priority | F/I/U/A breakdown | Recommended fix |
|---|---|---|---|---|---|
| A. Systemic "VDOT" jargon leak on upward-adaptation copy (5 call sites) | `"New race fitness · VDOT ${...} · your paces just moved."` — `web-v2/lib/plan/adapt.ts:3305-3306, 3749-3750, 4207, 5235-5236`; `"New fitness read · VDOT ${...} · your paces just moved."` — `web-v2/lib/coach/coach-log.ts:999` | REMOVE (the token) / REFINE (the gate) — [SRC]+[RENDER] | high-frequency-high-trust | FACT (paces moved) + jargon standing in for INTERPRETATION never actually stated in plain language | Drop "VDOT n.n" from every template; say what changed in plain language. Widen `jargon_targets()` in `check-coach-voice.sh` to cover `lib/plan` and `lib/coach`, or scan every `why:`/`reason:` literal that reaches `coach_intents.value.why` before persistence. |
| B. "VDOT haircut" jargon in the long-absence rebuild note | `` `${daysOff} days off. Plan rebuild recommended with a ${…} point VDOT haircut before resuming. Research/01…` `` — `web-v2/lib/plan/adapt.ts:881`, confirmed post-scrub text via `strip-citations.test.ts:41-42` | REMOVE — [SRC]+[TEST]+[RENDER] | material | FACT (days off) + ACTION (rebuild recommended) + jargon-as-FACT ("VDOT haircut") | Rewrite to plain language, e.g. "coming back at a slightly easier effort before ramping to full training." |
| C. Telemetry-overloaded comeback sentence | `"Comeback re-ramp after 10 days off: week of 2026-08-24 rescaled from 30mi toward 21mi (resume at 70% of the pre-absence 4-week average 30mi, then ≤10%/week)."` — `web-v2/lib/plan/adapt.ts:1015`, confirmed via `strip-citations.test.ts:46-48` | REFINE — [SRC]+[TEST] | material | 7 raw FACTs, no plain INTERPRETATION, no single clear ACTION | Compress to one actionable number ("About 21 mi this week while you build back up"); move the ramp formula behind detail if it needs to exist at all. |
| D. Four-sentence self-referential injury disclosure | `` `${label}. No running until a clinician clears it. ${gate}. Doctrine total return ${band}. This plan holds the gate and tracks the days. It does not prescribe the non-impact aerobic work the research puts in the gap, and it does not pretend the gap is not there.` `` — `web-v2/lib/plan/injury-builder.ts:585` | REFINE — [SRC] | material | FACT + ACTION, then 2 sentences of INTERPRETATION about the SYSTEM (app-voice risk) | Keep FACT+ACTION as the primary line; demote the self-referential disclosure to a "why?" affordance. |
| E. `morning-brief.ts` and `coach-log.ts` independently reimplement the same "biggest week" sentence | `"Biggest week of the block · 42.1 mi · both quality days landed."` — `web-v2/lib/coach/morning-brief.ts:167` vs `web-v2/lib/coach/coach-log.ts:207`, confirmed identical via `morning-brief.test.ts:109` and `coach-log.test.ts:30` | UNIFY — [SRC]+[TEST] | polish | Two FACT-only composers, currently in sync by coincidence not by construction | One owning formatter; both call sites use it (Rule 16 pattern). |
| F. Interpretation-as-fact on the daily "why" (phase/limiter framing, no hedge) | `"Holding your pace late in a race is the thing to move right now, ..."` — composed by `web-v2/lib/faff/why-voice.ts` (`thesisLead`), captured live 2026-09-08/09-13/09-18 | BLOCKED ON BRAIN TRUTH | material | INTERPRETATION delivered as flat FACT, no confidence marker — doctrine explicitly permits confident unhedged coaching language, so defect status depends on the underlying confidence value | Needs the Runner Model's confidence behind `thesis.limiter` on those dates to know whether a hedge is owed; not resolvable from the wire payload alone. |
| G. Same "why" opener repeats verbatim across non-adjacent days addressing the same limiter | `"Holding your pace late in a race is the thing to move right now, so that is what the block is building toward."` — identical 2026-09-08 and 2026-09-18 (10 days apart), captured **[PROD-RO]** | REFINE | material | INTERPRETATION-as-fact (identical) + FACT (session name, varies) | `why-voice.ts` already has ≥2 phrasing variants for the tail clause (proven by 09-13's different wording) — alternate the variant used across consecutive thesis-days for the same limiter, not just within one screen. |
| H. Phase-opener line repeats verbatim on 3 of 6 sampled days | `"You're in the part of the block where the hard sessions do the work."` — `web-v2/lib/faff/why-voice.ts:167`, captured **[PROD-RO]** on 2026-09-05/06/11 | KEEP (by design, per the module's own doc comment — phase-scoped, analogous to a role line) but flagged, since it is the exact blind spot `_sentence_repetition.test.ts`'s header names as "REPETITION ACROSS WEEKS ... invisible here, by design" | polish | INTERPRETATION (phase framing), no hedge, no per-day FACT, no ACTION | If it ever reads as stale to the runner in practice, treat as a QUALITY-phase role line and vary wording the way `EASY_DAY_ROLE_LINES` varies easy days; otherwise no action needed. |
| I. Em-dash / Rule 20 worked example | N/A — verification row | KEEP (confirmed fixed) — [SRC] ran `check-coach-voice.sh` (376 files, clean) + independent grep (0 em dashes inside string literals in `lib/plan`) | n/a | n/a | None needed; re-verify if `lib/plan`'s scope is ever narrowed again. |
| J. Historical hype string ("crushed it") | N/A — verification row | KEEP (confirmed removed) — [SRC] zero hits across all scanned coach-copy directories | n/a | n/a | None needed. |
| K. Watch language vs. phone language | N/A — verification row | KEEP (confirmed appropriately shorter/purpose-built, not reused) — [SRC] `SpokenCues.swift`, `FacesRunV6.swift` | n/a | n/a | None needed. |

---

## What this audit could not verify

- **[BLOCKED: no phone session]** Whether the strings in Defects A-D actually
  render legibly and without duplication on the physical `DecisionHistoryV5`/
  `CoachLogCard` screens (Rule 13 requires rendering, not just payload
  tracing). This audit traced the data path to the exact `Text(...)` call
  site in each case but did not build and screenshot the simulator.
- **[BLOCKED: BRAIN TRUTH]** The actual confidence value behind
  `thesis.limiter` on the captured dates, needed to judge Finding F.
- Coverage of `web-v2/lib/execution`, `web-v2/lib/prescription`, and
  `web-v2/lib/race` copy was based on static `grep`/read, not a live render —
  no defects of the classes searched for (thesis-length, generic
  encouragement, robotic mail-merge) turned up there in this pass, but that
  is a narrower claim than "clean."
