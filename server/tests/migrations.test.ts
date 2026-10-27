import { describe, expect, it } from 'vitest';
import type { PoolClient } from 'pg';
import {
  applyMigrations,
  assertMigrationTargetDatabase,
  assessLegacyMigration,
  type LegacyColumn,
  type LegacyConstraint,
  type LegacyIndex,
  type LegacySchemaSnapshot,
  type MigrationFile,
} from '../src/migrations.js';

describe('migration target guard', () => {
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
});

const files: MigrationFile[] = [
  { name: '001_auth.sql', sql: '-- SQL 001' },
  { name: '002_order_delivery.sql', sql: '-- SQL 002' },
  { name: '003_audit_logs.sql', sql: '-- SQL 003' },
];

function column(table: string, name: string, data_type: string, nullable: 'YES' | 'NO', default_value: string | null, max_length: number | null = null): LegacyColumn {
  return { table, name, data_type, max_length, nullable, default_value };
}

function constraint(input: Partial<LegacyConstraint> & Pick<LegacyConstraint, 'table' | 'name' | 'type' | 'columns'>): LegacyConstraint {
  return {
    referenced_schema: null, referenced_table: null, referenced_columns: [], on_delete: null, definition: '',
    ...input,
  };
}

function index(table: string, name: string, columns: LegacyIndex['columns']): LegacyIndex {
  return {
    schema: 'public', table, name, constraint_name: null, access_method: 'btree', is_unique: false, is_valid: true,
    has_expression: false, has_predicate: false, has_included_columns: false, columns,
  };
}

function completeSnapshot(): LegacySchemaSnapshot {
  const columns = [
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
  ];
  const constraints = [
    constraint({ table: 'users', name: 'users_role_check', type: 'c', columns: ['role'], definition: "CHECK (((role)::character varying)::text = ANY ((ARRAY['user'::character varying, 'admin'::character varying])::text[]))" }),
    constraint({ table: 'user_sessions', name: 'user_sessions_pkey', type: 'p', columns: ['session_id'] }),
    constraint({ table: 'user_sessions', name: 'user_sessions_token_hash_key', type: 'u', columns: ['token_hash'] }),
    constraint({ table: 'user_sessions', name: 'user_sessions_user_id_fkey', type: 'f', columns: ['user_id'], referenced_schema: 'public', referenced_table: 'users', referenced_columns: ['user_id'], on_delete: 'c' }),
    constraint({ table: 'audit_logs', name: 'audit_logs_pkey', type: 'p', columns: ['log_id'] }),
    constraint({ table: 'audit_logs', name: 'audit_logs_status_check', type: 'c', columns: ['status'], definition: "CHECK (((status)::character varying)::text = ANY ((ARRAY['SUCCESS'::character varying, 'FAILURE'::character varying])::text[]))" }),
    constraint({ table: 'audit_logs', name: 'audit_logs_user_id_fkey', type: 'f', columns: ['user_id'], referenced_schema: 'public', referenced_table: 'users', referenced_columns: ['user_id'], on_delete: 'n' }),
  ];
  const indexes = [
    index('user_sessions', 'user_sessions_expiry_idx', [{ name: 'expires_at', descending: false, nulls_first: false }]),
    index('audit_logs', 'audit_logs_created_idx', [{ name: 'created_at', descending: true, nulls_first: true }, { name: 'log_id', descending: true, nulls_first: true }]),
    index('audit_logs', 'audit_logs_user_created_idx', [{ name: 'user_id', descending: false, nulls_first: false }, { name: 'created_at', descending: true, nulls_first: true }]),
    index('audit_logs', 'audit_logs_action_created_idx', [{ name: 'action', descending: false, nulls_first: false }, { name: 'created_at', descending: true, nulls_first: true }]),
    index('audit_logs', 'audit_logs_status_created_idx', [{ name: 'status', descending: false, nulls_first: false }, { name: 'created_at', descending: true, nulls_first: true }]),
  ];
  return { relations: ['users', 'user_sessions', 'orders', 'audit_logs'], columns, constraints, indexes };
}

function fakeClient(snapshot: LegacySchemaSnapshot) {
  const ledger = new Set<string>();
  const calls: { sql: string; values?: unknown[] }[] = [];
  let ledgerBeforeTransaction = new Set<string>();
  const client = {
    async query(sql: string, values?: unknown[]) {
      calls.push({ sql, values });
      if (sql === 'BEGIN') ledgerBeforeTransaction = new Set(ledger);
      if (sql === 'ROLLBACK') {
        ledger.clear();
        for (const name of ledgerBeforeTransaction) ledger.add(name);
      }
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
  return { client: client as unknown as PoolClient, calls, ledger };
}

describe('legacy migration schema detection', () => {
  it('recognizes schemas matching all migration effects', () => {
    const snapshot = completeSnapshot();
    expect(assessLegacyMigration('001_auth.sql', snapshot)).toEqual({ complete: true, started: true });
    expect(assessLegacyMigration('002_order_delivery.sql', snapshot)).toEqual({ complete: true, started: true });
    expect(assessLegacyMigration('003_audit_logs.sql', snapshot)).toEqual({ complete: true, started: true });
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
});

describe('tracked migrations and rollback', () => {
  it('recognizes an old complete schema, applies only audit logs, and records the complete history', async () => {
    const { client, calls, ledger } = fakeClient(completeSnapshot());
    const applied = await applyMigrations(client, files);
    expect(applied).toEqual(files.map(({ name }) => `${name} (recognized existing schema)`));
    expect(ledger).toEqual(new Set(files.map(({ name }) => name)));
    expect(calls.some(({ sql }) => sql === 'COMMIT')).toBe(true);
    expect(calls.some(({ sql }) => sql === 'ROLLBACK')).toBe(false);
  });

  it('rolls back the tracker and prior history records when a later legacy migration is incompatible', async () => {
    const snapshot = completeSnapshot();
    snapshot.columns.find((column) => column.table === 'orders' && column.name === 'delivery_city')!.max_length = 80;
    const { client, calls, ledger } = fakeClient(snapshot);
    await expect(applyMigrations(client, files)).rejects.toThrow(/partial or incompatible existing schema/);
    expect(calls.some(({ sql }) => sql === 'ROLLBACK')).toBe(true);
    expect(calls.some(({ sql }) => sql === 'COMMIT')).toBe(false);
    expect(ledger.size).toBe(0);
  });

  it('applies fresh migrations once and skips recorded files on a second run', async () => {
    const { client, calls, ledger } = fakeClient({ relations: [], columns: [], constraints: [], indexes: [] });
    expect(await applyMigrations(client, files)).toEqual(files.map(({ name }) => name));
    expect(ledger.size).toBe(3);
    expect(calls.filter(({ sql }) => sql === '-- SQL 001' || sql === '-- SQL 002' || sql === '-- SQL 003')).toHaveLength(3);
  });
});
