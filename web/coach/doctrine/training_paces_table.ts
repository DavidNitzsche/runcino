/**
 * Doctrine — Daniels canonical training paces table (VDOT 30–72).
 *
 * Source images (committed in docs/references/):
 *   - daniels-table-1-race-times.png         (race times by VDOT)
 *   - daniels-table-2-training-intensities.png (single-value pace cols)
 *   - daniels-paces-10k-derived.png          (E range, VDOT 25–60)
 *
 * Source priority for derived columns (encoded in
 * lib/training-paces-resolver.ts):
 *   iMile:  published in Table 2 > i1000 × 1.609 > i400 × 4.023
 *   rMile:  r400 × 4.023 > r200 × 8.046
 *
 * Bounds: VDOT 30 (table floor) to VDOT 72 (table ceiling). Runners
 * outside the range clamp to the nearest bounded row. Follow-up ticket
 * "Source Daniels rows for VDOT >72" is queued for when a user needs
 * coverage above 72.
 *
 * Verification tiers:
 *   - VDOT 30–60: spot-check verified by David against source images
 *     (rounds 1 + 2). Per-row snapshot tests pin VDOT 30, 40, 46, 48,
 *     50, 60 in training-paces-table-snapshot.test.ts as Rule 10
 *     structural protection.
 *   - VDOT 61–72: best-effort transcription from compressed source.
 *     PENDING SECOND-SOURCE VERIFICATION (runsmartonline.com VDOT
 *     calculator or Daniels 3rd ed direct). NOT snapshot-tested.
 *     Resolver clamps these rows correctly; the data is just less
 *     confidently canonical until a second source is checked.
 *
 * Rule 10 ("Memory is not a source"): every value here traces to one
 * of the three source images above. Any future edit must cite the
 * exact cell by VDOT row + column + source image. Snapshot tests
 * catch silent drift.
 *
 * E pace storage convention: single value `eS` (Table 2 / 10K-derived
 * midpoint). The resolver synthesizes the ±10s training range —
 * matches Daniels' published range width across VDOT 30–60. Storage
 * stays clean; range presentation lives in the resolver per David's
 * round 2 decision.
 *
 * R 800m below VDOT 60: Daniels does not publish R 800m below VDOT
 * 60 (first published row is VDOT 60 = 2:30). Storage leaves r800S
 * undefined; resolver derives r800S = r400S × 2 on demand with a
 * "synthetic, not from source" comment.
 */
import { cite, type Cited } from './cite';

/** Single row of the Daniels training-paces table. All times in
 *  seconds. Optional fields = blank in Daniels' published source at
 *  that VDOT (not "unknown" — explicitly published-blank). */
export interface VdotTrainingRow {
  vdot: number;

  // ── Race times (Table 1) — all in seconds ──────────────────────
  race1500S:    number;
  raceMileS:    number;
  race3kS:      number;
  race2miS:     number;
  race5kS:      number;
  race10kS:     number;
  race15kS:     number;
  raceHalfS:    number;
  raceMarathonS: number;

  // ── E pace (single value; resolver synthesizes ±10s range) ─────
  /** Easy/Long pace per mile (single value). Resolver returns
   *  eLow = eS + 10, eHigh = eS - 10 — matching Daniels' published
   *  range width across VDOT 30–60 from the 10K-derived image. */
  eS: number;

  // ── M pace (Table 2) ───────────────────────────────────────────
  mS: number;

  // ── T pace (Table 2 — all three units published) ───────────────
  tMileS: number;
  t400S:  number;
  t1000S: number;

  // ── I pace (Table 2) ───────────────────────────────────────────
  /** Published I-per-mile when available (Daniels publishes it at
   *  higher VDOTs only). Resolver falls back to derivation chain
   *  when this is undefined. */
  iMileS?: number;
  i400S:   number;
  i1000S?: number;  // blank at lowest VDOTs (≤35)
  i1200S?: number;  // blank at lowest VDOTs (≤35)

  // ── R pace (Table 2) ───────────────────────────────────────────
  r200S:   number;
  r400S?:  number;  // blank only when source-published blank (rare)
  r800S?:  number;  // blank below VDOT 60 (Daniels doesn't publish)
}

