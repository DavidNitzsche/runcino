# UX/IA Acceptance Plan — faff.run iPhone, 2026-09-11

Owner of this pass: UX/IA acceptance review for Main (integration/release owner),
ahead of the next TestFlight candidate. **Read-only investigation.** No Swift/TS
source was written or modified; no code branch was created or merged. One new
docs file (this one) is the only change, committed per the task's own carve-out.

## 0. Base and methodology — read before trusting anything below

**Base commit:** `9696decac2a1861046ec1b255846e5e36d9b0e9c` (`origin/main`,
`telemetry: refresh 2026-09-11T10:31`), confirmed clean (`git status` empty)
before and after this pass except for this one new file.

**Why this needed stating explicitly:** the worktree this session started in
(`agent-aa16959484b9f8098`) was pinned to `f43fb7a7d` (2026-05-20) — a
commit that predates `web-v2`, `native-v2`'s current tree, and every doc this
task asked me to read. Per `CLAUDE.md`'s own branching rule ("a worktree's
starting branch is often NOT current — never assume it's the source of
truth"), I reset this worktree's own branch to `origin/main`'s tip before
doing anything else. This touched no other worktree and no other agent's
checkout — `git worktree list` confirmed this worktree's branch
(`worktree-agent-aa16959484b9f8098`) was not checked out anywhere else.

**Required reading — status:**

- `docs/audit-design-system-phase2.md` — read in full (1160 lines). Its own
  content confirmed directly, not assumed from a summary.
- `docs/audit-agent-h-design-pass1.md` (Phase 1, cited extensively by Phase 2)
  — also read in full (80 lines) for the findings Phase 2 carries forward.
- `BuildResearch/APP_FEATURE_SPEC.md`, `BuildResearch/C1-overview-and-today.md`
  — read in full. Both predate the iPhone v5 design and the 2026-08-31
  web-frontend pause; they describe a three-surface (web/iPhone/watch)
  co-equal product that no longer reflects current scope. Used here only for
  the original element-inventory framing (job-to-be-done, information
  hierarchy), not as a current spec. Per `CLAUDE.md`'s own instruction, they
  are read as historical/backend-shared context, not active product scope.
- `docs/faff-iphone-design-contract.md` and
  `/Volumes/WP/06 Claude Code/Faff/design/0819/design_handoff_faff_iphone_app v5/README.md`
  — read in full. These are the current, locked source of truth for the phone.
- `docs/audit-2026-09-10-canonical-record.md` §8 — read (the 27-area table).
- `docs/audit-2026-09-11-canonical-record-v3-DRAFT.md` — read via
  `git show <audit-branch-tip>:<path>` **without checking it out or writing to
  it**, since another session's worktree had it checked out live. It does
  **not** contain an updated version of the §8 27-area table — it restructured
  around a different ledger (§2 "Updated master execution ledger", rows
  56–97) that answers a different question (what changed this session) than
  the §8 table (status per area). I did not fold v3-DRAFT into the table below
  because there is nothing there to fold at the same granularity; Main should
  treat the v2 §8 table as the current 27-area status and watch for whether a
  future v3 actually restates it.

