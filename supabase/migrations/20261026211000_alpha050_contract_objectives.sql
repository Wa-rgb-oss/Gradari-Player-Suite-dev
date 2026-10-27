-- Alpha 0.5.0: contract verification, finite durations, party participation and atomic rewards.
alter table public.civilian_contracts
 add column if not exists objective_kind text not null default 'visit_hex' check(objective_kind in ('visit_hex','supply_system','political_activity')),
 add column if not exists objective_resource_code text references public.resource_catalog(code),
 add column if not exists objective_quantity numeric not null default 0 check(objective_quantity>=0);
alter table public.civilian_assignments
 add column if not exists group_id uuid,
 add column if not exists party_id uuid references public.civilian_parties(id);
create index if not exists civilian_assignment_group_idx on public.civilian_assignments(group_id);
create table if not exists public.civilian_contract_supplies (
 id uuid primary key default gen_random_uuid(),
 group_id uuid not null,
 user_id uuid not null references auth.users(id),
 contract_id uuid not null references public.civilian_contracts(id),
 location_ref text not null,
 resource_code text not null references public.resource_catalog(code),
 quantity numeric not null check(quantity>0),
 created_at timestamptz not null default now()
);
alter table public.civilian_contract_supplies enable row level security;
revoke all on public.civilian_contract_supplies from anon,authenticated;
grant select on public.civilian_contract_supplies to authenticated;
create policy "Contract participants view supplies" on public.civilian_contract_supplies
 for select to authenticated using (
  exists(select 1 from public.civilian_assignments a
   where a.group_id=civilian_contract_supplies.group_id and a.user_id=(select auth.uid()))
  or (select private.is_admin())
 );
create table if not exists public.civilian_reputation (
 user_id uuid primary key references auth.users(id) on delete cascade,
 economic integer not null default 0 check(economic>=0),
 political integer not null default 0 check(political>=0),
 exploration integer not null default 0 check(exploration>=0),
 updated_at timestamptz not null default now()
);
alter table public.civilian_reputation enable row level security;
revoke all on public.civilian_reputation from anon,authenticated;
grant select on public.civilian_reputation to authenticated;
create policy "Players view their reputation" on public.civilian_reputation for select to authenticated
 using(user_id=(select auth.uid()) or (select private.is_admin()));

create table if not exists public.civilian_political_activity_claims (
 activity_id uuid primary key references public.political_activity_log(id),
 group_id uuid not null
);
alter table public.civilian_political_activity_claims enable row level security;
revoke all on public.civilian_political_activity_claims from anon,authenticated;

create or replace function public.accept_civilian_contract(p_contract_id uuid)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_user uuid:=(select auth.uid());v_c public.civilian_contracts%rowtype;
 v_party uuid;v_leader uuid;v_size int:=1;v_group uuid:=gen_random_uuid();v_first uuid;
 v_deadline bigint;v_current bigint;
