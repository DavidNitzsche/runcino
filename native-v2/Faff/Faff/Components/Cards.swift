//
//  Cards.swift
//  Topic-kind renderers for the cards lane on TODAY.
//  Mirrors web-v2/components/cards/*. Each one consumes a Topic.
//

import SwiftUI

struct CardSurface<Content: View>: View {
    let content: Content
    init(@ViewBuilder _ content: () -> Content) { self.content = content() }
    var body: some View {
        VStack(alignment: .leading, spacing: 0) { content }
            .padding(.horizontal, 18)
            .padding(.vertical, 16)
            .background(Theme.card)
            .overlay(RoundedRectangle(cornerRadius: Theme.rCard).stroke(Theme.line, lineWidth: 1))
            .clipShape(RoundedRectangle(cornerRadius: Theme.rCard))
    }
}

struct CardEyebrow: View {
    let text: String
    let color: Color
    var body: some View {
        Text(text).font(.label(9)).tracking(1.6)
            .foregroundStyle(color)
            .padding(.bottom, 8)
    }
}

struct CoachNote: View {
    let text: String
    var body: some View {
        HStack(alignment: .top, spacing: 8) {
            Circle().fill(Theme.green).frame(width: 4, height: 4).padding(.top, 7)
            Text(text).font(.body(12)).lineSpacing(2)
                .foregroundStyle(Theme.ink.opacity(0.85))
        }
        .padding(.top, 10)
        .overlay(Divider().background(Theme.line2), alignment: .top)
    }
}

// MARK: Run recap

struct RunRecapCard: View {
    let mi: Double; let pace: String?; let time: String?
    let hr: Int?; let cadence: Int?; let weatherChip: String?; let note: String?
    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 10) {
                Text("YOUR RUN").font(.label(9)).tracking(1.6)
                    .foregroundStyle(Theme.mute)
                Text("COMPLETED")
                    .font(.body(9, weight: .heavy)).tracking(1.2)
                    .foregroundStyle(Theme.green)
                    .padding(.horizontal, 9).padding(.vertical, 3)
                    .background(Theme.green.opacity(0.14))
                    .clipShape(Capsule())
            }
            HStack(alignment: .top, spacing: 14) {
                stat(value: String(format: "%.1f", mi), unit: "miles", color: Theme.dist)
                if let pace { stat(value: pace, unit: "avg pace", color: Theme.green) }
                if let time { stat(value: time, unit: "moving",   color: Theme.ink) }
            }
            HStack(spacing: 6) {
                if let hr      { chip(k: "HR",  v: "\(hr)") }
                if let cadence { chip(k: "CAD", v: "\(cadence)") }
                if let w = weatherChip { chip(text: w, warm: true) }
            }
            if let note { CoachNote(text: note) }
        }
    }

    private func stat(value: String, unit: String, color: Color) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(value).font(.display(48)).tracking(0.5).foregroundStyle(color)
                .lineLimit(1).minimumScaleFactor(0.6)
            Text(unit.uppercased()).font(.body(10, weight: .semibold)).tracking(1.2)
                .foregroundStyle(Theme.mute)
        }
    }
    private func chip(k: String? = nil, v: String? = nil, text: String? = nil, warm: Bool = false) -> some View {
        HStack(spacing: 5) {
            if let k { Text(k).font(.body(9, weight: .semibold)).tracking(1).foregroundStyle(Theme.mute) }
            if let v { Text(v).font(.body(11, weight: .semibold)).foregroundStyle(Theme.ink) }
            if let text { Text(text).font(.body(11)).foregroundStyle(warm ? Theme.goal : Theme.ink.opacity(0.85)) }
        }
        .padding(.horizontal, 11).padding(.vertical, 6)
        .background(warm ? Theme.goal.opacity(0.08) : Color.white.opacity(0.04))
        .overlay(Capsule().stroke(warm ? Theme.goal.opacity(0.30) : Theme.line, lineWidth: 1))
        .clipShape(Capsule())
    }
}

// MARK: Next workout

struct NextWorkoutCard: View {
    let dow: String; let workoutType: String; let label: String?; let mi: Double; let note: String?
    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            CardEyebrow(text: "UP NEXT · \(dow.uppercased())", color: Theme.rest)
            HStack(alignment: .center) {
                Text((label ?? workoutType).uppercased())
                    .font(.display(28)).tracking(0.8).foregroundStyle(Theme.ink)
                Spacer()
                HStack(alignment: .lastTextBaseline, spacing: 4) {
                    Text(String(format: "%.1f", mi)).font(.display(60))
                    Text("MI").font(.label(11)).tracking(1.2).foregroundStyle(Theme.mute)
                }
                .foregroundStyle(Theme.rest)
            }
            if let note { CoachNote(text: note) }
        }
    }
}

// MARK: Race horizon

