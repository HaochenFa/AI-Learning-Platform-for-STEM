-- Materials storage bucket and policies
insert into storage.buckets (id, name, public)
values ('materials', 'materials', false)
on conflict do nothing;

create policy materials_storage_select_teacher
on storage.objects for select
using (
  bucket_id = 'materials'
  and exists (
    select 1 from classes c
    left join enrollments e on e.class_id = c.id and e.user_id = auth.uid()
    where c.id = (storage.foldername(name))[2]::uuid
      and (c.owner_id = auth.uid() or e.role in ('teacher', 'ta'))
  )
);

create policy materials_storage_insert_teacher
on storage.objects for insert
with check (
  bucket_id = 'materials'
  and exists (
    select 1 from classes c
    left join enrollments e on e.class_id = c.id and e.user_id = auth.uid()
    where c.id = (storage.foldername(name))[2]::uuid
      and (c.owner_id = auth.uid() or e.role in ('teacher', 'ta'))
  )
);

create policy materials_storage_delete_teacher
on storage.objects for delete
using (
  bucket_id = 'materials'
  and exists (
    select 1 from classes c
    left join enrollments e on e.class_id = c.id and e.user_id = auth.uid()
    where c.id = (storage.foldername(name))[2]::uuid
      and (c.owner_id = auth.uid() or e.role in ('teacher', 'ta'))
  )
);