begin
 if v_user is null then raise exception 'Authentication required';end if;
 select * into v_c from public.civilian_contracts where id=p_contract_id for share;
 if not found or v_c.status<>'active' or (v_c.available_at is not null and v_c.available_at>now())
   or (v_c.accept_before is not null and v_c.accept_before<=now()) then
  raise exception 'Contract unavailable';
 end if;
 if v_c.objective_kind in ('visit_hex','supply_system') and v_c.location_ref is null then raise exception 'Contract lacks a destination';end if;
 if v_c.objective_kind='supply_system' and (v_c.objective_resource_code not in ('food','energy') or v_c.objective_quantity<=0)
 then raise exception 'Contract supply target is invalid';end if;
 -- Serialize player enrolments to prevent duplicate simultaneous acceptances.
 perform pg_advisory_xact_lock(hashtext('civilian-contract-player'),hashtext(v_user::text));
 select m.party_id,p.leader_user_id into v_party,v_leader from public.civilian_party_members m
  join public.civilian_parties p on p.id=m.party_id
  where m.user_id=v_user and m.departed_at is null and p.status='active';
 if v_party is not null then
  perform 1 from public.civilian_parties where id=v_party for update;
  select count(*) into v_size from public.civilian_party_members where party_id=v_party and departed_at is null;
  if v_size>1 and v_leader<>v_user then raise exception 'Only party leader can accept a group contract';end if;
 end if;
 if v_size<v_c.min_party_size or v_size>v_c.max_party_size then raise exception 'Party size outside contract requirements';end if;
 if exists(select 1 from public.civilian_assignments a
   where a.contract_id=p_contract_id and a.status in ('accepted','in_progress')
     and (a.user_id=v_user or (v_party is not null and a.user_id in
      (select user_id from public.civilian_party_members where party_id=v_party and departed_at is null))))
 then raise exception 'Party member already has an active copy of this contract';end if;
 v_current:=floor(private.world_total_hours_at(now()));
 v_deadline:=case when v_c.duration_game_hours is null then null else v_current+v_c.duration_game_hours end;
 if v_party is null or v_size=1 then
  insert into public.civilian_assignments(contract_id,user_id,group_id,party_id,due_world_hour)
  values(p_contract_id,v_user,v_group,v_party,v_deadline) returning id into v_first;
 else
  insert into public.civilian_assignments(contract_id,user_id,group_id,party_id,due_world_hour)
  select p_contract_id,m.user_id,v_group,v_party,v_deadline from public.civilian_party_members m
  where m.party_id=v_party and m.departed_at is null order by m.joined_at;
  select id into v_first from public.civilian_assignments where group_id=v_group and user_id=v_user;
 end if;
 return v_first;
end $$;

create or replace function public.supply_civilian_system(
 p_location_ref text,p_resource text,p_quantity numeric,p_source text default 'player',p_assignment_id uuid default null
) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_user uuid:=(select auth.uid());v_owned numeric;v_faction uuid;v_group uuid;v_contract uuid;
 v_objective public.civilian_contracts%rowtype;v_a public.civilian_assignments%rowtype;
begin
 if v_user is null then raise exception 'Authentication required';end if;
 if p_resource not in ('food','energy') or p_quantity is null or p_quantity<=0 or p_quantity>1000000 then raise exception 'Invalid supply quantity or resource';end if;
 if not exists(select 1 from public.system_economies where location_ref=p_location_ref) then raise exception 'Unknown populated system';end if;
 if p_source not in ('player','faction') then raise exception 'Unknown supply source';end if;
 if not exists(select 1 from public.characters where user_id=v_user and location_ref=p_location_ref
   and status='active' and life_status='alive' and movement_status='stationary')
 then raise exception 'Your character must be stationed at the destination';end if;

 if p_assignment_id is not null then
  select * into v_a from public.civilian_assignments where id=p_assignment_id and user_id=v_user for update;
  if not found or v_a.status not in ('accepted','in_progress') then raise exception 'Active assignment required';end if;
  if v_a.due_world_hour is not null and private.world_total_hours_at(now())>=v_a.due_world_hour then raise exception 'Assignment has expired';end if;
  select * into v_objective from public.civilian_contracts where id=v_a.contract_id;
  if v_objective.objective_kind<>'supply_system' or v_objective.location_ref<>p_location_ref
  or v_objective.objective_resource_code<>p_resource then raise exception 'Supply does not match assignment';end if;
 end if;

 if p_source='player' then
  select quantity into v_owned from public.player_resources
   where user_id=v_user and resource_code=p_resource for update;
  if coalesce(v_owned,0)<p_quantity then raise exception 'Insufficient personal resources';end if;
  update public.player_resources set quantity=quantity-p_quantity,updated_at=now()
  where user_id=v_user and resource_code=p_resource;
 else
  select t.faction_id into v_faction from public.territories t
  join public.factions f on f.id=t.faction_id
  where t.location_ref=p_location_ref and f.leader_user_id=v_user;
  if v_faction is null then raise exception 'Only the controlling faction leader can commit faction supplies';end if;
  select quantity into v_owned from public.faction_resources
  where faction_id=v_faction and resource_code=p_resource for update;
  if coalesce(v_owned,0)<p_quantity then raise exception 'Insufficient faction resources';end if;
  update public.faction_resources set quantity=quantity-p_quantity,updated_at=now()
  where faction_id=v_faction and resource_code=p_resource;
 end if;
 update public.system_economies set
  food=case when p_resource='food' then food+p_quantity else food end,
  energy=case when p_resource='energy' then energy+p_quantity else energy end,
  updated_at=now() where location_ref=p_location_ref;
 if p_assignment_id is not null then
  insert into public.civilian_contract_supplies(group_id,user_id,contract_id,location_ref,resource_code,quantity)
  values(v_a.group_id,v_user,v_a.contract_id,p_location_ref,p_resource,p_quantity);
  update public.civilian_assignments set status='in_progress'
   where group_id=v_a.group_id and status='accepted';
 end if;
 return jsonb_build_object('supplied',p_quantity,'resource',p_resource,'location_ref',p_location_ref,'source',p_source);
