import { describe, expect, it } from 'vitest';
import type { PoolClient } from 'pg';
import {
  applyMigrations,
  assertMigrationCopyTargetDatabase,
  assertMigrationMainTargetDatabase,
  assertMigrationTargetDatabase,
  assessLegacyMigration,
  diagnoseLegacyMigration,
  type LegacyColumn,
  type LegacyConstraint,
  type LegacyIndex,
  type LegacySchemaSnapshot,
  type MigrationFile,
} from '../src/migrations.js';

describe('migration target guard', () => {
  it('allows only the exact active IPv4 market_db session for the main runner', async () => {
    const queries: string[] = [];
    const client = {
      async query(sql: string) {
        queries.push(sql);
        return { rows: [{ database_name: 'market_db', server_address: '127.0.0.1', server_port: 5432 }] };
      },
    } as unknown as Pick<PoolClient, 'query'>;

    await expect(assertMigrationMainTargetDatabase(client)).resolves.toBeUndefined();
    expect(queries).toHaveLength(1);
    expect(queries[0]).toContain('current_database()');
    expect(queries[0]).toContain('inet_server_addr()');
    expect(queries[0]).toContain('inet_server_port()');
  });

  it('accepts PostgreSQL inet text for IPv4 loopback with its /32 host mask', async () => {
    const client = {
      async query() {
        return { rows: [{ database_name: 'market_db', server_address: '127.0.0.1/32', server_port: 5432 }] };
      },
    } as unknown as Pick<PoolClient, 'query'>;

    await expect(assertMigrationMainTargetDatabase(client)).resolves.toBeUndefined();
  });

  it.each([
    ['market_db_test', '127.0.0.1', 5432],
    ['market_db_migration_test', '127.0.0.1', 5432],
    ['market_db', '127.0.0.2', 5432],
    ['market_db', '::1', 5432],
    ['market_db', '192.0.2.10', 5432],
    ['market_db', '127.0.0.1', 5433],
  ])('rejects active session database=%s address=%s port=%s', async (databaseName, serverAddress, serverPort) => {
    const queries: string[] = [];
    const client = {
      async query(sql: string) {
        queries.push(sql);
        return { rows: [{ database_name: databaseName, server_address: serverAddress, server_port: serverPort }] };
      },
    } as unknown as Pick<PoolClient, 'query'>;

    await expect(assertMigrationMainTargetDatabase(client)).rejects.toThrow(/No migrations were run/);
    expect(queries).toHaveLength(1);
  });

  it('allows the designated test database using the active connection identity', async () => {
    const queries: string[] = [];
    const client = {
      async query(sql: string) {
        queries.push(sql);
        return { rows: [{ database_name: 'market_db_test' }] };
      },
    } as unknown as Pick<PoolClient, 'query'>;

    await expect(assertMigrationTargetDatabase(client)).resolves.toBeUndefined();
    expect(queries).toEqual(['SELECT current_database() AS database_name']);
  });

  it('rejects every other database before any migration statement can run', async () => {
    const queries: string[] = [];
    const client = {
      async query(sql: string) {
        queries.push(sql);
        return { rows: [{ database_name: 'market_db' }] };
      },
    } as unknown as Pick<PoolClient, 'query'>;

    await expect(assertMigrationTargetDatabase(client))
      .rejects.toThrow('Refusing to run migrations: expected database "market_db_test", connected database is "market_db". No migrations were run.');
    expect(queries).toEqual(['SELECT current_database() AS database_name']);
  });

  it.each([
    ['the restored migration copy', 'market_db_migration_test', '127.0.0.1', 5432, true],
    ['the IPv4 loopback address with a host mask', 'market_db_migration_test', '127.0.0.1/32', 5432, true],
    ['the primary database', 'market_db', '127.0.0.1', 5432, false],
    ['the integration-test database', 'market_db_test', '127.0.0.1', 5432, false],
    ['a remote server address', 'market_db_migration_test', '192.0.2.10', 5432, false],
    ['a different IPv4 loopback-range address', 'market_db_migration_test', '127.0.0.2/32', 5432, false],
    ['a broader IPv4 network address', 'market_db_migration_test', '127.0.0.1/24', 5432, false],
    ['an IPv6 loopback address not explicitly enabled', 'market_db_migration_test', '::1', 5432, false],
    ['the wrong server port', 'market_db_migration_test', '127.0.0.1', 5433, false],
    ['a socket without a TCP server address', 'market_db_migration_test', null, 5432, false],
  ])('migration-copy guard %s checks database, server address, and port', async (_label, databaseName, serverAddress, serverPort, allowed) => {
    const queries: string[] = [];
    const client = {
      async query(sql: string) {
        queries.push(sql);
        return { rows: [{ database_name: databaseName, server_address: serverAddress, server_port: serverPort }] };
      },
    } as unknown as Pick<PoolClient, 'query'>;

    if (allowed) await expect(assertMigrationCopyTargetDatabase(client)).resolves.toBeUndefined();
    else await expect(assertMigrationCopyTargetDatabase(client)).rejects.toThrow(/No migrations were run/);
    expect(queries).toHaveLength(1);
    expect(queries[0]).toContain('current_database()');
    expect(queries[0]).toContain('inet_server_addr()');
    expect(queries[0]).toContain('inet_server_port()');
  });

  it('reports only the active identity fields when an identity value has an unexpected driver type', async () => {
    const client = {
      async query() {
        return { rows: [{
          database_name: 'market_db_migration_test',
          server_address: '127.0.0.1',
          server_port: '5432',
        }] };
      },
    } as unknown as Pick<PoolClient, 'query'>;

    await expect(assertMigrationCopyTargetDatabase(client)).rejects.toThrow(
      'active identity database="market_db_migration_test", server_address="127.0.0.1", server_port="5432"',
    );
  });
});

const files: MigrationFile[] = [
  { name: '001_auth.sql', sql: '-- SQL 001' },
  { name: '002_order_delivery.sql', sql: '-- SQL 002' },
  { name: '003_audit_logs.sql', sql: '-- SQL 003' },
  { name: '004_anomaly_incidents.sql', sql: '-- SQL 004' },
  { name: '005_anomaly_queue_dead_letter.sql', sql: '-- SQL 005' },
  { name: '006_jeffreys_shadow_mode.sql', sql: '-- SQL 006' },
  { name: '007_replenishment_history.sql', sql: '-- SQL 007' },
];

function column(table: string, name: string, data_type: string, nullable: 'YES' | 'NO', default_value: string | null, max_length: number | null = null, numeric_precision: number | null = null, numeric_scale: number | null = null): LegacyColumn {
  return { table, name, data_type, max_length, numeric_precision, numeric_scale, nullable, default_value,
    is_identity: 'NO', identity_generation: '', is_generated: 'NEVER', generation_expression: null };
}

function constraint(input: Partial<LegacyConstraint> & Pick<LegacyConstraint, 'table' | 'name' | 'type' | 'columns'>): LegacyConstraint {
  return {
    referenced_schema: null, referenced_table: null, referenced_columns: [], on_delete: null, definition: '',
    on_update: 'a', match_type: 's', validated: true, enforced: true, period: false,
    deferrable: false, deferred: false, no_inherit: false,
    ...input,
  };
}

function index(table: string, name: string, columns: LegacyIndex['columns']): LegacyIndex {
  return {
    schema: 'public', table, name, constraint_name: null, access_method: 'btree', is_unique: false,
    nulls_not_distinct: false, is_immediate: true,
    is_valid: true, is_ready: true, is_live: true,
    has_expression: false, has_predicate: false, has_included_columns: false,
    columns: columns.map((entry) => ({ ...entry, operator_class_is_default: true, collation_matches_column: true })),
  };
}

