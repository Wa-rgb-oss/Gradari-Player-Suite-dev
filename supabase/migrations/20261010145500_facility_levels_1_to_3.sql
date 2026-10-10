-- Facility levels 1-3 for player-owned facilities.
-- Level multipliers: L1 100%, L2 150%, L3 200%.
-- Upgrade costs: L1->L2 = 50% base build cost; L2->L3 = 100% base build cost.
-- Level multiplier applies to production, storage capacity, and daily upkeep.

alter table public.facilities drop constraint if exists facilities_level_check;
alter table public.facilities
  add constraint facilities_level_check check (level between 1 and 3);

CREATE OR REPLACE FUNCTION public.player_storage_capacity(p_user_id uuid)
 RETURNS numeric
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select coalesce(sum(
    5000::numeric * public.facility_level_multiplier(f.level)
  ),0)
  from public.facilities f
  join public.facility_types ft on ft.id=f.facility_type_id
  where f.owner_user_id=p_user_id
    and f.status='active'
    and ft.code='STORAGE';
$function$


CREATE OR REPLACE FUNCTION private.process_daily_facility_upkeep_internal(p_day_index bigint, p_world_hour numeric)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  rec record;
  v_processed integer := 0;
  v_inactive integer := 0;
  v_upkeep numeric(20,2);
  v_wallet numeric(20,2);
  v_treasury numeric(20,2);
  v_after numeric(20,2);
  v_faction_id uuid;
  v_key text := 'DAY-' || p_day_index::text;
  v_wh bigint := floor(p_world_hour);
  v_aevum integer;
  v_cycle integer;
  v_week integer;
  v_day integer;
  v_day_label text;
begin
  v_aevum := floor(v_wh / 9360.0);
  v_cycle := mod(floor(v_wh / 720.0)::bigint,13) + 1;
  v_week := mod(floor(v_wh / 180.0)::bigint,4) + 1;
  v_day := mod(floor(v_wh / 36.0)::bigint,5) + 1;
  v_day_label := 'A' || v_aevum || ' C' || v_cycle || ' W' || v_week || ' D' || v_day;

  for rec in
    select
      f.*,
      ft.upkeep_aureum_per_cycle,
      ft.name as facility_type_name
    from public.facilities f
    join public.facility_types ft on ft.id=f.facility_type_id
    where f.status in ('active','raided')
      and not exists (
        select 1
        from public.facility_production_log l
        where l.facility_id=f.id
          and l.cycle_key=v_key
      )
    order by f.id
  loop
    v_upkeep := greatest(coalesce(rec.upkeep_aureum_per_cycle,0),0)
      * public.facility_level_multiplier(rec.level);

    if rec.owner_user_id is not null then
      if v_upkeep > 0 then
        select balance into v_wallet
        from public.player_wallets
        where user_id=rec.owner_user_id
        for update;

        if not found or coalesce(v_wallet,0) < v_upkeep then
          update public.facilities
          set status='inactive',updated_at=now()
          where id=rec.id;

          insert into public.facility_production_log(
            facility_id,cycle_key,upkeep_paid,gross_output,owner_output,
            faction_tax_output,output_asset_id,status,detail
          )
          values(
            rec.id,v_key,0,0,0,0,null,'inactive_upkeep',
            jsonb_build_object(
              'reason','insufficient_player_upkeep',
              'day_index',p_day_index,
              'world_hour',p_world_hour,
              'day_label',v_day_label
            )
          );

          v_inactive := v_inactive + 1;
          continue;
        end if;

        v_after := v_wallet - v_upkeep;

        update public.player_wallets
        set balance=v_after,updated_at=now()
        where user_id=rec.owner_user_id;

        insert into public.player_transactions(
          user_id,amount,currency,kind,description,balance_after
        )
        values(
          rec.owner_user_id,
          -v_upkeep,
          'Aureum',
          'facility_upkeep',
          coalesce(rec.name,rec.facility_type_name) || ' daily upkeep // ' || v_day_label,
          v_after
        );
      end if;
    else
      v_faction_id := coalesce(rec.owner_faction_id,rec.controlling_faction_id);

      if v_upkeep > 0 then
        select treasury into v_treasury
        from public.factions
        where id=v_faction_id
        for update;

        if v_faction_id is null or not found or coalesce(v_treasury,0) < v_upkeep then
          update public.facilities
          set status='inactive',updated_at=now()
          where id=rec.id;

          insert into public.facility_production_log(
            facility_id,cycle_key,upkeep_paid,gross_output,owner_output,
            faction_tax_output,output_asset_id,status,detail
          )
          values(
            rec.id,v_key,0,0,0,0,null,'inactive_upkeep',
            jsonb_build_object(
              'reason','insufficient_faction_upkeep',
              'day_index',p_day_index,
              'world_hour',p_world_hour,
              'day_label',v_day_label
            )
          );

          v_inactive := v_inactive + 1;
          continue;
        end if;

        v_after := v_treasury - v_upkeep;

        update public.factions
        set treasury=v_after,updated_at=now()
        where id=v_faction_id;

        insert into public.faction_transactions(
          faction_id,actor_user_id,amount,currency,kind,description,balance_after
        )
        values(
          v_faction_id,
          null,
          -v_upkeep,
          'Aureum',
          'facility_upkeep',
          coalesce(rec.name,rec.facility_type_name) || ' daily upkeep // ' || v_day_label,
          v_after
        );
      end if;
    end if;

    update public.facilities
    set last_upkeep_at=now(),updated_at=now()
    where id=rec.id;

    insert into public.facility_production_log(
      facility_id,cycle_key,upkeep_paid,gross_output,owner_output,
      faction_tax_output,output_asset_id,status,detail
    )
    values(
      rec.id,v_key,v_upkeep,0,0,0,null,'upkeep_processed',
      jsonb_build_object(
        'day_index',p_day_index,
        'world_hour',p_world_hour,
        'day_label',v_day_label
      )
    );

    v_processed := v_processed + 1;
  end loop;

  return jsonb_build_object(
    'day_index',p_day_index,
    'day_label',v_day_label,
    'processed',v_processed,
    'deactivated_for_upkeep',v_inactive
  );
