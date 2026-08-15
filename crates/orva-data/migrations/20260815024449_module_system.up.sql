-- ORVA Core M7 — Module System
-- ดู ARCHITECTURE.md §5 (Module System) และ MILESTONES.md M7
--
-- Module ไม่ได้ dynamic-load จริง (.so/.dll) ใน v0.1 — compile เข้า binary เดียวกัน (Rust
-- workspace) แต่ "install/enable/disable per tenant" เป็น runtime state จริงในตารางนี้
-- module ที่ compile เข้ามาแล้วแต่ organization ไม่ได้ install จะเรียก route ไม่ได้เลย

create table module_installations (
    id uuid primary key default gen_random_uuid(),
    organization_id uuid not null references organizations(id),
    module_name text not null,
    version text not null,
    enabled boolean not null default true,
    installed_at timestamptz not null default now(),
    installed_by uuid references users(id),
    unique (organization_id, module_name)
);

create index idx_module_installations_org_module on module_installations (organization_id, module_name);

insert into permissions (key, description) values
    ('core.module.manage', 'ติดตั้ง/เปิด/ปิด module ให้องค์กรของตัวเอง');
