select column_default
from information_schema.columns
where table_schema = 'public'
  and table_name = 'classes'
  and column_name = 'owner_id';
