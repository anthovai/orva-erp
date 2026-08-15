-- Reusable workflow definitions (ADR 0009) — ตั้งเงื่อนไข approval ครั้งเดียว
-- แล้วสร้าง instance อ้างชื่อ definition ได้เรื่อย ๆ แทนการส่ง rule inline ทุกครั้ง
create table workflow_definitions (
    id uuid primary key default gen_random_uuid(),
    organization_id uuid not null references organizations(id),
    name text not null,
    resource_type text not null,
    rule jsonb,
    -- ผู้อนุมัติ default ของ definition นี้ — advance โดยไม่ระบุ approver_id จะ fallback มาที่นี่
    default_approver_id uuid references users(id),
    enabled boolean not null default true,
    created_by uuid references users(id),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique (organization_id, name)
);

create index idx_workflow_definitions_org on workflow_definitions (organization_id);

-- instance จำว่าถูกสร้างจาก definition ไหน (nullable — inline rule แบบเดิมยังใช้ได้)
alter table workflow_instances
    add column definition_id uuid references workflow_definitions(id);

-- RLS เหมือนตาราง tenant-scoped อื่นทุกประการ (ADR 0005 — ตารางใหม่ต้องทำเองเสมอ)
alter table workflow_definitions enable row level security;
alter table workflow_definitions force row level security;
create policy tenant_isolation on workflow_definitions
    using (organization_id = orva_rls_org() or orva_rls_bypass())
    with check (organization_id = orva_rls_org() or orva_rls_bypass());