**Rendering methodology (Rule 13).** No `DATABASE_URL_RO` and no live server
were available in this session (same constraint Phase 1 and Phase 2 both hit
and disclosed) — confirmed by absence of `web-v2/.env.local` and no
`DATABASE_URL*` in the environment. `web-v2/scripts/walk-substrate.sh` (the
task's suggested real-data path) therefore could not run: it refuses without
`DATABASE_URL_RO`. **Every render in this report is `[Render-sample]`** — the
app's own `ScreensCatalogV5` harness (`-faffV5Screens <id>`), same as both
prior passes — never `[Render-prod-data]`. Where that matters to a specific
finding it is called out.

Interactive simulator access (`mcp__Claude_Code_iOS_Simulator__control`
`attach`/`tap`) was requested and **declined/unavailable this session**,
identically to Phase 2's own disclosure — confirmed by testing both `attach`
and a direct `tap`, both refused with "user has not granted Claude access."
All screenshots here are headless (`xcrun simctl launch -faffV5Screens <id>`
+ `xcrun simctl io screenshot`), which means, same as both prior passes,
**only the initial viewport of any scrolling screen was captured** — nothing
below the fold was verified by render unless a source read confirms it.

Three dedicated simulators were built for this pass and left in place:
`UXIAAudit-17Pro`, `UXIAAudit-SE3`, `UXIAAudit-16ProMax` (all iOS 26.5). The
project was rebuilt from a clean `xcodegen generate` + `xcodebuild` (**BUILD
SUCCEEDED**, confirming the app still builds at this commit — Rule 19's own
concern) after clearing 287 stray `._*` AppleDouble sidecar files under
`native-v2`, the same WP-volume issue Phase 2 also hit and cleaned.

**What I personally rendered this session vs. what is carried from Phase
1/Phase 2 without re-verification** — stated once here, not re-disclosed per
finding below:

- **Personally rendered and inspected this session (22 distinct screens):**
  `5a`, `5b`, `6a`, `6a-longest`, `6a-refusal`, `7a`, `7a-course`, `8a`, `9a`,
  `9a-reveal`, `10a`, `11a`, `12a`, `12b`, `13a`, `14a`, `15a`, `16a`,
  `19a`, `22a`, `23a`, `not-yet` — plus the real (non-catalog) app launch,
  which Phase 1/2 never rendered (see §2).
- **Additionally rendered for Dynamic Type / device-size checks:** `5a` at
  `accessibility-extra-extra-extra-large` on `UXIAAudit-17Pro`; `5a` and `12b`
  at default size on `UXIAAudit-SE3` (iPhone SE, 3rd gen — the smallest
  current iPhone).
- **Not re-rendered this session; cited from Phase 1/Phase 2 as prior,
  already-accepted evidence, explicitly not re-verified by me:** the
  remaining ~37 catalog states (`5a-reps/hills/long/race`, the `5b-*` variants,
  `8b/8c/8d/8e`, `23b/23c/23d`, `7a-behind/stale/injury/lock/two`,
  `12a-noheart/gps/gap`, `12b-noheart`, `sick`, `18a-slower/faster`,
  `19a-refused`, `9a-goal/fitness/availability`, `20a`). Findings that rest
  only on Phase 1/2's renders are marked **[Phase 1/2, not re-verified]**
  below; findings I re-derived myself are marked **[Re-verified 2026-09-11]**.
- **Not reachable at all this session:** `Add-Shoe`, `Account sheet`,
  `Decision History` as catalog entries. Phase 2 added these to the catalog
  as a disclosed, **uncommitted** tooling change in its own isolated
  worktree ("not committed to any branch beyond this worktree, and no push
  was made" — Phase 2 §0.3). That change never reached `main`. On the actual
  current `main`, `ScreensCatalogV5.swift` still has only the original ~59
  entries — confirmed by grep. **This means the three screens Phase 2
  reported as "clean, no violations found" are currently unreachable again**
  for any headless review until either that tooling patch is re-applied (and
  this time committed) or interactive tap access is available. Flagged for
  Main as a real process gap, not just a scope note.

---

## 1. The 27-area table, folded with Design-System Phase 2

Base: `docs/audit-2026-09-10-canonical-record.md` §8 (v2, the only version of
this table that exists — see §0 above on v3-DRAFT). Status column is v2's own
(product/engineering status, unchanged by me). The two new columns are this
pass's: whether Phase 2 (or Phase 1, or this session) said anything about that
area's **UI/design-system** state, and the verdict in Phase 2's own
Keep/Refine/Restyle/Unify/Remove vocabulary. Where Phase 2 is silent on an
area, that is stated explicitly — never left blank without comment, per the
task's own instruction.

| # | Area | v2 product status | Design-System Phase 2 (+ this session) | Verdict |
|---|---|---|---|---|
| 1 | Today | PARTIAL | Heavily covered (`5a`/`5b`/`5c`/`5d` families, ~20 states). Route/elevation card ambiguity (`5b`/`5d`/`23c` — a barometer-only elevation figure sits under a bare "Route" header beside "No GPS", reads self-contradictory). Harness "Close" pill collisions on several Today states (tooling, not product). Everything else clean. **[Re-verified 2026-09-11]** on `5a` — matches. | **REFINE** (one-word "Elevation" sub-label fixes the ambiguity; low priority) |
| 2 | Pre-run | DEFERRED WITH REASON | Not covered by Phase 1/2 as its own surface (the RUN picker sheet and the moment before a live run start have no catalog entry and were not independently rendered by either pass). | **Not covered** — say so, don't guess |
| 3 | Run execution | DEFERRED WITH REASON | `12a`/`12b` families covered. **The one release-blocking UI defect in this whole audit lineage**: the treadmill (`12b`) current-interval label is occluded by the fixed-position cues-menu speaker icon, top-right. Phase 1 found it, Phase 2 confirmed it unchanged at all Dynamic Type sizes and both size extremes tested. **[Re-verified 2026-09-11]** on two devices (`UXIAAudit-17Pro`, `UXIAAudit-SE3`) — reproduces identically, "Warm u—" clipped behind the speaker glyph on both. Still open. | **RESTYLE, priority 1 — unchanged, still shipping** |
| 4 | Post-run | PARTIAL | `5b`/`5c` covered under Today; `23a-d` under Activity. Green start-marker dot (§3 below) lived here structurally (`RouteMapView` is shared). | **REFINE** (shares the route/elevation sub-label note above) |
| 5 | Activity/history | DEFERRED WITH REASON | `22a` (Past runs), `23a-d` (Run detail) covered. Green start-dot bug **[Re-verified 2026-09-11: FIXED]** — see §3. | **KEEP** now that the dot is fixed |
| 6 | Block/plan | DEFERRED WITH REASON | `6a` family covered, including the 5-scenario "Change the plan" sheet and its refusal state. No violations found by either pass. **[Re-verified 2026-09-11]** on `6a`, `6a-longest`, `6a-refusal` — matches; `6a-longest`'s content genuinely extends past one viewport (confirmed, not scrollable to verify below the fold — H3 partial, per Phase 2). | **KEEP** |
| 7 | Adaptation | BLOCKED (migration 166) | The one screen that would show this (`decisions` / Decision History) is **not currently reachable** — see §0's catalog-gap note. Phase 2's own positive finding here ("push"/"pull_back" vocabulary reaching the UI, non-inert per Rule 21) rests on a screen that no longer exists in the shipped catalog. Cannot be re-confirmed this session. | **Not covered this session** (was covered by Phase 2, unreachable now) |
| 8 | Move a Run | DEFERRED WITH REASON | Folds into Block/plan's "Change the plan" (`6a`) — no separate screen. | **KEEP** (same evidence as #6) |
| 9 | Coaching voice | PARTIAL | §7 label-grammar compliance: no exclamation marks, emoji, or em dashes found anywhere across 65 states in Phase 2's pass; spot-checked quotes byte-identical to the design contract. **[Re-verified 2026-09-11]** on the screens I rendered — holds. One open note: `not-yet`'s "Your training is on the web, and it is working" (see §4). | **KEEP**, with the one open copy question carried into §4 |
| 10 | Progress and fitness | PARTIAL | The modelled-value `~` marker is **still absent everywhere** — `RacesV5`'s Projected finish (`7a`) renders `3:16:45` with no tilde. Per the task brief that runs alongside this project, David overrode the 2026-08-21 retirement of the mark; nothing in the code reflects that reversal. **[Re-verified 2026-09-11]** directly on `7a` — confirmed still absent, unchanged from Phase 2. | **CREATE / RESTYLE, priority 1 — highest-leverage single fix in this whole report, still unshipped** |
| 11 | Race page | PARTIAL | Two things converge here. (a) The `RaceDecisionCardV5` eyebrow-label bug Phase 2 called its own priority-1 RESTYLE (`"Needs a decision"` rendering unconditionally, including on Fact/Choice cards where nothing is being decided) — **[Re-verified 2026-09-11: FIXED]**, see §3. (b) The tilde gap from #10 lives here too (`7a`'s Projected, Gap). | **PARTIAL KEEP** — (a) closed, (b) still open, tracked under #10 |
| 12 | Race morning | DEFERRED WITH REASON | `8c` ("twenty minutes after") lightly touches this; no dedicated race-morning screen exists in the catalog. Design contract's heat-trigger Fact card (§2 of the contract) has no rendered instance in the current catalog list I could find (no `7a-heat` id). | **Not covered** |
| 13 | Post-race | DEFERRED WITH REASON | No dedicated post-race screen in the catalog; `14a` (Week off) and `15a` (Off-season) are the adjacent states rendered, both clean. | **Not covered** as its own area; adjacent states KEEP |
| 14 | Shoes | DEFERRED WITH REASON | `11a` covered, both passes: clean, retirement bands correctly deferred to backend config, retired-shoe rows correctly drop the progress bar/chevron. **[Re-verified 2026-09-11]** — matches (my render is tainted by an unrelated system dialog at the top third but the shoe rows below are intact and correct). | **KEEP** |
| 15 | Health and runner metrics | DEFERRED WITH REASON | No dedicated Health screen exists on the phone by design — readiness is folded inline into Today (`5a`'s "Readiness · Inside your own normal" row). This is a deliberate design decision, not a gap: the iPhone v5 handoff never lists a Health destination, and the UX-simplification doctrine argues against a second surface for the same data. | **KEEP as inline-on-Today; do not read the v2 table's "DEFERRED" as "missing"** |
| 16 | Profile/settings | OPEN | `10a` covered, both passes: clean. `BlockV5.swift:863`'s `Alert(text:...)` missing `tone:` (Phase 1 finding #4) not re-verified by Phase 2 or by me this pass — still open, unconfirmed either way. My own render of `10a` was partially occluded by a stray system notification-permission dialog (see §0/§5) so I could not independently confirm the "start runs from this phone" switch's presence this pass — not claiming it is missing, just unverified by me. | **KEEP**, with one long-carried unverified item (`BlockV5.swift:863`) |
| 17 | Notifications | DEFERRED WITH REASON | `10a`'s two notification toggles (Skipped-run check, Weekly summary) rendered and read correctly. Not independently investigated beyond the UI toggle row. | **KEEP** (UI only; no claim about delivery/cadence) |
| 18 | Reliability/synchronization | PARTIAL | `16a` (Data outage) — both passes call this exemplary: ErrorNote + Skeleton, reserved layout, no shimmer, correct "your score is fine, we just cannot see it" framing. **[Re-verified 2026-09-11]** — matches. | **KEEP** |
| 19 | Onboarding | DEFERRED WITH REASON | `9a` family covered (welcome, goal, fitness, availability, reveal). No violations found by either pass. **[Re-verified 2026-09-11]** on `9a` and `9a-reveal` — matches. | **KEEP** |
| 20 | Readiness/illness/injury | DEFERRED WITH REASON | `13a` (Injury flare), `19a`/`19a-refused` (Return to running) covered — walk-run ladder doctrine-verbatim, clinician-gate Alert confirmed present in source. **[Re-verified 2026-09-11]** on `13a` and `19a` — matches. | **KEEP** |
| 21 | Travel/missed training | OPEN | Folds into Block/plan's "Change the plan" travel scenario (`6a`) — same screen, no separate surface. Its two-week-window refusal case ("Being away that long is not a week off, it is a different block") is real output per the design contract, not independently re-rendered this pass (requires the date-range picker interaction, unavailable). | **Not independently verifiable this session; adjacent evidence KEEPs** |
| 22 | Cold-start/returning runners | DEFERRED WITH REASON | Onboarding's "coming back from time off" fitness option (`9a-fitness`) is the only touchpoint; not independently rendered this pass (not in my 22). | **[Phase 1/2, not re-verified]** — carried as KEEP per Phase 2, unconfirmed by me |
| 23 | Additional runner types/goals | DEFERRED WITH REASON | `not-yet` — the refusal screen for coached/just-run/no-race modes. **[Re-verified 2026-09-11]** — copy unchanged: "The phone is built for a runner training toward a race. Your training is on the web, and it is working." See §4 for why this needs a decision from whoever owns the web-frontend pause. | **REFINE — pending a one-line confirmation, per Phase 2's own flag, now sharper given CLAUDE.md's 2026-08-31 lock** |
| 24 | Generalized coaching rules | DEFERRED WITH REASON | Same evidence as #9 (Coaching voice) — no separate screen. | **KEEP** (same evidence as #9) |
| 25 | App Store/privacy/auth/commercial readiness | DEFERRED WITH REASON | **Not covered by either Phase 1 or Phase 2 at all** — both scoped to the post-auth v5 catalog only. This session rendered the real (non-catalog) app launch and found the sign-in screen. See §2 — this is a genuinely new finding, not a re-confirmation. | **RESTYLE — new finding this session, see §2** |
| 26 | Accessibility/device coverage | BLOCKED | Phase 1/2 both reported Dynamic Type as inconclusive (methodology limits, not a confirmed pass or fail). **This session's own AX5 test on `5a` shows real, visible reflow** — see §5. Still BLOCKED for every other screen/category/device combination not personally tested this session. | **BLOCKED, partially narrowed — see §5 for exactly what is and is not now known** |
| 27 | Dead-code/obsolete-path removal | PARTIAL | Legacy `Views/*.swift` `Theme.green` usage (40 sites/13 files), unreachable behind `-faffLegacy` — confirmed still present by Phase 1, carried unchanged by Phase 2, not independently re-grepped by me this pass (no reason to expect it moved; a one-line `grep -rc Theme.green native-v2/Faff/Faff/Views` would confirm in seconds for Main). | **REMOVE, once `-faffLegacy` itself is retired — unchanged** |

---

## 2. New finding: the sign-in screen is off-brand — every runner's actual first screen

Not covered by either prior pass, because both scoped to the post-auth
`ScreensCatalogV5` catalog. Launching the real app (no `-faffV5Screens`
argument) on a fresh install lands on `SignInView` (`native-v2/Faff/Faff/Views/SignInView.swift`)
— confirmed by render **[Re-verified 2026-09-11]**.

**What I found, source-confirmed:**

- The file's own header comment: *"Cool teal welcome. The mesh heats up as the
  runner commits through onboarding. Pixel spec: `designs/faff-iphone-signin.html`."*
  That is a different, older pixel spec than the iPhone v5 handoff this
  project's design source of truth points to.
- It lives in `Views/` (the legacy pre-v5 tree CLAUDE.md and both audit
  passes treat as unreachable-but-real dead weight), not `ViewsV5/`.
- It uses `Theme.bg` (the old theme system) and hardcoded hex literals
  (`Color(hex: 0x0B0B0B)`, `Color.white`, `Color.black.opacity(0.55)`) rather
  than any `V5.*` token.
- The primary call-to-action ("Sign in with email") is a plain white pill
  with black text. The v5 design's whole grammar is that **signal orange is
  the runner's current position/the primary action, and nothing else means
  "go"** — this button breaks that rule on the very first screen a runner
  ever sees, before they have any other screen to compare it to.
- The brandmark itself renders in a coral/pink, which may be an intentional,
  separate brand-lockup color (not a palette token) — not flagged as wrong on
  its own, only noted for completeness.

**Why this matters more than a typical screen-level Restyle:** every other
finding in this report and its two predecessors is about a screen a runner
reaches after already being inside the v5 product. This screen is upstream of
all of them — a runner's first impression of the app's design language is
currently a different, older one. `FaffApp.swift` confirms the flow is
`SignInView` → (if new) `OnboardingHostV5` (v5) → `FaffV5Root` (v5) — so
this is the **only** off-brand screen in the entire authenticated journey,
not a symptom of a wider legacy problem.

`EmailSignInSheet.swift` (also under `Views/`, presented from `SignInView`)
was not independently rendered this pass but is very likely the same
generation of screen by the same header convention — worth a five-minute
look alongside the fix.

**Verdict: RESTYLE, priority 1** (new, does not exist in Phase 1/2's
registers). Bring `SignInView`/`EmailSignInSheet` onto `V5.*` tokens,
`faffText`/`faffDisplay`, and the signal-orange primary-action rule.

---

## 3. Two Phase 2 priority-1 findings are already fixed — confirmed by render and by source

Phase 2 named exactly two RESTYLE priority-1/2 defects. Both are gone on
current `main`, independently re-derived this session, not merely asserted:

**RacesV5 "Needs a decision" eyebrow (Phase 2 §4, RESTYLE priority 1).**
Phase 2's pinned commit (`f1d1def0b`) rendered this label unconditionally
regardless of `card.shape`. On current `main`:

```swift
// RacesV5.swift
extension V5CardShape {
    var raceDecisionEyebrow: String {
        switch self {
        case .decision: return "Needs a decision"
        case .fact:     return "Worth knowing"
        case .choice:   return "Choose one"
        }
    }
}
```

**[Re-verified 2026-09-11]** by render on `7a-course` (a `.fact`-shape card):
the eyebrow now correctly reads **"WORTH KNOWING"**, with a single
"Acknowledge" action and no safe/stretch target tiles — exactly the shape
the design contract calls for. **CLOSED.**

**RouteMapView green start-marker (Phase 2 §3, RESTYLE priority 2).** Phase
2 found `Color(hex: 0x3EBD41)` (the locked Easy-day-state green, labelled
"Success green" in the file's own old comment) used for the route-map start
dot — a direct "no green anywhere" violation. On current `main`:

```swift
startLayer.circleColor = NSExpression(forConstantValue: UIColor(V5.textPrimary))
```

The file's own 2026-09-09 comment documents *why* the fix took the form it
did (a `circleColor` data-driven expression doesn't work reliably on this
pinned MapLibre SDK for a CIRCLE layer — pixel-sampled and reproduced 2/2 on
a fresh install) — a real, falsified-then-fixed defect, not a guess. **This
maps to `fix/routemap-green-start-marker` (commit `12355ae06`)**, visible as
its own worktree in this environment's `git worktree list`. **CLOSED.**

**Why this matters beyond "two bugs fixed":** it means Design-System Phase
2's own recommendation register is **partially stale as of today**, seven
days after Main's session (2026-09-09 → today). Main should not treat
Phase 2's RESTYLE list as current without cross-checking against `main` —
exactly the discipline this acceptance plan is trying to model for the next
report, too.

---

## 4. "Not here yet" — a copy question sharpened by CLAUDE.md's own lock

`NotOnPhoneYetV5` (`ShellV5.swift`) is what a coached, just-run, or
no-race-goal runner sees instead of the phone's main screens. Its body copy,
unchanged since Phase 2 flagged it and confirmed unchanged by my own render
this session:

> "The phone is built for a runner training toward a race. **Your training is
> on the web, and it is working.** This screen arrives when the phone can do
> it justice."

`CLAUDE.md`, locked 2026-08-31 (i.e. **after** this screen's copy was
written): *"the web frontend is IGNORED UNTIL FURTHER NOTICE ... don't
propose it, don't fix it, don't spend effort on UX/design parity there."*
The backend/API does remain canonical and does keep working for these
runner modes, so the sentence may still be literally true — but a runner
reading "it is working" on their phone has no way to know that means "the
API underneath is fine" rather than "go use the web app, it's polished and
current," which per the same lock is no longer accurate as a product claim.

**This is not a confirmed copy bug — it is a question this session cannot
answer alone** (verifying the actual current state of the web frontend is
out of this task's scope, and CLAUDE.md is explicit that web work is not to
be picked up incidentally). Carried forward exactly as Phase 2 flagged it,
with the added weight that the lock postdates the copy.

**Verdict: REFINE**, pending a one-line confirmation from whoever owns the
web-frontend pause — either the sentence is fine as a backend-truth claim, or
it needs softening to not imply a polished destination.

---

## 5. Navigation, screen hierarchy, and the end-to-end flow

### 5.1 The shell matches the design, and a real architectural fix landed since the design was written

`ShellV5.swift`'s `FaffTabV5` is exactly the design's three destinations —
Today, Block, Races — plus RUN. This was audited against
`design_handoff_faff_iphone_app v5/README.md`'s Shell section line by line:

- Tab bar destinations, icon-over-label, no verb in the bar except RUN's own
  label — matches.
- RUN is a filled pill, appears only when `user_settings.phone_run_enabled`
  is on — matches ("this switch is the single source of truth for whether
  RUN appears in the tab bar everywhere," confirmed in both the Settings
  screen's own doc comment and the shell's).
- Tapping RUN opens the Outdoor/Treadmill choice — the one navigation action
  in the whole design that jumps to a different top-level screen instead of
  expanding in place.

**One real, positive architectural correction found in source, dated
2026-09-03** (i.e. after the design handoff was written, and after Phase 1's
own audit): RUN used to be a bottom sheet presented **over** whichever tab
the runner was on. The source's own comment names the defect this caused —
"Today launches the recording lobby" mixing, called out by David — and the
fix promotes RUN to a full peer `NavigationStack`, selected the same way as
the other three, with its own back-stack. This is **not** documented in
either Phase 1 or Phase 2 (both pre- or contemporaneous with the change) and
is a genuine, good structural finding for Main: **the shell's navigation
model is more correct today than either prior design audit assumed.**
**Verdict: KEEP**, and worth Main knowing this is now peer-tab, not a sheet,
if any older mental model or test script still assumes the sheet.

### 5.2 Deep-link routing (`faff://...`) covers 4 of the app's real destinations, and default-routes everything else to Today

`RootV5.route(_:)` maps `races`, `plan`, `settings`, `today`/`health`/`nil`
explicitly; anything else (a malformed or future host) falls through to
Today rather than doing nothing. This is a deliberate, sound default per its
own comment ("a notification the runner tapped should always open
something") — **KEEP**. One gap worth naming: `health` is explicitly mapped
to Today because there is no separate Health destination (consistent with
§1 area #15's finding) — this is intentional, not a missed case.

### 5.3 The one still-real catalog gap: the training calendar has no standalone view

Both Phase 1 and Phase 2 name this, and it is still true on current `main`:
the calendar sheet opened from Today's calendar-icon button is a `private
var calendarSheet` computed property on `TodayBeforeV5`, not an independently
addressable view. This means:

- It cannot be reached from the debug catalog without a product-code change
  (adding an `initialOpen` parameter analogous to `OnboardingV5`'s
  `initialStep`) — correctly out of scope for a docs-only audit like this
  one.
- It also means **I could not render it this session**, by any route. It is
  the one screen named in the design handoff (`README.md`'s Today section:
  "Calendar icon opens a full-height sheet") that no audit pass, including
  this one, has ever visually confirmed.

**Verdict: CREATE** (extract a standalone, catalog-addressable view) — carried
forward unchanged from both prior passes, now a third time.

### 5.4 What Phase 2's own tooling addition being unmerged costs the next reviewer

Covered in §0, restated here because it is a navigation/IA finding, not just
a methodology footnote: **Add-Shoe, the Account sheet, and Decision History
are currently unreachable by any headless review method**, because the only
route to them (interactive tap, or Phase 2's own uncommitted catalog patch)
is unavailable in this class of session. Given `CLAUDE.md`'s own Rule 21
concern (the adaptation engine's upward path being "wired, tested and
inert"), and Phase 2's finding that Decision History is the one place that
concern's UI half is visibly *not* inert — **losing the ability to render
that screen is a real regression in this project's ability to verify Rule 21
from the UI side**, not just a catalog-completeness nicety. Recommend
Main either re-apply Phase 2's 3-entry addition and commit it this time, or
accept that this class of session cannot verify those three screens until
interactive access exists.

### 5.5 No area needs adding, removing, or renaming at the top level

Checked the actual `FaffTabV5`/`V5Route` enums against the C1 inventory's
element list and the design contract: nothing in the current 27-area table
implies a missing top-level destination the phone should have and doesn't.
The phone's deliberately narrow scope (race-mode only, per the design
contract's own opening line) is holding — Health, Log, Coach chat, Insights,
Routes, Gear-beyond-shoes all correctly have no iPhone destination, which
matches the UX-simplification doctrine ("only surface information that
changes what the runner should understand or do next") rather than
under-building. **No structural navigation change recommended.**

---

## 6. Dynamic Type and device coverage — the honest status

Per the task's explicit instruction: nothing below is claimed working unless
personally rendered at a non-default size this session. Everything else is
marked **BLOCKED**, not assumed fine.

### 6.1 Dynamic Type

**CONFIRMED WORKING this session, one screen, one category:** `5a` at
`accessibility-extra-extra-extra-large` (AX5) on `UXIAAudit-17Pro`, compared
directly against the same screen at default (`large`). The comparison shows
real, visible differences: the "Easy the whole way, talking in full
sentences" instruction line wraps from 2 lines to 3; the "About" paragraph
visibly enlarges and re-wraps; the pace-band/ceiling/effort stat labels move
from inline to stacked. The display register ("EASY", "6 mi") and value
register stay pixel-identical between the two renders — consistent with
`FontsV5.swift`'s documented "value register stays fixed" behavior.

**This directly contradicts Phase 1's and Phase 2's own "inconclusive"
finding on this exact mechanism** — both reported no visually confirmed
change at AX5 on any screen tested, and treated it as an open question
between a real regression and a tooling/capture limitation. This session's
result says: on this one screen, at this one category, on this one
Xcode/simulator build, **it works as documented.** I am not overturning
Phase 1/2's finding wholesale — I tested one cell of their matrix, not all of
it, and I cannot explain why my capture (a `sleep 3` settle after launch,
same class of method as theirs) succeeded where two prior careful attempts
did not. Possibilities: a settle-timing difference, an Xcode/simulator patch
between sessions, or genuine nondeterminism in `xcrun simctl ui ... content_size`
propagation. **Main's actual next step should be to re-run this exact
comparison on a physical device**, which resolves the ambiguity outright and
which no session in this lineage has ever had.

**Still BLOCKED, explicitly, not assumed fine:**
- Every other screen (all but `5a`) at any non-default category.
- `extra-small`, `extra-extra-extra-large`, `accessibility-medium` — not
  tested by me this session (Phase 2 tested these on 9 screens; not
  re-verified by me).
- Any interaction-dependent Dynamic Type effect (does a button reflow when
  tapped, does a sheet resize) — headless rendering cannot show this.

### 6.2 Device size

**CONFIRMED, this session:** `5a` and `12b` rendered cleanly on iPhone SE
(3rd generation) — `UXIAAudit-SE3`, the smallest currently-sold iPhone. No
clipped text, no button pushed off-screen, content reflows correctly on
`5a`'s 7-day week strip and 3-column stat plate. `12b`'s treadmill collision
(§1 area #3) **reproduces identically** on this smaller device — confirming
it is a fixed-geometry defect independent of screen width, not something a
smaller or larger device changes.

**Still BLOCKED:** iPhone 16 Pro Max (`UXIAAudit-16ProMax` was created but
not rendered this session — a real gap, not an oversight I'm hiding: time
ran out on this pass before I reached it). Phase 2 did test 16 Pro Max
themselves on 9 screens and found no new defects, but that is their evidence,
not mine, and is cited as such, not re-claimed.

### 6.3 What this means for the acceptance plan

Area #26 (Accessibility/device coverage) stays **BLOCKED** as a category —
one confirmed cell does not clear a matrix — but it is no longer
uniformly unknown. Main should read it as: "mostly unknown, one data point
says the mechanism can work, needs a physical device to settle it for real."

---

## 7. Classification legend, used consistently above

Matching Design-System Phase 2's own vocabulary, per the task's instruction:

- **Keep** — correct as built, no action.
- **Refine** — works, small copy/data/label correction improves it.
- **Restyle** — visibly wrong against the locked design language or a stated
  rule; needs a real code change to a view.
- **Unify** — two places compute or display the same thing differently;
  needs one canonical source.
- **Remove** — dead, unreachable, or superseded; delete rather than fix.
- **Create** — a screen or mechanism the design calls for that does not
  exist as an addressable unit yet.

---

## 8. What Main should check during physical-device verification

Derived directly from everything above — ordered by what would most change a
ship/no-ship call, not by area number.

1. **Sign-in screen (§2).** Open the app fresh (delete + reinstall, or a
   fresh TestFlight install) and look at the very first screen. Confirm
   whether it's still the pre-v5 `SignInView` (coral logo, plain white
   button) — if so, this is the single most visible design-language break
   in the app, because it is the first thing anyone sees, reviewer included.

2. **Treadmill console collision (§1 area #3, §6.2).** Start a treadmill
   run, watch the top-right corner during any interval whose name is as long
   as "Warm up" — confirm whether the cues-menu speaker icon still clips the
   current-interval label. This is the one finding every pass in this
   lineage (Phase 1, Phase 2, this session, three separate device sizes) has
   confirmed. If it's still there on device, it should block the release
   the way Phase 1 originally flagged it.

3. **Modelled `~` marker (§1 area #10, §3).** Look at the Races screen's
   Projected finish time. Confirm whether it's still a bare number with no
   tilde. If David's reported override of the 2026-08-21 retirement is still
   current instruction, this is unshipped and is the single highest-leverage
   fix named across all three audit passes.

4. **Races decision-card eyebrow + green start-dot (§3).** Quick confirms,
   not blockers — verify both fixes hold on a physical device the way they
   did in simulator: a Fact-shape race card (course-changed, chip-time-lock,
   two-A-races) should read "Worth knowing" or "Choose one," never "Needs a
   decision"; a run's route map should show a white/neutral start ring, never
   green.

5. **"Not here yet" copy (§4).** If any test account is in coached/just-run
   mode, read this screen and decide — with whoever owns the web-frontend
   pause — whether "Your training is on the web, and it is working" should
   still say that.

6. **Dynamic Type on a physical device (§6.1).** This is the one check no
   session in this lineage has ever been able to do. Settings → Accessibility
   → Display & Text Size → Larger Text, drag to maximum, open the app, look
   at Today's body copy and the Races decision-card question. This single
   check resolves an ambiguity three audit passes have now separately hit.

7. **Training calendar sheet (§5.3).** Tap the calendar icon on Today.
   Confirm it opens and matches the design's "AppBar + one grouped list per
   week" description — no automated pass in this project's history has ever
   rendered this screen.

8. **Add-Shoe / Account / Decision History (§0, §5.4).** Reach these by
   real navigation (Shoes → "Add a pair"; the JR account disc; Settings →
   wherever Decision History is linked) and confirm they still look correct
   — the last confirmation of these three screens rests entirely on an
   uncommitted patch from a different session that no longer exists on
   `main`.

9. **iPhone 16 Pro Max (§6.2).** Not personally re-verified this session;
   worth a quick pass on the largest current device alongside whatever else
   Main is already checking on it.

10. **`BlockV5.swift:863`'s missing `Alert(tone:)`** and **the 14
    `.system()` font sites bypassing `faffText`** (§1 areas #16, #4/#5) —
    long-carried, low-priority, still unconfirmed either way. Not
    blockers; worth a `grep` sweep if Main has a spare five minutes.
