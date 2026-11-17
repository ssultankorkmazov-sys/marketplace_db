import type { PoolClient } from 'pg';

export interface MigrationFile {
  name: string;
  sql: string;
}

export type MigrationName = '001_auth.sql' | '002_order_delivery.sql' | '003_audit_logs.sql' | '004_anomaly_incidents.sql' | '005_anomaly_queue_dead_letter.sql' | '006_jeffreys_shadow_mode.sql' | '007_replenishment_history.sql';
export interface LegacyColumn {
  table: string;
  name: string;
  data_type: string;
  max_length: number | null;
  numeric_precision?: number | null;
  numeric_scale?: number | null;
  nullable: 'YES' | 'NO';
  default_value: string | null;
  is_identity?: 'YES' | 'NO';
  identity_generation?: string;
  is_generated?: 'ALWAYS' | 'NEVER' | string;
  generation_expression?: string | null;
}
export interface LegacyConstraint {
  table: string;
  name: string;
  type: 'p' | 'u' | 'f' | 'c' | string;
  columns: string[];
  referenced_schema: string | null;
  referenced_table: string | null;
  referenced_columns: string[];
  on_delete: 'a' | 'r' | 'c' | 'n' | 'd' | null;
  on_update?: 'a' | 'r' | 'c' | 'n' | 'd' | null;
  match_type?: 's' | 'f' | 'p' | null;
  validated?: boolean | null;
  enforced?: boolean | null;
  period?: boolean | null;
  deferrable?: boolean | null;
  deferred?: boolean | null;
  no_inherit?: boolean | null;
  definition: string;
}
export interface LegacyIndexColumn {
  name: string | null;
  descending: boolean;
  nulls_first: boolean;
  operator_class_is_default?: boolean;
  collation_matches_column?: boolean;
}
export interface LegacyIndex {
  schema: string;
  table: string;
  name: string;
  constraint_name: string | null;
  access_method: string;
  is_unique: boolean;
  nulls_not_distinct?: boolean;
  is_immediate?: boolean;
  is_valid: boolean;
  is_ready?: boolean;
  is_live?: boolean;
  has_expression: boolean;
  has_predicate: boolean;
  predicate_definition?: string | null;
  has_included_columns: boolean;
  columns: LegacyIndexColumn[];
}
export interface LegacySchemaSnapshot {
  relations: string[];
  columns: LegacyColumn[];
  constraints: LegacyConstraint[];
  indexes: LegacyIndex[];
  triggers?: string[];
  functions?: string[];
  trigger_definitions?: string[];
  function_definitions?: string[];
  anomaly_trigger_compatible?: boolean;
}
export type LegacyState = { complete: boolean; started: boolean };

