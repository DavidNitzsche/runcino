-- SPLITS REPAIR · generated 2026-08-31 by
-- lib/runs/_splits_repair_sql.audit.test.ts, from the real chooseSplits.
--
-- 14 row(s) · 30 split-mile(s) recovered.
-- Read 267 rows (153 canonical). NOT EXECUTED.
--
-- Each statement is GUARDED on the row's current split count, so it is
-- idempotent (a second run matches nothing) and safe against a concurrent
-- writer (a row that changed underneath is skipped, not clobbered).
-- Rule 6: jsonb_set on the single key, never SET data = ...
--
-- DATA WRITES ARE THE OWNER'S CALL. Run the dry run first.

-- ── DRY RUN ──────────────────────────────────────────

-- DRY RUN · rows this batch would touch, before running anything.
SELECT count(*) FROM runs WHERE id IN (
  -2045716995500221, -243713397221312, -182722411215424, -45100417674801, -180849195850364, -27464959454570, -208859539241829, -254892999381071, -280562721594452, -244830194868527, -177132011318458, -106657799059002, -161412146640788, -220066891328078
) AND user_uuid = '0645f40c-951d-4ccc-b86e-9979cd26c795'::uuid AND NOT (data ? 'mergedIntoId');

-- ── FORWARD ──────────────────────────────────────────

-- 2026-05-24 · apple_watch · 0 -> 12 splits · +[1,2,3,4,5,6,7,8,9,10,11,12] from null
UPDATE runs SET data = jsonb_set(data, '{splits}', '[{"mile":1,"pace":"8:41","paceSecPerMi":521,"hr":140,"elev_ft":-7},{"mile":2,"pace":"8:37","paceSecPerMi":517,"hr":140,"elev_ft":-30},{"mile":3,"pace":"8:49","paceSecPerMi":529,"hr":140,"elev_ft":5},{"mile":4,"pace":"8:44","paceSecPerMi":524,"hr":143,"elev_ft":11},{"mile":5,"pace":"8:50","paceSecPerMi":530,"hr":141,"elev_ft":14},{"mile":6,"pace":"8:56","paceSecPerMi":536,"hr":139,"elev_ft":1},{"mile":7,"pace":"8:46","paceSecPerMi":526,"hr":139,"elev_ft":-37},{"mile":8,"pace":"8:48","paceSecPerMi":528,"hr":142,"elev_ft":15},{"mile":9,"pace":"8:58","paceSecPerMi":538,"hr":142,"elev_ft":5},{"mile":10,"pace":"9:44","paceSecPerMi":584,"hr":139,"elev_ft":16},{"mile":11,"pace":"10:20","paceSecPerMi":620,"hr":139,"elev_ft":0},{"mile":12,"pace":"9:42","paceSecPerMi":582,"hr":146,"elev_ft":-9}]'::jsonb)
 WHERE id = -2045716995500221::BIGINT
   AND user_uuid = '0645f40c-951d-4ccc-b86e-9979cd26c795'::uuid
   AND NOT (data ? 'mergedIntoId')
   AND COALESCE(jsonb_array_length(data->'splits'), 0) = 0;

-- 2026-06-08 · watch · 5 -> 7 splits · +[6,7] from apple_watch
UPDATE runs SET data = jsonb_set(data, '{splits}', '[{"hr":135,"mile":1,"pace":"8:27","paceSecPerMi":507},{"hr":146,"mile":2,"pace":"8:08","paceSecPerMi":488},{"hr":149,"mile":3,"pace":"8:18","paceSecPerMi":498},{"hr":154,"mile":4,"pace":"8:14","paceSecPerMi":494},{"hr":152,"mile":5,"pace":"8:21","paceSecPerMi":501},{"mile":6,"pace":"7:53","paceSecPerMi":473,"hr":150,"distanceMi":1,"elev_ft":12,"cadence":143},{"mile":7,"pace":"8:05","paceSecPerMi":485,"hr":158,"distanceMi":0.1670103092783505,"elev_ft":0,"cadence":151}]'::jsonb)
 WHERE id = -243713397221312::BIGINT
   AND user_uuid = '0645f40c-951d-4ccc-b86e-9979cd26c795'::uuid
   AND NOT (data ? 'mergedIntoId')
   AND COALESCE(jsonb_array_length(data->'splits'), 0) = 5;

