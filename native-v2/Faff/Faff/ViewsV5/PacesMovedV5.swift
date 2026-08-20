//
//  PacesMovedV5.swift
//  faff.run iPhone · 18a — Paces slower / faster.
//
//  ─────────────────────────────────────────────────────────────────────────
//  ONE MIRRORED COMPONENT, THREE DATA VARIANTS
//
//  `V5PaceDirection` picks the tone and the accent; it never picks the
//  structure. All three variants render the same shape in the same order:
//  a quiet-fill panel with the headline and coach line, a per-zone
//  before/after table, an evidence list, and a confirm section. There is no
//  `switch direction` anywhere below that changes WHAT is on screen, only
//  what copy and controls fill the confirm section — see `confirmSection`.
//
//  ─────────────────────────────────────────────────────────────────────────
//  RULE ONE, PER ZONE, NOT PER SCREEN
//
//  "Zones do not move by the same amount" — a three-point fitness drop moves
//  threshold +24 s/mi, interval +22, rep +19 — so there is deliberately no
//  single headline delta anywhere on this screen, only the per-zone
//  `DualPoint` rows built from `zoneRow(_:)` below.
//
//  The prototype draws one amber tilde to the LEFT of each modelled zone
//  row, ahead of the whole `DualPoint`. This view does not hand-draw that
//  glyph: `DualPoint`'s own before/after values are `FaffValue`s built from
//  each zone's `V5Number`, and `FaffValueText` marks a modelled value on its
//  own. That means a modelled zone here carries the mark on BOTH its before
//  and after readings rather than one glyph ahead of the pair — a stricter
//  reading of rule one than the mock's single leading tilde, reached through
//  the kit's own sanctioned mechanism (`FaffValue` → `FaffValueText`) rather
//  than a hand-drawn "~" that `check-modelled-mark.sh` exists to catch.
//
//  `faster-race` zones arrive as `.measured` (the server sends
//  `modelled: false` on both readings), so they carry no mark at all — hard
//  evidence is not something to soften.
//
//  ─────────────────────────────────────────────────────────────────────────
//  THE SLOWER CONFIRM IS NOT ACCEPT/DENY
//
//  "Paces come from evidence; declining them outright would mean training at
//  paces the runner's fitness does not support." So `confirm.options` is
//  rendered as a plain `ListGroup` of choices — never a yes/no button pair —
//  and every option in it, including "it was compromised" and "no, it
//  doesn't count", is a real answer the engine already knows how to act on,
//  not a refusal of the read. `faster-race` alone collapses this section to
//  the single `actionLabel` button the contract calls for, because a race
//  result is not noise to dismiss.
//
//  ─────────────────────────────────────────────────────────────────────────
//  A CONTRACT GAP, NOTED RATHER THAN PAPERED OVER
//
//  The prototype's header carries a small "Since 6 July" / "Cedar Falls Half
//  · 3 Aug" line above the headline (`paceDrop.since`), and each zone row
//  carries its own before/after DATE labels ("6 Jul" / "Now"). Neither
//  reaches the wire: `V5Paces` has no `since` field and `V5PaceZone` has no
//  per-row date labels. Rather than fabricate a date the payload doesn't
//  carry, this view omits the "Since …" line entirely and labels every zone
//  row with the generic "Was" / "Now" pair the design system's own gallery
//  sample already uses for an unlabelled before/after (see
//  `GalleryV5.swift`'s `DualPoint(leftLabel: "Was", …)`). Same for
//  `evidenceHeader` / `confirmHeader`: only `confirm.question` is on the
//  wire, so the evidence list's header is chosen from `direction` rather
//  than invented, and the confirm header falls back to a direction-specific
//  default only when `confirm.question` is absent.
//

import SwiftUI

struct PacesMovedV5: View {
    let paces: V5Paces

    var initials: String = "JR"
    var onOpenAccount: () -> Void = {}

    /// Fires after a confirm option is tapped, once the write finishes.
    /// Nothing here refetches or navigates — the caller decides what a
    /// settled pace read should do next (e.g. re-pull `/api/v5/paces`).
    var onSettled: (() -> Void)? = nil

