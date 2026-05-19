# Reference images for canonical data tables

This directory holds **source-of-truth screenshots** for every canonical reference table in the codebase. The procedure (Rule 10 in `lib/adaptive-pattern.ts`):

> Modules importing canonical reference data MUST cite the source URL or book+edition+page in a code comment AND include a snapshot test pinning specific known values. Memory is not a source. Self-debate is not verification.

When a doctrine table is authored or edited:

1. The source image(s) live in this directory
2. Code comments in the doctrine file cite the image filename
3. A snapshot test in `web/lib/__tests__/reference-tables-snapshot.test.ts` pins specific known values

## Expected files

Drop these here (originals provided by David, Nov 2026 session):

| Filename | What it contains | Source |
|---|---|---|
| `daniels-table-1-race-times.png` | Race times for VDOT 30–85 across 1500m / Mile / 3K / 2-mi / 5K / 10K / 15K / HM / Marathon | Daniels' Running Formula, 3rd ed., Table 1 |
| `daniels-table-2-training-intensities.png` | Training paces (E km/mi, M, T 400/1000/mi, I 400/1000/1200/mi, R 200/400/800) for VDOT 30–~80 | Daniels' Running Formula, 3rd ed., Table 2 |
| `daniels-paces-10k-derived.png` | Same Daniels values cross-referenced by 10K race time. **Adds E as a RANGE per mile** (Table 2 only shows single E value); extends down to VDOT 25 | Secondary published source, verified against Table 2 by David |

## How the images get used

- `TRAINING_PACES_TABLE` in `web/coach/doctrine/pace_zones.ts` will be authored verbatim from these images
- `VDOT_LOOKUP_TABLE` (already in pace_zones.ts) is the race-times subset of Table 1
- Both have/will have snapshot tests in `web/lib/__tests__/reference-tables-snapshot.test.ts`

## Modifying the tables

**Do not edit the table values without first updating the source images here AND re-validating.** If a future revision of Daniels' tables, or a different reference, supersedes these, replace the images + re-transcribe + update the snapshot tests in lockstep. Single cited source, user spot-check, snapshot test.