function originalMarketplaceColumns(): LegacyColumn[] {
  return [
    column('users', 'user_id', 'integer', 'NO', "nextval('users_user_id_seq'::regclass)"),
    column('users', 'name', 'character varying', 'NO', null, 100),
    column('users', 'email', 'character varying', 'NO', null, 150),
    column('users', 'phone', 'character varying', 'NO', null, 20),
    column('users', 'address', 'character varying', 'YES', null, 255),
    column('orders', 'order_id', 'integer', 'NO', "nextval('orders_order_id_seq'::regclass)"),
    column('orders', 'user_id', 'integer', 'NO', null),
    column('orders', 'order_date', 'timestamp without time zone', 'NO', null),
    column('orders', 'status', 'character varying', 'NO', null, 30),
    column('orders', 'total_amount', 'numeric', 'NO', null, null, 10, 2),
  ];
}

function completeSnapshot(): LegacySchemaSnapshot {
  const columns = [
    ...originalMarketplaceColumns(),
    column('users', 'password_hash', 'text', 'YES', null),
    column('users', 'role', 'character varying', 'NO', "'user'::character varying", 20),
    column('user_sessions', 'session_id', 'bigint', 'NO', "nextval('user_sessions_session_id_seq'::regclass)"),
    column('user_sessions', 'user_id', 'integer', 'NO', null),
    column('user_sessions', 'token_hash', 'character', 'NO', null, 64),
    column('user_sessions', 'expires_at', 'timestamp with time zone', 'NO', null),
    column('user_sessions', 'created_at', 'timestamp with time zone', 'NO', 'now()'),
    column('orders', 'recipient_name', 'character varying', 'YES', null, 100),
    column('orders', 'recipient_phone', 'character varying', 'YES', null, 20),
    column('orders', 'delivery_city', 'character varying', 'YES', null, 100),
    column('orders', 'delivery_address', 'character varying', 'YES', null, 255),
    column('audit_logs', 'log_id', 'bigint', 'NO', "nextval('audit_logs_log_id_seq'::regclass)"),
    column('audit_logs', 'user_id', 'integer', 'YES', null),
    column('audit_logs', 'action', 'character varying', 'NO', null, 64),
    column('audit_logs', 'entity_type', 'character varying', 'YES', null, 32),
    column('audit_logs', 'entity_id', 'integer', 'YES', null),
    column('audit_logs', 'status', 'character varying', 'NO', null, 16),
    column('audit_logs', 'details', 'jsonb', 'NO', "'{}'::jsonb"),
    column('audit_logs', 'ip_address', 'inet', 'YES', null),
    column('audit_logs', 'created_at', 'timestamp with time zone', 'NO', 'now()'),
    column('anomaly_incidents', 'incident_id', 'bigint', 'NO', "nextval('anomaly_incidents_incident_id_seq'::regclass)"),
    column('anomaly_incidents', 'anomaly_type', 'character varying', 'NO', null, 64),
    column('anomaly_incidents', 'subject_user_id', 'integer', 'YES', null),
    column('anomaly_incidents', 'severity', 'character varying', 'NO', null, 16),
    column('anomaly_incidents', 'risk_score', 'integer', 'NO', null),
    column('anomaly_incidents', 'status', 'character varying', 'NO', "'NEW'::character varying", 20),
    column('anomaly_incidents', 'detected_at', 'timestamp with time zone', 'NO', 'now()'),
    column('anomaly_incidents', 'updated_at', 'timestamp with time zone', 'NO', 'now()'),
    column('anomaly_incidents', 'first_event_at', 'timestamp with time zone', 'NO', null),
    column('anomaly_incidents', 'last_event_at', 'timestamp with time zone', 'NO', null),
    column('anomaly_incidents', 'evidence', 'jsonb', 'NO', "'{}'::jsonb"),
    column('anomaly_incidents', 'explanation', 'text', 'NO', null),
    column('anomaly_incidents', 'recommendations', 'jsonb', 'NO', "'[]'::jsonb"),
    column('anomaly_incidents', 'deduplication_key', 'character varying', 'NO', null, 160),
    column('anomaly_incident_events', 'incident_id', 'bigint', 'NO', null),
    column('anomaly_incident_events', 'log_id', 'bigint', 'NO', null),
    column('anomaly_incident_events', 'linked_at', 'timestamp with time zone', 'NO', 'now()'),
    column('anomaly_event_queue', 'log_id', 'bigint', 'NO', null),
    column('anomaly_event_queue', 'queued_at', 'timestamp with time zone', 'NO', 'now()'),
    column('anomaly_event_queue', 'attempts', 'integer', 'NO', '0'),
    column('anomaly_event_queue', 'available_at', 'timestamp with time zone', 'NO', 'now()'),
    column('anomaly_event_queue', 'processed_at', 'timestamp with time zone', 'YES', null),
    column('anomaly_event_queue', 'last_error', 'text', 'YES', null),
    column('anomaly_event_queue', 'dead_lettered_at', 'timestamp with time zone', 'YES', null),
    column('jeffreys_shadow_checkpoint', 'singleton_id', 'smallint', 'NO', '1'),
    column('jeffreys_shadow_checkpoint', 'profile_version', 'character varying', 'NO', null, 64),
    column('jeffreys_shadow_checkpoint', 'configuration_signature', 'text', 'NO', null),
    column('jeffreys_shadow_checkpoint', 'next_evaluation_at', 'timestamp with time zone', 'NO', null),
    column('jeffreys_shadow_checkpoint', 'last_subject_user_id', 'integer', 'YES', null),
    column('jeffreys_shadow_checkpoint', 'verification_pass', 'boolean', 'NO', 'false'),
    column('jeffreys_shadow_checkpoint', 'updated_at', 'timestamp with time zone', 'NO', 'now()'),
    column('jeffreys_shadow_evaluations', 'evaluation_id', 'bigint', 'NO', "nextval('jeffreys_shadow_evaluations_evaluation_id_seq'::regclass)"),
    column('jeffreys_shadow_evaluations', 'profile_version', 'character varying', 'NO', null, 64),
    column('jeffreys_shadow_evaluations', 'subject_user_id', 'integer', 'NO', null),
    column('jeffreys_shadow_evaluations', 'evaluated_at', 'timestamp with time zone', 'NO', null),
    column('jeffreys_shadow_evaluations', 'baseline_start_at', 'timestamp with time zone', 'NO', null),
    column('jeffreys_shadow_evaluations', 'baseline_end_at', 'timestamp with time zone', 'NO', null),
    column('jeffreys_shadow_evaluations', 'current_start_at', 'timestamp with time zone', 'NO', null),
    column('jeffreys_shadow_evaluations', 'current_end_at', 'timestamp with time zone', 'NO', null),
    column('jeffreys_shadow_evaluations', 'baseline_observations', 'bigint', 'YES', null),
    column('jeffreys_shadow_evaluations', 'current_observations', 'bigint', 'YES', null),
    column('jeffreys_shadow_evaluations', 'baseline_distribution', 'jsonb', 'YES', null),
    column('jeffreys_shadow_evaluations', 'current_distribution', 'jsonb', 'YES', null),
    column('jeffreys_shadow_evaluations', 'divergence', 'double precision', 'YES', null),
    column('jeffreys_shadow_evaluations', 'category_contributions', 'jsonb', 'YES', null),
    column('jeffreys_shadow_evaluations', 'evaluation_status', 'character varying', 'NO', null, 32),
    column('jeffreys_shadow_evaluations', 'sample_counts_capped', 'boolean', 'NO', 'false'),
    column('jeffreys_shadow_evaluations', 'profile_config', 'jsonb', 'NO', null),
    column('jeffreys_shadow_evaluations', 'recorded_at', 'timestamp with time zone', 'NO', 'now()'),
  ];
  const constraints = [
    constraint({ table: 'users', name: 'users_role_check', type: 'c', columns: ['role'], definition: "CHECK (((role)::character varying)::text = ANY ((ARRAY['user'::character varying, 'admin'::character varying])::text[]))" }),
    constraint({ table: 'user_sessions', name: 'user_sessions_pkey', type: 'p', columns: ['session_id'] }),
    constraint({ table: 'user_sessions', name: 'user_sessions_token_hash_key', type: 'u', columns: ['token_hash'] }),
    constraint({ table: 'user_sessions', name: 'user_sessions_user_id_fkey', type: 'f', columns: ['user_id'], referenced_schema: 'public', referenced_table: 'users', referenced_columns: ['user_id'], on_delete: 'c' }),
    constraint({ table: 'audit_logs', name: 'audit_logs_pkey', type: 'p', columns: ['log_id'] }),
    constraint({ table: 'audit_logs', name: 'audit_logs_status_check', type: 'c', columns: ['status'], definition: "CHECK (((status)::character varying)::text = ANY ((ARRAY['SUCCESS'::character varying, 'FAILURE'::character varying])::text[]))" }),
    constraint({ table: 'audit_logs', name: 'audit_logs_user_id_fkey', type: 'f', columns: ['user_id'], referenced_schema: 'public', referenced_table: 'users', referenced_columns: ['user_id'], on_delete: 'n' }),
    constraint({ table: 'anomaly_incidents', name: 'anomaly_incidents_pkey', type: 'p', columns: ['incident_id'] }),
    constraint({ table: 'anomaly_incidents', name: 'anomaly_incidents_subject_user_id_fkey', type: 'f', columns: ['subject_user_id'], referenced_schema: 'public', referenced_table: 'users', referenced_columns: ['user_id'], on_delete: 'n' }),
    constraint({ table: 'anomaly_incidents', name: 'anomaly_incidents_anomaly_type_check', type: 'c', columns: ['anomaly_type'], definition: "CHECK (anomaly_type IN ('REPEATED_FAILED_LOGINS', 'REPEATED_ADMIN_ACCESS_DENIED', 'UNUSUAL_ORDER_ACTIVITY'))" }),
    constraint({ table: 'anomaly_incidents', name: 'anomaly_incidents_severity_check', type: 'c', columns: ['severity'], definition: "CHECK (severity IN ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL'))" }),
    constraint({ table: 'anomaly_incidents', name: 'anomaly_incidents_risk_score_check', type: 'c', columns: ['risk_score'], definition: 'CHECK (risk_score >= 0 AND risk_score <= 100)' }),
    constraint({ table: 'anomaly_incidents', name: 'anomaly_incidents_status_check', type: 'c', columns: ['status'], definition: "CHECK (status IN ('NEW', 'INVESTIGATING', 'RESOLVED', 'FALSE_POSITIVE'))" }),
    constraint({ table: 'anomaly_incident_events', name: 'anomaly_incident_events_pkey', type: 'p', columns: ['incident_id', 'log_id'] }),
    constraint({ table: 'anomaly_incident_events', name: 'anomaly_incident_events_incident_id_fkey', type: 'f', columns: ['incident_id'], referenced_schema: 'public', referenced_table: 'anomaly_incidents', referenced_columns: ['incident_id'], on_delete: 'c' }),
    constraint({ table: 'anomaly_incident_events', name: 'anomaly_incident_events_log_id_fkey', type: 'f', columns: ['log_id'], referenced_schema: 'public', referenced_table: 'audit_logs', referenced_columns: ['log_id'], on_delete: 'c' }),
    constraint({ table: 'anomaly_event_queue', name: 'anomaly_event_queue_pkey', type: 'p', columns: ['log_id'] }),
    constraint({ table: 'anomaly_event_queue', name: 'anomaly_event_queue_log_id_fkey', type: 'f', columns: ['log_id'], referenced_schema: 'public', referenced_table: 'audit_logs', referenced_columns: ['log_id'], on_delete: 'c' }),
    constraint({ table: 'anomaly_event_queue', name: 'anomaly_event_queue_attempts_check', type: 'c', columns: ['attempts'], definition: 'CHECK (attempts >= 0)' }),
    constraint({ table: 'jeffreys_shadow_checkpoint', name: 'jeffreys_shadow_checkpoint_pkey', type: 'p', columns: ['singleton_id'] }),
    constraint({ table: 'jeffreys_shadow_checkpoint', name: 'jeffreys_shadow_checkpoint_singleton_id_check', type: 'c', columns: ['singleton_id'], definition: 'CHECK (singleton_id = 1)' }),
    constraint({ table: 'jeffreys_shadow_evaluations', name: 'jeffreys_shadow_evaluations_pkey', type: 'p', columns: ['evaluation_id'] }),
    constraint({ table: 'jeffreys_shadow_evaluations', name: 'jeffreys_shadow_eval_window_uq', type: 'u', columns: ['profile_version', 'subject_user_id', 'evaluated_at'] }),
    constraint({ table: 'jeffreys_shadow_evaluations', name: 'jeffreys_shadow_eval_baseline_count_check', type: 'c', columns: ['baseline_observations'], definition: 'CHECK (baseline_observations IS NULL OR baseline_observations >= 0)' }),
    constraint({ table: 'jeffreys_shadow_evaluations', name: 'jeffreys_shadow_eval_current_count_check', type: 'c', columns: ['current_observations'], definition: 'CHECK (current_observations IS NULL OR current_observations >= 0)' }),
    constraint({ table: 'jeffreys_shadow_evaluations', name: 'jeffreys_shadow_evaluations_evaluation_status_check', type: 'c', columns: ['evaluation_status'], definition: "CHECK (evaluation_status IN ('SUFFICIENT_DATA', 'INSUFFICIENT_DATA', 'WORK_LIMIT_EXCEEDED', 'EVALUATION_ERROR'))" }),
  ];
  const indexes = [
    index('user_sessions', 'user_sessions_expiry_idx', [{ name: 'expires_at', descending: false, nulls_first: false }]),
    index('audit_logs', 'audit_logs_created_idx', [{ name: 'created_at', descending: true, nulls_first: true }, { name: 'log_id', descending: true, nulls_first: true }]),
    index('audit_logs', 'audit_logs_user_created_idx', [{ name: 'user_id', descending: false, nulls_first: false }, { name: 'created_at', descending: true, nulls_first: true }]),
    index('audit_logs', 'audit_logs_action_created_idx', [{ name: 'action', descending: false, nulls_first: false }, { name: 'created_at', descending: true, nulls_first: true }]),
    index('audit_logs', 'audit_logs_status_created_idx', [{ name: 'status', descending: false, nulls_first: false }, { name: 'created_at', descending: true, nulls_first: true }]),
    index('anomaly_incidents', 'anomaly_incidents_active_dedupe_uq', [{ name: 'deduplication_key', descending: false, nulls_first: false }]),
    index('anomaly_incidents', 'anomaly_incidents_detected_idx', [{ name: 'detected_at', descending: true, nulls_first: true }, { name: 'incident_id', descending: true, nulls_first: true }]),
    index('anomaly_incidents', 'anomaly_incidents_status_detected_idx', [{ name: 'status', descending: false, nulls_first: false }, { name: 'detected_at', descending: true, nulls_first: true }]),
    index('anomaly_incident_events', 'anomaly_incident_events_log_idx', [{ name: 'log_id', descending: false, nulls_first: false }]),
    index('anomaly_event_queue', 'anomaly_event_queue_pending_idx', [{ name: 'available_at', descending: false, nulls_first: false }, { name: 'log_id', descending: false, nulls_first: false }]),
  ];
  columns.push(
    column('replenishment_runs', 'run_id', 'bigint', 'NO', 'nextval(\'replenishment_runs_run_id_seq\'::regclass)'),
    column('replenishment_runs', 'source', 'character varying', 'NO', null, 16),
    column('replenishment_runs', 'model_name', 'character varying', 'NO', null, 128),
    column('replenishment_runs', 'model_version', 'character varying', 'YES', null, 64),
    column('replenishment_runs', 'forecast_start', 'date', 'NO', null), column('replenishment_runs', 'forecast_end', 'date', 'NO', null),
    column('replenishment_runs', 'review_period_days', 'integer', 'NO', null), column('replenishment_runs', 'metadata_snapshot', 'jsonb', 'NO', null),
    column('replenishment_runs', 'created_at', 'timestamp with time zone', 'NO', 'now()'), column('replenishment_runs', 'created_by_user_id', 'integer', 'YES', null),
    column('replenishment_recommendations', 'recommendation_id', 'bigint', 'NO', 'nextval(\'replenishment_recommendations_recommendation_id_seq\'::regclass)'),
    column('replenishment_recommendations', 'run_id', 'bigint', 'NO', null), column('replenishment_recommendations', 'recommendation_index', 'integer', 'NO', null),
    column('replenishment_recommendations', 'synthetic_product_id', 'character varying', 'NO', null, 64),
    column('replenishment_recommendations', 'synthetic_supplier_id', 'character varying', 'NO', null, 64),
    column('replenishment_recommendations', 'supplier_name', 'character varying', 'NO', null, 150),
    column('replenishment_recommendations', 'recommendation_snapshot', 'jsonb', 'NO', null),
    column('replenishment_recommendations', 'created_at', 'timestamp with time zone', 'NO', 'now()'),
    column('replenishment_decisions', 'decision_id', 'bigint', 'NO', 'nextval(\'replenishment_decisions_decision_id_seq\'::regclass)'),
    column('replenishment_decisions', 'recommendation_id', 'bigint', 'NO', null), column('replenishment_decisions', 'decision', 'character varying', 'NO', null, 10),
    column('replenishment_decisions', 'decided_at', 'timestamp with time zone', 'NO', 'now()'),
    column('replenishment_decisions', 'decided_by_user_id', 'integer', 'YES', null),
  );
  constraints.push(
    constraint({ table: 'replenishment_runs', name: 'replenishment_runs_pkey', type: 'p', columns: ['run_id'] }),
    constraint({ table: 'replenishment_runs', name: 'replenishment_runs_source_check', type: 'c', columns: ['source'], definition: "CHECK (source = 'SYNTHETIC')" }),
    constraint({ table: 'replenishment_runs', name: 'replenishment_runs_review_period_days_check', type: 'c', columns: ['review_period_days'], definition: 'CHECK (review_period_days >= 0)' }),
    constraint({ table: 'replenishment_runs', name: 'replenishment_runs_forecast_period_check', type: 'c', columns: ['forecast_start', 'forecast_end'], definition: 'CHECK (forecast_start <= forecast_end)' }),
    constraint({ table: 'replenishment_runs', name: 'replenishment_runs_created_by_user_id_fkey', type: 'f', columns: ['created_by_user_id'], referenced_schema: 'public', referenced_table: 'users', referenced_columns: ['user_id'], on_delete: 'n' }),
    constraint({ table: 'replenishment_recommendations', name: 'replenishment_recommendations_pkey', type: 'p', columns: ['recommendation_id'] }),
    constraint({ table: 'replenishment_recommendations', name: 'replenishment_recommendations_run_id_fkey', type: 'f', columns: ['run_id'], referenced_schema: 'public', referenced_table: 'replenishment_runs', referenced_columns: ['run_id'], on_delete: 'r' }),
    constraint({ table: 'replenishment_recommendations', name: 'replenishment_recommendations_recommendation_index_check', type: 'c', columns: ['recommendation_index'], definition: 'CHECK (recommendation_index >= 0)' }),
    constraint({ table: 'replenishment_recommendations', name: 'replenishment_recommendations_run_index_uq', type: 'u', columns: ['run_id', 'recommendation_index'] }),
    constraint({ table: 'replenishment_decisions', name: 'replenishment_decisions_pkey', type: 'p', columns: ['decision_id'] }),
    constraint({ table: 'replenishment_decisions', name: 'replenishment_decisions_recommendation_id_fkey', type: 'f', columns: ['recommendation_id'], referenced_schema: 'public', referenced_table: 'replenishment_recommendations', referenced_columns: ['recommendation_id'], on_delete: 'r' }),
    constraint({ table: 'replenishment_decisions', name: 'replenishment_decisions_decision_check', type: 'c', columns: ['decision'], definition: "CHECK (decision IN ('ACCEPTED', 'REJECTED'))" }),
    constraint({ table: 'replenishment_decisions', name: 'replenishment_decisions_decided_by_user_id_fkey', type: 'f', columns: ['decided_by_user_id'], referenced_schema: 'public', referenced_table: 'users', referenced_columns: ['user_id'], on_delete: 'n' }),
    constraint({ table: 'replenishment_decisions', name: 'replenishment_decisions_recommendation_uq', type: 'u', columns: ['recommendation_id'] }),
  );
  indexes.push(
    index('replenishment_runs', 'replenishment_runs_created_idx', [{ name: 'created_at', descending: true, nulls_first: true }, { name: 'run_id', descending: true, nulls_first: true }]),
    index('replenishment_recommendations', 'replenishment_recommendations_product_idx', [{ name: 'run_id', descending: false, nulls_first: false }, { name: 'synthetic_product_id', descending: false, nulls_first: false }, { name: 'recommendation_index', descending: false, nulls_first: false }]),
    (() => { const unique = index('replenishment_recommendations', 'replenishment_recommendations_run_index_uq', [{ name: 'run_id', descending: false, nulls_first: false }, { name: 'recommendation_index', descending: false, nulls_first: false }]); unique.is_unique = true; unique.constraint_name = 'replenishment_recommendations_run_index_uq'; return unique; })(),
    (() => { const unique = index('replenishment_decisions', 'replenishment_decisions_recommendation_uq', [{ name: 'recommendation_id', descending: false, nulls_first: false }]); unique.is_unique = true; unique.constraint_name = 'replenishment_decisions_recommendation_uq'; return unique; })(),
  );
  const active = indexes.find((entry) => entry.name === 'anomaly_incidents_active_dedupe_uq')!;
  active.is_unique = true;
  active.has_predicate = true;
  active.predicate_definition = "status IN ('NEW', 'INVESTIGATING')";
  const pending = indexes.find((entry) => entry.name === 'anomaly_event_queue_pending_idx')!;
  pending.has_predicate = true;
  pending.predicate_definition = 'processed_at IS NULL';
  const evaluationUnique = index('jeffreys_shadow_evaluations', 'jeffreys_shadow_eval_window_uq', [
    { name: 'profile_version', descending: false, nulls_first: false },
    { name: 'subject_user_id', descending: false, nulls_first: false },
    { name: 'evaluated_at', descending: false, nulls_first: false },
  ]);
  evaluationUnique.is_unique = true;
  evaluationUnique.constraint_name = 'jeffreys_shadow_eval_window_uq';
  indexes.push(evaluationUnique,
    index('jeffreys_shadow_evaluations', 'jeffreys_shadow_eval_user_time_idx', [
      { name: 'profile_version', descending: false, nulls_first: false },
      { name: 'subject_user_id', descending: false, nulls_first: false },
      { name: 'evaluated_at', descending: true, nulls_first: true },
    ]),
    index('jeffreys_shadow_evaluations', 'jeffreys_shadow_eval_profile_time_idx', [
      { name: 'profile_version', descending: false, nulls_first: false },
      { name: 'evaluated_at', descending: true, nulls_first: true },
    ]),
  );
  return { relations: ['users', 'user_sessions', 'orders', 'audit_logs', 'anomaly_incidents', 'anomaly_incident_events', 'anomaly_event_queue', 'jeffreys_shadow_checkpoint', 'jeffreys_shadow_evaluations', 'replenishment_runs', 'replenishment_recommendations', 'replenishment_decisions'], columns, constraints, indexes,
    triggers: ['audit_logs_enqueue_anomaly_event'], functions: ['enqueue_anomaly_audit_event'],
    trigger_definitions: ['CREATE TRIGGER audit_logs_enqueue_anomaly_event AFTER INSERT ON public.audit_logs FOR EACH ROW EXECUTE FUNCTION public.enqueue_anomaly_audit_event()'],
    function_definitions: ['BEGIN INSERT INTO public.anomaly_event_queue (log_id) VALUES (NEW.log_id) ON CONFLICT (log_id) DO NOTHING; RETURN NEW; END;'],
    anomaly_trigger_compatible: true,
  };
}