    @State private var settledOption: V5Row?
    /// Set once the single-action (race-confirmed) button completes, since
    /// that path has no `V5Row` option to remember alongside it.
    @State private var settledButtonFired = false
    @State private var isBusy = false

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: V5.S.betweenGroups) {
                header
                CoachSay(text: paces.coachLine, size: .md)
                zonesSection
                evidenceSection
                confirmSection
            }
            .padding(.horizontal, V5.S.gutter)
            .padding(.bottom, V5.S.s24)
        }
        .background(V5.surfacePage)
        .scrollIndicators(.hidden)
    }

    // MARK: - Header
    //
    // Quiet fill — no gradient, the same designed state 13a/19a use because
    // there is nothing here to prescribe. On a quiet fill the design paints
    // with the plain text tokens, not the on-panel (white-at-opacity) set
    // the gradient screens use.

    private var header: some View {
        DayPanel(fill: .quiet) {
            HStack(alignment: .center, spacing: V5.S.s12) {
                Text("Season")
                    .font(.faffDisplay(20))
                    .textCase(.uppercase)
                    .tracking(20 * 0.02)
                    .foregroundStyle(V5.textPrimary)
                Spacer(minLength: 0)
                Button(action: onOpenAccount) {
                    Text(initials)
                        .font(.faffText(12, weight: .semibold))
                        .foregroundStyle(V5.textPrimary)
                        .frame(width: V5.Shell.headerButton, height: V5.Shell.headerButton)
                        .background(V5.materialControl, in: Circle())
                }
                .buttonStyle(V5PressStyle())
            }

            Text(paces.headline)
                .font(.faffDisplay(TypeScaleV5.display44))
                .textCase(.uppercase)
                .foregroundStyle(V5.textPrimary)
        }
    }

    // MARK: - Zones
    //
    // "Every zone, its own shift" — the design's own constant header across
    // all three variants, so it is fixed copy here rather than a field.

    private var zonesSection: some View {
        VStack(alignment: .leading, spacing: V5.S.s10) {
            V5SectionLabel(text: "Every zone, its own shift")

            VStack(alignment: .leading, spacing: 0) {
                ForEach(paces.zones) { zone in
                    zoneRow(zone)
                }
            }
            .padding(.vertical, V5.S.s6)
            .background(V5.materialTile, in: RoundedRectangle(cornerRadius: V5.R.r22, style: .continuous))

            if let caption = paces.caption {
                modelledCaption(caption)
            }
        }
    }

    private func zoneRow(_ zone: V5PaceZone) -> some View {
        VStack(alignment: .leading, spacing: V5.S.s4) {
            Text(zone.name)
                .font(.faffText(TypeScaleV5.label13))
                .foregroundStyle(V5.textQuiet)
                .padding(.horizontal, V5.S.tilePad)
            DualPoint(leftLabel: "Was", leftValue: zone.before.value,
                      rightLabel: "Now", rightValue: zone.after.value,
                      gapLabel: "Moved", gapValue: zone.delta,
                      tone: .attention, size: .sm)
        }
    }

    /// "~ Modelled from training · not confirmed by a race" — the mark here
    /// is the same `Theme.V5.modelledMark` token `FaffValueText` renders, not
    /// a hand-typed "~", so it stays inside the one place the build gate
    /// allows the glyph to be named.
    private func modelledCaption(_ text: String) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: V5.S.s4) {
            Text(Theme.V5.modelledMark)
                .font(.faffText(TypeScaleV5.label13))
                .foregroundStyle(V5.attention)
            Text(text)
                .font(.faffText(TypeScaleV5.label13))
                .foregroundStyle(V5.textQuiet)
        }
        .padding(.horizontal, V5.S.s4)
    }

    // MARK: - Evidence
    //
    // Training causes on a modelled read; the race, finish and effort on a
    // race-confirmed one. Either way it is `paces.evidence`, unchanged.

    private var evidenceHeader: String {
        paces.direction == .fasterRace ? "The evidence" : "Also true this month"
    }

    private var evidenceSection: some View {
        ListGroup(header: evidenceHeader) {
            ForEach(paces.evidence) { row in
                ListRow(label: row.label, sub: row.sub)
            }
        }
    }

    // MARK: - Confirm
    //
    // `actionLabel` present ⇒ one action, no choices (faster-race). Its
    // absence ⇒ a list of real answers (slower's representativeness question,
    // or faster-training's "is this the new normal").

    private var confirmHeaderFallback: String {
        switch paces.direction {
        case .slower:         return "Did this race count?"
        case .fasterTraining: return "Is this the new normal"
        case .fasterRace:     return "Lock these in"
        }
    }

    private var confirmSection: some View {
        VStack(alignment: .leading, spacing: V5.S.s10) {
            V5SectionLabel(text: paces.confirm.question ?? confirmHeaderFallback)

            if let actionLabel = paces.confirm.actionLabel {
                FaffButton(actionLabel, variant: .primary, size: .lg, enabled: !isBusy) {
                    confirm(tier: paces.confirm.options.first?.action ?? "confirm",
                            settleWith: nil)
                }
            } else {
                VStack(spacing: 0) {
                    ForEach(paces.confirm.options) { option in
                        ListRow(label: option.label, sub: option.sub) {
                            confirm(tier: option.action ?? "confirm", settleWith: option)
                        }
                    }
                }
                .background(V5.materialTile, in: RoundedRectangle(cornerRadius: V5.R.r22, style: .continuous))
            }

            // The settled note reuses the tapped option's own `sub` — copy
            // the server already wrote to describe that option's outcome —
            // rather than a client-composed sentence guessing at one.
            if let settledOption {
                Text(settledOption.sub ?? "Logged.")
                    .font(.faffText(TypeScaleV5.label13))
                    .foregroundStyle(V5.textSecondary)
                    .padding(.horizontal, V5.S.s4)
            } else if settledButtonFired {
                Text("Updated.")
                    .font(.faffText(TypeScaleV5.label13))
                    .foregroundStyle(V5.textSecondary)
                    .padding(.horizontal, V5.S.s4)
            }
        }
    }

    /// "Did this race count?" is never accept/deny — answering `compromised`
    /// or `unrepresentative` still falls back to the next-best anchor on the
    /// SERVER; this view only reports which tier the runner picked. There is
    /// deliberately no case here for "go back to my old paces".
    ///
    /// ─────────────────────────────────────────────────────────────────────
    /// ONLY ONE OF THE THREE CONFIRMS IS A RACE QUESTION
    ///
    /// `V5PaceConfirm.kind` says which section this is, and they are not
    /// interchangeable:
    ///
    ///   race_counted  the slower read, anchored on a race. The runner's
    ///                 answer is evidence the engine does not have, and it
    ///                 goes to the server.
    ///   update        a race-confirmed faster read. The re-anchor already
    ///                 happened off a real result; the button acknowledges it.
    ///   dismiss       a modelled read the runner is setting aside.
    ///
    /// Posting a representativeness tier for the last two would file an answer
    /// to a question nobody asked — the same mistake the Races card's
    /// fact/choice split exists to prevent — and with `raceSlug` nil it would
    /// post an empty slug on top of that. So the write happens for
    /// `race_counted` and a real slug, and nowhere else.
    private func confirm(tier: String, settleWith option: V5Row?) {
        guard !isBusy else { return }
        isBusy = true
        Task {
            if paces.confirm.kind == "race_counted",
               let slug = paces.confirm.raceSlug, !slug.isEmpty {
                _ = try? await API.confirmRaceAuthority(slug: slug, tier: tier)
            }
            await MainActor.run {
                isBusy = false
                if let option {
                    settledOption = option
                } else {
                    settledButtonFired = true
                }
                onSettled?()
            }
        }
    }
}

