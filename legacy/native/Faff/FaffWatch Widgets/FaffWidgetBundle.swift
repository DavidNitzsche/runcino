//
//  FaffWidgetBundle.swift
//  FaffWatch Widgets
//
//  The extension's entry point, and the one place the two surfaces are
//  wired to the one timeline.
//
//  SOURCE OF TRUTH — see WatchThemeV5.swift's header.
//
//  ─────────────────────────────────────────────────────────────────────────
//  ONE WIDGET KIND, THREE FAMILIES, TWO SURFACES
//
//  Complications and the Smart Stack are two surfaces but one piece of
//  content: today's session. On watchOS they are also one widget — the Smart
//  Stack draws `accessoryRectangular` widgets and so do watch faces, so
//  declaring them as two kinds would put two entries in the gallery that
//  differ only in which surface happened to pick them up.
//
//  So there is one kind. `FaffRectangularEntryView` branches on
//  `widgetRenderingMode`, which is watchOS telling us which surface it is
//  compositing for: `.fullColor` is the Smart Stack, everything else is a
//  face. The branch fails safe — anything that is not `.fullColor` gets the
//  uncoloured complication, so rule 12 cannot be broken by a mode this build
//  has not heard of.
//  ─────────────────────────────────────────────────────────────────────────
//

import WidgetKit
import SwiftUI

@main
struct FaffWatchWidgetBundle: WidgetBundle {

    init() {
        // The extension is its own process with its own bundle, so the watch
        // app's runtime font registration does not reach it. Without this,
        // `WatchV5.display` finds no Archivo, returns nil from its CoreText
        // probe and falls back to San Francisco — silently, which is exactly
        // what that probe exists to make visible.
        FaffWidgetFonts.register()
    }

    var body: some Widget {
        FaffSessionWidget()
    }
}

struct FaffSessionWidget: Widget {
    let kind = "run.faff.watch.session"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: FaffSessionProvider()) { entry in
            FaffSessionEntryView(content: FaffWidgetContent(entry.state))
        }
        // "Today's session" — what it holds, in the runner's words. Not
        // "faff.run": the gallery already says which app this came from, and
        // a name that repeats the app is the same waste as a complication
        // that reads "faff.run".
        .configurationDisplayName("Today's session")
        .description("The session and its dose, before the app is open.")
        .supportedFamilies([
            .accessoryCircular,
            .accessoryRectangular,
            .accessoryCorner,
        ])
    }
}

/// Routes a family to its board. The rectangular case is the one that
/// carries two, because two surfaces ask for it.
struct FaffSessionEntryView: View {
    @Environment(\.widgetFamily) private var family
    let content: FaffWidgetContent

    var body: some View {
        switch family {
        case .accessoryCircular:
            FaffCircularComplication(content: content)
        case .accessoryCorner:
            FaffCornerComplication(content: content)
        default:
            FaffRectangularEntryView(content: content)
        }
    }
}

/// The fork. Smart Stack gets the poster and its ramp; a watch face gets the
/// uncoloured tile.
struct FaffRectangularEntryView: View {
    @Environment(\.widgetRenderingMode) private var renderingMode
    let content: FaffWidgetContent

    var body: some View {
        if renderingMode == .fullColor {
            FaffSmartStackView(content: content)
        } else {
            FaffRectangularComplication(content: content)
        }
    }
}
