set local role authenticated;
set local request.jwt.claims = '{"sub":"2ebaafa7-7f42-4f64-bd15-c2aaa74eddf9","role":"authenticated"}';

insert into public.classes (title, join_code)
values ('SQL Debug Class', 'SQLDBG1')
returning id, owner_id;
