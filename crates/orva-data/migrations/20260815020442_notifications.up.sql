-- ORVA Core M6 — Notification
-- ดู MILESTONES.md M6 — subscribe จาก Event Bus, channel แรก: in_app + email

create table notifications (
    id uuid primary key default gen_random_uuid(),
    organization_id uuid not null references organizations(id),
    user_id uuid not null references users(id),
    channel text not null,
    title text not null,
    body text not null default '',
    read_at timestamptz,
    created_at timestamptz not null default now()
);

-- ไม่มี preference row = ถือว่าเปิดรับ (opt-out model ไม่ใช่ opt-in)
create table notification_preferences (
    organization_id uuid not null references organizations(id),
    user_id uuid not null references users(id),
    channel text not null,
    enabled boolean not null default true,
    updated_at timestamptz not null default now(),
    primary key (user_id, channel)
);

create index idx_notifications_user_unread on notifications (organization_id, user_id, read_at);
