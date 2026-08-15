-- Recommendation (ADR 0010) — ข้อเสนอที่ Intelligence Engine สร้างจาก insight
-- ที่มนุษย์ตัดสินใจ accept/dismiss ได้ (ปิดวงจร insight → recommendation → action)
create table recommendations (
    id uuid primary key default gen_random_uuid(),
    organization_id uuid not null references organizations(id),
    insight_id uuid not null references insights(id),
    rule_id uuid not null references intelligence_rules(id),
    title text not null,
    description text not null,
    -- สิ่งที่แนะนำให้ทำ — jsonb opaque เช่น {"type":"workflow","definition_id":"...")
    -- core เป็นคน interpret ตอน accept ไม่ใช่ intelligence layer
    suggested_action jsonb,
    status text not null default 'pending', -- pending | accepted | dismissed
    decided_by uuid references users(id),
    decided_at timestamptz,
    -- workflow ที่ถูกสร้างจริงตอน accept (ถ้า suggested_action เป็น workflow)
    resulting_workflow_id uuid references workflow_instances(id),
    created_at timestamptz not null default now()
);

create index idx_recommendations_org_status on recommendations (organization_id, status);

-- rule ประกาศล่วงหน้าได้ว่าถ้า trigger แล้วให้แนะนำ action อะไร
alter table intelligence_rules
    add column recommended_action jsonb;

-- RLS ตามกติกา ADR 0005 — ตารางใหม่ต้องทำเสมอ
alter table recommendations enable row level security;
alter table recommendations force row level security;
create policy tenant_isolation on recommendations
    using (organization_id = orva_rls_org() or orva_rls_bypass())
    with check (organization_id = orva_rls_org() or orva_rls_bypass());