-- 2026-06-09 · watch · 7 -> 9 splits · +[8,9] from strava
UPDATE runs SET data = jsonb_set(data, '{splits}', '[{"hr":131,"mile":1,"pace":"8:33","paceSecPerMi":513},{"hr":141,"mile":2,"pace":"8:17","paceSecPerMi":497},{"hr":153,"mile":3,"pace":"7:21","paceSecPerMi":441},{"hr":161,"mile":4,"pace":"7:12","paceSecPerMi":432},{"hr":162,"mile":5,"pace":"7:20","paceSecPerMi":440},{"hr":163,"mile":6,"pace":"7:20","paceSecPerMi":440},{"hr":149,"mile":7,"pace":"9:21","paceSecPerMi":561},{"mile":8,"pace":"8:44","paceSecPerMi":524,"distanceMi":1.0048814920862166,"elev_ft":5},{"mile":9,"pace":"8:48","paceSecPerMi":528,"distanceMi":0.011371092817943212,"elev_ft":0}]'::jsonb)
 WHERE id = -182722411215424::BIGINT
   AND user_uuid = '0645f40c-951d-4ccc-b86e-9979cd26c795'::uuid
   AND NOT (data ? 'mergedIntoId')
   AND COALESCE(jsonb_array_length(data->'splits'), 0) = 7;

-- 2026-07-12 · watch · 12 -> 13 splits · +[13] from strava
UPDATE runs SET data = jsonb_set(data, '{splits}', '[{"hr":138,"mile":1,"pace":"8:19","paceSecPerMi":499},{"hr":155,"mile":2,"pace":"8:02","paceSecPerMi":482},{"hr":159,"mile":3,"pace":"8:09","paceSecPerMi":489},{"hr":161,"mile":4,"pace":"8:13","paceSecPerMi":493},{"hr":164,"mile":5,"pace":"8:20","paceSecPerMi":500},{"hr":163,"mile":6,"pace":"8:30","paceSecPerMi":510},{"hr":160,"mile":7,"pace":"8:43","paceSecPerMi":523},{"hr":164,"mile":8,"pace":"8:33","paceSecPerMi":513},{"hr":161,"mile":9,"pace":"8:43","paceSecPerMi":523},{"hr":164,"mile":10,"pace":"7:46","paceSecPerMi":466},{"hr":164,"mile":11,"pace":"8:00","paceSecPerMi":480},{"hr":166,"mile":12,"pace":"8:09","paceSecPerMi":489},{"mile":13,"pace":"8:41","paceSecPerMi":521,"distanceMi":0.5905511811023622,"elev_ft":4}]'::jsonb)
 WHERE id = -45100417674801::BIGINT
   AND user_uuid = '0645f40c-951d-4ccc-b86e-9979cd26c795'::uuid
   AND NOT (data ? 'mergedIntoId')
   AND COALESCE(jsonb_array_length(data->'splits'), 0) = 12;

-- 2026-07-13 · watch · 9 -> 10 splits · +[10] from apple_watch
UPDATE runs SET data = jsonb_set(data, '{splits}', '[{"hr":124,"mile":1,"pace":"8:47","paceSecPerMi":527},{"hr":133,"mile":2,"pace":"8:43","paceSecPerMi":523},{"hr":140,"mile":3,"pace":"8:30","paceSecPerMi":510},{"hr":142,"mile":4,"pace":"8:37","paceSecPerMi":517},{"hr":144,"mile":5,"pace":"8:52","paceSecPerMi":532},{"hr":145,"mile":6,"pace":"8:51","paceSecPerMi":531},{"hr":142,"mile":7,"pace":"9:05","paceSecPerMi":545},{"hr":142,"mile":8,"pace":"9:09","paceSecPerMi":549},{"hr":144,"mile":9,"pace":"8:51","paceSecPerMi":531},{"mile":10,"pace":"8:42","paceSecPerMi":522,"hr":153,"distanceMi":0.20114942528735633,"elev_ft":0,"cadence":157}]'::jsonb)
 WHERE id = -180849195850364::BIGINT
   AND user_uuid = '0645f40c-951d-4ccc-b86e-9979cd26c795'::uuid
   AND NOT (data ? 'mergedIntoId')
   AND COALESCE(jsonb_array_length(data->'splits'), 0) = 9;