function restoredMarketplaceBaselineSnapshot(): LegacySchemaSnapshot {
  const constraints = [
    constraint({ table: 'users', name: 'users_pkey', type: 'p', columns: ['user_id'] }),
    constraint({ table: 'users', name: 'users_email_key', type: 'u', columns: ['email'] }),
    constraint({ table: 'users', name: 'users_phone_key', type: 'u', columns: ['phone'] }),
    constraint({ table: 'users', name: 'users_role_check', type: 'c', columns: ['role'], definition: "CHECK (role IN ('user', 'admin'))" }),
    constraint({ table: 'user_sessions', name: 'user_sessions_pkey', type: 'p', columns: ['session_id'] }),
    constraint({ table: 'user_sessions', name: 'user_sessions_token_hash_key', type: 'u', columns: ['token_hash'] }),
    constraint({ table: 'user_sessions', name: 'user_sessions_user_id_fkey', type: 'f', columns: ['user_id'], referenced_schema: 'public', referenced_table: 'users', referenced_columns: ['user_id'], on_delete: 'c' }),
    constraint({ table: 'orders', name: 'orders_pkey', type: 'p', columns: ['order_id'] }),
    constraint({ table: 'orders', name: 'orders_user_id_fkey', type: 'f', columns: ['user_id'], referenced_schema: 'public', referenced_table: 'users', referenced_columns: ['user_id'], on_delete: 'a' }),
  ];
  const indexes = [
    index('users', 'users_pkey', [{ name: 'user_id', descending: false, nulls_first: false }]),
    index('users', 'users_email_key', [{ name: 'email', descending: false, nulls_first: false }]),
    index('users', 'users_phone_key', [{ name: 'phone', descending: false, nulls_first: false }]),
    index('user_sessions', 'user_sessions_pkey', [{ name: 'session_id', descending: false, nulls_first: false }]),
    index('user_sessions', 'user_sessions_token_hash_key', [{ name: 'token_hash', descending: false, nulls_first: false }]),
    index('user_sessions', 'user_sessions_expiry_idx', [{ name: 'expires_at', descending: false, nulls_first: false }]),
    index('orders', 'orders_pkey', [{ name: 'order_id', descending: false, nulls_first: false }]),
  ];
  for (const entry of indexes) {
    if (entry.name.endsWith('_pkey') || entry.name.endsWith('_key')) entry.is_unique = true;
    if (constraints.some((item) => item.name === entry.name && (item.type === 'p' || item.type === 'u'))) entry.constraint_name = entry.name;
  }
  return {
    relations: ['users', 'user_sessions', 'orders'],
    columns: [
      ...originalMarketplaceColumns(),
      column('users', 'password_hash', 'text', 'YES', null),
      column('users', 'role', 'character varying', 'NO', "'user'::character varying", 20),
      column('user_sessions', 'session_id', 'bigint', 'NO', "nextval('user_sessions_session_id_seq'::regclass)"),
      column('user_sessions', 'user_id', 'integer', 'NO', null),
      column('user_sessions', 'token_hash', 'character', 'NO', null, 64),
      column('user_sessions', 'expires_at', 'timestamp with time zone', 'NO', null),
      column('user_sessions', 'created_at', 'timestamp with time zone', 'NO', 'now()'),
      column('orders', 'recipient_name', 'character varying', 'YES', null, 100),
      column('orders', 'recipient_phone', 'character varying', 'YES', null, 20),
      column('orders', 'delivery_city', 'character varying', 'YES', null, 100),
      column('orders', 'delivery_address', 'character varying', 'YES', null, 255),
    ],
    constraints,
    indexes,
    triggers: [],
    functions: [],
  };
}

