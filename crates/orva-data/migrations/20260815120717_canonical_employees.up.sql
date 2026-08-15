-- Canonical Employee (ADR 0016) — ตัวแรกของ canonical business entity ที่ implement จริง
-- (ARCHITECTURE.md §8) เติมข้อมูลด้วย event-driven projection จาก external module
-- (เช่น Horilla ผ่าน event `horilla.employee.*` — ดู docs/modules/horilla.md Phase 3)
create table employees (
    id uuid primary key default gen_random_uuid(),
    organization_id uuid not null references organizations(id),
    email text not null,
    first_name text not null default '',
    last_name text not null default '',
    is_active boolean not null default true,
    -- ที่มาของแถวนี้ — module ไหน (เช่น 'horilla') + id ในระบบนั้น (text เพราะ
    -- external system ใช้ int/uuid/อะไรก็ได้)
    source_module text not null,
    source_id text not null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    deleted_at timestamptz,
    unique (organization_id, source_module, source_id)
);

create index idx_employees_org on employees (organization_id) where deleted_at is null;

-- RLS ตามกติกา ADR 0005 — ตารางใหม่ต้องทำเสมอ
alter table employees enable row level security;
alter table employees force row level security;
create policy tenant_isolation on employees
    using (organization_id = orva_rls_org() or orva_rls_bypass())
    with check (organization_id = orva_rls_org() or orva_rls_bypass());

-- permission ใหม่เข้า catalog กลาง
insert into permissions (key, description)
values ('core.employee.read', 'อ่านข้อมูล canonical Employee ขององค์กร')
on conflict (key) do nothing;
