alter table workflow_instances drop column definition_id;

drop policy if exists tenant_isolation on workflow_definitions;
drop table workflow_definitions;
