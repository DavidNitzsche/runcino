//
//  Theme.swift
//  faff.run v2 design tokens — single source of truth.
//
//  Canonical reference: docs/coach/mockups/deck-v1-2026-05-25.html
//  Every value here must match web-v2/app/globals.css and the deck.
//

import SwiftUI

enum Theme {
    // Canvas
    static let bg      = Color(red: 0.039, green: 0.047, blue: 0.063)   // #0a0c10
    static let bgPage  = Color(red: 0.082, green: 0.090, blue: 0.110)   // #15171c
    static let card    = Color(red: 0.067, green: 0.078, blue: 0.102)   // #11141a
    static let card2   = Color(red: 0.075, green: 0.090, blue: 0.122)   // #13171f

    // Ink
    static let ink   = Color(red: 0.965, green: 0.969, blue: 0.973)     // #f6f7f8
    static let mute  = Color(red: 0.541, green: 0.565, blue: 0.627)     // #8a90a0
    static let dim   = Color(red: 0.294, green: 0.314, blue: 0.369)     // #4b505e

    // Lines
    static let line  = Color.white.opacity(0.08)
    static let line2 = Color.white.opacity(0.04)

    // Watch-face palette — semantic
    static let green  = Color(red: 0.243, green: 0.741, blue: 0.255)    // #3EBD41 solid/good/ready
    static let goal   = Color(red: 0.953, green: 0.678, blue: 0.220)    // #F3AD38 watch/amber
    static let over   = Color(red: 0.988, green: 0.302, blue: 0.392)    // #FC4D64 over/alert
    static let dist   = Color(red: 0.153, green: 0.706, blue: 0.878)    // #27B4E0 distance/cool
    static let rest   = Color(red: 0.000, green: 0.561, blue: 0.925)    // #008FEC rest/recovery
    static let learn  = Color(red: 0.690, green: 0.518, blue: 1.000)    // #B084FF explainer
    static let race   = Color(red: 1.000, green: 0.533, blue: 0.278)    // #FF8847 race/horizon

    // Radii
    static let rCard:  CGFloat = 18
    static let rPill:  CGFloat = 999
    static let rInput: CGFloat = 10
}
