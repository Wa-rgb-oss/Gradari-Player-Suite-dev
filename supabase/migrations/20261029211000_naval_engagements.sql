
create table if not exists public.naval_operations(
 id uuid primary key default gen_random_uuid(),
 attacking_fleet_id uuid not null references public.fleets(id),
 attacker_faction_id uuid not null references public.factions(id),
 defender_faction_id uuid not null references public.factions(id),
 location_ref text not null references public.map_hexes(location_ref),
 ordered_by uuid not null references auth.users(id),
 start_world_hour numeric not null,resolve_world_hour numeric not null,
 status text not null default 'active' check(status in ('active','resolved','cancelled')),
 outcome text,created_at timestamptz not null default now(),resolved_at timestamptz
);
create unique index if not exists naval_operation_single_active on public.naval_operations(attacking_fleet_id) where status='active';
create table if not exists public.naval_battle_reports(
 id uuid primary key default gen_random_uuid(),
 operation_id uuid not null unique references public.naval_operations(id),
 attacker_before numeric not null,
 defender_before numeric not null,
 attacker_after numeric not null,
 defender_after numeric not null,
 victor_faction_id uuid references public.factions(id),
 created_at timestamptz not null default now()
);
alter table public.naval_operations enable row level security;
alter table public.naval_battle_reports enable row level security;
revoke all on public.naval_operations,public.naval_battle_reports from public,anon,authenticated;
grant select on public.naval_operations,public.naval_battle_reports to authenticated;
create policy "Players read naval operations" on public.naval_operations for select to authenticated using (true);
create policy "Players read naval battle reports" on public.naval_battle_reports for select to authenticated using (true);

create or replace function private.launch_naval_engagement(p_fleet uuid,p_enemy_faction uuid)
returns jsonb language plpgsql security definer set search_path='' as $fn$
declare f public.fleets%rowtype; h numeric;oid uuid;
begin
 select * into f from public.fleets where id=p_fleet and status='active' and movement_status='stationary' for update;
 if not found or not private.has_faction_permission(f.faction_id,'military') then raise exception 'Fleet military authority required';end if;
 if p_enemy_faction=f.faction_id then raise exception 'Cannot engage friendly ships';end if;
 if not exists(select 1 from public.ships s where s.fleet_id=f.id and s.status='active' and s.strength>0) then raise exception 'No active ships in this fleet';end if;
 if not exists(select 1 from public.ships s where s.faction_id=p_enemy_faction and s.location_ref=f.location_ref and s.status='active' and s.strength>0)
 then raise exception 'No hostile ships at fleet location';end if;
 if exists(select 1 from public.fleet_upkeep_log l where l.fleet_id=f.id and l.status='unpaid' and l.world_day>=floor(private.world_total_hours_at(now())/36)::bigint-1)
 then raise exception 'Fleet cannot engage while upkeep is unpaid';end if;
 h:=private.world_total_hours_at(now());
 insert into public.naval_operations(attacking_fleet_id,attacker_faction_id,defender_faction_id,location_ref,ordered_by,start_world_hour,resolve_world_hour)
 values(f.id,f.faction_id,p_enemy_faction,f.location_ref,auth.uid(),h,h+12) returning id into oid;
 return jsonb_build_object('operation_id',oid,'resolve_world_hour',h+12);
end;$fn$;
create or replace function public.launch_naval_engagement(p_fleet uuid,p_enemy_faction uuid) returns jsonb
language sql security definer set search_path='' as $fn$ select private.launch_naval_engagement($1,$2);$fn$;
revoke all on function public.launch_naval_engagement(uuid,uuid) from public,anon;
grant execute on function public.launch_naval_engagement(uuid,uuid) to authenticated;
create or replace function private.resolve_due_naval_battles()
returns jsonb language plpgsql security definer set search_path='' as $fn$
declare op public.naval_operations%rowtype;ast numeric;dst numeric; aloss numeric;dloss numeric;
 win boolean; war_id uuid;oldstr numeric; rec record; delta numeric;count_done integer:=0;
