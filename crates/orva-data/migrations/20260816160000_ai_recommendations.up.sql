-- AI ใน Intelligence Engine (ADR 0018) — recommendation ไม่จำเป็นต้องมาจาก rule
-- เสมอไปอีกต่อไป: AI analyst สร้าง recommendation ตรง ๆ ได้ (source = 'ai')
alter table recommendations alter column insight_id drop not null;
alter table recommendations alter column rule_id drop not null;
alter table recommendations
    add column source text not null default 'rule'; -- rule | ai
