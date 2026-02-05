-- Create class via security definer to avoid RLS insert issues.

create or replace function public.create_class(
  p_title text,
  p_subject text,
  p_level text,
  p_description text,
  p_join_code text
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_user_id uuid;
  v_class_id uuid;
begin
  v_user_id := public.requesting_user_id();
  if v_user_id is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;

  if p_title is null or length(trim(p_title)) = 0 then
    raise exception 'Title is required' using errcode = '22023';
  end if;

  if p_join_code is null or length(trim(p_join_code)) = 0 then
    raise exception 'Join code is required' using errcode = '22023';
  end if;

  if char_length(p_title) > 200 then
    raise exception 'Title is too long (max 200 characters)' using errcode = '22023';
  end if;

  if p_subject is not null and char_length(p_subject) > 120 then
    raise exception 'Subject is too long (max 120 characters)' using errcode = '22023';
  end if;

  if p_level is not null and char_length(p_level) > 120 then
    raise exception 'Level is too long (max 120 characters)' using errcode = '22023';
  end if;

  if p_description is not null and char_length(p_description) > 2000 then
    raise exception 'Description is too long (max 2000 characters)' using errcode = '22023';
  end if;

  if char_length(p_join_code) > 32 then
    raise exception 'Join code is too long (max 32 characters)' using errcode = '22023';
  end if;

  insert into public.classes (owner_id, title, subject, level, description, join_code)
  values (v_user_id, p_title, p_subject, p_level, p_description, p_join_code)
  returning id into v_class_id;

  return v_class_id;
end;
$$;

grant execute on function public.create_class(text, text, text, text, text) to authenticated;