const expectedColumns: Record<MigrationName, LegacyColumn[]> = {
  '001_auth.sql': [
    { table: 'users', name: 'user_id', data_type: 'integer', max_length: null, nullable: 'NO', default_value: 'sequence' },
    { table: 'users', name: 'name', data_type: 'character varying', max_length: 100, nullable: 'NO', default_value: null },
    { table: 'users', name: 'email', data_type: 'character varying', max_length: 150, nullable: 'NO', default_value: null },
    { table: 'users', name: 'phone', data_type: 'character varying', max_length: 20, nullable: 'NO', default_value: null },
    { table: 'users', name: 'address', data_type: 'character varying', max_length: 255, nullable: 'YES', default_value: null },
    { table: 'users', name: 'password_hash', data_type: 'text', max_length: null, nullable: 'YES', default_value: null },
    { table: 'users', name: 'role', data_type: 'character varying', max_length: 20, nullable: 'NO', default_value: "'user'" },
    { table: 'user_sessions', name: 'session_id', data_type: 'bigint', max_length: null, nullable: 'NO', default_value: 'sequence' },
    { table: 'user_sessions', name: 'user_id', data_type: 'integer', max_length: null, nullable: 'NO', default_value: null },
    { table: 'user_sessions', name: 'token_hash', data_type: 'character', max_length: 64, nullable: 'NO', default_value: null },
    { table: 'user_sessions', name: 'expires_at', data_type: 'timestamp with time zone', max_length: null, nullable: 'NO', default_value: null },
    { table: 'user_sessions', name: 'created_at', data_type: 'timestamp with time zone', max_length: null, nullable: 'NO', default_value: 'now()' },
  ],
  '002_order_delivery.sql': [
    { table: 'orders', name: 'order_id', data_type: 'integer', max_length: null, nullable: 'NO', default_value: 'sequence' },
    { table: 'orders', name: 'user_id', data_type: 'integer', max_length: null, nullable: 'NO', default_value: null },
    { table: 'orders', name: 'order_date', data_type: 'timestamp without time zone', max_length: null, nullable: 'NO', default_value: null },
    { table: 'orders', name: 'status', data_type: 'character varying', max_length: 30, nullable: 'NO', default_value: null },
    { table: 'orders', name: 'total_amount', data_type: 'numeric', max_length: null, numeric_precision: 10, numeric_scale: 2, nullable: 'NO', default_value: null },
    { table: 'orders', name: 'recipient_name', data_type: 'character varying', max_length: 100, nullable: 'YES', default_value: null },
    { table: 'orders', name: 'recipient_phone', data_type: 'character varying', max_length: 20, nullable: 'YES', default_value: null },
    { table: 'orders', name: 'delivery_city', data_type: 'character varying', max_length: 100, nullable: 'YES', default_value: null },
    { table: 'orders', name: 'delivery_address', data_type: 'character varying', max_length: 255, nullable: 'YES', default_value: null },
  ],
  '003_audit_logs.sql': [
    { table: 'audit_logs', name: 'log_id', data_type: 'bigint', max_length: null, nullable: 'NO', default_value: 'sequence' },
    { table: 'audit_logs', name: 'user_id', data_type: 'integer', max_length: null, nullable: 'YES', default_value: null },
    { table: 'audit_logs', name: 'action', data_type: 'character varying', max_length: 64, nullable: 'NO', default_value: null },
    { table: 'audit_logs', name: 'entity_type', data_type: 'character varying', max_length: 32, nullable: 'YES', default_value: null },
    { table: 'audit_logs', name: 'entity_id', data_type: 'integer', max_length: null, nullable: 'YES', default_value: null },
    { table: 'audit_logs', name: 'status', data_type: 'character varying', max_length: 16, nullable: 'NO', default_value: null },
    { table: 'audit_logs', name: 'details', data_type: 'jsonb', max_length: null, nullable: 'NO', default_value: "'{}'" },
    { table: 'audit_logs', name: 'ip_address', data_type: 'inet', max_length: null, nullable: 'YES', default_value: null },
    { table: 'audit_logs', name: 'created_at', data_type: 'timestamp with time zone', max_length: null, nullable: 'NO', default_value: 'now()' },
  ],
  '004_anomaly_incidents.sql': [
    { table: 'anomaly_incidents', name: 'incident_id', data_type: 'bigint', max_length: null, nullable: 'NO', default_value: 'sequence' },
    { table: 'anomaly_incidents', name: 'anomaly_type', data_type: 'character varying', max_length: 64, nullable: 'NO', default_value: null },
    { table: 'anomaly_incidents', name: 'subject_user_id', data_type: 'integer', max_length: null, nullable: 'YES', default_value: null },
    { table: 'anomaly_incidents', name: 'severity', data_type: 'character varying', max_length: 16, nullable: 'NO', default_value: null },
    { table: 'anomaly_incidents', name: 'risk_score', data_type: 'integer', max_length: null, nullable: 'NO', default_value: null },
    { table: 'anomaly_incidents', name: 'status', data_type: 'character varying', max_length: 20, nullable: 'NO', default_value: "'new'" },
    { table: 'anomaly_incidents', name: 'detected_at', data_type: 'timestamp with time zone', max_length: null, nullable: 'NO', default_value: 'now()' },
    { table: 'anomaly_incidents', name: 'updated_at', data_type: 'timestamp with time zone', max_length: null, nullable: 'NO', default_value: 'now()' },
    { table: 'anomaly_incidents', name: 'first_event_at', data_type: 'timestamp with time zone', max_length: null, nullable: 'NO', default_value: null },
    { table: 'anomaly_incidents', name: 'last_event_at', data_type: 'timestamp with time zone', max_length: null, nullable: 'NO', default_value: null },
    { table: 'anomaly_incidents', name: 'evidence', data_type: 'jsonb', max_length: null, nullable: 'NO', default_value: "'{}'" },
    { table: 'anomaly_incidents', name: 'explanation', data_type: 'text', max_length: null, nullable: 'NO', default_value: null },
    { table: 'anomaly_incidents', name: 'recommendations', data_type: 'jsonb', max_length: null, nullable: 'NO', default_value: "'[]'" },
    { table: 'anomaly_incidents', name: 'deduplication_key', data_type: 'character varying', max_length: 160, nullable: 'NO', default_value: null },
    { table: 'anomaly_incident_events', name: 'incident_id', data_type: 'bigint', max_length: null, nullable: 'NO', default_value: null },
    { table: 'anomaly_incident_events', name: 'log_id', data_type: 'bigint', max_length: null, nullable: 'NO', default_value: null },
    { table: 'anomaly_incident_events', name: 'linked_at', data_type: 'timestamp with time zone', max_length: null, nullable: 'NO', default_value: 'now()' },
    { table: 'anomaly_event_queue', name: 'log_id', data_type: 'bigint', max_length: null, nullable: 'NO', default_value: null },
    { table: 'anomaly_event_queue', name: 'queued_at', data_type: 'timestamp with time zone', max_length: null, nullable: 'NO', default_value: 'now()' },
    { table: 'anomaly_event_queue', name: 'attempts', data_type: 'integer', max_length: null, nullable: 'NO', default_value: '0' },
    { table: 'anomaly_event_queue', name: 'available_at', data_type: 'timestamp with time zone', max_length: null, nullable: 'NO', default_value: 'now()' },
    { table: 'anomaly_event_queue', name: 'processed_at', data_type: 'timestamp with time zone', max_length: null, nullable: 'YES', default_value: null },
  ],
  '005_anomaly_queue_dead_letter.sql': [
    { table: 'anomaly_event_queue', name: 'last_error', data_type: 'text', max_length: null, nullable: 'YES', default_value: null },
    { table: 'anomaly_event_queue', name: 'dead_lettered_at', data_type: 'timestamp with time zone', max_length: null, nullable: 'YES', default_value: null },
  ],
  '006_jeffreys_shadow_mode.sql': [
    { table: 'jeffreys_shadow_checkpoint', name: 'singleton_id', data_type: 'smallint', max_length: null, nullable: 'NO', default_value: '1' },
    { table: 'jeffreys_shadow_checkpoint', name: 'profile_version', data_type: 'character varying', max_length: 64, nullable: 'NO', default_value: null },
    { table: 'jeffreys_shadow_checkpoint', name: 'configuration_signature', data_type: 'text', max_length: null, nullable: 'NO', default_value: null },
    { table: 'jeffreys_shadow_checkpoint', name: 'next_evaluation_at', data_type: 'timestamp with time zone', max_length: null, nullable: 'NO', default_value: null },
    { table: 'jeffreys_shadow_checkpoint', name: 'last_subject_user_id', data_type: 'integer', max_length: null, nullable: 'YES', default_value: null },
    { table: 'jeffreys_shadow_checkpoint', name: 'verification_pass', data_type: 'boolean', max_length: null, nullable: 'NO', default_value: 'false' },
    { table: 'jeffreys_shadow_checkpoint', name: 'updated_at', data_type: 'timestamp with time zone', max_length: null, nullable: 'NO', default_value: 'now()' },
    { table: 'jeffreys_shadow_evaluations', name: 'evaluation_id', data_type: 'bigint', max_length: null, nullable: 'NO', default_value: 'sequence' },
    { table: 'jeffreys_shadow_evaluations', name: 'profile_version', data_type: 'character varying', max_length: 64, nullable: 'NO', default_value: null },
    { table: 'jeffreys_shadow_evaluations', name: 'subject_user_id', data_type: 'integer', max_length: null, nullable: 'NO', default_value: null },
    { table: 'jeffreys_shadow_evaluations', name: 'evaluated_at', data_type: 'timestamp with time zone', max_length: null, nullable: 'NO', default_value: null },
    { table: 'jeffreys_shadow_evaluations', name: 'baseline_start_at', data_type: 'timestamp with time zone', max_length: null, nullable: 'NO', default_value: null },
    { table: 'jeffreys_shadow_evaluations', name: 'baseline_end_at', data_type: 'timestamp with time zone', max_length: null, nullable: 'NO', default_value: null },
    { table: 'jeffreys_shadow_evaluations', name: 'current_start_at', data_type: 'timestamp with time zone', max_length: null, nullable: 'NO', default_value: null },
    { table: 'jeffreys_shadow_evaluations', name: 'current_end_at', data_type: 'timestamp with time zone', max_length: null, nullable: 'NO', default_value: null },
    { table: 'jeffreys_shadow_evaluations', name: 'baseline_observations', data_type: 'bigint', max_length: null, nullable: 'YES', default_value: null },
    { table: 'jeffreys_shadow_evaluations', name: 'current_observations', data_type: 'bigint', max_length: null, nullable: 'YES', default_value: null },
    { table: 'jeffreys_shadow_evaluations', name: 'baseline_distribution', data_type: 'jsonb', max_length: null, nullable: 'YES', default_value: null },
    { table: 'jeffreys_shadow_evaluations', name: 'current_distribution', data_type: 'jsonb', max_length: null, nullable: 'YES', default_value: null },
    { table: 'jeffreys_shadow_evaluations', name: 'divergence', data_type: 'double precision', max_length: null, nullable: 'YES', default_value: null },
    { table: 'jeffreys_shadow_evaluations', name: 'category_contributions', data_type: 'jsonb', max_length: null, nullable: 'YES', default_value: null },
    { table: 'jeffreys_shadow_evaluations', name: 'evaluation_status', data_type: 'character varying', max_length: 32, nullable: 'NO', default_value: null },
    { table: 'jeffreys_shadow_evaluations', name: 'sample_counts_capped', data_type: 'boolean', max_length: null, nullable: 'NO', default_value: 'false' },
    { table: 'jeffreys_shadow_evaluations', name: 'profile_config', data_type: 'jsonb', max_length: null, nullable: 'NO', default_value: null },
    { table: 'jeffreys_shadow_evaluations', name: 'recorded_at', data_type: 'timestamp with time zone', max_length: null, nullable: 'NO', default_value: 'now()' },
  ],
  '007_replenishment_history.sql': [
    { table: 'replenishment_runs', name: 'run_id', data_type: 'bigint', max_length: null, nullable: 'NO', default_value: 'sequence' },
    { table: 'replenishment_runs', name: 'source', data_type: 'character varying', max_length: 16, nullable: 'NO', default_value: null },
    { table: 'replenishment_runs', name: 'model_name', data_type: 'character varying', max_length: 128, nullable: 'NO', default_value: null },
    { table: 'replenishment_runs', name: 'model_version', data_type: 'character varying', max_length: 64, nullable: 'YES', default_value: null },
    { table: 'replenishment_runs', name: 'forecast_start', data_type: 'date', max_length: null, nullable: 'NO', default_value: null },
    { table: 'replenishment_runs', name: 'forecast_end', data_type: 'date', max_length: null, nullable: 'NO', default_value: null },
    { table: 'replenishment_runs', name: 'review_period_days', data_type: 'integer', max_length: null, nullable: 'NO', default_value: null },
    { table: 'replenishment_runs', name: 'metadata_snapshot', data_type: 'jsonb', max_length: null, nullable: 'NO', default_value: null },
    { table: 'replenishment_runs', name: 'created_at', data_type: 'timestamp with time zone', max_length: null, nullable: 'NO', default_value: 'now()' },
    { table: 'replenishment_runs', name: 'created_by_user_id', data_type: 'integer', max_length: null, nullable: 'YES', default_value: null },
    { table: 'replenishment_recommendations', name: 'recommendation_id', data_type: 'bigint', max_length: null, nullable: 'NO', default_value: 'sequence' },
    { table: 'replenishment_recommendations', name: 'run_id', data_type: 'bigint', max_length: null, nullable: 'NO', default_value: null },
    { table: 'replenishment_recommendations', name: 'recommendation_index', data_type: 'integer', max_length: null, nullable: 'NO', default_value: null },
    { table: 'replenishment_recommendations', name: 'synthetic_product_id', data_type: 'character varying', max_length: 64, nullable: 'NO', default_value: null },
    { table: 'replenishment_recommendations', name: 'synthetic_supplier_id', data_type: 'character varying', max_length: 64, nullable: 'NO', default_value: null },
    { table: 'replenishment_recommendations', name: 'supplier_name', data_type: 'character varying', max_length: 150, nullable: 'NO', default_value: null },
    { table: 'replenishment_recommendations', name: 'recommendation_snapshot', data_type: 'jsonb', max_length: null, nullable: 'NO', default_value: null },
    { table: 'replenishment_recommendations', name: 'created_at', data_type: 'timestamp with time zone', max_length: null, nullable: 'NO', default_value: 'now()' },
    { table: 'replenishment_decisions', name: 'decision_id', data_type: 'bigint', max_length: null, nullable: 'NO', default_value: 'sequence' },
    { table: 'replenishment_decisions', name: 'recommendation_id', data_type: 'bigint', max_length: null, nullable: 'NO', default_value: null },
    { table: 'replenishment_decisions', name: 'decision', data_type: 'character varying', max_length: 10, nullable: 'NO', default_value: null },
    { table: 'replenishment_decisions', name: 'decided_at', data_type: 'timestamp with time zone', max_length: null, nullable: 'NO', default_value: 'now()' },
    { table: 'replenishment_decisions', name: 'decided_by_user_id', data_type: 'integer', max_length: null, nullable: 'YES', default_value: null },
  ],
};

