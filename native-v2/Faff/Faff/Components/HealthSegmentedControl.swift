//
//  HealthSegmentedControl.swift
//
//  The 5 sections of the Health page · OVERVIEW · BODY · SLEEP · FORM ·
//  INSIGHTS. HealthView owns the picker chrome and switches on this.
//
//  2026-08-17 · the HealthSegmentedControl view this file was named for
//  is gone. It was the original pinned-top 5-way control, superseded by
//  the shared frosted header pill that HealthView builds itself, and it
//  had zero references anywhere in the target. The enum stays — it is
//  what HealthView actually switches on.
//
//  Created 2026-06-03 round 72.
//

import SwiftUI

enum HealthSection: String, CaseIterable, Identifiable {
    case overview, body, sleep, form, insights
    var id: String { rawValue }
    var label: String {
        switch self {
        case .overview: return "OVERVIEW"
        case .body:     return "BODY"
        case .sleep:    return "SLEEP"
        case .form:     return "FORM"
        case .insights: return "INSIGHTS"
        }
    }
}
