-- Alpha 0.5.0: conservative civilian population/economy, existing 36-hour game day.
create table if not exists public.civilian_economy_config (
 singleton boolean primary key default true check(singleton),
 food_per_civilian_per_day numeric not null default 0.001 check(food_per_civilian_per_day>=0),
 energy_per_civilian_per_day numeric not null default 0.001 check(energy_per_civilian_per_day>=0),
 growth_rate_per_day numeric not null default 0.003 check(growth_rate_per_day between 0 and 0.05),
 shortage_decline_rate_per_day numeric not null default 0.001 check(shortage_decline_rate_per_day between 0 and 0.05),
 tax_aureum_per_civilian_per_day numeric not null default 0.02 check(tax_aureum_per_civilian_per_day>=0),
 updated_at timestamptz not null default now()
);
insert into public.civilian_economy_config(singleton) values(true) on conflict do nothing;
alter table public.civilian_economy_config enable row level security;
revoke all on public.civilian_economy_config from anon,authenticated;
grant select,update on public.civilian_economy_config to authenticated;
create policy "Read civilian economy configuration" on public.civilian_economy_config for select to authenticated using(true);
create policy "Admins update civilian economy configuration" on public.civilian_economy_config for update to authenticated
 using((select private.is_admin())) with check((select private.is_admin()));

-- Initial suitability and movement ratings are a deterministic starting point.
-- The admin can edit these later without any procedural regeneration.
insert into public.hex_conditions(location_ref,stability_percent,movement_difficulty)
select m.location_ref,
       case when t.faction_id is not null then 85 else 65 end,
       1 + mod(abs(m.q*7+m.r*13),5)
from public.map_hexes m left join public.territories t on t.location_ref=m.location_ref
on conflict(location_ref) do nothing;

-- Seed only named, habitable systems (the current registry's developed locations);
-- no population is assigned to generic unmarked map hexes.
-- Preserve all preexisting population/supplies if already configured.
insert into public.system_economies(location_ref,population,manpower,food,slot_limit,development_tier,is_capital,development_level,
 population_capacity,energy,last_civilian_world_day)
select m.location_ref,
       case when m.location_ref='HEX_-2_-2' then 40000 else 12000 end,
       0,
       case when m.location_ref='HEX_-2_-2' then 400 else 120 end,
       8,
       case when m.location_ref='HEX_-2_-2' then 'capital' else 'developed' end,
       m.location_ref='HEX_-2_-2',
       case when m.location_ref='HEX_-2_-2' then 3 else 1 end,
       case when m.location_ref='HEX_-2_-2' then 80000 else 30000 end,
       case when m.location_ref='HEX_-2_-2' then 400 else 120 end,
       floor(private.world_total_hours_at(now())/36)::bigint
from public.map_hexes m
where m.display_name is not null and trim(m.display_name)<>'' and m.habitable_systems>0
on conflict(location_ref) do update
 set population_capacity=coalesce(public.system_economies.population_capacity,excluded.population_capacity),
 last_civilian_world_day=coalesce(public.system_economies.last_civilian_world_day,excluded.last_civilian_world_day);

-- The lifecycle is run exactly once per system per elapsed in-game day,
-- including when missed days are replayed after downtime.
create or replace function private.process_civilian_day(p_world_day bigint)
returns jsonb language plpgsql security definer set search_path='' as $$
declare c public.civilian_economy_config%rowtype; s record;v_need_food numeric;v_need_energy numeric;
 v_supplied boolean;v_after bigint;v_increase numeric;v_stability numeric;v_tax numeric;v_owner uuid;
 v_count int:=0;v_taxes numeric:=0;
begin
 select * into c from public.civilian_economy_config where singleton=true;
 if not found then raise exception 'Civilian balance is unconfigured';end if;
 for s in
  select e.*,coalesce(h.stability_percent,65) stability
  from public.system_economies e
  left join public.hex_conditions h on h.location_ref=e.location_ref
  where e.population_capacity is not null and e.population_capacity>0 and (e.last_civilian_world_day is null or e.last_civilian_world_day<p_world_day)
  order by e.location_ref for update of e
 loop
  if exists(select 1 from public.civilian_population_ledger where location_ref=s.location_ref and world_day=p_world_day) then
   update public.system_economies set last_civilian_world_day=p_world_day where location_ref=s.location_ref;
   continue;
  end if;
  v_stability:=greatest(0,least(100,s.stability));
  v_need_food:=s.population*c.food_per_civilian_per_day;
  v_need_energy:=s.population*c.energy_per_civilian_per_day;
  v_supplied:=s.food>=v_need_food and s.energy>=v_need_energy;
  if v_supplied then
   v_increase:=s.population*c.growth_rate_per_day*(v_stability/100)
     *greatest(0,(s.population_capacity-s.population)::numeric/s.population_capacity);
   v_after:=least(s.population_capacity,s.population+floor(v_increase)::bigint);
  else
   v_after:=greatest(0,s.population-ceil(s.population*c.shortage_decline_rate_per_day)::bigint);
  end if;
  v_tax:=round((case when v_supplied then 1 else 0.5 end)
          *s.population*c.tax_aureum_per_civilian_per_day*(v_stability/100),2);
  select faction_id into v_owner from public.territories where location_ref=s.location_ref;
  insert into public.civilian_population_ledger(location_ref,world_day,civilian_before,civilian_after,food_consumed,energy_consumed,tax_revenue)
   values(s.location_ref,p_world_day,s.population,v_after,least(s.food,v_need_food),least(s.energy,v_need_energy),
     case when v_owner is null then 0 else v_tax end);
  update public.system_economies set
   population=v_after,
   manpower=least(manpower,floor(v_after*0.1)::bigint),
   food=greatest(0,food-v_need_food),
   energy=greatest(0,energy-v_need_energy),
   last_civilian_world_day=p_world_day,
   updated_at=now() where location_ref=s.location_ref;
  if v_owner is not null and v_tax>0 then
   update public.factions set treasury=coalesce(treasury,0)+v_tax,updated_at=now() where id=v_owner;
   v_taxes:=v_taxes+v_tax;
  end if;
  v_count:=v_count+1;
 end loop;
 return jsonb_build_object('world_day',p_world_day,'systems_processed',v_count,'government_taxes',v_taxes);
end $$;
revoke all on function private.process_civilian_day(bigint) from public,anon,authenticated;