// Exact column-name inventory for the original marketplace tables plus the
// columns introduced by migrations 001 and 002. This prevents an unrelated
// required/generated column from being silently adopted as a compatible legacy schema.
const expectedLegacyColumnNames: Partial<Record<MigrationName, Record<string, string[]>>> = {
  '001_auth.sql': {
    users: ['user_id', 'name', 'email', 'phone', 'address', 'password_hash', 'role'],
    user_sessions: ['session_id', 'user_id', 'token_hash', 'expires_at', 'created_at'],
  },
  '002_order_delivery.sql': {
    orders: ['order_id', 'user_id', 'order_date', 'status', 'total_amount', 'recipient_name', 'recipient_phone', 'delivery_city', 'delivery_address'],
  },
};

type ExpectedConstraint = Pick<LegacyConstraint, 'table' | 'type' | 'columns'> & Partial<Pick<LegacyConstraint,
  'referenced_schema' | 'referenced_table' | 'referenced_columns' | 'on_delete' | 'on_update' | 'match_type' | 'definition' |
  'validated' | 'enforced' | 'period' | 'deferrable' | 'deferred' | 'no_inherit'>>;
type ExpectedIndex = Pick<LegacyIndex, 'table' | 'name' | 'access_method' | 'is_unique' | 'columns'> &
  Partial<Pick<LegacyIndex, 'has_predicate' | 'predicate_definition'>>;

