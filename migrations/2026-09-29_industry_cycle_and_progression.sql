-- Gradari Mireris industrial simulation rules.
-- Depends on 2026-09-29_map_industry_foundation.sql.

create or replace function public.add_faction_resource(p_faction_id uuid,p_resource_code text,p_amount numeric)
returns void language plpgsql security definer set search_path=public as $$
begin
  if p_amount=0 then return; end if;
  insert into faction_resources(faction_id,resource_code,quantity,updated_at)
  values(p_faction_id,p_resource_code,p_amount,now())
  on conflict(faction_id,resource_code) do update
    set quantity=faction_resources.quantity+excluded.quantity,updated_at=now();
end $$;

create or replace function public.enforce_map_facility_rules()
returns trigger language plpgsql security definer set search_path=public as $$
declare
  v_code text;
  v_faction uuid;
  v_slots integer := 8;
  v_used integer := 0;
  v_has_extractor boolean := false;
  v_has_refinery boolean := false;
begin
  if new.location_ref is null then return new; end if;
  select upper(coalesce(code,name,'')) into v_code from facility_types where id=new.facility_type_id;
  v_faction:=coalesce(new.owner_faction_id,new.controlling_faction_id);

  select coalesce(slot_limit,8) into v_slots from system_economies where location_ref=new.location_ref;
  select count(*) into v_used from facilities where location_ref=new.location_ref and (tg_op='INSERT' or id<>new.id);
  if v_used>=v_slots then raise exception 'This system has no available facility slots.'; end if;

  -- Admin world-building may place facilities in any order.
  if private.is_admin() then return new; end if;

  if v_faction is null or not exists(
    select 1 from faction_memberships
    where user_id=auth.uid() and faction_id=v_faction and status='active'
  ) then raise exception 'An active faction membership is required.'; end if;

  if (v_code like '%EXTRACT%' or v_code like '%MINE%') and not exists(
    select 1 from map_resource_deposits where location_ref=new.location_ref
  ) then raise exception 'No extractable resource deposit exists at this location.'; end if;

  select exists(
    select 1 from facilities f join facility_types ft on ft.id=f.facility_type_id
    where (f.owner_faction_id=v_faction or f.controlling_faction_id=v_faction)
      and (upper(coalesce(ft.code,ft.name,'')) like '%EXTRACT%' or upper(coalesce(ft.code,ft.name,'')) like '%MINE%')
  ) into v_has_extractor;

  select exists(
    select 1 from facilities f join facility_types ft on ft.id=f.facility_type_id
    where (f.owner_faction_id=v_faction or f.controlling_faction_id=v_faction)
      and upper(coalesce(ft.code,ft.name,'')) like '%REFIN%'
  ) into v_has_refinery;

  if v_code like '%REFIN%' and not v_has_extractor then
    raise exception 'Construct an Extractor before a Refinery.';
  end if;
  if (v_code like '%FACTORY%' or v_code like '%SHIP%') and not v_has_refinery then
    raise exception 'Construct a Refinery before this facility.';
  end if;
  return new;
end $$;

drop trigger if exists trg_enforce_map_facility_rules on public.facilities;
create trigger trg_enforce_map_facility_rules
before insert or update of location_ref,facility_type_id,owner_faction_id,controlling_faction_id
on public.facilities for each row execute function public.enforce_map_facility_rules();

create or replace function public.set_factory_recipe(p_facility_id uuid,p_recipe_code text)
returns void language plpgsql security definer set search_path=public as $$
declare
  v_faction uuid;
  v_code text;
begin
  select coalesce(f.owner_faction_id,f.controlling_faction_id),upper(coalesce(ft.code,ft.name,''))
    into v_faction,v_code
  from facilities f join facility_types ft on ft.id=f.facility_type_id
  where f.id=p_facility_id;

  if v_code not like '%FACTORY%' then raise exception 'Selected facility is not a Factory.'; end if;
  if not exists(select 1 from factory_recipes where code=p_recipe_code and player_visible) then raise exception 'Unknown production line.'; end if;
  if not private.is_admin() and not exists(
    select 1 from faction_memberships where user_id=auth.uid() and faction_id=v_faction and status='active'
  ) then raise exception 'Not authorized for this factory.'; end if;

  insert into factory_orders(facility_id,recipe_code,updated_at)
  values(p_facility_id,p_recipe_code,now())
  on conflict(facility_id) do update set recipe_code=excluded.recipe_code,updated_at=now();
end $$;

create or replace function public.disconnect_refinery_extractor(p_refinery_id uuid,p_extractor_id uuid)
returns void language plpgsql security definer set search_path=public as $$
declare v_faction uuid;
begin
  select coalesce(owner_faction_id,controlling_faction_id) into v_faction from facilities where id=p_refinery_id;
  if not private.is_admin() and not exists(
    select 1 from faction_memberships where user_id=auth.uid() and faction_id=v_faction and status='active'
  ) then raise exception 'Not authorized for this refinery.'; end if;
  delete from facility_connections where refinery_facility_id=p_refinery_id and extractor_facility_id=p_extractor_id;
end $$;

