//
//  Tips.swift
//  Wire model for /api/tips (P40).
//

import Foundation

struct TipsResponse: Decodable {
    let tips: [FormTip]
}

struct FormTip: Decodable, Identifiable {
    var id: String { key }
    let key: String
    let title: String
    let unit: String
    let one_liner: String
    let what_it_is: String
    let why_it_matters: String
    let bands: [FormBand]
    let drills_when_flagged: [String]
}

struct FormBand: Decodable, Identifiable {
    var id: String { label }
    let band: String   // "elite" | "good" | "fine" | "flag"
    let range: String
    let label: String
    let meaning: String
}

// MARK: - LearnArticle (P40 /learn modal)
struct LearnArticle: Decodable, Identifiable {
    var id: String { slug }
    let slug: String
    let title: String
    let eyebrow: String?
    let body_md: String
    let related_slugs: [String]?
}
