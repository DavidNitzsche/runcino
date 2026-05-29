//
//  ProfileView.swift  — iPhone ME tab · PAPER GUT (2026-05-29).
//
//  No longer a stack of rounded FieldCard grids + bordered rows. It is a
//  dense editorial record — an identity spine over hairline-ruled
//  SpecRows, per docs/DESIGN_OVERHAUL_2026-05-29.md:
//
//    1) IDENTITY SPINE  — FAFF wordmark · ME · name · training-for /
//                         experience spec line.
//    2) DISPATCH        — coach identity-mode voice (surface=profile).
//    3) PERSONAL        — gender · birthday · height · city · experience
//                         as ruled SpecRows (HEIGHT taps the editor).
//    4) PHYSIOLOGY      — LTHR · MAX HR · RESTING HR · VDOT SpecRows with
//                         provenance meta.
//    5) HR ZONES        — Z1…Z5 as ruled rows (bpm range + purpose).
//    6) SHOE ROTATION   — per-shoe wear rows with % + status dot.
//    7) CONNECTIONS     — Strava / Health / Watch live-state rows.
//    8) ACTIONS         — Health · Run log · Form tips · Settings · Log
//                         manual run · Account, each pushing its sheet.
//    9) STAMP FOOTER.
//
//  Cardinal Rules honoured: zero-LLM (facts only, "—" never fabricated),
//  watch untouched, token-driven (Theme.*) for one-swap dark revert. ALL
//  the data plumbing + every sheet (Height / Settings / ManualRun /
//  Onboarding / Log / Tips / Health) is preserved verbatim — only the
//  visual shell is gutted.
//

import SwiftUI

struct ProfileView: View {
    @State private var showHeightSheet = false
    @State private var showSettingsSheet = false
    @State private var showManualRunSheet = false
    @State private var showOnboardingSheet = false
    @State private var showLogSheet = false
    @State private var showTipsSheet = false
    @State private var showHealthSheet = false
    @StateObject private var tokenStore = TokenStore.shared
    @State private var briefing: Briefing? =
        AppCache.read(.profileBriefing, as: Briefing.self)
    @State private var profile: ProfileState? =
        AppCache.read(.profileState, as: ProfileState.self)

    private let hPad: CGFloat = 20

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    identitySpine

                    // DISPATCH — coach identity-mode voice. Background-loads.
                    CoachSlot(briefing: briefing, surface: "profile", askPrompt: nil)
                        .padding(.top, 8)

                    personalSection

                    anchorsSection

                    if let zt = profile?.physiology.zones, !zt.zones.isEmpty {
                        zonesSection(zt)
                    }

                    if let shoes = profile?.shoes, !shoes.isEmpty {
                        shoesSection(shoes)
                    }

                    connectionsSection

                    actionsSection

