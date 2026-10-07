-- Gradari Mireris authentication activity log
-- Deployed 2026-10-07. Private audit storage with admin-only read access.

create table if not exists private.auth_activity_log (
  id bigint generated always as identity primary key,
  occurred_at timestamptz not null default now(),
  action text not null,
  user_id uuid,
  email text,
  is_admin boolean not null default false,
  source text not null default 'auth',
  metadata jsonb not null default '{}'::jsonb
);

create index if not exists auth_activity_log_occurred_at_idx
  on private.auth_activity_log (occurred_at desc);
create index if not exists auth_activity_log_action_idx
  on private.auth_activity_log (action);
create index if not exists auth_activity_log_user_idx
  on private.auth_activity_log (user_id);

revoke all on table private.auth_activity_log from public, anon, authenticated;
revoke all on sequence private.auth_activity_log_id_seq from public, anon, authenticated;

create or replace function private.capture_auth_user_activity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_is_admin boolean;
begin
  if tg_op = 'DELETE' then
    select exists (
      select 1 from private.admin_users a where a.user_id = old.id
    ) into v_is_admin;

    insert into private.auth_activity_log
      (occurred_at, action, user_id, email, is_admin, source, metadata)
    values
      (now(), 'account_deleted', old.id, old.email, coalesce(v_is_admin,false), 'auth.users', '{}'::jsonb);
    return old;
  end if;

  select exists (
    select 1 from private.admin_users a where a.user_id = new.id
  ) into v_is_admin;

  if tg_op = 'INSERT' then
    insert into private.auth_activity_log
      (occurred_at, action, user_id, email, is_admin, source, metadata)
    values
      (coalesce(new.created_at, now()), 'account_created', new.id, new.email, coalesce(v_is_admin,false), 'auth.users', '{}'::jsonb);

    if new.confirmation_sent_at is not null then
      insert into private.auth_activity_log
        (occurred_at, action, user_id, email, is_admin, source, metadata)
      values
        (new.confirmation_sent_at, 'email_confirmation_requested', new.id, new.email, coalesce(v_is_admin,false), 'auth.users', '{}'::jsonb);
    end if;

    if new.email_confirmed_at is not null then
      insert into private.auth_activity_log
        (occurred_at, action, user_id, email, is_admin, source, metadata)
      values
        (new.email_confirmed_at, 'email_confirmed', new.id, new.email, coalesce(v_is_admin,false), 'auth.users', '{}'::jsonb);
    end if;

    if new.last_sign_in_at is not null then
      insert into private.auth_activity_log
        (occurred_at, action, user_id, email, is_admin, source, metadata)
      values
        (new.last_sign_in_at, 'login', new.id, new.email, coalesce(v_is_admin,false), 'auth.users', '{"method":"email"}'::jsonb);
    end if;

    return new;
  end if;

  if new.last_sign_in_at is distinct from old.last_sign_in_at and new.last_sign_in_at is not null then
    insert into private.auth_activity_log
      (occurred_at, action, user_id, email, is_admin, source, metadata)
    values
      (new.last_sign_in_at, 'login', new.id, new.email, coalesce(v_is_admin,false), 'auth.users', '{"method":"email"}'::jsonb);
  end if;

  if new.encrypted_password is distinct from old.encrypted_password
     and old.encrypted_password is not null
     and new.encrypted_password is not null then
    insert into private.auth_activity_log
      (occurred_at, action, user_id, email, is_admin, source, metadata)
    values
      (now(), 'password_changed', new.id, new.email, coalesce(v_is_admin,false), 'auth.users', '{}'::jsonb);
  end if;

  if old.email_confirmed_at is null and new.email_confirmed_at is not null then
    insert into private.auth_activity_log
      (occurred_at, action, user_id, email, is_admin, source, metadata)
    values
      (new.email_confirmed_at, 'email_confirmed', new.id, new.email, coalesce(v_is_admin,false), 'auth.users', '{}'::jsonb);
  end if;

  if new.confirmation_sent_at is distinct from old.confirmation_sent_at and new.confirmation_sent_at is not null then
    insert into private.auth_activity_log
      (occurred_at, action, user_id, email, is_admin, source, metadata)
    values
      (new.confirmation_sent_at, 'email_confirmation_requested', new.id, new.email, coalesce(v_is_admin,false), 'auth.users', '{}'::jsonb);
  end if;

  if new.recovery_sent_at is distinct from old.recovery_sent_at and new.recovery_sent_at is not null then
    insert into private.auth_activity_log
      (occurred_at, action, user_id, email, is_admin, source, metadata)
    values
      (new.recovery_sent_at, 'password_recovery_requested', new.id, new.email, coalesce(v_is_admin,false), 'auth.users', '{}'::jsonb);
  end if;

  if new.email is distinct from old.email then
    insert into private.auth_activity_log
      (occurred_at, action, user_id, email, is_admin, source, metadata)
    values
      (now(), 'email_changed', new.id, new.email, coalesce(v_is_admin,false), 'auth.users',
       jsonb_build_object('previous_email', old.email));
  end if;

  return new;
end;
$$;

revoke all on function private.capture_auth_user_activity() from public, anon, authenticated;