begin
 for op in select * from public.naval_operations where status='active' and resolve_world_hour<=private.world_total_hours_at(now()) order by resolve_world_hour,id for update loop
  select coalesce(sum(strength),0) into ast from public.ships where fleet_id=op.attacking_fleet_id and location_ref=op.location_ref and status='active';
  select coalesce(sum(strength),0) into dst from public.ships where faction_id=op.defender_faction_id and location_ref=op.location_ref and status='active';
  win:=ast>=greatest(dst,1)*1.1;
  aloss:=least(ast,ceil(dst*case when win then .15 else .4 end));
  dloss:=least(dst,ceil(ast*case when win then .35 else .15 end));
  for rec in select id,strength from public.ships where fleet_id=op.attacking_fleet_id and location_ref=op.location_ref and status='active' order by id for update loop
   delta:=case when ast>0 then least(rec.strength,ceil(aloss*rec.strength/ast)) else 0 end;
   update public.ships set strength=greatest(0,strength-delta),status=case when strength<=delta then 'destroyed' else status end,updated_at=now() where id=rec.id;
  end loop;
  for rec in select id,strength from public.ships where faction_id=op.defender_faction_id and location_ref=op.location_ref and status='active' order by id for update loop
   delta:=case when dst>0 then least(rec.strength,ceil(dloss*rec.strength/dst)) else 0 end;
   update public.ships set strength=greatest(0,strength-delta),status=case when strength<=delta then 'destroyed' else status end,updated_at=now() where id=rec.id;
  end loop;
  update public.fleets f set status='destroyed',updated_at=now() where f.status='active' and not exists(select 1 from public.ships s where s.fleet_id=f.id and s.status='active') and exists(select 1 from public.ships s0 where s0.fleet_id=f.id);
  insert into public.naval_battle_reports(operation_id,attacker_before,defender_before,attacker_after,defender_after,victor_faction_id)
   values(op.id,ast,dst,greatest(0,ast-aloss),greatest(0,dst-dloss),
     case when win then op.attacker_faction_id else op.defender_faction_id end);
  update public.naval_operations set status='resolved',outcome=case when win then 'success' else 'failure' end,resolved_at=now() where id=op.id;
  select id into war_id from public.military_wars where status='active' and
    least(attacker_faction_id,defender_faction_id)=least(op.attacker_faction_id,op.defender_faction_id)
    and greatest(attacker_faction_id,defender_faction_id)=greatest(op.attacker_faction_id,op.defender_faction_id) for update;
  if war_id is null then
   insert into public.military_wars(attacker_faction_id,defender_faction_id) values(op.attacker_faction_id,op.defender_faction_id)
   returning id into war_id;
  end if;
  update public.military_wars set attacker_score=attacker_score+
    case when (win and attacker_faction_id=op.attacker_faction_id) or (not win and attacker_faction_id=op.defender_faction_id) then 10 else 0 end,
    defender_score=defender_score+
    case when (win and defender_faction_id=op.attacker_faction_id) or (not win and defender_faction_id=op.defender_faction_id) then 10 else 0 end
    where id=war_id;
  count_done:=count_done+1;
 end loop;
 return jsonb_build_object('naval_battles_resolved',count_done);
end;$fn$;
revoke all on function private.resolve_due_naval_battles() from public,anon,authenticated;
do $patch$
declare body text;
begin
 body:=pg_get_functiondef('private.world_clock_heartbeat()'::regprocedure);
 if position('perform private.resolve_due_battles();' in body)=0 then raise exception 'Strategic battle hook missing';end if;
 body:=replace(body,'perform private.resolve_due_battles();',
   'perform private.resolve_due_battles();
  perform private.resolve_due_naval_battles();');
 execute body;
end;$patch$;
