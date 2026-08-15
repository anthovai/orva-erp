alter table intelligence_rules drop column recommended_action;

drop policy if exists tenant_isolation on recommendations;
drop table recommendations;