drop trigger if exists capture_gradari_auth_activity on auth.users;
create trigger capture_gradari_auth_activity
after insert or update or delete on auth.users
for each row execute function private.capture_auth_user_activity();

create or replace function public.record_admin_access_attempt()
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_email text;
  v_is_admin boolean;
begin
  if v_uid is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  select u.email into v_email from auth.users u where u.id = v_uid;
  select exists (select 1 from private.admin_users a where a.user_id = v_uid) into v_is_admin;

  insert into private.auth_activity_log
    (occurred_at, action, user_id, email, is_admin, source, metadata)
  values
    (now(),
     case when coalesce(v_is_admin,false) then 'admin_access_granted' else 'admin_access_denied' end,
     v_uid, v_email, coalesce(v_is_admin,false), 'admin-auth',
     '{"surface":"admin"}'::jsonb);

  return coalesce(v_is_admin,false);
end;
$$;

revoke all on function public.record_admin_access_attempt() from public, anon;
grant execute on function public.record_admin_access_attempt() to authenticated;

create or replace function public.record_auth_activity(
  p_action text,
  p_metadata jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_email text;
  v_is_admin boolean;
begin
  if v_uid is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  if p_action <> 'logout' then
    raise exception 'Unsupported authentication event' using errcode = '22023';
  end if;

  select u.email into v_email from auth.users u where u.id = v_uid;
  select exists (select 1 from private.admin_users a where a.user_id = v_uid) into v_is_admin;

  if exists (
    select 1 from private.auth_activity_log l
    where l.user_id = v_uid
      and l.action = 'logout'
      and l.occurred_at > now() - interval '5 seconds'
  ) then
    return;
  end if;

  insert into private.auth_activity_log
    (occurred_at, action, user_id, email, is_admin, source, metadata)
  values
    (now(), 'logout', v_uid, v_email, coalesce(v_is_admin,false), 'client-auth',
     coalesce(p_metadata,'{}'::jsonb));
end;
$$;

revoke all on function public.record_auth_activity(text,jsonb) from public, anon;
grant execute on function public.record_auth_activity(text,jsonb) to authenticated;

create or replace function public.admin_auth_log(p_limit integer default 500)
returns table (
  id bigint,
  occurred_at timestamptz,
  action text,
  user_id uuid,
  email text,
  is_admin boolean,
  source text,
  metadata jsonb
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.is_admin() then
    raise exception 'Admin authorization required' using errcode = '42501';
  end if;

  return query
  select l.id, l.occurred_at, l.action, l.user_id, l.email, l.is_admin, l.source, l.metadata
  from private.auth_activity_log l
  order by l.occurred_at desc, l.id desc
  limit greatest(1, least(coalesce(p_limit,500), 1000));
end;
$$;

revoke all on function public.admin_auth_log(integer) from public, anon;
grant execute on function public.admin_auth_log(integer) to authenticated;

insert into private.auth_activity_log
  (occurred_at, action, user_id, email, is_admin, source, metadata)
select u.created_at, 'account_created', u.id, u.email,
       exists(select 1 from private.admin_users a where a.user_id=u.id),
       'backfill', '{"historical":true}'::jsonb
from auth.users u
where not exists (
  select 1 from private.auth_activity_log l
  where l.user_id=u.id and l.action='account_created'
);

insert into private.auth_activity_log
  (occurred_at, action, user_id, email, is_admin, source, metadata)
select u.confirmation_sent_at, 'email_confirmation_requested', u.id, u.email,
       exists(select 1 from private.admin_users a where a.user_id=u.id),
       'backfill', '{"historical":true}'::jsonb
from auth.users u
where u.confirmation_sent_at is not null
and not exists (
  select 1 from private.auth_activity_log l
  where l.user_id=u.id and l.action='email_confirmation_requested'
);

insert into private.auth_activity_log
  (occurred_at, action, user_id, email, is_admin, source, metadata)
select u.email_confirmed_at, 'email_confirmed', u.id, u.email,
       exists(select 1 from private.admin_users a where a.user_id=u.id),
       'backfill', '{"historical":true}'::jsonb
from auth.users u
where u.email_confirmed_at is not null
and not exists (
  select 1 from private.auth_activity_log l
  where l.user_id=u.id and l.action='email_confirmed'
);

insert into private.auth_activity_log
  (occurred_at, action, user_id, email, is_admin, source, metadata)
select u.recovery_sent_at, 'password_recovery_requested', u.id, u.email,
       exists(select 1 from private.admin_users a where a.user_id=u.id),
       'backfill', '{"historical":true}'::jsonb
from auth.users u
where u.recovery_sent_at is not null
and not exists (
  select 1 from private.auth_activity_log l
  where l.user_id=u.id and l.action='password_recovery_requested'
);

insert into private.auth_activity_log
  (occurred_at, action, user_id, email, is_admin, source, metadata)
select u.last_sign_in_at, 'login', u.id, u.email,
       exists(select 1 from private.admin_users a where a.user_id=u.id),
       'backfill', '{"historical":true,"scope":"last_known_login"}'::jsonb
from auth.users u
where u.last_sign_in_at is not null
and not exists (
  select 1 from private.auth_activity_log l
  where l.user_id=u.id and l.action='login'
);
