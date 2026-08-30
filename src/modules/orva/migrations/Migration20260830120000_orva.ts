import { Migration } from '@mikro-orm/migrations';

/**
 * Orva hardening: PostgreSQL Row-Level Security on every tenant-scoped table.
 *
 * Installs orva_apply_rls(), which enables + forces RLS and (re)creates the
 * orva_tenant_isolation policy on every public table that has a tenant_id
 * column. Policy semantics:
 *   - GUC orva.tenant_id unset/empty  -> row visible (fail-open: framework
 *     paths such as login, migrations, workers run before a tenant is known;
 *     the application-level scoping remains the first line of defense)
 *   - GUC set                          -> only rows of that tenant, plus
 *     global rows (tenant_id IS NULL), are visible/writable
 *
 * FORCE ROW LEVEL SECURITY matters because the app role owns the tables.
 * NOTE: a superuser connection bypasses RLS entirely — the app must connect
 * as the non-superuser role created by scripts/setup-rls-role.mjs.
 *
 * Future migrations that add tenant-scoped tables MUST end with:
 *   this.addSql(`select orva_apply_rls();`)
 */
export class Migration20260830120000_orva extends Migration {

  override async up(): Promise<void> {
    this.addSql(`
create or replace function orva_apply_rls() returns integer language plpgsql as $orva$
declare
  r record;
  n integer := 0;
  predicate text := $p$
    nullif(current_setting('orva.tenant_id', true), '') is null
    or tenant_id is null
    or tenant_id = nullif(current_setting('orva.tenant_id', true), '')::uuid
  $p$;
begin
  for r in
    select c.table_name
    from information_schema.columns c
    join information_schema.tables t
      on t.table_schema = c.table_schema and t.table_name = c.table_name
    where c.table_schema = 'public'
      and c.column_name = 'tenant_id'
      and t.table_type = 'BASE TABLE'
      and c.table_name not like 'mikro_orm_migrations%'
  loop
    execute format('alter table public.%I enable row level security', r.table_name);
    execute format('alter table public.%I force row level security', r.table_name);
    execute format('drop policy if exists orva_tenant_isolation on public.%I', r.table_name);
    execute format(
      'create policy orva_tenant_isolation on public.%I as permissive for all using (%s) with check (%s)',
      r.table_name, predicate, predicate
    );
    n := n + 1;
  end loop;
  return n;
end
$orva$;`);
    this.addSql(`select orva_apply_rls();`);
  }

  override async down(): Promise<void> {
    this.addSql(`
do $orva$
declare
  r record;
begin
  for r in
    select c.table_name
    from information_schema.columns c
    join information_schema.tables t
      on t.table_schema = c.table_schema and t.table_name = c.table_name
    where c.table_schema = 'public'
      and c.column_name = 'tenant_id'
      and t.table_type = 'BASE TABLE'
      and c.table_name not like 'mikro_orm_migrations%'
  loop
    execute format('drop policy if exists orva_tenant_isolation on public.%I', r.table_name);
    execute format('alter table public.%I no force row level security', r.table_name);
    execute format('alter table public.%I disable row level security', r.table_name);
  end loop;
end
$orva$;`);
    this.addSql(`drop function if exists orva_apply_rls();`);
  }

}
