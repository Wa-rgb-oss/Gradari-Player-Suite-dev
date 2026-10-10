-- Faction foundation: optional player factions, founding types, directory, join requests, forum.

alter table public.factions
  add column if not exists faction_type text not null default 'political_bloc',
  add column if not exists is_player_created boolean not null default true,
  add column if not exists join_requests_enabled boolean not null default true,
  add column if not exists created_by uuid references auth.users(id) on delete set null;

alter table public.faction_proposals
  add column if not exists faction_type text not null default 'political_bloc';

update public.factions
set faction_type='imperial_government',
    is_player_created=false,
    join_requests_enabled=false
where code='GME' or lower(name)=lower('Gradari Mireris Empire');

-- Empire affiliation is implicit. It does not occupy the player's optional faction membership.
delete from public.faction_memberships fm
using public.factions f
where fm.faction_id=f.id
  and f.is_player_created=false;

create table if not exists public.faction_join_requests (
  id uuid primary key default gen_random_uuid(),
  faction_id uuid not null references public.factions(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending','accepted','declined','cancelled')),
  created_at timestamptz not null default now(),
  responded_at timestamptz,
  responded_by uuid references auth.users(id) on delete set null
);

create unique index if not exists faction_join_requests_pending_unique
  on public.faction_join_requests(faction_id,user_id)
  where status='pending';
create index if not exists faction_join_requests_user_idx
  on public.faction_join_requests(user_id,created_at desc);
create index if not exists faction_join_requests_faction_idx
  on public.faction_join_requests(faction_id,created_at desc);

create table if not exists public.faction_forum_posts (
  id uuid primary key default gen_random_uuid(),
  faction_id uuid not null references public.factions(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  body text not null check (char_length(body) between 1 and 2000),
  created_at timestamptz not null default now(),
  edited_at timestamptz
);

create index if not exists faction_forum_posts_faction_created_idx
  on public.faction_forum_posts(faction_id,created_at desc);
create index if not exists faction_forum_posts_user_idx
  on public.faction_forum_posts(user_id,created_at desc);

alter table public.faction_join_requests enable row level security;
alter table public.faction_forum_posts enable row level security;

revoke all on public.faction_join_requests from anon, authenticated;
revoke all on public.faction_forum_posts from anon, authenticated;
grant select on public.faction_join_requests to authenticated;
grant select on public.faction_forum_posts to authenticated;

drop policy if exists "Players read relevant faction join requests" on public.faction_join_requests;
create policy "Players read relevant faction join requests"
on public.faction_join_requests
for select to authenticated
using (
  user_id=(select auth.uid())
  or exists (
    select 1 from public.factions f
    where f.id=faction_join_requests.faction_id
      and f.leader_user_id=(select auth.uid())
  )
  or (select private.is_admin())
);

drop policy if exists "Faction members read forum posts" on public.faction_forum_posts;
create policy "Faction members read forum posts"
on public.faction_forum_posts
for select to authenticated
using (
  exists (
    select 1 from public.faction_memberships fm
    where fm.faction_id=faction_forum_posts.faction_id
      and fm.user_id=(select auth.uid())
      and fm.status='active'
  )
  or (select private.is_admin())
);

drop function if exists private.create_faction_proposal(text,text,text,numeric);
create function private.create_faction_proposal(
  p_name text,
  p_code text,
  p_description text,
  p_contribution numeric,
  p_faction_type text
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_cfg public.game_config%rowtype;
  v_id uuid;
  v_type text := lower(trim(coalesce(p_faction_type,'')));
begin
  if v_uid is null then raise exception 'Authentication required'; end if;
  if v_type not in (
    'political_bloc','noble_house','corporate_alliance','colonial_movement',
    'military_institution','regional_government','ideological_organization','commercial_alliance'
  ) then raise exception 'Invalid faction type'; end if;

  if exists (
    select 1 from public.faction_memberships fm
    join public.factions f on f.id=fm.faction_id
    where fm.user_id=v_uid and fm.status='active' and f.is_player_created=true
  ) then raise exception 'You already belong to an active faction'; end if;

  if exists (
    select 1 from public.faction_proposals
    where created_by=v_uid and status='open'
  ) then raise exception 'You already have an open faction proposal'; end if;

  select * into v_cfg from public.game_config where singleton=true;
  if trim(coalesce(p_name,''))='' then raise exception 'Faction name is required'; end if;
  if coalesce(p_contribution,0) < v_cfg.faction_min_contribution then
    raise exception 'Founder contribution is below the minimum';
  end if;
  if not exists (
    select 1 from public.player_wallets
    where user_id=v_uid and balance >= p_contribution
  ) then raise exception 'Insufficient personal balance for pledged contribution'; end if;

  if exists (
    select 1 from public.factions
    where lower(name)=lower(trim(p_name))
       or (p_code is not null and code is not null and lower(code)=lower(trim(p_code)))
  ) or exists (
    select 1 from public.faction_proposals
    where status='open'
      and (
        lower(name)=lower(trim(p_name))
        or (p_code is not null and code is not null and lower(code)=lower(trim(p_code)))
      )
  ) then raise exception 'Faction name or code is already in use'; end if;

  insert into public.faction_proposals(created_by,name,code,description,faction_type)
  values(v_uid,trim(p_name),nullif(trim(coalesce(p_code,'')),''),
         nullif(trim(coalesce(p_description,'')),''),v_type)
  returning id into v_id;

  insert into public.faction_proposal_members(
    proposal_id,user_id,status,contribution,invited_by,responded_at
  )
  values(v_id,v_uid,'accepted',p_contribution,v_uid,now());

  return jsonb_build_object('proposal_id',v_id,'status','open','faction_type',v_type);
end;
$$;

drop function if exists public.create_faction_proposal(text,text,text,numeric);
create function public.create_faction_proposal(
  p_name text,
  p_code text default null,
  p_description text default null,
  p_contribution numeric default 0,
  p_faction_type text default 'political_bloc'
)
returns jsonb
language sql
set search_path=''
as $$
  select private.create_faction_proposal($1,$2,$3,$4,$5);
$$;
revoke all on function public.create_faction_proposal(text,text,text,numeric,text) from public,anon;
grant execute on function public.create_faction_proposal(text,text,text,numeric,text) to authenticated;

create or replace function private.invite_faction_founder(p_proposal_id uuid,p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare v_uid uuid := (select auth.uid());
begin
  if v_uid is null then raise exception 'Authentication required'; end if;
  if p_user_id=v_uid then raise exception 'You are already a founder'; end if;
  if not exists (
    select 1 from public.faction_proposals
    where id=p_proposal_id and created_by=v_uid and status='open'
  ) then raise exception 'Only the proposal creator can invite founders'; end if;
  if not exists (
    select 1 from public.friendships f
    where (f.user_a=v_uid and f.user_b=p_user_id)
       or (f.user_b=v_uid and f.user_a=p_user_id)
  ) then raise exception 'Founding invitations can only be sent to friends'; end if;
  if exists (
    select 1 from public.faction_memberships fm
    join public.factions f on f.id=fm.faction_id
    where fm.user_id=p_user_id and fm.status='active' and f.is_player_created=true
  ) then raise exception 'Player already belongs to an active faction'; end if;
  if exists (
    select 1 from public.faction_proposal_members
    where proposal_id=p_proposal_id and user_id=p_user_id
  ) then raise exception 'Player is already attached to this proposal'; end if;

  insert into public.faction_proposal_members(
    proposal_id,user_id,status,contribution,invited_by
  ) values(p_proposal_id,p_user_id,'invited',0,v_uid);

  return jsonb_build_object('invited',true);
end;
$$;

create or replace function private.finalize_faction_proposal(p_proposal_id uuid)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_cfg public.game_config%rowtype;
  v_prop public.faction_proposals%rowtype;
  v_count integer;
  v_total numeric(20,2);
  v_starting_treasury numeric(20,2);
  v_faction_id uuid;
  v_balance numeric(20,2);
  rec record;
begin
  if v_uid is null then raise exception 'Authentication required'; end if;
  select * into v_prop from public.faction_proposals where id=p_proposal_id for update;
  if not found or v_prop.status<>'open' then raise exception 'Open faction proposal not found'; end if;
  if v_prop.created_by<>v_uid then raise exception 'Only the proposal creator can found the faction'; end if;

  select * into v_cfg from public.game_config where singleton=true;
  select count(*),coalesce(sum(contribution),0)
  into v_count,v_total
  from public.faction_proposal_members
  where proposal_id=p_proposal_id and status='accepted';

  if v_count < v_cfg.faction_min_founders then raise exception 'Not enough accepted founders'; end if;
  if exists (
    select 1 from public.faction_proposal_members
    where proposal_id=p_proposal_id and status='accepted'
      and contribution < v_cfg.faction_min_contribution
  ) then raise exception 'A founder contribution is below the minimum'; end if;
  if v_total < v_cfg.faction_creation_cost then
    raise exception 'Founding contributions do not meet the creation cost';
  end if;
  if exists (
    select 1
    from public.faction_proposal_members fpm
    join public.faction_memberships fm on fm.user_id=fpm.user_id and fm.status='active'
    join public.factions f on f.id=fm.faction_id and f.is_player_created=true
    where fpm.proposal_id=p_proposal_id and fpm.status='accepted'
  ) then raise exception 'One or more founders already joined another faction'; end if;

  for rec in
    select user_id,contribution
    from public.faction_proposal_members
    where proposal_id=p_proposal_id and status='accepted'
    order by user_id
  loop
    select balance into v_balance
    from public.player_wallets
    where user_id=rec.user_id
    for update;
    if not found or v_balance < rec.contribution then
      raise exception 'A founder no longer has enough Aureum for the pledge';
    end if;
  end loop;

  v_starting_treasury := greatest(v_total-v_cfg.faction_creation_cost,0);

  insert into public.factions(
    code,name,description,treasury,status,leader_user_id,tax_rate,federal_tax_rate,
    faction_type,is_player_created,join_requests_enabled,created_by
  )
  values(
    v_prop.code,v_prop.name,v_prop.description,v_starting_treasury,'active',
    v_uid,v_cfg.faction_default_tax_rate,v_cfg.federal_faction_tax_rate,
    v_prop.faction_type,true,true,v_uid
  )
  returning id into v_faction_id;

  for rec in
    select user_id,contribution
    from public.faction_proposal_members
    where proposal_id=p_proposal_id and status='accepted'
    order by user_id
  loop
    select balance into v_balance
    from public.player_wallets
    where user_id=rec.user_id
    for update;

    update public.player_wallets
    set balance=balance-rec.contribution,updated_at=now()
    where user_id=rec.user_id;

    insert into public.player_transactions(
      user_id,amount,currency,kind,description,balance_after
    )
    values(
      rec.user_id,-rec.contribution,'Aureum','faction_founding',
      'Founding contribution for '||v_prop.name,v_balance-rec.contribution
    );

    insert into public.faction_memberships(
      user_id,faction_id,title,rank,permissions,status
    )
    values(
      rec.user_id,v_faction_id,
      case when rec.user_id=v_uid then 'Faction Leader' else 'Founder' end,
      case when rec.user_id=v_uid then 'Leader' else 'Founder' end,
      case when rec.user_id=v_uid then
        array['treasury','military','diplomacy','construction','market','research','events','intelligence','economy','politics']::text[]
      else '{}'::text[] end,
      'active'
    )
    on conflict (user_id,faction_id) do update
    set title=excluded.title,rank=excluded.rank,permissions=excluded.permissions,status='active',updated_at=now();
  end loop;

  if v_starting_treasury > 0 then
    insert into public.faction_transactions(
      faction_id,actor_user_id,amount,currency,kind,description,balance_after
    )
    values(
      v_faction_id,v_uid,v_starting_treasury,'Aureum','founding_surplus',
      'Founder contributions above the faction creation cost',v_starting_treasury
    );
  end if;

  update public.faction_proposals
  set status='founded',updated_at=now()
  where id=p_proposal_id;

  return jsonb_build_object(
    'faction_id',v_faction_id,
    'creation_cost',v_cfg.faction_creation_cost,
    'founder_contributions',v_total,
    'starting_treasury',v_starting_treasury
  );
end;
$$;

create or replace function private.invite_faction_member(p_faction_id uuid,p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare v_uid uuid := (select auth.uid()); v_id uuid;
begin
  if v_uid is null then raise exception 'Authentication required'; end if;
  if not private.is_faction_leader(p_faction_id) then
    raise exception 'Only the faction leader can invite members';
  end if;
  if p_user_id=v_uid then raise exception 'You are already the faction leader'; end if;
  if not exists (
    select 1 from public.friendships f
    where (f.user_a=v_uid and f.user_b=p_user_id)
       or (f.user_b=v_uid and f.user_a=p_user_id)
  ) then raise exception 'Membership invitations can only be sent to friends'; end if;
  if exists (
    select 1 from public.faction_memberships fm
    join public.factions f on f.id=fm.faction_id
    where fm.user_id=p_user_id and fm.status='active' and f.is_player_created=true
  ) then raise exception 'Player already belongs to an active faction'; end if;

  insert into public.faction_invitations(faction_id,invited_user_id,invited_by,status)
  values(p_faction_id,p_user_id,v_uid,'pending')
  returning id into v_id;
  return jsonb_build_object('invitation_id',v_id);
end;
$$;

create or replace function private.respond_faction_membership_invite(p_invitation_id uuid,p_accept boolean)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare v_uid uuid := (select auth.uid()); v_inv public.faction_invitations%rowtype;
begin
  if v_uid is null then raise exception 'Authentication required'; end if;
  select * into v_inv
  from public.faction_invitations
  where id=p_invitation_id and invited_user_id=v_uid and status='pending'
  for update;
  if not found then raise exception 'Pending faction invitation not found'; end if;

  if not p_accept then
    update public.faction_invitations
    set status='declined',responded_at=now()
    where id=p_invitation_id;
    return jsonb_build_object('status','declined');
  end if;

  if exists (
    select 1 from public.faction_memberships fm
    join public.factions f on f.id=fm.faction_id
    where fm.user_id=v_uid and fm.status='active' and f.is_player_created=true
  ) then raise exception 'You already belong to an active faction'; end if;

  insert into public.faction_memberships(user_id,faction_id,title,rank,permissions,status)
  values(v_uid,v_inv.faction_id,'Member','Member','{}'::text[],'active')
  on conflict (user_id,faction_id) do update
  set title='Member',rank='Member',permissions='{}'::text[],status='active',updated_at=now();

  update public.faction_invitations
  set status='accepted',responded_at=now()
  where id=p_invitation_id;

  update public.faction_join_requests
  set status='cancelled',responded_at=now(),responded_by=v_uid
  where user_id=v_uid and status='pending';

  return jsonb_build_object('status','accepted','faction_id',v_inv.faction_id);
end;
$$;

create or replace function public.get_faction_directory()
returns table(
  faction_id uuid, code text, name text, description text, faction_type text,
  leader_user_id uuid, leader_name text, member_count bigint,
  join_requests_enabled boolean, my_request_status text
)
language plpgsql
stable
security definer
set search_path=''
as $$
begin
  if (select auth.uid()) is null then raise exception 'Authentication required'; end if;
  return query
  select
    f.id,f.code,f.name,f.description,f.faction_type,f.leader_user_id,
    coalesce(p.display_name,'VACANT'),
    count(fm.id) filter(where fm.status='active'),
    f.join_requests_enabled,
    (
      select jr.status
      from public.faction_join_requests jr
      where jr.faction_id=f.id and jr.user_id=(select auth.uid())
      order by jr.created_at desc
      limit 1
    )
  from public.factions f
  left join public.faction_memberships fm on fm.faction_id=f.id
  left join public.player_profiles p on p.user_id=f.leader_user_id
  where f.status='active' and f.is_player_created=true
  group by f.id,p.display_name
  order by count(fm.id) filter(where fm.status='active') desc,f.name asc;
end;
$$;
revoke all on function public.get_faction_directory() from public,anon;
grant execute on function public.get_faction_directory() to authenticated;

create or replace function public.request_join_faction(p_faction_id uuid)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare v_uid uuid := (select auth.uid()); v_id uuid;
begin
  if v_uid is null then raise exception 'Authentication required'; end if;
  if not exists (
    select 1 from public.factions
    where id=p_faction_id and status='active'
      and is_player_created=true and join_requests_enabled=true
  ) then raise exception 'Faction is not accepting join requests'; end if;
  if exists (
    select 1 from public.faction_memberships fm
    join public.factions f on f.id=fm.faction_id
    where fm.user_id=v_uid and fm.status='active' and f.is_player_created=true
  ) then raise exception 'Leave your current faction before requesting another'; end if;
  if exists (
    select 1 from public.faction_join_requests
    where faction_id=p_faction_id and user_id=v_uid and status='pending'
  ) then raise exception 'Join request is already pending'; end if;

  insert into public.faction_join_requests(faction_id,user_id,status)
  values(p_faction_id,v_uid,'pending')
  returning id into v_id;
  return jsonb_build_object('request_id',v_id,'status','pending');
end;
$$;
revoke all on function public.request_join_faction(uuid) from public,anon;
grant execute on function public.request_join_faction(uuid) to authenticated;

create or replace function public.cancel_faction_join_request(p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare v_uid uuid := (select auth.uid());
begin
  if v_uid is null then raise exception 'Authentication required'; end if;
  update public.faction_join_requests
  set status='cancelled',responded_at=now(),responded_by=v_uid
  where id=p_request_id and user_id=v_uid and status='pending';
  if not found then raise exception 'Pending join request not found'; end if;
  return jsonb_build_object('status','cancelled');
end;
$$;
revoke all on function public.cancel_faction_join_request(uuid) from public,anon;
grant execute on function public.cancel_faction_join_request(uuid) to authenticated;

create or replace function public.get_faction_join_requests()
returns table(
  request_id uuid, faction_id uuid, user_id uuid,
  display_name text, status text, created_at timestamptz
)
language plpgsql
stable
security definer
set search_path=''
as $$
declare v_uid uuid := (select auth.uid());
begin
  if v_uid is null then raise exception 'Authentication required'; end if;
  return query
  select jr.id,jr.faction_id,jr.user_id,coalesce(p.display_name,'PLAYER'),jr.status,jr.created_at
  from public.faction_join_requests jr
  join public.factions f on f.id=jr.faction_id
  left join public.player_profiles p on p.user_id=jr.user_id
  where f.leader_user_id=v_uid
    and f.status='active'
    and f.is_player_created=true
    and jr.status='pending'
  order by jr.created_at asc;
end;
$$;
revoke all on function public.get_faction_join_requests() from public,anon;
grant execute on function public.get_faction_join_requests() to authenticated;

create or replace function public.respond_faction_join_request(p_request_id uuid,p_accept boolean)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare v_uid uuid := (select auth.uid()); v_req public.faction_join_requests%rowtype;
begin
  if v_uid is null then raise exception 'Authentication required'; end if;
  select jr.* into v_req
  from public.faction_join_requests jr
  join public.factions f on f.id=jr.faction_id
  where jr.id=p_request_id and jr.status='pending'
    and f.leader_user_id=v_uid
    and f.status='active'
    and f.is_player_created=true
  for update of jr;
  if not found then raise exception 'Pending join request not found'; end if;

  if not p_accept then
    update public.faction_join_requests
    set status='declined',responded_at=now(),responded_by=v_uid
    where id=p_request_id;
    return jsonb_build_object('status','declined');
  end if;

  if exists (
    select 1 from public.faction_memberships fm
    join public.factions f on f.id=fm.faction_id
    where fm.user_id=v_req.user_id and fm.status='active' and f.is_player_created=true
  ) then raise exception 'Player already belongs to an active faction'; end if;

  insert into public.faction_memberships(user_id,faction_id,title,rank,permissions,status)
  values(v_req.user_id,v_req.faction_id,'Member','Member','{}'::text[],'active')
  on conflict (user_id,faction_id) do update
  set title='Member',rank='Member',permissions='{}'::text[],status='active',updated_at=now();

  update public.faction_join_requests
  set status='accepted',responded_at=now(),responded_by=v_uid
  where id=p_request_id;

  update public.faction_invitations
  set status='declined',responded_at=now()
  where invited_user_id=v_req.user_id and status='pending';

  update public.faction_join_requests
  set status='cancelled',responded_at=now(),responded_by=v_uid
  where user_id=v_req.user_id and status='pending' and id<>p_request_id;

  return jsonb_build_object('status','accepted','faction_id',v_req.faction_id);
end;
$$;
revoke all on function public.respond_faction_join_request(uuid,boolean) from public,anon;
grant execute on function public.respond_faction_join_request(uuid,boolean) to authenticated;

create or replace function public.leave_faction()
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_faction public.factions%rowtype;
  v_members integer;
begin
  if v_uid is null then raise exception 'Authentication required'; end if;

  select f.* into v_faction
  from public.faction_memberships fm
  join public.factions f on f.id=fm.faction_id
  where fm.user_id=v_uid and fm.status='active' and f.is_player_created=true
  limit 1
  for update of f;

  if not found then raise exception 'You are not in an active player faction'; end if;

  select count(*) into v_members
  from public.faction_memberships
  where faction_id=v_faction.id and status='active';

  if v_faction.leader_user_id=v_uid and v_members>1 then
    raise exception 'Faction leader must transfer leadership before leaving';
  end if;

  update public.faction_memberships
  set status='left',updated_at=now()
  where user_id=v_uid and faction_id=v_faction.id and status='active';

  if v_faction.leader_user_id=v_uid then
    update public.factions
    set status='inactive',leadership_status='vacant',leader_user_id=null,updated_at=now()
    where id=v_faction.id;
  end if;

  return jsonb_build_object('status','left','faction_id',v_faction.id);
end;
$$;
revoke all on function public.leave_faction() from public,anon;
grant execute on function public.leave_faction() to authenticated;

create or replace function public.get_my_faction_forum_posts(p_limit integer default 60)
returns table(
  post_id uuid, faction_id uuid, user_id uuid, display_name text,
  body text, created_at timestamptz, edited_at timestamptz
)
language plpgsql
stable
security definer
set search_path=''
as $$
declare v_uid uuid := (select auth.uid()); v_faction_id uuid;
begin
  if v_uid is null then raise exception 'Authentication required'; end if;
  select fm.faction_id into v_faction_id
  from public.faction_memberships fm
  join public.factions f on f.id=fm.faction_id
  where fm.user_id=v_uid and fm.status='active' and f.is_player_created=true
  limit 1;
  if v_faction_id is null then return; end if;

  return query
  select fp.id,fp.faction_id,fp.user_id,coalesce(p.display_name,'PLAYER'),
         fp.body,fp.created_at,fp.edited_at
  from public.faction_forum_posts fp
  left join public.player_profiles p on p.user_id=fp.user_id
  where fp.faction_id=v_faction_id
  order by fp.created_at desc
  limit greatest(1,least(coalesce(p_limit,60),100));
end;
$$;
revoke all on function public.get_my_faction_forum_posts(integer) from public,anon;
grant execute on function public.get_my_faction_forum_posts(integer) to authenticated;

create or replace function public.post_faction_forum_message(p_body text)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_faction_id uuid;
  v_id uuid;
  v_body text := trim(coalesce(p_body,''));
begin
  if v_uid is null then raise exception 'Authentication required'; end if;
  if v_body='' then raise exception 'Post body is required'; end if;
  if char_length(v_body)>2000 then raise exception 'Post exceeds 2000 characters'; end if;

  select fm.faction_id into v_faction_id
  from public.faction_memberships fm
  join public.factions f on f.id=fm.faction_id
  where fm.user_id=v_uid and fm.status='active' and f.is_player_created=true
  limit 1;
  if v_faction_id is null then raise exception 'Active faction membership required'; end if;

  insert into public.faction_forum_posts(faction_id,user_id,body)
  values(v_faction_id,v_uid,v_body)
  returning id into v_id;

  return jsonb_build_object('post_id',v_id,'faction_id',v_faction_id);
end;
$$;
revoke all on function public.post_faction_forum_message(text) from public,anon;
grant execute on function public.post_faction_forum_message(text) to authenticated;

-- Factionless players remain Imperial citizens for personal construction.
create or replace function private.construct_player_facility(
  p_facility_type_id uuid,
  p_location_ref text,
  p_name text
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
 v_uid uuid:=(select auth.uid());
 v_faction_id uuid;
 v_territory_faction uuid;
 v_type public.facility_types%rowtype;
 v_balance numeric(20,2);
 v_after numeric(20,2);
 v_id uuid;
 v_name text;
 v_count integer;
 v_tier text;
begin
 if v_uid is null then raise exception 'Authentication required'; end if;
 if not exists(
   select 1 from public.characters
   where user_id=v_uid and status='active' and life_status='alive' and location_ref=p_location_ref
 ) then raise exception 'Your active character must be present at this location'; end if;

 select fm.faction_id into v_faction_id
 from public.faction_memberships fm
 join public.factions f on f.id=fm.faction_id
 where fm.user_id=v_uid and fm.status='active'
   and f.status='active' and f.is_player_created=true
 order by fm.created_at
 limit 1;

 if v_faction_id is null then
   select f.id into v_faction_id
   from public.factions f
   where f.status='active' and f.is_player_created=false and f.code='GME'
   limit 1;
 end if;

 if v_faction_id is null then raise exception 'No valid construction authority is available'; end if;

 select faction_id into v_territory_faction
 from public.territories where location_ref=p_location_ref;
 if v_territory_faction is null or v_territory_faction<>v_faction_id then
   raise exception 'Player facilities may only be constructed inside territory controlled by your faction or the Empire';
 end if;

 select * into v_type
 from public.facility_types
 where id=p_facility_type_id and player_buildable=true and ownership_scope<>'faction_only';
 if not found then raise exception 'This facility is restricted to faction construction'; end if;

 select count(*) into v_count from public.facilities where owner_user_id=v_uid;
 if v_count>=20 then raise exception 'Personal facility limit reached (20/20)'; end if;

 select coalesce(development_tier,'colony') into v_tier
 from public.system_economies where location_ref=p_location_ref;
 if v_type.minimum_system_tier='system' and coalesce(v_tier,'colony')='colony' then
   raise exception 'This facility requires an established System';
 end if;
 if v_type.minimum_system_tier='developed' and coalesce(v_tier,'colony')<>'developed' then
   raise exception 'This facility requires a Developed System';
 end if;

 select balance into v_balance
 from public.player_wallets where user_id=v_uid for update;
 if not found then raise exception 'Player wallet not found'; end if;
 if v_balance<v_type.build_cost_aureum then raise exception 'Insufficient Aureum'; end if;

 v_after:=v_balance-v_type.build_cost_aureum;
 v_name:=coalesce(nullif(trim(coalesce(p_name,'')),''),v_type.name);

 update public.player_wallets
 set balance=v_after,updated_at=now()
 where user_id=v_uid;

 insert into public.player_transactions(user_id,amount,currency,kind,description,balance_after)
 values(v_uid,-v_type.build_cost_aureum,'Aureum','facility_construction',
        v_name||' constructed at '||p_location_ref,v_after);

 insert into public.facilities(
   facility_type_id,owner_user_id,owner_faction_id,controlling_faction_id,
   location_ref,name,status,production_modifier,updated_at
 )
 values(v_type.id,v_uid,null,v_faction_id,p_location_ref,v_name,'active',1,now())
 returning id into v_id;

 return jsonb_build_object(
   'facility_id',v_id,'name',v_name,'location_ref',p_location_ref,
   'cost',v_type.build_cost_aureum,'balance',v_after,
   'facility_count',v_count+1,'facility_limit',20
 );
end
$$;
