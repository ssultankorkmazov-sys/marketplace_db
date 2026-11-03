-- READ-ONLY preflight for migrations 004_anomaly_incidents.sql and
-- 005_anomaly_queue_dead_letter.sql. This file contains SELECTs only.
-- Run in Neon SQL Editor before either migration. A wholly absent migration
-- is normal; MISMATCH, PARTIAL_STOP, or REVIEW rows require investigation.

-- 1. Connection identity and required base relations.
SELECT current_database() AS current_database,
       current_schema() AS current_schema,
       current_user AS current_user,
       current_setting('server_version') AS server_version;

WITH expected(relation_name) AS (
  VALUES ('users'), ('audit_logs'), ('anomaly_incidents'),
         ('anomaly_incident_events'), ('anomaly_event_queue')
)
SELECT 'public.' || expected.relation_name AS object_name,
       to_regclass('public.' || expected.relation_name)::text AS actual_relation,
       CASE WHEN to_regclass('public.' || expected.relation_name) IS NULL THEN 'MISSING' ELSE 'PRESENT' END AS result
FROM expected
ORDER BY expected.relation_name;

-- 2. Required columns, types, lengths, nullability, and defaults from 004/005.
WITH expected(table_name, column_name, data_type, char_length, nullable, default_kind, expected_default) AS (
  VALUES
    ('anomaly_incidents','incident_id','bigint',NULL::integer,'NO','sequence',NULL::text),
    ('anomaly_incidents','anomaly_type','character varying',64,'NO','none',NULL::text),
    ('anomaly_incidents','subject_user_id','integer',NULL,'YES','none',NULL),
    ('anomaly_incidents','severity','character varying',16,'NO','none',NULL),
    ('anomaly_incidents','risk_score','integer',NULL,'NO','none',NULL),
    ('anomaly_incidents','status','character varying',20,'NO','literal','''new'''),
    ('anomaly_incidents','detected_at','timestamp with time zone',NULL,'NO','now','now()'),
    ('anomaly_incidents','updated_at','timestamp with time zone',NULL,'NO','now','now()'),
    ('anomaly_incidents','first_event_at','timestamp with time zone',NULL,'NO','none',NULL),
    ('anomaly_incidents','last_event_at','timestamp with time zone',NULL,'NO','none',NULL),
    ('anomaly_incidents','evidence','jsonb',NULL,'NO','literal','''{}'''),
    ('anomaly_incidents','explanation','text',NULL,'NO','none',NULL),
    ('anomaly_incidents','recommendations','jsonb',NULL,'NO','literal','''[]'''),
    ('anomaly_incidents','deduplication_key','character varying',160,'NO','none',NULL),
    ('anomaly_incident_events','incident_id','bigint',NULL,'NO','none',NULL),
    ('anomaly_incident_events','log_id','bigint',NULL,'NO','none',NULL),
    ('anomaly_incident_events','linked_at','timestamp with time zone',NULL,'NO','now','now()'),
    ('anomaly_event_queue','log_id','bigint',NULL,'NO','none',NULL),
    ('anomaly_event_queue','queued_at','timestamp with time zone',NULL,'NO','now','now()'),
    ('anomaly_event_queue','attempts','integer',NULL,'NO','literal','0'),
    ('anomaly_event_queue','available_at','timestamp with time zone',NULL,'NO','now','now()'),
    ('anomaly_event_queue','processed_at','timestamp with time zone',NULL,'YES','none',NULL),
    ('anomaly_event_queue','last_error','text',NULL,'YES','none',NULL),
    ('anomaly_event_queue','dead_lettered_at','timestamp with time zone',NULL,'YES','none',NULL)
)
SELECT 'public.' || e.table_name || '.' || e.column_name AS object_name,
       CASE WHEN a.column_name IS NULL THEN 'MISSING'
            WHEN a.data_type = e.data_type
             AND a.character_maximum_length IS NOT DISTINCT FROM e.char_length
             AND a.is_nullable = e.nullable
             AND CASE e.default_kind
                   WHEN 'none' THEN a.column_default IS NULL
                   WHEN 'sequence' THEN a.column_default LIKE 'nextval(%'
                     AND pg_get_serial_sequence('public.' || e.table_name, e.column_name) IS NOT NULL
                     AND to_regclass((regexp_match(a.column_default, $$nextval\('([^']+)'::regclass\)$$))[1])::oid
                         = pg_get_serial_sequence('public.' || e.table_name, e.column_name)::regclass::oid
                   WHEN 'now' THEN regexp_replace(lower(coalesce(a.column_default,'')), '[[:space:]()]', '', 'g') = 'now'
                   WHEN 'literal' THEN regexp_replace(
                     regexp_replace(lower(coalesce(a.column_default,'')), '::(jsonb|character varying|varchar|text|integer|bigint)', '', 'g'),
                     '[[:space:]()]', '', 'g') = regexp_replace(lower(e.expected_default), '[[:space:]()]', '', 'g')
                   ELSE false
                 END THEN 'MATCH'
            ELSE 'MISMATCH' END AS result,
       e.data_type AS expected_type, e.char_length AS expected_length,
       e.nullable AS expected_nullable, e.expected_default,
       a.data_type AS actual_type, a.character_maximum_length AS actual_length,
       a.is_nullable AS actual_nullable, a.column_default AS actual_default
FROM expected e
LEFT JOIN information_schema.columns a
  ON a.table_schema='public' AND a.table_name=e.table_name AND a.column_name=e.column_name
ORDER BY e.table_name, e.column_name;

-- 3. Required PK, FK, UNIQUE, and CHECK constraints, compared by structure.
WITH expected(table_name, constraint_name, constraint_type, columns, ref_table, ref_columns, delete_action, check_expr) AS (
  VALUES
    ('anomaly_incidents','anomaly_incidents_pkey','p',ARRAY['incident_id']::text[],NULL::text,NULL::text[],NULL::text,NULL::text),
    ('anomaly_incidents','anomaly_incidents_subject_user_id_fkey','f',ARRAY['subject_user_id']::text[],'users',ARRAY['user_id']::text[],'n',NULL::text),
    ('anomaly_incidents','anomaly_incidents_anomaly_type_check','c',ARRAY['anomaly_type']::text[],NULL::text,NULL::text[],NULL::text,'anomaly_typein(''repeated_failed_logins'',''repeated_admin_access_denied'',''unusual_order_activity'')'),
    ('anomaly_incidents','anomaly_incidents_severity_check','c',ARRAY['severity']::text[],NULL::text,NULL::text[],NULL::text,'severityin(''low'',''medium'',''high'',''critical'')'),
    ('anomaly_incidents','anomaly_incidents_risk_score_check','c',ARRAY['risk_score']::text[],NULL::text,NULL::text[],NULL::text,'risk_score>=0andrisk_score<=100'),
    ('anomaly_incidents','anomaly_incidents_status_check','c',ARRAY['status']::text[],NULL::text,NULL::text[],NULL::text,'statusin(''new'',''investigating'',''resolved'',''false_positive'')'),
    ('anomaly_incident_events','anomaly_incident_events_pkey','p',ARRAY['incident_id','log_id']::text[],NULL::text,NULL::text[],NULL::text,NULL::text),
    ('anomaly_incident_events','anomaly_incident_events_incident_id_fkey','f',ARRAY['incident_id']::text[],'anomaly_incidents',ARRAY['incident_id']::text[],'c',NULL::text),
    ('anomaly_incident_events','anomaly_incident_events_log_id_fkey','f',ARRAY['log_id']::text[],'audit_logs',ARRAY['log_id']::text[],'c',NULL::text),
    ('anomaly_event_queue','anomaly_event_queue_pkey','p',ARRAY['log_id']::text[],NULL::text,NULL::text[],NULL::text,NULL::text),
    ('anomaly_event_queue','anomaly_event_queue_log_id_fkey','f',ARRAY['log_id']::text[],'audit_logs',ARRAY['log_id']::text[],'c',NULL::text),
    ('anomaly_event_queue','anomaly_event_queue_attempts_check','c',ARRAY['attempts']::text[],NULL::text,NULL::text[],NULL::text,'attempts>=0')
), actual AS (
  SELECT c.*,
         ARRAY(SELECT a.attname::text FROM unnest(c.conkey) WITH ORDINALITY k(attnum,ord)
               JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=k.attnum ORDER BY k.ord) AS actual_columns,
         CASE WHEN c.confrelid=0 THEN NULL ELSE (SELECT n.nspname || '.' || r.relname
           FROM pg_class r JOIN pg_namespace n ON n.oid=r.relnamespace WHERE r.oid=c.confrelid) END AS ref_name,
         ARRAY(SELECT a.attname::text FROM unnest(c.confkey) WITH ORDINALITY k(attnum,ord)
               JOIN pg_attribute a ON a.attrelid=c.confrelid AND a.attnum=k.attnum ORDER BY k.ord) AS actual_ref_columns,
         CASE c.confdeltype WHEN 'n' THEN 'n' WHEN 'c' THEN 'c' WHEN 'a' THEN 'a' WHEN 'r' THEN 'r' WHEN 'd' THEN 'd' END AS actual_delete_action,
         regexp_replace(
           replace(regexp_replace(
             regexp_replace(
               regexp_replace(lower(pg_get_constraintdef(c.oid)), '::(character varying|varchar|text)(\[\])?', '', 'g'),
               '[[:space:]()]', '', 'g'), '=anyarray\[', 'in(', 'g'),
             ']', ')'),
           '^check', '') AS normalized_check
  FROM pg_constraint c
)
SELECT 'public.' || e.table_name || '.' || e.constraint_name AS object_name,
       CASE WHEN a.oid IS NULL THEN 'MISSING'
            WHEN a.contype=e.constraint_type AND a.actual_columns=e.columns
             AND (e.constraint_type <> 'f' OR
                  (a.ref_name='public.' || e.ref_table AND a.actual_ref_columns=e.ref_columns AND a.actual_delete_action=e.delete_action))
             AND (e.constraint_type <> 'c' OR a.normalized_check=e.check_expr)
            THEN 'MATCH' ELSE 'MISMATCH' END AS result,
       e.constraint_type AS expected_type, e.columns AS expected_columns,
       e.ref_table AS expected_referenced_table, e.ref_columns AS expected_referenced_columns,
       e.delete_action AS expected_on_delete, e.check_expr AS expected_check,
       a.contype AS actual_type, a.actual_columns, a.ref_name AS actual_referenced_relation,
       a.actual_ref_columns, a.actual_delete_action,
       CASE WHEN a.oid IS NULL THEN NULL ELSE pg_get_constraintdef(a.oid) END AS actual_definition
FROM expected e
LEFT JOIN actual a ON a.conrelid=to_regclass('public.' || e.table_name) AND a.conname=e.constraint_name
ORDER BY e.table_name, e.constraint_name;

-- Report additional constraints on migration-owned tables. Investigate each;
-- unexpected CHECK/UNIQUE/PK/FK constraints can make an otherwise matching
-- schema incompatible with the application or migration.
SELECT n.nspname || '.' || r.relname AS table_name, c.conname AS constraint_name,
       c.contype AS constraint_type, pg_get_constraintdef(c.oid) AS definition,
       'REVIEW_UNEXPECTED_CONSTRAINT' AS result
FROM pg_constraint c
JOIN pg_class r ON r.oid=c.conrelid
JOIN pg_namespace n ON n.oid=r.relnamespace
WHERE n.nspname='public'
  AND r.relname IN ('anomaly_incidents','anomaly_incident_events','anomaly_event_queue')
  AND c.conname NOT IN (
    'anomaly_incidents_pkey','anomaly_incidents_subject_user_id_fkey','anomaly_incidents_anomaly_type_check',
    'anomaly_incidents_severity_check','anomaly_incidents_risk_score_check','anomaly_incidents_status_check',
    'anomaly_incident_events_pkey','anomaly_incident_events_incident_id_fkey','anomaly_incident_events_log_id_fkey',
    'anomaly_event_queue_pkey','anomaly_event_queue_log_id_fkey','anomaly_event_queue_attempts_check'
  )
ORDER BY table_name, constraint_name;

-- 4. Required indexes: key order, direction, null ordering, method, uniqueness,
-- validity, predicate, expressions, and included columns are all checked.
WITH expected(index_name, table_name, is_unique, key_signature, predicate) AS (
  VALUES
    ('anomaly_incidents_active_dedupe_uq','anomaly_incidents',true,ARRAY['deduplication_key:asc:nullslast']::text[], 'statusin(''new'',''investigating'')'::text),
    ('anomaly_incidents_detected_idx','anomaly_incidents',false,ARRAY['detected_at:desc:nullsfirst','incident_id:desc:nullsfirst']::text[],NULL::text),
    ('anomaly_incidents_status_detected_idx','anomaly_incidents',false,ARRAY['status:asc:nullslast','detected_at:desc:nullsfirst']::text[],NULL::text),
    ('anomaly_incident_events_log_idx','anomaly_incident_events',false,ARRAY['log_id:asc:nullslast']::text[],NULL::text),
    ('anomaly_event_queue_pending_idx','anomaly_event_queue',false,ARRAY['available_at:asc:nullslast','log_id:asc:nullslast']::text[],'processed_atisnull'::text)
), actual AS (
  SELECT idx.relname AS index_name, tbl.relname AS table_name, am.amname,
         i.indisunique, i.indisvalid, i.indislive, i.indisready,
         i.indnullsnotdistinct, i.indimmediate,
         (i.indexprs IS NOT NULL) AS has_expression,
         (i.indpred IS NOT NULL) AS has_predicate,
         (i.indnatts <> i.indnkeyatts) AS has_included_columns,
         NOT EXISTS (
           SELECT 1 FROM unnest(i.indclass) WITH ORDINALITY opids(opclass_oid,ord)
           JOIN pg_opclass opc ON opc.oid=opids.opclass_oid
           WHERE opids.ord<=i.indnkeyatts AND NOT opc.opcdefault
         ) AS uses_default_operator_classes,
         NOT EXISTS (
           SELECT 1 FROM unnest(i.indkey) WITH ORDINALITY keys(attnum,ord)
           JOIN pg_attribute a ON a.attrelid=i.indrelid AND a.attnum=keys.attnum AND NOT a.attisdropped
           JOIN unnest(i.indcollation) WITH ORDINALITY collations(collation_oid,ord) ON collations.ord=keys.ord
           WHERE keys.ord<=i.indnkeyatts AND collations.collation_oid<>a.attcollation
         ) AS uses_column_collations,
         ARRAY(SELECT a.attname::text || ':' ||
                      CASE WHEN pg_index_column_has_property(i.indexrelid,k.ord::int,'desc') THEN 'desc' ELSE 'asc' END || ':' ||
                      CASE WHEN pg_index_column_has_property(i.indexrelid,k.ord::int,'nulls_first') THEN 'nullsfirst' ELSE 'nullslast' END
               FROM unnest(i.indkey) WITH ORDINALITY k(attnum,ord)
               JOIN pg_attribute a ON a.attrelid=i.indrelid AND a.attnum=k.attnum AND NOT a.attisdropped
               WHERE k.ord<=i.indnkeyatts ORDER BY k.ord) AS key_signature,
         pg_get_expr(i.indpred,i.indrelid) AS predicate_definition,
         pg_get_indexdef(i.indexrelid) AS definition
  FROM pg_index i
  JOIN pg_class idx ON idx.oid=i.indexrelid
  JOIN pg_class tbl ON tbl.oid=i.indrelid
  JOIN pg_namespace n ON n.oid=tbl.relnamespace
  JOIN pg_am am ON am.oid=idx.relam
  WHERE n.nspname='public'
), normalized AS (
  SELECT actual.*,
    replace(regexp_replace(
      regexp_replace(
        regexp_replace(lower(coalesce(predicate_definition,'')), '::(character varying|varchar|text)(\[\])?', '', 'g'),
        '[[:space:]()]', '', 'g'), '=anyarray\[', 'in(', 'g'),
      ']', ')') AS normalized_predicate
  FROM actual
)
SELECT 'public.' || e.index_name AS object_name,
       CASE WHEN a.index_name IS NULL THEN 'MISSING'
            WHEN a.table_name=e.table_name AND a.amname='btree' AND a.indisunique=e.is_unique
             AND a.indisvalid AND a.indislive AND a.indisready
             AND NOT a.indnullsnotdistinct AND a.indimmediate
             AND NOT a.has_expression AND NOT a.has_included_columns
             AND a.uses_default_operator_classes AND a.uses_column_collations
             AND a.key_signature=e.key_signature
             AND ((e.predicate IS NULL AND NOT a.has_predicate) OR
                  (e.predicate IS NOT NULL AND a.has_predicate AND
                   replace(a.normalized_predicate,']',')')=e.predicate))
            THEN 'MATCH' ELSE 'MISMATCH' END AS result,
       e.table_name AS expected_table, e.is_unique AS expected_unique,
       e.key_signature AS expected_key_signature, e.predicate AS expected_predicate,
       a.table_name AS actual_table, a.amname AS actual_method, a.indisunique AS actual_unique,
       a.indnullsnotdistinct AS actual_nulls_not_distinct, a.indimmediate AS actual_immediate,
       a.uses_default_operator_classes, a.uses_column_collations,
       a.key_signature AS actual_key_signature, a.predicate_definition AS actual_predicate,
       a.definition AS actual_definition
FROM expected e
LEFT JOIN normalized a ON a.index_name=e.index_name
ORDER BY e.index_name;

-- Extra unique indexes can reject writes and are therefore compatibility risks.
-- Extra non-unique indexes are reported as informational.
SELECT n.nspname || '.' || tbl.relname AS table_name, idx.relname AS index_name,
       i.indisunique AS is_unique, pg_get_indexdef(i.indexrelid) AS definition,
       CASE WHEN i.indisunique THEN 'REVIEW_EXTRA_UNIQUE_INDEX' ELSE 'INFO_EXTRA_NONUNIQUE_INDEX' END AS result
FROM pg_index i
JOIN pg_class idx ON idx.oid=i.indexrelid
JOIN pg_class tbl ON tbl.oid=i.indrelid
JOIN pg_namespace n ON n.oid=tbl.relnamespace
WHERE n.nspname='public'
  AND tbl.relname IN ('anomaly_incidents','anomaly_incident_events','anomaly_event_queue')
  AND idx.relname NOT IN (
    'anomaly_incidents_active_dedupe_uq','anomaly_incidents_detected_idx',
    'anomaly_incidents_status_detected_idx','anomaly_incident_events_log_idx','anomaly_event_queue_pending_idx',
    'anomaly_incidents_pkey','anomaly_incident_events_pkey','anomaly_event_queue_pkey'
  )
ORDER BY table_name, index_name;

-- 5. Trigger and trigger function. The trigger must be enabled AFTER INSERT,
-- row-level, on public.audit_logs and bound to the expected public PL/pgSQL
-- trigger function. The function body is compared after whitespace folding.
WITH binding AS (
  SELECT tg.oid AS trigger_oid, tg.tgtype, tg.tgenabled,
         pg_get_triggerdef(tg.oid) AS trigger_definition,
         tg.tgqual IS NULL AS has_no_when_condition, tg.tgnargs=0 AS has_no_arguments,
         fn_ns.nspname AS function_schema, p.proname AS function_name,
         l.lanname AS function_language, p.prorettype::regtype::text AS function_return_type,
         NOT p.prosecdef AS security_invoker, NOT p.proisstrict AS not_strict,
         p.provolatile='v' AS volatile_function, p.proparallel='u' AS parallel_unsafe,
         p.proconfig IS NULL AS no_custom_function_settings,
         p.prosrc AS function_body, pg_get_functiondef(p.oid) AS function_definition
  FROM pg_trigger tg
  JOIN pg_class r ON r.oid=tg.tgrelid
  JOIN pg_namespace n ON n.oid=r.relnamespace
  JOIN pg_proc p ON p.oid=tg.tgfoid
  JOIN pg_namespace fn_ns ON fn_ns.oid=p.pronamespace
  JOIN pg_language l ON l.oid=p.prolang
  WHERE n.nspname='public' AND r.relname='audit_logs'
    AND tg.tgname='audit_logs_enqueue_anomaly_event' AND NOT tg.tgisinternal
)
SELECT 'public.audit_logs.audit_logs_enqueue_anomaly_event' AS object_name,
       CASE WHEN trigger_oid IS NULL THEN 'MISSING'
            WHEN tgtype=5 AND tgenabled IN ('O','A') AND has_no_when_condition AND has_no_arguments
             AND function_schema='public' AND function_name='enqueue_anomaly_audit_event'
             AND function_language='plpgsql' AND function_return_type='trigger'
             AND security_invoker AND not_strict AND volatile_function AND parallel_unsafe AND no_custom_function_settings
             AND regexp_replace(lower(function_body),'[[:space:]]','','g') =
               'begininsertintopublic.anomaly_event_queue(log_id)values(new.log_id)onconflict(log_id)donothing;returnnew;end;'
            THEN 'MATCH' ELSE 'MISMATCH' END AS result,
       trigger_definition, has_no_when_condition, has_no_arguments,
       function_schema, function_name, function_language, function_return_type,
       security_invoker, not_strict, volatile_function, parallel_unsafe, no_custom_function_settings,
       function_body, function_definition
FROM (SELECT 1) seed
LEFT JOIN binding ON true;

-- 6. Extra user-created triggers on audit_logs require review because they can
-- change future event processing independently of these migrations.
SELECT tg.tgname AS trigger_name, pg_get_triggerdef(tg.oid) AS definition,
       'REVIEW_EXTRA_TRIGGER' AS result
FROM pg_trigger tg
JOIN pg_class r ON r.oid=tg.tgrelid
JOIN pg_namespace n ON n.oid=r.relnamespace
WHERE n.nspname='public' AND r.relname='audit_logs' AND NOT tg.tgisinternal
  AND tg.tgname <> 'audit_logs_enqueue_anomaly_event'
ORDER BY tg.tgname;

-- 7. Apply decision summary. A migration is safe to consider only when its
-- result is ABSENT_CAN_APPLY (after backup and base-dependency checks), or when
-- every object is present and all detailed rows above say MATCH with no REVIEW.
WITH anomaly_relations AS (
  SELECT count(*) FILTER (WHERE to_regclass('public.' || name) IS NOT NULL)::int AS present
  FROM (VALUES ('anomaly_incidents'),('anomaly_incident_events'),('anomaly_event_queue')) v(name)
), anomaly_constraints AS (
  SELECT count(*)::int AS present
  FROM pg_constraint c JOIN pg_class r ON r.oid=c.conrelid JOIN pg_namespace n ON n.oid=r.relnamespace
  WHERE n.nspname='public' AND c.conname IN (
    'anomaly_incidents_pkey','anomaly_incidents_subject_user_id_fkey','anomaly_incidents_anomaly_type_check',
    'anomaly_incidents_severity_check','anomaly_incidents_risk_score_check','anomaly_incidents_status_check',
    'anomaly_incident_events_pkey','anomaly_incident_events_incident_id_fkey','anomaly_incident_events_log_id_fkey',
    'anomaly_event_queue_pkey','anomaly_event_queue_log_id_fkey','anomaly_event_queue_attempts_check'
  )
), anomaly_indexes AS (
  SELECT count(*)::int AS present FROM (VALUES
    ('anomaly_incidents_active_dedupe_uq'),('anomaly_incidents_detected_idx'),
    ('anomaly_incidents_status_detected_idx'),('anomaly_incident_events_log_idx'),('anomaly_event_queue_pending_idx')
  ) v(name) WHERE to_regclass('public.' || name) IS NOT NULL
), anomaly_binding AS (
  SELECT EXISTS (
    SELECT 1 FROM pg_trigger tg
    JOIN pg_class r ON r.oid=tg.tgrelid JOIN pg_namespace n ON n.oid=r.relnamespace
    JOIN pg_proc p ON p.oid=tg.tgfoid JOIN pg_namespace fn ON fn.oid=p.pronamespace
    JOIN pg_language l ON l.oid=p.prolang
    WHERE n.nspname='public' AND r.relname='audit_logs' AND tg.tgname='audit_logs_enqueue_anomaly_event'
      AND NOT tg.tgisinternal AND tg.tgtype=5 AND tg.tgenabled IN ('O','A') AND tg.tgqual IS NULL AND tg.tgnargs=0
      AND fn.nspname='public' AND p.proname='enqueue_anomaly_audit_event'
      AND p.prorettype='pg_catalog.trigger'::regtype AND l.lanname='plpgsql'
      AND NOT p.prosecdef AND NOT p.proisstrict AND p.provolatile='v' AND p.proparallel='u' AND p.proconfig IS NULL
      AND regexp_replace(lower(p.prosrc),'[[:space:]]','','g') =
        'begininsertintopublic.anomaly_event_queue(log_id)values(new.log_id)onconflict(log_id)donothing;returnnew;end;'
  ) AS compatible,
  EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='enqueue_anomaly_audit_event') AS function_exists,
  EXISTS (SELECT 1 FROM pg_trigger tg JOIN pg_class r ON r.oid=tg.tgrelid JOIN pg_namespace n ON n.oid=r.relnamespace WHERE n.nspname='public' AND r.relname='audit_logs' AND tg.tgname='audit_logs_enqueue_anomaly_event' AND NOT tg.tgisinternal) AS trigger_exists
), dead_letter_columns AS (
  SELECT count(*)::int AS present FROM information_schema.columns
  WHERE table_schema='public' AND table_name='anomaly_event_queue'
    AND column_name IN ('last_error','dead_lettered_at')
)
SELECT '004_anomaly_incidents.sql' AS migration,
       CASE WHEN to_regclass('public.users') IS NULL OR to_regclass('public.audit_logs') IS NULL
              THEN 'BLOCKED_MISSING_BASE_DEPENDENCY'
            WHEN r.present=0 AND c.present=0 AND i.present=0 AND NOT b.function_exists AND NOT b.trigger_exists
              THEN 'ABSENT_CAN_APPLY_AFTER_BACKUP'
            WHEN r.present=3 AND c.present=12 AND i.present=5 AND b.compatible
              THEN 'PRESENT_CHECK_ALL_DETAIL_ROWS_AND_REVIEWS'
            ELSE 'PARTIAL_STOP' END AS result,
       r.present AS anomaly_tables_present, c.present AS named_constraints_present,
       i.present AS expected_indexes_present, b.trigger_exists, b.function_exists, b.compatible AS trigger_function_compatible,
       to_regclass('public.users') IS NOT NULL AS users_dependency_present,
       to_regclass('public.audit_logs') IS NOT NULL AS audit_logs_dependency_present
FROM anomaly_relations r CROSS JOIN anomaly_constraints c CROSS JOIN anomaly_indexes i CROSS JOIN anomaly_binding b
UNION ALL
SELECT '005_anomaly_queue_dead_letter.sql',
       CASE WHEN to_regclass('public.anomaly_event_queue') IS NULL THEN 'BLOCKED_MISSING_MIGRATION_004_QUEUE'
            WHEN d.present=0 THEN 'ABSENT_CAN_APPLY_AFTER_004'
            WHEN d.present=2 THEN 'PRESENT_CHECK_COLUMN_DETAIL_ROWS'
            ELSE 'PARTIAL_STOP' END,
       NULL::integer,NULL::integer,NULL::integer,NULL::boolean,NULL::boolean,NULL::boolean,
       NULL::boolean,NULL::boolean
FROM dead_letter_columns d;
