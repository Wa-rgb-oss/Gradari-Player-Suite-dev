-- Phase 1: repeatable contract cooldown prevents reward farming via idle visit objectives.
alter table public.civilian_contracts
 add column if not exists cooldown_game_hours integer not null default 36
 check(cooldown_game_hours between 1 and 10000);
alter table public.civilian_assignments
 add column if not exists accepted_world_hour bigint;
CREATE OR REPLACE FUNCTION public.accept_civilian_contract(p_contract_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
 if exists(select 1 from public.civilian_assignments old
    where old.contract_id=p_contract_id and old.status='completed'
      and old.accepted_world_hour is not null
      and old.accepted_world_hour+v_c.cooldown_game_hours>v_current
      and (old.user_id=v_user or (v_party is not null and old.user_id in
        (select user_id from public.civilian_party_members where party_id=v_party and departed_at is null)))
  ) then raise exception 'This contract is on cooldown';end if;
 v_deadline:=case when v_c.duration_game_hours is null then null else v_current+v_c.duration_game_hours end;
 if v_party is null or v_size=1 then
  insert into public.civilian_assignments(contract_id,user_id,group_id,party_id,due_world_hour,accepted_world_hour)
  values(p_contract_id,v_user,v_group,v_party,v_deadline,v_current) returning id into v_first;
 else
  insert into public.civilian_assignments(contract_id,user_id,group_id,party_id,due_world_hour)
  select p_contract_id,m.user_id,v_group,v_party,v_deadline,v_current from public.civilian_party_members m
  where m.party_id=v_party and m.departed_at is null order by m.joined_at;
  select id into v_first from public.civilian_assignments where group_id=v_group and user_id=v_user;
 end if;
 return v_first;
end $function$;

create index if not exists civilian_assignment_cooldown_idx
 on public.civilian_assignments(user_id,contract_id,accepted_world_hour desc)
 where status='completed';