create or replace function public.run_industry_cycle()
returns jsonb language plpgsql security definer set search_path=public as $$
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
begin
  if not private.is_admin() then raise exception 'Admin access required.'; end if;

  -- Extraction and agriculture.
  for f in
    select f.*,upper(coalesce(ft.code,ft.name,'')) as type_code
    from facilities f join facility_types ft on ft.id=f.facility_type_id
    where coalesce(f.status,'active')='active'
  loop
    faction_id:=coalesce(f.owner_faction_id,f.controlling_faction_id);
    if faction_id is null then continue; end if;

    if f.type_code like '%EXTRACT%' or f.type_code like '%MINE%' then
      for d in select * from map_resource_deposits where location_ref=f.location_ref loop
        amount:=greatest(1,d.richness*10*coalesce(f.production_modifier,1));
        perform add_faction_resource(faction_id,d.resource_code,amount);
        produced:=produced+1;
      end loop;
    elsif f.type_code like '%FARM%' or f.type_code like '%AGRI%' then
      insert into system_economies(location_ref,food,slot_limit,updated_at)
      values(f.location_ref,100*coalesce(f.production_modifier,1),8,now())
      on conflict(location_ref) do update
        set food=system_economies.food+excluded.food,updated_at=now();
      update factions set treasury=coalesce(treasury,0)+(25*coalesce(f.production_modifier,1)) where id=faction_id;
      produced:=produced+1;
    end if;
  end loop;

  -- Refineries automatically process supported material from connected extractors.
  for f in
    select f.*,upper(coalesce(ft.code,ft.name,'')) as type_code
    from facilities f join facility_types ft on ft.id=f.facility_type_id
    where upper(coalesce(ft.code,ft.name,'')) like '%REFIN%' and coalesce(f.status,'active')='active'
  loop
    faction_id:=coalesce(f.owner_faction_id,f.controlling_faction_id);
    for link in
      select c.extractor_facility_id,e.location_ref
      from facility_connections c join facilities e on e.id=c.extractor_facility_id
      where c.refinery_facility_id=f.id limit 3
    loop
      for d in select * from map_resource_deposits where location_ref=link.location_ref loop
        code:=case d.resource_code
          when 'gold_ore' then 'refined_gold'
          when 'vyr_ore' then 'vyrsteel'
          when 'aetherite' then 'refined_aetherite'
          else null end;
        if code is null then continue; end if;
        amount:=greatest(1,d.richness*8*coalesce(f.production_modifier,1));
        select coalesce(quantity,0) into available from faction_resources where faction_id=faction_id and resource_code=d.resource_code;
        amount:=least(amount,coalesce(available,0));
        if amount>0 then
          perform add_faction_resource(faction_id,d.resource_code,-amount);
          perform add_faction_resource(faction_id,code,amount);
          produced:=produced+1;
        end if;
      end loop;
    end loop;
  end loop;

  -- Factories run one selected production line.
  for f in
    select f.*,o.recipe_code,upper(coalesce(ft.code,ft.name,'')) as type_code
    from facilities f
    join facility_types ft on ft.id=f.facility_type_id
    join factory_orders o on o.facility_id=f.id
    where upper(coalesce(ft.code,ft.name,'')) like '%FACTORY%' and coalesce(f.status,'active')='active'
  loop
    faction_id:=coalesce(f.owner_faction_id,f.controlling_faction_id);
    select * into rec from factory_recipes where code=f.recipe_code;
    if rec.code is null then continue; end if;

    -- One batch only when every ingredient is present.
    for input_key,input_qty in select key,value::text::numeric from jsonb_each(rec.inputs) loop
      select coalesce(quantity,0) into available from faction_resources where faction_id=faction_id and resource_code=input_key;
      if coalesce(available,0)<input_qty then exit; end if;
    end loop;
    if input_key is not null and coalesce(available,0)<input_qty then continue; end if;

    for input_key,input_qty in select key,value::text::numeric from jsonb_each(rec.inputs) loop
      perform add_faction_resource(faction_id,input_key,-input_qty);
    end loop;
    perform add_faction_resource(faction_id,rec.output_resource_code,rec.output_quantity*coalesce(f.production_modifier,1));
    produced:=produced+1;
  end loop;

  -- Population consumes local food and changes gradually.
  update system_economies
  set food=greatest(0,food-greatest(1,population::numeric/1000000)),
      population=case
        when food>=greatest(1,population::numeric/1000000) then floor(population*1.0005)
        else floor(population*0.999)
      end,
      manpower=least(
        floor((case when food>=greatest(1,population::numeric/1000000) then population*1.0005 else population*0.999 end)*0.10),
        manpower+floor(population*0.0001)
      ),
      updated_at=now()
  where population>0;

  return jsonb_build_object('processed',produced,'ran_at',now());
end $$;

grant execute on function public.set_factory_recipe(uuid,text) to authenticated;
grant execute on function public.connect_refinery_extractor(uuid,uuid) to authenticated;
grant execute on function public.disconnect_refinery_extractor(uuid,uuid) to authenticated;
revoke all on function public.run_industry_cycle() from public;
grant execute on function public.run_industry_cycle() to authenticated;
