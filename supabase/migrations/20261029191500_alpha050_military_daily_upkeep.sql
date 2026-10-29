
create table if not exists public.military_upkeep_log(
  id bigint generated always as identity primary key,
  army_id uuid not null references public.armies(id),
  faction_id uuid not null references public.factions(id),
  world_day bigint not null,
  personnel numeric not null check(personnel>=0),
  due_aureum numeric(18,2) not null check(due_aureum>=0),
  paid_aureum numeric(18,2) not null check(paid_aureum>=0),
  status text not null check(status in('paid','unpaid')),
  processed_at timestamptz not null default now(),
  unique(army_id,world_day)
);
create index if not exists military_upkeep_log_faction_day_idx on public.military_upkeep_log(faction_id,world_day desc);
alter table public.military_upkeep_log enable row level security;
revoke all on public.military_upkeep_log from anon,authenticated;
grant select on public.military_upkeep_log to authenticated;
drop policy if exists "Military members see upkeep" on public.military_upkeep_log;
create policy "Military members see upkeep" on public.military_upkeep_log
 for select to authenticated
 using(
  exists(select 1 from public.faction_memberships m where m.faction_id=military_upkeep_log.faction_id
    and m.user_id=(select auth.uid()) and m.status='active')
  or exists(select 1 from public.factions f where f.id=military_upkeep_log.faction_id and f.leader_user_id=(select auth.uid()))
  or (select private.is_admin())
 );
create or replace function private.process_military_upkeep_day(p_world_day bigint)
 returns jsonb language plpgsql security definer set search_path='' as $function$
declare
  v_army record;
  v_due numeric;
  v_treasury numeric;
  v_count integer:=0;
  v_paid numeric:=0;
  v_unpaid numeric:=0;
begin
  if p_world_day is null or p_world_day<0 then raise exception 'Invalid world day'; end if;
  for v_army in
    select a.id,a.faction_id,a.strength
    from public.armies a where a.status='active' and a.strength>0
      and floor(private.world_total_hours_at(a.created_at)/36.0)::bigint <= p_world_day
    order by a.faction_id,a.id
  loop
    if exists(select 1 from public.military_upkeep_log
      where army_id=v_army.id and world_day=p_world_day) then
      continue;
    end if;
    -- One world day = 36 game hours. Upkeep is 0.50 Aureum per soldier per day.
    v_due:=round(v_army.strength*0.50,2);
    select treasury into v_treasury from public.factions
      where id=v_army.faction_id for update;
    if coalesce(v_treasury,0)>=v_due then
      update public.factions set treasury=treasury-v_due where id=v_army.faction_id;
      insert into public.military_upkeep_log(army_id,faction_id,world_day,personnel,due_aureum,paid_aureum,status)
       values(v_army.id,v_army.faction_id,p_world_day,v_army.strength,v_due,v_due,'paid')
       on conflict(army_id,world_day) do nothing;
      v_paid:=v_paid+v_due;
    else
      insert into public.military_upkeep_log(army_id,faction_id,world_day,personnel,due_aureum,paid_aureum,status)
       values(v_army.id,v_army.faction_id,p_world_day,v_army.strength,v_due,0,'unpaid')
       on conflict(army_id,world_day) do nothing;
      v_unpaid:=v_unpaid+v_due;
    end if;
    v_count:=v_count+1;
  end loop;
  return jsonb_build_object('world_day',p_world_day,'armies_processed',v_count,
    'paid_aureum',v_paid,'unpaid_aureum',v_unpaid);
end;
$function$;
revoke all on function private.process_military_upkeep_day(bigint) from public,anon,authenticated;
do $patch$
declare v_sql text;
begin
 select pg_get_functiondef(p.oid) into v_sql
 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='private' and p.proname='world_clock_heartbeat'
 limit 1;
 if v_sql is null or position('perform private.process_civilian_day(day_idx);' in v_sql)=0 then
   raise exception 'Heartbeat integration point not found';
 end if;
 if position('perform private.process_military_upkeep_day(day_idx);' in v_sql)=0 then
   v_sql:=replace(v_sql,
    'perform private.process_civilian_day(day_idx);',
    'perform private.process_civilian_day(day_idx);
      perform private.process_military_upkeep_day(day_idx);');
   execute v_sql;
 end if;
end;
$patch$;
