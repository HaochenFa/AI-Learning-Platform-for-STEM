-- Persist compacted context summaries for long-running always-on class chat sessions.

create table if not exists class_chat_session_compactions (
  session_id uuid primary key references class_chat_sessions(id) on delete cascade,
  class_id uuid not null references classes(id) on delete cascade,
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  summary_text text not null default '',
  summary_json jsonb not null default '{}'::jsonb,
  compacted_through_created_at timestamptz,
  compacted_through_message_id uuid,
  compacted_turn_count int not null default 0,
  last_compacted_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists class_chat_messages_session_created_desc_idx
  on class_chat_messages(session_id, created_at desc, id desc);

create index if not exists class_chat_compactions_class_owner_idx
  on class_chat_session_compactions(class_id, owner_user_id, last_compacted_at desc);

alter table class_chat_session_compactions enable row level security;

drop trigger if exists class_chat_session_compactions_set_updated_at on class_chat_session_compactions;
create trigger class_chat_session_compactions_set_updated_at
before update on class_chat_session_compactions
for each row
execute function set_updated_at();

create policy class_chat_compactions_select_member
on class_chat_session_compactions for select
using (
  exists (
    select 1 from class_chat_sessions s
    where s.id = class_chat_session_compactions.session_id
      and s.class_id = class_chat_session_compactions.class_id
      and (
        s.owner_user_id = auth.uid()
        or exists (
          select 1 from classes c
          where c.id = s.class_id
            and c.owner_id = auth.uid()
        )
        or exists (
          select 1 from enrollments e
          where e.class_id = s.class_id
            and e.user_id = auth.uid()
            and e.role in ('teacher', 'ta')
        )
      )
  )
);

create policy class_chat_compactions_insert_owner
on class_chat_session_compactions for insert
with check (
  auth.uid() = owner_user_id
  and exists (
    select 1 from class_chat_sessions s
    where s.id = class_chat_session_compactions.session_id
      and s.class_id = class_chat_session_compactions.class_id
      and s.owner_user_id = auth.uid()
  )
);

create policy class_chat_compactions_update_owner
on class_chat_session_compactions for update
using (auth.uid() = owner_user_id)
with check (
  auth.uid() = owner_user_id
  and exists (
    select 1 from class_chat_sessions s
    where s.id = class_chat_session_compactions.session_id
      and s.class_id = class_chat_session_compactions.class_id
      and s.owner_user_id = auth.uid()
  )
);

create policy class_chat_compactions_delete_owner
on class_chat_session_compactions for delete
using (auth.uid() = owner_user_id);

create policy class_chat_compactions_select_admin
on class_chat_session_compactions for select
using (is_admin());