function fakeClient(snapshot: LegacySchemaSnapshot, failOnMigrationSql?: string) {
  const ledger = new Set<string>();
  const migrationSql = new Set<string>();
  const calls: { sql: string; values?: unknown[] }[] = [];
  let ledgerBeforeTransaction = new Set<string>();
  let migrationSqlBeforeTransaction = new Set<string>();
  const client = {
    async query(sql: string, values?: unknown[]) {
      calls.push({ sql, values });
      if (sql === 'BEGIN') {
        ledgerBeforeTransaction = new Set(ledger);
        migrationSqlBeforeTransaction = new Set(migrationSql);
      }
      if (sql === 'ROLLBACK') {
        ledger.clear();
        for (const name of ledgerBeforeTransaction) ledger.add(name);
        migrationSql.clear();
        for (const statement of migrationSqlBeforeTransaction) migrationSql.add(statement);
      }
      if (sql === failOnMigrationSql) throw new Error('simulated migration SQL execution failure');
      if (/^-- SQL 00[1-7]$/.test(sql)) migrationSql.add(sql);
      if (sql === 'SELECT migration_name FROM public.schema_migrations') {
        return { rows: [...ledger].map((migration_name) => ({ migration_name })) };
      }
      if (sql.startsWith('INSERT INTO public.schema_migrations')) {
        ledger.add(String(values?.[0]));
        return { rows: [] };
      }
      if (sql.includes('AS columns') && sql.includes('AS constraints') && sql.includes('AS indexes')) return { rows: [snapshot] };
      return { rows: [] };
    },
  };
  return { client: client as unknown as PoolClient, calls, ledger, migrationSql };
}