end
$function$


CREATE OR REPLACE FUNCTION public.process_passive_facility_production()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  f record;
  c record;
  ticks integer;
  tick_seconds numeric;
  next_interval interval;
  dep record;
  ln record;
  outcode text;
  qty numeric;
  fid uuid;
  level_mult numeric;
begin
  perform ensure_facility_production_clocks();

  for f in
    select x.*,ft.code typecode,ft.output_per_cycle
    from facilities x
    join facility_types ft on ft.id=x.facility_type_id
    where x.status='active'
      and ft.code in('MINE','AGRI_COMPLEX','REFINERY','RESEARCH_SITE')
  loop
    select * into c
    from facility_production_clocks
    where facility_id=f.id
    for update;

    if c.next_production_at>now() then
      continue;
    end if;

    if f.typecode='RESEARCH_SITE' then
      tick_seconds:=25920;
      next_interval:=interval '7 hours 12 minutes';
    else
      tick_seconds:=720;
      next_interval:=interval '12 minutes';
    end if;

    ticks:=greatest(
      1,
      floor(extract(epoch from(now()-c.next_production_at))/tick_seconds)::int+1
    );

    level_mult:=public.facility_level_multiplier(f.level);
    fid:=coalesce(f.owner_faction_id,f.controlling_faction_id);

    if f.typecode='AGRI_COMPLEX' then
      qty:=10*ticks*coalesce(f.production_modifier,1)*facility_health_multiplier(f.health)*level_mult;
      if f.owner_user_id is not null then
        perform private.apply_player_resource_delta(f.owner_user_id,'food',qty);
      elsif fid is not null then
        perform add_faction_resource(fid,'food',qty);
      end if;

    elsif f.typecode='MINE' then
      for dep in
        select resource_code,richness
        from map_resource_deposits
        where location_ref=f.location_ref
      loop
        qty:=10*dep.richness*ticks*coalesce(f.production_modifier,1)*facility_health_multiplier(f.health)*level_mult;
        if f.owner_user_id is not null then
          perform private.apply_player_resource_delta(f.owner_user_id,dep.resource_code,qty);
        elsif fid is not null then
          perform add_faction_resource(fid,dep.resource_code,qty);
        end if;
      end loop;

    elsif f.typecode='REFINERY' then
      for ln in
        select d.resource_code,d.richness
        from facility_connections fc
        join facilities ex on ex.id=fc.extractor_facility_id
        join map_resource_deposits d on d.location_ref=ex.location_ref
        where fc.refinery_facility_id=f.id
        limit 3
      loop
        outcode:=case ln.resource_code
          when 'gold_ore' then 'refined_gold'
          when 'vyr_ore' then 'vyrsteel'
          when 'aetherite' then 'refined_aetherite'
          else null
        end;
        if outcode is not null then
          qty:=8*ln.richness*ticks*coalesce(f.production_modifier,1)*facility_health_multiplier(f.health)*level_mult;
          if f.owner_user_id is not null then
            perform private.apply_player_resource_delta(f.owner_user_id,outcode,qty);
          elsif fid is not null then
            perform add_faction_resource(fid,outcode,qty);
          end if;
        end if;
      end loop;

    elsif f.typecode='RESEARCH_SITE' then
      if f.owner_user_id is not null then
        qty:=greatest(coalesce(nullif(f.output_per_cycle,0),36),0)
             * ticks
             * coalesce(f.production_modifier,1)
             * facility_health_multiplier(f.health)
             * level_mult;
        perform private.add_player_research_points(f.owner_user_id,qty);
      end if;
    end if;

    update facility_production_clocks
    set last_production_at=c.next_production_at + ((ticks-1) * next_interval),
        next_production_at=c.next_production_at + (ticks * next_interval),
        updated_at=now()
    where facility_id=f.id;
  end loop;

  return 1;
