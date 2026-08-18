#!/usr/bin/env python3
"""
2026-06-09 · race-killer deploy — hunk-level index surgery.

Seven files in the shared checkout carry BOTH my race-killer hunks and
other sessions' uncommitted WIP (palette sweep, UI passes). This script
builds each file's INDEX content as HEAD + exactly my edits, writes the
blob with `git hash-object -w`, and points the index at it with
`git update-index --cacheinfo`. The WORKTREE is never touched — the
other agents' WIP stays exactly where it is, and my commit contains
only my hunks.

Each edit is an exact-literal string replacement against the HEAD
version; the script hard-fails if any literal is missing or ambiguous
(which would mean HEAD moved under me — abort, re-derive).
"""
import subprocess, sys

REPO = "/Volumes/WP/06 Claude Code/Runcino"

def head(path: str) -> str:
    return subprocess.run(["git", "-C", REPO, "show", f"HEAD:{path}"],
                          check=True, capture_output=True, text=True).stdout

def stage(path: str, content: str) -> None:
    h = subprocess.run(["git", "-C", REPO, "hash-object", "-w", "--stdin"],
                       input=content, check=True, capture_output=True, text=True).stdout.strip()
    subprocess.run(["git", "-C", REPO, "update-index", "--add",
                    "--cacheinfo", f"100644,{h},{path}"], check=True)
    print(f"staged  {path}  {h[:12]}")

def replace_once(src: str, old: str, new: str, path: str, tag: str) -> str:
    n = src.count(old)
    if n != 1:
        print(f"FATAL: {path} [{tag}] — literal found {n} times (expected 1)", file=sys.stderr)
        sys.exit(1)
    return src.replace(old, new, 1)

EDITS: list[tuple[str, list[tuple[str, str, str]]]] = []

# ── 1 · web TodayView.tsx ────────────────────────────────────────────────
EDITS.append(("web-v2/components/faff-app/views/TodayView.tsx", [
    ("import",
     "import { useGlossaryDrawer } from '../toolkit/GlossaryDrawer';",
     "import { useGlossaryDrawer } from '../toolkit/GlossaryDrawer';\nimport { parseRaceTime } from '@/lib/training/vdot';"),
    ("parser",
     """function parseHMSToSec(s: string | null | undefined): number | null {
  if (!s) return null;
  const parts = s.split(':').map(Number);
  if (parts.some((n) => !Number.isFinite(n))) return null;
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return null;
}""",
     """/** 2026-06-09 · race-killer F2 — delegate to the shared parser. The local
 *  2-part branch read "1:30" (the stored AFC goalDisplay) as 90 seconds, so
 *  the first-ever race-morning render would have shown goal pace "0:07/mi"
 *  and B·SAFE "8:30". parseRaceTime carries the H:MM-vs-MM:SS heuristic
 *  fixed in lib on 2026-06-03 (vdot.ts:145) — race-day surfaces never got it. */
function parseHMSToSec(s: string | null | undefined): number | null {
  return parseRaceTime(s);
}"""),
]))

# ── 2 · web TrainView.tsx ────────────────────────────────────────────────
EDITS.append(("web-v2/components/faff-app/views/TrainView.tsx", [
    ("import",
     "import { formatRaceTime } from '@/lib/training/vdot';",
     "import { formatRaceTime, parseRaceTime } from '@/lib/training/vdot';"),
    ("racePace",
     """  const racePaceStr = (() => {
    if (!goalRace?.goal || !goalRace?.distanceMi) return null;
    const parts = goalRace.goal.split(':').map(Number);
    const totalSec = parts.length === 3
      ? parts[0] * 3600 + parts[1] * 60 + parts[2]
      : parts.length === 2
      ? parts[0] * 60 + parts[1]
      : null;
    if (totalSec == null) return null;
    return fmtPace(totalSec / goalRace.distanceMi);
  })();""",
     """  const racePaceStr = (() => {
    if (!goalRace?.goal || !goalRace?.distanceMi) return null;
    // 2026-06-09 · race-killer F2 — shared parser. The inline 2-part branch
    // read the stored "1:30" goal as 90s → "0:07/mi" in this copy, live daily.
    const totalSec = parseRaceTime(goalRace.goal);
    if (totalSec == null) return null;
    return fmtPace(totalSec / goalRace.distanceMi);
  })();"""),
]))

# ── 3 · web RaceView.tsx ─────────────────────────────────────────────────
EDITS.append(("web-v2/components/faff-app/views/RaceView.tsx", [
    ("import",
     "import { RaceRetrospectiveForm } from '@/components/races/RaceRetrospectiveForm';",
     "import { RaceRetrospectiveForm } from '@/components/races/RaceRetrospectiveForm';\nimport { parseRaceTime } from '@/lib/training/vdot';"),
    ("parseHMS",
     """function parseHMS(t: string): number {
  const parts = (t || '').trim().split(':').map(x => parseInt(x, 10) || 0);
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 3600 + parts[1] * 60;
  return 0;
}""",
     """/** 2026-06-09 · race-killer F2 — shared parser. The local 2-part branch
 *  forced H:MM, so a sub-hour goal typed "45:00" (10K) normalized to 45
 *  HOURS. parseRaceTime disambiguates h:mm vs m:ss (vdot.ts:145):
 *  "1:30" → 5400 · "45:00" → 2700. Keeps this file's number/0 contract. */
function parseHMS(t: string): number {
  return parseRaceTime((t || '').trim()) ?? 0;
}"""),
]))

