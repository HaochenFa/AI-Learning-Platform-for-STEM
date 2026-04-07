select pg_policies.policyname, cmd, permissive, qual, with_check
from pg_policies
where schemaname = 'public' and tablename = 'classes'
order by pg_policies.policyname;