const expectedConstraints: Record<MigrationName, ExpectedConstraint[]> = {
  '001_auth.sql': [
    { table: 'user_sessions', type: 'p', columns: ['session_id'] },
    { table: 'user_sessions', type: 'u', columns: ['token_hash'] },
    { table: 'user_sessions', type: 'f', columns: ['user_id'], referenced_schema: 'public', referenced_table: 'users', referenced_columns: ['user_id'], on_delete: 'c' },
    { table: 'users', type: 'c', columns: ['role'], definition: 'role' },
  ],
  '002_order_delivery.sql': [],
  '003_audit_logs.sql': [
    { table: 'audit_logs', type: 'p', columns: ['log_id'] },
    { table: 'audit_logs', type: 'f', columns: ['user_id'], referenced_schema: 'public', referenced_table: 'users', referenced_columns: ['user_id'], on_delete: 'n' },
    { table: 'audit_logs', type: 'c', columns: ['status'], definition: 'status' },
  ],
  '004_anomaly_incidents.sql': [
    { table: 'anomaly_incidents', type: 'p', columns: ['incident_id'] },
    { table: 'anomaly_incidents', type: 'f', columns: ['subject_user_id'], referenced_schema: 'public', referenced_table: 'users', referenced_columns: ['user_id'], on_delete: 'n' },
    { table: 'anomaly_incidents', type: 'c', columns: ['anomaly_type'], definition: "check:anomaly_type in ('REPEATED_FAILED_LOGINS', 'REPEATED_ADMIN_ACCESS_DENIED', 'UNUSUAL_ORDER_ACTIVITY')" },
    { table: 'anomaly_incidents', type: 'c', columns: ['severity'], definition: "check:severity in ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL')" },
    { table: 'anomaly_incidents', type: 'c', columns: ['risk_score'], definition: 'check:risk_score >= 0 AND risk_score <= 100' },
    { table: 'anomaly_incidents', type: 'c', columns: ['status'], definition: "check:status in ('NEW', 'INVESTIGATING', 'RESOLVED', 'FALSE_POSITIVE')" },
    { table: 'anomaly_incident_events', type: 'p', columns: ['incident_id', 'log_id'] },
    { table: 'anomaly_incident_events', type: 'f', columns: ['incident_id'], referenced_schema: 'public', referenced_table: 'anomaly_incidents', referenced_columns: ['incident_id'], on_delete: 'c' },
    { table: 'anomaly_incident_events', type: 'f', columns: ['log_id'], referenced_schema: 'public', referenced_table: 'audit_logs', referenced_columns: ['log_id'], on_delete: 'c' },
    { table: 'anomaly_event_queue', type: 'p', columns: ['log_id'] },
    { table: 'anomaly_event_queue', type: 'f', columns: ['log_id'], referenced_schema: 'public', referenced_table: 'audit_logs', referenced_columns: ['log_id'], on_delete: 'c' },
    { table: 'anomaly_event_queue', type: 'c', columns: ['attempts'], definition: 'check:attempts >= 0' },
  ],
  '005_anomaly_queue_dead_letter.sql': [],
  '006_jeffreys_shadow_mode.sql': [
    { table: 'jeffreys_shadow_checkpoint', type: 'p', columns: ['singleton_id'] },
    { table: 'jeffreys_shadow_checkpoint', type: 'c', columns: ['singleton_id'], definition: 'check:singleton_id = 1' },
    { table: 'jeffreys_shadow_evaluations', type: 'p', columns: ['evaluation_id'] },
    { table: 'jeffreys_shadow_evaluations', type: 'u', columns: ['profile_version', 'subject_user_id', 'evaluated_at'] },
    { table: 'jeffreys_shadow_evaluations', type: 'c', columns: ['baseline_observations'], definition: 'check:baseline_observations IS NULL OR baseline_observations >= 0' },
    { table: 'jeffreys_shadow_evaluations', type: 'c', columns: ['current_observations'], definition: 'check:current_observations IS NULL OR current_observations >= 0' },
    { table: 'jeffreys_shadow_evaluations', type: 'c', columns: ['evaluation_status'], definition: "check:evaluation_status IN ('SUFFICIENT_DATA', 'INSUFFICIENT_DATA', 'WORK_LIMIT_EXCEEDED', 'EVALUATION_ERROR')" },
  ],
  '007_replenishment_history.sql': [
    { table: 'replenishment_runs', type: 'p', columns: ['run_id'] },
    { table: 'replenishment_runs', type: 'f', columns: ['created_by_user_id'], referenced_schema: 'public', referenced_table: 'users', referenced_columns: ['user_id'], on_delete: 'n' },
    { table: 'replenishment_runs', type: 'c', columns: ['source'], definition: "check:source = 'SYNTHETIC'" },
    { table: 'replenishment_runs', type: 'c', columns: ['review_period_days'], definition: 'check:review_period_days >= 0' },
    { table: 'replenishment_runs', type: 'c', columns: ['forecast_start', 'forecast_end'], definition: 'check:forecast_start <= forecast_end' },
    { table: 'replenishment_recommendations', type: 'p', columns: ['recommendation_id'] },
    { table: 'replenishment_recommendations', type: 'f', columns: ['run_id'], referenced_schema: 'public', referenced_table: 'replenishment_runs', referenced_columns: ['run_id'], on_delete: 'r' },
    { table: 'replenishment_recommendations', type: 'u', columns: ['run_id', 'recommendation_index'] },
    { table: 'replenishment_recommendations', type: 'c', columns: ['recommendation_index'], definition: 'check:recommendation_index >= 0' },
    { table: 'replenishment_decisions', type: 'p', columns: ['decision_id'] },
    { table: 'replenishment_decisions', type: 'f', columns: ['recommendation_id'], referenced_schema: 'public', referenced_table: 'replenishment_recommendations', referenced_columns: ['recommendation_id'], on_delete: 'r' },
    { table: 'replenishment_decisions', type: 'f', columns: ['decided_by_user_id'], referenced_schema: 'public', referenced_table: 'users', referenced_columns: ['user_id'], on_delete: 'n' },
    { table: 'replenishment_decisions', type: 'u', columns: ['recommendation_id'] },
    { table: 'replenishment_decisions', type: 'c', columns: ['decision'], definition: "check:decision IN ('ACCEPTED', 'REJECTED')" },
  ],
};

// Constraints from the original marketplace schema are allowed when recognizing
// migrations. They are not migration effects, but rejecting them would make an
// otherwise valid pre-migration schema impossible to adopt.
const originalSchemaConstraints: Record<MigrationName, ExpectedConstraint[]> = {
  '001_auth.sql': [
    { table: 'users', type: 'p', columns: ['user_id'] },
    { table: 'users', type: 'u', columns: ['email'] },
    { table: 'users', type: 'u', columns: ['phone'] },
  ],
  '002_order_delivery.sql': [
    { table: 'orders', type: 'p', columns: ['order_id'] },
    { table: 'orders', type: 'f', columns: ['user_id'], referenced_schema: 'public', referenced_table: 'users', referenced_columns: ['user_id'], on_delete: 'a' },
  ],
  '003_audit_logs.sql': [],
  '004_anomaly_incidents.sql': [],
  '005_anomaly_queue_dead_letter.sql': [
    { table: 'anomaly_event_queue', type: 'p', columns: ['log_id'] },
    { table: 'anomaly_event_queue', type: 'f', columns: ['log_id'], referenced_schema: 'public', referenced_table: 'audit_logs', referenced_columns: ['log_id'], on_delete: 'c' },
    { table: 'anomaly_event_queue', type: 'c', columns: ['attempts'], definition: 'check:attempts >= 0' },
  ],
  '006_jeffreys_shadow_mode.sql': [],
  '007_replenishment_history.sql': [],
};

const expectedIndexes: Record<MigrationName, ExpectedIndex[]> = {
  '001_auth.sql': [
    { table: 'user_sessions', name: 'user_sessions_expiry_idx', access_method: 'btree', is_unique: false, columns: [{ name: 'expires_at', descending: false, nulls_first: false }] },
  ],
  '002_order_delivery.sql': [],
  '003_audit_logs.sql': [
    { table: 'audit_logs', name: 'audit_logs_created_idx', access_method: 'btree', is_unique: false, columns: [{ name: 'created_at', descending: true, nulls_first: true }, { name: 'log_id', descending: true, nulls_first: true }] },
    { table: 'audit_logs', name: 'audit_logs_user_created_idx', access_method: 'btree', is_unique: false, columns: [{ name: 'user_id', descending: false, nulls_first: false }, { name: 'created_at', descending: true, nulls_first: true }] },
    { table: 'audit_logs', name: 'audit_logs_action_created_idx', access_method: 'btree', is_unique: false, columns: [{ name: 'action', descending: false, nulls_first: false }, { name: 'created_at', descending: true, nulls_first: true }] },
    { table: 'audit_logs', name: 'audit_logs_status_created_idx', access_method: 'btree', is_unique: false, columns: [{ name: 'status', descending: false, nulls_first: false }, { name: 'created_at', descending: true, nulls_first: true }] },
  ],
  '004_anomaly_incidents.sql': [
    { table: 'anomaly_incidents', name: 'anomaly_incidents_active_dedupe_uq', access_method: 'btree', is_unique: true,
      columns: [{ name: 'deduplication_key', descending: false, nulls_first: false }], has_predicate: true,
      predicate_definition: "status IN ('NEW', 'INVESTIGATING')" },
    { table: 'anomaly_incidents', name: 'anomaly_incidents_detected_idx', access_method: 'btree', is_unique: false,
      columns: [{ name: 'detected_at', descending: true, nulls_first: true }, { name: 'incident_id', descending: true, nulls_first: true }] },
    { table: 'anomaly_incidents', name: 'anomaly_incidents_status_detected_idx', access_method: 'btree', is_unique: false,
      columns: [{ name: 'status', descending: false, nulls_first: false }, { name: 'detected_at', descending: true, nulls_first: true }] },
    { table: 'anomaly_incident_events', name: 'anomaly_incident_events_log_idx', access_method: 'btree', is_unique: false,
      columns: [{ name: 'log_id', descending: false, nulls_first: false }] },
    { table: 'anomaly_event_queue', name: 'anomaly_event_queue_pending_idx', access_method: 'btree', is_unique: false,
      columns: [{ name: 'available_at', descending: false, nulls_first: false }, { name: 'log_id', descending: false, nulls_first: false }],
      has_predicate: true, predicate_definition: 'processed_at IS NULL' },
  ],
  '005_anomaly_queue_dead_letter.sql': [],
  '006_jeffreys_shadow_mode.sql': [
    { table: 'jeffreys_shadow_evaluations', name: 'jeffreys_shadow_eval_window_uq', access_method: 'btree', is_unique: true,
      columns: [{ name: 'profile_version', descending: false, nulls_first: false }, { name: 'subject_user_id', descending: false, nulls_first: false }, { name: 'evaluated_at', descending: false, nulls_first: false }] },
    { table: 'jeffreys_shadow_evaluations', name: 'jeffreys_shadow_eval_user_time_idx', access_method: 'btree', is_unique: false,
      columns: [{ name: 'profile_version', descending: false, nulls_first: false }, { name: 'subject_user_id', descending: false, nulls_first: false }, { name: 'evaluated_at', descending: true, nulls_first: true }] },
    { table: 'jeffreys_shadow_evaluations', name: 'jeffreys_shadow_eval_profile_time_idx', access_method: 'btree', is_unique: false,
      columns: [{ name: 'profile_version', descending: false, nulls_first: false }, { name: 'evaluated_at', descending: true, nulls_first: true }] },
  ],
  '007_replenishment_history.sql': [
    { table: 'replenishment_runs', name: 'replenishment_runs_created_idx', access_method: 'btree', is_unique: false,
      columns: [{ name: 'created_at', descending: true, nulls_first: true }, { name: 'run_id', descending: true, nulls_first: true }] },
    { table: 'replenishment_recommendations', name: 'replenishment_recommendations_product_idx', access_method: 'btree', is_unique: false,
      columns: [{ name: 'run_id', descending: false, nulls_first: false }, { name: 'synthetic_product_id', descending: false, nulls_first: false }, { name: 'recommendation_index', descending: false, nulls_first: false }] },
  ],
};

