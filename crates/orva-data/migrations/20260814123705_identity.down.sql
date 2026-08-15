drop table if exists service_identities;
drop table if exists sessions;
drop table if exists team_members;
drop table if exists teams;
alter table users drop column if exists mfa_secret;
alter table users drop column if exists mfa_enabled;
