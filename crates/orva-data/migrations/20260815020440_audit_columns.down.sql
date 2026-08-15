drop index if exists idx_events_organization_id_resource;
alter table events drop column if exists resource_id;
alter table events drop column if exists resource_type;