describe('legacy migration schema detection', () => {
  it('recognizes schemas matching all migration effects', () => {
    const snapshot = completeSnapshot();
    expect(assessLegacyMigration('001_auth.sql', snapshot)).toEqual({ complete: true, started: true });
    expect(assessLegacyMigration('002_order_delivery.sql', snapshot)).toEqual({ complete: true, started: true });
    expect(assessLegacyMigration('003_audit_logs.sql', snapshot)).toEqual({ complete: true, started: true });
    expect(assessLegacyMigration('004_anomaly_incidents.sql', snapshot)).toEqual({ complete: true, started: true });
  });

  it.each([
    ['primary key on the wrong column', '001_auth.sql', (s: LegacySchemaSnapshot) => { s.constraints.find((c) => c.name === 'user_sessions_pkey')!.columns = ['user_id']; }],
    ['unique constraint on the wrong column', '001_auth.sql', (s: LegacySchemaSnapshot) => { s.constraints.find((c) => c.name === 'user_sessions_token_hash_key')!.columns = ['session_id']; }],
    ['foreign key from the wrong column', '001_auth.sql', (s: LegacySchemaSnapshot) => { s.constraints.find((c) => c.name === 'user_sessions_user_id_fkey')!.columns = ['expires_at']; }],
    ['foreign key to the wrong target column', '001_auth.sql', (s: LegacySchemaSnapshot) => { s.constraints.find((c) => c.name === 'user_sessions_user_id_fkey')!.referenced_columns = ['email']; }],
    ['foreign key with the wrong ON DELETE action', '001_auth.sql', (s: LegacySchemaSnapshot) => { s.constraints.find((c) => c.name === 'user_sessions_user_id_fkey')!.on_delete = 'n'; }],
    ['an index with an additional column', '003_audit_logs.sql', (s: LegacySchemaSnapshot) => { s.indexes.find((i) => i.name === 'audit_logs_created_idx')!.columns.push({ name: 'status', descending: false, nulls_first: false }); }],
    ['a unique index when a non-unique index is expected', '003_audit_logs.sql', (s: LegacySchemaSnapshot) => { s.indexes.find((i) => i.name === 'audit_logs_status_created_idx')!.is_unique = true; }],
    ['a different index access method', '003_audit_logs.sql', (s: LegacySchemaSnapshot) => { s.indexes.find((i) => i.name === 'audit_logs_status_created_idx')!.access_method = 'gin'; }],
    ['an index with reversed key order', '003_audit_logs.sql', (s: LegacySchemaSnapshot) => { s.indexes.find((i) => i.name === 'audit_logs_created_idx')!.columns.reverse(); }],
    ['a different check condition', '003_audit_logs.sql', (s: LegacySchemaSnapshot) => { s.constraints.find((c) => c.name === 'audit_logs_status_check')!.definition = "CHECK (status IN ('SUCCESS', 'FAILURE') OR TRUE)"; }],
    ['an additional check that rejects admin', '001_auth.sql', (s: LegacySchemaSnapshot) => { s.constraints.push(constraint({ table: 'users', name: 'users_no_admin_check', type: 'c', columns: ['role'], definition: "CHECK (role <> 'admin')" })); }],
    ['an additional unique constraint on a different key', '001_auth.sql', (s: LegacySchemaSnapshot) => { s.constraints.push(constraint({ table: 'users', name: 'users_role_key', type: 'u', columns: ['role'] })); }],
    ['an additional primary key', '001_auth.sql', (s: LegacySchemaSnapshot) => { s.constraints.push(constraint({ table: 'users', name: 'users_email_pkey', type: 'p', columns: ['email'] })); }],
    ['an additional foreign key with a conflicting delete action', '001_auth.sql', (s: LegacySchemaSnapshot) => { s.constraints.push(constraint({ table: 'user_sessions', name: 'user_sessions_user_id_fkey_extra', type: 'f', columns: ['user_id'], referenced_schema: 'public', referenced_table: 'users', referenced_columns: ['user_id'], on_delete: 'n' })); }],
    ['an additional unique index on a different key', '001_auth.sql', (s: LegacySchemaSnapshot) => { const i = index('users', 'users_role_unique_idx', [{ name: 'role', descending: false, nulls_first: false }]); i.is_unique = true; s.indexes.push(i); }],
    ['a wrong column default', '001_auth.sql', (s: LegacySchemaSnapshot) => { s.columns.find((c) => c.table === 'users' && c.name === 'role')!.default_value = "'guest'::character varying"; }],
    ['a wrong nullable setting', '001_auth.sql', (s: LegacySchemaSnapshot) => { s.columns.find((c) => c.table === 'user_sessions' && c.name === 'expires_at')!.nullable = 'YES'; }],
    ['wrong password hash type', '001_auth.sql', (s: LegacySchemaSnapshot) => { s.columns.find((c) => c.table === 'users' && c.name === 'password_hash')!.data_type = 'character varying'; }],
    ['wrong base users column type', '001_auth.sql', (s: LegacySchemaSnapshot) => { s.columns.find((c) => c.table === 'users' && c.name === 'email')!.data_type = 'text'; }],
    ['wrong role length', '001_auth.sql', (s: LegacySchemaSnapshot) => { s.columns.find((c) => c.table === 'users' && c.name === 'role')!.max_length = 30; }],
    ['wrong role nullability', '001_auth.sql', (s: LegacySchemaSnapshot) => { s.columns.find((c) => c.table === 'users' && c.name === 'role')!.nullable = 'YES'; }],
    ['wrong role check', '001_auth.sql', (s: LegacySchemaSnapshot) => { s.constraints.find((c) => c.name === 'users_role_check')!.definition = "CHECK (role IN ('user', 'admin', 'guest'))"; }],
    ['wrong session expiry index columns', '001_auth.sql', (s: LegacySchemaSnapshot) => { s.indexes.find((i) => i.name === 'user_sessions_expiry_idx')!.columns = [{ name: 'user_id', descending: false, nulls_first: false }]; }],
    ['unvalidated authentication constraint', '001_auth.sql', (s: LegacySchemaSnapshot) => { s.constraints.find((c) => c.name === 'users_role_check')!.validated = false; }],
    ['deferrable session foreign key', '001_auth.sql', (s: LegacySchemaSnapshot) => { s.constraints.find((c) => c.name === 'user_sessions_user_id_fkey')!.deferrable = true; }],
    ['wrong foreign-key ON UPDATE action', '001_auth.sql', (s: LegacySchemaSnapshot) => { s.constraints.find((c) => c.name === 'user_sessions_user_id_fkey')!.on_update = 'c'; }],
    ['identity session token column', '001_auth.sql', (s: LegacySchemaSnapshot) => { s.columns.find((c) => c.table === 'user_sessions' && c.name === 'token_hash')!.is_identity = 'YES'; }],
    ['generated delivery column', '002_order_delivery.sql', (s: LegacySchemaSnapshot) => { s.columns.find((c) => c.table === 'orders' && c.name === 'delivery_city')!.is_generated = 'ALWAYS'; }],
    ['non-default opclass on required index', '001_auth.sql', (s: LegacySchemaSnapshot) => { s.indexes.find((i) => i.name === 'user_sessions_expiry_idx')!.columns[0].operator_class_is_default = false; }],
    ['index collation different from column collation', '001_auth.sql', (s: LegacySchemaSnapshot) => { s.indexes.find((i) => i.name === 'user_sessions_expiry_idx')!.columns[0].collation_matches_column = false; }],
    ['unique index with NULLS NOT DISTINCT', '001_auth.sql', (s: LegacySchemaSnapshot) => {
      const emailIndex = index('users', 'users_email_key', [{ name: 'email', descending: false, nulls_first: false }]);
      emailIndex.is_unique = true;
      emailIndex.constraint_name = 'users_email_key';
      emailIndex.nulls_not_distinct = true;
      s.indexes.push(emailIndex);
    }],
    ['additional user column', '001_auth.sql', (s: LegacySchemaSnapshot) => { s.columns.push(column('users', 'legacy_flag', 'boolean', 'NO', 'false')); }],
    ['additional session column', '001_auth.sql', (s: LegacySchemaSnapshot) => { s.columns.push(column('user_sessions', 'required_version', 'integer', 'NO', null)); }],
    ['additional order column', '002_order_delivery.sql', (s: LegacySchemaSnapshot) => { s.columns.push(column('orders', 'internal_state', 'text', 'NO', null)); }],
    ['wrong delivery column type', '002_order_delivery.sql', (s: LegacySchemaSnapshot) => { s.columns.find((c) => c.table === 'orders' && c.name === 'recipient_phone')!.data_type = 'text'; }],
    ['wrong base orders column type', '002_order_delivery.sql', (s: LegacySchemaSnapshot) => { s.columns.find((c) => c.table === 'orders' && c.name === 'user_id')!.data_type = 'bigint'; }],
    ['wrong base orders numeric precision', '002_order_delivery.sql', (s: LegacySchemaSnapshot) => { s.columns.find((c) => c.table === 'orders' && c.name === 'total_amount')!.numeric_precision = 12; }],
    ['wrong delivery column length', '002_order_delivery.sql', (s: LegacySchemaSnapshot) => { s.columns.find((c) => c.table === 'orders' && c.name === 'delivery_address')!.max_length = 200; }],
    ['non-null delivery column', '002_order_delivery.sql', (s: LegacySchemaSnapshot) => { s.columns.find((c) => c.table === 'orders' && c.name === 'delivery_city')!.nullable = 'NO'; }],
    ['wrong delivery default', '002_order_delivery.sql', (s: LegacySchemaSnapshot) => { s.columns.find((c) => c.table === 'orders' && c.name === 'recipient_name')!.default_value = "'unknown'"; }],
    ['conflicting orders foreign-key action', '002_order_delivery.sql', (s: LegacySchemaSnapshot) => { s.constraints.push(constraint({ table: 'orders', name: 'orders_user_id_fkey', type: 'f', columns: ['user_id'], referenced_schema: 'public', referenced_table: 'users', referenced_columns: ['user_id'], on_delete: 'c' })); }],
    ['additional unique constraint on orders', '002_order_delivery.sql', (s: LegacySchemaSnapshot) => { s.constraints.push(constraint({ table: 'orders', name: 'orders_order_date_uq', type: 'u', columns: ['order_date'] })); }],
    ['a wrong anomaly CHECK expression', '004_anomaly_incidents.sql', (s: LegacySchemaSnapshot) => { s.constraints.find((c) => c.name === 'anomaly_incidents_risk_score_check')!.definition = 'CHECK (risk_score >= 0)'; }],
    ['a wrong active incident index predicate', '004_anomaly_incidents.sql', (s: LegacySchemaSnapshot) => { s.indexes.find((i) => i.name === 'anomaly_incidents_active_dedupe_uq')!.predicate_definition = "status IN ('NEW')"; }],
    ['a wrong incident default', '004_anomaly_incidents.sql', (s: LegacySchemaSnapshot) => { s.columns.find((c) => c.table === 'anomaly_incidents' && c.name === 'status')!.default_value = "'INVESTIGATING'::character varying"; }],
    ['a nullable event queue attempt count', '004_anomaly_incidents.sql', (s: LegacySchemaSnapshot) => { s.columns.find((c) => c.table === 'anomaly_event_queue' && c.name === 'attempts')!.nullable = 'YES'; }],
  ] as const)('does not recognize a schema with %s', (_case, migration, mutate) => {
    const snapshot = completeSnapshot();
    mutate(snapshot);
    const result = assessLegacyMigration(migration, snapshot);
    expect(result.complete).toBe(false);
    expect(result.started).toBe(true);
  });

  it('treats absent migration effects as pending, not partial', () => {
    expect(assessLegacyMigration('003_audit_logs.sql', { relations: [], columns: [], constraints: [], indexes: [] }))
      .toEqual({ complete: false, started: false });
  });

  it('reports the exact legacy 001 column mismatch and unexpected columns', () => {
    const snapshot = restoredMarketplaceBaselineSnapshot();
    const role = snapshot.columns.find((item) => item.table === 'users' && item.name === 'role')!;
    role.default_value = "'guest'::character varying";
    snapshot.columns.push(column('users', 'unexpected_flag', 'boolean', 'NO', 'false'));

    expect(assessLegacyMigration('001_auth.sql', snapshot).complete).toBe(false);
    const diagnostics = diagnoseLegacyMigration('001_auth.sql', snapshot);
    expect(diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({
        table: 'users',
        object: 'column role',
        expected: expect.objectContaining({ default_value: "'user'" }),
        actual: expect.objectContaining({ default_value: "'guest'::character varying" }),
      }),
      expect.objectContaining({
        table: 'users',
        object: 'column set',
        expected: expect.arrayContaining(['role']),
        actual: expect.arrayContaining(['unexpected_flag']),
      }),
    ]));
  });

  it('recognizes matching 001 constraints with PostgreSQL-standard metadata and full catalog definitions', () => {
    const snapshot = restoredMarketplaceBaselineSnapshot();
    for (const item of snapshot.constraints) {
      item.enforced = null;
      item.period = null;
      item.no_inherit = null;
      if (item.type !== 'c') item.definition = `catalog definition for ${item.name}`;
    }
    const sessionForeignKey = snapshot.constraints.find((item) => item.name === 'user_sessions_user_id_fkey')!;
    sessionForeignKey.on_update = 'a';
    sessionForeignKey.match_type = 's';

    expect(assessLegacyMigration('001_auth.sql', snapshot)).toEqual({ complete: true, started: true });
    expect(diagnoseLegacyMigration('001_auth.sql', snapshot)).toEqual([]);
    expect(assessLegacyMigration('002_order_delivery.sql', snapshot)).toEqual({ complete: true, started: true });
  });

  it('applies the new additive retry migration to a complete 004 schema without rewriting earlier history', async () => {
    const snapshot = completeSnapshot();
    snapshot.columns = snapshot.columns.filter((entry) => !(entry.table === 'anomaly_event_queue' && ['last_error', 'dead_lettered_at'].includes(entry.name)));
    const { client, calls, ledger } = fakeClient(snapshot);
    const applied = await applyMigrations(client, files);
    expect(applied).toContain('005_anomaly_queue_dead_letter.sql');
    expect(applied.find((entry) => entry.startsWith('006_jeffreys_shadow_mode.sql'))).toContain('(recognized existing schema)');
    expect(applied.at(-1)).toContain('007_replenishment_history.sql (recognized existing schema)');
    expect(ledger.size).toBe(7);
    expect(calls).toContainEqual({ sql: '-- SQL 005', values: undefined });
    expect(calls.some(({ sql }) => /\bDROP\s+|\bDELETE\s+FROM\s+public\./i.test(sql))).toBe(false);
  });

  it('rejects a partial dead-letter schema instead of silently adopting it', () => {
    const snapshot = completeSnapshot();
    snapshot.columns = snapshot.columns.filter((entry) => !(entry.table === 'anomaly_event_queue' && entry.name === 'dead_lettered_at'));
    expect(assessLegacyMigration('005_anomaly_queue_dead_letter.sql', snapshot)).toEqual({ complete: false, started: true });
  });

  it('rejects a structurally incomplete anomaly migration, including a missing outbox trigger', () => {
    const snapshot = completeSnapshot();
    snapshot.triggers = [];
    expect(assessLegacyMigration('004_anomaly_incidents.sql', snapshot)).toEqual({ complete: false, started: true });
  });

  it('does not accept a trigger/function binding with incompatible catalog properties or body', () => {
    const snapshot = completeSnapshot();
    snapshot.anomaly_trigger_compatible = false;
    expect(assessLegacyMigration('004_anomaly_incidents.sql', snapshot)).toEqual({ complete: false, started: true });
  });

  it('allows additional non-unique indexes because they do not restrict writes', () => {
    const snapshot = completeSnapshot();
    snapshot.indexes.push(index('users', 'users_role_lookup_idx', [{ name: 'role', descending: false, nulls_first: false }]));
    expect(assessLegacyMigration('001_auth.sql', snapshot)).toEqual({ complete: true, started: true });
  });

  it('allows original base-schema constraints while rejecting unrecognized constraints', () => {
    const snapshot = completeSnapshot();
    snapshot.constraints.push(
      constraint({ table: 'users', name: 'users_pkey', type: 'p', columns: ['user_id'] }),
      constraint({ table: 'users', name: 'users_email_key', type: 'u', columns: ['email'] }),
      constraint({ table: 'users', name: 'users_phone_key', type: 'u', columns: ['phone'] }),
      constraint({ table: 'orders', name: 'orders_pkey', type: 'p', columns: ['order_id'] }),
      constraint({ table: 'orders', name: 'orders_user_id_fkey', type: 'f', columns: ['user_id'], referenced_schema: 'public', referenced_table: 'users', referenced_columns: ['user_id'], on_delete: 'a' }),
    );
    expect(assessLegacyMigration('001_auth.sql', snapshot).complete).toBe(true);
    expect(assessLegacyMigration('002_order_delivery.sql', snapshot).complete).toBe(true);
  });

  it('does not treat the pre-existing base users and orders tables as partial migrations', () => {
    const baseSchema: LegacySchemaSnapshot = {
      relations: ['users', 'orders'],
      columns: [column('users', 'user_id', 'integer', 'NO', 'nextval(...)'), column('orders', 'order_id', 'integer', 'NO', 'nextval(...)')],
      constraints: [], indexes: [],
    };
    expect(assessLegacyMigration('001_auth.sql', baseSchema)).toEqual({ complete: false, started: false });
    expect(assessLegacyMigration('002_order_delivery.sql', baseSchema)).toEqual({ complete: false, started: false });
  });

  it('recognizes only the complete additive Jeffreys shadow schema', () => {
    const snapshot = completeSnapshot();
    expect(assessLegacyMigration('006_jeffreys_shadow_mode.sql', snapshot)).toEqual({ complete: true, started: true });
    snapshot.columns.find((item) => item.table === 'jeffreys_shadow_evaluations' && item.name === 'divergence')!.data_type = 'numeric';
    expect(assessLegacyMigration('006_jeffreys_shadow_mode.sql', snapshot)).toEqual({ complete: false, started: true });
  });

  it('recognizes the complete additive replenishment history schema and rejects partial definitions', () => {
    const snapshot = completeSnapshot();
    expect(assessLegacyMigration('007_replenishment_history.sql', snapshot)).toEqual({ complete: true, started: true });
    snapshot.constraints.find((item) => item.name === 'replenishment_decisions_recommendation_uq')!.columns = ['decision'];
    expect(assessLegacyMigration('007_replenishment_history.sql', snapshot)).toEqual({ complete: false, started: true });
  });
});