// MARK: - Preview

#Preview("18a · slower, modelled") {
    PacesMovedV5(paces: PacesMovedV5Sample.slower)
        .preferredColorScheme(.dark)
}

#Preview("18a · faster, training-modelled") {
    PacesMovedV5(paces: PacesMovedV5Sample.fasterTraining)
        .preferredColorScheme(.dark)
}

#Preview("18a · faster, race-confirmed") {
    PacesMovedV5(paces: PacesMovedV5Sample.fasterRace)
        .preferredColorScheme(.dark)
}

/// Verbatim from the prototype's `PACE_SHIFT` constant
/// (`docs/design/iphone-v5/reference/screens/_script-data.js`), decoded
/// through `V5Paces` rather than constructed in Swift.
enum PacesMovedV5Sample {
    static let slower: V5Paces = decode("""
    {
      "direction": "slower",
      "headline": "Paces slower",
      "coachLine": "Every zone reads slower, and by different amounts \\u00b7 threshold moved 24 sec, rep pace only 19. The re-anchor is real \\u00b7 what is behind it is not confirmed yet.",
      "zones": [
        { "id": "threshold", "name": "Threshold", "before": { "text": "7:10", "modelled": true }, "after": { "text": "7:34", "modelled": true }, "delta": "+24" },
        { "id": "interval", "name": "Interval", "before": { "text": "6:39", "modelled": true }, "after": { "text": "7:01", "modelled": true }, "delta": "+22" },
        { "id": "rep", "name": "Rep", "before": { "text": "5:37", "modelled": true }, "after": { "text": "5:56", "modelled": true }, "delta": "+19" }
      ],
      "caption": "Modelled from training \\u00b7 not confirmed by a race",
      "evidence": [
        { "id": "mileage", "label": "Weekly mileage", "sub": "Up 18% over six weeks", "value": null, "action": null },
        { "id": "cutback", "label": "Cutback weeks", "sub": "Two in a row were skipped", "value": null, "action": null },
        { "id": "sleep", "label": "Sleep average", "sub": "Down 40 min a night since June", "value": null, "action": null }
      ],
      "confirm": {
        "kind": "race_counted",
        "question": "Did this race count?",
        "options": [
          { "id": "representative", "label": "Yes, it counts", "sub": "Every pace band moves to match, starting tomorrow", "value": null, "action": "representative" },
          { "id": "compromised", "label": "It was compromised", "sub": "Heat, illness, or something threw it off", "value": null, "action": "compromised" },
          { "id": "unrepresentative", "label": "No, it doesn\\u2019t count", "sub": "Paced a friend, or ran it as a workout", "value": null, "action": "unrepresentative" }
        ],
        "actionLabel": null,
        "raceSlug": "cedar-falls-half"
      }
    }
    """)

