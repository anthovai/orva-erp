-- ORVA Core M6 — Workflow Engine
-- ดู ARCHITECTURE.md §7 และ MILESTONES.md M6
--
-- Generic ตั้งใจ: ยังไม่มี business module (Finance/HRM ฯลฯ) ที่มี entity จริงอย่าง Invoice
-- จึงผูก workflow เข้ากับ (resource_type, resource_id) แบบ opaque string/uuid แทนการมี FK ตรง
-- ไปยัง entity เฉพาะทาง — module ในอนาคตแค่ส่ง resource_type="invoice" มาก็ใช้ engine เดียวกันได้

create table workflow_instances (
    id uuid primary key default gen_random_uuid(),
    organization_id uuid not null references organizations(id),
    resource_type text not null,
    resource_id uuid not null,
    -- created -> review -> (pending_approval ถ้า rule trigger -> executing) หรือ (executing ตรง ๆ)
    -- -> completed | rejected (terminal)
    status text not null default 'created',
    context jsonb not null default '{}',
    -- เงื่อนไข approval แบบ ARCHITECTURE.md §7: {"field": "amount", "operator": "gt", "value": 100000}
    rule jsonb,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    created_by uuid references users(id)
);

create table approval_tasks (
    id uuid primary key default gen_random_uuid(),
    organization_id uuid not null references organizations(id),
    workflow_instance_id uuid not null references workflow_instances(id),
    assigned_to uuid not null references users(id),
    status text not null default 'pending',
    decided_by uuid references users(id),
    decided_at timestamptz,
    reason text,
    created_at timestamptz not null default now()
);

create index idx_workflow_instances_organization_status on workflow_instances (organization_id, status);
create index idx_approval_tasks_assigned_to on approval_tasks (organization_id, assigned_to, status);

insert into permissions (key, description) values
    ('core.workflow.manage', 'สร้างและควบคุม workflow instance');