const relevantTables: Record<MigrationName, string[]> = {
  '001_auth.sql': ['users', 'user_sessions'],
  '002_order_delivery.sql': ['orders'],
  '003_audit_logs.sql': ['audit_logs'],
  '004_anomaly_incidents.sql': ['anomaly_incidents', 'anomaly_incident_events', 'anomaly_event_queue'],
  '005_anomaly_queue_dead_letter.sql': ['anomaly_event_queue'],
  '006_jeffreys_shadow_mode.sql': ['jeffreys_shadow_checkpoint', 'jeffreys_shadow_evaluations'],
  '007_replenishment_history.sql': ['replenishment_runs', 'replenishment_recommendations', 'replenishment_decisions'],
};
const legacyMarkers: Record<MigrationName, { relations: string[]; columns: Array<[string, string]>; constraints: string[]; indexes: string[]; triggers: string[]; functions: string[] }> = {
  '001_auth.sql': {
    relations: ['user_sessions'], columns: [['users', 'password_hash'], ['users', 'role']],
    constraints: ['users_role_check', 'user_sessions_pkey', 'user_sessions_user_id_fkey', 'user_sessions_token_hash_key'],
    indexes: ['user_sessions_expiry_idx'], triggers: [], functions: [],
  },
  '002_order_delivery.sql': {
    relations: [], columns: ['recipient_name', 'recipient_phone', 'delivery_city', 'delivery_address'].map((name): [string, string] => ['orders', name]),
    constraints: [], indexes: [], triggers: [], functions: [],
  },
  '003_audit_logs.sql': {
    relations: ['audit_logs'], columns: [],
    constraints: ['audit_logs_pkey', 'audit_logs_user_id_fkey', 'audit_logs_status_check'],
    indexes: ['audit_logs_created_idx', 'audit_logs_user_created_idx', 'audit_logs_action_created_idx', 'audit_logs_status_created_idx'], triggers: [], functions: [],
  },
  '004_anomaly_incidents.sql': {
    relations: ['anomaly_incidents', 'anomaly_incident_events', 'anomaly_event_queue'], columns: [],
    constraints: ['anomaly_incidents_pkey', 'anomaly_incident_events_pkey', 'anomaly_event_queue_pkey'],
    indexes: ['anomaly_incidents_active_dedupe_uq', 'anomaly_incidents_detected_idx', 'anomaly_incidents_status_detected_idx', 'anomaly_incident_events_log_idx', 'anomaly_event_queue_pending_idx'],
    triggers: ['audit_logs_enqueue_anomaly_event'], functions: ['enqueue_anomaly_audit_event'],
  },
  '005_anomaly_queue_dead_letter.sql': {
    relations: [], columns: [['anomaly_event_queue', 'last_error'], ['anomaly_event_queue', 'dead_lettered_at']],
    constraints: [], indexes: [], triggers: [], functions: [],
  },
  '006_jeffreys_shadow_mode.sql': {
    relations: ['jeffreys_shadow_checkpoint', 'jeffreys_shadow_evaluations'],
    columns: [['jeffreys_shadow_checkpoint', 'configuration_signature'], ['jeffreys_shadow_evaluations', 'divergence']],
    constraints: ['jeffreys_shadow_checkpoint_pkey', 'jeffreys_shadow_eval_window_uq', 'jeffreys_shadow_eval_baseline_count_check'],
    indexes: ['jeffreys_shadow_eval_user_time_idx', 'jeffreys_shadow_eval_profile_time_idx'], triggers: [], functions: [],
  },
  '007_replenishment_history.sql': {
    relations: ['replenishment_runs', 'replenishment_recommendations', 'replenishment_decisions'],
    columns: [], constraints: [
      'replenishment_runs_pkey', 'replenishment_recommendations_pkey', 'replenishment_recommendations_run_index_uq',
      'replenishment_decisions_pkey', 'replenishment_decisions_recommendation_uq',
    ],
    indexes: ['replenishment_runs_created_idx', 'replenishment_recommendations_product_idx'], triggers: [], functions: [],
  },
};

const checkDefinitionIsExact = (definition: string, column: 'role' | 'status') => {
  const normalized = definition.toLowerCase()
    .replace(/::(?:character varying|varchar|text)(?:\[\])?/g, '')
    .replace(/\s+/g, '')
    .replace(/[()]/g, '');
  const values = column === 'role' ? "'user','admin'" : "'success','failure'";
  return normalized === `check${column}in${values}` || normalized === `check${column}=anyarray[${values}]`;
};

const normalizeCheck = (definition: string) => definition.toLowerCase()
  .replace(/::(?:character varying|varchar|text)(?:\[\])?/g, '')
  .replace(/\s+/g, '')
  .replace(/^check/, '')
  .replace(/[()]/g, '')
  .replace(/=anyarray\[/g, 'in')
  .replace(/\]$/g, '');

const normalizeDefault = (value: string | null) => value?.toLowerCase()
  .replace(/::character varying|::varchar|::jsonb/g, '')
  .replace(/\s+/g, '') ?? null;