    static let fasterTraining: V5Paces = decode("""
    {
      "direction": "faster-training",
      "headline": "Paces faster",
      "coachLine": "Every zone reads quicker in training, and by different amounts \\u00b7 threshold moved 14 sec, rep pace only 9. Modelled from sessions, not confirmed by a race \\u00b7 the read stays capped until one is.",
      "zones": [
        { "id": "threshold", "name": "Threshold", "before": { "text": "7:34", "modelled": true }, "after": { "text": "7:20", "modelled": true }, "delta": "\\u201214" },
        { "id": "interval", "name": "Interval", "before": { "text": "7:01", "modelled": true }, "after": { "text": "6:49", "modelled": true }, "delta": "\\u201212" },
        { "id": "rep", "name": "Rep", "before": { "text": "5:56", "modelled": true }, "after": { "text": "5:47", "modelled": true }, "delta": "\\u20129" }
      ],
      "caption": "Modelled from training \\u00b7 not confirmed by a race",
      "evidence": [
        { "id": "mileage", "label": "Weekly mileage", "sub": "Steady for six weeks, nothing spiked", "value": null, "action": null },
        { "id": "long-runs", "label": "Long runs", "sub": "Every one has hit its target since June", "value": null, "action": null },
        { "id": "sleep", "label": "Sleep average", "sub": "Up 20 min a night since June", "value": null, "action": null }
      ],
      "confirm": {
        "kind": "update",
        "question": "Is this the new normal",
        "options": [
          { "id": "confirm", "label": "Confirm it", "sub": "Every pace band tightens to match, capped until a race confirms it", "value": null, "action": "confirm" },
          { "id": "noise", "label": "Just a good patch", "sub": "Keep training on today\\u2019s bands", "value": null, "action": "noise" }
        ],
        "actionLabel": null,
        "raceSlug": null
      }
    }
    """)

    static let fasterRace: V5Paces = decode("""
    {
      "direction": "faster-race",
      "headline": "Paces faster",
      "coachLine": "Cedar Falls confirmed it \\u00b7 a half marathon run at 7:01 pace is hard evidence, not a guess. Every zone below moves to match.",
      "zones": [
        { "id": "threshold", "name": "Threshold", "before": { "text": "7:34", "modelled": false }, "after": { "text": "7:04", "modelled": false }, "delta": "\\u201230" },
        { "id": "interval", "name": "Interval", "before": { "text": "7:01", "modelled": false }, "after": { "text": "6:31", "modelled": false }, "delta": "\\u201230" },
        { "id": "rep", "name": "Rep", "before": { "text": "5:56", "modelled": false }, "after": { "text": "5:30", "modelled": false }, "delta": "\\u201226" }
      ],
      "caption": null,
      "evidence": [
        { "id": "race", "label": "Race", "sub": "Cedar Falls Half, 13.1 mi", "value": null, "action": null },
        { "id": "finish", "label": "Finish", "sub": "1:32:04", "value": null, "action": null },
        { "id": "effort", "label": "Effort", "sub": "All-out, not a tempo effort", "value": null, "action": null }
      ],
      "confirm": {
        "kind": "update",
        "question": "Lock these in",
        "options": [
          { "id": "confirm", "label": "Update my paces", "sub": "Every zone moves to match, starting tomorrow", "value": null, "action": "confirm" }
        ],
        "actionLabel": "Update my paces",
        "raceSlug": "cedar-falls-half"
      }
    }
    """)

    private static func decode(_ json: String) -> V5Paces {
        // swiftlint:disable:next force_try
        try! JSONDecoder().decode(V5Paces.self, from: Data(json.utf8))
    }
}
