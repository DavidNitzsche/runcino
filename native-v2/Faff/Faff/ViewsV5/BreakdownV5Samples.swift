//
//  BreakdownV5Samples.swift
//  faff.run iPhone · the post-run breakdown, on both grains, from real runs.
//
//  ─────────────────────────────────────────────────────────────────────────
//  WHY THESE ARE REAL
//
//  The breakdown picks its grain from the run — miles for a steady run,
//  sections for a session made of pieces — so the only way to review it is to
//  look at both. The payloads below are production data pulled over
//  `faff_readonly`, not invented ones, because the awkward parts are the
//  point:
//
//    · THE EASY RUN is 2026-08-24, on the RICHER of the two stored split
//      arrays — five splits covering 4.11 mi, with cadence and per-mile
//      climb. Its heart rates run 127 / 140 / 138 / 144 / 158: a Z1 opening
//      and a Z4 finish against Friel bands off LTHR 162. That is the reading
//      a coloured line could never show, and the reason this table exists.
//      Its fifth split covers 0.11 of a mile, so it is the partial-tail case
//      as well.
//
//    · THE SAME RUN, THINNER is the canonical row as it stands before the
//      merge repair: three splits, no cadence, no per-mile climb, no
//      `distanceMi`. Columns nobody has data for are not drawn, and no row
//      claims a length it was not told. This is what 26 of 71 merged runs
//      currently look like.
//
//    · THE GAPPY RUN has heart rate missing on two miles. Those cells are
//      empty — never a neighbour's number, never a red dash.
//
//    · THE REP SESSION is the shape a mile table cannot describe, which is
//      exactly why it gets sections instead.
//
//      xcrun simctl launch <udid> run.faff.app -faffV5Screens 5b-miles
//

import SwiftUI

enum BreakdownV5Samples {

