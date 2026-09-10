# Brain v2 → v2.1 Delta Log

Narrow correction pass over Brain v2, not a re-run. Organized by the 7 items in the correction brief plus the 4-item Coach-v2 addendum.

1. **Historical mutation inventory.** September 2 "76 workouts" downgraded from implicitly-confirmed to explicitly DISPUTED/UNCONFIRMED — only 23 rows at the post-anchor LTHR value were found, no discrete audit-trail mechanism exists to confirm the count or date. August 26 downward easy-day rebuild (7→4mi, `-42.9%`) added as its own row — was missing from v2 entirely. Table is now 7 non-overlapping rows across 5 mechanisms.
2. **`positive-drift` traced end to end (new investigation).** Verdict: RETIRED. It was an ungated automatic side door when live (2026-05-24/25), structurally identical in shape to `reanchorLthr`, but its code lives entirely in `legacy/web`, which the live Railway build does not build or start. Reconciles cleanly with "Change behavior: NO."
3. **Re-anchor caller count corrected.** "At least 3 of 5 unattended" → precisely 2 unattended scheduled crons, 1 operator-dispatched job (not the same category as unattended), 2 runner-initiated requests. All 5 still reach `reanchorLthr()` ungated — that finding is unchanged.
4. **`mark_upgrade` reworded.** API response (source-confirmed) and runner-visible acknowledgement (still `[BLOCKED: not rendered]`) are now stated as two separate claims, not one.
5. **Decision-ledger callers.** Definitive 8-file/11-call-site table published with exact file:line for every entry, plus the 3 explicitly-excluded false positives named.
6. **Provenance precision.** New table states exactly which inputs were read directly (with hashes) versus received only as chat-relayed excerpts and independently re-verified before use, versus never opened at all.
7. **Deliverable form.** One standalone v2.1 document produced; this delta log is a summary only, not required reading to understand v2.1.

**Coach-v2 addendum (4 items, all pinned to `origin/main @ 99757c1204f27a1fa86504efd580842bc81c72b2`):**

8. `reopenProposal()` on Apply failure: PARTIALLY SUPERSEDED — confirmed present, but only on the legacy accept lane; the two modern lanes (`ACTIONCOMPLETE-1`, `reprice`) still lack it.
9. `HowItWentPanel`'s two HR-drift ladders: DOWNGRADED from live second-Brain to confirmed dead code — the panel's only live caller pre-filters to a code path that never reaches either disputed component.
10. Race projection: number confirmed still unified; label is NOT unified by design in the common case (List: "Projected"; Detail: "Race it at"/"Run the day at" when the newer layer set is present, deliberately suppressing its own "Projected" plate per Rule 17). Both facts stand together.
11. Tune-up race "frequency-cap copy branch": CONTRADICTED — no such branch exists at the pinned commit. C-race scheduling itself re-confirmed unchanged and correct.

Full detail for every item above is in the standalone v2.1 report; nothing here should be treated as more authoritative than that document.
