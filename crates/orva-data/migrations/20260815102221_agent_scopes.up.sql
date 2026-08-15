-- Fine-grained agent scopes (ADR 0011) — จำกัดว่า service identity แต่ละดอกทำอะไรได้
-- ใน Agent API แทนที่จะได้ทุกอย่างแค่เพราะ key ถูกต้อง
--
-- scope ที่รู้จัก:
--   agent:context:read                    — GET /agent/context
--   agent:workflow:read                   — GET /agent/workflows/{id}
--   agent:workflow:propose                — POST /agent/workflows (ทุก resource_type)
--   agent:workflow:propose:<resource_type> — propose เฉพาะ resource_type นั้น
alter table service_identities
    add column scopes text[] not null default '{}';

-- key ที่ออกไปแล้วก่อน migration นี้เคยทำได้ทุกอย่าง — backfill ให้เท่าพฤติกรรมเดิม
-- (ไม่ทำให้ integration ที่มีอยู่พังกลางอากาศ) — key ใหม่ต้องประกาศ scope เองเสมอ
update service_identities
    set scopes = array['agent:context:read', 'agent:workflow:read', 'agent:workflow:propose'];