-- 2026-07-20 · watch · 9 -> 10 splits · +[10] from strava
UPDATE runs SET data = jsonb_set(data, '{splits}', '[{"hr":131,"mile":1,"pace":"8:23","paceSecPerMi":503},{"hr":148,"mile":2,"pace":"8:00","paceSecPerMi":480},{"hr":147,"mile":3,"pace":"8:15","paceSecPerMi":495},{"hr":155,"mile":4,"pace":"8:10","paceSecPerMi":490},{"hr":150,"mile":5,"pace":"8:59","paceSecPerMi":539},{"hr":162,"mile":6,"pace":"8:23","paceSecPerMi":503},{"hr":162,"mile":7,"pace":"8:23","paceSecPerMi":503},{"hr":159,"mile":8,"pace":"9:02","paceSecPerMi":542},{"hr":162,"mile":9,"pace":"8:30","paceSecPerMi":510},{"mile":10,"pace":"9:35","paceSecPerMi":575,"distanceMi":0.6851860136801082,"elev_ft":4}]'::jsonb)
 WHERE id = -27464959454570::BIGINT
   AND user_uuid = '0645f40c-951d-4ccc-b86e-9979cd26c795'::uuid
   AND NOT (data ? 'mergedIntoId')
   AND COALESCE(jsonb_array_length(data->'splits'), 0) = 9;

-- 2026-07-21 · watch · 7 -> 8 splits · +[8] from strava
UPDATE runs SET data = jsonb_set(data, '{splits}', '[{"hr":125,"mile":1,"pace":"8:41","paceSecPerMi":521},{"hr":142,"mile":2,"pace":"8:11","paceSecPerMi":491},{"hr":159,"mile":3,"pace":"7:18","paceSecPerMi":438},{"hr":156,"mile":4,"pace":"7:30","paceSecPerMi":450},{"hr":160,"mile":5,"pace":"7:43","paceSecPerMi":463},{"hr":160,"mile":6,"pace":"7:33","paceSecPerMi":453},{"hr":149,"mile":7,"pace":"8:55","paceSecPerMi":535},{"mile":8,"pace":"8:21","paceSecPerMi":501,"distanceMi":0.5167322834645669,"elev_ft":4}]'::jsonb)
 WHERE id = -208859539241829::BIGINT
   AND user_uuid = '0645f40c-951d-4ccc-b86e-9979cd26c795'::uuid
   AND NOT (data ? 'mergedIntoId')
   AND COALESCE(jsonb_array_length(data->'splits'), 0) = 7;

-- 2026-07-25 · watch · 17 -> 18 splits · +[18] from strava
UPDATE runs SET data = jsonb_set(data, '{splits}', '[{"hr":134,"mile":1,"pace":"8:22","paceSecPerMi":502},{"hr":146,"mile":2,"pace":"8:09","paceSecPerMi":489},{"hr":149,"mile":3,"pace":"8:08","paceSecPerMi":488},{"hr":147,"mile":4,"pace":"8:09","paceSecPerMi":489},{"hr":149,"mile":5,"pace":"8:22","paceSecPerMi":502},{"hr":152,"mile":6,"pace":"8:06","paceSecPerMi":486},{"hr":153,"mile":7,"pace":"8:16","paceSecPerMi":496},{"hr":156,"mile":8,"pace":"8:08","paceSecPerMi":488},{"hr":158,"mile":9,"pace":"7:59","paceSecPerMi":479},{"hr":164,"mile":10,"pace":"7:28","paceSecPerMi":448},{"hr":165,"mile":11,"pace":"7:30","paceSecPerMi":450},{"hr":154,"mile":12,"pace":"7:40","paceSecPerMi":460},{"hr":158,"mile":13,"pace":"7:56","paceSecPerMi":476},{"hr":166,"mile":14,"pace":"7:46","paceSecPerMi":466},{"hr":162,"mile":15,"pace":"8:00","paceSecPerMi":480},{"hr":161,"mile":16,"pace":"8:19","paceSecPerMi":499},{"hr":162,"mile":17,"pace":"7:58","paceSecPerMi":478},{"mile":18,"pace":"8:05","paceSecPerMi":485,"distanceMi":0.9950638272488667,"elev_ft":7}]'::jsonb)
 WHERE id = -254892999381071::BIGINT
   AND user_uuid = '0645f40c-951d-4ccc-b86e-9979cd26c795'::uuid
   AND NOT (data ? 'mergedIntoId')
   AND COALESCE(jsonb_array_length(data->'splits'), 0) = 17;

