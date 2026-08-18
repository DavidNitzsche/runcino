-- users columns
SELECT column_name FROM information_schema.columns WHERE table_name='users' ORDER BY ordinal_position;
--@
-- profile columns
SELECT column_name FROM information_schema.columns WHERE table_name='profile' ORDER BY ordinal_position;
--@
-- runs columns
SELECT column_name, data_type FROM information_schema.columns WHERE table_name='runs' ORDER BY ordinal_position;
--@
-- active (non-archived) plans for David
SELECT id, jsonb_pretty(authored_state) FILTER (WHERE false) IS NULL AS x FROM (SELECT 1) z;
