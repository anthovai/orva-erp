-- Canonical Product (ADR 0016 — entity ที่สองของ canonical projection)
-- เติมข้อมูลจาก event `<module>.product.*` (เช่น InvenTree — ดู docs/modules/inventree.md)
create table products (
    id uuid primary key default gen_random_uuid(),
    organization_id uuid not null references organizations(id),
    name text not null,
    sku text not null default '',
    description text not null default '',
    is_active boolean not null default true,
    source_module text not null,
    source_id text not null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    deleted_at timestamptz,
    unique (organization_id, source_module, source_id)
);

create index idx_products_org on products (organization_id) where deleted_at is null;

-- RLS ตามกติกา ADR 0005
alter table products enable row level security;
alter table products force row level security;
create policy tenant_isolation on products
    using (organization_id = orva_rls_org() or orva_rls_bypass())
    with check (organization_id = orva_rls_org() or orva_rls_bypass());

insert into permissions (key, description)
values ('core.product.read', 'อ่านข้อมูล canonical Product ขององค์กร')
on conflict (key) do nothing;
