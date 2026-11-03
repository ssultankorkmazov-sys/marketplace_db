import type { PoolClient } from 'pg';

export interface MigrationFile {
  name: string;
  sql: string;
}

export type MigrationName = '001_auth.sql' | '002_order_delivery.sql' | '003_audit_logs.sql' | '004_anomaly_incidents.sql' | '005_anomaly_queue_dead_letter.sql';
export interface LegacyColumn {
  table: string;
  name: string;
  data_type: string;
  max_length: number | null;
  nullable: 'YES' | 'NO';
  default_value: string | null;
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
  definition: string;
}
export interface LegacyIndexColumn {
  name: string | null;
  descending: boolean;
  nulls_first: boolean;
}
export interface LegacyIndex {
  schema: string;
  table: string;
  name: string;
  constraint_name: string | null;
  access_method: string;
  is_unique: boolean;
  is_valid: boolean;
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
    { table: 'users', name: 'password_hash', data_type: 'text', max_length: null, nullable: 'YES', default_value: null },
    { table: 'users', name: 'role', data_type: 'character varying', max_length: 20, nullable: 'NO', default_value: "'user'" },
    { table: 'user_sessions', name: 'session_id', data_type: 'bigint', max_length: null, nullable: 'NO', default_value: 'sequence' },
    { table: 'user_sessions', name: 'user_id', data_type: 'integer', max_length: null, nullable: 'NO', default_value: null },
    { table: 'user_sessions', name: 'token_hash', data_type: 'character', max_length: 64, nullable: 'NO', default_value: null },
    { table: 'user_sessions', name: 'expires_at', data_type: 'timestamp with time zone', max_length: null, nullable: 'NO', default_value: null },
    { table: 'user_sessions', name: 'created_at', data_type: 'timestamp with time zone', max_length: null, nullable: 'NO', default_value: 'now()' },
  ],
  '002_order_delivery.sql': [
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
};

type ExpectedConstraint = Pick<LegacyConstraint, 'table' | 'type' | 'columns'> & Partial<Pick<LegacyConstraint,
  'referenced_schema' | 'referenced_table' | 'referenced_columns' | 'on_delete' | 'definition'>>;
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
};

const relevantTables: Record<MigrationName, string[]> = {
  '001_auth.sql': ['users', 'user_sessions'],
  '002_order_delivery.sql': ['orders'],
  '003_audit_logs.sql': ['audit_logs'],
  '004_anomaly_incidents.sql': ['anomaly_incidents', 'anomaly_incident_events', 'anomaly_event_queue'],
  '005_anomaly_queue_dead_letter.sql': ['anomaly_event_queue'],
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
  if (expected.default_value === 'sequence') return actual.default_value !== null && /^nextval\('.+'::regclass\)$/.test(actual.default_value.replace(/\s+/g, ''));
  return normalizeDefault(actual.default_value) === expected.default_value;
}

function matchesConstraint(actual: LegacyConstraint | undefined, expected: ExpectedConstraint): boolean {
  if (!actual || actual.table !== expected.table || actual.type !== expected.type ||
      JSON.stringify(actual.columns) !== JSON.stringify(expected.columns)) return false;
  if (expected.referenced_schema !== undefined && (actual.referenced_schema !== expected.referenced_schema ||
      actual.referenced_table !== expected.referenced_table ||
      JSON.stringify(actual.referenced_columns) !== JSON.stringify(expected.referenced_columns) || actual.on_delete !== expected.on_delete)) return false;
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
    !actual.has_expression && actual.has_predicate === (expected.has_predicate ?? false) && !actual.has_included_columns &&
    (expected.predicate_definition == null || normalizeCheck(actual.predicate_definition ?? '') === normalizeCheck(expected.predicate_definition)) &&
    JSON.stringify(actual.columns) === JSON.stringify(expected.columns));
}

function isAllowedAdditionalUniqueIndex(index: LegacyIndex, allowedConstraints: ExpectedConstraint[], expectedIndexes: ExpectedIndex[]): boolean {
  if (!index.is_unique || !index.is_valid) return true;
  if (expectedIndexes.some((expected) => matchesIndex(index, expected))) return true;
  if (!index.constraint_name || index.access_method !== 'btree' || index.has_expression || index.has_predicate || index.has_included_columns) return false;
  return allowedConstraints.some((constraint) =>
    constraint.table === index.table && (constraint.type === 'p' || constraint.type === 'u') &&
    JSON.stringify(index.columns) === JSON.stringify(constraint.columns.map((name) => ({
      name, descending: false, nulls_first: false,
    }))),
  );
}

