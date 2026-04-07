do $$
  declare
    v_user_id uuid := gen_random_uuid();
    v_email text := 'student.demo@guest.com';
    v_password text := '12345678!';
    v_display_name text := 'Student Demo';
    v_account_type text := 'student'; -- or 'student'
  begin
    if v_account_type not in ('teacher', 'student') then
      raise exception 'v_account_type must be teacher or student';
    end if;

    insert into auth.users (
      instance_id,
      id,
      aud,
      role,
      email,
      encrypted_password,
      email_confirmed_at,
      raw_app_meta_data,
      raw_user_meta_data,
      created_at,
      updated_at,
      confirmation_token,
      email_change,
      email_change_token_new,
      recovery_token,
      is_sso_user,
      is_anonymous
    )
    values (
      '00000000-0000-0000-0000-000000000000',
      v_user_id,
      'authenticated',
      'authenticated',
      v_email,
      extensions.crypt(v_password, extensions.gen_salt('bf')),
      now(),
      jsonb_build_object(
        'provider', 'email',
        'providers', jsonb_build_array('email')
      ),
      jsonb_build_object(
        'account_type', v_account_type,
        'display_name', v_display_name
      ),
      now(),
      now(),
      '',
      '',
      '',
      '',
      false,
      false
    );

    insert into auth.identities (
      id,
      user_id,
      identity_data,
      provider,
      provider_id,
      last_sign_in_at,
      created_at,
      updated_at
    )
    values (
      gen_random_uuid(),
      v_user_id,
      jsonb_build_object(
        'sub', v_user_id::text,
        'email', v_email,
        'email_verified', true,
        'phone_verified', false
      ),
      'email',
      v_user_id::text,
      now(),
      now(),
      now()
    );

    raise notice 'Created reviewer user: % (%).', v_email, v_user_id;
  end
  $$;
