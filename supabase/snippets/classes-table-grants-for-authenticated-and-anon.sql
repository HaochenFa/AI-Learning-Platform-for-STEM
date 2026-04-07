select
  grantee,
  privilege_type
from information_schema.role_table_grants
where table_schema = 'public'
  and table_name = 'classes'
  and grantee in ('authenticated', 'anon')
order by grantee, privilege_type;