function matchesColumn(actual: LegacyColumn | undefined, expected: LegacyColumn): boolean {
  if (!actual || actual.table !== expected.table || actual.name !== expected.name ||
      actual.data_type !== expected.data_type || actual.max_length !== expected.max_length || actual.nullable !== expected.nullable) return false;
  if ((expected.numeric_precision !== undefined && actual.numeric_precision !== expected.numeric_precision) ||
      (expected.numeric_scale !== undefined && actual.numeric_scale !== expected.numeric_scale)) return false;
  if ((actual.is_identity ?? 'NO') !== (expected.is_identity ?? 'NO') ||
      (actual.identity_generation ?? '') !== (expected.identity_generation ?? '') ||
      (actual.is_generated ?? 'NEVER') !== (expected.is_generated ?? 'NEVER') ||
      (actual.generation_expression ?? null) !== (expected.generation_expression ?? null)) return false;
  if (expected.default_value === 'sequence') return actual.default_value !== null && /^nextval\('.+'::regclass\)$/.test(actual.default_value.replace(/\s+/g, ''));
  return normalizeDefault(actual.default_value) === expected.default_value;
}

function matchesConstraint(actual: LegacyConstraint | undefined, expected: ExpectedConstraint): boolean {
  if (!actual || actual.table !== expected.table || actual.type !== expected.type ||
      JSON.stringify(actual.columns) !== JSON.stringify(expected.columns)) return false;
  if ((actual.validated ?? true) !== (expected.validated ?? true) ||
      (actual.enforced ?? true) !== (expected.enforced ?? true) ||
      (actual.deferrable ?? false) !== (expected.deferrable ?? false) ||
      (actual.deferred ?? false) !== (expected.deferred ?? false)) return false;
  if (actual.type === 'c' && (actual.no_inherit ?? false) !== (expected.no_inherit ?? false)) return false;
  if (actual.type === 'f' && (expected.referenced_schema !== undefined &&
      (actual.referenced_schema !== expected.referenced_schema || actual.referenced_table !== expected.referenced_table ||
        JSON.stringify(actual.referenced_columns) !== JSON.stringify(expected.referenced_columns) ||
        (actual.on_delete ?? 'a') !== (expected.on_delete ?? 'a') || (actual.on_update ?? 'a') !== (expected.on_update ?? 'a') ||
        (actual.match_type ?? 's') !== (expected.match_type ?? 's') ||
        (actual.period ?? false) !== (expected.period ?? false)))) return false;
  if (expected.definition === 'role' || expected.definition === 'status') {
    return checkDefinitionIsExact(actual.definition, expected.definition);
  }
  if (expected.definition?.startsWith('check:')) {
    return normalizeCheck(actual.definition) === normalizeCheck(expected.definition.slice('check:'.length));
  }
  return true;
}

function matchesIndex(actual: LegacyIndex | undefined, expected: ExpectedIndex): boolean {
  return Boolean(actual && actual.schema === 'public' && actual.table === expected.table && actual.name === expected.name &&
    actual.access_method === expected.access_method && actual.is_unique === expected.is_unique && actual.is_valid &&
    actual.is_ready === true && actual.is_live === true && actual.is_immediate === true && actual.nulls_not_distinct === false &&
    !actual.has_expression && actual.has_predicate === (expected.has_predicate ?? false) && !actual.has_included_columns &&
    (expected.predicate_definition == null || normalizeCheck(actual.predicate_definition ?? '') === normalizeCheck(expected.predicate_definition)) &&
    actual.columns.length === expected.columns.length && actual.columns.every((column, position) => {
      const expectedColumn = expected.columns[position];
      return column.name === expectedColumn.name && column.descending === expectedColumn.descending &&
        column.nulls_first === expectedColumn.nulls_first && column.operator_class_is_default === true &&
        column.collation_matches_column === true &&
        (expectedColumn.operator_class_is_default === undefined || column.operator_class_is_default === expectedColumn.operator_class_is_default) &&
        (expectedColumn.collation_matches_column === undefined || column.collation_matches_column === expectedColumn.collation_matches_column);
    }));
}

function isAllowedAdditionalUniqueIndex(index: LegacyIndex, allowedConstraints: ExpectedConstraint[], expectedIndexes: ExpectedIndex[]): boolean {
  if (!index.is_unique) return true;
  if (!index.is_valid || index.is_ready !== true || index.is_live !== true || index.is_immediate !== true || index.nulls_not_distinct !== false) return false;
  if (expectedIndexes.some((expected) => matchesIndex(index, expected))) return true;
  if (!index.constraint_name || index.access_method !== 'btree' || index.has_expression || index.has_predicate || index.has_included_columns ||
      index.columns.some((column) => column.operator_class_is_default !== true || column.collation_matches_column !== true)) return false;
  return allowedConstraints.some((constraint) =>
    constraint.table === index.table && (constraint.type === 'p' || constraint.type === 'u') &&
    index.columns.length === constraint.columns.length && constraint.columns.every((name, position) => {
      const column = index.columns[position];
      return column.name === name && !column.descending && !column.nulls_first;
    }),
  );
}

export interface LegacySchemaMismatch {
  table: string;
  object: string;
  expected: unknown;
  actual: unknown;
}

/** Returns concrete schema differences without exposing row data or connection details. */
export function diagnoseLegacyMigration(name: MigrationName, snapshot: LegacySchemaSnapshot): LegacySchemaMismatch[] {
  const mismatches: LegacySchemaMismatch[] = [];
  const markers = legacyMarkers[name];
  const allowedConstraints = [...expectedConstraints[name], ...originalSchemaConstraints[name]];
  const add = (table: string, object: string, expected: unknown, actual: unknown) => {
    mismatches.push({ table, object, expected, actual });
  };

  for (const expected of expectedColumns[name]) {
    const actual = snapshot.columns.find((column) => column.table === expected.table && column.name === expected.name);
    if (!matchesColumn(actual, expected)) add(expected.table, `column ${expected.name}`, expected, actual ?? null);
  }

  for (const [table, expectedNames] of Object.entries(expectedLegacyColumnNames[name] ?? {})) {
    const actualColumns = snapshot.columns.filter((column) => column.table === table);
    const actualNames = actualColumns.map((column) => column.name).sort();
    const sortedExpectedNames = [...expectedNames].sort();
    if (JSON.stringify(actualNames) !== JSON.stringify(sortedExpectedNames)) {
      add(table, 'column set', sortedExpectedNames, actualNames);
    }
  }

  for (const expected of expectedConstraints[name]) {
    const actual = snapshot.constraints.find((constraint) => constraint.table === expected.table &&
      constraint.type === expected.type && JSON.stringify(constraint.columns) === JSON.stringify(expected.columns));
    if (!matchesConstraint(actual, expected)) add(expected.table, `constraint ${actual?.name ?? expected.type}`, expected, actual ?? null);
  }
  for (const actual of snapshot.constraints.filter((constraint) => relevantTables[name].includes(constraint.table))) {
    if (!allowedConstraints.some((expected) => matchesConstraint(actual, expected))) {
      add(actual.table, `constraint ${actual.name}`, 'one of the expected migration or original-schema constraints', actual);
    }
  }

  for (const expected of expectedIndexes[name]) {
    const actual = snapshot.indexes.find((index) => index.schema === 'public' && index.name === expected.name);
    if (!matchesIndex(actual, expected)) add(expected.table, `index ${expected.name}`, expected, actual ?? null);
  }
  for (const actual of snapshot.indexes.filter((index) => index.schema === 'public' && relevantTables[name].includes(index.table))) {
    if (!isAllowedAdditionalUniqueIndex(actual, allowedConstraints, expectedIndexes[name])) {
      add(actual.table, `unique index ${actual.name}`, 'non-conflicting index matching an expected or original constraint', actual);
    }
  }

  for (const trigger of markers.triggers) {
    if (!snapshot.triggers?.includes(trigger)) add('audit_logs', `trigger ${trigger}`, 'present', 'missing');
  }
  for (const fn of markers.functions) {
    if (!snapshot.functions?.includes(fn)) add('public', `function ${fn}`, 'present', 'missing');
  }
  if (name === '004_anomaly_incidents.sql' && snapshot.anomaly_trigger_compatible !== true) {
    add('audit_logs', 'trigger/function binding', 'enabled AFTER INSERT trigger with the expected trigger function definition', snapshot.anomaly_trigger_compatible ?? false);
  }

  return mismatches;
}

