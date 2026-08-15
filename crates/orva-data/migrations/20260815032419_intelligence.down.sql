delete from permissions where key in ('core.intelligence.manage', 'core.insight.read');
drop table if exists insights;
drop table if exists intelligence_rules;