-- 2026-08-03 · watch · 5 -> 6 splits · +[6] from strava
UPDATE runs SET data = jsonb_set(data, '{splits}', '[{"hr":141,"mile":1,"pace":"7:46","paceSecPerMi":466},{"hr":159,"mile":2,"pace":"7:30","paceSecPerMi":450},{"hr":166,"mile":3,"pace":"7:20","paceSecPerMi":440},{"hr":165,"mile":4,"pace":"7:14","paceSecPerMi":434},{"hr":168,"mile":5,"pace":"7:36","paceSecPerMi":456},{"mile":6,"pace":"7:53","paceSecPerMi":473,"distanceMi":0.762795275590551,"elev_ft":6}]'::jsonb)
 WHERE id = -280562721594452::BIGINT
   AND user_uuid = '0645f40c-951d-4ccc-b86e-9979cd26c795'::uuid
   AND NOT (data ? 'mergedIntoId')
   AND COALESCE(jsonb_array_length(data->'splits'), 0) = 5;

-- 2026-08-05 · watch · 5 -> 7 splits · +[6,7] from strava
UPDATE runs SET data = jsonb_set(data, '{splits}', '[{"hr":137,"mile":1,"pace":"8:15","paceSecPerMi":495},{"hr":160,"mile":2,"pace":"7:45","paceSecPerMi":465},{"hr":165,"mile":3,"pace":"7:44","paceSecPerMi":464},{"hr":166,"mile":4,"pace":"8:13","paceSecPerMi":493},{"hr":167,"mile":5,"pace":"8:16","paceSecPerMi":496},{"mile":6,"pace":"9:15","paceSecPerMi":555,"distanceMi":1.0029552413902807,"elev_ft":5},{"mile":7,"pace":"9:35","paceSecPerMi":575,"distanceMi":0.015658554044380817,"elev_ft":0}]'::jsonb)
 WHERE id = -244830194868527::BIGINT
   AND user_uuid = '0645f40c-951d-4ccc-b86e-9979cd26c795'::uuid
   AND NOT (data ? 'mergedIntoId')
   AND COALESCE(jsonb_array_length(data->'splits'), 0) = 5;

-- 2026-08-10 · watch · 3 -> 5 splits · +[4,5] from apple_watch
UPDATE runs SET data = jsonb_set(data, '{splits}', '[{"hr":133,"mile":1,"pace":"7:51","paceSecPerMi":471},{"hr":154,"mile":2,"pace":"7:24","paceSecPerMi":444},{"hr":159,"mile":3,"pace":"7:02","paceSecPerMi":422},{"mile":4,"pace":"6:40","paceSecPerMi":400,"hr":161,"distanceMi":1,"elev_ft":2,"cadence":151},{"mile":5,"pace":"7:10","paceSecPerMi":430,"hr":171,"distanceMi":0.11162790697674418,"elev_ft":0,"cadence":150}]'::jsonb)
 WHERE id = -177132011318458::BIGINT
   AND user_uuid = '0645f40c-951d-4ccc-b86e-9979cd26c795'::uuid
   AND NOT (data ? 'mergedIntoId')
   AND COALESCE(jsonb_array_length(data->'splits'), 0) = 3;

-- 2026-08-11 · watch · 5 -> 6 splits · +[6] from strava
UPDATE runs SET data = jsonb_set(data, '{splits}', '[{"hr":132,"mile":1,"pace":"8:01","paceSecPerMi":481},{"hr":150,"mile":2,"pace":"7:05","paceSecPerMi":425},{"hr":161,"mile":3,"pace":"7:34","paceSecPerMi":454},{"hr":162,"mile":4,"pace":"7:42","paceSecPerMi":462},{"hr":159,"mile":5,"pace":"7:59","paceSecPerMi":479},{"mile":6,"pace":"7:23","paceSecPerMi":443,"distanceMi":0.9626903881333014,"elev_ft":5}]'::jsonb)
 WHERE id = -106657799059002::BIGINT
   AND user_uuid = '0645f40c-951d-4ccc-b86e-9979cd26c795'::uuid
   AND NOT (data ? 'mergedIntoId')
   AND COALESCE(jsonb_array_length(data->'splits'), 0) = 5;

