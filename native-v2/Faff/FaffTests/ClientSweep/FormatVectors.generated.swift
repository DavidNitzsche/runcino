//
//  FormatVectors.generated.swift
//  GENERATED — do not edit by hand.
//
//  Written by `web-v2/lib/wire-format/_format_vectors.test.ts` from the
//  SERVER's own formatters in `lib/wire-format/format.ts`. Regenerate with:
//
//      UPDATE_FORMAT_VECTORS=1 npx vitest run lib/wire-format/
//
//  Every row is a number the server turned into a string, and
//  `FormatConformanceTests` asserts the phone turns the same number into the
//  same string. A pace formatted on the phone must equal the pace formatted on
//  the server for the same run; before this table nothing could check that.
//
//  Editing this file by hand to make a test pass would defeat its only
//  purpose. Fix the formatter on whichever side is wrong instead.
//

enum FormatVectors {

    enum Fn: String {
        case paceMinSec, clock, raceTime, miles, paceDeltaSec, bpm
    }

    struct V {
        let fn: Fn
        let input: Double
        /// What the SERVER produced. nil means the server declined to format.
        let expected: String?
    }

    static let all: [V] = [
        V(fn: .paceMinSec, input: 0, expected: nil),
        V(fn: .clock, input: 0, expected: "0:00"),
        V(fn: .raceTime, input: 0, expected: "0:00:00"),
        V(fn: .paceMinSec, input: 1, expected: "0:01"),
        V(fn: .clock, input: 1, expected: "0:01"),
        V(fn: .raceTime, input: 1, expected: "0:00:01"),
        V(fn: .paceMinSec, input: 59, expected: "0:59"),
        V(fn: .clock, input: 59, expected: "0:59"),
        V(fn: .raceTime, input: 59, expected: "0:00:59"),
        V(fn: .paceMinSec, input: 60, expected: "1:00"),
        V(fn: .clock, input: 60, expected: "1:00"),
        V(fn: .raceTime, input: 60, expected: "0:01:00"),
        V(fn: .paceMinSec, input: 61, expected: "1:01"),
        V(fn: .clock, input: 61, expected: "1:01"),
        V(fn: .raceTime, input: 61, expected: "0:01:01"),
        V(fn: .paceMinSec, input: 90, expected: "1:30"),
        V(fn: .clock, input: 90, expected: "1:30"),
        V(fn: .raceTime, input: 90, expected: "0:01:30"),
        V(fn: .paceMinSec, input: 419, expected: "6:59"),
        V(fn: .clock, input: 419, expected: "6:59"),
        V(fn: .raceTime, input: 419, expected: "0:06:59"),
        V(fn: .paceMinSec, input: 420, expected: "7:00"),
        V(fn: .clock, input: 420, expected: "7:00"),
        V(fn: .raceTime, input: 420, expected: "0:07:00"),
        V(fn: .paceMinSec, input: 421, expected: "7:01"),
        V(fn: .clock, input: 421, expected: "7:01"),
        V(fn: .raceTime, input: 421, expected: "0:07:01"),
        V(fn: .paceMinSec, input: 451, expected: "7:31"),
        V(fn: .clock, input: 451, expected: "7:31"),
        V(fn: .raceTime, input: 451, expected: "0:07:31"),
        V(fn: .paceMinSec, input: 599, expected: "9:59"),
        V(fn: .clock, input: 599, expected: "9:59"),
        V(fn: .raceTime, input: 599, expected: "0:09:59"),
        V(fn: .paceMinSec, input: 600, expected: "10:00"),
        V(fn: .clock, input: 600, expected: "10:00"),
        V(fn: .raceTime, input: 600, expected: "0:10:00"),
        V(fn: .paceMinSec, input: 359.5, expected: "6:00"),
        V(fn: .clock, input: 359.5, expected: "6:00"),
        V(fn: .raceTime, input: 359.5, expected: "0:06:00"),
        V(fn: .paceMinSec, input: 359.51, expected: "6:00"),
        V(fn: .clock, input: 359.51, expected: "6:00"),
        V(fn: .raceTime, input: 359.51, expected: "0:06:00"),
        V(fn: .paceMinSec, input: 419.5, expected: "7:00"),
        V(fn: .clock, input: 419.5, expected: "7:00"),
        V(fn: .raceTime, input: 419.5, expected: "0:07:00"),
        V(fn: .paceMinSec, input: 449.7, expected: "7:30"),
        V(fn: .clock, input: 449.7, expected: "7:30"),
        V(fn: .raceTime, input: 449.7, expected: "0:07:30"),
        V(fn: .paceMinSec, input: 479.4, expected: "7:59"),
        V(fn: .clock, input: 479.4, expected: "7:59"),
        V(fn: .raceTime, input: 479.4, expected: "0:07:59"),
        V(fn: .paceMinSec, input: 479.5, expected: "8:00"),
        V(fn: .clock, input: 479.5, expected: "8:00"),
        V(fn: .raceTime, input: 479.5, expected: "0:08:00"),
        V(fn: .paceMinSec, input: 479.7, expected: "8:00"),
        V(fn: .clock, input: 479.7, expected: "8:00"),
        V(fn: .raceTime, input: 479.7, expected: "0:08:00"),
        V(fn: .paceMinSec, input: 539.6, expected: "9:00"),
        V(fn: .clock, input: 539.6, expected: "9:00"),
        V(fn: .raceTime, input: 539.6, expected: "0:09:00"),
        V(fn: .paceMinSec, input: 599.7, expected: "10:00"),
        V(fn: .clock, input: 599.7, expected: "10:00"),
        V(fn: .raceTime, input: 599.7, expected: "0:10:00"),
        V(fn: .paceMinSec, input: 3599, expected: "59:59"),
        V(fn: .clock, input: 3599, expected: "59:59"),
        V(fn: .raceTime, input: 3599, expected: "0:59:59"),
        V(fn: .paceMinSec, input: 3599.4, expected: "59:59"),
        V(fn: .clock, input: 3599.4, expected: "59:59"),
        V(fn: .raceTime, input: 3599.4, expected: "0:59:59"),
        V(fn: .paceMinSec, input: 3599.5, expected: "60:00"),
        V(fn: .clock, input: 3599.5, expected: "1:00:00"),
        V(fn: .raceTime, input: 3599.5, expected: "1:00:00"),
        V(fn: .paceMinSec, input: 3599.7, expected: "60:00"),
        V(fn: .clock, input: 3599.7, expected: "1:00:00"),
        V(fn: .raceTime, input: 3599.7, expected: "1:00:00"),
        V(fn: .paceMinSec, input: 3600, expected: "60:00"),
        V(fn: .clock, input: 3600, expected: "1:00:00"),
        V(fn: .raceTime, input: 3600, expected: "1:00:00"),
        V(fn: .paceMinSec, input: 3601, expected: "60:01"),
        V(fn: .clock, input: 3601, expected: "1:00:01"),
        V(fn: .raceTime, input: 3601, expected: "1:00:01"),
        V(fn: .paceMinSec, input: 3661.4, expected: "61:01"),
        V(fn: .clock, input: 3661.4, expected: "1:01:01"),
        V(fn: .raceTime, input: 3661.4, expected: "1:01:01"),
        V(fn: .paceMinSec, input: 6113, expected: "101:53"),
        V(fn: .clock, input: 6113, expected: "1:41:53"),
        V(fn: .raceTime, input: 6113, expected: "1:41:53"),
        V(fn: .paceMinSec, input: 7199.8, expected: "120:00"),
        V(fn: .clock, input: 7199.8, expected: "2:00:00"),
        V(fn: .raceTime, input: 7199.8, expected: "2:00:00"),
        V(fn: .paceMinSec, input: 7200, expected: "120:00"),
        V(fn: .clock, input: 7200, expected: "2:00:00"),
        V(fn: .raceTime, input: 7200, expected: "2:00:00"),
        V(fn: .paceMinSec, input: 6113, expected: "101:53"),
        V(fn: .clock, input: 6113, expected: "1:41:53"),
        V(fn: .raceTime, input: 6113, expected: "1:41:53"),
        V(fn: .paceMinSec, input: 10800, expected: "180:00"),
        V(fn: .clock, input: 10800, expected: "3:00:00"),
        V(fn: .raceTime, input: 10800, expected: "3:00:00"),
        V(fn: .paceMinSec, input: 11805.6, expected: "196:46"),
        V(fn: .clock, input: 11805.6, expected: "3:16:46"),
        V(fn: .raceTime, input: 11805.6, expected: "3:16:46"),
        V(fn: .paceMinSec, input: -1, expected: nil),
        V(fn: .clock, input: -1, expected: nil),
        V(fn: .raceTime, input: -1, expected: nil),
        V(fn: .paceMinSec, input: 0.4, expected: "0:00"),
        V(fn: .clock, input: 0.4, expected: "0:00"),
        V(fn: .raceTime, input: 0.4, expected: "0:00:00"),
        V(fn: .paceMinSec, input: 0.6, expected: "0:01"),
        V(fn: .clock, input: 0.6, expected: "0:01"),
        V(fn: .raceTime, input: 0.6, expected: "0:00:01"),
        V(fn: .miles, input: 0, expected: "0"),
        V(fn: .miles, input: 0.04, expected: "0"),
        V(fn: .miles, input: 0.05, expected: "0.1"),
        V(fn: .miles, input: 1, expected: "1"),
        V(fn: .miles, input: 1.04, expected: "1"),
        V(fn: .miles, input: 1.05, expected: "1.1"),
        V(fn: .miles, input: 6.2, expected: "6.2"),
        V(fn: .miles, input: 6.24, expected: "6.2"),
        V(fn: .miles, input: 6.25, expected: "6.3"),
        V(fn: .miles, input: 13.1, expected: "13.1"),
        V(fn: .miles, input: 26.2, expected: "26.2"),
        V(fn: .miles, input: 100, expected: "100"),
        V(fn: .paceDeltaSec, input: -24.4, expected: "−24 s/mi"),
        V(fn: .paceDeltaSec, input: -24.5, expected: "−25 s/mi"),
        V(fn: .paceDeltaSec, input: -1, expected: "−1 s/mi"),
        V(fn: .paceDeltaSec, input: 0, expected: "0 s/mi"),
        V(fn: .paceDeltaSec, input: 0.4, expected: "0 s/mi"),
        V(fn: .paceDeltaSec, input: 1, expected: "+1 s/mi"),
        V(fn: .paceDeltaSec, input: 24.5, expected: "+25 s/mi"),
        V(fn: .paceDeltaSec, input: 24.4, expected: "+24 s/mi"),
        V(fn: .bpm, input: 0, expected: nil),
        V(fn: .bpm, input: 1, expected: "1"),
        V(fn: .bpm, input: 51.4, expected: "51"),
        V(fn: .bpm, input: 51.5, expected: "52"),
        V(fn: .bpm, input: 152, expected: "152"),
        V(fn: .bpm, input: 164.5, expected: "165"),
        V(fn: .bpm, input: 199, expected: "199"),
    ]
}