                    stampFooter
                }
                .padding(.bottom, 44)
                .animation(.spring(response: 0.45, dampingFraction: 0.85), value: briefing?.lead)
                .animation(.spring(response: 0.45, dampingFraction: 0.85), value: profile?.identity.full_name)
            }
            .background(Theme.bgPage.ignoresSafeArea())
            .toolbar(.hidden, for: .navigationBar)
            .task { await load() }
            .refreshable { await load() }
            .sheet(isPresented: $showHeightSheet) {
                HeightInputSheet(onSave: { showHeightSheet = false })
                    .presentationDetents([.height(260)])
                    .presentationDragIndicator(.visible)
                    .presentationBackground(Theme.card)
            }
            .sheet(isPresented: $showSettingsSheet) {
                SettingsSheet()
                    .presentationDetents([.large])
                    .presentationDragIndicator(.visible)
            }
            .sheet(isPresented: $showManualRunSheet) {
                ManualRunSheet()
                    .presentationDetents([.large])
                    .presentationDragIndicator(.visible)
            }
            .sheet(isPresented: $showOnboardingSheet) {
                OnboardingSheet()
                    .presentationDetents([.large])
                    .presentationDragIndicator(.visible)
            }
            .sheet(isPresented: $showLogSheet) {
                LogView()
                    .presentationDetents([.large])
                    .presentationDragIndicator(.visible)
            }
            .sheet(isPresented: $showTipsSheet) {
                TipsView()
                    .presentationDetents([.large])
                    .presentationDragIndicator(.visible)
            }
            .sheet(isPresented: $showHealthSheet) {
                HealthView()
                    .presentationDetents([.large])
                    .presentationDragIndicator(.visible)
            }
        }
    }

    // ══════════════════════════════════════════════════════════════════
    // 1 · IDENTITY SPINE
    // ══════════════════════════════════════════════════════════════════

    private var identitySpine: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .firstTextBaseline) {
                Text("FAFF")
                    .font(Theme.Font.display(22)).tracking(2)
                    .foregroundStyle(Theme.ink)
                Spacer()
                Stamp("ME", tone: .mute)
            }

            Text((profile?.identity.full_name ?? "RUNNER").uppercased())
                .font(Theme.Font.display(26))
                .tracking(Theme.Font.tracking(for: 26))
                .foregroundStyle(Theme.ink)
                .lineLimit(2)
                .minimumScaleFactor(0.6)
                .fixedSize(horizontal: false, vertical: true)

            identitySpecLine
        }
        .padding(.horizontal, hPad)
        .padding(.top, 8)
        .padding(.bottom, 16)
        .overlay(alignment: .bottom) {
            Rectangle().fill(Theme.line).frame(height: 1)
        }
    }

    @ViewBuilder
    private var identitySpecLine: some View {
        if let race = profile?.nextARace {
            HStack(spacing: 10) {
                Text("TRAINING FOR \(race.name.uppercased())")
                    .font(monoSpec(12)).foregroundStyle(Theme.race)
                specDot()
                Text("T\u{2212}\(race.days_to_race)")
                    .font(monoSpec(12)).foregroundStyle(Theme.mute)
                Spacer(minLength: 0)
            }
            .lineLimit(1).minimumScaleFactor(0.7)
        } else {
            HStack(spacing: 10) {
                Text(experienceDisplay(profile?.identity.experience_level))
                    .font(monoSpec(12)).foregroundStyle(Theme.mute)
                if let city = profile?.identity.city, !city.isEmpty {
                    specDot()
                    Text(city.uppercased()).font(monoSpec(12)).foregroundStyle(Theme.mute)
                }
                Spacer(minLength: 0)
            }
            .lineLimit(1).minimumScaleFactor(0.7)
        }
    }

    // ══════════════════════════════════════════════════════════════════
    // 3 · PERSONAL
    // ══════════════════════════════════════════════════════════════════

    private var personalSection: some View {
        VStack(alignment: .leading, spacing: 0) {
            sectionHead("PERSONAL")

            SpecRow(label: "GENDER", value: genderDisplay, showRule: false)
            SpecRow(label: "BORN",
                    value: formatBirthday(profile?.identity.birthday),
                    meta: profile?.identity.age.map { "AGE \($0)" })

            // HEIGHT — taps the editor (add when missing, edit when set).
            Button { showHeightSheet = true } label: {
                SpecRow(
                    label: "HEIGHT",
                    value: profile?.identity.height_cm.map { formatHeightFtIn(cm: $0) } ?? "—",
                    meta: profile?.identity.height_cm == nil ? "TAP TO ADD" : "TAP TO EDIT"
                )
            }
            .buttonStyle(.plain)

            SpecRow(label: "CITY", value: (profile?.identity.city?.isEmpty == false ? profile!.identity.city! : "—"))
            SpecRow(label: "LEVEL", value: experienceDisplay(profile?.identity.experience_level))
        }
        .padding(.horizontal, hPad)
        .padding(.vertical, 16)
        .overlay(alignment: .top) { Rectangle().fill(Theme.line).frame(height: 1) }
    }

    // ══════════════════════════════════════════════════════════════════
    // 4 · PHYSIOLOGY · TRAINING ANCHORS
    // ══════════════════════════════════════════════════════════════════

    private var anchorsSection: some View {
        VStack(alignment: .leading, spacing: 0) {
            sectionHead("PHYSIOLOGY · ANCHORS")

            SpecRow(label: "LTHR",
                    value: profile?.physiology.lthr.map { "\($0)" } ?? "—",
                    unit: profile?.physiology.lthr != nil ? "BPM" : nil,
                    meta: "HR ZONES · FRIEL",
                    showRule: false)
            SpecRow(label: "MAX HR",
                    value: profile?.physiology.max_hr.map { "\($0)" } ?? "—",
                    unit: profile?.physiology.max_hr != nil ? "BPM" : nil,
                    meta: anchorMeta("Z5 CEILING", source: maxHrHint(profile?.physiology.max_hr_source)))
            SpecRow(label: "REST HR",
                    value: profile?.physiology.rhr.map { "\($0)" } ?? "—",
                    unit: profile?.physiology.rhr != nil ? "BPM" : nil,
                    meta: profile?.physiology.rhr != nil ? "60D MEAN · READINESS" : "PENDING")
            SpecRow(label: "VDOT",
                    value: profile?.physiology.vdot.map { String(format: "%.0f", $0) } ?? "—",
                    meta: profile?.physiology.vdot != nil ? "PACE ZONES · E/M/T/I/R" : "PENDING")
        }
        .padding(.horizontal, hPad)
        .padding(.vertical, 16)
        .overlay(alignment: .top) { Rectangle().fill(Theme.line).frame(height: 1) }
    }

    private func anchorMeta(_ usedFor: String, source: String?) -> String {
        if let s = source, !s.isEmpty { return "\(s) · \(usedFor)" }
        return usedFor
    }

    // ══════════════════════════════════════════════════════════════════
    // 5 · HR ZONES
    // ══════════════════════════════════════════════════════════════════

    private func zonesSection(_ zt: ProfileZoneTable) -> some View {
        let method = zt.method == "lthr-friel" ? "LTHR · FRIEL" : "%MHR"
        return VStack(alignment: .leading, spacing: 0) {
            sectionHead("HR ZONES · \(method)", trailing: "\(zt.anchor.label.uppercased()) \(zt.anchor.bpm)")

            ForEach(Array(zt.zones.enumerated()), id: \.element.id) { idx, z in
                SpecRow(
                    label: z.shortLabel,
                    value: "\(z.lower)\u{2013}\(z.upper)",
                    unit: "BPM",
                    meta: z.label.uppercased(),
                    tone: zoneTone(z.idx),
                    dot: zoneTone(z.idx),
                    valueSize: 19,
                    showRule: idx != 0
                )
            }
        }
        .padding(.horizontal, hPad)
        .padding(.vertical, 16)
        .overlay(alignment: .top) { Rectangle().fill(Theme.line).frame(height: 1) }
    }

    // ══════════════════════════════════════════════════════════════════
    // 6 · SHOE ROTATION
    // ══════════════════════════════════════════════════════════════════

    private func shoesSection(_ shoes: [ProfileShoe]) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            sectionHead("SHOE ROTATION", trailing: "\(shoes.count) ACTIVE")
            ForEach(Array(shoes.enumerated()), id: \.element.id) { idx, shoe in
                shoeSpecRow(shoe, showRule: idx != 0)
            }
        }
        .padding(.horizontal, hPad)
        .padding(.vertical, 16)
        .overlay(alignment: .top) { Rectangle().fill(Theme.line).frame(height: 1) }
    }

    private func shoeSpecRow(_ shoe: ProfileShoe, showRule: Bool) -> some View {
        let miles  = shoe.mileage ?? 0
        let cap    = shoe.cap ?? 0
        let pct    = shoe.pctUsed ?? (cap > 0 ? miles / cap : 0)
        let retired = shoe.retired ?? false
        let tone: FaffTone = pct >= 1.0 ? .over : (pct >= 0.8 ? .amber : .green)
        return VStack(spacing: 0) {
            if showRule { Rectangle().fill(Theme.line).frame(height: 1) }
            HStack(alignment: .center, spacing: 12) {
                VStack(alignment: .leading, spacing: 3) {
                    HStack(spacing: 7) {
                        Text(shoeDisplayName(shoe))
                            .font(.body(14, weight: .semibold))
                            .foregroundStyle(retired ? Theme.mute : Theme.ink)
                            .lineLimit(1)
                        if retired {
                            Stamp("RETIRED", tone: .mute)
                        } else if shoe.preferred == true {
                            Stamp("PREFERRED", tone: .green)
                        }
                    }
                    Text(shoeMetaLine(miles: miles, cap: cap))
                        .font(monoSpec(10)).foregroundStyle(Theme.mute)
                }
                Spacer(minLength: 8)
                HStack(alignment: .firstTextBaseline, spacing: 2) {
                    Text(String(format: "%.0f", min(pct, 1.0) * 100))
                        .font(Theme.Font.display(20)).monospacedDigit()
                        .foregroundStyle(tone.color)
                    Text("%").font(.label(9)).foregroundStyle(Theme.mute)
                }
                RegistrationDot(tone: tone, size: 7)
            }
            .padding(.vertical, 11)
        }
    }

    // ══════════════════════════════════════════════════════════════════
    // 7 · CONNECTIONS
    // ══════════════════════════════════════════════════════════════════

    private var connectionsSection: some View {
        VStack(alignment: .leading, spacing: 0) {
            sectionHead("CONNECTIONS")
            connSpecRow(name: "Strava",
                        sub: profile?.connections.strava.note ?? "Auto-sync via OAuth",
                        connected: profile?.connections.strava.connected ?? false,
                        showRule: false)
            connSpecRow(name: "Apple Health",
                        sub: profile?.connections.appleHealth.note ?? "Sleep / HRV / RHR / weight",
                        connected: profile?.connections.appleHealth.connected ?? false,
                        showRule: true)
            connSpecRow(name: "Apple Watch",
                        sub: profile?.connections.appleWatch.note ?? "Paired via WatchConnectivity",
                        connected: profile?.connections.appleWatch.connected ?? false,
                        showRule: true)
        }
        .padding(.horizontal, hPad)
        .padding(.vertical, 16)
        .overlay(alignment: .top) { Rectangle().fill(Theme.line).frame(height: 1) }
    }

    private func connSpecRow(name: String, sub: String, connected: Bool, showRule: Bool) -> some View {
        VStack(spacing: 0) {
            if showRule { Rectangle().fill(Theme.line).frame(height: 1) }
            HStack(alignment: .center, spacing: 12) {
                VStack(alignment: .leading, spacing: 3) {
                    Text(name.uppercased())
                        .font(.label(11)).tracking(1.2).foregroundStyle(Theme.ink)
                    Text(sub)
                        .font(monoSpec(10)).foregroundStyle(Theme.mute)
                        .lineLimit(1).minimumScaleFactor(0.7)
                }
                Spacer(minLength: 8)
                Text(connected ? "LIVE" : "OFF")
                    .font(monoSpec(11)).foregroundStyle(connected ? Theme.green : Theme.mute)
                RegistrationDot(tone: connected ? .green : .mute, size: 7)
            }
            .padding(.vertical, 12)
        }
    }

    // ══════════════════════════════════════════════════════════════════
    // 8 · ACTIONS — every row preserves its sheet trigger
    // ══════════════════════════════════════════════════════════════════

    private var actionsSection: some View {
        VStack(alignment: .leading, spacing: 0) {
            sectionHead("ACTIONS")

            Button { showHealthSheet = true } label: {
                actionSpecRow(label: "Health", sub: "Readiness · sleep · HRV · resting HR", showRule: false)
            }.buttonStyle(.plain)
            Button { showLogSheet = true } label: {
                actionSpecRow(label: "Run log", sub: "Every run, chronologically", showRule: true)
            }.buttonStyle(.plain)
            Button { showTipsSheet = true } label: {
                actionSpecRow(label: "Form tips", sub: "Cadence · vertical osc · ground contact", showRule: true)
            }.buttonStyle(.plain)
            Button { showSettingsSheet = true } label: {
                actionSpecRow(label: "Settings", sub: "Units · zones · profile", showRule: true)
            }.buttonStyle(.plain)
            Button { showManualRunSheet = true } label: {
                actionSpecRow(label: "Log manual run", sub: "Treadmill / forgot to track", showRule: true)
            }.buttonStyle(.plain)
            Button { showOnboardingSheet = true } label: {
                actionSpecRow(
                    label: tokenStore.isSignedIn ? "Account & connections" : "Set up account",
                    sub: tokenStore.isSignedIn ? "Sign-in · Strava · Apple Health" : "Sign in + connect your data",
                    showRule: true
                )
            }.buttonStyle(.plain)
        }
        .padding(.horizontal, hPad)
        .padding(.vertical, 16)
        .overlay(alignment: .top) { Rectangle().fill(Theme.line).frame(height: 1) }
    }

    private func actionSpecRow(label: String, sub: String, showRule: Bool) -> some View {
        VStack(spacing: 0) {
            if showRule { Rectangle().fill(Theme.line).frame(height: 1) }
            HStack(alignment: .center, spacing: 12) {
                VStack(alignment: .leading, spacing: 3) {
                    Text(label.uppercased())
                        .font(.label(11)).tracking(1.2).foregroundStyle(Theme.ink)
                    Text(sub)
                        .font(monoSpec(10)).foregroundStyle(Theme.mute)
                        .lineLimit(1).minimumScaleFactor(0.7)
                }
                Spacer(minLength: 8)
                Text("\u{25B8}").font(.body(13)).foregroundStyle(Theme.mute)
            }
            .padding(.vertical, 13)
        }
    }

    // ══════════════════════════════════════════════════════════════════
    // Section header + footer
    // ══════════════════════════════════════════════════════════════════

    private func sectionHead(_ text: String, trailing: String? = nil) -> some View {
        VStack(spacing: 0) {
            HStack {
                SpecLabel(text, size: 10)
                Spacer()
                if let trailing { Stamp(trailing, tone: .mute) }
            }
            .padding(.bottom, 8)
            TickRule(ticks: 28).padding(.bottom, 2)
        }
    }

    private var stampFooter: some View {
        HStack(spacing: 8) {
            Stamp("FAFF", tone: .mute)
            Stamp("ME", tone: .mute)
            Spacer()
            Stamp("v4", tone: .race)
        }
        .padding(.horizontal, hPad)
        .padding(.top, 22)
    }

    // ══════════════════════════════════════════════════════════════════
    // Load — UNCHANGED plumbing
    // ══════════════════════════════════════════════════════════════════

    private func load() async {
        await SettingsCache.shared.warm()
        async let pRes = (try? await API.fetchProfileState())
        async let bRes = (try? await API.briefing(surface: "profile"))
        profile = await pRes ?? nil
        briefing = await bRes ?? nil
    }

    // ══════════════════════════════════════════════════════════════════
    // Formatting helpers (preserved verbatim)
    // ══════════════════════════════════════════════════════════════════

    private func zoneTone(_ idx: Int) -> FaffTone {
        switch idx {
        case 1: return .green
        case 2: return .dist
        case 3: return .amber
        case 4: return .race
        case 5: return .over
        default: return .mute
        }
    }

    private var genderDisplay: String {
        guard let s = profile?.identity.sex, !s.isEmpty else { return "—" }
        return s.uppercased()
    }

    private func formatBirthday(_ iso: String?) -> String {
        guard let iso, !iso.isEmpty else { return "—" }
        let parts = iso.split(separator: "-")
        guard parts.count >= 3 else { return iso }
        return "\(parts[1])-\(parts[2].prefix(2))-\(parts[0])"
    }

    private func experienceDisplay(_ level: String?) -> String {
        switch (level ?? "").lowercased() {
        case "beginner":      return "BEGINNER"
        case "intermediate":  return "INTERMEDIATE"
        case "advanced":      return "ADVANCED"
        case "advanced_plus": return "SUB-ELITE"
        default:              return "—"
        }
    }

    private func formatHeightFtIn(cm: Double) -> String {
        let totalInches = cm / 2.54
        let feet = Int(totalInches / 12)
        let inches = Int(totalInches.truncatingRemainder(dividingBy: 12).rounded())
        return "\(feet)'\(inches)\""
    }

    private func maxHrHint(_ source: String?) -> String? {
        switch source ?? "" {
        case "manual":        return "MANUAL"
        case "observed":      return "OBSERVED"
        case "lthr-derived":  return "LTHR-DERIVED"
        case "formula":       return "FORMULA"
        default:              return nil
        }
    }

    private func shoeDisplayName(_ shoe: ProfileShoe) -> String {
        if let name = shoe.name, !name.isEmpty { return name }
        let parts = [shoe.brand, shoe.model].compactMap { $0?.isEmpty == false ? $0 : nil }
        return parts.isEmpty ? "Shoe" : parts.joined(separator: " ")
    }

    private func shoeMetaLine(miles: Double, cap: Double) -> String {
        if cap > 0 { return "\(formatMi(miles)) / \(formatMi(cap)) MI" }
        return "\(formatMi(miles)) MI"
    }

    private func formatMi(_ mi: Double) -> String {
        if mi.truncatingRemainder(dividingBy: 1) == 0 { return String(Int(mi)) }
        return String(format: "%.1f", mi)
    }

    private func monoSpec(_ size: CGFloat) -> Font {
        .system(size: size, weight: .semibold, design: .monospaced)
    }

    @ViewBuilder private func specDot() -> some View {
        Text("·").font(monoSpec(12)).foregroundStyle(Theme.dim)
    }
}

