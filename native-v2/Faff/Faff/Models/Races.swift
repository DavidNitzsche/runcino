//
//  Races.swift  (P40)
//  iPhone race detail wire models.
//

import Foundation

struct RaceDetailResponse: Decodable {
    let race: RaceDetail
    let proximity: String   // "post-race" | "race-week" | "sharpening" | "building"
    let course_source: String?
}

struct RaceDetail: Decodable {
    let slug: String
    let name: String
    let date: String
    let priority: String?   // "A" | "B" | "C"
    let distance_label: String?
    let location: String?
    let days: Int?
    let goal: String?
    let finish_time: String?
    let pb: String?
}
