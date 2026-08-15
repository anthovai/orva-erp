-- ORVA Core M8 — Intelligence Foundation
-- ดู ARCHITECTURE.md §9 (Intelligence Engine) และ MILESTONES.md M8
--
-- Flow: ORVA DATA -> EVENTS -> CONTEXT ENGINE -> RULES -> INTELLIGENCE (Insight)
-- rule ผูกกับ event_type หนึ่งตัว ประเมินจาก metric ที่ Context Engine คำนวณจาก event log
-- ในช่วงเวลา (window) ของ organization นั้น ๆ — ไม่ต้องมี scheduler เพราะ evaluate ทันทีที่
-- event ที่ตรงเงื่อนไขเกิดขึ้นจริง (subscribe ผ่าน Event Bus)

create table intelligence_rules (
    id uuid primary key default gen_random_uuid(),
    organization_id uuid not null references organizations(id),
    name text not null,
    event_type text not null,
    -- metric: 'count' นับจำนวน event, หรือ 'sum:<field>' รวมค่า field ตัวเลขใน payload
    metric text not null default 'count',
    window_seconds integer not null,
    operator text not null,
    threshold double precision not null,
    -- แจ้งใครเมื่อ insight เกิด (M6 Notification) — ไม่ระบุ = ไม่แจ้งใคร แค่บันทึก insight
    notify_user_id uuid references users(id),
    enabled boolean not null default true,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    created_by uuid references users(id)
);

-- Insight เป็น append-only เหมือน events (ARCHITECTURE.md §9 ไม่มี soft delete/update)
create table insights (
    id uuid primary key default gen_random_uuid(),
    organization_id uuid not null references organizations(id),
    rule_id uuid not null references intelligence_rules(id),
    rule_name text not null,
    title text not null,
    description text not null,
    metric_value double precision not null,
    threshold double precision not null,
    triggered_event_id uuid references events(id),
    created_at timestamptz not null default now()
);

create index idx_intelligence_rules_org_event_type on intelligence_rules (organization_id, event_type) where enabled = true;
create index idx_insights_organization_id on insights (organization_id, created_at desc);

insert into permissions (key, description) values
    ('core.intelligence.manage', 'สร้าง/จัดการ intelligence rule'),
    ('core.insight.read', 'ดู insight ที่เกิดจาก intelligence rule');