-- 2026-08-16 · watch · 13 -> 14 splits · +[14] from apple_watch
UPDATE runs SET data = jsonb_set(data, '{splits}', '[{"hr":158,"mile":1,"pace":"7:09","paceSecPerMi":429},{"hr":167,"mile":2,"pace":"7:24","paceSecPerMi":444},{"hr":168,"mile":3,"pace":"6:56","paceSecPerMi":416},{"hr":166,"mile":4,"pace":"6:45","paceSecPerMi":405},{"hr":168,"mile":5,"pace":"7:33","paceSecPerMi":453},{"hr":169,"mile":6,"pace":"7:32","paceSecPerMi":452},{"hr":169,"mile":7,"pace":"7:54","paceSecPerMi":474},{"hr":167,"mile":8,"pace":"8:24","paceSecPerMi":504},{"hr":171,"mile":9,"pace":"7:47","paceSecPerMi":467},{"hr":168,"mile":10,"pace":"8:16","paceSecPerMi":496},{"hr":172,"mile":11,"pace":"7:50","paceSecPerMi":470},{"hr":170,"mile":12,"pace":"9:22","paceSecPerMi":562},{"hr":173,"mile":13,"pace":"8:16","paceSecPerMi":496},{"mile":14,"pace":"7:48","paceSecPerMi":468,"hr":177,"distanceMi":0.14316239316239315,"elev_ft":0,"cadence":157}]'::jsonb)
 WHERE id = -161412146640788::BIGINT
   AND user_uuid = '0645f40c-951d-4ccc-b86e-9979cd26c795'::uuid
   AND NOT (data ? 'mergedIntoId')
   AND COALESCE(jsonb_array_length(data->'splits'), 0) = 13;

-- 2026-08-24 · watch · 3 -> 5 splits · +[4,5] from apple_watch
UPDATE runs SET data = jsonb_set(data, '{splits}', '[{"hr":128,"mile":1,"pace":"8:28","paceSecPerMi":508},{"hr":140,"mile":2,"pace":"8:23","paceSecPerMi":503},{"hr":139,"mile":3,"pace":"8:42","paceSecPerMi":522},{"mile":4,"pace":"8:22","paceSecPerMi":502,"hr":144,"distanceMi":1,"elev_ft":0,"cadence":147},{"mile":5,"pace":"8:23","paceSecPerMi":503,"hr":158,"distanceMi":0.11133200795228629,"elev_ft":0,"cadence":148}]'::jsonb)
 WHERE id = -220066891328078::BIGINT
   AND user_uuid = '0645f40c-951d-4ccc-b86e-9979cd26c795'::uuid
   AND NOT (data ? 'mergedIntoId')
   AND COALESCE(jsonb_array_length(data->'splits'), 0) = 3;

-- ── INVERSE ──────────────────────────────────────────

-- inverse · 2026-05-24 · restores the 0 elements this row held
UPDATE runs SET data = jsonb_set(data, '{splits}', '[]'::jsonb)
 WHERE id = -2045716995500221::BIGINT
   AND user_uuid = '0645f40c-951d-4ccc-b86e-9979cd26c795'::uuid
   AND COALESCE(jsonb_array_length(data->'splits'), 0) = 12;

-- inverse · 2026-06-08 · restores the 5 elements this row held
UPDATE runs SET data = jsonb_set(data, '{splits}', '[{"hr":135,"mile":1,"pace":"8:27","paceSecPerMi":507},{"hr":146,"mile":2,"pace":"8:08","paceSecPerMi":488},{"hr":149,"mile":3,"pace":"8:18","paceSecPerMi":498},{"hr":154,"mile":4,"pace":"8:14","paceSecPerMi":494},{"hr":152,"mile":5,"pace":"8:21","paceSecPerMi":501}]'::jsonb)
 WHERE id = -243713397221312::BIGINT
   AND user_uuid = '0645f40c-951d-4ccc-b86e-9979cd26c795'::uuid
   AND COALESCE(jsonb_array_length(data->'splits'), 0) = 7;

