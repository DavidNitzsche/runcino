-- Dead-table snapshot 2026-08-28 · workout_completions (10 rows) + coach_actions (2 rows)
-- Taken before owner-approved DROP. Restore: run the CREATE TABLE blocks, then the INSERTs.
-- Schema (from psql \d):
--                              Table "public.workout_completions"
--        Column       |           Type           | Collation | Nullable |       Default       
-- --------------------+--------------------------+-----------+----------+---------------------
--  id                 | uuid                     |           | not null | gen_random_uuid()
--  user_id            | uuid                     |           | not null | 
--  workout_id         | text                     |           | not null | 
--  status             | text                     |           | not null | 
--  started_at         | timestamp with time zone |           | not null | 
--  completed_at       | timestamp with time zone |           | not null | 
--  total_distance_mi  | numeric                  |           |          | 
--  total_duration_sec | integer                  |           | not null | 
--  avg_hr             | integer                  |           |          | 
--  max_hr             | integer                  |           |          | 
--  phases             | jsonb                    |           | not null | 
--  source             | text                     |           | not null | 'apple_watch'::text
--  recorded_at        | timestamp with time zone |           | not null | now()
--  user_uuid          | uuid                     |           |          | 
-- Indexes:
--     "workout_completions_pkey" PRIMARY KEY, btree (id)
--     "idx_workout_completions_user_date" btree (user_id, completed_at DESC)
--     "workout_completions_user_id_workout_id_key" UNIQUE CONSTRAINT, btree (user_id, workout_id)
--     "workout_completions_user_uuid_idx" btree (user_uuid)
-- Foreign-key constraints:
--     "workout_completions_user_id_fkey" FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
--     "workout_completions_user_uuid_fkey" FOREIGN KEY (user_uuid) REFERENCES users(id) ON DELETE CASCADE
-- 
--                                        Table "public.coach_actions"
--    Column    |           Type           | Collation | Nullable |                  Default                  
-- -------------+--------------------------+-----------+----------+-------------------------------------------
--  id          | integer                  |           | not null | nextval('coach_actions_id_seq'::regclass)
--  user_id     | text                     |           | not null | 'me'::text
--  user_uuid   | uuid                     |           |          | 
--  action_type | text                     |           | not null | 
--  mode        | text                     |           | not null | 
--  payload     | jsonb                    |           | not null | 
--  trigger     | text                     |           |          | 
--  rationale   | text                     |           |          | 
--  created_at  | timestamp with time zone |           | not null | now()
-- Indexes:
--     "coach_actions_pkey" PRIMARY KEY, btree (id)
--     "idx_coach_actions_recent" btree (user_uuid, created_at DESC)
-- Check constraints:
--     "coach_actions_mode_check" CHECK (mode = ANY (ARRAY['unilateral'::text, 'propose'::text, 'notify'::text]))
-- Foreign-key constraints:
--     "coach_actions_user_uuid_fkey" FOREIGN KEY (user_uuid) REFERENCES users(id) ON DELETE CASCADE
-- 
-- Data as INSERTs:
INSERT INTO workout_completions VALUES ('(24b2a328-2e95-4e9f-b974-f34c43aa123a,0645f40c-951d-4ccc-b86e-9979cd26c795,just-run-FE13484E-119B-4FCC-8CBE-B3CC817F3847,abandoned,"2026-05-23 23:46:14+00","2026-05-23 23:46:33+00",0.02,18,69,69,"[{""type"": ""work"", ""avgHr"": 69, ""index"": 0, ""label"": ""Just run"", ""completed"": false, ""actualPaceSPerMi"": 555, ""actualDurationSec"": 19}]",apple_watch,"2026-05-24 00:01:58.917852+00",0645f40c-951d-4ccc-b86e-9979cd26c795,4)');
INSERT INTO workout_completions VALUES ('(8ad28ed4-c790-4b86-aa90-b32c24d7cc74,0645f40c-951d-4ccc-b86e-9979cd26c795,just-run-9F091D77-232C-4751-A33C-0ED430051AFB,abandoned,"2026-05-23 22:38:17+00","2026-05-23 22:38:30+00",,13,69,70,"[{""type"": ""work"", ""avgHr"": 67, ""index"": 0, ""label"": ""Just run"", ""completed"": false, ""actualDurationSec"": 13}]",apple_watch,"2026-05-23 23:13:16.036121+00",0645f40c-951d-4ccc-b86e-9979cd26c795,3)');
INSERT INTO workout_completions VALUES ('(e8f78359-8118-4dd5-aef8-a55c0f3cfbcb,0645f40c-951d-4ccc-b86e-9979cd26c795,2026-05-25-easy,completed,"2026-05-25 17:29:28+00","2026-05-25 18:23:58+00",6.16,3269,133,153,"[{""type"": ""work"", ""avgHr"": 137, ""index"": 0, ""label"": ""Easy"", ""completed"": true, ""actualPaceSPerMi"": 533, ""targetPaceSPerMi"": 533, ""actualDurationSec"": 3178}]",apple_watch,"2026-05-25 18:27:08.356482+00",0645f40c-951d-4ccc-b86e-9979cd26c795,10)');
INSERT INTO workout_completions VALUES ('(e78ab063-744d-4a86-bed4-8da7a7b57f96,0645f40c-951d-4ccc-b86e-9979cd26c795,just-run-A80B5431-1A28-4E02-8DFE-06339E97DD35,abandoned,"2026-05-24 21:17:41+00","2026-05-24 21:17:53+00",,11,59,59,"[{""type"": ""work"", ""avgHr"": 59, ""index"": 0, ""label"": ""Just run"", ""completed"": false, ""actualDurationSec"": 11}]",apple_watch,"2026-05-24 21:25:30.011055+00",0645f40c-951d-4ccc-b86e-9979cd26c795,9)');
INSERT INTO workout_completions VALUES ('(50aff1da-2b53-42ec-a9a6-21e8f57f54ab,0645f40c-951d-4ccc-b86e-9979cd26c795,just-run-1CC0CBE8-F3D7-4401-BCCE-D11739E95016,abandoned,"2026-05-24 20:58:40+00","2026-05-24 20:58:45+00",,4,,,"[{""type"": ""work"", ""index"": 0, ""label"": ""Just run"", ""completed"": false, ""actualDurationSec"": 4}]",apple_watch,"2026-05-24 21:13:11.459679+00",0645f40c-951d-4ccc-b86e-9979cd26c795,7)');
INSERT INTO workout_completions VALUES ('(b3837ed6-6ffa-4881-80ec-c94acee68afd,0645f40c-951d-4ccc-b86e-9979cd26c795,2026-05-21-easy,completed,"2026-05-22 05:09:08.716+00","2026-05-22 06:12:49.716+00",7.17,3821,139,,"[{""type"": ""work"", ""index"": 0, ""label"": ""Run"", ""completed"": true, ""actualPaceSPerMi"": 533, ""actualDurationSec"": 3821}]",manual_import,"2026-05-22 06:12:49.810347+00",0645f40c-951d-4ccc-b86e-9979cd26c795,1)');
INSERT INTO workout_completions VALUES ('(ba5068d7-2506-46cc-a885-bf42fd08d7b3,0645f40c-951d-4ccc-b86e-9979cd26c795,sample-threshold,abandoned,"2026-05-24 04:14:53+00","2026-05-24 04:16:12+00",0.33,78,164,170,"[{""type"": ""warmup"", ""avgHr"": 168, ""index"": 0, ""label"": ""Warmup"", ""completed"": false, ""actualPaceSPerMi"": 373, ""actualDurationSec"": 78}]",apple_watch,"2026-05-24 04:16:12.299058+00",0645f40c-951d-4ccc-b86e-9979cd26c795,5)');
INSERT INTO workout_completions VALUES ('(eaed13eb-e433-444c-89b6-b21b34faeb0a,0645f40c-951d-4ccc-b86e-9979cd26c795,2026-05-22-easy,abandoned,"2026-05-23 03:52:32+00","2026-05-23 03:53:07+00",,34,66,67,"[{""type"": ""work"", ""avgHr"": 67, ""index"": 0, ""label"": ""Easy"", ""completed"": false, ""targetPaceSPerMi"": 524, ""actualDurationSec"": 34}]",apple_watch,"2026-05-23 03:53:15.702699+00",0645f40c-951d-4ccc-b86e-9979cd26c795,2)');
INSERT INTO workout_completions VALUES ('(cac74e97-7d58-4609-9e4c-5494e6fe0781,0645f40c-951d-4ccc-b86e-9979cd26c795,2026-05-24-long,abandoned,"2026-05-24 15:21:17+00","2026-05-24 15:21:27+00",,10,63,64,"[{""type"": ""work"", ""avgHr"": 61, ""index"": 0, ""label"": ""Long"", ""completed"": false, ""targetPaceSPerMi"": 533, ""actualDurationSec"": 10}]",apple_watch,"2026-05-24 15:24:10.813128+00",0645f40c-951d-4ccc-b86e-9979cd26c795,6)');
INSERT INTO workout_completions VALUES ('(303d17de-632b-4a6f-8e15-6fba804aa319,0645f40c-951d-4ccc-b86e-9979cd26c795,just-run-DB6F4C43-97D0-48CD-86D8-75F8495BA683,abandoned,"2026-05-24 21:17:23+00","2026-05-24 21:17:34+00",,10,62,64,"[{""type"": ""work"", ""avgHr"": 59, ""index"": 0, ""label"": ""Just run"", ""completed"": false, ""actualDurationSec"": 11}]",apple_watch,"2026-05-24 21:25:29.353871+00",0645f40c-951d-4ccc-b86e-9979cd26c795,8)');
INSERT INTO coach_actions VALUES (1,me,0645f40c-951d-4ccc-b86e-9979cd26c795,propose_goal_adjustment,propose,"{""current"": {""goalFinishS"": 5400, ""goalPaceSPerMi"": 412}, ""headline"": ""Soften the goal by 9 minutes?"", ""proposed"": {""finishS"": 5936, ""direction"": ""slower"", ""paceSPerMi"": 453}, ""raceDate"": ""2026-08-16"", ""raceName"": ""Americas Finest City"", ""raceSlug"": ""americas-finest-city"", ""reasoning"": ""Recent fitness reads place you at 1:38:56 (7:33/mi) — 41 sec/mi off your goal of 1:30:00 (6:52/mi) sustained for 21 days. Want to soften the target to a realistic finish, or hold and push hard in the remaining build?"", ""windowDays"": 21, ""sustainedDeltaSPerMi"": -40.95228618306305}",fitness_shift,"Fitness behind goal by 41 sec/mi for 21 days.","2026-05-24 15:50:58.801336+00");
INSERT INTO coach_actions VALUES (2,me,0645f40c-951d-4ccc-b86e-9979cd26c795,propose_goal_adjustment,propose,"{""current"": {""goalFinishS"": 5400, ""goalPaceSPerMi"": 412}, ""headline"": ""Soften the goal by 9 minutes?"", ""proposed"": {""finishS"": 5936, ""direction"": ""slower"", ""paceSPerMi"": 453}, ""raceDate"": ""2026-08-16"", ""raceName"": ""Americas Finest City"", ""raceSlug"": ""americas-finest-city"", ""reasoning"": ""Recent fitness reads place you at 1:38:56 (7:33/mi) — 41 sec/mi off your goal of 1:30:00 (6:52/mi) sustained for 21 days. Want to soften the target to a realistic finish, or hold and push hard in the remaining build?"", ""windowDays"": 21, ""sustainedDeltaSPerMi"": -40.95228618306305}",fitness_shift,"Fitness behind goal by 41 sec/mi for 21 days.","2026-05-25 04:27:24.897025+00");