export function assessLegacyMigration(name: MigrationName, snapshot: LegacySchemaSnapshot): LegacyState {
  const markers = legacyMarkers[name];
  const anomalyBindingsComplete = name !== '004_anomaly_incidents.sql' || snapshot.anomaly_trigger_compatible === true;
  const allowedConstraints = [...expectedConstraints[name], ...originalSchemaConstraints[name]];
  const started = markers.relations.some((table) => snapshot.relations.includes(table)) ||
    markers.columns.some(([table, column]) => snapshot.columns.some((actual) => actual.table === table && actual.name === column)) ||
    markers.constraints.some((constraintName) => snapshot.constraints.some((actual) => actual.name === constraintName)) ||
    markers.indexes.some((indexName) => snapshot.indexes.some((actual) => actual.name === indexName)) ||
    markers.triggers.some((triggerName) => snapshot.triggers?.includes(triggerName)) ||
    markers.functions.some((functionName) => snapshot.functions?.includes(functionName));
  const complete = expectedColumns[name].every((expected) =>
    matchesColumn(snapshot.columns.find((actual) => actual.table === expected.table && actual.name === expected.name), expected)) &&
    expectedConstraints[name].every((expected) => matchesConstraint(snapshot.constraints.find((actual) => actual.table === expected.table &&
      actual.type === expected.type && actual.columns.length === expected.columns.length &&
      JSON.stringify(actual.columns) === JSON.stringify(expected.columns)), expected)) &&
    snapshot.constraints.filter((actual) => relevantTables[name].includes(actual.table))
      .every((actual) => allowedConstraints.some((expected) => matchesConstraint(actual, expected))) &&
    expectedIndexes[name].every((expected) => matchesIndex(snapshot.indexes.find((actual) => actual.schema === 'public' &&
      actual.name === expected.name), expected)) &&
    snapshot.indexes.filter((actual) => actual.schema === 'public' && relevantTables[name].includes(actual.table))
      .every((actual) => isAllowedAdditionalUniqueIndex(actual, allowedConstraints, expectedIndexes[name])) &&
    markers.triggers.every((triggerName) => snapshot.triggers?.includes(triggerName)) &&
    markers.functions.every((functionName) => snapshot.functions?.includes(functionName)) && anomalyBindingsComplete;
  return { complete, started };
}

const schemaSnapshotSql = `
  SELECT
    COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'table', table_name, 'name', column_name, 'data_type', data_type,
      'max_length', character_maximum_length, 'nullable', is_nullable, 'default_value', column_default))
      FROM information_schema.columns WHERE table_schema='public' AND table_name = ANY($1::text[])), '[]'::jsonb) AS columns,
    COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'table', rel.relname, 'name', con.conname, 'type', con.contype,
      'columns', ARRAY(SELECT attr.attname FROM unnest(con.conkey) WITH ORDINALITY AS key(attnum, ord)
        JOIN pg_attribute attr ON attr.attrelid=con.conrelid AND attr.attnum=key.attnum AND NOT attr.attisdropped ORDER BY key.ord),
      'referenced_schema', ref_ns.nspname, 'referenced_table', ref.relname,
      'referenced_columns', ARRAY(SELECT attr.attname FROM unnest(con.confkey) WITH ORDINALITY AS key(attnum, ord)
        JOIN pg_attribute attr ON attr.attrelid=con.confrelid AND attr.attnum=key.attnum AND NOT attr.attisdropped ORDER BY key.ord),
      'on_delete', con.confdeltype, 'definition', pg_get_constraintdef(con.oid)) ORDER BY con.conname)
      FROM pg_constraint con JOIN pg_class rel ON rel.oid=con.conrelid
      JOIN pg_namespace ns ON ns.oid=rel.relnamespace
      LEFT JOIN pg_class ref ON ref.oid=con.confrelid LEFT JOIN pg_namespace ref_ns ON ref_ns.oid=ref.relnamespace
      WHERE ns.nspname='public' AND rel.relname = ANY($1::text[])), '[]'::jsonb) AS constraints,
    COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'schema', ns.nspname, 'table', tbl.relname, 'name', idx.relname,
      'constraint_name', owner_con.conname,
      'access_method', am.amname, 'is_unique', i.indisunique, 'is_valid', i.indisvalid,
      'has_expression', i.indexprs IS NOT NULL, 'has_predicate', i.indpred IS NOT NULL,
      'predicate_definition', pg_get_expr(i.indpred, i.indrelid),
      'has_included_columns', i.indnatts <> i.indnkeyatts,
      'columns', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'name', attr.attname,
        'descending', pg_index_column_has_property(i.indexrelid, key.ord::int, 'desc'),
        'nulls_first', pg_index_column_has_property(i.indexrelid, key.ord::int, 'nulls_first')) ORDER BY key.ord)
        FROM unnest(i.indkey) WITH ORDINALITY AS key(attnum, ord)
        JOIN pg_attribute attr ON attr.attrelid=i.indrelid AND attr.attnum=key.attnum AND NOT attr.attisdropped
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

async function legacyState(client: PoolClient, name: MigrationName): Promise<LegacyState> {
  const { rows } = await client.query<LegacySchemaSnapshot>(schemaSnapshotSql, [relevantTables[name]]);
  if (!rows[0]) throw new Error(`Could not inspect legacy schema for migration ${name}.`);
  return assessLegacyMigration(name, rows[0]);
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
      const legacy = await legacyState(client, migration.name as MigrationName);
      if (legacy.complete) {
        await client.query('INSERT INTO public.schema_migrations (migration_name) VALUES ($1)', [migration.name]);
        completed.push(`${migration.name} (recognized existing schema)`);
        continue;
      }
      if (legacy.started) {
        throw new Error(`Migration ${migration.name} has a partial or incompatible existing schema. Review it manually; no migration changes were committed.`);
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