    /// The 2026-08-24 route, verbatim from `runs.data->>'routePolyline'`.
    static let polyline = "mktoEdclrU??FBlC`@DMJ?JBJBLBJ@J@H?JBJCHGBM@KCQ@MCIBM?MAM?MAM@K@O?MAK?M?M?O@KCM?K@M?M?SAM?K?M@K@K?O?K?O?K?K?K?OAM?K?O@M?M?KAS@K?M@M?MAM?MAK?M@O?M?KAM@M?MAKAO@M?K?M@M?KAM@OBIHO?MAQ@K?KAQAK@O@Q?K?K`@ID@d@GEEEM?EEM?Q?O?O?O?MAO?O?MBO@O@M?K@MAM?M@K?M?MAMAO?KAMAO@MCK?K?O@O?K?M?K@M@M?M@K@MAM?M@MAM?KAM?K?M?K?M@K?M?M?K?O?M?MEMAMAOFQ?K?M@M?KAQ?K?KAKAM@M@MCK?M?M?K@O@MAKAM?O@O?M?M?K?MAK?M@M?M?M?M@MBMAK?M@KAM@MAM?M?K?M@MCQCMAK?KAK?MDKAO@QAM?KAI@K?O?M?K?M?M?O?K?K?M@I@O@O?K?MAQ?M?M?KAMAKAM?M?M@M?KAK@M@OAM?K?KAK@M@M@K@MAI?M?M@MAM?K@K?MAI?M?KMMCIAO?OAO?M?KAO?M?M@O?MAM?I@O@O?KAK?M?M?O@M?M?M?MAK?M?MCM?M?MAM?M?M?M@OAKAM@MDMBM?MBMBM@MAM?I?M?M@O?M?M@SAM?K@M@K?O?M@KAM@M?OAOAI?K@M?M@M?MAK?MAM?M?O@K?M?M?O@MAK?O?KCM?S?KAO?M?O?O?M?M?O?K?K?M?K?M?O?K?MAM?M?K?O?M@K?MAM@KAM?O?K@MAK?M?M?O?K?M?K?M@M@M?M?M@M?MBK?M@M?KAM?KAK?OBMBK?M@MAK?O@M?M?K@MAK?MCMAOAMAM@M@K?K@OBK?MCK?K?KAO?M?MAM@KBK@O@MBK?MAKAMCM?K?OAMAM?KAM?M@M?M?K?M?M?M?K@M@M?M?O@K@M?M@O?KAMAKAMAMAM?M?K@MBK@K?M?M?O?M@MAK?K?MAM?OAMAKAK?M?M?OAKAM?M@KBM?K@M@M?K@MAKAKCMAK?M?O?K?K@K@M?K@MAKAKALBNAJ?L?LALALAP@L@LBJDHBJ?LALAJALCNALCJ@L?J@N?L@LAH@LBL@J@LAP@LAJ?N?J@LAN?LCJ?JALAN?J@J@J?J@L@H@L@NAL?LAH?N?J?L?JALAJ?L?JALAL?LCH@N?J@L@J@L?J?L@L@L@LBLAJANAJALALAL?JAJ?J@L@J@J@L?LCJ?JANAJ?LAJBLBH@L@L?LAJ?L?J?N?JAJ?L?L?JALAL@L@N?HAJ?NALAL?JCL?LAJAJ?L@LCJ@L?L?N@J?LAL?L?L@L?J?H@NAL@J?L?JAL?J?N@H?L?J?J?N@LAJ?R?JAL?L@L?J?JAn@???LGBBh@?L@D@PBLBJ@LALAL?LAN?N?NALAL@L@J?N@LAH@LCJ@PBL?JANBJAN@JALCLAL@N@N?N?L?L?LALEJCJ?L?L?N?H?N?LAL?LAN@J?L?J@N?J@JBJ?N?J@LAH?N@N?J@L?J?L?LBLAJ?L?LAJ?N?N?LAJ@L?L?L@J@L?H@L?N@L?LAN?J?LAL?L?LCLAL?JAJ?N@J?N?J?J?J?L?L?J?J@R?L?JBJ?J@N?L?L?JAJ?LAN?JAJ?J?L?N?LAJAL@L?L@L?LAJ?L@L?JAJ?N?J?L@J@L?J?JBLAJ@L?LAL?LBLAJ?JALALAL@L?L?JAL@LAL?J@J?LAL@J?J?N?LAN?N@JAL@J?J?L?L?N@N@NAN@J?JANAJALAJCLBL@JBR?J?J?J?N?J?L@JAL?L?L?J?L?J?N?LAJ?JALAJ?J?H@JAL@J?J?J?L?L?N@LALBN@L?LAL@L?LAN@J?L?LAL?LALAL?L?L?LAL?L@L?L?N?LAJ?N?L?LCL@PAJ?LEBU_@RZq@V@N@P?F?LAJIPCL?L?L?L@L?L@PAL?N@J?J?N@JANAL?L?N?J?P@J?JAN@N?L?L?L?L?L?L?L?N?NAL?J@L?PCL?NANAJ?LAL?L@N?N?L@J?LCN@N?J?P?LCL?L@N?L?N?L?J?L?L?NKFMBM?K?MAKAKCKCMEGCKEKEMEIEICKEICKEKAI?ICIBG?"

    /// PER MILE. The five-split array — the trailing 0.11 mi piece and the
    /// 158 bpm finish included.
    static let easy: V5Today = make(
        dayState: "easy", paceBand: "null",
        splits: """
        [{"mile":1,"pace":"8:17","hr":127,"cadence":150,"elev_change_ft":2,"distanceMi":1},
         {"mile":2,"pace":"8:27","hr":140,"cadence":167,"elev_change_ft":-7,"distanceMi":1},
         {"mile":3,"pace":"8:28","hr":138,"cadence":152,"elev_change_ft":11,"distanceMi":1},
         {"mile":4,"pace":"8:22","hr":144,"cadence":147,"elev_change_ft":0,"distanceMi":1},
         {"mile":5,"pace":"8:23","hr":158,"cadence":148,"elev_change_ft":0,"distanceMi":0.1113}]
        """)