export function assessLegacyMigration(name: MigrationName, snapshot: LegacySchemaSnapshot): LegacyState {
  const markers = legacyMarkers[name];
  const started = markers.relations.some((table) => snapshot.relations.includes(table)) ||
    markers.columns.some(([table, column]) => snapshot.columns.some((actual) => actual.table === table && actual.name === column)) ||
    markers.constraints.some((constraintName) => snapshot.constraints.some((actual) => actual.name === constraintName)) ||
    markers.indexes.some((indexName) => snapshot.indexes.some((actual) => actual.name === indexName)) ||
    markers.triggers.some((triggerName) => snapshot.triggers?.includes(triggerName)) ||
    markers.functions.some((functionName) => snapshot.functions?.includes(functionName));
  return { complete: diagnoseLegacyMigration(name, snapshot).length === 0, started };
}

const schemaSnapshotSql = `
  SELECT
    COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'table', table_name, 'name', column_name, 'data_type', data_type,
      'max_length', character_maximum_length, 'numeric_precision', numeric_precision, 'numeric_scale', numeric_scale,
      'nullable', is_nullable, 'default_value', column_default,
      'is_identity', COALESCE(to_jsonb(column_info)->>'is_identity', 'NO'),
      'identity_generation', COALESCE(to_jsonb(column_info)->>'identity_generation', ''),
      'is_generated', COALESCE(to_jsonb(column_info)->>'is_generated', 'NEVER'),
      'generation_expression', to_jsonb(column_info)->>'generation_expression'))
      FROM information_schema.columns AS column_info WHERE table_schema='public' AND table_name = ANY($1::text[])), '[]'::jsonb) AS columns,
    COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'table', rel.relname, 'name', con.conname, 'type', con.contype,
      'columns', ARRAY(SELECT attr.attname FROM unnest(con.conkey) WITH ORDINALITY AS key(attnum, ord)
        JOIN pg_attribute attr ON attr.attrelid=con.conrelid AND attr.attnum=key.attnum AND NOT attr.attisdropped ORDER BY key.ord),
      'referenced_schema', ref_ns.nspname, 'referenced_table', ref.relname,
      'referenced_columns', ARRAY(SELECT attr.attname FROM unnest(con.confkey) WITH ORDINALITY AS key(attnum, ord)
        JOIN pg_attribute attr ON attr.attrelid=con.confrelid AND attr.attnum=key.attnum AND NOT attr.attisdropped ORDER BY key.ord),
      'on_delete', con.confdeltype, 'on_update', con.confupdtype, 'match_type', con.confmatchtype,
      'validated', COALESCE(con.convalidated, true), 'enforced', COALESCE((to_jsonb(con)->>'conenforced')::boolean, true),
      'period', COALESCE((to_jsonb(con)->>'conperiod')::boolean, false),
      'deferrable', COALESCE(con.condeferrable, false), 'deferred', COALESCE(con.condeferred, false),
      'no_inherit', COALESCE(con.connoinherit, false), 'definition', pg_get_constraintdef(con.oid)) ORDER BY con.conname)
      FROM pg_constraint con JOIN pg_class rel ON rel.oid=con.conrelid
      JOIN pg_namespace ns ON ns.oid=rel.relnamespace
      LEFT JOIN pg_class ref ON ref.oid=con.confrelid LEFT JOIN pg_namespace ref_ns ON ref_ns.oid=ref.relnamespace
      WHERE ns.nspname='public' AND rel.relname = ANY($1::text[])), '[]'::jsonb) AS constraints,
    COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'schema', ns.nspname, 'table', tbl.relname, 'name', idx.relname,
      'constraint_name', owner_con.conname,
      'access_method', am.amname, 'is_unique', i.indisunique,
      'nulls_not_distinct', COALESCE((to_jsonb(i)->>'indnullsnotdistinct')::boolean, false),
      'is_immediate', i.indimmediate,
      'is_valid', i.indisvalid, 'is_ready', i.indisready, 'is_live', i.indislive,
      'has_expression', i.indexprs IS NOT NULL, 'has_predicate', i.indpred IS NOT NULL,
      'predicate_definition', pg_get_expr(i.indpred, i.indrelid),
      'has_included_columns', i.indnatts <> i.indnkeyatts,
      'columns', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'name', attr.attname,
        'descending', pg_index_column_has_property(i.indexrelid, key.ord::int, 'desc'),
        'nulls_first', pg_index_column_has_property(i.indexrelid, key.ord::int, 'nulls_first'),
        'operator_class_is_default', COALESCE(opc.opcdefault, false),
        'collation_matches_column', i.indcollation[key.ord::int - 1] IS NOT DISTINCT FROM attr.attcollation) ORDER BY key.ord)
        FROM unnest(i.indkey) WITH ORDINALITY AS key(attnum, ord)
        JOIN pg_attribute attr ON attr.attrelid=i.indrelid AND attr.attnum=key.attnum AND NOT attr.attisdropped
        LEFT JOIN pg_opclass opc ON opc.oid=i.indclass[key.ord::int - 1]
        WHERE key.ord <= i.indnkeyatts), '[]'::jsonb)) ORDER BY idx.relname)
      FROM pg_index i JOIN pg_class idx ON idx.oid=i.indexrelid JOIN pg_class tbl ON tbl.oid=i.indrelid
      JOIN pg_namespace ns ON ns.oid=tbl.relnamespace JOIN pg_am am ON am.oid=idx.relam
      LEFT JOIN pg_constraint owner_con ON owner_con.conindid=i.indexrelid AND owner_con.contype IN ('p','u')
      WHERE ns.nspname='public' AND tbl.relname = ANY($1::text[])), '[]'::jsonb) AS indexes,
    COALESCE((SELECT array_agg(relname ORDER BY relname) FROM pg_class rel JOIN pg_namespace ns ON ns.oid=rel.relnamespace
      WHERE ns.nspname='public' AND rel.relkind IN ('r','p') AND rel.relname = ANY($1::text[])), ARRAY[]::text[]) AS relations,
    COALESCE((SELECT array_agg(tg.tgname ORDER BY tg.tgname)
      FROM pg_trigger tg JOIN pg_class rel ON rel.oid=tg.tgrelid JOIN pg_namespace ns ON ns.oid=rel.relnamespace
      WHERE ns.nspname='public' AND rel.relname='audit_logs' AND NOT tg.tgisinternal), ARRAY[]::text[]) AS triggers,
    COALESCE((SELECT array_agg(proc.proname ORDER BY proc.proname)
      FROM pg_proc proc JOIN pg_namespace ns ON ns.oid=proc.pronamespace
      WHERE ns.nspname='public' AND proc.proname='enqueue_anomaly_audit_event'), ARRAY[]::text[]) AS functions,
    COALESCE((SELECT array_agg(pg_get_triggerdef(tg.oid) ORDER BY tg.tgname)
      FROM pg_trigger tg JOIN pg_class rel ON rel.oid=tg.tgrelid JOIN pg_namespace ns ON ns.oid=rel.relnamespace
      WHERE ns.nspname='public' AND rel.relname='audit_logs' AND tg.tgname='audit_logs_enqueue_anomaly_event' AND NOT tg.tgisinternal), ARRAY[]::text[]) AS trigger_definitions,
    COALESCE((SELECT array_agg(proc.prosrc ORDER BY proc.oid)
      FROM pg_proc proc JOIN pg_namespace ns ON ns.oid=proc.pronamespace
      WHERE ns.nspname='public' AND proc.proname='enqueue_anomaly_audit_event'), ARRAY[]::text[]) AS function_definitions,
    EXISTS (
      SELECT 1 FROM pg_trigger tg
      JOIN pg_class rel ON rel.oid=tg.tgrelid
      JOIN pg_namespace ns ON ns.oid=rel.relnamespace
      JOIN pg_proc proc ON proc.oid=tg.tgfoid
      JOIN pg_namespace fn_ns ON fn_ns.oid=proc.pronamespace
      JOIN pg_language lang ON lang.oid=proc.prolang
      WHERE ns.nspname='public' AND rel.relname='audit_logs'
        AND tg.tgname='audit_logs_enqueue_anomaly_event' AND NOT tg.tgisinternal
        AND tg.tgtype=5 AND tg.tgenabled IN ('O','A')
        AND fn_ns.nspname='public' AND proc.proname='enqueue_anomaly_audit_event'
        AND proc.prorettype='pg_catalog.trigger'::regtype AND lang.lanname='plpgsql'
        AND regexp_replace(lower(proc.prosrc), '\\s+', '', 'g') =
          'begininsertintopublic.anomaly_event_queue(log_id)values(new.log_id)onconflict(log_id)donothing;returnnew;end;'
    ) AS anomaly_trigger_compatible`;

