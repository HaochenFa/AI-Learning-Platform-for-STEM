select
  column_name,
  privilege_type
from information_schema.column_privileges
where table_schema = 'public'
  and table_name = 'classes'
  and grantee = 'authenticated'
order by column_name, privilege_type;