# ── 4 · web raceDetail.ts ────────────────────────────────────────────────
EDITS.append(("web-v2/components/faff-app/raceDetail.ts", [
    ("import",
     "import { userIdFromCookies } from '@/lib/auth/session';",
     "import { userIdFromCookies } from '@/lib/auth/session';\nimport { buildRacePacing, type CourseGeometryInput } from '@/lib/race/pacing';"),
    ("buildSplits",
     """function buildSplits(goalSec: number, distMi: number): RaceDetailSeed['splits'] {
  if (!goalSec || !distMi) return [];
  const ladder: Array<{ label: string; mi: number }> = [
    { label: '5K',  mi: 3.1069 },
    { label: '10K', mi: 6.2137 },
    { label: 'HALF', mi: 13.1094 },
    { label: '30K', mi: 18.641 },
    { label: '40K', mi: 24.855 },
  ];
  const out = ladder
    .filter(r => r.mi < distMi - 0.1)
    .map(r => ({ label: r.label, val: cumAt(goalSec, distMi, r.mi) }));
  out.push({ label: 'FINISH', val: formatRaceTime(Math.round(goalSec)) ?? '·' });
  return out;
}""",
     """/** 2026-06-09 · race-killer F3 — course-aware goal splits. Delegates to
 *  lib/race/pacing.ts: grade-weighted over the authored course phases when
 *  the library has them (cite Research/11 §grade-cost), the identical
 *  linear ladder when it doesn't. Flat-course splits on AFC told the
 *  runner to bank nothing on The Drop and left the Balboa climb unpriced. */
function buildSplits(
  goalSec: number,
  distMi: number,
  geometry?: CourseGeometryInput | null,
): RaceDetailSeed['splits'] {
  if (!goalSec || !distMi) return [];
  return buildRacePacing({ goalSec, distanceMi: distMi, geometry: geometry ?? null })
    .splits.map(s => ({ label: s.label, val: s.display }));
}"""),
    ("libQuery",
     """      pool.query(
        `SELECT source, contributor_count, start_label, finish_label, notes
           FROM course_library WHERE slug = $1`,
        [slug]
      ).catch(() => ({ rows: [] as Array<{ source: string | null; contributor_count: number | null; start_label: string | null; finish_label: string | null; notes: string | null }> })),""",
     """      // 2026-06-09 · race-killer F3 — also pull geometry_json: the authored
      // phase profile feeds course-aware goal splits (lib/race/pacing.ts).
      pool.query(
        `SELECT source, contributor_count, start_label, finish_label, notes, geometry_json
           FROM course_library WHERE slug = $1`,
        [slug]
      ).catch(() => ({ rows: [] as Array<{ source: string | null; contributor_count: number | null; start_label: string | null; finish_label: string | null; notes: string | null; geometry_json: unknown }> })),"""),
    ("splitsCall",
     "      splits: buildSplits(aGoalSec, dist),",
     "      splits: buildSplits(aGoalSec, dist, (lib as { geometry_json?: unknown } | null)?.geometry_json as CourseGeometryInput | null),"),
]))

# ── 5 · web GapPanel.tsx ─────────────────────────────────────────────────
EDITS.append(("web-v2/components/faff-app/views/GapPanel.tsx", [
    ("import",
     "import { useEffect, useMemo, useState } from 'react';\nimport type { GoalRace } from '../types';",
     "import { useEffect, useMemo, useState } from 'react';\nimport type { GoalRace } from '../types';\nimport { parseRaceTime } from '@/lib/training/vdot';"),
    ("parser",
     """function parseClockToSec(s: string | null | undefined): number | null {
  if (!s || s === '·') return null;
  const parts = s.split(':').map(Number);
  if (parts.some(Number.isNaN)) return null;
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) {
    // 2026-06-04 · disambiguate h:mm vs m:ss · race goals are typically
    // stored as "1:30" meaning 1 hour 30 minutes (5400s), not 1m30s (90s).
    // David's QC: fitness chip showed "92:48" because goalSec=90 (misparsed)
    // → totalGap = projSec - 90 = 5604 → fitness = 5568 ≈ 92:48.
    //
    // Heuristic: if the second part is 00-59 AND the first part is
    // 1-9 (small-hour range), AND the implied m:ss would be < 10 min
    // (unrealistic race finish), treat as h:mm. Real race finishes
    // start at 12-15 min (5K) so a "race time" parsed below 10 min
    // is almost certainly an h:mm mis-parse.
    const asMinSec = parts[0] * 60 + parts[1];
    if (asMinSec < 600 && parts[0] >= 1 && parts[0] <= 9 && parts[1] >= 0 && parts[1] < 60) {
      return parts[0] * 3600 + parts[1] * 60;
    }
    return asMinSec;
  }
  return null;
}""",
     """function parseClockToSec(s: string | null | undefined): number | null {
  // 2026-06-09 · race-killer F2 — delegate to the shared parser so every
  // surface disambiguates "1:30" (h:mm goal) vs "23:15" (m:ss finish) the
  // same way. This panel had its own fix since 2026-06-04 (David's QC:
  // fitness chip "92:48" from goalSec=90); same heuristic, now one copy.
  if (s === '·') return null;
  return parseRaceTime(s);
}"""),
]))

