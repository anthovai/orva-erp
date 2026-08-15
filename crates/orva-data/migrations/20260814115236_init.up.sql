-- ORVA Core — initial canonical entities
-- Organization = tenant root (no tenant_id on itself)
-- ทุก entity อื่นถือ organization_id เป็น tenant column ตาม ARCHITECTURE.md §3

create table organizations (
    id uuid primary key default gen_random_uuid(),
    name text not null,
    slug text not null unique,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    deleted_at timestamptz
);

create table users (
    id uuid primary key default gen_random_uuid(),
    organization_id uuid not null references organizations(id),
    email text not null,
    display_name text not null,
    password_hash text not null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    deleted_at timestamptz,
    created_by uuid references users(id),
    unique (organization_id, email)
);

create table documents (
    id uuid primary key default gen_random_uuid(),
    organization_id uuid not null references organizations(id),
    title text not null,
    content text not null default '',
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    deleted_at timestamptz,
    created_by uuid references users(id)
);

create table tasks (
    id uuid primary key default gen_random_uuid(),
    organization_id uuid not null references organizations(id),
    title text not null,
    status text not null default 'open',
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    deleted_at timestamptz,
    created_by uuid references users(id)
);

-- Tenant-scoped lookups เกิดขึ้นแทบทุก query — ทำ index ให้ตั้งแต่ migration แรก
create index idx_users_organization_id on users (organization_id) where deleted_at is null;
create index idx_documents_organization_id on documents (organization_id) where deleted_at is null;
create index idx_tasks_organization_id on tasks (organization_id) where deleted_at is null;
