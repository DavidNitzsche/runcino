# Whole-App UX/IA Audit — Pass 1 (verbatim)

Pinned SHA: f1d1def0bedbb6db76c86ec89f8dc16f3ff9715d

Rendering method: no DATABASE_URL_RO/production access; used the app's own `ScreensCatalogV5` on-device review harness (sample built from "the approved prototype's own data" and, for several entries, literal payloads pulled from production and frozen into source). Built fresh, dedicated simulator `UXAudit-iPhone17Pro`, ~20 real screenshots captured, several with source-level follow-up verification.

## 1. Current IA inventory

**Shell:** four tab-bar destinations — Today, Block, Races, Run (Run shown only when `phone_run_enabled`). All four mounted simultaneously and cross-faded.

**Full screen inventory:** Today before/after, Block, Races, Race detail, Run (live picker), Live run outdoor/treadmill, Past runs (pushed from Block, not Today), Run detail, Settings (contains Decisions link), Shoes, Decisions (read-only, no buttons, reached from Settings only), Paces moved, Return to running, Injury flare/Sick/Week off/Off-season/Outage (state-driven on Today), Onboarding, Add a race/course import.

**Duplicate/overlapping ownership found:**
- Race/goal identity stated on three surfaces (Block hero, Races hero, Race Detail stat row) that can drift — each independently sourced rather than visibly calling one shared resolver from the screen layer.
- Past Runs (history) lives under Block, not Today, despite "what did I do" being a Today-shaped question.
- Readiness has no dedicated screen — an expand-in-place row on Today only, deliberately (four pillars each against its own baseline, correctly avoiding a combined causal claim). Means no readiness trend is visible anywhere.
- **Notifications/inbox has no home in V5 at all** — the single most consequential IA gap found.

## 2. Journey findings

**Journey 1 (Today→pre-run→execution→post-run→history):**
- Reproducible layout bug on 3+ screens: when scrolled so a section's eyebrow header reaches the top, it renders directly behind/overlapping the system status-bar clock, illegible at the collision point. Captured as a stable state, not a scroll artifact.
- Recovery-run post-run hero unusually empty — shows only "Logged 34:32" and day name, no session-type label, no distance, against a large blank gradient area. Doctrine's suppression rule (no pace/maxHR/cadence) appears over-applied to fields it never named.
- Route card can read as self-contradictory: "No GPS for this run" directly above a terrain-shaped elevation chart with climb figures — architecturally correct (barometer-independent) but no label clarifies the two facts aren't contradictory.
- **Confirmed real code defect:** Run Detail's Distance/Time/Pace grid shows an unlabeled second pace number ("9:15" under "9:02/mi"). Traced to `askedPaceText` (`RunDetailV5.swift:532`), whose own comment claims the word "asked" carries the meaning now the tilde is retired — but the actual `return text` never includes "asked," and the rendering component separately stopped auto-prefixing it for an unrelated reason (PACE-CONTRACT-1). Two individually-reasonable changes left a comment asserting a contract the render no longer honors.
- History (Past Runs) filed under Block, not Today.

**Journey 2 (Block/plan→workout detail→adaptation proposal→outcome):**
- IA choice well-reasoned and doctrine-consistent: adaptation proposals live as a card on Today when live/answerable; Decisions (under Settings) is read-only history with zero buttons — "a decision with two homes is a decision that can be answered twice."
- Documented recent history of being built and invisible: `plan_workout_proposals` written since 2026-06-04 but the only Swift caller was the legacy v4 shell until fixed 2026-09-05 — "Production has SEVEN rows ever written, zero accepted, zero dismissed." Could not personally verify current live rendering of an active proposal card (no catalog entry renders one) — code path confirmed wired, not confirmed rendering correctly today.
- "Change the plan" sheet renders well; longest realistic trade-off string fits without breakage; refusal-state pattern (Alert, no confirm button) matches the design contract's rule that "a refusal is a correct answer."

**Journey 3 (Move a Run):** Covered by the same "Change the plan" sheet; no separate entry point found, consistent with the design's intent.

