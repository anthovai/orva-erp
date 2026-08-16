-- ORVA Knowledge (ADR 0017) — linked notes / knowledge graph ต่อ tenant
-- แนวคิดจาก Obsidian (concept เท่านั้น — โค้ด/แอปใช้ไม่ได้ตาม license, ดู ARCHITECTURE.md §9)
create table knowledge_notes (
    id uuid primary key default gen_random_uuid(),
    organization_id uuid not null references organizations(id),
    title text not null,
    content text not null default '',
    created_by uuid references users(id),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    deleted_at timestamptz
);

-- title ต้อง unique ต่อ org เฉพาะโน้ตที่ยังอยู่ (ลบแล้วสร้างชื่อเดิมใหม่ได้)
create unique index idx_knowledge_notes_title
    on knowledge_notes (organization_id, lower(title)) where deleted_at is null;

-- ลิงก์จากเนื้อหาโน้ต (`[[...]]`) — สามชนิด:
--   note     : ลิงก์หาโน้ตอื่นตามชื่อ (to_note_id null = ยังไม่มีโน้ตชื่อนั้น รอ resolve)
--   employee : ลิงก์หา canonical Employee (target_ref = email)
--   product  : ลิงก์หา canonical Product (target_ref = sku)
create table knowledge_links (
    id uuid primary key default gen_random_uuid(),
    organization_id uuid not null references organizations(id),
    from_note_id uuid not null references knowledge_notes(id),
    target_kind text not null check (target_kind in ('note', 'employee', 'product')),
    target_ref text not null,
    to_note_id uuid references knowledge_notes(id),
    created_at timestamptz not null default now()
);

create index idx_knowledge_links_from on knowledge_links (organization_id, from_note_id);
create index idx_knowledge_links_to on knowledge_links (organization_id, to_note_id);
create index idx_knowledge_links_pending
    on knowledge_links (organization_id, lower(target_ref))
    where target_kind = 'note' and to_note_id is null;

-- RLS ตามกติกา ADR 0005 — ตารางใหม่ต้องทำเสมอ
alter table knowledge_notes enable row level security;
alter table knowledge_notes force row level security;
create policy tenant_isolation on knowledge_notes
    using (organization_id = orva_rls_org() or orva_rls_bypass())
    with check (organization_id = orva_rls_org() or orva_rls_bypass());

alter table knowledge_links enable row level security;
alter table knowledge_links force row level security;
create policy tenant_isolation on knowledge_links
    using (organization_id = orva_rls_org() or orva_rls_bypass())
    with check (organization_id = orva_rls_org() or orva_rls_bypass());

insert into permissions (key, description) values
    ('core.knowledge.read', 'อ่าน knowledge notes/graph ขององค์กร'),
    ('core.knowledge.manage', 'สร้าง/แก้/ลบ knowledge notes ขององค์กร')
on conflict (key) do nothing;
