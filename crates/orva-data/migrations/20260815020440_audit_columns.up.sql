-- ORVA Core M6 — Audit Log
-- Audit ไม่ใช่ตารางแยก — ใช้ event log (`events`) เดิมเป็นฐานตรง ๆ ตาม MILESTONES.md M6
-- เพิ่มแค่ resource_type/resource_id เพื่อ query "audit trail ของ resource ชิ้นนี้" ได้ตรง ๆ
-- แทนที่จะต้อง query ข้างใน payload jsonb

alter table events add column resource_type text;
alter table events add column resource_id uuid;

create index idx_events_organization_id_resource on events (organization_id, resource_type, resource_id);
