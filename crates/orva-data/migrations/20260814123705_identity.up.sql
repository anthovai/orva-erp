-- ORVA Core M2 — Identity & Authentication
-- ดู ARCHITECTURE.md §2 (Identity & SSO) และ MILESTONES.md M2

-- MFA: schema เท่านั้น ยังไม่ implement การตรวจ TOTP จริง (ตาม M2 checklist)
alter table users add column mfa_enabled boolean not null default false;
alter table users add column mfa_secret text;

create table teams (
    id uuid primary key default gen_random_uuid(),
    organization_id uuid not null references organizations(id),
    name text not null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    deleted_at timestamptz,
    created_by uuid references users(id)
);

create table team_members (
    team_id uuid not null references teams(id),
    user_id uuid not null references users(id),
    role text not null default 'member',
    created_at timestamptz not null default now(),
    primary key (team_id, user_id)
);

-- Session = credential login ปกติ (opaque token, hash เก็บใน DB ไม่เก็บ raw token)
create table sessions (
    id uuid primary key default gen_random_uuid(),
    organization_id uuid not null references organizations(id),
    user_id uuid not null references users(id),
    token_hash text not null unique,
    created_at timestamptz not null default now(),
    expires_at timestamptz not null,
    revoked_at timestamptz
);

-- Service Identity = ให้ module/worker เรียก ORVA API แทนตัวเอง (ARCHITECTURE.md §2)
create table service_identities (
    id uuid primary key default gen_random_uuid(),
    organization_id uuid not null references organizations(id),
    name text not null,
    key_hash text not null unique,
    created_at timestamptz not null default now(),
    revoked_at timestamptz,
    created_by uuid references users(id)
);

create index idx_teams_organization_id on teams (organization_id) where deleted_at is null;
create index idx_team_members_user_id on team_members (user_id);
create index idx_sessions_user_id on sessions (user_id) where revoked_at is null;
create index idx_service_identities_organization_id on service_identities (organization_id) where revoked_at is null;
