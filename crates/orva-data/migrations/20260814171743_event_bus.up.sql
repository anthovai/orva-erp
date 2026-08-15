-- ORVA Core M5 — Event Bus
-- ดู ARCHITECTURE.md §6 (Event-Driven Architecture) และ MILESTONES.md M5
--
-- Event log เป็น append-only (ไม่มี soft delete/update) — เป็นฐานของ Audit Log (M6)
-- และ Intelligence Context Engine (M8) ในอนาคต

create table events (
    id uuid primary key default gen_random_uuid(),
    organization_id uuid not null references organizations(id),
    event_type text not null,
    payload jsonb not null,
    actor_user_id uuid references users(id),
    correlation_id uuid not null,
    occurred_at timestamptz not null default now()
);

create index idx_events_organization_id_occurred_at on events (organization_id, occurred_at);
create index idx_events_organization_id_event_type on events (organization_id, event_type);
create index idx_events_correlation_id on events (correlation_id);

-- permission ใหม่สำหรับ query event log ย้อนหลังผ่าน API (ดู MILESTONES.md M5)
insert into permissions (key, description) values
    ('core.event.read', 'ดู event log ย้อนหลังขององค์กร');