-- inverse · 2026-06-09 · restores the 7 elements this row held
UPDATE runs SET data = jsonb_set(data, '{splits}', '[{"hr":131,"mile":1,"pace":"8:33","paceSecPerMi":513},{"hr":141,"mile":2,"pace":"8:17","paceSecPerMi":497},{"hr":153,"mile":3,"pace":"7:21","paceSecPerMi":441},{"hr":161,"mile":4,"pace":"7:12","paceSecPerMi":432},{"hr":162,"mile":5,"pace":"7:20","paceSecPerMi":440},{"hr":163,"mile":6,"pace":"7:20","paceSecPerMi":440},{"hr":149,"mile":7,"pace":"9:21","paceSecPerMi":561}]'::jsonb)
 WHERE id = -182722411215424::BIGINT
   AND user_uuid = '0645f40c-951d-4ccc-b86e-9979cd26c795'::uuid
   AND COALESCE(jsonb_array_length(data->'splits'), 0) = 9;

-- inverse · 2026-07-12 · restores the 12 elements this row held
UPDATE runs SET data = jsonb_set(data, '{splits}', '[{"hr":138,"mile":1,"pace":"8:19","paceSecPerMi":499},{"hr":155,"mile":2,"pace":"8:02","paceSecPerMi":482},{"hr":159,"mile":3,"pace":"8:09","paceSecPerMi":489},{"hr":161,"mile":4,"pace":"8:13","paceSecPerMi":493},{"hr":164,"mile":5,"pace":"8:20","paceSecPerMi":500},{"hr":163,"mile":6,"pace":"8:30","paceSecPerMi":510},{"hr":160,"mile":7,"pace":"8:43","paceSecPerMi":523},{"hr":164,"mile":8,"pace":"8:33","paceSecPerMi":513},{"hr":161,"mile":9,"pace":"8:43","paceSecPerMi":523},{"hr":164,"mile":10,"pace":"7:46","paceSecPerMi":466},{"hr":164,"mile":11,"pace":"8:00","paceSecPerMi":480},{"hr":166,"mile":12,"pace":"8:09","paceSecPerMi":489}]'::jsonb)
 WHERE id = -45100417674801::BIGINT
   AND user_uuid = '0645f40c-951d-4ccc-b86e-9979cd26c795'::uuid
   AND COALESCE(jsonb_array_length(data->'splits'), 0) = 13;

-- inverse · 2026-07-13 · restores the 9 elements this row held
UPDATE runs SET data = jsonb_set(data, '{splits}', '[{"hr":124,"mile":1,"pace":"8:47","paceSecPerMi":527},{"hr":133,"mile":2,"pace":"8:43","paceSecPerMi":523},{"hr":140,"mile":3,"pace":"8:30","paceSecPerMi":510},{"hr":142,"mile":4,"pace":"8:37","paceSecPerMi":517},{"hr":144,"mile":5,"pace":"8:52","paceSecPerMi":532},{"hr":145,"mile":6,"pace":"8:51","paceSecPerMi":531},{"hr":142,"mile":7,"pace":"9:05","paceSecPerMi":545},{"hr":142,"mile":8,"pace":"9:09","paceSecPerMi":549},{"hr":144,"mile":9,"pace":"8:51","paceSecPerMi":531}]'::jsonb)
 WHERE id = -180849195850364::BIGINT
   AND user_uuid = '0645f40c-951d-4ccc-b86e-9979cd26c795'::uuid
   AND COALESCE(jsonb_array_length(data->'splits'), 0) = 10;

-- inverse · 2026-07-20 · restores the 9 elements this row held
UPDATE runs SET data = jsonb_set(data, '{splits}', '[{"hr":131,"mile":1,"pace":"8:23","paceSecPerMi":503},{"hr":148,"mile":2,"pace":"8:00","paceSecPerMi":480},{"hr":147,"mile":3,"pace":"8:15","paceSecPerMi":495},{"hr":155,"mile":4,"pace":"8:10","paceSecPerMi":490},{"hr":150,"mile":5,"pace":"8:59","paceSecPerMi":539},{"hr":162,"mile":6,"pace":"8:23","paceSecPerMi":503},{"hr":162,"mile":7,"pace":"8:23","paceSecPerMi":503},{"hr":159,"mile":8,"pace":"9:02","paceSecPerMi":542},{"hr":162,"mile":9,"pace":"8:30","paceSecPerMi":510}]'::jsonb)
 WHERE id = -27464959454570::BIGINT
   AND user_uuid = '0645f40c-951d-4ccc-b86e-9979cd26c795'::uuid
   AND COALESCE(jsonb_array_length(data->'splits'), 0) = 10;