/// EVERY WORKOUT TYPE THE SERVER CAN PUT ON THE WIRE, with the word it turns
/// each into for the display register.
///
/// A type headlined a screen in 44pt Archivo as `RACE_WEEK_TUNEUP` because
/// nothing checked that the phone had a word for it. `RegisterSweepTests`
/// walks this list and asserts the phone maps every one — so a type added to
/// the server with no client mapping fails on the phone rather than on the
/// runner's screen.
enum TypeVocabulary {
    struct T {
        let wire: String
        /// What the server headlines it as.
        let serverTitle: String
    }

    static let all: [T] = [
        T(wire: "cross", serverTitle: "CROSS-TRAIN"),
        T(wire: "easy", serverTitle: "EASY"),
        T(wire: "fartlek", serverTitle: "FARTLEK"),
        T(wire: "intervals", serverTitle: "INTERVALS"),
        T(wire: "long", serverTitle: "LONG"),
        T(wire: "post_race", serverTitle: "RACE DONE"),
        T(wire: "progression", serverTitle: "PROGRESSION"),
        T(wire: "race", serverTitle: "RACE"),
        T(wire: "race_week_tuneup", serverTitle: "TUNE-UP"),
        T(wire: "recovery", serverTitle: "RECOVERY"),
        T(wire: "rest", serverTitle: "REST"),
        T(wire: "shakeout", serverTitle: "SHAKEOUT"),
        T(wire: "strength", serverTitle: "STRENGTH"),
        T(wire: "tempo", serverTitle: "TEMPO"),
        T(wire: "threshold", serverTitle: "THRESHOLD"),
        T(wire: "unplanned", serverTitle: "UNPLANNED"),
        T(wire: "vo2max", serverTitle: "INTERVALS"),
    ]
}
