delete from permissions where key = 'core.product.read';

drop policy if exists tenant_isolation on products;
drop table products;
