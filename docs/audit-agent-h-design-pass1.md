# Agent H — Design System & Interaction Quality Audit (Pass 1, verbatim)

Pinned SHA: f1d1def0bedbb6db76c86ec89f8dc16f3ff9715d

## Methodology and what "rendered" means in this report

- **Design source located:** `/Volumes/WP/06 Claude Code/Faff/design/0819/design_handoff_faff_iphone_app v5/README.md` resolves and was read in full. The alternate path in the task brief, `/Volumes/WP/06 Codex/Faff/design/0819/...`, does not exist on this machine. Also read in full: `docs/faff-iphone-design-contract.md`, `CLAUDE.md`'s design-source section, and `docs/PRODUCT_COACHING_DOCTRINE.md` §30 (Coaching Voice).
- **Build/render:** Copied `Secrets.example.xcconfig`→`Secrets.xcconfig`, created a dedicated simulator (`iPhone 15 Pro`), built the `Faff` scheme via `xcodebuild` (succeeded). Rendering done headlessly via `xcrun simctl launch` + `xcrun simctl io screenshot`.
- **Data source for rendering:** `DATABASE_URL_RO` not set; no live server available. Used the app's own `ScreensCatalogV5` harness (`-faffV5Screens <id>`) — a 62-entry, developer-maintained inventory of every v5 screen and state. Captured 30 screens/states at both default and maximum accessibility Dynamic Type. Disclosed as sample-shaped rendering, not live-account data.

## 0. Architecture finding that governs everything else

`FaffApp.swift`'s `RootContainer` shows the v5 shell (`FaffV5Root`) is the live default. The legacy v4 shell (`RootTabView`) is reachable only behind `-faffLegacy` — a debug/rollback escape hatch, not a shipping path.

- `Views/*.swift` (48 files) is riddled with `Theme.green` used as a "good/ready/on-course" grade color (40 call sites, 13 files) — a direct violation of the locked "no green anywhere" rule. This is real, still-compiling code, but unreachable by any real runner today. Confirms and extends CLAUDE.md's own already-tracked, self-expiring palette debt.
- `ViewsV5/`/`DesignV5/` (the live 76 files): zero `Color.green`/`.green` hits. The live surface is clean on this dimension.
- `TokensV5.swift`/`ThemeV5.swift` are a genuinely mature, self-auditing token layer — header comments already document measured contrast ratios and prior fixes with citations to actual measured numbers.

## 1. Screen/state inventory (ground truth: ScreensCatalogV5.swift, 62 entries)

Extensive per-workout-shape/state coverage confirmed across Today, Block, Races, Race detail, Past runs/Run detail, Injury/Sick/Return, Week off/Off-season/Outage, Paces moved, Onboarding, Settings/Shoes, Add race, Live run.

**Gaps in the harness's own self-coverage (not necessarily gaps in the product):** No catalog entry for Add-Shoe, no entry for the training-calendar sheet, no entry for the Account sheet, no entry for the Health surface page.

## 2. Design-system compliance

Palette verified at the token level — hex values match the README's stated values exactly across all six gradient triplets and the core palette. Measured contrast-ratio claims in the token files' own headers spot-checked and found plausible/consistent, not re-derived from scratch.

No hardcoded hex/color literals found in ViewsV5/DesignV5 outside the two token files themselves.

**Typography — 14 `.system()` font sites found in the live v5 layer** (`LiveRunWatchCompanionV5.swift`, `LiveRunTreadmillV5.swift`, `ShellV5.swift`, `ChartsV5.swift`, `ComponentsV5.swift` x6, `WorkoutResultV5.swift` x2) that bypass `faffText`/`faffDisplay`, losing tabular figures and the documented Dynamic Type ceiling. REFINE, priority 3.

## 3. Component consistency

V5 layer is canonical, not duplicated — a single 30-component library (`DesignV5/ComponentsV5.swift`) that every screen checked composes from. No screen-local reinvention found in the live layer.

Refusal vs. error correctly implemented as two different components (`Alert(tone: .attention)` for refusals, `ErrorNote` for data-outage/fault) at every site checked.