describe('tracked migrations and rollback', () => {
  it('adopts exact legacy 001 and 002 effects, then applies 003–007 in order under one transaction', async () => {
    const { client, calls, ledger } = fakeClient(restoredMarketplaceBaselineSnapshot());
    const applied = await applyMigrations(client, files);
    expect(applied).toEqual([
      '001_auth.sql (recognized existing schema)',
      '002_order_delivery.sql (recognized existing schema)',
      '003_audit_logs.sql',
      '004_anomaly_incidents.sql',
      '005_anomaly_queue_dead_letter.sql',
      '006_jeffreys_shadow_mode.sql',
      '007_replenishment_history.sql',
    ]);
    expect(ledger.size).toBe(7);
    const executed = calls.filter(({ sql }) => /^-- SQL 00[1-7]$/.test(sql)).map(({ sql }) => sql);
    expect(executed).toEqual(['-- SQL 003', '-- SQL 004', '-- SQL 005', '-- SQL 006', '-- SQL 007']);
    const beginIndex = calls.findIndex(({ sql }) => sql === 'BEGIN');
    const lockIndex = calls.findIndex(({ sql }) => sql === 'SELECT pg_advisory_xact_lock(741923641)');
    const commitIndex = calls.findIndex(({ sql }) => sql === 'COMMIT');
    expect(lockIndex).toBeGreaterThan(beginIndex);
    expect(commitIndex).toBeGreaterThan(lockIndex);
    expect(calls.some(({ sql }) => sql === 'ROLLBACK')).toBe(false);
  });

  it('recognizes a complete existing schema and records the migration history', async () => {
    const { client, calls, ledger } = fakeClient(completeSnapshot());
    const applied = await applyMigrations(client, files);
    expect(applied).toEqual(files.map(({ name }) => `${name} (recognized existing schema)`));
    expect(ledger).toEqual(new Set(files.map(({ name }) => name)));
    expect(calls.some(({ sql }) => sql === 'COMMIT')).toBe(true);
    expect(calls.some(({ sql }) => sql === 'ROLLBACK')).toBe(false);
    expect(calls).not.toContainEqual({ sql: '-- SQL 001', values: undefined });
    expect(calls).not.toContainEqual({ sql: '-- SQL 002', values: undefined });
    const beginIndex = calls.findIndex(({ sql }) => sql === 'BEGIN');
    const lockIndex = calls.findIndex(({ sql }) => sql === 'SELECT pg_advisory_xact_lock(741923641)');
    const commitIndex = calls.findIndex(({ sql }) => sql === 'COMMIT');
    expect(beginIndex).toBeGreaterThanOrEqual(0);
    expect(lockIndex).toBeGreaterThan(beginIndex);
    expect(commitIndex).toBeGreaterThan(lockIndex);
  });

  it('rolls back the tracker and prior history records when a later legacy migration is incompatible', async () => {
    const snapshot = completeSnapshot();
    snapshot.columns.find((column) => column.table === 'orders' && column.name === 'delivery_city')!.max_length = 80;
    const { client, calls, ledger } = fakeClient(snapshot);
    await expect(applyMigrations(client, files)).rejects.toThrow(/partial or incompatible existing schema.*orders\.column delivery_city: expected=.*actual=/);
    expect(calls.some(({ sql }) => sql === 'ROLLBACK')).toBe(true);
    expect(calls.some(({ sql }) => sql === 'COMMIT')).toBe(false);
    expect(ledger.size).toBe(0);
  });

  it('rolls back every migration record when migration SQL itself fails', async () => {
    const { client, calls, ledger, migrationSql } = fakeClient({ relations: [], columns: [], constraints: [], indexes: [] }, '-- SQL 004');
    await expect(applyMigrations(client, files)).rejects.toThrow('simulated migration SQL execution failure');

    expect(calls).toContainEqual({ sql: '-- SQL 004', values: undefined });
    expect(calls.at(-1)?.sql).toBe('ROLLBACK');
    expect(calls.some(({ sql }) => sql === 'COMMIT')).toBe(false);
    expect(ledger).toEqual(new Set());
    expect(migrationSql).toEqual(new Set());
    expect(calls.some(({ sql, values }) => sql.startsWith('INSERT INTO public.schema_migrations') && values?.[0] === '004_anomaly_incidents.sql')).toBe(false);
  });

  it('applies fresh migrations once and skips recorded files on a second run', async () => {
    const { client, calls, ledger } = fakeClient({ relations: [], columns: [], constraints: [], indexes: [] });
    expect(await applyMigrations(client, files)).toEqual(files.map(({ name }) => name));
    expect(ledger.size).toBe(7);
    expect(calls.filter(({ sql }) => ['-- SQL 001', '-- SQL 002', '-- SQL 003', '-- SQL 004', '-- SQL 005', '-- SQL 006', '-- SQL 007'].includes(sql))).toHaveLength(7);
  });
});