async function legacyState(client: PoolClient, name: MigrationName): Promise<{ state: LegacyState; snapshot: LegacySchemaSnapshot }> {
  const { rows } = await client.query<LegacySchemaSnapshot>(schemaSnapshotSql, [relevantTables[name]]);
  if (!rows[0]) throw new Error(`Could not inspect legacy schema for migration ${name}.`);
  return { state: assessLegacyMigration(name, rows[0]), snapshot: rows[0] };
}

function formatLegacyMismatches(mismatches: LegacySchemaMismatch[]): string {
  return mismatches.map(({ table, object, expected, actual }) =>
    `${table}.${object}: expected=${JSON.stringify(expected)}, actual=${JSON.stringify(actual)}`,
  ).join('; ');
}

/** Refuse migration execution unless the active connection targets the local test database. */
export async function assertMigrationTargetDatabase(client: Pick<PoolClient, 'query'>): Promise<void> {
  const { rows } = await client.query<{ database_name: string }>(
    'SELECT current_database() AS database_name',
  );
  const databaseName = rows[0]?.database_name;
  if (databaseName !== 'market_db_test') {
    throw new Error(
      `Refusing to run migrations: expected database "market_db_test", connected database is "${databaseName ?? 'unknown'}". No migrations were run.`,
    );
  }
}

/** A distinct active-connection guard for the one restored copy used for migration testing. */
export async function assertMigrationCopyTargetDatabase(client: Pick<PoolClient, 'query'>): Promise<void> {
  const { rows } = await client.query<{
    database_name: string;
    server_address: string | null;
    server_port: number | null;
  }>(`SELECT current_database() AS database_name,
            inet_server_addr()::text AS server_address,
            inet_server_port() AS server_port`);
  const identity = rows[0];
  const isLoopback = identity?.server_address === '127.0.0.1' || identity?.server_address === '127.0.0.1/32';
  const databaseMatches = identity?.database_name === 'market_db_migration_test';
  const portMatches = identity?.server_port === 5432;
  if (!databaseMatches || !isLoopback || !portMatches) {
    // These identity fields are safe to report; never include the connection URL or credentials.
    throw new Error(
      `Refusing migration-copy run: active identity database=${JSON.stringify(identity?.database_name ?? null)}, ` +
      `server_address=${JSON.stringify(identity?.server_address ?? null)}, ` +
      `server_port=${JSON.stringify(identity?.server_port ?? null)}; expected database="market_db_migration_test", ` +
      'server_address="127.0.0.1", server_port=5432. No migrations were run.',
    );
  }
}

/** A distinct active-connection guard for the primary local database runner. */
export async function assertMigrationMainTargetDatabase(client: Pick<PoolClient, 'query'>): Promise<void> {
  const { rows } = await client.query<{
    database_name: string;
    server_address: string | null;
    server_port: number | null;
  }>(`SELECT current_database() AS database_name,
            inet_server_addr()::text AS server_address,
            inet_server_port() AS server_port`);
  const identity = rows[0];
  const isIpv4Loopback = identity?.server_address === '127.0.0.1' || identity?.server_address === '127.0.0.1/32';
  if (identity?.database_name !== 'market_db' || !isIpv4Loopback || identity.server_port !== 5432) {
    throw new Error(
      `Refusing migration-main run: active identity database=${JSON.stringify(identity?.database_name ?? null)}, ` +
      `server_address=${JSON.stringify(identity?.server_address ?? null)}, ` +
      `server_port=${JSON.stringify(identity?.server_port ?? null)}; expected database="market_db", ` +
      'server_address="127.0.0.1", server_port=5432. No migrations were run.',
    );
  }
}

/** Applies migrations once, adopting only a structurally exact legacy schema. */
export async function applyMigrations(client: PoolClient, migrations: MigrationFile[]): Promise<string[]> {
  await client.query('BEGIN');
  try {
    await client.query('SELECT pg_advisory_xact_lock(741923641)');
    await client.query(`CREATE TABLE IF NOT EXISTS public.schema_migrations (
      migration_name VARCHAR(120) PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`);

    const appliedRows = await client.query<{ migration_name: string }>(
      'SELECT migration_name FROM public.schema_migrations',
    );
    const applied = new Set(appliedRows.rows.map((row) => row.migration_name));
    const completed: string[] = [];

    for (const migration of migrations) {
      if (applied.has(migration.name)) continue;
      const { state: legacy, snapshot } = await legacyState(client, migration.name as MigrationName);
      if (legacy.complete) {
        await client.query('INSERT INTO public.schema_migrations (migration_name) VALUES ($1)', [migration.name]);
        completed.push(`${migration.name} (recognized existing schema)`);
        continue;
      }
      if (legacy.started) {
        const mismatches = diagnoseLegacyMigration(migration.name as MigrationName, snapshot);
        throw new Error(`Migration ${migration.name} has a partial or incompatible existing schema. ` +
          `${formatLegacyMismatches(mismatches)} Review it manually; no migration changes were committed.`);
      }

      await client.query(migration.sql);
      await client.query('INSERT INTO public.schema_migrations (migration_name) VALUES ($1)', [migration.name]);
      completed.push(migration.name);
    }

    await client.query('COMMIT');
    return completed;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  }
}
