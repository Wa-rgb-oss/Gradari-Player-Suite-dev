-- Phase 1: risk-based piracy travel delays, factory energy-cell supplies, population stability feedback.
create table if not exists public.civilian_travel_incidents(
 id uuid primary key default gen_random_uuid(),
 travel_id uuid not null unique references public.character_travel(id) on delete cascade,
 user_id uuid not null references auth.users(id) on delete cascade,
 location_ref text not null references public.map_hexes(location_ref),
 incident_type text not null check(incident_type in ('piracy_disruption')),
 delay_world_hours numeric not null check(delay_world_hours>=0),
 created_at timestamptz not null default now()
);
alter table public.civilian_travel_incidents enable row level security;
revoke all on public.civilian_travel_incidents from anon,authenticated;
grant select on public.civilian_travel_incidents to authenticated;
create policy "Travelers see own incidents" on public.civilian_travel_incidents
 for select to authenticated using(user_id=(select auth.uid()) or (select private.is_admin()));

CREATE OR REPLACE FUNCTION private.begin_character_travel(p_character_id uuid, p_to_ref text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_uid uuid := (select auth.uid());
  v_char public.characters%rowtype;
  v_distance integer;
  v_now numeric;
  v_hours_per_hex numeric;
  v_difficulty integer:=3;
  v_navigation_modifier numeric:=1;
  v_piracy_chance numeric:=0;
  v_piracy_delay numeric:=0;
  v_stability numeric:=65;
  v_arrive numeric;
  v_id uuid;
begin
  if v_uid is null then raise exception 'Authentication required'; end if;

  select * into v_char
  from public.characters
  where id=p_character_id and user_id=v_uid and status='active' and life_status='alive'
  for update;

  if not found then raise exception 'Active living character not found'; end if;
  if v_char.location_ref is null then raise exception 'Character must have an initial map location'; end if;
  if v_char.movement_status<>'stationary' then raise exception 'Character is already traveling'; end if;
  if not exists(select 1 from public.map_hexes where location_ref=p_to_ref and player_visible=true) then
    raise exception 'Destination is not available';
  end if;

  v_distance:=private.hex_distance(v_char.location_ref,p_to_ref);
  if v_distance<1 then raise exception 'Choose a different destination'; end if;
  if v_distance<>1 then raise exception 'Alpha 0.5.0 travel requires an adjacent hex; travel through intervening hexes first';end if;
  select coalesce(movement_difficulty,3) into v_difficulty from public.hex_conditions where location_ref=p_to_ref;
  v_difficulty:=coalesce(v_difficulty,3);
  if exists(select 1 from public.player_research_perks p join public.research_perks r on r.id=p.perk_id where p.user_id=v_uid and r.code in ('NAVIGATION_PROTOCOLS','DEEP_SPACE_NAVIGATION')) then v_navigation_modifier:=0.9;end if;

  v_now:=private.world_total_hours_at(now());
  select character_travel_hours_per_hex into v_hours_per_hex from public.game_config where singleton=true;
  select coalesce(stability_percent,65) into v_stability from public.hex_conditions where location_ref=p_to_ref;
  v_piracy_chance:=least(0.35,greatest(0,(100-coalesce(v_stability,65))*0.002+(v_difficulty-1)*0.01));
  if random()<v_piracy_chance then v_piracy_delay:=v_hours_per_hex*0.5;end if;
  v_arrive:=v_now+(v_distance*v_hours_per_hex*(0.75+0.25*v_difficulty)*v_navigation_modifier)+v_piracy_delay;

  insert into public.character_travel(
    character_id,user_id,from_ref,to_ref,distance,depart_world_hour,arrive_world_hour,status
  )
  values(p_character_id,v_uid,v_char.location_ref,p_to_ref,v_distance,v_now,v_arrive,'traveling')
  returning id into v_id;
  if v_piracy_delay>0 then
    insert into public.civilian_travel_incidents(travel_id,user_id,location_ref,incident_type,delay_world_hours)
    values(v_id,v_uid,p_to_ref,'piracy_disruption',v_piracy_delay);
  end if;

  update public.characters
  set movement_status='traveling',updated_at=now()
  where id=p_character_id;

  return jsonb_build_object(
    'travel_id',v_id,'distance',v_distance,'depart_world_hour',v_now,
    'arrive_world_hour',v_arrive,'travel_hours',v_distance*v_hours_per_hex*(0.75+0.25*v_difficulty)*v_navigation_modifier+v_piracy_delay,
    'piracy_incident',v_piracy_delay>0,'piracy_delay_hours',v_piracy_delay
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.supply_civilian_system(p_location_ref text, p_resource text, p_quantity numeric, p_source text DEFAULT 'player'::text, p_assignment_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_user uuid:=(select auth.uid());v_owned numeric;v_faction uuid;v_group uuid;v_contract uuid;
 v_objective public.civilian_contracts%rowtype;v_a public.civilian_assignments%rowtype;
 v_effective_resource text;
begin
 if v_user is null then raise exception 'Authentication required';end if;
 if p_resource not in ('food','energy','energy_cells') or p_quantity is null or p_quantity<=0 or p_quantity>1000000 then raise exception 'Invalid supply quantity or resource';end if;
 v_effective_resource:=case when p_resource='energy_cells' then 'energy' else p_resource end;
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
  or v_objective.objective_resource_code<>v_effective_resource then raise exception 'Supply does not match assignment';end if;
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
  energy=case when v_effective_resource='energy' then energy+p_quantity else energy end,
  updated_at=now() where location_ref=p_location_ref;
 if p_assignment_id is not null then
  insert into public.civilian_contract_supplies(group_id,user_id,contract_id,location_ref,resource_code,quantity)
  values(v_a.group_id,v_user,v_a.contract_id,p_location_ref,v_effective_resource,p_quantity);
  update public.civilian_assignments set status='in_progress'
   where group_id=v_a.group_id and status='accepted';
 end if;
 return jsonb_build_object('supplied',p_quantity,'resource',p_resource,'location_ref',p_location_ref,'source',p_source);
end $function$;

CREATE OR REPLACE FUNCTION private.process_civilian_day(p_world_day bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
  update public.hex_conditions set
   stability_percent=least(100,greatest(0,coalesce(stability_percent,65)+case when v_supplied then 0.1 else -1.0 end)),
   updated_at=now() where location_ref=s.location_ref;
  if v_owner is not null and v_tax>0 then
   update public.factions set treasury=coalesce(treasury,0)+v_tax,updated_at=now() where id=v_owner;
   v_taxes:=v_taxes+v_tax;
  end if;
  v_count:=v_count+1;
 end loop;
 return jsonb_build_object('world_day',p_world_day,'systems_processed',v_count,'government_taxes',v_taxes);
end $function$;

CREATE OR REPLACE FUNCTION public.run_industry_cycle()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  f record;
  d record;
  link record;
  rec record;
  input_key text;
  input_qty numeric;
  available numeric;
  faction_id uuid;
  code text;
  amount numeric;
  produced integer:=0;
  health_mult numeric;
  level_mult numeric;
begin
  if not public.is_admin() then raise exception 'Admin access required.'; end if;

  for f in
    select f.*,upper(coalesce(ft.code,ft.name,'')) type_code
    from facilities f
    join facility_types ft on ft.id=f.facility_type_id
    where coalesce(f.status,'active')='active'
  loop
    faction_id:=coalesce(f.owner_faction_id,f.controlling_faction_id);
    if faction_id is null then continue; end if;
    health_mult:=public.facility_health_multiplier(f.health);
    level_mult:=public.facility_level_multiplier(f.level);

    if f.type_code like '%EXTRACT%' or f.type_code like '%MINE%' then
      for d in select * from map_resource_deposits where location_ref=f.location_ref loop
        amount:=greatest(0,d.richness*10*coalesce(f.production_modifier,1)*health_mult*level_mult);
        if amount>0 then
          perform add_faction_resource(faction_id,d.resource_code,amount);
          produced:=produced+1;
        end if;
      end loop;

    elsif f.type_code like '%FARM%' or f.type_code like '%AGRI%' then
      amount:=100*coalesce(f.production_modifier,1)*health_mult*level_mult;
      insert into system_economies(location_ref,food,slot_limit,updated_at)
      values(f.location_ref,amount,8,now())
      on conflict(location_ref) do update
        set food=system_economies.food+excluded.food,updated_at=now();

      update factions
      set treasury=coalesce(treasury,0)+(25*coalesce(f.production_modifier,1)*health_mult*level_mult)
      where id=faction_id;

      produced:=produced+1;
    end if;
  end loop;

  for f in
    select f.*,upper(coalesce(ft.code,ft.name,'')) type_code
    from facilities f
    join facility_types ft on ft.id=f.facility_type_id
    where upper(coalesce(ft.code,ft.name,'')) like '%REFIN%'
      and coalesce(f.status,'active')='active'
  loop
    faction_id:=coalesce(f.owner_faction_id,f.controlling_faction_id);
    health_mult:=public.facility_health_multiplier(f.health);
    level_mult:=public.facility_level_multiplier(f.level);

    for link in
      select c.extractor_facility_id,e.location_ref
      from facility_connections c
      join facilities e on e.id=c.extractor_facility_id
      where c.refinery_facility_id=f.id
      limit 3
    loop
      for d in select * from map_resource_deposits where location_ref=link.location_ref loop
        code:=case d.resource_code
          when 'gold_ore' then 'refined_gold'
          when 'vyr_ore' then 'vyrsteel'
          when 'aetherite' then 'refined_aetherite'
          else null
        end;
        if code is null then continue; end if;

        amount:=greatest(0,d.richness*8*coalesce(f.production_modifier,1)*health_mult*level_mult);
        select coalesce(quantity,0) into available
        from faction_resources
        where faction_id=faction_id and resource_code=d.resource_code;

        amount:=least(amount,coalesce(available,0));
        if amount>0 then
          perform add_faction_resource(faction_id,d.resource_code,-amount);
          perform add_faction_resource(faction_id,code,amount);
          produced:=produced+1;
        end if;
      end loop;
    end loop;
  end loop;

  for f in
    select f.*,o.recipe_code,upper(coalesce(ft.code,ft.name,'')) type_code
    from facilities f
    join facility_types ft on ft.id=f.facility_type_id
    join factory_orders o on o.facility_id=f.id
    where upper(coalesce(ft.code,ft.name,'')) like '%FACTORY%'
      and coalesce(f.status,'active')='active'
  loop
    faction_id:=coalesce(f.owner_faction_id,f.controlling_faction_id);
    health_mult:=public.facility_health_multiplier(f.health);
    level_mult:=public.facility_level_multiplier(f.level);

    select * into rec from factory_recipes where code=f.recipe_code;
    if rec.code is null then continue; end if;

    for input_key,input_qty in
      select key,value::text::numeric from jsonb_each(rec.inputs)
    loop
      select coalesce(quantity,0) into available
      from faction_resources
      where faction_id=faction_id and resource_code=input_key;
      if coalesce(available,0)<input_qty then exit; end if;
    end loop;

    if input_key is not null and coalesce(available,0)<input_qty then continue; end if;

    for input_key,input_qty in
      select key,value::text::numeric from jsonb_each(rec.inputs)
    loop
      perform add_faction_resource(faction_id,input_key,-input_qty);
    end loop;

    amount:=rec.output_quantity*coalesce(f.production_modifier,1)*health_mult*level_mult;
    if amount>0 then
      perform add_faction_resource(faction_id,rec.output_resource_code,amount);
      produced:=produced+1;
    end if;
  end loop;

  -- Alpha 0.5.0: population changes now occur only in private.process_civilian_day.
  return jsonb_build_object('processed',produced,'ran_at',now());
end
$function$;