struct RaceHorizonCard: View {
    let name: String; let date: String; let daysToRace: Int; let tone: String; let goal: String?; let note: String?
    var toneLabel: String {
        switch tone { case "race_week": return "RACE WEEK"; case "sharpening": return "SHARPENING"; default: return "BUILDING" }
    }
    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            CardEyebrow(text: "RACE · \(toneLabel)", color: Theme.race)
            HStack(alignment: .center) {
                VStack(alignment: .leading, spacing: 4) {
                    Text(name).font(.display(22)).tracking(0.5).foregroundStyle(Theme.ink)
                    Text("\(date)\(goal != nil ? " · GOAL \(goal!)" : "")")
                        .font(.body(10, weight: .semibold)).foregroundStyle(Theme.mute).tracking(0.5)
                }
                Spacer()
                HStack(alignment: .lastTextBaseline, spacing: 4) {
                    Text("\(daysToRace)").font(.display(56))
                    Text("DAYS").font(.label(11)).tracking(1.2).foregroundStyle(Theme.mute)
                }
                .foregroundStyle(Theme.race)
            }
            if let note { CoachNote(text: note) }
        }
    }
}

// MARK: Profile gap

struct ProfileGapCard: View {
    let field: String; let why: String
    var body: some View {
        HStack(alignment: .center, spacing: 14) {
            VStack(alignment: .leading, spacing: 3) {
                Text("COACH NEEDS").font(.label(9)).tracking(1.6).foregroundStyle(Theme.over)
                Text(field == "height_cm" ? "Your height" : field)
                    .font(.display(19)).tracking(0.5).foregroundStyle(Theme.ink)
                Text(why).font(.body(11.5)).foregroundStyle(Theme.mute)
            }
            Spacer()
            Text("+ ADD").font(.display(12)).tracking(1)
                .foregroundStyle(Theme.over)
                .padding(.horizontal, 14).padding(.vertical, 7)
                .background(Theme.over.opacity(0.12))
                .overlay(Capsule().stroke(Theme.over.opacity(0.25), lineWidth: 1))
                .clipShape(Capsule())
        }
        .padding(.horizontal, 16).padding(.vertical, 12)
        .background(Theme.card)
        .overlay(RoundedRectangle(cornerRadius: Theme.rCard).stroke(Theme.line, lineWidth: 1))
        .clipShape(RoundedRectangle(cornerRadius: Theme.rCard))
    }
}

// MARK: Sleep deficit

struct SleepDeficitCard: View {
    let avg7n: Double; let deficit: Double; let lastNight: Double?; let note: String?
    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            CardEyebrow(text: "SLEEP · LAST 7 NIGHTS", color: Theme.goal)
            HStack(alignment: .lastTextBaseline, spacing: 14) {
                Text(String(format: "%.1fh", avg7n)).font(.display(48)).tracking(0.5).foregroundStyle(Theme.goal)
                Text(lastNight != nil
                    ? "7-NIGHT AVG · last night \(String(format: "%.1f", lastNight!))h"
                    : "7-NIGHT AVG")
                    .font(.body(11, weight: .semibold)).foregroundStyle(Theme.mute)
            }
            .padding(.bottom, 12)
            Text("About \(String(format: "%.1f", deficit))h of sleep debt this week.")
                .font(.body(11.5)).foregroundStyle(Theme.goal).fontWeight(.semibold)
            if let note { CoachNote(text: note) }
        }
    }
}

// MARK: Watch list

struct WatchListCard: View {
    let items: [(label: String, status: String, note: String)]
    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            CardEyebrow(
                text: "WATCH LIST · \(items.count) \(items.count == 1 ? "ITEM" : "ITEMS")",
                color: Theme.goal
            )
            VStack(alignment: .leading, spacing: 10) {
                ForEach(Array(items.enumerated()), id: \.offset) { _, item in
                    HStack(alignment: .top, spacing: 10) {
                        Circle().fill(item.status == "red" ? Theme.over : Theme.goal)
                            .frame(width: 8, height: 8).padding(.top, 6)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(item.label).font(.display(14)).foregroundStyle(Theme.ink)
                            Text(item.note).font(.body(11.5)).foregroundStyle(Theme.mute).lineSpacing(2)
                        }
                    }
                }
            }
        }
        .padding(.horizontal, 18).padding(.vertical, 16)
        .background(Theme.goal.opacity(0.04))
        .overlay(RoundedRectangle(cornerRadius: Theme.rCard).stroke(Theme.goal.opacity(0.25), lineWidth: 1))
        .clipShape(RoundedRectangle(cornerRadius: Theme.rCard))
    }
}

// MARK: Fun fact

struct FunFactCard: View {
    // `body` is reserved by View — rename the prose field to `text`.
    let term: String; let text: String; let linkSlug: String
    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 8) {
                Text("ⓘ").font(.body(11, weight: .heavy))
                    .foregroundStyle(Color(white: 0.1))
                    .padding(4).background(Theme.learn).clipShape(Circle())
                Text(term.uppercased()).font(.label(11)).tracking(1.2).foregroundStyle(Theme.learn)
            }
            Text(self.text).font(.body(13)).foregroundStyle(Theme.ink.opacity(0.82)).lineSpacing(3)
            // Link to /learn/<slug> when reader ships in P4.
            Text("Read the research →").font(.body(10.5, weight: .semibold))
                .foregroundStyle(Theme.learn).tracking(0.5)
        }
        .padding(.horizontal, 16).padding(.vertical, 14)
        .background(Theme.learn.opacity(0.04))
        .overlay(RoundedRectangle(cornerRadius: Theme.rCard).stroke(Theme.learn.opacity(0.18), lineWidth: 1))
        .clipShape(RoundedRectangle(cornerRadius: Theme.rCard))
    }
}
