delete from permissions where key in ('core.knowledge.read', 'core.knowledge.manage');

drop policy if exists tenant_isolation on knowledge_links;
drop table knowledge_links;

drop policy if exists tenant_isolation on knowledge_notes;
drop table knowledge_notes;
