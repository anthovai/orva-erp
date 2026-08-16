-- ORVA Worker task queue (ADR 0019) — ปิด loop Control Plane → Execution Plane
-- ORVA มอบงานให้ ORVA Worker (OpenWorker) ผ่านคิวที่ worker มา poll เอง
-- (worker รันบนเครื่องผู้ใช้หลัง NAT — ORVA ยิงเข้าไม่ได้)
create table worker_tasks (
    id uuid primary key default gen_random_uuid(),
    organization_id uuid not null references organizations(id),
    -- สิ่งที่อยากให้ worker ทำ เป็นภาษาธรรมชาติ — OpenWorker วางแผนขั้นตอนเอง
    instruction text not null,
    -- manual | recommendation (มาจากการ accept recommendation) | workflow
    source text not null default 'manual',
    source_id uuid,
    -- pending → running → succeeded | failed ; หรือ cancelled ก่อนถูก claim
    status text not null default 'pending',
    -- service identity ของ worker ที่ claim งานนี้ไป (ADR 0011)
    claimed_by uuid references service_identities(id),
    claimed_at timestamptz,
    result text,
    error text,
    completed_at timestamptz,
    created_by uuid references users(id),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create index idx_worker_tasks_org_status on worker_tasks (organization_id, status, created_at);

-- RLS ตามกติกา ADR 0005 — ตารางใหม่ต้องทำเสมอ
alter table worker_tasks enable row level security;
alter table worker_tasks force row level security;
create policy tenant_isolation on worker_tasks
    using (organization_id = orva_rls_org() or orva_rls_bypass())
    with check (organization_id = orva_rls_org() or orva_rls_bypass());

insert into permissions (key, description) values
    ('core.worker.read', 'ดูงานที่มอบให้ ORVA Worker และผลลัพธ์'),
    ('core.worker.manage', 'มอบงานให้ ORVA Worker และยกเลิกงาน')
on conflict (key) do nothing;
