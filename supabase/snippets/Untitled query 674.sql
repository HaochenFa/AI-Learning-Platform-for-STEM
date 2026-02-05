select relrowsecurity, relforcerowsecurity
from pg_class
where relname = 'classes';