**Journey 4 (Race setup→race page→morning→execution→post-race):**
- **Reproducible sample-data bug confirmed by rendering:** two of eight Races decision-card catalog entries pass wrong-cased verdict literals (`"outOfReach"`/`"openEnded"` instead of kebab-case), causing `V5Feasibility`'s silent decode fallback to render "Cannot read it" instead of "Open ended" — for exactly the two shapes the design contract calls out as needing careful review. Architectural risk: a silent decode failure produces a specific, confident-looking wrong badge rather than a visibly-broken state.
- The visible amber tilde mark for modelled numbers was deliberately retired 2026-08-21 (David's own ruling) in favor of adjacent wording — but `docs/faff-iphone-design-contract.md` still states the tilde rule as active and unqualified, now stale against a later, deliberate product decision. Flagged as worth a deliberate re-check, not a straightforward defect.

**Journey 5 (Progress/fitness/evidence):** No dedicated Progress tab — folded into Races (Goal/Projected/Gap, evidence list, trend chart) and Today's "Where you are." Matches UX Simplification Doctrine's recommended shape in spirit. The Rule-16 "one quantity, one name" risk (three projected finishes historically) is structurally still possible given three independent-looking display sources — not confirmed a live defect from client code alone, listed as a verification item.

**Journey 6 (Shoes):** Clean, matches spec.

**Journey 7 (Health/readiness):** Readiness correctly folded into Today's inline expansion, matching the real `/api/readiness/brief` shape. **Found: a fuller, dedicated `ReadinessBriefSheet.swift` exists but its only caller is the retired v4 `TodayView.swift`** — V5's Today uses only the compact inline version. Missing-in-current-IA/present-in-retired-IA pattern.

**Journey 8 (Settings/connections):** Well-organized. "Coach voice" row is read-only with no control — may be intentional, reads like a setting with nothing to change.

**Journey 9 (Notifications/inbox):** **Most significant structural gap.** `NotificationInboxSheet.swift` exists, fully built, but its only callers are retired v4 files. No notification inbox/message history exists anywhere in the V5 shell despite the app clearly sending pushes (Settings has toggles for them, deep-link handling exists for six push shapes). No in-app way to re-read a missed/dismissed coach message.

**Journey 10 (Failure/offline/empty/etc.):**
- Data outage state well done (honest copy, Retry, layout-preserving skeletons) — minor gap: week strip disappears entirely rather than showing a skeleton.
- Off-season/Week off appropriately minimal, strong restraint.
- **Real content-consistency finding in Injury flare sample:** coach verdict says "3 days to settle... flagged 2 days ago" (not yet at day 3) while simultaneously showing a live "Cleared to return" section — traced to an independent `returnAvailable` boolean with nothing checking it against the verdict text. Whether this combination occurs from real backend data unverified without live account access; the sample demonstrates the two fields CAN disagree with nothing catching it.
- Multi-run/supplemental handling architecturally careful (matched-vs-supplemental respected end-to-end) but not rendered against a live multi-run day this pass.
- Onboarding welcome screen has unusually large dead vertical space, reads unfinished for a first impression.

## 3. Recommended target IA

**Verdict: the existing four-tab structure (Today/Block/Races/Run) is sound and should not be broken up** — it already matches the UX Simplification Doctrine's recommended shape almost exactly.

**What moves:** Past Runs — keep under Block, also add an entry point from Today's account sheet.

**What gets created:** A lightweight notification/coach-message history — NOT a tab, NOT a permanent Today section — reachable the same deliberate way Decisions is (one row in Settings or the account sheet), reusing `DecisionHistoryV5`'s read-only, three-state, "history not a second inbox" template.

**What gets merged:** Nothing — no genuine duplicate screens found, only duplicate data display (goal/projected/gap on three surfaces), which is a resolver-sharing concern, not an IA merge.

**What disappears:** Nothing — every screen found earns its place against the doctrine's own "what decision does this help the runner make" test.

## 4. Screen-level recommendations

| Screen | Verdict | Reason |
|---|---|---|
| Today (before/after) | Refine | Status-bar collision; recovery-run hero emptiness; unlabeled asked-pace figure |
| Block | Refine | Same status-bar collision bug |
| Races | Refine | Fix two mis-cased verdict samples; re-verify tilde-retirement doesn't leave other modelled values ambiguous |
| Race detail | Keep | Matches spec closely |
| Settings | Keep | Consider whether "Coach voice" needs a control or should be reworded |
| Shoes | Keep | Clean |
| Decisions | Keep | Good doctrine-aligned pattern; reuse for notification history |
| Injury flare | Refine | Fix `returnAvailable` vs verdict-text consistency |
| Data outage | Refine (light) | Give week strip a skeleton instead of disappearing |
| Off-season/Week off | Keep | Strong restraint |
| Onboarding welcome | Refine (light) | Reduce dead space |
| Notification inbox (legacy) | Create (V5 equivalent) | Currently unreachable |
| Readiness detail sheet (legacy) | Evaluate | Decide deliberately whether compact inline is sufficient |
| Past runs | Move (add 2nd entry point) | Keep under Block, add from Today |

## 5. Layout recommendations

- Reserve top safe-area space for content that can reach the top of a scroll view once the hero panel scrolls away — a single systemic fix at the shared scroll-container level (a permanent status-bar scrim was explicitly rejected by David, so the fix should be conditional on scroll position).
- Any unlabeled modelled number needs either a label or the visual mark back — one design decision to make once, not a per-screen patch.
- `PanelStatPlate`/`SessionDetailsGridV5` are good reuse candidates already in place and shared across screens — the right template for any new stat row.
- Nothing found rises to "deeper redesign" — every issue is a targeted fix, a signal the underlying architecture/component system is healthy.

## 6. Priority classification

**Release-blocking:** status-bar collision (Today/Block/Settings); the two mis-cased verdict strings; unlabeled asked-pace figure.

**High-value structural:** notification/coach-message history has no home; `InjuryFlareV5`'s returnAvailable/verdict-text inconsistency; empty recovery-run hero; deliberate decision needed on the legacy readiness sheet.

**Normal refinement:** Past Runs 2nd entry point; data-outage week-strip skeleton; route-card GPS/terrain clarifier.

**Polish:** onboarding dead space; "Coach voice" settings row.

**Later expansion:** readiness trend view (explicitly a deferred trade-off, not an oversight).
