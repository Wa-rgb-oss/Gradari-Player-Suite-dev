
-- Alpha 0.5.0: Local supply corridors, army provisioning and offensive constraints.
create table if not exists public.army_supply_log(
  id bigint generated always as identity primary key,
  army_id uuid not null references public.armies(id),
  faction_id uuid not null references public.factions(id),
  world_day bigint not null,
  supply_ref text references public.system_economies(location_ref),
  supply_distance integer,
  food_used numeric not null default 0,
  energy_used numeric not null default 0,
  status text not null check(status in('supplied','shortage','isolated')),
  created_at timestamptz not null default now(),
  unique(army_id,world_day)
);
create index if not exists army_supply_faction_day on public.army_supply_log(faction_id,world_day desc);
alter table public.army_supply_log enable row level security;
revoke all on public.army_supply_log from public,anon,authenticated;
grant select on public.army_supply_log to authenticated;
create policy "Faction sees army supply" on public.army_supply_log
for select to authenticated using(
  exists(select 1 from public.faction_memberships m
    where m.faction_id=army_supply_log.faction_id and m.user_id=(select auth.uid()) and m.status='active')
  or exists(select 1 from public.factions f where f.id=army_supply_log.faction_id and f.leader_user_id=(select auth.uid()))
  or (select private.is_admin())
);

create or replace function private.find_army_supply_corridor(
  p_faction_id uuid,p_location_ref text,p_range integer default 3
) returns jsonb language sql stable set search_path='' as $fn$
 with recursive reach(q,r,ref,steps,visited) as (
  select h.q,h.r,h.location_ref,0,array[h.location_ref]::text[]
  from public.map_hexes h where h.location_ref=p_location_ref and h.player_visible=true
  union all
  select n.q,n.r,n.location_ref,reach.steps+1,reach.visited||n.location_ref
  from reach
  join public.map_hexes n on n.player_visible=true and (
    (n.q=reach.q+1 and n.r=reach.r) or
    (n.q=reach.q+1 and n.r=reach.r-1) or
    (n.q=reach.q and n.r=reach.r-1) or
    (n.q=reach.q-1 and n.r=reach.r) or
    (n.q=reach.q-1 and n.r=reach.r+1) or
    (n.q=reach.q and n.r=reach.r+1))
  left join public.territories owner on owner.location_ref=n.location_ref
  where reach.steps<least(greatest(p_range,0),6)
    and n.location_ref <> all(reach.visited)
    and (owner.faction_id is null or owner.faction_id=p_faction_id)
 )
 select coalesce((select jsonb_build_object('location_ref',e.location_ref,'distance',min(r.steps))
 from reach r join public.system_economies e on e.location_ref=r.ref and e.population>=100
 join public.territories t on t.location_ref=e.location_ref and t.faction_id=p_faction_id
 group by e.location_ref order by min(r.steps),e.location_ref limit 1),'{}'::jsonb);
$fn$;
revoke all on function private.find_army_supply_corridor(uuid,text,integer) from public,anon,authenticated;

create or replace function private.process_army_supply_day(p_world_day bigint)
returns jsonb language plpgsql security definer set search_path='' as $fn$
declare army record; corridor jsonb; source_ref text;dist integer;
 need_food numeric;need_energy numeric;src public.system_economies%rowtype;
 result text;supplied integer:=0;shortages integer:=0;isolated integer:=0;
begin
 if p_world_day is null or p_world_day<0 then raise exception 'Invalid world day';end if;
 for army in select a.id,a.faction_id,a.location_ref,a.strength,a.created_at
   from public.armies a where a.status='active' and a.strength>0 and a.location_ref is not null
   order by a.faction_id,a.id
 loop
  if floor(private.world_total_hours_at(army.created_at)/36)::bigint>p_world_day then continue;end if;
  if exists(select 1 from public.army_supply_log l where l.army_id=army.id and l.world_day=p_world_day)
    then continue;end if;
  corridor:=private.find_army_supply_corridor(army.faction_id,army.location_ref,3);
  source_ref:=corridor->>'location_ref';
  dist:=nullif(corridor->>'distance','')::integer;
  need_food:=round(greatest(.01,army.strength*.0002),4);
  need_energy:=round(greatest(.005,army.strength*.0001),4);
  if source_ref is null then
    result:='isolated';isolated:=isolated+1;
  else
    select * into src from public.system_economies where location_ref=source_ref for update;
    if src.food>=need_food and src.energy>=need_energy then
      update public.system_economies set food=food-need_food,energy=energy-need_energy,updated_at=now()
        where location_ref=source_ref;
      result:='supplied';supplied:=supplied+1;
    else
      result:='shortage';shortages:=shortages+1;
    end if;
  end if;
  insert into public.army_supply_log(army_id,faction_id,world_day,supply_ref,supply_distance,
    food_used,energy_used,status)
  values(army.id,army.faction_id,p_world_day,source_ref,dist,
    case when result='supplied' then need_food else 0 end,
    case when result='supplied' then need_energy else 0 end,result)
  on conflict(army_id,world_day) do nothing;
 end loop;
 return jsonb_build_object('world_day',p_world_day,'supplied',supplied,
   'shortages',shortages,'isolated',isolated);
end;$fn$;
revoke all on function private.process_army_supply_day(bigint) from public,anon,authenticated;

do $patch$
declare body text;
begin
 body:=pg_get_functiondef('private.world_clock_heartbeat()'::regprocedure);
 if position('perform private.process_fleet_upkeep_day(day_idx);' in body)=0
 then raise exception 'Fleet daily heartbeat hook missing';end if;
 body:=replace(body,'perform private.process_fleet_upkeep_day(day_idx);',
  'perform private.process_fleet_upkeep_day(day_idx);
      perform private.process_army_supply_day(day_idx);');
 execute body;
 body:=pg_get_functiondef('private.launch_military_operation(uuid,text,text)'::regprocedure);
 if position('if v_army.movement_status' in body)=0 then raise exception 'Operation launch integration changed';end if;
 body:=replace(body,'if v_army.movement_status',
 $frag$if exists(select 1 from public.army_supply_log l
   where l.army_id=v_army.id and l.status='isolated'
     and l.world_day>=floor(private.world_total_hours_at(now())/36)::bigint-1)
   then raise exception 'Army cannot launch an offensive while cut off from friendly supply corridors';end if;
  if v_army.movement_status$frag$);
 execute body;
end;$patch$;
