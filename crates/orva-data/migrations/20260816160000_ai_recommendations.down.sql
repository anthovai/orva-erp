-- แถว AI ไม่มี insight/rule — ต้องลบก่อนจึงบังคับ not null กลับได้
delete from recommendations where source = 'ai';
alter table recommendations drop column source;
alter table recommendations alter column rule_id set not null;
alter table recommendations alter column insight_id set not null;
