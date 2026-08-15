-- Row-Level Security (defense-in-depth ชั้นที่สองต่อจาก app-layer scoping) — ดู ADR 0005
--
-- กติกา:
--   * ทุก query ต่อตาราง tenant-scoped ต้องรันใน transaction ที่ตั้ง GUC
--     `app.current_organization_id` ไว้แล้ว (ผ่าน orva_data::pool::begin_tenant)
--     ไม่ตั้ง → policy เป็น false → ได้ 0 แถว (fail-closed)
--   * bootstrap lookup 2 จุดที่ยังไม่รู้ org (session by token hash,
--     service identity by key hash) ใช้ GUC `app.bypass_rls = 'on'` แทน
--     (ผ่าน orva_data::pool::begin_rls_bypass)
--   * FORCE ROW LEVEL SECURITY จำเป็น เพราะ app เชื่อมต่อด้วย role `orva`
--     ซึ่งเป็นเจ้าของตาราง — เจ้าของตารางปกติข้าม RLS ได้ถ้าไม่ FORCE
--   * ยกเว้น: organizations (tenant root — ต้อง lookup ก่อนรู้ context)
--     และ permissions (global catalog, ไม่มีข้อมูล tenant)

create function orva_rls_org() returns uuid
language sql stable as $$
    select nullif(current_setting('app.current_organization_id', true), '')::uuid
$$;

create function orva_rls_bypass() returns boolean
language sql stable as $$
    select current_setting('app.bypass_rls', true) = 'on'
$$;

-- ตารางที่มีคอลัมน์ organization_id โดยตรง
do $$
declare
    t text;
begin
    foreach t in array array[
        'users', 'teams', 'sessions', 'service_identities',
        'documents', 'tasks',
        'roles', 'user_roles',
        'events',
        'workflow_instances', 'approval_tasks',
        'notifications', 'notification_preferences',
        'module_installations',
        'intelligence_rules', 'insights'
    ] loop
        execute format('alter table %I enable row level security', t);
        execute format('alter table %I force row level security', t);
        execute format(
            'create policy tenant_isolation on %I
                using (organization_id = orva_rls_org() or orva_rls_bypass())
                with check (organization_id = orva_rls_org() or orva_rls_bypass())',
            t
        );
    end loop;
end $$;

-- Join table ที่ไม่มี organization_id — scope ผ่าน parent
-- (subquery ต่อ parent ถูก RLS ของ parent กรองด้วย GUC เดียวกันอยู่แล้ว)
alter table team_members enable row level security;
alter table team_members force row level security;
create policy tenant_isolation on team_members
    using (
        orva_rls_bypass()
        or team_id in (select id from teams where organization_id = orva_rls_org())
    )
    with check (
        orva_rls_bypass()
        or team_id in (select id from teams where organization_id = orva_rls_org())
    );

alter table role_permissions enable row level security;
alter table role_permissions force row level security;
create policy tenant_isolation on role_permissions
    using (
        orva_rls_bypass()
        or role_id in (select id from roles where organization_id = orva_rls_org())
    )
    with check (
        orva_rls_bypass()
        or role_id in (select id from roles where organization_id = orva_rls_org())
    );