/// §8.6 closed loop: native sheet → API.updateProfile → next briefing acks once.
private struct HeightInputSheet: View {
    var onSave: () -> Void
    @State private var value: String = ""
    @State private var unit: Unit = .cm
    @State private var saving = false
    @State private var error: String?

    enum Unit: String { case cm, inch }

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("ADD YOUR HEIGHT").font(.label(11)).tracking(1.6).foregroundStyle(Theme.mute)
            HStack(spacing: 10) {
                TextField("e.g. 180", text: $value)
                    .keyboardType(.decimalPad)
                    .font(.display(28))
                    .foregroundStyle(Theme.ink)
                    .padding(10)
                    .background(Color.white.opacity(0.04))
                    .overlay(RoundedRectangle(cornerRadius: 8).stroke(Theme.green, lineWidth: 1))
                    .clipShape(RoundedRectangle(cornerRadius: 8))
                Button { unit = .cm } label: {
                    Text("CM").font(.display(11)).tracking(1)
                        .foregroundStyle(unit == .cm ? Theme.green : Theme.mute)
                        .padding(.horizontal, 10).padding(.vertical, 6)
                        .overlay(Capsule().stroke(unit == .cm ? Theme.green : Theme.line, lineWidth: 1))
                }.buttonStyle(.plain)
                Button { unit = .inch } label: {
                    Text("IN").font(.display(11)).tracking(1)
                        .foregroundStyle(unit == .inch ? Theme.green : Theme.mute)
                        .padding(.horizontal, 10).padding(.vertical, 6)
                        .overlay(Capsule().stroke(unit == .inch ? Theme.green : Theme.line, lineWidth: 1))
                }.buttonStyle(.plain)
            }
            if let error {
                Text(error).font(.body(11)).foregroundStyle(Theme.over)
            }
            Button {
                Task { await save() }
            } label: {
                Text(saving ? "SAVING…" : "SAVE").font(.display(13)).tracking(1.2)
                    .foregroundStyle(Color(white: 0.05))
                    .frame(maxWidth: .infinity).padding(.vertical, 12)
                    .background(Theme.green).clipShape(RoundedRectangle(cornerRadius: 8))
            }
            .disabled(value.isEmpty || saving).buttonStyle(.plain)
        }
        .padding(20)
        .background(Theme.card)
    }

    @MainActor
    private func save() async {
        guard let n = Double(value) else { error = "(enter a number)"; return }
        let cm = unit == .inch ? Int(round(n * 2.54)) : Int(round(n))
        guard cm >= 120 && cm <= 220 else { error = "(out of range — 120-220 cm)"; return }
        saving = true; defer { saving = false }
        do {
            try await API.updateProfile(["height_cm": cm])
            onSave()
        } catch {
            self.error = "(couldn't save — try again)"
        }
    }
}