-- inverse · 2026-07-21 · restores the 7 elements this row held
UPDATE runs SET data = jsonb_set(data, '{splits}', '[{"hr":125,"mile":1,"pace":"8:41","paceSecPerMi":521},{"hr":142,"mile":2,"pace":"8:11","paceSecPerMi":491},{"hr":159,"mile":3,"pace":"7:18","paceSecPerMi":438},{"hr":156,"mile":4,"pace":"7:30","paceSecPerMi":450},{"hr":160,"mile":5,"pace":"7:43","paceSecPerMi":463},{"hr":160,"mile":6,"pace":"7:33","paceSecPerMi":453},{"hr":149,"mile":7,"pace":"8:55","paceSecPerMi":535}]'::jsonb)
 WHERE id = -208859539241829::BIGINT
   AND user_uuid = '0645f40c-951d-4ccc-b86e-9979cd26c795'::uuid
   AND COALESCE(jsonb_array_length(data->'splits'), 0) = 8;

-- inverse · 2026-07-25 · restores the 17 elements this row held
UPDATE runs SET data = jsonb_set(data, '{splits}', '[{"hr":134,"mile":1,"pace":"8:22","paceSecPerMi":502},{"hr":146,"mile":2,"pace":"8:09","paceSecPerMi":489},{"hr":149,"mile":3,"pace":"8:08","paceSecPerMi":488},{"hr":147,"mile":4,"pace":"8:09","paceSecPerMi":489},{"hr":149,"mile":5,"pace":"8:22","paceSecPerMi":502},{"hr":152,"mile":6,"pace":"8:06","paceSecPerMi":486},{"hr":153,"mile":7,"pace":"8:16","paceSecPerMi":496},{"hr":156,"mile":8,"pace":"8:08","paceSecPerMi":488},{"hr":158,"mile":9,"pace":"7:59","paceSecPerMi":479},{"hr":164,"mile":10,"pace":"7:28","paceSecPerMi":448},{"hr":165,"mile":11,"pace":"7:30","paceSecPerMi":450},{"hr":154,"mile":12,"pace":"7:40","paceSecPerMi":460},{"hr":158,"mile":13,"pace":"7:56","paceSecPerMi":476},{"hr":166,"mile":14,"pace":"7:46","paceSecPerMi":466},{"hr":162,"mile":15,"pace":"8:00","paceSecPerMi":480},{"hr":161,"mile":16,"pace":"8:19","paceSecPerMi":499},{"hr":162,"mile":17,"pace":"7:58","paceSecPerMi":478}]'::jsonb)
 WHERE id = -254892999381071::BIGINT
   AND user_uuid = '0645f40c-951d-4ccc-b86e-9979cd26c795'::uuid
   AND COALESCE(jsonb_array_length(data->'splits'), 0) = 18;

-- inverse · 2026-08-03 · restores the 5 elements this row held
UPDATE runs SET data = jsonb_set(data, '{splits}', '[{"hr":141,"mile":1,"pace":"7:46","paceSecPerMi":466},{"hr":159,"mile":2,"pace":"7:30","paceSecPerMi":450},{"hr":166,"mile":3,"pace":"7:20","paceSecPerMi":440},{"hr":165,"mile":4,"pace":"7:14","paceSecPerMi":434},{"hr":168,"mile":5,"pace":"7:36","paceSecPerMi":456}]'::jsonb)
 WHERE id = -280562721594452::BIGINT
   AND user_uuid = '0645f40c-951d-4ccc-b86e-9979cd26c795'::uuid
   AND COALESCE(jsonb_array_length(data->'splits'), 0) = 6;