# ── 6 · native RaceDayView.swift ─────────────────────────────────────────
EDITS.append(("native-v2/Faff/Faff/Views/RaceDayView.swift", [
    ("goalPace",
     """    private var goalPace: String {
        guard let g = detail?.race.goal,
              let dist = detail?.race.distance_mi, dist > 0 else { return "—" }
        let parts = g.split(separator: ":").map { Int($0) ?? 0 }
        let totalSec: Int
        switch parts.count {
        case 3: totalSec = parts[0] * 3600 + parts[1] * 60 + parts[2]
        case 2: totalSec = parts[0] * 60 + parts[1]
        default: return "—"
        }
        let perMile = Int(round(Double(totalSec) / dist))
        return String(format: "%d:%02d", perMile / 60, perMile % 60)
    }""",
     """    private var goalPace: String {
        // 2026-06-09 · race-killer F2 — RaceClock (API.swift) carries the
        // h:mm-vs-m:ss heuristic. The local 2-part branch read the stored
        // "1:30" goal as 90s → "0:07/mi" on race morning.
        guard let totalSec = RaceClock.seconds(from: detail?.race.goal),
              let dist = detail?.race.distance_mi, dist > 0 else { return "—" }
        let perMile = Int(round(Double(totalSec) / dist))
        return String(format: "%d:%02d", perMile / 60, perMile % 60)
    }"""),
    ("parsedGoalSec",
     """    /// Parse goal string ("1:30:00" / "45:00") → total seconds. Used by
    /// B-goal, splits, and fuel computations so we only decode once.
    private var parsedGoalSec: Int? {
        guard let g = detail?.race.goal else { return nil }
        let parts = g.split(separator: ":").compactMap { Int($0) }
        switch parts.count {
        case 3: return parts[0] * 3600 + parts[1] * 60 + parts[2]
        case 2: return parts[0] * 60 + parts[1]
        default: return nil
        }
    }""",
     """    /// Parse goal string ("1:30:00" / "1:30" / "45:00") → total seconds.
    /// Used by B-goal, splits, and fuel computations so we only decode once.
    /// 2026-06-09 · race-killer F2 — RaceClock (API.swift). The local
    /// 2-part branch read the stored "1:30" goal as 90 seconds, which made
    /// this view's race-morning splits card show 5K "0:21" and B-goal "8:30".
    private var parsedGoalSec: Int? {
        RaceClock.seconds(from: detail?.race.goal)
    }"""),
    ("raceSplits",
     """    /// Cumulative split times at standard checkpoints. Mirrors web
    /// raceDetail.ts:buildSplits — same ladder, same filter rule.
    private var raceSplits: [(label: String, time: String)] {
        guard let gs = parsedGoalSec,
              let dist = detail?.race.distance_mi, dist > 0 else { return [] }""",
     """    /// Cumulative split times at standard checkpoints.
    /// 2026-06-09 · race-killer F3 — prefer the server's course-aware
    /// splits (RaceDetailResponse.pacing · grade-weighted over the
    /// authored course phases, cite Research/11 §grade-cost). The local
    /// linear ladder remains as the fallback for older servers / courses
    /// with no usable phase profile — flat-course splits on AFC told the
    /// runner to bank nothing on The Drop and left the Balboa climb
    /// unpriced.
    private var raceSplits: [(label: String, time: String)] {
        if let server = detail?.pacing?.splits, !server.isEmpty {
            return server.map { ($0.label, $0.display) }
        }
        guard let gs = parsedGoalSec,
              let dist = detail?.race.distance_mi, dist > 0 else { return [] }"""),
]))

# ── 7 · native TargetsView.swift ─────────────────────────────────────────
EDITS.append(("native-v2/Faff/Faff/Views/TargetsView.swift", [
    ("goalSeconds",
     """    private func goalSeconds(_ g: String) -> Int? {
        let parts = g.split(separator: ":").compactMap { Int($0) }
        if parts.count == 3 { return parts[0]*3600 + parts[1]*60 + parts[2] }
        if parts.count == 2 { return parts[0]*60 + parts[1] }
        return nil
    }""",
     """    // 2026-06-09 · race-killer F2 — RaceClock (API.swift). The local 2-part
    // branch read the stored "1:30" goal as 90s → hero pace "0:06/mi".
    private func goalSeconds(_ g: String) -> Int? {
        RaceClock.seconds(from: g)
    }"""),
]))

for path, edits in EDITS:
    src = head(path)
    for tag, old, new in edits:
        src = replace_once(src, old, new, path, tag)
    stage(path, src)

print("\nindex surgery complete — worktree untouched.")
