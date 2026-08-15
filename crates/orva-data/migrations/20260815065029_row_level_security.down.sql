do $$
declare
    t text;
begin
    foreach t in array array[
        'users', 'teams', 'team_members', 'sessions', 'service_identities',
        'documents', 'tasks',
        'roles', 'role_permissions', 'user_roles',
        'events',
        'workflow_instances', 'approval_tasks',
        'notifications', 'notification_preferences',
        'module_installations',
        'intelligence_rules', 'insights'
    ] loop
        execute format('drop policy if exists tenant_isolation on %I', t);
        execute format('alter table %I no force row level security', t);
        execute format('alter table %I disable row level security', t);
    end loop;
end $$;

drop function orva_rls_bypass();
drop function orva_rls_org();
