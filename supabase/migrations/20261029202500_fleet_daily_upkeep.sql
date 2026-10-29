
create table if not exists public.fleet_upkeep_log(
 id bigint generated always as identity primary key,
 fleet_id uuid not null references public.fleets(id),
 faction_id uuid not null references public.factions(id),
 world_day bigint not null,
 due_aureum numeric(18,2) not null check(due_aureum>=0),
 paid_aureum numeric(18,2) not null check(paid_aureum>=0),
 status text not null check(status in('paid','unpaid')),
 created_at timestamptz not null default now(),
 unique(fleet_id,world_day)
);
create index if not exists fleet_upkeep_faction_day_idx on public.fleet_upkeep_log(faction_id,world_day desc);
alter table public.fleet_upkeep_log enable row level security;
revoke all on public.fleet_upkeep_log from public,anon,authenticated;
grant select on public.fleet_upkeep_log to authenticated;
create policy "Faction reads fleet upkeep" on public.fleet_upkeep_log for select to authenticated
using (exists(select 1 from public.faction_memberships fm where fm.user_id=(select auth.uid()) and fm.faction_id=fleet_upkeep_log.faction_id and fm.status='active')
or exists(select 1 from public.factions f where f.id=fleet_upkeep_log.faction_id and f.leader_user_id=(select auth.uid()))
or (select private.is_admin()));
create or replace function private.process_fleet_upkeep_day(p_world_day bigint)
 returns jsonb language plpgsql security definer set search_path='' as $fn$
declare rec record; due numeric; treasury numeric;processed int:=0;paid numeric:=0;
begin
 for rec in
  select f.id,f.faction_id,f.created_at,coalesce(sum(s.strength),0) hull_strength
  from public.fleets f join public.ships s on s.fleet_id=f.id and s.status='active'
  where f.status='active'
  group by f.id,f.faction_id,f.created_at order by f.faction_id,f.id
 loop
  if floor(private.world_total_hours_at(rec.created_at)/36)::bigint>p_world_day then continue;end if;
  if exists(select 1 from public.fleet_upkeep_log where fleet_id=rec.id and world_day=p_world_day) then continue;end if;
  due:=round(rec.hull_strength*0.05,2);
  select f.treasury into treasury from public.factions f where f.id=rec.faction_id for update;
  if coalesce(treasury,0)>=due then
   update public.factions set treasury=treasury-due where id=rec.faction_id;
   insert into public.fleet_upkeep_log(fleet_id,faction_id,world_day,due_aureum,paid_aureum,status)
   values(rec.id,rec.faction_id,p_world_day,due,due,'paid')
   on conflict(fleet_id,world_day) do nothing;
   paid:=paid+due;
  else
   insert into public.fleet_upkeep_log(fleet_id,faction_id,world_day,due_aureum,paid_aureum,status)
   values(rec.id,rec.faction_id,p_world_day,due,0,'unpaid')
   on conflict(fleet_id,world_day) do nothing;
  end if;
  processed:=processed+1;
 end loop;
 return jsonb_build_object('fleets_processed',processed,'paid_aureum',paid);
end;$fn$;
revoke all on function private.process_fleet_upkeep_day(bigint) from public,anon,authenticated;
do $patch$
declare body text;
begin
 body:=pg_get_functiondef('private.world_clock_heartbeat()'::regprocedure);
 if position('perform private.process_military_upkeep_day(day_idx);' in body)=0 then
 raise exception 'Military upkeep hook missing';end if;
 body:=replace(body,'perform private.process_military_upkeep_day(day_idx);',
 'perform private.process_military_upkeep_day(day_idx);
      perform private.process_fleet_upkeep_day(day_idx);');
 execute body;
end;$patch$;