end $$;

create or replace function public.claim_civilian_assignment(p_assignment_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_user uuid:=(select auth.uid());v_a public.civilian_assignments%rowtype;
 v_c public.civilian_contracts%rowtype;v_member record;v_members integer;v_index integer:=0;
 v_wallet numeric;v_amount numeric;v_rp numeric;v_rep integer;v_progress numeric;
 v_activity uuid;v_total numeric:=0;v_last uuid;
begin
 if v_user is null then raise exception 'Authentication required';end if;
 select * into v_a from public.civilian_assignments where id=p_assignment_id and user_id=v_user;
 if not found then raise exception 'Assignment not found';end if;
 perform pg_advisory_xact_lock(hashtext('civilian-assignment'),hashtext(v_a.group_id::text));
 select * into v_a from public.civilian_assignments where id=p_assignment_id for update;
 if v_a.status not in ('accepted','in_progress') then raise exception 'Assignment already resolved';end if;
 if v_a.due_world_hour is not null and private.world_total_hours_at(now())>=v_a.due_world_hour then
  update public.civilian_assignments set status='failed' where group_id=v_a.group_id and status in ('accepted','in_progress');
  raise exception 'Assignment deadline has passed';
 end if;
 select * into v_c from public.civilian_contracts where id=v_a.contract_id;
 select count(*) into v_members from public.civilian_assignments where group_id=v_a.group_id and status in ('accepted','in_progress');
 if v_members=0 then raise exception 'No active participants';end if;
 if exists(select 1 from public.civilian_assignments where group_id=v_a.group_id and status not in ('accepted','in_progress'))
 then raise exception 'Party assignment has already been resolved';end if;

 if v_c.objective_kind='visit_hex' then
  if exists(select 1 from public.civilian_assignments m where m.group_id=v_a.group_id and not exists(
    select 1 from public.characters ch where ch.user_id=m.user_id and ch.location_ref=v_c.location_ref
     and ch.status='active' and ch.life_status='alive' and ch.movement_status='stationary'))
  then raise exception 'All participants must arrive at the destination';end if;
 elsif v_c.objective_kind='supply_system' then
  select coalesce(sum(quantity),0) into v_progress from public.civilian_contract_supplies
   where group_id=v_a.group_id and contract_id=v_a.contract_id and resource_code=v_c.objective_resource_code and location_ref=v_c.location_ref;
  if v_progress<v_c.objective_quantity then raise exception 'Deliver more supplies before completing';end if;
 elsif v_c.objective_kind='political_activity' then
  for v_member in select * from public.civilian_assignments where group_id=v_a.group_id order by accepted_at,id loop
   select p.id into v_activity from public.political_activity_log p
   where p.user_id=v_member.user_id and p.created_at>=v_member.accepted_at
    and not exists(select 1 from public.civilian_political_activity_claims used where used.activity_id=p.id)
   order by p.created_at limit 1 for update of p;
   if v_activity is null then raise exception 'Each participant must complete a new political activity';end if;
   insert into public.civilian_political_activity_claims(activity_id,group_id) values(v_activity,v_a.group_id);
  end loop;
 else raise exception 'Unknown contract objective';end if;

 for v_member in select * from public.civilian_assignments where group_id=v_a.group_id order by accepted_at,id loop
  v_index:=v_index+1;
  -- Only pennies are distributed; rounding leftovers go to the final participant.
  v_amount:=case when v_index<v_members
   then trunc(v_c.reward_aureum/v_members,2)
   else v_c.reward_aureum - trunc(v_c.reward_aureum/v_members,2)*(v_members-1) end;
  v_rp:=case when v_index<v_members
   then trunc(v_c.reward_research_points::numeric/v_members)
   else v_c.reward_research_points - trunc(v_c.reward_research_points::numeric/v_members)*(v_members-1) end;
  v_rep:=case when v_index<v_members
   then floor(v_c.reward_reputation::numeric/v_members)::integer
   else v_c.reward_reputation - floor(v_c.reward_reputation::numeric/v_members)::integer*(v_members-1) end;
  insert into public.player_wallets(user_id,currency,balance) values(v_member.user_id,'Aureum',0)
   on conflict(user_id) do nothing;
  update public.player_wallets set balance=balance+v_amount,updated_at=now()
   where user_id=v_member.user_id returning balance into v_wallet;
  if v_amount>0 then
   insert into public.player_transactions(user_id,amount,currency,kind,description,balance_after)
   values(v_member.user_id,v_amount,'Aureum','civilian_contract',v_c.title,v_wallet);
  end if;
  if v_rp>0 then perform private.add_player_research_points(v_member.user_id,v_rp);end if;
  insert into public.civilian_reputation(user_id) values(v_member.user_id)
   on conflict(user_id) do nothing;
  update public.civilian_reputation set
   economic=economic+case when v_c.career_path='economic' then v_rep else 0 end,
   political=political+case when v_c.career_path='political' then v_rep else 0 end,
   exploration=exploration+case when v_c.career_path='exploration' then v_rep else 0 end,
   updated_at=now() where user_id=v_member.user_id;
  v_total:=v_total+v_amount;
 end loop;
 update public.civilian_assignments set status='completed',completed_at=now()
  where group_id=v_a.group_id and status in ('accepted','in_progress');
 return jsonb_build_object('completed',true,'participants',v_members,'aureum_distributed',v_total,'contract',v_c.title);
end $$;

create or replace function public.cancel_civilian_assignment(p_assignment_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_a public.civilian_assignments%rowtype;
begin
 select * into v_a from public.civilian_assignments where id=p_assignment_id and user_id=(select auth.uid());
 if not found or v_a.status not in ('accepted','in_progress') then raise exception 'Active assignment not found';end if;
 perform pg_advisory_xact_lock(hashtext('civilian-assignment'),hashtext(v_a.group_id::text));
 update public.civilian_assignments set status='cancelled' where group_id=v_a.group_id and status in ('accepted','in_progress');
 return jsonb_build_object('cancelled',true);
end $$;

create or replace function private.expire_civilian_assignments()
returns integer language plpgsql security definer set search_path='' as $$
declare v_count integer;
begin
 update public.civilian_assignments set status='failed'
 where status in ('accepted','in_progress') and due_world_hour is not null and due_world_hour<=private.world_total_hours_at(now());
 get diagnostics v_count=row_count;
 return v_count;
end $$;
revoke all on function private.expire_civilian_assignments() from public,anon,authenticated;
revoke all on function public.accept_civilian_contract(uuid),public.claim_civilian_assignment(uuid),
 public.cancel_civilian_assignment(uuid),public.supply_civilian_system(text,text,numeric,text,uuid) from public,anon;
grant execute on function public.accept_civilian_contract(uuid),public.claim_civilian_assignment(uuid),
 public.cancel_civilian_assignment(uuid),public.supply_civilian_system(text,text,numeric,text,uuid) to authenticated;
