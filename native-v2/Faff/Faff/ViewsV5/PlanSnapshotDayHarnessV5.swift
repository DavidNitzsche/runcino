//
//  PlanSnapshotDayHarnessV5.swift
//  faff.run iPhone · Rule 13, for the "Natural Coaching Experience" pass on
//  the race-day copy a runner reads when browsing to a future race in
//  Plan/Today (`PlanSnapshotDayView.swift` + the hero panel it renders
//  under, `HeroDayPanelContentV5`).
//
//  ─────────────────────────────────────────────────────────────────────────
//  THE PROBLEM THIS SOLVES
//
//  Rule 13: a change to something the runner sees is verified by RENDERING
//  it with real data, not by reading the code or a sample fixture. This
//  session had neither `DATABASE_URL_RO` nor David's own session token, so
//  signing in as him to browse to the real Santa Monica 10K day was not
//  possible. The sibling harnesses solve the identical problem for run
//  detail (`-faffRunDetail`) and the proposal surface (`-faffProposals`):
//  decode the SERVER'S OWN wire shape, with the REAL Decodable types, and
//  draw it with the REAL views. This is that same seam, one screen further
//  out — `PlanSnapshotDay`, the exact type `GET /api/v5/plan-snapshot`
//  sends and `PlanSnapshotStore` decodes on device.
//
//  WHAT IT PROVES: the decode, the exact copy this session's fix produces
//  wrapped in the real `Text` and the real `DayPanel`/`HeroDayPanelContentV5`
//  chrome — wrapping, contrast against the day's real gradient, and the
//  "Pace band" / "Projected finish" stats sitting next to the notes
//  sentence, which is the whole point of the fix (Rule 16: these are two
//  different quantities on one screen and the prose must not restate
//  either).
//  WHAT IT DOES NOT: the header/week-strip chrome (needs a live `V5Today`
//  surface model, unrelated to this change), the network hop, or the auth
//  layer. The numbers in a fixture file are realistic reconstructions of
//  the owner's real Santa Monica 10K row (see the fixture JSON's own
//  comment-free but documented provenance in the natural-coaching-1 report)
//  — not a live read — and anything verified this way says so.
//
//      xcrun simctl launch <udid> run.faff.app -faffPlanSnapshotDay santa-monica-10k.json
//
//  The file is read from the app's own Documents directory, same convention
//  as `-faffRunDetail`.
//

import SwiftUI

struct PlanSnapshotDayHarnessV5: View {
    let day: PlanSnapshotDay

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: V5.S.betweenGroups) {
                DayPanel(fill: day.fill) {
                    HeroDayPanelContentV5(
                        kicker: day.kicker,
                        type: day.type,
                        dose: day.dose?.value,
                        stats: day.stats.map { stat in
                            PanelStat(stat.label, stat.value.value, ink: stat.toneValue.inkOverride)
                        }
                    )
                }
                PlanSnapshotDayView(day: day)
            }
            .padding(.horizontal, V5.S.gutter)
            .padding(.bottom, V5.S.s24)
        }
        .background(V5.surfacePage)
        .preferredColorScheme(.dark)
    }
}
