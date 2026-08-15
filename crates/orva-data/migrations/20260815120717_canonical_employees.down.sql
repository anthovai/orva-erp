delete from permissions where key = 'core.employee.read';

drop policy if exists tenant_isolation on employees;
drop table employees;
