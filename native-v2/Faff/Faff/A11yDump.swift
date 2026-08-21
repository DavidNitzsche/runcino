//
//  A11yDump.swift
//  faff.run iPhone · what VoiceOver actually says, printed.
//
//  ─────────────────────────────────────────────────────────────────────────
//  WHY THIS EXISTS
//
//  Reading SwiftUI source tells you which `.accessibilityLabel` calls are
//  written. It does not tell you what a runner hears, and the two came apart
//  everywhere in the 2026-08-21 audit:
//
//    · `PlaceHeaderV5`'s account button had no label and announced itself as
//      "person" — the raw SF Symbol name — which no amount of reading the
//      call site reveals, because the string is not in the codebase.
//    · The day panel's grain layer is a `Color`+`Image` background and was
//      announcing a bare unlabelled "image" the size of the panel. Nothing in
//      the source looks like an accessibility element.
//    · Every chart in `ChartsV5` produced NO element at all, not an unnamed
//      one — `Capsule` and `RoundedRectangle` are invisible to the tree — so
//      the absence was only visible by looking at the tree.
//    · Tap targets: the Races card's "Not now" button measured 56×17 because
//      its `Color.clear` fill is not hit-testable. The frame in the source
//      says `minHeight: 44`.
//
//  So: walk the real UIKit tree the way VoiceOver walks it, and print each
//  element's label, value, traits and frame. Frames under 44pt on a button
//  are flagged inline, which is the tap-target audit for free.
//
//  ─────────────────────────────────────────────────────────────────────────
//  HOW TO RUN IT
//
//  SwiftUI only materialises its accessibility tree when an assistive client
//  is attached. Without one this prints an EMPTY tree and looks broken, so
//  turn VoiceOver on in the simulator first:
//
//      xcrun simctl spawn <udid> defaults write com.apple.Accessibility \
//          ApplicationAccessibilityEnabled -int 1
//      xcrun simctl spawn <udid> defaults write com.apple.Accessibility \
//          VoiceOverTouchEnabled -int 1
//      xcrun simctl spawn <udid> notifyutil -s com.apple.accessibility.cache.app.ax 1
//      xcrun simctl spawn <udid> notifyutil -p com.apple.accessibility.cache.app.ax
//
//      xcrun simctl launch --console-pty <udid> run.faff.app \
//          -faffV5Screens 7a -faffA11yDump
//
//  Debug affordance, gated on the launch argument. Nothing in the product
//  passes it and the walk never runs without it.
//

import UIKit

enum A11yDump {

    static func traitNames(_ t: UIAccessibilityTraits) -> String {
        var out: [String] = []
        let map: [(UIAccessibilityTraits, String)] = [
            (.button, "button"), (.link, "link"), (.header, "header"),
            (.selected, "SELECTED"), (.notEnabled, "disabled"),
            (.image, "image"), (.staticText, "text"), (.adjustable, "adjustable"),
            (.searchField, "searchField"), (.keyboardKey, "key"),
            (.summaryElement, "summary"), (.updatesFrequently, "updates"),
            (.playsSound, "playsSound"), (.startsMediaSession, "startsMedia"),
            (.causesPageTurn, "pageTurn"), (.tabBar, "tabBar"),
            (.allowsDirectInteraction, "direct"),
        ]
        for (bit, name) in map where t.contains(bit) { out.append(name) }
        return out.isEmpty ? "-" : out.joined(separator: "|")
    }

    static func walk(_ node: Any, depth: Int, into lines: inout [String]) {
        guard depth < 40 else { return }
        let pad = String(repeating: "  ", count: depth)

        guard let obj = node as? NSObject else { return }

        if obj.isAccessibilityElement {
            let label = obj.accessibilityLabel ?? "<NO LABEL>"
            let value = obj.accessibilityValue.flatMap { " value=\"\($0)\"" } ?? ""
            let hint = obj.accessibilityHint.flatMap { " hint=\"\($0)\"" } ?? ""
            let traits = traitNames(obj.accessibilityTraits)
            let f = obj.accessibilityFrame
            let size = String(format: "%.0fx%.0f", f.width, f.height)
            let small = (f.width < 44 || f.height < 44) && obj.accessibilityTraits.contains(.button)
            lines.append("\(pad)• \"\(label)\"\(value)\(hint) [\(traits)] \(size)\(small ? "  <<< TAP TARGET < 44" : "")")
            return
        }

        if let elements = obj.accessibilityElements, !elements.isEmpty {
            lines.append("\(pad)┌ container \(type(of: node))")
            for e in elements { walk(e, depth: depth + 1, into: &lines) }
            return
        }

        if let v = node as? UIView {
            for sub in v.subviews { walk(sub, depth: depth + 1, into: &lines) }
        }
    }

    static func dump() {
        guard let scene = UIApplication.shared.connectedScenes
            .compactMap({ $0 as? UIWindowScene }).first,
            let window = scene.windows.first(where: { $0.isKeyWindow }) ?? scene.windows.first
        else {
            print("A11YDUMP: no window")
            return
        }
        var lines: [String] = ["===== A11Y TREE ====="]
        walk(window, depth: 0, into: &lines)
        lines.append("===== END =====")
        print(lines.joined(separator: "\n"))
    }

    /// Call once from the app root when the launch argument is present.
    static func installIfRequested() {
        guard ProcessInfo.processInfo.arguments.contains("-faffA11yDump") else { return }
        // Repeat so a screen that loads asynchronously is captured too.
        for delay in [3.0, 8.0, 14.0] {
            DispatchQueue.main.asyncAfter(deadline: .now() + delay) {
                print("\n----- dump at \(delay)s -----")
                dump()
            }
        }
    }
}
