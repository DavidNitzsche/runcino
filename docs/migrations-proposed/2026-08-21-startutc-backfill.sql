-- PROPOSED · NOT RUN · requires David's explicit per-statement go.
-- startUtc backfill for the legacy run rows on dnitch85@me.com.
--
-- Generated read-only on 2026-08-21 by
--   web-v2/lib/runs/_startutc-backfill-proposal.audit.test.ts
-- which also proves each day's outcome. Re-run it to regenerate.
--
-- WHAT IT DOES  Sets one new key, data.startUtc, on rows that do not have it.
--               Additive. Touches no existing key, no column, no other user.
--
-- WHY           A run's stored startLocal is a wall clock, and on the legacy
--               rows nothing records which zone it was written in — the same
--               source used both conventions, which is why the per-source
--               Z-strip in 846f3509 had to be reverted (16281282). The engine
--               therefore no longer agrees with the merge flags on seven days,
--               and a re-merge pass over any of them would UNDO the merge and
--               double the day: +49.64 mi measured.
--
-- EFFECT        All 7 disagreeing days settle. NO day's visible mileage
--               changes — verified per day by the generator. On 7 further
--               days the canonical flips back to the Faff watch row (tier 5)
--               from the Apple Health row that had displaced it, which is the
--               doctrine-correct direction and again mileage-neutral.
--
-- REVERSE       UPDATE runs SET data = data - 'startUtc'
--                WHERE user_uuid = '0645f40c-951d-4ccc-b86e-9979cd26c795';
--
-- 2026-05-15 · 2 rows · was PENDING · after backfill: SETTLED · visible mileage 5.01 -> 5.01
--   18520809831 null-source 2026-05-15T12:11:34Z read as Z-as-local-wall-clock · group consensus
--   -254369820 apple_health 2026-05-15T19:11:34Z read as Z-as-true-UTC · group consensus
-- 2026-05-17 · 2 rows · was PENDING · after backfill: SETTLED · visible mileage 11.02 -> 11.02
--   -1521382352 apple_health 2026-05-17T23:23:38Z read as Z-as-true-UTC · group consensus
--   18556937471 null-source 2026-05-17T16:23:38Z read as Z-as-local-wall-clock · group consensus
-- 2026-05-19 · 3 rows · was PENDING · after backfill: SETTLED · visible mileage 2.44 -> 2.44
--   -1344787242 apple_health 2026-05-20T03:49:41Z read as Z-as-true-UTC · agrees with apple_watch -4100288002784906
--   18582271505 null-source 2026-05-19T20:49:41Z read as Z-as-local-wall-clock · agrees with apple_watch -4100288002784906
--   -4100288002784906 apple_watch 2026-05-19T20:49:41 read as bare-wall-clock · agrees with apple_watch -4100288002784906
-- 2026-05-20 · 3 rows · was PENDING · after backfill: SETTLED · visible mileage 5.08 -> 5.08
--   -1346634309 apple_health 2026-05-20T23:53:53Z read as Z-as-true-UTC · agrees with apple_watch -3363396946462586
--   18589376553 null-source 2026-05-20T16:53:53Z read as Z-as-local-wall-clock · agrees with apple_watch -3363396946462586
--   -3363396946462586 apple_watch 2026-05-20T16:53:53 read as bare-wall-clock · agrees with apple_watch -3363396946462586
-- 2026-05-21 · 4 rows · was PENDING · after backfill: SETTLED · visible mileage 7.17 -> 7.17
--   -1109157298233570 apple_watch 2026-05-21T20:31:02 read as bare-wall-clock · agrees with apple_watch -1109157298233570
--   -2060918745 apple_health 2026-05-21T20:31:02Z read as Z-as-local-wall-clock · agrees with apple_watch -1109157298233570
--   -2060888953 apple_health 2026-05-21T21:32:37Z read as Z-as-local-wall-clock · agrees with apple_watch -514138731845836
--   -514138731845836 apple_watch 2026-05-21T21:32:37 read as bare-wall-clock · agrees with apple_watch -514138731845836
-- 2026-05-22 · 4 rows · was PENDING · after backfill: SETTLED · visible mileage 7.78 -> 7.78
--   -1174130142 apple_health 2026-05-22T17:00:31Z read as Z-as-true-UTC · agrees with apple_watch -2818378315677006
--   -1174338679 apple_health 2026-05-22T10:00:31Z read as Z-as-local-wall-clock · agrees with apple_watch -2818378315677006
--   18698496177 strava_webhook 2026-05-22T10:00:31 read as bare-wall-clock · agrees with apple_watch -2818378315677006
--   -2818378315677006 apple_watch 2026-05-22T10:00:31 read as bare-wall-clock · agrees with apple_watch -2818378315677006
-- 2026-05-24 · 4 rows · was PENDING · after backfill: SETTLED · visible mileage 12.12 -> 12.12
--   18638945777 null-source 2026-05-24T09:26:12Z read as Z-as-local-wall-clock · agrees with apple_watch -2045716995500221
--   -2045716995500221 apple_watch 2026-05-24T09:26:12 read as bare-wall-clock · agrees with apple_watch -2045716995500221
-- 2026-05-25 · 2 rows · was settled · after backfill: SETTLED · visible mileage 6.16 -> 6.16
--   -1488380974 watch 2026-05-25T17:29:28.000Z read as Z-as-true-UTC · agrees with apple_watch -4466990534547521
--   -4466990534547521 apple_watch 2026-05-25T10:25:15 read as bare-wall-clock · agrees with apple_watch -4466990534547521
-- 2026-05-26 · 2 rows · was settled · after backfill: SETTLED · visible mileage 7.61 -> 7.61
--   18690124384 strava 2026-05-26T11:22:17 read as bare-wall-clock · agrees with apple_watch -573194905917117
--   -573194905917117 apple_watch 2026-05-26T11:22:17 read as bare-wall-clock · agrees with apple_watch -573194905917117
-- 2026-05-31 · 2 rows · was settled · after backfill: STILL DISAGREES · visible mileage 12.36 -> 12.36
--   -1466010895152803 apple_watch 2026-05-31T08:43:14 read as bare-wall-clock · agrees with apple_watch -1466010895152803
--   -16421550262950 watch 2026-05-31T08:43:14 read as bare-wall-clock · agrees with apple_watch -1466010895152803
-- 2026-06-01 · 2 rows · was settled · after backfill: STILL DISAGREES · visible mileage 5.06 -> 5.06
--   -2987651096082307 apple_watch 2026-06-01T09:25:47 read as bare-wall-clock · agrees with apple_watch -2987651096082307
--   -42985697053171 watch 2026-06-01T09:25:47 read as bare-wall-clock · agrees with apple_watch -2987651096082307
-- 2026-06-02 · 2 rows · was settled · after backfill: STILL DISAGREES · visible mileage 7.41 -> 7.41
--   -3558250452245243 apple_watch 2026-06-02T12:16:14 read as bare-wall-clock · agrees with apple_watch -3558250452245243
--   -71141805277248 watch 2026-06-02T12:16:14 read as bare-wall-clock · agrees with apple_watch -3558250452245243
-- 2026-06-03 · 3 rows · was settled · after backfill: STILL DISAGREES · visible mileage 6.08 -> 6.08
--   18860093709 strava 2026-06-03T09:27:11Z read as Z-as-local-wall-clock · agrees with apple_watch -3858000542489904
--   -3858000542489904 apple_watch 2026-06-03T09:27:11 read as bare-wall-clock · agrees with apple_watch -3858000542489904
--   -99303583875384 watch 2026-06-03T09:27:11 read as bare-wall-clock · agrees with apple_watch -3858000542489904
-- 2026-06-04 · 3 rows · was settled · after backfill: STILL DISAGREES · visible mileage 7.76 -> 7.76
--   -1483290537416636 apple_watch 2026-06-04T09:04:21 read as bare-wall-clock · agrees with apple_watch -1483290537416636
--   18860093710 strava 2026-06-04T09:04:21Z read as Z-as-local-wall-clock · agrees with apple_watch -1483290537416636
--   -271531781519189 watch 2026-06-04T09:04:21 read as bare-wall-clock · agrees with apple_watch -1483290537416636
-- 2026-06-05 · 3 rows · was settled · after backfill: STILL DISAGREES · visible mileage 6.01 -> 6.01
--   -102539783518325 watch 2026-06-05T08:35:33 read as bare-wall-clock · agrees with watch -102539783518325
--   18860093380 strava 2026-06-05T08:35:33Z read as Z-as-local-wall-clock · agrees with watch -102539783518325
--   -2142575830045023 apple_watch 2026-06-05T08:35:33 read as bare-wall-clock · agrees with watch -102539783518325
-- 2026-06-08 · 3 rows · was settled · after backfill: SETTLED · visible mileage 6.01 -> 6.01
--   18859889751 strava 2026-06-08T12:42:18Z read as Z-as-local-wall-clock · agrees with watch -243713397221312
--   -243713397221312 watch 2026-06-08T12:42:18 read as bare-wall-clock · agrees with watch -243713397221312
--   -977449062696924 apple_watch 2026-06-08T12:42:18 read as bare-wall-clock · agrees with watch -243713397221312
-- 2026-06-09 · 3 rows · was settled · after backfill: SETTLED · visible mileage 8.02 -> 8.02
--   -182722411215424 watch 2026-06-09T08:42:08 read as bare-wall-clock · agrees with watch -182722411215424
--   18856408342 strava 2026-06-09T08:42:08Z read as Z-as-local-wall-clock · agrees with watch -182722411215424
--   -227867093947909 apple_watch 2026-06-09T08:42:08 read as bare-wall-clock · agrees with watch -182722411215424
-- 2026-06-10 · 3 rows · was settled · after backfill: SETTLED · visible mileage 6.02 -> 6.02
--   18873645099 strava 2026-06-10T19:41:28Z read as Z-as-local-wall-clock · agrees with watch -70333530507729
--   -70333530507729 watch 2026-06-10T19:41:28 read as bare-wall-clock · agrees with watch -70333530507729
--   -763298079097609 apple_watch 2026-06-10T19:41:28 read as bare-wall-clock · agrees with watch -70333530507729
-- 2026-06-11 · 3 rows · was settled · after backfill: SETTLED · visible mileage 6.90 -> 6.90
--   -140999945150690 apple_watch 2026-06-11T08:25:45 read as bare-wall-clock · agrees with apple_watch -140999945150690
--   18885330230 strava 2026-06-11T08:25:45Z read as Z-as-local-wall-clock · agrees with apple_watch -140999945150690
--   -92768649631212 watch 2026-06-11T08:25:45 read as bare-wall-clock · agrees with apple_watch -140999945150690
-- 2026-06-14 · 3 rows · was settled · after backfill: SETTLED · visible mileage 13.13 -> 13.13
--   18920792777 strava 2026-06-14T08:16:14Z read as Z-as-local-wall-clock · agrees with watch -226447289863060
--   -226447289863060 watch 2026-06-14T08:16:14 read as bare-wall-clock · agrees with watch -226447289863060
--   -4103293651232813 apple_watch 2026-06-14T08:16:10 read as bare-wall-clock · agrees with watch -226447289863060
-- 2026-06-15 · 3 rows · was settled · after backfill: SETTLED · visible mileage 6.01 -> 6.01
--   -1379097925561833 apple_watch 2026-06-15T07:29:02 read as bare-wall-clock · agrees with apple_watch -1379097925561833
--   18933762115 strava 2026-06-15T07:29:02Z read as Z-as-local-wall-clock · agrees with apple_watch -1379097925561833
--   -20211252944965 watch 2026-06-15T07:29:02 read as bare-wall-clock · agrees with apple_watch -1379097925561833
-- 2026-06-16 · 3 rows · was settled · after backfill: SETTLED · visible mileage 7.50 -> 7.50
--   18944794868 strava 2026-06-16T07:18:29Z read as Z-as-local-wall-clock · agrees with watch -27148287813731
--   -27148287813731 watch 2026-06-16T07:18:29 read as bare-wall-clock · agrees with watch -27148287813731
--   -3524810659692108 apple_watch 2026-06-16T07:18:29 read as bare-wall-clock · agrees with watch -27148287813731
-- 2026-06-17 · 3 rows · was settled · after backfill: SETTLED · visible mileage 6.03 -> 6.03
--   -142898519593835 watch 2026-06-17T08:27:10 read as bare-wall-clock · agrees with watch -142898519593835
--   19001756362 strava 2026-06-17T08:27:10Z read as Z-as-local-wall-clock · agrees with watch -142898519593835
--   -689529591569685 apple_watch 2026-06-17T08:27:10 read as bare-wall-clock · agrees with watch -142898519593835
-- 2026-06-18 · 3 rows · was settled · after backfill: SETTLED · visible mileage 8.15 -> 8.15
--   -1290175639974807 apple_watch 2026-06-18T10:07:26 read as bare-wall-clock · agrees with apple_watch -1290175639974807
--   19001763928 strava 2026-06-18T10:07:26Z read as Z-as-local-wall-clock · agrees with apple_watch -1290175639974807
--   -251580989059278 watch 2026-06-18T10:07:26 read as bare-wall-clock · agrees with apple_watch -1290175639974807
-- 2026-06-19 · 3 rows · was settled · after backfill: SETTLED · visible mileage 6.45 -> 6.45
--   19001760320 strava 2026-06-19T15:00:13Z read as Z-as-local-wall-clock · agrees with apple_watch -2879891908180737
--   -2879891908180737 apple_watch 2026-06-19T15:00:13 read as bare-wall-clock · agrees with apple_watch -2879891908180737
--   -75222347127112 watch 2026-06-19T15:00:13 read as bare-wall-clock · agrees with apple_watch -2879891908180737
-- 2026-06-21 · 3 rows · was settled · after backfill: SETTLED · visible mileage 13.15 -> 13.15
--   -127657343028184 watch 2026-06-21T07:14:46 read as bare-wall-clock · agrees with watch -127657343028184
--   19012672608 strava 2026-06-21T07:14:46Z read as Z-as-local-wall-clock · agrees with watch -127657343028184
--   -386311530097203 apple_watch 2026-06-21T07:14:46 read as bare-wall-clock · agrees with watch -127657343028184
-- 2026-06-23 · 3 rows · was settled · after backfill: SETTLED · visible mileage 8.12 -> 8.12
--   -1311970832226386 apple_watch 2026-06-23T08:27:42 read as bare-wall-clock · agrees with apple_watch -1311970832226386
--   19041329503 strava 2026-06-23T08:27:42Z read as Z-as-local-wall-clock · agrees with apple_watch -1311970832226386
--   -2351254210708 watch 2026-06-23T08:27:42 read as bare-wall-clock · agrees with apple_watch -1311970832226386
-- 2026-06-25 · 3 rows · was settled · after backfill: SETTLED · visible mileage 5.83 -> 5.83
--   19064854929 strava 2026-06-25T09:27:34Z read as Z-as-local-wall-clock · agrees with watch -28841066621288
--   -28841066621288 watch 2026-06-25T09:27:34 read as bare-wall-clock · agrees with watch -28841066621288
--   -3813725101122266 apple_watch 2026-06-25T09:27:34 read as bare-wall-clock · agrees with watch -28841066621288
-- 2026-06-27 · 3 rows · was settled · after backfill: SETTLED · visible mileage 14.02 -> 14.02
--   -132305279286285 watch 2026-06-27T06:56:17 read as bare-wall-clock · agrees with watch -132305279286285
--   19090200932 strava 2026-06-27T06:56:17Z read as Z-as-local-wall-clock · agrees with watch -132305279286285
--   -4086538471561527 apple_watch 2026-06-27T06:56:14 read as bare-wall-clock · agrees with watch -132305279286285
-- 2026-07-06 · 3 rows · was settled · after backfill: SETTLED · visible mileage 6.01 -> 6.01
--   -191288470618193 watch 2026-07-06T07:25:58 read as bare-wall-clock · agrees with watch -191288470618193
--   19207587294 strava 2026-07-06T07:25:58Z read as Z-as-local-wall-clock · agrees with watch -191288470618193
--   -2431764854705885 apple_watch 2026-07-06T07:25:58 read as bare-wall-clock · agrees with watch -191288470618193
-- 2026-07-07 · 3 rows · was settled · after backfill: SETTLED · visible mileage 7.56 -> 7.56
--   -1627162702297366 apple_watch 2026-07-07T07:30:29 read as bare-wall-clock · agrees with apple_watch -1627162702297366
--   19223196365 strava 2026-07-07T07:30:29Z read as Z-as-local-wall-clock · agrees with apple_watch -1627162702297366
--   -87627419857791 watch 2026-07-07T07:30:29 read as bare-wall-clock · agrees with apple_watch -1627162702297366
-- 2026-07-08 · 2 rows · was settled · after backfill: SETTLED · visible mileage 6.16 -> 6.16
--   -208912546352697 watch 2026-07-08T07:11:57 read as bare-wall-clock · agrees with watch -208912546352697
--   -3584691068430173 apple_watch 2026-07-08T07:11:57 read as bare-wall-clock · agrees with watch -208912546352697
-- 2026-07-09 · 2 rows · was settled · after backfill: SETTLED · visible mileage 5.86 -> 5.86
--   -1155398071665602 apple_watch 2026-07-09T07:20:29 read as bare-wall-clock · agrees with apple_watch -1155398071665602
--   -71886754295643 watch 2026-07-09T07:20:29 read as bare-wall-clock · agrees with apple_watch -1155398071665602
-- 2026-07-10 · 2 rows · was settled · after backfill: SETTLED · visible mileage 4.96 -> 4.96
--   -104787411096713 watch 2026-07-10T10:59:02 read as bare-wall-clock · agrees with watch -104787411096713
--   -639306516579527 apple_watch 2026-07-10T10:59:02 read as bare-wall-clock · agrees with watch -104787411096713
-- 2026-07-12 · 3 rows · was settled · after backfill: SETTLED · visible mileage 12.60 -> 12.60
--   19285929199 strava 2026-07-12T08:24:59Z read as Z-as-local-wall-clock · agrees with apple_watch -2556438566943676
--   -2556438566943676 apple_watch 2026-07-12T08:24:59 read as bare-wall-clock · agrees with apple_watch -2556438566943676
--   -45100417674801 watch 2026-07-12T08:24:59 read as bare-wall-clock · agrees with apple_watch -2556438566943676
-- 2026-07-13 · 3 rows · was settled · after backfill: SETTLED · visible mileage 9.09 -> 9.09
--   -180849195850364 watch 2026-07-13T06:53:52 read as bare-wall-clock · agrees with watch -180849195850364
--   -1816044660127688 apple_watch 2026-07-13T06:53:52 read as bare-wall-clock · agrees with watch -180849195850364
--   19298695323 strava 2026-07-13T06:53:52Z read as Z-as-local-wall-clock · agrees with watch -180849195850364
-- 2026-07-14 · 3 rows · was settled · after backfill: STILL DISAGREES · visible mileage 8.02 -> 8.02
--   19310423037 strava 2026-07-14T06:29:24Z read as Z-as-local-wall-clock · agrees with watch -207423759046924
--   -207423759046924 watch 2026-07-14T06:29:24 read as bare-wall-clock · agrees with watch -207423759046924
--   -4269086812782646 apple_watch 2026-07-14T06:29:24 read as bare-wall-clock · agrees with watch -207423759046924
-- 2026-07-16 · 2 rows · was settled · after backfill: SETTLED · visible mileage 5.73 -> 5.73
--   -2610551602554450 apple_watch 2026-07-16T07:10:25 read as bare-wall-clock · agrees with apple_watch -2610551602554450
--   -280549580846348 watch 2026-07-16T07:10:25 read as bare-wall-clock · agrees with apple_watch -2610551602554450
-- 2026-07-17 · 2 rows · was settled · after backfill: SETTLED · visible mileage 7.90 -> 7.90
--   -2267175060297633 apple_watch 2026-07-17T12:17:43 read as bare-wall-clock · agrees with apple_watch -2267175060297633
--   -91071585653357 watch 2026-07-17T12:17:43 read as bare-wall-clock · agrees with apple_watch -2267175060297633
-- 2026-07-20 · 3 rows · was settled · after backfill: SETTLED · visible mileage 9.69 -> 9.69
--   19393955044 strava 2026-07-20T11:49:11Z read as Z-as-local-wall-clock · agrees with watch -27464959454570
--   -27464959454570 watch 2026-07-20T11:49:11 read as bare-wall-clock · agrees with watch -27464959454570
--   -4443179353638217 apple_watch 2026-07-20T11:49:11 read as bare-wall-clock · agrees with watch -27464959454570
-- 2026-07-21 · 3 rows · was settled · after backfill: SETTLED · visible mileage 7.52 -> 7.52
--   19407690969 strava 2026-07-21T07:07:29Z read as Z-as-local-wall-clock · agrees with watch -208859539241829
--   -208859539241829 watch 2026-07-21T07:07:29 read as bare-wall-clock · agrees with watch -208859539241829
--   -2237410597692427 apple_watch 2026-07-21T07:07:29 read as bare-wall-clock · agrees with watch -208859539241829
-- 2026-07-22 · 2 rows · was settled · after backfill: SETTLED · visible mileage 7.21 -> 7.21
--   -2128080027856960 apple_watch 2026-07-22T08:15:31 read as bare-wall-clock · agrees with apple_watch -2128080027856960
--   -434657604578 watch 2026-07-22T08:15:31 read as bare-wall-clock · agrees with apple_watch -2128080027856960
-- 2026-07-25 · 3 rows · was settled · after backfill: SETTLED · visible mileage 18.00 -> 18.00
--   19461601237 strava 2026-07-25T06:21:40Z read as Z-as-local-wall-clock · agrees with watch -254892999381071
--   -254892999381071 watch 2026-07-25T06:21:40 read as bare-wall-clock · agrees with watch -254892999381071
--   -375579766909448 apple_watch 2026-07-25T06:21:36 read as bare-wall-clock · agrees with watch -254892999381071
-- 2026-08-03 · 3 rows · was settled · after backfill: SETTLED · visible mileage 5.77 -> 5.77
--   19591753916 strava 2026-08-03T19:31:36Z read as Z-as-local-wall-clock · agrees with watch -280562721594452
--   -280562721594452 watch 2026-08-03T19:31:36 read as bare-wall-clock · agrees with watch -280562721594452
--   -3393139793149075 apple_watch 2026-08-03T19:31:36 read as bare-wall-clock · agrees with watch -280562721594452
-- 2026-08-05 · 3 rows · was settled · after backfill: SETTLED · visible mileage 6.02 -> 6.02
--   19614427738 strava 2026-08-05T07:53:14Z read as Z-as-local-wall-clock · agrees with apple_watch -2262505561379993
--   -2262505561379993 apple_watch 2026-08-05T07:53:14 read as bare-wall-clock · agrees with apple_watch -2262505561379993
--   -244830194868527 watch 2026-08-05T07:53:14 read as bare-wall-clock · agrees with apple_watch -2262505561379993
-- 2026-08-07 · 2 rows · was settled · after backfill: SETTLED · visible mileage 6.02 -> 6.02
--   -1044354498526307 apple_watch 2026-08-07T18:54:21 read as bare-wall-clock · agrees with apple_watch -1044354498526307
--   -83164907283861 watch 2026-08-07T18:54:21 read as bare-wall-clock · agrees with apple_watch -1044354498526307
-- 2026-08-09 · 3 rows · was settled · after backfill: SETTLED · visible mileage 12.37 -> 12.37
--   -164786796432085 watch 2026-08-09T06:13:33 read as bare-wall-clock · agrees with watch -164786796432085
--   19670069798 strava 2026-08-09T06:13:33Z read as Z-as-local-wall-clock · agrees with watch -164786796432085
--   -1995827603096484 apple_watch 2026-08-09T06:13:33 read as bare-wall-clock · agrees with watch -164786796432085
-- 2026-08-10 · 3 rows · was settled · after backfill: SETTLED · visible mileage 4.02 -> 4.02
--   -177132011318458 watch 2026-08-10T18:45:06 read as bare-wall-clock · agrees with watch -177132011318458
--   19689854161 strava 2026-08-10T18:45:06Z read as Z-as-local-wall-clock · agrees with watch -177132011318458
--   -2876070262105625 apple_watch 2026-08-10T18:45:06 read as bare-wall-clock · agrees with watch -177132011318458
-- 2026-08-11 · 3 rows · was settled · after backfill: SETTLED · visible mileage 5.97 -> 5.97
--   -106657799059002 watch 2026-08-11T18:42:01 read as bare-wall-clock · agrees with watch -106657799059002
--   19705634781 strava 2026-08-11T18:42:01Z read as Z-as-local-wall-clock · agrees with watch -106657799059002
--   -842621496543787 apple_watch 2026-08-11T18:42:01 read as bare-wall-clock · agrees with watch -106657799059002
-- 2026-08-16 · 3 rows · was settled · after backfill: SETTLED · visible mileage 13.20 -> 13.20
--   -161412146640788 watch 2026-08-16T06:15:03 read as bare-wall-clock · agrees with watch -161412146640788
--   19768940238 strava 2026-08-16T06:15:03Z read as Z-as-local-wall-clock · agrees with watch -161412146640788
--   -2101149874800974 apple_watch 2026-08-16T06:15:03 read as bare-wall-clock · agrees with watch -161412146640788
==============================================================================
-- PROPOSED BACKFILL · 137 statements · 43 days settle, 7 still disagree
-- Additive: sets one new key, only on rows that do not already have it. Reversible with:
--   UPDATE runs SET data = data - 'startUtc' WHERE user_uuid = '0645f40c-951d-4ccc-b86e-9979cd26c795';
==============================================================================
UPDATE runs SET data = jsonb_set(data, '{startUtc}', to_jsonb('2026-05-15T19:11:34.000Z'::text)) WHERE id = 18520809831 AND user_uuid = '0645f40c-951d-4ccc-b86e-9979cd26c795' AND NOT (data ? 'startUtc');
UPDATE runs SET data = jsonb_set(data, '{startUtc}', to_jsonb('2026-05-15T19:11:34.000Z'::text)) WHERE id = -254369820 AND user_uuid = '0645f40c-951d-4ccc-b86e-9979cd26c795' AND NOT (data ? 'startUtc');
UPDATE runs SET data = jsonb_set(data, '{startUtc}', to_jsonb('2026-05-17T23:23:38.000Z'::text)) WHERE id = -1521382352 AND user_uuid = '0645f40c-951d-4ccc-b86e-9979cd26c795' AND NOT (data ? 'startUtc');
UPDATE runs SET data = jsonb_set(data, '{startUtc}', to_jsonb('2026-05-17T23:23:38.000Z'::text)) WHERE id = 18556937471 AND user_uuid = '0645f40c-951d-4ccc-b86e-9979cd26c795' AND NOT (data ? 'startUtc');
UPDATE runs SET data = jsonb_set(data, '{startUtc}', to_jsonb('2026-05-20T03:49:41.000Z'::text)) WHERE id = -1344787242 AND user_uuid = '0645f40c-951d-4ccc-b86e-9979cd26c795' AND NOT (data ? 'startUtc');
UPDATE runs SET data = jsonb_set(data, '{startUtc}', to_jsonb('2026-05-20T03:49:41.000Z'::text)) WHERE id = 18582271505 AND user_uuid = '0645f40c-951d-4ccc-b86e-9979cd26c795' AND NOT (data ? 'startUtc');
UPDATE runs SET data = jsonb_set(data, '{startUtc}', to_jsonb('2026-05-20T03:49:41.000Z'::text)) WHERE id = -4100288002784906 AND user_uuid = '0645f40c-951d-4ccc-b86e-9979cd26c795' AND NOT (data ? 'startUtc');
UPDATE runs SET data = jsonb_set(data, '{startUtc}', to_jsonb('2026-05-20T23:53:53.000Z'::text)) WHERE id = -1346634309 AND user_uuid = '0645f40c-951d-4ccc-b86e-9979cd26c795' AND NOT (data ? 'startUtc');
UPDATE runs SET data = jsonb_set(data, '{startUtc}', to_jsonb('2026-05-20T23:53:53.000Z'::text)) WHERE id = 18589376553 AND user_uuid = '0645f40c-951d-4ccc-b86e-9979cd26c795' AND NOT (data ? 'startUtc');
UPDATE runs SET data = jsonb_set(data, '{startUtc}', to_jsonb('2026-05-20T23:53:53.000Z'::text)) WHERE id = -3363396946462586 AND user_uuid = '0645f40c-951d-4ccc-b86e-9979cd26c795' AND NOT (data ? 'startUtc');
UPDATE runs SET data = jsonb_set(data, '{startUtc}', to_jsonb('2026-05-22T03:31:02.000Z'::text)) WHERE id = -1109157298233570 AND user_uuid = '0645f40c-951d-4ccc-b86e-9979cd26c795' AND NOT (data ? 'startUtc');
UPDATE runs SET data = jsonb_set(data, '{startUtc}', to_jsonb('2026-05-22T03:31:02.000Z'::text)) WHERE id = -2060918745 AND user_uuid = '0645f40c-951d-4ccc-b86e-9979cd26c795' AND NOT (data ? 'startUtc');
UPDATE runs SET data = jsonb_set(data, '{startUtc}', to_jsonb('2026-05-22T04:32:37.000Z'::text)) WHERE id = -2060888953 AND user_uuid = '0645f40c-951d-4ccc-b86e-9979cd26c795' AND NOT (data ? 'startUtc');
UPDATE runs SET data = jsonb_set(data, '{startUtc}', to_jsonb('2026-05-22T04:32:37.000Z'::text)) WHERE id = -514138731845836 AND user_uuid = '0645f40c-951d-4ccc-b86e-9979cd26c795' AND NOT (data ? 'startUtc');
UPDATE runs SET data = jsonb_set(data, '{startUtc}', to_jsonb('2026-05-22T17:00:31.000Z'::text)) WHERE id = -1174130142 AND user_uuid = '0645f40c-951d-4ccc-b86e-9979cd26c795' AND NOT (data ? 'startUtc');
UPDATE runs SET data = jsonb_set(data, '{startUtc}', to_jsonb('2026-05-22T17:00:31.000Z'::text)) WHERE id = -1174338679 AND user_uuid = '0645f40c-951d-4ccc-b86e-9979cd26c795' AND NOT (data ? 'startUtc');
UPDATE runs SET data = jsonb_set(data, '{startUtc}', to_jsonb('2026-05-22T17:00:31.000Z'::text)) WHERE id = 18698496177 AND user_uuid = '0645f40c-951d-4ccc-b86e-9979cd26c795' AND NOT (data ? 'startUtc');
UPDATE runs SET data = jsonb_set(data, '{startUtc}', to_jsonb('2026-05-22T17:00:31.000Z'::text)) WHERE id = -2818378315677006 AND user_uuid = '0645f40c-951d-4ccc-b86e-9979cd26c795' AND NOT (data ? 'startUtc');
UPDATE runs SET data = jsonb_set(data, '{startUtc}', to_jsonb('2026-05-24T16:26:12.000Z'::text)) WHERE id = 18638945777 AND user_uuid = '0645f40c-951d-4ccc-b86e-9979cd26c795' AND NOT (data ? 'startUtc');
UPDATE runs SET data = jsonb_set(data, '{startUtc}', to_jsonb('2026-05-24T16:26:12.000Z'::text)) WHERE id = -2045716995500221 AND user_uuid = '0645f40c-951d-4ccc-b86e-9979cd26c795' AND NOT (data ? 'startUtc');
UPDATE runs SET data = jsonb_set(data, '{startUtc}', to_jsonb('2026-05-25T17:29:28.000Z'::text)) WHERE id = -1488380974 AND user_uuid = '0645f40c-951d-4ccc-b86e-9979cd26c795' AND NOT (data ? 'startUtc');
UPDATE runs SET data = jsonb_set(data, '{startUtc}', to_jsonb('2026-05-25T17:29:28.000Z'::text)) WHERE id = -4466990534547521 AND user_uuid = '0645f40c-951d-4ccc-b86e-9979cd26c795' AND NOT (data ? 'startUtc');
UPDATE runs SET data = jsonb_set(data, '{startUtc}', to_jsonb('2026-05-26T18:22:17.000Z'::text)) WHERE id = 18690124384 AND user_uuid = '0645f40c-951d-4ccc-b86e-9979cd26c795' AND NOT (data ? 'startUtc');
UPDATE runs SET data = jsonb_set(data, '{startUtc}', to_jsonb('2026-05-26T18:22:17.000Z'::text)) WHERE id = -573194905917117 AND user_uuid = '0645f40c-951d-4ccc-b86e-9979cd26c795' AND NOT (data ? 'startUtc');
UPDATE runs SET data = jsonb_set(data, '{startUtc}', to_jsonb('2026-05-31T15:43:14.000Z'::text)) WHERE id = -1466010895152803 AND user_uuid = '0645f40c-951d-4ccc-b86e-9979cd26c795' AND NOT (data ? 'startUtc');
UPDATE runs SET data = jsonb_set(data, '{startUtc}', to_jsonb('2026-05-31T15:43:14.000Z'::text)) WHERE id = -16421550262950 AND user_uuid = '0645f40c-951d-4ccc-b86e-9979cd26c795' AND NOT (data ? 'startUtc');
UPDATE runs SET data = jsonb_set(data, '{startUtc}', to_jsonb('2026-06-01T16:25:47.000Z'::text)) WHERE id = -2987651096082307 AND user_uuid = '0645f40c-951d-4ccc-b86e-9979cd26c795' AND NOT (data ? 'startUtc');
UPDATE runs SET data = jsonb_set(data, '{startUtc}', to_jsonb('2026-06-01T16:25:47.000Z'::text)) WHERE id = -42985697053171 AND user_uuid = '0645f40c-951d-4ccc-b86e-9979cd26c795' AND NOT (data ? 'startUtc');
UPDATE runs SET data = jsonb_set(data, '{startUtc}', to_jsonb('2026-06-02T19:16:14.000Z'::text)) WHERE id = -3558250452245243 AND user_uuid = '0645f40c-951d-4ccc-b86e-9979cd26c795' AND NOT (data ? 'startUtc');
UPDATE runs SET data = jsonb_set(data, '{startUtc}', to_jsonb('2026-06-02T19:16:14.000Z'::text)) WHERE id = -71141805277248 AND user_uuid = '0645f40c-951d-4ccc-b86e-9979cd26c795' AND NOT (data ? 'startUtc');
UPDATE runs SET data = jsonb_set(data, '{startUtc}', to_jsonb('2026-06-03T16:27:11.000Z'::text)) WHERE id = 18860093709 AND user_uuid = '0645f40c-951d-4ccc-b86e-9979cd26c795' AND NOT (data ? 'startUtc');
UPDATE runs SET data = jsonb_set(data, '{startUtc}', to_jsonb('2026-06-03T16:27:11.000Z'::text)) WHERE id = -3858000542489904 AND user_uuid = '0645f40c-951d-4ccc-b86e-9979cd26c795' AND NOT (data ? 'startUtc');
UPDATE runs SET data = jsonb_set(data, '{startUtc}', to_jsonb('2026-06-03T16:27:11.000Z'::text)) WHERE id = -99303583875384 AND user_uuid = '0645f40c-951d-4ccc-b86e-9979cd26c795' AND NOT (data ? 'startUtc');
UPDATE runs SET data = jsonb_set(data, '{startUtc}', to_jsonb('2026-06-04T16:04:21.000Z'::text)) WHERE id = -1483290537416636 AND user_uuid = '0645f40c-951d-4ccc-b86e-9979cd26c795' AND NOT (data ? 'startUtc');
UPDATE runs SET data = jsonb_set(data, '{startUtc}', to_jsonb('2026-06-04T16:04:21.000Z'::text)) WHERE id = 18860093710 AND user_uuid = '0645f40c-951d-4ccc-b86e-9979cd26c795' AND NOT (data ? 'startUtc');
UPDATE runs SET data = jsonb_set(data, '{startUtc}', to_jsonb('2026-06-04T16:04:21.000Z'::text)) WHERE id = -271531781519189 AND user_uuid = '0645f40c-951d-4ccc-b86e-9979cd26c795' AND NOT (data ? 'startUtc');
UPDATE runs SET data = jsonb_set(data, '{startUtc}', to_jsonb('2026-06-05T15:35:33.000Z'::text)) WHERE id = -102539783518325 AND user_uuid = '0645f40c-951d-4ccc-b86e-9979cd26c795' AND NOT (data ? 'startUtc');
UPDATE runs SET data = jsonb_set(data, '{startUtc}', to_jsonb('2026-06-05T15:35:33.000Z'::text)) WHERE id = 18860093380 AND user_uuid = '0645f40c-951d-4ccc-b86e-9979cd26c795' AND NOT (data ? 'startUtc');
UPDATE runs SET data = jsonb_set(data, '{startUtc}', to_jsonb('2026-06-05T15:35:33.000Z'::text)) WHERE id = -2142575830045023 AND user_uuid = '0645f40c-951d-4ccc-b86e-9979cd26c795' AND NOT (data ? 'startUtc');
UPDATE runs SET data = jsonb_set(data, '{startUtc}', to_jsonb('2026-06-08T19:42:18.000Z'::text)) WHERE id = 18859889751 AND user_uuid = '0645f40c-951d-4ccc-b86e-9979cd26c795' AND NOT (data ? 'startUtc');
UPDATE runs SET data = jsonb_set(data, '{startUtc}', to_jsonb('2026-06-08T19:42:18.000Z'::text)) WHERE id = -243713397221312 AND user_uuid = '0645f40c-951d-4ccc-b86e-9979cd26c795' AND NOT (data ? 'startUtc');
UPDATE runs SET data = jsonb_set(data, '{startUtc}', to_jsonb('2026-06-08T19:42:18.000Z'::text)) WHERE id = -977449062696924 AND user_uuid = '0645f40c-951d-4ccc-b86e-9979cd26c795' AND NOT (data ? 'startUtc');
UPDATE runs SET data = jsonb_set(data, '{startUtc}', to_jsonb('2026-06-09T15:42:08.000Z'::text)) WHERE id = -182722411215424 AND user_uuid = '0645f40c-951d-4ccc-b86e-9979cd26c795' AND NOT (data ? 'startUtc');
UPDATE runs SET data = jsonb_set(data, '{startUtc}', to_jsonb('2026-06-09T15:42:08.000Z'::text)) WHERE id = 18856408342 AND user_uuid = '0645f40c-951d-4ccc-b86e-9979cd26c795' AND NOT (data ? 'startUtc');
UPDATE runs SET data = jsonb_set(data, '{startUtc}', to_jsonb('2026-06-09T15:42:08.000Z'::text)) WHERE id = -227867093947909 AND user_uuid = '0645f40c-951d-4ccc-b86e-9979cd26c795' AND NOT (data ? 'startUtc');
UPDATE runs SET data = jsonb_set(data, '{startUtc}', to_jsonb('2026-06-11T02:41:28.000Z'::text)) WHERE id = 18873645099 AND user_uuid = '0645f40c-951d-4ccc-b86e-9979cd26c795' AND NOT (data ? 'startUtc');
UPDATE runs SET data = jsonb_set(data, '{startUtc}', to_jsonb('2026-06-11T02:41:28.000Z'::text)) WHERE id = -70333530507729 AND user_uuid = '0645f40c-951d-4ccc-b86e-9979cd26c795' AND NOT (data ? 'startUtc');
UPDATE runs SET data = jsonb_set(data, '{startUtc}', to_jsonb('2026-06-11T02:41:28.000Z'::text)) WHERE id = -763298079097609 AND user_uuid = '0645f40c-951d-4ccc-b86e-9979cd26c795' AND NOT (data ? 'startUtc');
UPDATE runs SET data = jsonb_set(data, '{startUtc}', to_jsonb('2026-06-11T15:25:45.000Z'::text)) WHERE id = -140999945150690 AND user_uuid = '0645f40c-951d-4ccc-b86e-9979cd26c795' AND NOT (data ? 'startUtc');
UPDATE runs SET data = jsonb_set(data, '{startUtc}', to_jsonb('2026-06-11T15:25:45.000Z'::text)) WHERE id = 18885330230 AND user_uuid = '0645f40c-951d-4ccc-b86e-9979cd26c795' AND NOT (data ? 'startUtc');
UPDATE runs SET data = jsonb_set(data, '{startUtc}', to_jsonb('2026-06-11T15:25:45.000Z'::text)) WHERE id = -92768649631212 AND user_uuid = '0645f40c-951d-4ccc-b86e-9979cd26c795' AND NOT (data ? 'startUtc');
UPDATE runs SET data = jsonb_set(data, '{startUtc}', to_jsonb('2026-06-14T15:16:14.000Z'::text)) WHERE id = 18920792777 AND user_uuid = '0645f40c-951d-4ccc-b86e-9979cd26c795' AND NOT (data ? 'startUtc');
UPDATE runs SET data = jsonb_set(data, '{startUtc}', to_jsonb('2026-06-14T15:16:14.000Z'::text)) WHERE id = -226447289863060 AND user_uuid = '0645f40c-951d-4ccc-b86e-9979cd26c795' AND NOT (data ? 'startUtc');
UPDATE runs SET data = jsonb_set(data, '{startUtc}', to_jsonb('2026-06-14T15:16:14.000Z'::text)) WHERE id = -4103293651232813 AND user_uuid = '0645f40c-951d-4ccc-b86e-9979cd26c795' AND NOT (data ? 'startUtc');
UPDATE runs SET data = jsonb_set(data, '{startUtc}', to_jsonb('2026-06-15T14:29:02.000Z'::text)) WHERE id = -1379097925561833 AND user_uuid = '0645f40c-951d-4ccc-b86e-9979cd26c795' AND NOT (data ? 'startUtc');
UPDATE runs SET data = jsonb_set(data, '{startUtc}', to_jsonb('2026-06-15T14:29:02.000Z'::text)) WHERE id = 18933762115 AND user_uuid = '0645f40c-951d-4ccc-b86e-9979cd26c795' AND NOT (data ? 'startUtc');
UPDATE runs SET data = jsonb_set(data, '{startUtc}', to_jsonb('2026-06-15T14:29:02.000Z'::text)) WHERE id = -20211252944965 AND user_uuid = '0645f40c-951d-4ccc-b86e-9979cd26c795' AND NOT (data ? 'startUtc');
UPDATE runs SET data = jsonb_set(data, '{startUtc}', to_jsonb('2026-06-16T14:18:29.000Z'::text)) WHERE id = 18944794868 AND user_uuid = '0645f40c-951d-4ccc-b86e-9979cd26c795' AND NOT (data ? 'startUtc');
UPDATE runs SET data = jsonb_set(data, '{startUtc}', to_jsonb('2026-06-16T14:18:29.000Z'::text)) WHERE id = -27148287813731 AND user_uuid = '0645f40c-951d-4ccc-b86e-9979cd26c795' AND NOT (data ? 'startUtc');
UPDATE runs SET data = jsonb_set(data, '{startUtc}', to_jsonb('2026-06-16T14:18:29.000Z'::text)) WHERE id = -3524810659692108 AND user_uuid = '0645f40c-951d-4ccc-b86e-9979cd26c795' AND NOT (data ? 'startUtc');
UPDATE runs SET data = jsonb_set(data, '{startUtc}', to_jsonb('2026-06-17T15:27:10.000Z'::text)) WHERE id = -142898519593835 AND user_uuid = '0645f40c-951d-4ccc-b86e-9979cd26c795' AND NOT (data ? 'startUtc');
UPDATE runs SET data = jsonb_set(data, '{startUtc}', to_jsonb('2026-06-17T15:27:10.000Z'::text)) WHERE id = 19001756362 AND user_uuid = '0645f40c-951d-4ccc-b86e-9979cd26c795' AND NOT (data ? 'startUtc');
UPDATE runs SET data = jsonb_set(data, '{startUtc}', to_jsonb('2026-06-17T15:27:10.000Z'::text)) WHERE id = -689529591569685 AND user_uuid = '0645f40c-951d-4ccc-b86e-9979cd26c795' AND NOT (data ? 'startUtc');
UPDATE runs SET data = jsonb_set(data, '{startUtc}', to_jsonb('2026-06-18T17:07:26.000Z'::text)) WHERE id = -1290175639974807 AND user_uuid = '0645f40c-951d-4ccc-b86e-9979cd26c795' AND NOT (data ? 'startUtc');
UPDATE runs SET data = jsonb_set(data, '{startUtc}', to_jsonb('2026-06-18T17:07:26.000Z'::text)) WHERE id = 19001763928 AND user_uuid = '0645f40c-951d-4ccc-b86e-9979cd26c795' AND NOT (data ? 'startUtc');
UPDATE runs SET data = jsonb_set(data, '{startUtc}', to_jsonb('2026-06-18T17:07:26.000Z'::text)) WHERE id = -251580989059278 AND user_uuid = '0645f40c-951d-4ccc-b86e-9979cd26c795' AND NOT (data ? 'startUtc');
UPDATE runs SET data = jsonb_set(data, '{startUtc}', to_jsonb('2026-06-19T22:00:13.000Z'::text)) WHERE id = 19001760320 AND user_uuid = '0645f40c-951d-4ccc-b86e-9979cd26c795' AND NOT (data ? 'startUtc');
UPDATE runs SET data = jsonb_set(data, '{startUtc}', to_jsonb('2026-06-19T22:00:13.000Z'::text)) WHERE id = -2879891908180737 AND user_uuid = '0645f40c-951d-4ccc-b86e-9979cd26c795' AND NOT (data ? 'startUtc');
UPDATE runs SET data = jsonb_set(data, '{startUtc}', to_jsonb('2026-06-19T22:00:13.000Z'::text)) WHERE id = -75222347127112 AND user_uuid = '0645f40c-951d-4ccc-b86e-9979cd26c795' AND NOT (data ? 'startUtc');
UPDATE runs SET data = jsonb_set(data, '{startUtc}', to_jsonb('2026-06-21T14:14:46.000Z'::text)) WHERE id = -127657343028184 AND user_uuid = '0645f40c-951d-4ccc-b86e-9979cd26c795' AND NOT (data ? 'startUtc');
UPDATE runs SET data = jsonb_set(data, '{startUtc}', to_jsonb('2026-06-21T14:14:46.000Z'::text)) WHERE id = 19012672608 AND user_uuid = '0645f40c-951d-4ccc-b86e-9979cd26c795' AND NOT (data ? 'startUtc');
UPDATE runs SET data = jsonb_set(data, '{startUtc}', to_jsonb('2026-06-21T14:14:46.000Z'::text)) WHERE id = -386311530097203 AND user_uuid = '0645f40c-951d-4ccc-b86e-9979cd26c795' AND NOT (data ? 'startUtc');
UPDATE runs SET data = jsonb_set(data, '{startUtc}', to_jsonb('2026-06-23T15:27:42.000Z'::text)) WHERE id = -1311970832226386 AND user_uuid = '0645f40c-951d-4ccc-b86e-9979cd26c795' AND NOT (data ? 'startUtc');
UPDATE runs SET data = jsonb_set(data, '{startUtc}', to_jsonb('2026-06-23T15:27:42.000Z'::text)) WHERE id = 19041329503 AND user_uuid = '0645f40c-951d-4ccc-b86e-9979cd26c795' AND NOT (data ? 'startUtc');
UPDATE runs SET data = jsonb_set(data, '{startUtc}', to_jsonb('2026-06-23T15:27:42.000Z'::text)) WHERE id = -2351254210708 AND user_uuid = '0645f40c-951d-4ccc-b86e-9979cd26c795' AND NOT (data ? 'startUtc');
UPDATE runs SET data = jsonb_set(data, '{startUtc}', to_jsonb('2026-06-25T16:27:34.000Z'::text)) WHERE id = 19064854929 AND user_uuid = '0645f40c-951d-4ccc-b86e-9979cd26c795' AND NOT (data ? 'startUtc');
UPDATE runs SET data = jsonb_set(data, '{startUtc}', to_jsonb('2026-06-25T16:27:34.000Z'::text)) WHERE id = -28841066621288 AND user_uuid = '0645f40c-951d-4ccc-b86e-9979cd26c795' AND NOT (data ? 'startUtc');
UPDATE runs SET data = jsonb_set(data, '{startUtc}', to_jsonb('2026-06-25T16:27:34.000Z'::text)) WHERE id = -3813725101122266 AND user_uuid = '0645f40c-951d-4ccc-b86e-9979cd26c795' AND NOT (data ? 'startUtc');
UPDATE runs SET data = jsonb_set(data, '{startUtc}', to_jsonb('2026-06-27T13:56:17.000Z'::text)) WHERE id = -132305279286285 AND user_uuid = '0645f40c-951d-4ccc-b86e-9979cd26c795' AND NOT (data ? 'startUtc');
UPDATE runs SET data = jsonb_set(data, '{startUtc}', to_jsonb('2026-06-27T13:56:17.000Z'::text)) WHERE id = 19090200932 AND user_uuid = '0645f40c-951d-4ccc-b86e-9979cd26c795' AND NOT (data ? 'startUtc');
UPDATE runs SET data = jsonb_set(data, '{startUtc}', to_jsonb('2026-06-27T13:56:17.000Z'::text)) WHERE id = -4086538471561527 AND user_uuid = '0645f40c-951d-4ccc-b86e-9979cd26c795' AND NOT (data ? 'startUtc');
UPDATE runs SET data = jsonb_set(data, '{startUtc}', to_jsonb('2026-07-06T14:25:58.000Z'::text)) WHERE id = -191288470618193 AND user_uuid = '0645f40c-951d-4ccc-b86e-9979cd26c795' AND NOT (data ? 'startUtc');
UPDATE runs SET data = jsonb_set(data, '{startUtc}', to_jsonb('2026-07-06T14:25:58.000Z'::text)) WHERE id = 19207587294 AND user_uuid = '0645f40c-951d-4ccc-b86e-9979cd26c795' AND NOT (data ? 'startUtc');
UPDATE runs SET data = jsonb_set(data, '{startUtc}', to_jsonb('2026-07-06T14:25:58.000Z'::text)) WHERE id = -2431764854705885 AND user_uuid = '0645f40c-951d-4ccc-b86e-9979cd26c795' AND NOT (data ? 'startUtc');
UPDATE runs SET data = jsonb_set(data, '{startUtc}', to_jsonb('2026-07-07T14:30:29.000Z'::text)) WHERE id = -1627162702297366 AND user_uuid = '0645f40c-951d-4ccc-b86e-9979cd26c795' AND NOT (data ? 'startUtc');
UPDATE runs SET data = jsonb_set(data, '{startUtc}', to_jsonb('2026-07-07T14:30:29.000Z'::text)) WHERE id = 19223196365 AND user_uuid = '0645f40c-951d-4ccc-b86e-9979cd26c795' AND NOT (data ? 'startUtc');
UPDATE runs SET data = jsonb_set(data, '{startUtc}', to_jsonb('2026-07-07T14:30:29.000Z'::text)) WHERE id = -87627419857791 AND user_uuid = '0645f40c-951d-4ccc-b86e-9979cd26c795' AND NOT (data ? 'startUtc');
UPDATE runs SET data = jsonb_set(data, '{startUtc}', to_jsonb('2026-07-08T14:11:57.000Z'::text)) WHERE id = -208912546352697 AND user_uuid = '0645f40c-951d-4ccc-b86e-9979cd26c795' AND NOT (data ? 'startUtc');
UPDATE runs SET data = jsonb_set(data, '{startUtc}', to_jsonb('2026-07-08T14:11:57.000Z'::text)) WHERE id = -3584691068430173 AND user_uuid = '0645f40c-951d-4ccc-b86e-9979cd26c795' AND NOT (data ? 'startUtc');
UPDATE runs SET data = jsonb_set(data, '{startUtc}', to_jsonb('2026-07-09T14:20:29.000Z'::text)) WHERE id = -1155398071665602 AND user_uuid = '0645f40c-951d-4ccc-b86e-9979cd26c795' AND NOT (data ? 'startUtc');
UPDATE runs SET data = jsonb_set(data, '{startUtc}', to_jsonb('2026-07-09T14:20:29.000Z'::text)) WHERE id = -71886754295643 AND user_uuid = '0645f40c-951d-4ccc-b86e-9979cd26c795' AND NOT (data ? 'startUtc');
UPDATE runs SET data = jsonb_set(data, '{startUtc}', to_jsonb('2026-07-10T17:59:02.000Z'::text)) WHERE id = -104787411096713 AND user_uuid = '0645f40c-951d-4ccc-b86e-9979cd26c795' AND NOT (data ? 'startUtc');
UPDATE runs SET data = jsonb_set(data, '{startUtc}', to_jsonb('2026-07-10T17:59:02.000Z'::text)) WHERE id = -639306516579527 AND user_uuid = '0645f40c-951d-4ccc-b86e-9979cd26c795' AND NOT (data ? 'startUtc');
UPDATE runs SET data = jsonb_set(data, '{startUtc}', to_jsonb('2026-07-12T15:24:59.000Z'::text)) WHERE id = 19285929199 AND user_uuid = '0645f40c-951d-4ccc-b86e-9979cd26c795' AND NOT (data ? 'startUtc');
UPDATE runs SET data = jsonb_set(data, '{startUtc}', to_jsonb('2026-07-12T15:24:59.000Z'::text)) WHERE id = -2556438566943676 AND user_uuid = '0645f40c-951d-4ccc-b86e-9979cd26c795' AND NOT (data ? 'startUtc');
UPDATE runs SET data = jsonb_set(data, '{startUtc}', to_jsonb('2026-07-12T15:24:59.000Z'::text)) WHERE id = -45100417674801 AND user_uuid = '0645f40c-951d-4ccc-b86e-9979cd26c795' AND NOT (data ? 'startUtc');
UPDATE runs SET data = jsonb_set(data, '{startUtc}', to_jsonb('2026-07-13T13:53:52.000Z'::text)) WHERE id = -180849195850364 AND user_uuid = '0645f40c-951d-4ccc-b86e-9979cd26c795' AND NOT (data ? 'startUtc');
UPDATE runs SET data = jsonb_set(data, '{startUtc}', to_jsonb('2026-07-13T13:53:52.000Z'::text)) WHERE id = -1816044660127688 AND user_uuid = '0645f40c-951d-4ccc-b86e-9979cd26c795' AND NOT (data ? 'startUtc');
UPDATE runs SET data = jsonb_set(data, '{startUtc}', to_jsonb('2026-07-13T13:53:52.000Z'::text)) WHERE id = 19298695323 AND user_uuid = '0645f40c-951d-4ccc-b86e-9979cd26c795' AND NOT (data ? 'startUtc');
UPDATE runs SET data = jsonb_set(data, '{startUtc}', to_jsonb('2026-07-14T13:29:24.000Z'::text)) WHERE id = 19310423037 AND user_uuid = '0645f40c-951d-4ccc-b86e-9979cd26c795' AND NOT (data ? 'startUtc');
UPDATE runs SET data = jsonb_set(data, '{startUtc}', to_jsonb('2026-07-14T13:29:24.000Z'::text)) WHERE id = -207423759046924 AND user_uuid = '0645f40c-951d-4ccc-b86e-9979cd26c795' AND NOT (data ? 'startUtc');
UPDATE runs SET data = jsonb_set(data, '{startUtc}', to_jsonb('2026-07-14T13:29:24.000Z'::text)) WHERE id = -4269086812782646 AND user_uuid = '0645f40c-951d-4ccc-b86e-9979cd26c795' AND NOT (data ? 'startUtc');
UPDATE runs SET data = jsonb_set(data, '{startUtc}', to_jsonb('2026-07-16T14:10:25.000Z'::text)) WHERE id = -2610551602554450 AND user_uuid = '0645f40c-951d-4ccc-b86e-9979cd26c795' AND NOT (data ? 'startUtc');
UPDATE runs SET data = jsonb_set(data, '{startUtc}', to_jsonb('2026-07-16T14:10:25.000Z'::text)) WHERE id = -280549580846348 AND user_uuid = '0645f40c-951d-4ccc-b86e-9979cd26c795' AND NOT (data ? 'startUtc');
UPDATE runs SET data = jsonb_set(data, '{startUtc}', to_jsonb('2026-07-17T19:17:43.000Z'::text)) WHERE id = -2267175060297633 AND user_uuid = '0645f40c-951d-4ccc-b86e-9979cd26c795' AND NOT (data ? 'startUtc');
UPDATE runs SET data = jsonb_set(data, '{startUtc}', to_jsonb('2026-07-17T19:17:43.000Z'::text)) WHERE id = -91071585653357 AND user_uuid = '0645f40c-951d-4ccc-b86e-9979cd26c795' AND NOT (data ? 'startUtc');
UPDATE runs SET data = jsonb_set(data, '{startUtc}', to_jsonb('2026-07-20T18:49:11.000Z'::text)) WHERE id = 19393955044 AND user_uuid = '0645f40c-951d-4ccc-b86e-9979cd26c795' AND NOT (data ? 'startUtc');
UPDATE runs SET data = jsonb_set(data, '{startUtc}', to_jsonb('2026-07-20T18:49:11.000Z'::text)) WHERE id = -27464959454570 AND user_uuid = '0645f40c-951d-4ccc-b86e-9979cd26c795' AND NOT (data ? 'startUtc');
UPDATE runs SET data = jsonb_set(data, '{startUtc}', to_jsonb('2026-07-20T18:49:11.000Z'::text)) WHERE id = -4443179353638217 AND user_uuid = '0645f40c-951d-4ccc-b86e-9979cd26c795' AND NOT (data ? 'startUtc');
UPDATE runs SET data = jsonb_set(data, '{startUtc}', to_jsonb('2026-07-21T14:07:29.000Z'::text)) WHERE id = 19407690969 AND user_uuid = '0645f40c-951d-4ccc-b86e-9979cd26c795' AND NOT (data ? 'startUtc');
UPDATE runs SET data = jsonb_set(data, '{startUtc}', to_jsonb('2026-07-21T14:07:29.000Z'::text)) WHERE id = -208859539241829 AND user_uuid = '0645f40c-951d-4ccc-b86e-9979cd26c795' AND NOT (data ? 'startUtc');
UPDATE runs SET data = jsonb_set(data, '{startUtc}', to_jsonb('2026-07-21T14:07:29.000Z'::text)) WHERE id = -2237410597692427 AND user_uuid = '0645f40c-951d-4ccc-b86e-9979cd26c795' AND NOT (data ? 'startUtc');
UPDATE runs SET data = jsonb_set(data, '{startUtc}', to_jsonb('2026-07-22T15:15:31.000Z'::text)) WHERE id = -2128080027856960 AND user_uuid = '0645f40c-951d-4ccc-b86e-9979cd26c795' AND NOT (data ? 'startUtc');
UPDATE runs SET data = jsonb_set(data, '{startUtc}', to_jsonb('2026-07-22T15:15:31.000Z'::text)) WHERE id = -434657604578 AND user_uuid = '0645f40c-951d-4ccc-b86e-9979cd26c795' AND NOT (data ? 'startUtc');
UPDATE runs SET data = jsonb_set(data, '{startUtc}', to_jsonb('2026-07-25T13:21:40.000Z'::text)) WHERE id = 19461601237 AND user_uuid = '0645f40c-951d-4ccc-b86e-9979cd26c795' AND NOT (data ? 'startUtc');
UPDATE runs SET data = jsonb_set(data, '{startUtc}', to_jsonb('2026-07-25T13:21:40.000Z'::text)) WHERE id = -254892999381071 AND user_uuid = '0645f40c-951d-4ccc-b86e-9979cd26c795' AND NOT (data ? 'startUtc');
UPDATE runs SET data = jsonb_set(data, '{startUtc}', to_jsonb('2026-07-25T13:21:40.000Z'::text)) WHERE id = -375579766909448 AND user_uuid = '0645f40c-951d-4ccc-b86e-9979cd26c795' AND NOT (data ? 'startUtc');
UPDATE runs SET data = jsonb_set(data, '{startUtc}', to_jsonb('2026-08-04T02:31:36.000Z'::text)) WHERE id = 19591753916 AND user_uuid = '0645f40c-951d-4ccc-b86e-9979cd26c795' AND NOT (data ? 'startUtc');
UPDATE runs SET data = jsonb_set(data, '{startUtc}', to_jsonb('2026-08-04T02:31:36.000Z'::text)) WHERE id = -280562721594452 AND user_uuid = '0645f40c-951d-4ccc-b86e-9979cd26c795' AND NOT (data ? 'startUtc');
UPDATE runs SET data = jsonb_set(data, '{startUtc}', to_jsonb('2026-08-04T02:31:36.000Z'::text)) WHERE id = -3393139793149075 AND user_uuid = '0645f40c-951d-4ccc-b86e-9979cd26c795' AND NOT (data ? 'startUtc');
UPDATE runs SET data = jsonb_set(data, '{startUtc}', to_jsonb('2026-08-05T14:53:14.000Z'::text)) WHERE id = 19614427738 AND user_uuid = '0645f40c-951d-4ccc-b86e-9979cd26c795' AND NOT (data ? 'startUtc');
UPDATE runs SET data = jsonb_set(data, '{startUtc}', to_jsonb('2026-08-05T14:53:14.000Z'::text)) WHERE id = -2262505561379993 AND user_uuid = '0645f40c-951d-4ccc-b86e-9979cd26c795' AND NOT (data ? 'startUtc');
UPDATE runs SET data = jsonb_set(data, '{startUtc}', to_jsonb('2026-08-05T14:53:14.000Z'::text)) WHERE id = -244830194868527 AND user_uuid = '0645f40c-951d-4ccc-b86e-9979cd26c795' AND NOT (data ? 'startUtc');
UPDATE runs SET data = jsonb_set(data, '{startUtc}', to_jsonb('2026-08-08T01:54:21.000Z'::text)) WHERE id = -1044354498526307 AND user_uuid = '0645f40c-951d-4ccc-b86e-9979cd26c795' AND NOT (data ? 'startUtc');
UPDATE runs SET data = jsonb_set(data, '{startUtc}', to_jsonb('2026-08-08T01:54:21.000Z'::text)) WHERE id = -83164907283861 AND user_uuid = '0645f40c-951d-4ccc-b86e-9979cd26c795' AND NOT (data ? 'startUtc');
UPDATE runs SET data = jsonb_set(data, '{startUtc}', to_jsonb('2026-08-09T13:13:33.000Z'::text)) WHERE id = -164786796432085 AND user_uuid = '0645f40c-951d-4ccc-b86e-9979cd26c795' AND NOT (data ? 'startUtc');
UPDATE runs SET data = jsonb_set(data, '{startUtc}', to_jsonb('2026-08-09T13:13:33.000Z'::text)) WHERE id = 19670069798 AND user_uuid = '0645f40c-951d-4ccc-b86e-9979cd26c795' AND NOT (data ? 'startUtc');
UPDATE runs SET data = jsonb_set(data, '{startUtc}', to_jsonb('2026-08-09T13:13:33.000Z'::text)) WHERE id = -1995827603096484 AND user_uuid = '0645f40c-951d-4ccc-b86e-9979cd26c795' AND NOT (data ? 'startUtc');
UPDATE runs SET data = jsonb_set(data, '{startUtc}', to_jsonb('2026-08-11T01:45:06.000Z'::text)) WHERE id = -177132011318458 AND user_uuid = '0645f40c-951d-4ccc-b86e-9979cd26c795' AND NOT (data ? 'startUtc');
UPDATE runs SET data = jsonb_set(data, '{startUtc}', to_jsonb('2026-08-11T01:45:06.000Z'::text)) WHERE id = 19689854161 AND user_uuid = '0645f40c-951d-4ccc-b86e-9979cd26c795' AND NOT (data ? 'startUtc');
UPDATE runs SET data = jsonb_set(data, '{startUtc}', to_jsonb('2026-08-11T01:45:06.000Z'::text)) WHERE id = -2876070262105625 AND user_uuid = '0645f40c-951d-4ccc-b86e-9979cd26c795' AND NOT (data ? 'startUtc');
UPDATE runs SET data = jsonb_set(data, '{startUtc}', to_jsonb('2026-08-12T01:42:01.000Z'::text)) WHERE id = -106657799059002 AND user_uuid = '0645f40c-951d-4ccc-b86e-9979cd26c795' AND NOT (data ? 'startUtc');
UPDATE runs SET data = jsonb_set(data, '{startUtc}', to_jsonb('2026-08-12T01:42:01.000Z'::text)) WHERE id = 19705634781 AND user_uuid = '0645f40c-951d-4ccc-b86e-9979cd26c795' AND NOT (data ? 'startUtc');
UPDATE runs SET data = jsonb_set(data, '{startUtc}', to_jsonb('2026-08-12T01:42:01.000Z'::text)) WHERE id = -842621496543787 AND user_uuid = '0645f40c-951d-4ccc-b86e-9979cd26c795' AND NOT (data ? 'startUtc');
UPDATE runs SET data = jsonb_set(data, '{startUtc}', to_jsonb('2026-08-16T13:15:03.000Z'::text)) WHERE id = -161412146640788 AND user_uuid = '0645f40c-951d-4ccc-b86e-9979cd26c795' AND NOT (data ? 'startUtc');
UPDATE runs SET data = jsonb_set(data, '{startUtc}', to_jsonb('2026-08-16T13:15:03.000Z'::text)) WHERE id = 19768940238 AND user_uuid = '0645f40c-951d-4ccc-b86e-9979cd26c795' AND NOT (data ? 'startUtc');
UPDATE runs SET data = jsonb_set(data, '{startUtc}', to_jsonb('2026-08-16T13:15:03.000Z'::text)) WHERE id = -2101149874800974 AND user_uuid = '0645f40c-951d-4ccc-b86e-9979cd26c795' AND NOT (data ? 'startUtc');
-- NOT PROPOSED (16) · left alone rather than guessed:
--   2026-01-02 group=16937839401 · 2 instants every row can mean · nothing in the data picks between them · 16914871121/null/2026-01-02T08:41:40Z 16937839401/null/2026-01-02T08:41:35Z
--   2026-04-23 group=-90172438 · 2 instants every row can mean · nothing in the data picks between them · 18227807601/null/2026-04-23T15:37:12Z -90172438/apple_health/2026-04-23T15:37:12Z
--   2026-04-25 group=-1684834858 · 2 instants every row can mean · nothing in the data picks between them · -1684834858/apple_health/2026-04-25T15:11:07Z 18254580321/null/2026-04-25T15:11:07Z
--   2026-04-26 group=-1722688244 · 2 instants every row can mean · nothing in the data picks between them · -1722688244/apple_health/2026-04-26T13:45:13Z 18270567015/null/2026-04-26T13:45:13Z
--   2026-04-29 group=-1010945655 · 2 instants every row can mean · nothing in the data picks between them · -1010945655/apple_health/2026-04-30T00:25:23Z 18315543710/null/2026-04-30T00:25:23Z
--   2026-05-01 group=-1251512475 · 2 instants every row can mean · nothing in the data picks between them · -1251512475/apple_health/2026-05-01T22:51:00Z 18339716313/null/2026-05-01T22:51:00Z
--   2026-05-03 group=-522630830 · 2 instants every row can mean · nothing in the data picks between them · 18362267811/null/2026-05-03T14:15:01Z -522630830/apple_health/2026-05-03T14:15:01Z
--   2026-05-06 group=-223275054 · 2 instants every row can mean · nothing in the data picks between them · 18407669553/null/2026-05-07T03:17:31Z -223275054/apple_health/2026-05-07T03:17:31Z
--   2026-05-08 group=-665301223 · 2 instants every row can mean · nothing in the data picks between them · 18429834258/null/2026-05-08T18:51:05Z -665301223/apple_health/2026-05-08T18:51:05Z
--   2026-05-12 group=-1378831178 · 2 instants every row can mean · nothing in the data picks between them · -1378831178/apple_health/2026-05-12T23:00:06Z 18484764381/null/2026-05-12T23:00:06Z
--   2026-05-13 group=-2029406939 · 2 instants every row can mean · nothing in the data picks between them · 18495544392/null/2026-05-13T18:24:12Z -2029406939/apple_health/2026-05-13T18:24:12Z
--   2026-05-14 group=-1141962844 · 2 instants every row can mean · nothing in the data picks between them · -1141962844/apple_health/2026-05-14T16:20:54Z 18508131051/null/2026-05-14T16:20:54Z
--   2026-05-14 group=-255472024 · 2 instants every row can mean · nothing in the data picks between them · 18512335226/null/2026-05-15T03:32:51Z -255472024/apple_health/2026-05-15T03:32:51Z
--   2026-05-24 group=-1135018536585133 · 2 instants every row can mean · nothing in the data picks between them · -1135018536585133/apple_watch/2026-05-24T16:14:01Z -600847466/apple_health/2026-05-24T16:14:01Z
--   2026-05-27 group=-164879313431759 · no instant every row can mean · -164879313431759/watch/2026-05-27T19:35:29 -2660106955895943/apple_watch/2026-05-27T12:32:48
--   2026-05-29 group=-241421579595571 · no instant every row can mean · -1176022801177594/apple_watch/2026-05-29T10:00:44 -241421579595571/watch/2026-05-29T17:08:07
--  ----------  -----------------------------  -------  -----------------------------  -----------

