-- ORVA Core M3 — Authorization & Multi-Tenant
-- ดู ARCHITECTURE.md §4 (Universal Permission System) และ MILESTONES.md M3
--
-- โมเดล: User -> Role -> Permission -> Resource -> Action
-- permissions เป็น catalog กลาง (ไม่ tenant-scoped) — module ในอนาคตประกาศ permission key ของตัวเองเข้ามาที่นี่
-- roles/user_roles เป็น tenant-scoped (organization_id) ตามกฎ multi-tenant ของ ARCHITECTURE.md §3

create table permissions (
    id uuid primary key default gen_random_uuid(),
    key text not null unique,
    description text not null default ''
);

create table roles (
    id uuid primary key default gen_random_uuid(),
    organization_id uuid not null references organizations(id),
    name text not null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    deleted_at timestamptz,
    created_by uuid references users(id),
    unique (organization_id, name)
);

create table role_permissions (
    role_id uuid not null references roles(id),
    permission_id uuid not null references permissions(id),
    primary key (role_id, permission_id)
);

create table user_roles (
    user_id uuid not null references users(id),
    role_id uuid not null references roles(id),
    organization_id uuid not null references organizations(id),
    created_at timestamptz not null default now(),
    primary key (user_id, role_id)
);

create index idx_roles_organization_id on roles (organization_id) where deleted_at is null;
create index idx_user_roles_user_id on user_roles (user_id);
create index idx_user_roles_organization_id on user_roles (organization_id);

-- Core permission catalog ของ v0.1 — module ในอนาคตจะเพิ่ม key ของตัวเองผ่าน Module System (M7)
insert into permissions (key, description) values
    ('core.organization.manage', 'ระงับ/จัดการ organization ของตัวเอง'),
    ('core.user.manage', 'เชิญ/จัดการผู้ใช้ในองค์กร'),
    ('core.team.manage', 'จัดการทีมในองค์กร'),
    ('core.role.manage', 'สร้าง role และมอบ permission/สมาชิก'),
    ('core.service_identity.manage', 'ออกและเพิกถอน service identity key');