-- inverse · 2026-08-05 · restores the 5 elements this row held
UPDATE runs SET data = jsonb_set(data, '{splits}', '[{"hr":137,"mile":1,"pace":"8:15","paceSecPerMi":495},{"hr":160,"mile":2,"pace":"7:45","paceSecPerMi":465},{"hr":165,"mile":3,"pace":"7:44","paceSecPerMi":464},{"hr":166,"mile":4,"pace":"8:13","paceSecPerMi":493},{"hr":167,"mile":5,"pace":"8:16","paceSecPerMi":496}]'::jsonb)
 WHERE id = -244830194868527::BIGINT
   AND user_uuid = '0645f40c-951d-4ccc-b86e-9979cd26c795'::uuid
   AND COALESCE(jsonb_array_length(data->'splits'), 0) = 7;

-- inverse · 2026-08-10 · restores the 3 elements this row held
UPDATE runs SET data = jsonb_set(data, '{splits}', '[{"hr":133,"mile":1,"pace":"7:51","paceSecPerMi":471},{"hr":154,"mile":2,"pace":"7:24","paceSecPerMi":444},{"hr":159,"mile":3,"pace":"7:02","paceSecPerMi":422}]'::jsonb)
 WHERE id = -177132011318458::BIGINT
   AND user_uuid = '0645f40c-951d-4ccc-b86e-9979cd26c795'::uuid
   AND COALESCE(jsonb_array_length(data->'splits'), 0) = 5;

-- inverse · 2026-08-11 · restores the 5 elements this row held
UPDATE runs SET data = jsonb_set(data, '{splits}', '[{"hr":132,"mile":1,"pace":"8:01","paceSecPerMi":481},{"hr":150,"mile":2,"pace":"7:05","paceSecPerMi":425},{"hr":161,"mile":3,"pace":"7:34","paceSecPerMi":454},{"hr":162,"mile":4,"pace":"7:42","paceSecPerMi":462},{"hr":159,"mile":5,"pace":"7:59","paceSecPerMi":479}]'::jsonb)
 WHERE id = -106657799059002::BIGINT
   AND user_uuid = '0645f40c-951d-4ccc-b86e-9979cd26c795'::uuid
   AND COALESCE(jsonb_array_length(data->'splits'), 0) = 6;

-- inverse · 2026-08-16 · restores the 13 elements this row held
UPDATE runs SET data = jsonb_set(data, '{splits}', '[{"hr":158,"mile":1,"pace":"7:09","paceSecPerMi":429},{"hr":167,"mile":2,"pace":"7:24","paceSecPerMi":444},{"hr":168,"mile":3,"pace":"6:56","paceSecPerMi":416},{"hr":166,"mile":4,"pace":"6:45","paceSecPerMi":405},{"hr":168,"mile":5,"pace":"7:33","paceSecPerMi":453},{"hr":169,"mile":6,"pace":"7:32","paceSecPerMi":452},{"hr":169,"mile":7,"pace":"7:54","paceSecPerMi":474},{"hr":167,"mile":8,"pace":"8:24","paceSecPerMi":504},{"hr":171,"mile":9,"pace":"7:47","paceSecPerMi":467},{"hr":168,"mile":10,"pace":"8:16","paceSecPerMi":496},{"hr":172,"mile":11,"pace":"7:50","paceSecPerMi":470},{"hr":170,"mile":12,"pace":"9:22","paceSecPerMi":562},{"hr":173,"mile":13,"pace":"8:16","paceSecPerMi":496}]'::jsonb)
 WHERE id = -161412146640788::BIGINT
   AND user_uuid = '0645f40c-951d-4ccc-b86e-9979cd26c795'::uuid
   AND COALESCE(jsonb_array_length(data->'splits'), 0) = 14;

-- inverse · 2026-08-24 · restores the 3 elements this row held
UPDATE runs SET data = jsonb_set(data, '{splits}', '[{"hr":128,"mile":1,"pace":"8:28","paceSecPerMi":508},{"hr":140,"mile":2,"pace":"8:23","paceSecPerMi":503},{"hr":139,"mile":3,"pace":"8:42","paceSecPerMi":522}]'::jsonb)
 WHERE id = -220066891328078::BIGINT
   AND user_uuid = '0645f40c-951d-4ccc-b86e-9979cd26c795'::uuid
   AND COALESCE(jsonb_array_length(data->'splits'), 0) = 5;
