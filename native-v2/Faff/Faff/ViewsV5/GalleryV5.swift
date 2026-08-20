//
//  GalleryV5.swift
//  faff.run iPhone · the v5 design system, on a device.
//
//  Every token, panel, component and chart in one scroll, so the parts of the
//  design that CANNOT be checked by reading code get checked on glass:
//
//    · the six day-state ramps, interpolated in oklab — the whole reason that
//      code exists is a hue crease at the midpoint that only shows on screen
//    · the grain layer, which is what keeps white type legible on a gradient
//      without a scrim, and which is either invisible or wrong
//    · Archivo 800 at width 112, which is not a named instance — a wrong-width
//      fallback looks almost correct in a screenshot and entirely correct in a
//      diff
//    · tabular figures, which only fail while a number is ticking
//    · the amber tilde's size and baseline against the value it marks
//
//  Reached with a launch argument rather than a build flag or a temporary edit
//  to the app's root, so checking the design never means touching shipping
//  code and never risks a half-edited root reaching a device:
//
//      xcrun simctl launch <udid> run.faff.app -faffV5Gallery
//

import SwiftUI

struct GalleryV5: View {
    @State private var expanded = false
    @State private var sheet = false
    @State private var steps = 5
    @State private var on = true
    @State private var text = ""

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: V5.S.s32) {

                header

                section("Day-state ramps · oklab, with grain") {
                    VStack(spacing: V5.S.inGroup) {
                        ForEach(V5.DayState.allCases, id: \.self) { s in
                            ZStack(alignment: .bottomLeading) {
                                V5Ramp.gradient(s)
                                    .v5Grain()
                                Text(s.rawValue)
                                    .faffDisplayV5(26, fit: false)
                                    .foregroundStyle(V5.OnPanel.primary)
                                    .padding(V5.S.s12)
                            }
                            .frame(height: 84)
                            .clipShape(RoundedRectangle(cornerRadius: V5.R.r18, style: .continuous))
                        }
                    }
                }

                section("Surface steps · containment is a fill change, never a hairline") {
                    VStack(spacing: 0) {
                        swatch("surface-page", V5.surfacePage)
                        swatch("surface-1", V5.surface1)
                        swatch("surface-2 / material-tile", V5.materialTile)
                        swatch("material-tile-raised", V5.materialTileRaised)
                        swatch("material-control", V5.materialControl)
                    }
                    .clipShape(RoundedRectangle(cornerRadius: V5.R.r18, style: .continuous))
                }

                section("Signals · one accent, one meaning each") {
                    HStack(spacing: V5.S.inGroup) {
                        signal("signal", V5.signal, "current value")
                        signal("attention", V5.attention, "outside range")
                        signal("fault", V5.fault, "could not read")
                    }
                }

                section("Display register · Archivo 800 / width 112") {
                    VStack(alignment: .leading, spacing: V5.S.s8) {
                        Text("Threshold").font(.faffDisplay(56)).textCase(.uppercase)
                        Text("Easy run").font(.faffDisplay(38)).textCase(.uppercase)
                        Text("Week 6 of 16").font(.faffDisplay(26)).textCase(.uppercase)
                        V5SectionLabel(text: "Before you go")
                    }
                    .foregroundStyle(V5.textPrimary)
                }

                section("Rule one · a modelled number never looks measured") {
                    VStack(alignment: .leading, spacing: V5.S.s12) {
                        row("Measured", FaffValue.measured("1:41:53"))
                        row("Modelled", FaffValue.modelled("3:16:45"))
                        row("Unreadable", FaffValue.unreadable)
                        Text("Only the mark is amber. The number keeps its own ink, or modelled would start to read as out of range.")
                            .font(.faffText(TypeScaleV5.label13))
                            .foregroundStyle(V5.textQuiet)
                    }
                }

                section("Tabular figures · these must not shift width") {
                    VStack(alignment: .leading, spacing: V5.S.s4) {
                        ForEach(["7:11", "8:00", "6:44", "9:38", "1:41:53", "11:11"], id: \.self) { t in
                            Text(t).font(.faffText(28, weight: .semibold))
                        }
                    }
                    .foregroundStyle(V5.textPrimary)
                }

                section("Rule three · three refusals, three different sentences") {
                    VStack(alignment: .leading, spacing: V5.S.inGroup) {
                        Alert(text: "A cutback on a taper week is not a cutback. The taper is already the cut.")
                        ErrorNote(text: "Readiness did not load. Your score is fine, we just cannot see it.") {}
                        Silence(reason: "There is no block yet, so there is nothing honest to say about how it is going.")
                    }
                }

                section("Lists · 58pt rows, no dividers") {
                    ListGroup(header: "Before you go", footer: "Tapping a row opens it here, never a new screen.") {
                        ListRow(label: "Shoes", sub: "Endorphin Speed 4",
                                value: .measured("238 mi"), onTap: {})
                        ExpandingRow(label: "Fuel", value: .measured("2 gels"),
                                     question: "How are you fuelling this one?",
                                     isExpanded: $expanded) {
                            VStack(spacing: V5.S.s6) {
                                ForEach(["Nothing", "One gel", "Two gels"], id: \.self) { o in
                                    Text(o).font(.faffText(TypeScaleV5.body15))
                                        .foregroundStyle(V5.textPrimary)
                                        .frame(maxWidth: .infinity, alignment: .leading)
                                        .padding(.horizontal, V5.S.s14x)
                                        .frame(height: 44)
                                        .background(V5.materialTile, in: RoundedRectangle(cornerRadius: V5.R.r16, style: .continuous))
                                }
                            }
                        }
                        ListRow(label: "Projected finish", value: .modelled("3:16:45"))
                    }
                }

                section("Coach voice") {
                    VStack(alignment: .leading, spacing: V5.S.inGroup) {
                        CoachSay(text: "Two more weeks of miles, then the work that decides the race arrives. Nothing about today is meant to feel hard yet.")
                        CoachCaveat(text: "The plan engine re-authors the surrounding weeks once it runs, so this is a forecast rather than the result.")
                    }
                }

                section("Charts · drawn from data, no assets") {
                    VStack(alignment: .leading, spacing: V5.S.s24) {
                        RangeScale(mode: .band, min: 420, max: 560,
                                   band: (low: 440, high: 465), value: 452,
                                   endpoints: ("7:00", "8:20"))
                        RangeScale(mode: .ceiling, min: 100, max: 190,
                                   band: (low: 100, high: 168), value: 174,
                                   endpoints: ("110", "180"))
                        ZoneBar(shares: [12, 76, 12, 0, 0], target: 2, labels: true)
                        PhaseBar(phases: [
                            PhaseSegment("Base", weeks: 8, current: true, at: 0.72),
                            PhaseSegment("Quality", weeks: 4),
                            PhaseSegment("Race specific", weeks: 3),
                            PhaseSegment("Taper", weeks: 1),
                        ])
                        WeekShape(days: [
                            WeekDayLoad(miles: 5.2), WeekDayLoad(miles: 0),
                            WeekDayLoad(miles: 8, quality: true), WeekDayLoad(miles: 6, today: true),
                            WeekDayLoad(miles: 5, future: true), WeekDayLoad(miles: 0, future: true),
                            WeekDayLoad(miles: 16, quality: true, future: true),
                        ], scaleMax: 20)
                        ElevationProfile(points: [120, 118, 114, 116, 108, 102, 98, 90, 84, 80, 76, 70, 64, 60, 55, 50, 44, 40, 36, 30, 24, 18, 10, 4, 0, 0],
                                         marks: [ElevationMark(at: 0.08, label: "Rollers, mile 3"),
                                                 ElevationMark(at: 0.5, label: "Big drop, mile 16")],
                                         footnotes: ["Net −120 ft", "Nothing over 2%"])
                        TrendBars(values: [62, 60, 57, 54, 51, 48, 45, 42, 39, 36, 33, 31, 29, 27, 25, 23, 21, 20, 19, 18, 17, 17, 18, 19, 21, 24, 27, 31, 36, 42],
                                  headline: .modelled("3:19:40"),
                                  headlineLabel: "Projected finish, today",
                                  footnotes: ["Twelve weeks of daily reads"])
                        DualPoint(leftLabel: "Was", leftValue: .modelled("6:44"),
                                  rightLabel: "Now", rightValue: .modelled("7:08"),
                                  gapLabel: "Threshold", gapValue: "+24 s/mi", tone: .attention)
                    }
                }

                section("Rule two · fewer than three domains renders nothing") {
                    VStack(alignment: .leading, spacing: V5.S.inGroup) {
                        ConvergenceList(domains: [
                            ConvergenceDomainRow(domain: "Sleep", value: .measured("5h 48m"), baseline: "7-day median 7h 10m"),
                            ConvergenceDomainRow(domain: "HRV", value: .measured("41 ms"), baseline: "7-day median 58 ms"),
                            ConvergenceDomainRow(domain: "Resting heart rate", value: .measured("54 bpm"), baseline: "3-day average 48 bpm"),
                        ])
                        ConvergenceList(domains: [
                            ConvergenceDomainRow(domain: "Sleep", value: .measured("5h 48m"), baseline: "7-day median 7h 10m"),
                        ])
                        Text("Two lists above. Only one drew.")
                            .font(.faffText(TypeScaleV5.label13))
                            .foregroundStyle(V5.textQuiet)
                    }
                }

                section("Controls") {
                    VStack(alignment: .leading, spacing: V5.S.inGroup) {
                        FaffButton("Hold the goal", variant: .primary) {}
                        FaffButton("Take 3:16:45", variant: .secondary) {}
                        FaffButton("Not now", variant: .ghost) {}
                        FaffButton("Sign out", variant: .destructive) {}
                        Tile {
                            FaffSwitch(label: "Start runs from this phone",
                                       sub: "Recording needs the app open and the screen on.",
                                       isOn: $on)
                            FaffStepper(label: "Days per week", value: $steps, range: 2...7,
                                        helper: "Five is where most of this plan's weeks sit.")
                            FaffInput(label: "Goal time", text: $text, placeholder: "e.g. 3:30:00",
                                      helper: "Optional. The coach can set one later from your fitness alone.")
                        }
                        FaffButton("Open a sheet", variant: .secondary) { sheet = true }
                    }
                }

                section("Skeleton · reserves height, does not pulse") {
                    Skeleton(lines: 3)
                }

                Color.clear.frame(height: V5.S.s56)
            }
            .padding(.horizontal, V5.S.gutter)
            .padding(.top, V5.S.s24)
        }
        .background(V5.surfacePage.ignoresSafeArea())
        .scrollIndicators(.hidden)
        .overlay {
            V5SheetHost(isPresented: $sheet, title: "Start the run") {
                RunPickerV5(onOutdoor: { sheet = false },
                            onTreadmill: { sheet = false },
                            onCancel: { sheet = false })
            }
        }
        .preferredColorScheme(.dark)
    }

    // MARK: - bits

    private var header: some View {
        VStack(alignment: .leading, spacing: V5.S.s4) {
            Text("faff v5")
                .font(.faffDisplay(TypeScaleV5.display44))
                .textCase(.uppercase)
                .foregroundStyle(V5.textPrimary)
            Text("The design system, on glass.")
                .font(.faffText(TypeScaleV5.body15))
                .foregroundStyle(V5.textQuiet)
        }
    }

    private func section<C: View>(_ title: String, @ViewBuilder _ content: () -> C) -> some View {
        VStack(alignment: .leading, spacing: V5.S.s12) {
            V5SectionLabel(text: title)
            content()
        }
    }

    private func swatch(_ name: String, _ c: Color) -> some View {
        HStack {
            Text(name)
                .font(.faffText(TypeScaleV5.label13))
                .foregroundStyle(V5.textSecondary)
            Spacer()
        }
        .padding(.horizontal, V5.S.tilePad)
        .frame(height: 44)
        .background(c)
    }

    private func signal(_ name: String, _ c: Color, _ meaning: String) -> some View {
        VStack(alignment: .leading, spacing: V5.S.s6) {
            RoundedRectangle(cornerRadius: V5.R.r10, style: .continuous)
                .fill(c).frame(height: 44)
            Text(name).font(.faffText(TypeScaleV5.label12, weight: .semibold))
                .foregroundStyle(V5.textPrimary)
            Text(meaning).font(.faffText(TypeScaleV5.label12))
                .foregroundStyle(V5.textQuiet)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func row(_ label: String, _ v: FaffValue) -> some View {
        HStack {
            Text(label).font(.faffText(TypeScaleV5.body15)).foregroundStyle(V5.textQuiet)
            Spacer()
            FaffValueText(v, font: .faffText(28, weight: .semibold))
        }
    }
}

#Preview { GalleryV5() }