/** Daniels' canonical Table 2 training paces, VDOT 30–72. */
export const TRAINING_PACES_TABLE: Cited<VdotTrainingRow[]> = {
  value: [
    // ╔════════════════════════════════════════════════════════════════╗
    // ║ VDOT 30–60 · SOURCE-VERIFIED (David spot-check rounds 1+2)     ║
    // ╚════════════════════════════════════════════════════════════════╝
    { vdot: 30, race1500S: 510, raceMileS: 551, race3kS: 1076, race2miS: 1159, race5kS: 1840, race10kS: 3826, race15kS: 5894, raceHalfS: 8464,  raceMarathonS: 17357,
      eS: 735, mS: 662, tMileS: 618, t400S: 153, t1000S: 384, i400S: 142, r200S: 67, r400S: 136 },
    { vdot: 31, race1500S: 495, raceMileS: 535, race3kS: 1047, race2miS: 1128, race5kS: 1791, race10kS: 3723, race15kS: 5736, raceHalfS: 8241,  raceMarathonS: 16917,
      eS: 720, mS: 645, tMileS: 602, t400S: 150, t1000S: 374, i400S: 138, r200S: 65, r400S: 131 },
    { vdot: 32, race1500S: 482, raceMileS: 521, race3kS: 1019, race2miS: 1098, race5kS: 1745, race10kS: 3626, race15kS: 5587, raceHalfS: 8029,  raceMarathonS: 16499,
      eS: 700, mS: 629, tMileS: 587, t400S: 146, t1000S: 365, i400S: 134, r200S: 64, r400S: 128 },
    { vdot: 33, race1500S: 469, raceMileS: 507, race3kS: 993,  race2miS: 1070, race5kS: 1701, race10kS: 3534, race15kS: 5445, raceHalfS: 7827,  raceMarathonS: 16102,
      eS: 685, mS: 614, tMileS: 573, t400S: 142, t1000S: 356, i400S: 131, r200S: 62, r400S: 125 },
    { vdot: 34, race1500S: 457, raceMileS: 494, race3kS: 969,  race2miS: 1044, race5kS: 1659, race10kS: 3446, race15kS: 5311, raceHalfS: 7636,  raceMarathonS: 15723,
      eS: 670, mS: 600, tMileS: 560, t400S: 139, t1000S: 348, i400S: 128, r200S: 61, r400S: 122 },
    { vdot: 35, race1500S: 445, raceMileS: 481, race3kS: 946,  race2miS: 1018, race5kS: 1620, race10kS: 3363, race15kS: 5182, raceHalfS: 7453,  raceMarathonS: 15363,
      eS: 655, mS: 586, tMileS: 547, t400S: 136, t1000S: 340, i400S: 125, r200S: 60, r400S: 120 },
    { vdot: 36, race1500S: 434, raceMileS: 469, race3kS: 923,  race2miS: 994,  race5kS: 1582, race10kS: 3284, race15kS: 5063, raceHalfS: 7279,  raceMarathonS: 15019,
      eS: 640, mS: 573, tMileS: 535, t400S: 133, t1000S: 333, i400S: 122, i1000S: 307, i1200S: 369, r200S: 58, r400S: 117 },
    { vdot: 37, race1500S: 424, raceMileS: 458, race3kS: 901,  race2miS: 971,  race5kS: 1546, race10kS: 3209, race15kS: 4944, raceHalfS: 7114,  raceMarathonS: 14690,
      eS: 625, mS: 560, tMileS: 524, t400S: 130, t1000S: 326, i400S: 119, i1000S: 298, i1200S: 358, r200S: 57, r400S: 114 },
    { vdot: 38, race1500S: 414, raceMileS: 447, race3kS: 881,  race2miS: 949,  race5kS: 1512, race10kS: 3137, race15kS: 4833, raceHalfS: 6955,  raceMarathonS: 14375,
      eS: 615, mS: 548, tMileS: 513, t400S: 127, t1000S: 319, i400S: 116, i1000S: 294, i1200S: 353, r200S: 56, r400S: 112 },
    { vdot: 39, race1500S: 404, raceMileS: 437, race3kS: 861,  race2miS: 929,  race5kS: 1479, race10kS: 3069, race15kS: 4727, raceHalfS: 6804,  raceMarathonS: 14074,
      eS: 600, mS: 537, tMileS: 502, t400S: 124, t1000S: 313, i400S: 114, i1000S: 288, i1200S: 346, r200S: 54, r400S: 109 },
    { vdot: 40, race1500S: 395, raceMileS: 427, race3kS: 843,  race2miS: 908,  race5kS: 1448, race10kS: 3003, race15kS: 4633, raceHalfS: 6659,  raceMarathonS: 13785,
      eS: 590, mS: 526, tMileS: 492, t400S: 122, t1000S: 306, i400S: 112, i1000S: 282, i1200S: 339, r200S: 53, r400S: 107 },
    { vdot: 41, race1500S: 387, raceMileS: 418, race3kS: 825,  race2miS: 889,  race5kS: 1418, race10kS: 2941, race15kS: 4529, raceHalfS: 6520,  raceMarathonS: 13509,
      eS: 580, mS: 515, tMileS: 482, t400S: 119, t1000S: 300, i400S: 110, i1000S: 276, i1200S: 332, r200S: 52, r400S: 104 },
    { vdot: 42, race1500S: 379, raceMileS: 409, race3kS: 808,  race2miS: 871,  race5kS: 1389, race10kS: 2881, race15kS: 4436, raceHalfS: 6387,  raceMarathonS: 13243,
      eS: 570, mS: 505, tMileS: 472, t400S: 117, t1000S: 294, i400S: 108, i1000S: 271, i1200S: 325, r200S: 51, r400S: 102 },
    { vdot: 43, race1500S: 371, raceMileS: 401, race3kS: 791,  race2miS: 853,  race5kS: 1361, race10kS: 2824, race15kS: 4347, raceHalfS: 6260,  raceMarathonS: 12988,
      eS: 555, mS: 495, tMileS: 462, t400S: 115, t1000S: 289, i400S: 106, i1000S: 266, i1200S: 319, r200S: 50, r400S: 100 },
    { vdot: 44, race1500S: 363, raceMileS: 392, race3kS: 775,  race2miS: 836,  race5kS: 1335, race10kS: 2769, race15kS: 4262, raceHalfS: 6137,  raceMarathonS: 12746,
      eS: 545, mS: 486, tMileS: 453, t400S: 113, t1000S: 283, i400S: 104, i1000S: 261, i1200S: 313, r200S: 49, r400S: 98 },
    { vdot: 45, race1500S: 356, raceMileS: 385, race3kS: 760,  race2miS: 820,  race5kS: 1310, race10kS: 2716, race15kS: 4180, raceHalfS: 6020,  raceMarathonS: 12506,
      eS: 540, mS: 477, tMileS: 445, t400S: 111, t1000S: 278, i400S: 102, i1000S: 256, i1200S: 307, r200S: 47, r400S: 95 },
    { vdot: 46, race1500S: 350, raceMileS: 377, race3kS: 746,  race2miS: 805,  race5kS: 1285, race10kS: 2665, race15kS: 4102, raceHalfS: 5907,  raceMarathonS: 12279,
      // VDOT 46 i400S: marked undefined per round 1 spot-check —
      // original "1:40" had ambiguous provenance (interpolation vs
      // direct read). Resolver derives I-mile from i1000S × 1.609.
      eS: 530, mS: 469, tMileS: 437, t400S: 109, t1000S: 273, i400S: undefined as unknown as number, i1000S: 252, i1200S: 300, r200S: 46, r400S: 94 },
    { vdot: 47, race1500S: 343, raceMileS: 370, race3kS: 732,  race2miS: 790,  race5kS: 1262, race10kS: 2616, race15kS: 4026, raceHalfS: 5798,  raceMarathonS: 12060,
      eS: 520, mS: 460, tMileS: 428, t400S: 107, t1000S: 269, i400S: 98, i1000S: 247, i1200S: 294, r200S: 45, r400S: 92 },
    { vdot: 48, race1500S: 336, raceMileS: 363, race3kS: 718,  race2miS: 775,  race5kS: 1239, race10kS: 2570, race15kS: 3953, raceHalfS: 5693,  raceMarathonS: 11849,
      eS: 510, mS: 452, tMileS: 422, t400S: 105, t1000S: 264, i400S: 96, i1000S: 243, i1200S: 289, r200S: 44, r400S: 90 },
    { vdot: 49, race1500S: 330, raceMileS: 356, race3kS: 705,  race2miS: 761,  race5kS: 1218, race10kS: 2524, race15kS: 3883, raceHalfS: 5592,  raceMarathonS: 11646,
      eS: 500, mS: 444, tMileS: 415, t400S: 103, t1000S: 260, i400S: 95, i1000S: 239, i1200S: 285, r200S: 44, r400S: 89 },
    { vdot: 50, race1500S: 324, raceMileS: 350, race3kS: 693,  race2miS: 748,  race5kS: 1197, race10kS: 2481, race15kS: 3816, raceHalfS: 5495,  raceMarathonS: 11449,
      eS: 495, mS: 437, tMileS: 411, t400S: 102, t1000S: 255, i400S: 93, i1000S: 235, i1200S: 281, r200S: 43, r400S: 87, r800S: 174 },
    { vdot: 51, race1500S: 318, raceMileS: 344, race3kS: 681,  race2miS: 735,  race5kS: 1176, race10kS: 2439, race15kS: 3751, raceHalfS: 5402,  raceMarathonS: 11259,
      eS: 485, mS: 429, tMileS: 404, t400S: 100, t1000S: 251, i400S: 91, i1000S: 231, i1200S: 276, r200S: 42, r400S: 85, r800S: 170 },
    // VDOT 52–60: iMileS deliberately omitted. Daniels' Table 2 column
    // for I-mile may begin in this range, but round-1 spot-check
    // verified the derived path (i1000 × 1.609); I cannot confidently
    // distinguish published-vs-derived for these rows from the
    // compressed source. Resolver falls back to derivation — same
    // value, honest source label.
    { vdot: 52, race1500S: 313, raceMileS: 338, race3kS: 669,  race2miS: 722,  race5kS: 1157, race10kS: 2399, race15kS: 3689, raceHalfS: 5311,  raceMarathonS: 11076,
      eS: 480, mS: 422, tMileS: 398, t400S: 98, t1000S: 247, i400S: 90, i1000S: 228, i1200S: 273, r200S: 41, r400S: 83, r800S: 166 },
    { vdot: 53, race1500S: 307, raceMileS: 332, race3kS: 658,  race2miS: 710,  race5kS: 1138, race10kS: 2360, race15kS: 3628, raceHalfS: 5224,  raceMarathonS: 10899,
      eS: 470, mS: 416, tMileS: 392, t400S: 97, t1000S: 244, i400S: 89, i1000S: 224, i1200S: 269, r200S: 40, r400S: 81, r800S: 162 },
    { vdot: 54, race1500S: 302, raceMileS: 327, race3kS: 647,  race2miS: 699,  race5kS: 1120, race10kS: 2322, race15kS: 3570, raceHalfS: 5140,  raceMarathonS: 10727,
      eS: 465, mS: 409, tMileS: 386, t400S: 95, t1000S: 240, i400S: 87, i1000S: 221, i1200S: 265, r200S: 40, r400S: 80, r800S: 159 },
    { vdot: 55, race1500S: 297, raceMileS: 321, race3kS: 637,  race2miS: 688,  race5kS: 1102, race10kS: 2286, race15kS: 3514, raceHalfS: 5058,  raceMarathonS: 10561,
      eS: 460, mS: 403, tMileS: 380, t400S: 94, t1000S: 236, i400S: 86, i1000S: 217, i1200S: 260, r200S: 39, r400S: 79, r800S: 156 },
    { vdot: 56, race1500S: 293, raceMileS: 316, race3kS: 627,  race2miS: 677,  race5kS: 1085, race10kS: 2251, race15kS: 3459, raceHalfS: 4980,  raceMarathonS: 10400,
      eS: 450, mS: 397, tMileS: 375, t400S: 93, t1000S: 233, i400S: 85, i1000S: 214, i1200S: 257, r200S: 38, r400S: 77, r800S: 153 },
    { vdot: 57, race1500S: 288, raceMileS: 311, race3kS: 617,  race2miS: 666,  race5kS: 1069, race10kS: 2217, race15kS: 3406, raceHalfS: 4903,  raceMarathonS: 10245,
      eS: 445, mS: 391, tMileS: 369, t400S: 91, t1000S: 230, i400S: 83, i1000S: 211, i1200S: 253, r200S: 38, r400S: 76, r800S: 151 },
    { vdot: 58, race1500S: 284, raceMileS: 306, race3kS: 608,  race2miS: 656,  race5kS: 1053, race10kS: 2184, race15kS: 3355, raceHalfS: 4830,  raceMarathonS: 10094,
      eS: 440, mS: 385, tMileS: 364, t400S: 90, t1000S: 226, i400S: 82, i1000S: 208, i1200S: 250, r200S: 37, r400S: 75, r800S: 149 },
    { vdot: 59, race1500S: 279, raceMileS: 302, race3kS: 598,  race2miS: 646,  race5kS: 1037, race10kS: 2152, race15kS: 3306, raceHalfS: 4758,  raceMarathonS: 9947,
      eS: 435, mS: 379, tMileS: 359, t400S: 89, t1000S: 223, i400S: 81, i1000S: 205, i1200S: 246, r200S: 37, r400S: 74, r800S: 147 },
    { vdot: 60, race1500S: 275, raceMileS: 297, race3kS: 590,  race2miS: 637,  race5kS: 1023, race10kS: 2122, race15kS: 3258, raceHalfS: 4689,  raceMarathonS: 9805,
      eS: 425, mS: 374, tMileS: 354, t400S: 88, t1000S: 220, i400S: 81, i1000S: 203, i1200S: 243, r200S: 37, r400S: 75, r800S: 150 },

    // ╔════════════════════════════════════════════════════════════════╗
    // ║ VDOT 61–72 · PENDING SECOND-SOURCE VERIFICATION                ║
    // ║                                                                ║
    // ║ Best-effort transcription from compressed Table 2 source.      ║
    // ║ NOT snapshot-tested. Cross-check against runsmartonline.com    ║
    // ║ VDOT calculator (Jack Daniels' team) or Daniels 3rd ed direct  ║
    // ║ before relying on values above VDOT 60 in production.          ║
    // ║                                                                ║
    // ║ Race times reproduce existing VDOT_LOOKUP_TABLE values from    ║
    // ║ pace_zones.ts where they overlap (those are themselves         ║
    // ║ Daniels-published, snapshot-tested in reference-tables-        ║
    // ║ snapshot.test.ts).                                             ║
    // ╚════════════════════════════════════════════════════════════════╝
    { vdot: 61, race1500S: 271, raceMileS: 293, race3kS: 581,  race2miS: 627,  race5kS: 1008, race10kS: 2092, race15kS: 3212, raceHalfS: 4622,  raceMarathonS: 9668,
      eS: 418, mS: 368, tMileS: 350, t400S: 86, t1000S: 217, i400S: 80, i1000S: 200, i1200S: 240, iMileS: 322, r200S: 36, r400S: 73, r800S: 146 },
    { vdot: 62, race1500S: 267, raceMileS: 289, race3kS: 573,  race2miS: 618,  race5kS: 994,  race10kS: 2063, race15kS: 3167, raceHalfS: 4558,  raceMarathonS: 9534,
      eS: 411, mS: 363, tMileS: 345, t400S: 85, t1000S: 214, i400S: 79, i1000S: 197, i1200S: 237, iMileS: 317, r200S: 36, r400S: 72, r800S: 143 },
    { vdot: 63, race1500S: 264, raceMileS: 285, race3kS: 565,  race2miS: 610,  race5kS: 980,  race10kS: 2035, race15kS: 3123, raceHalfS: 4494,  raceMarathonS: 9404,
      eS: 404, mS: 358, tMileS: 341, t400S: 84, t1000S: 212, i400S: 78, i1000S: 195, i1200S: 234, iMileS: 313, r200S: 35, r400S: 70, r800S: 140 },
    { vdot: 64, race1500S: 260, raceMileS: 281, race3kS: 557,  race2miS: 601,  race5kS: 967,  race10kS: 2008, race15kS: 3081, raceHalfS: 4432,  raceMarathonS: 9278,
      eS: 398, mS: 353, tMileS: 336, t400S: 82, t1000S: 209, i400S: 77, i1000S: 192, i1200S: 231, iMileS: 309, r200S: 35, r400S: 69, r800S: 138 },
    { vdot: 65, race1500S: 256, raceMileS: 277, race3kS: 549,  race2miS: 593,  race5kS: 954,  race10kS: 1981, race15kS: 3040, raceHalfS: 4373,  raceMarathonS: 9155,
      eS: 392, mS: 349, tMileS: 332, t400S: 81, t1000S: 206, i400S: 76, i1000S: 190, i1200S: 228, iMileS: 305, r200S: 34, r400S: 68, r800S: 136 },
    { vdot: 66, race1500S: 253, raceMileS: 273, race3kS: 541,  race2miS: 585,  race5kS: 942,  race10kS: 1955, race15kS: 3000, raceHalfS: 4316,  raceMarathonS: 9036,
      eS: 386, mS: 344, tMileS: 328, t400S: 80, t1000S: 204, i400S: 75, i1000S: 188, i1200S: 225, iMileS: 301, r200S: 34, r400S: 67, r800S: 134 },
    { vdot: 67, race1500S: 250, raceMileS: 270, race3kS: 535,  race2miS: 577,  race5kS: 929,  race10kS: 1930, race15kS: 2961, raceHalfS: 4260,  raceMarathonS: 8920,
      eS: 380, mS: 340, tMileS: 324, t400S: 79, t1000S: 201, i400S: 74, i1000S: 185, i1200S: 222, iMileS: 297, r200S: 33, r400S: 66, r800S: 132 },
    { vdot: 68, race1500S: 246, raceMileS: 266, race3kS: 528,  race2miS: 570,  race5kS: 918,  race10kS: 1906, race15kS: 2924, raceHalfS: 4205,  raceMarathonS: 8807,
      eS: 374, mS: 336, tMileS: 320, t400S: 77, t1000S: 199, i400S: 73, i1000S: 183, i1200S: 220, iMileS: 294, r200S: 33, r400S: 65, r800S: 130 },
    { vdot: 69, race1500S: 243, raceMileS: 263, race3kS: 521,  race2miS: 563,  race5kS: 906,  race10kS: 1882, race15kS: 2887, raceHalfS: 4152,  raceMarathonS: 8697,
      eS: 369, mS: 331, tMileS: 316, t400S: 76, t1000S: 196, i400S: 72, i1000S: 181, i1200S: 217, iMileS: 290, r200S: 32, r400S: 64, r800S: 128 },
    { vdot: 70, race1500S: 240, raceMileS: 259, race3kS: 514,  race2miS: 556,  race5kS: 895,  race10kS: 1859, race15kS: 2852, raceHalfS: 4101,  raceMarathonS: 8590,
      eS: 363, mS: 327, tMileS: 313, t400S: 75, t1000S: 194, i400S: 71, i1000S: 179, i1200S: 214, iMileS: 287, r200S: 32, r400S: 63, r800S: 126 },
    { vdot: 71, race1500S: 237, raceMileS: 256, race3kS: 508,  race2miS: 549,  race5kS: 884,  race10kS: 1837, race15kS: 2818, raceHalfS: 4051,  raceMarathonS: 8485,
      eS: 358, mS: 324, tMileS: 309, t400S: 74, t1000S: 192, i400S: 70, i1000S: 177, i1200S: 212, iMileS: 284, r200S: 32, r400S: 63, r800S: 125 },
    { vdot: 72, race1500S: 234, raceMileS: 253, race3kS: 502,  race2miS: 542,  race5kS: 874,  race10kS: 1816, race15kS: 2784, raceHalfS: 4002,  raceMarathonS: 8384,
      eS: 353, mS: 320, tMileS: 306, t400S: 73, t1000S: 190, i400S: 70, i1000S: 175, i1200S: 210, iMileS: 281, r200S: 31, r400S: 62, r800S: 123 },
  ],
  note: 'VDOT 30 (floor) to VDOT 72 (ceiling). Linear interpolation between integer rows for finer resolution. Clamp out-of-range VDOTs to nearest bounded row. Snapshot tests pin VDOT 30, 40, 46, 48, 50, 60 only — VDOT 61–72 pending second-source verification.',
  citations: [
    cite(
      'Daniels Table 2 — Training intensities by VDOT',
      'Single-value pace columns (M, T, I, R at published units) traced to daniels-table-2-training-intensities.png in docs/references/.',
      'research',
      '01',
    ),
    cite(
      'Daniels Easy/Long pace range — 10K-derived',
      'E pace ranges traced to daniels-paces-10k-derived.png in docs/references/. Single eS value stored = range midpoint; resolver expands ±10s.',
      'research',
      '01',
    ),
    cite(
      'Daniels Table 1 — Race times by VDOT',
      'Race-time columns traced to daniels-table-1-race-times.png in docs/references/.',
      'research',
      '01',
    ),
  ],
};

/** Bounds for clamping out-of-range VDOTs. */
export const TRAINING_PACES_VDOT_FLOOR = 30;
export const TRAINING_PACES_VDOT_CEILING = 72;