    /// PER MILE, THINNER. The poorer array the merge currently keeps.
    static let easyThin: V5Today = make(
        dayState: "easy", paceBand: "null",
        splits: """
        [{"mile":1,"pace":"8:28","hr":128},
         {"mile":2,"pace":"8:23","hr":140},
         {"mile":3,"pace":"8:42","hr":139}]
        """)

    /// PER MILE, WITH GAPS. Two miles with no heart rate of their own.
    static let easyGaps: V5Today = make(
        dayState: "easy", paceBand: "null",
        splits: """
        [{"mile":1,"pace":"8:17","hr":127,"elev_change_ft":2,"distanceMi":1},
         {"mile":2,"pace":"8:27","elev_change_ft":-7,"distanceMi":1},
         {"mile":3,"pace":"8:28","elev_change_ft":11,"distanceMi":1},
         {"mile":4,"pace":"8:22","hr":144,"elev_change_ft":0,"distanceMi":1},
         {"mile":5,"pace":"8:23","hr":158,"elev_change_ft":0,"distanceMi":0.1113}]
        """)

    /// PER SECTION. A session made of pieces — a mile table would average the
    /// back of one rep, a jog and the front of the next into a single row.
    static let reps: V5Today = make(
        dayState: "quality", paceBand: "{\"lo\": 395, \"hi\": 415}",
        splits: """
        [{"mile":1,"pace":"9:02","hr":132,"distanceMi":1},
         {"mile":2,"pace":"7:14","hr":158,"distanceMi":1},
         {"mile":3,"pace":"7:26","hr":163,"distanceMi":1},
         {"mile":4,"pace":"8:51","hr":141,"distanceMi":0.62}]
        """,
        phases: """
        [{"mi":1.20,"sec":542},{"mi":0.62,"sec":404},{"mi":0.25,"sec":528},
         {"mi":0.62,"sec":399},{"mi":0.25,"sec":531},{"mi":0.62,"sec":407},
         {"mi":1.06,"sec":549}]
        """)

    // MARK: - Assembly

    private static func make(dayState: String,
                             paceBand: String,
                             splits: String,
                             phases: String = "[]") -> V5Today {
        let json = """
        {
          "dateISO": "2026-08-24",
          "state": "after_run",
          "panel": {
            "dayState": "\(dayState)", "kicker": "Monday",
            "headline": "4.11 mi", "sub": "8:24 /mi",
            "weekLine": "Logged 34:32", "days": []
          },
          "groups": [], "why": null, "whereYouAre": [], "beforeYouGo": [],
          "askedVsRan": [], "verdict": null, "facts": [], "win": null,
          "conditionsNote": null, "coachTip": null,
          "zoneShares": [37, 42, 17, 4, 0], "zoneTarget": null,
          "zoneTargets": [2],
          "elevation": [12, 18, 26, 31, 24, 19, 14, 11, 16, 22, 28, 21, 15, 10],
          "elevGainFt": 74, "elevGainMeasured": true,
          "routePolyline": "\(Self.polyline)",
          "routeSplits": \(splits),
          "routePhases": \(phases),
          "hrZones": [{"label":"Z1","lower":0,"upper":138},
                      {"label":"Z2","lower":138,"upper":144},
                      {"label":"Z3","lower":146,"upper":152},
                      {"label":"Z4","lower":154,"upper":160},
                      {"label":"Z5","lower":162,"upper":178}],
          "paceBand": \(paceBand),
          "whatThisDidToTheWeek": [], "shoesWorn": null, "shoeOptions": [],
          "onTheBelt": null
        }
        """
        // swiftlint:disable:next force_try
        return try! JSONDecoder().decode(V5Today.self, from: Data(json.utf8))
    }
}