end
$function$


CREATE OR REPLACE FUNCTION private.settle_factory_output(p_facility_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  o public.factory_orders%rowtype;
  f public.facilities%rowtype;
  rec public.factory_recipes%rowtype;
  v_pending numeric:=0;
  v_deposited numeric:=0;
  v_remaining numeric:=0;
  v_resource_result jsonb;
  v_faction uuid;
  v_personal boolean;
begin
  select * into o from public.factory_orders where facility_id=p_facility_id for update;
  if o.facility_id is null or o.status not in('producing','storage_blocked') then raise exception 'No active production order.'; end if;
  if o.status='producing' and o.completes_at>now() then raise exception 'Production is not complete yet.'; end if;

  select * into f from public.facilities where id=p_facility_id;
  if f.id is null then
    update public.factory_orders set status='cancelled',updated_at=now() where facility_id=p_facility_id;
    return jsonb_build_object('facility_id',p_facility_id,'status','cancelled','reason','facility_missing');
  end if;

  select * into rec from public.factory_recipes where code=o.recipe_code;
  if rec.code is null then
    update public.factory_orders set status='cancelled',updated_at=now() where facility_id=p_facility_id;
    return jsonb_build_object('facility_id',p_facility_id,'status','cancelled','reason','recipe_missing');
  end if;

  v_personal:=f.owner_user_id is not null;
  v_faction:=coalesce(f.owner_faction_id,f.controlling_faction_id);

  if o.output_remaining is null then
    v_pending:=greatest(
      rec.output_quantity
      * o.quantity
      * coalesce(f.production_modifier,1)
      * public.facility_health_multiplier(f.health)
      * public.facility_level_multiplier(f.level),
      0
    );
  else
    v_pending:=greatest(o.output_remaining,0);
  end if;

  if v_pending<=0 then
    update public.factory_orders set status='completed',output_remaining=0,completed_at=now(),updated_at=now()
    where facility_id=p_facility_id;
    return jsonb_build_object('facility_id',p_facility_id,'resource_code',rec.output_resource_code,
      'deposited_quantity',0,'remaining_quantity',0,'status','completed');
  end if;

  if v_personal then
    v_resource_result:=private.apply_player_resource_delta(f.owner_user_id,rec.output_resource_code,v_pending);
    v_deposited:=greatest(coalesce((v_resource_result->>'applied_delta')::numeric,0),0);
  else
    perform public.add_faction_resource(v_faction,rec.output_resource_code,v_pending);
    v_deposited:=v_pending;
  end if;

  v_remaining:=greatest(v_pending-v_deposited,0);

  if v_remaining>0 then
    update public.factory_orders set status='storage_blocked',output_remaining=v_remaining,updated_at=now()
    where facility_id=p_facility_id;
  else
    update public.factory_orders set status='completed',output_remaining=0,completed_at=now(),updated_at=now()
    where facility_id=p_facility_id;
  end if;

  return jsonb_build_object(
    'facility_id',p_facility_id,
    'resource_code',rec.output_resource_code,
    'deposited_quantity',v_deposited,
    'remaining_quantity',v_remaining,
    'storage_limited',v_remaining>0,
    'status',case when v_remaining>0 then 'storage_blocked' else 'completed' end
  );
end
$function$


CREATE OR REPLACE FUNCTION public.facility_level_multiplier(p_level integer)
 RETURNS numeric
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  select case greatest(1,least(coalesce(p_level,1),3))
    when 1 then 1.0::numeric
    when 2 then 1.5::numeric
    else 2.0::numeric
  end;
$function$


CREATE OR REPLACE FUNCTION public.upgrade_owned_facility(p_facility_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_uid uuid := auth.uid();
  v_facility public.facilities%rowtype;
  v_type public.facility_types%rowtype;
  v_wallet numeric(20,2);
  v_after numeric(20,2);
  v_target integer;
  v_cost numeric(20,2);
begin
  if v_uid is null then
    raise exception 'Authentication required';
  end if;

  select *
  into v_facility
  from public.facilities
  where id=p_facility_id
    and owner_user_id=v_uid
  for update;

  if not found then
    raise exception 'Facility not found or not owned by this player';
  end if;

  if coalesce(v_facility.level,1) >= 3 then
    raise exception 'Facility is already at maximum level';
  end if;

  select *
  into v_type
  from public.facility_types
  where id=v_facility.facility_type_id;

  if not found then
    raise exception 'Facility type not found';
  end if;

  v_target := coalesce(v_facility.level,1)+1;
  v_cost := round(
    greatest(coalesce(v_type.build_cost_aureum,0),0) *
    case when v_target=2 then 0.5 else 1.0 end,
    2
  );

  select balance
  into v_wallet
  from public.player_wallets
  where user_id=v_uid
  for update;

  if not found then
    raise exception 'Player wallet not found';
  end if;

  if v_wallet < v_cost then
    raise exception 'Insufficient Aureum. Upgrade requires % Aureum',v_cost;
  end if;

  v_after := v_wallet-v_cost;

  update public.player_wallets
  set balance=v_after,updated_at=now()
  where user_id=v_uid;

  update public.facilities
  set level=v_target,updated_at=now()
  where id=v_facility.id;

  insert into public.player_transactions(
    user_id,amount,currency,kind,description,balance_after
  )
  values(
    v_uid,
    -v_cost,
    'Aureum',
    'facility_upgrade',
    coalesce(v_facility.name,v_type.name)||' upgraded to Level '||v_target,
    v_after
  );

  return jsonb_build_object(
    'facility_id',v_facility.id,
    'level',v_target,
    'level_multiplier',public.facility_level_multiplier(v_target),
    'upgrade_cost',v_cost,
    'balance',v_after
  );
end;
$function$


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

  update system_economies
  set food=greatest(0,food-greatest(1,population::numeric/1000000)),
      population=case when food>=greatest(1,population::numeric/1000000)
        then floor(population*1.0005) else floor(population*0.999) end,
      manpower=least(
        floor((case when food>=greatest(1,population::numeric/1000000)
          then population*1.0005 else population*0.999 end)*0.10),
        manpower+floor(population*0.0001)
      ),
      updated_at=now()
  where population>0;

  return jsonb_build_object('processed',produced,'ran_at',now());
end
$function$


revoke all on function public.upgrade_owned_facility(uuid) from public, anon;
grant execute on function public.upgrade_owned_facility(uuid) to authenticated;
