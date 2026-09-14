//
//  StaleStateV5.swift
//  faff.run iPhone · DELETED (F024, 2026-09-14).
//
//  ─────────────────────────────────────────────────────────────────────────
//  WHY THIS FILE IS EMPTY, NOT ABSENT
//
//  This file used to define `StaleBannerV5` and `V5StaleBannerModifier` — the
//  top safe-area banner reading "Can't reach faff. Showing what you had ___
//  ago." with a Retry button, attached to Today, Block and Races via
//  `.v5StaleBanner(...)`.
//
//  David, 2026-09-14, urgent (OD-20260914-003 / ER-20260914-F024):
//
//    "If I see the banner again I'm going to lose it. This was never
//    happening before. There is no reason that these issues should be
//    happening."
//
//  The rejection is the behavior and placement, not the wording — no
//  rename, no recolor, no relocate, no rephrase of the same mechanism is
//  permitted to replace it. Per the owner-direction doc's own instruction
//  ("`StaleBannerV5`, `V5StaleBannerModifier`, previews, layout
//  accommodations, and banner-only tests get deleted once no valid consumer
//  remains — no dormant second truth left for later reuse"), the types are
//  gone, not commented out, and every call site (`HostsV5.swift`'s
//  `TodayHostV5`/`BlockHostV5`/`RacesHostV5`, `StateScreensV5.swift`'s
//  `StateScreenScaffold`) no longer references them.
//
//  The file itself is kept (rather than removed from the Xcode project) so
//  this note stays discoverable from the same path every historical comment
//  elsewhere in this app already points at — see `SurfaceStoreV5.swift`,
//  `PanelV5.swift`, `HostsV5.swift`, `BlockV5.swift`, `RacesV5.swift`,
//  `TodayBeforeV5.swift`, `TodayAfterV5.swift` for the surrounding comments
//  this deletion leaves as accurate history, not as documentation of live
//  behavior.
//
//  ─────────────────────────────────────────────────────────────────────────
//  WHAT REPLACES IT
//
//  Nothing does, by design. A failed background read on Today/Block now
//  renders the versioned local `PlanSnapshotStore` day instead of going
//  outage-shaped (see `HostsV5.swift`'s `TodayHostV5`/`BlockHostV5` —
//  OD-20260914-001 / F022), and a value that cannot be vouched for (e.g.
//  current readiness) is quietly omitted rather than disclosed with a
//  banner. `V5Surface.stale`/`cachedAt` still exist and still drive
//  background recovery (a debounced silent retry, `LateFailureBannerTests`'
//  own coverage) — UI deletion did not require deleting that internal
//  state, only the global visual disclosure built on top of it.
//
