-- Hex conditions and location modifiers belong to coordinates, not movable system assets.
CREATE OR REPLACE FUNCTION private.manage_map_system(p_source text, p_destination text, p_action text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare item text; src public.map_hexes%rowtype; dst public.map_hexes%rowtype;
 se public.system_economies%rowtype; rec record; blockers jsonb:='{}'::jsonb;
 movable text[]:=array['facilities','characters','armies','fleets','ships','shipyard_orders',
 'markets','trade_station_markets','civilian_contracts','civilian_contract_supplies',
 'civilian_discoveries'];
 dependent text[]:=array['facilities','characters','armies','fleets','ships','shipyard_orders',
 'markets','trade_station_markets','civilian_contracts','civilian_contract_supplies',
 'civilian_discoveries'];
 historical text[]:=array['civilian_population_ledger','civilian_travel_incidents','game_events',
 'military_battles','military_occupation_claims','military_recruitment_log','naval_operations'];
 qty bigint; occupied bigint; audit_id bigint;
begin
 if auth.uid() is null or not private.is_admin() then raise exception 'Admin permission required';end if;
 if p_action not in('identity','entire','delete') then raise exception 'Invalid system operation';end if;
 if p_source is null then raise exception 'Select a source';end if;
 perform pg_advisory_xact_lock(hashtext('admin_system_operations'));
 select * into src from public.map_hexes where location_ref=p_source for update;
 if not found or (src.display_name is null and coalesce(src.habitable_systems,0)=0)
 then raise exception 'No system at source';end if;
 if p_action<>'delete' then
  if p_destination is null or p_source=p_destination then raise exception 'Choose another destination';end if;
  select * into dst from public.map_hexes where location_ref=p_destination and player_visible=true for update;
  if not found then raise exception 'Destination hex does not exist or is hidden';end if;
  if dst.display_name is not null or dst.habitable_systems>0
    or (p_action='entire' and exists(select 1 from public.system_economies where location_ref=p_destination))
  then raise exception 'Destination already has a system';end if;
 end if;
 -- Destination must not contain anything that moving/deleting could overwrite.
 if p_action='entire' then
  foreach item in array movable loop
    execute format('select count(*) from public.%I where location_ref=$1',item) into qty using p_destination;
    if qty>0 then raise exception 'Destination contains existing % records',item;end if;
  end loop;
  -- Natural deposits are normal on empty hexes and are not a system-occupancy blocker.
  select count(*) into qty from public.territories where location_ref=p_destination and display_name is not null;
  if qty>0 then raise exception 'Destination has a named territory';end if;
 end if;
 -- Deletion retires system designation; assets, market records and history remain in place.
 if p_action='entire' then
  if exists(select 1 from public.army_movements where status='moving' and (from_ref=p_source or to_ref=p_source))
  or exists(select 1 from public.fleet_movements where status='moving' and (from_ref=p_source or to_ref=p_source))
  or exists(select 1 from public.civilian_ship_movements where status='moving' and (from_ref=p_source or to_ref=p_source))
  or exists(select 1 from public.character_travel where status='moving' and (from_ref=p_source or to_ref=p_source))
  or exists(select 1 from public.military_operations where status in ('active','awaiting_resolution') and target_ref=p_source)
  then raise exception 'Cannot relocate whole system during active travel or military operations';end if;
  -- Historical data retain their original coordinates. Active state follows the system.
 end if;
 insert into private.admin_system_operations(actor,operation,source_ref,destination_ref,before_source,before_destination)
 values(auth.uid(),p_action,p_source,p_destination,to_jsonb(src),case when p_action='delete' then null else to_jsonb(dst) end)
 returning id into audit_id;
 if p_action='identity' then
  update public.map_hexes set display_name=src.display_name,region_name=src.region_name,
   terrain_type=src.terrain_type,habitable_systems=greatest(src.habitable_systems,1),
   notes=src.notes,metadata=coalesce(src.metadata,'{}'::jsonb),updated_at=now()
   where location_ref=p_destination;
  update public.map_hexes set display_name=null,region_name=null,habitable_systems=0,updated_at=now()
   where location_ref=p_source;
  update public.territories set display_name=null,updated_at=now() where location_ref=p_source;
  update public.territories set display_name=src.display_name,updated_at=now() where location_ref=p_destination;
 elsif p_action='entire' then
  -- Keep territory borders painted by the user; this move never claims a destination hex.
  if exists(select 1 from public.territories a join public.territories b on b.location_ref=p_destination
    where a.location_ref=p_source and a.faction_id is distinct from b.faction_id)
  then raise exception 'Whole-system relocation requires same governing faction at destination';end if;
  -- Economy, deposits and live state are moved transactionally; unrelated historical events remain.
  update public.map_hexes set display_name=src.display_name,region_name=src.region_name,
   terrain_type=src.terrain_type,habitable_systems=greatest(src.habitable_systems,1),
   notes=src.notes,metadata=coalesce(src.metadata,'{}'::jsonb),updated_at=now()
   where location_ref=p_destination;
  update public.map_hexes set display_name=null,region_name=null,habitable_systems=0,updated_at=now()
   where location_ref=p_source;
  update public.territories set display_name=null,updated_at=now() where location_ref=p_source;
  update public.territories set display_name=src.display_name,updated_at=now() where location_ref=p_destination;
  update public.system_economies set location_ref=p_destination where location_ref=p_source;
  -- Move source deposits without deleting native deposits already present at destination.
  -- A shared deposit resource retains the greater richness; original source entries retire.
  insert into public.map_resource_deposits(location_ref,resource_code,richness)
    select p_destination,resource_code,richness from public.map_resource_deposits
    where location_ref=p_source
    on conflict (location_ref,resource_code) do update
      set richness=greatest(public.map_resource_deposits.richness,excluded.richness);
  delete from public.map_resource_deposits where location_ref=p_source;
  foreach item in array movable loop
   execute format('update public.%I set location_ref=$1 where location_ref=$2',item)
    using p_destination,p_source;
  end loop;
 else
  update public.map_hexes set display_name=null,region_name=null,
   terrain_type=null,habitable_systems=0,notes=null,metadata='{}'::jsonb,updated_at=now()
   where location_ref=p_source;
  update public.territories set display_name=null,updated_at=now() where location_ref=p_source;
  -- Preserve economy, deposits, and player/historical data at the retired hex.
 end if;
 update private.admin_system_operations set details=jsonb_build_object('completed',true,'preserved_records',p_action='delete') where id=audit_id;
 return jsonb_build_object('operation_id',audit_id,'action',p_action,'source',p_source,'destination',p_destination,'success',true);
end;$function$
;