-- ════════════════════════════════════════════════════════════════════════
-- SEPARATE DECISION · the one duplicate that is VISIBLE today
--
-- 2026-08-01 carries the same run twice and always has:
--   19562826050        strava       1.3373 mi  612 s  startLocal 13:43:53Z
--   -2702777794856273  apple_watch  1.34   mi  612 s  startLocal 15:43:53
-- The day therefore reads 5.50 mi against a true 4.16 mi. 1.34 phantom miles.
--
-- Neither row is wrong about its own wall clock. Strava assigned the activity
-- a UTC-9 zone from its GPS (startLatLng 52.44, -132.32 — open water; the run
-- is named Cruise Miles), and the phone stamped 15:43:53 in the runner's
-- Pacific profile zone. Both describe 2026-08-01T22:43:53Z: 15:43:53 Pacific
-- is 22:43:53Z, and 13:43:53 at UTC-9 is the same instant. Stamping it on
-- both makes them one run.
--
-- Then re-run the merge for that day (operational, no DDL):
--   POST /api/admin/recompute-runs  (autoMergeRecent), or autoMergeForDate(user, '2026-08-01')
--
UPDATE runs SET data = jsonb_set(data, '{startUtc}', to_jsonb('2026-08-01T22:43:53.000Z'::text))
 WHERE id = 19562826050 AND user_uuid = '0645f40c-951d-4ccc-b86e-9979cd26c795' AND NOT (data ? 'startUtc');
UPDATE runs SET data = jsonb_set(data, '{startUtc}', to_jsonb('2026-08-01T22:43:53.000Z'::text))
 WHERE id = -2702777794856273 AND user_uuid = '0645f40c-951d-4ccc-b86e-9979cd26c795' AND NOT (data ? 'startUtc');
