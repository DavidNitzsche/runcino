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

// MARK: - LearnArticle (P40 /learn modal · 2026-05-30 audit added citations)
//
// Lenient decode (doctrine 2026-05-31). The 45-article seed has been edited
// freehand a few times; a single missing `body_md` on one row used to drop
// the whole article fetch · the LearnArticleSheet rendered a blank reader.
// Now defaults missing fields so the reader at least shows the title.
struct LearnArticle: Decodable, Identifiable {
    var id: String { slug }
    let slug: String
    let title: String
    let eyebrow: String?
    let body_md: String
    let citations_json: [LearnCitation]?
    let related_slugs: [String]?

    enum CodingKeys: String, CodingKey {
        case slug, title, eyebrow, body_md, citations_json, related_slugs
    }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        self.slug = try c.decodeIfPresent(String.self, forKey: .slug) ?? ""
        self.title = try c.decodeIfPresent(String.self, forKey: .title) ?? ""
        self.eyebrow = try c.decodeIfPresent(String.self, forKey: .eyebrow)
        self.body_md = try c.decodeIfPresent(String.self, forKey: .body_md) ?? ""
        self.citations_json = (try? c.decode([LearnCitation].self, forKey: .citations_json)) ?? nil
        self.related_slugs = (try? c.decode([String].self, forKey: .related_slugs)) ?? nil
    }
}

struct LearnCitation: Decodable {
    let author: String
    let year: Int
    let title: String
    let journal: String?
    let doi: String?
    let url: String?

    enum CodingKeys: String, CodingKey { case author, year, title, journal, doi, url }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        self.author = try c.decodeIfPresent(String.self, forKey: .author) ?? ""
        self.year = c.decodeFlexInt(forKey: .year) ?? 0
        self.title = try c.decodeIfPresent(String.self, forKey: .title) ?? ""
        self.journal = try c.decodeIfPresent(String.self, forKey: .journal)
        self.doi = try c.decodeIfPresent(String.self, forKey: .doi)
        self.url = try c.decodeIfPresent(String.self, forKey: .url)
    }
}