One `Alert(text:...)` call (`BlockV5.swift:863`) omits the `tone:` parameter, default not confirmed — REFINE, priority 4.

## 4. Nielsen heuristic findings

**H1 — Visibility of system status: RELEASE-BLOCKING VIOLATION, RENDERED AND REPRODUCIBLE.** Screen: Live run · Treadmill (`12b`), any phase whose label is long enough to reach the top-right corner (confirmed with "Warm up"). The current-interval label is occluded by an independently-positioned `cuesMenu` overlay — confirmed at both default and maximum Dynamic Type, so not a scaling artifact but a fixed geometric collision. Reproduction: `xcrun simctl launch <udid> run.faff.app -faffV5Screens 12b`. This is the one glanceable-from-a-few-feet console in the app, and the finding is on exactly the text it exists to make legible.

**H4 — Consistency and standards: Meets**, no counter-finding beyond the `.system()` font sites.

**H5 — Error prevention: Meets.** The refusal/error split is correctly wired at every site checked.

**H8 — Aesthetic and minimalist design: Partial.** The `ScreensCatalogV5` harness's own floating "Close" pill occludes the real action-button row on `7a` (Races) — explicitly disclosed as harness chrome, not a product defect, but it means the Races decision-card's three-button row could not be fully visually verified this pass. Flagged as unverified-cleanly rather than claimed-fixed.

**Positive finding worth stating plainly:** the Dynamic Type ceiling behavior (`FontsV5.swift`) is a rare example of a documented, falsifiable, cited design decision (measured fact, fix, reasoning, and a named audit escape hatch to re-verify). Independently re-tested and confirmed consistent with the header's description.

## 5. iOS platform conventions

Dynamic Type tested at default and AX5 on two screens: body text correctly scales, display/value registers correctly stay fixed by design, no clipping found at either size on the screens tested. The treadmill console's H1 collision is present at both sizes equally (Dynamic Type doesn't worsen or fix it).

A comment in `FontsV5.swift` cites "the audit report" for per-screen Dynamic Type break points — no such report was locatable in this repo. Rule-20-class gap (uncited claim).

Status bar ink correctly flips per ramp (confirmed in source, not independently re-measured). Home indicator/safe area reads the real device inset via GeometryReader rather than hardcoding the design's fixed assumption.

## 6. Terminology and iconography (partial — time-boxed)

Refusal/error/outage language used with disciplined, distinct meaning across screens sampled. Modelled-number marking is singular and canonical (one `FaffValue.modelled` case, no stray tilde literals) — Rule 16 honored on this mechanism. Icons use SF Symbols consistent with the design's own instruction. Full cross-screen icon-meaning inventory not completed this pass — disclosed as a known gap.

## 7-8. Recommendation register

| # | Finding | Class | Priority |
|---|---|---|---|
| 1 | Treadmill (`12b`) cues-menu overlay occludes the current-interval label at all Dynamic Type sizes | REFINE | 1 — release-blocking |
| 2 | 40 sites/13 legacy `Views/*.swift` files use `Theme.green` as a grade | REMOVE (once `-faffLegacy` retired) | 2 — high-value, currently unreachable |
| 3 | 14 `.system()` font sites in the live layer bypass `faffText` | REFINE | 3 |
| 4 | `BlockV5.swift:863` Alert omits `tone:` | REFINE | 4 |
| 5 | Races (7a) three-button row could not be cleanly rendered without harness occlusion | Verification gap | Re-verify |
| 6 | `FontsV5.swift` cites an unlocatable "audit report" | Rule-20-class gap | 3 |
| 7 | ScreensCatalogV5 has no entry for Add-Shoe/calendar sheet/Account sheet | CREATE (catalog coverage) | 4 |
| 8 | Palette, tilde-mark, refusal/error discipline clean in the live layer | KEEP | positive finding |

## Honest scope disclosure

Rendered 30 of 62 cataloged screens/states, 2 of ~7 Dynamic Type categories, using sample-fixture data. The one confirmed, reproducible, previously-undocumented defect is the treadmill interval-label occlusion; everything else is either confirmation of already-tracked debt, a scoped refinement, or an explicit disclosure of a verification limit.
