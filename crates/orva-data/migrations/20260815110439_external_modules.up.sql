-- External OSS modules (ADR 0014) — บริการที่รันแยก process (Horilla, InvenTree ฯลฯ
-- ตาม OSS-STRATEGY.md / LGPL boundary) ที่ ORVA ทำหน้าที่ authenticated proxy ให้
create table external_modules (
    id uuid primary key default gen_random_uuid(),
    organization_id uuid not null references organizations(id),
    -- ชื่อใน path `/api/v1/ext/{name}/...` — จำกัดรูปแบบกัน path เพี้ยน
    name text not null check (name ~ '^[a-z0-9][a-z0-9_-]{1,62}$'),
    base_url text not null,
    enabled boolean not null default true,
    created_by uuid references users(id),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique (organization_id, name)
);

create index idx_external_modules_org on external_modules (organization_id);

-- RLS ตามกติกา ADR 0005 — ตารางใหม่ต้องทำเสมอ
alter table external_modules enable row level security;
alter table external_modules force row level security;
create policy tenant_isolation on external_modules
    using (organization_id = orva_rls_org() or orva_rls_bypass())
    with check (organization_id = orva_rls_org() or orva_rls_bypass());
