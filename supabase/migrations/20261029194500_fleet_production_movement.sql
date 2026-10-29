
create or replace function private.queue_faction_ship(p_yard uuid,p_blueprint uuid,p_name text)
returns jsonb language plpgsql security definer set search_path='' as $fn$
declare y public.facilities%rowtype;b public.ship_blueprints%rowtype;f public.factions%rowtype;
e public.system_economies%rowtype;c numeric;h numeric;oid uuid;
begin
 if auth.uid() is null then raise exception 'Sign in required';end if;
 select * into y from public.facilities where id=p_yard and status='active' for update;
 if not found or not exists(select 1 from public.facility_types t where t.id=y.facility_type_id and (t.name ilike '%yard%' or t.name ilike '%shipyard%')) then raise exception 'Active shipyard required';end if;
 if y.owner_faction_id is null or not private.has_faction_permission(y.owner_faction_id,'military') then raise exception 'Faction military authorization required';end if;
 select * into b from public.ship_blueprints where id=p_blueprint and player_visible=true;
 if not found then raise exception 'Blueprint not available';end if;
 if length(trim(coalesce(p_name,''))) not between 1 and 80 then raise exception 'Ship name must be 1 to 80 characters';end if;
 select * into e from public.system_economies where location_ref=y.location_ref for update;
 if not found or e.population < b.manpower_cost+100 then raise exception 'Insufficient civilian population';end if;
 if e.military_population+b.manpower_cost>floor((e.population+e.military_population)*0.20) then raise exception 'System military population cap exceeded';end if;
 select * into f from public.factions where id=y.owner_faction_id for update;
 c:=round(b.strength*20,2);
 if coalesce(f.treasury,0)<c then raise exception 'Insufficient faction treasury';end if;
 if exists(select 1 from public.shipyard_orders where shipyard_facility_id=p_yard and status in ('queued','building')) then
 raise exception 'Shipyard is already constructing a ship';end if;
 h:=private.world_total_hours_at(now());
 update public.factions set treasury=treasury-c where id=f.id;
 update public.system_economies set population=population-b.manpower_cost,military_population=military_population+b.manpower_cost,updated_at=now() where location_ref=y.location_ref;
 insert into public.shipyard_orders(shipyard_facility_id,faction_id,blueprint_id,ship_name,location_ref,cycles_total,cycles_remaining,status,ordered_by,build_ready_world_hour)
 values(y.id,f.id,b.id,trim(p_name),y.location_ref,b.build_cycles,b.build_cycles,'building',auth.uid(),h+b.build_cycles*36)
 returning id into oid;
 return jsonb_build_object('order_id',oid,'cost_aureum',c,'crew',b.manpower_cost,'ready_world_hour',h+b.build_cycles*36);
end;$fn$;
create or replace function public.queue_faction_ship(p_yard uuid,p_blueprint uuid,p_name text) returns jsonb
language sql security definer set search_path='' as $fn$ select private.queue_faction_ship($1,$2,$3);$fn$;
revoke all on function public.queue_faction_ship(uuid,uuid,text) from public,anon;
grant execute on function public.queue_faction_ship(uuid,uuid,text) to authenticated;

create or replace function private.form_fleet(p_faction uuid,p_location text,p_name text)
returns jsonb language plpgsql security definer set search_path='' as $fn$
declare fid uuid;
begin
 if not private.has_faction_permission(p_faction,'military') then raise exception 'Military authority required';end if;
 if length(trim(coalesce(p_name,''))) not between 1 and 80 then raise exception 'Invalid fleet name';end if;
 if not exists(select 1 from public.territories where location_ref=p_location and faction_id=p_faction) then raise exception 'Fleet must form in faction territory';end if;
 insert into public.fleets(faction_id,location_ref,name) values(p_faction,p_location,trim(p_name)) returning id into fid;
 return jsonb_build_object('fleet_id',fid);
end;$fn$;
create or replace function public.form_fleet(p_faction uuid,p_location text,p_name text) returns jsonb
language sql security definer set search_path='' as $fn$ select private.form_fleet($1,$2,$3);$fn$;
revoke all on function public.form_fleet(uuid,text,text) from public,anon;
grant execute on function public.form_fleet(uuid,text,text) to authenticated;

create or replace function private.assign_ship_to_fleet(p_ship uuid,p_fleet uuid)
returns jsonb language plpgsql security definer set search_path='' as $fn$
declare v_ship public.ships%rowtype;v_fleet public.fleets%rowtype;
begin
 select * into v_fleet from public.fleets where id=p_fleet and status='active' and movement_status='stationary' for update;
 if not found or not private.has_faction_permission(v_fleet.faction_id,'military') then raise exception 'Fleet command authority required';end if;
 select * into v_ship from public.ships where id=p_ship and status='active' for update;
 if not found or v_ship.faction_id<>v_fleet.faction_id or v_ship.location_ref<>v_fleet.location_ref then raise exception 'Ship must belong to this faction and be stationed with the fleet';end if;
 if v_ship.fleet_id is not null and v_ship.fleet_id<>p_fleet then raise exception 'Ship already assigned to another fleet';end if;
 update public.ships set fleet_id=p_fleet,updated_at=now() where id=p_ship;
 return jsonb_build_object('fleet_id',p_fleet,'ship_id',p_ship);
end;$fn$;
create or replace function public.assign_ship_to_fleet(p_ship uuid,p_fleet uuid) returns jsonb
language sql security definer set search_path='' as $fn$ select private.assign_ship_to_fleet($1,$2);$fn$;
revoke all on function public.assign_ship_to_fleet(uuid,uuid) from public,anon;
grant execute on function public.assign_ship_to_fleet(uuid,uuid) to authenticated;

create or replace function private.move_fleet(p_fleet uuid,p_target text)
returns jsonb language plpgsql security definer set search_path='' as $fn$
declare f public.fleets%rowtype; d integer;h numeric; mid uuid;
begin
 select * into f from public.fleets where id=p_fleet and status='active' and movement_status='stationary' for update;
 if not found or not private.has_faction_permission(f.faction_id,'military') then raise exception 'Fleet command authorization required';end if;
 if not exists(select 1 from public.ships where fleet_id=f.id and status='active') then raise exception 'Fleet has no commissioned ships';end if;
 if not exists(select 1 from public.map_hexes where location_ref=p_target and player_visible=true) then raise exception 'Destination unavailable';end if;
 d:=private.hex_distance(f.location_ref,p_target);
 if d<1 then raise exception 'Select a different destination';end if;
 h:=private.world_total_hours_at(now());
 insert into public.fleet_movements(fleet_id,from_ref,to_ref,ordered_by,depart_world_hour,arrive_world_hour)
 values(f.id,f.location_ref,p_target,auth.uid(),h,h+d*8) returning id into mid;
 update public.fleets set movement_status='moving',updated_at=now() where id=f.id;
 return jsonb_build_object('movement_id',mid,'distance_hexes',d,'arrival_world_hour',h+d*8);
end;$fn$;
create or replace function public.move_fleet(p_fleet uuid,p_target text) returns jsonb
language sql security definer set search_path='' as $fn$ select private.move_fleet($1,$2);$fn$;
revoke all on function public.move_fleet(uuid,text) from public,anon;
grant execute on function public.move_fleet(uuid,text) to authenticated;

create or replace function private.process_fleet_world()
returns jsonb language plpgsql security definer set search_path='' as $fn$
declare rec record; h numeric:=private.world_total_hours_at(now());built int:=0;moved int:=0;
begin
 for rec in select * from public.shipyard_orders where status='building' and build_ready_world_hour<=h for update
 loop
  insert into public.ships(faction_id,blueprint_id,name,location_ref,strength,max_strength,status)
  select rec.faction_id,rec.blueprint_id,coalesce(nullif(trim(rec.ship_name),''),b.name),rec.location_ref,b.strength,b.strength,'active'
  from public.ship_blueprints b where b.id=rec.blueprint_id;
  update public.shipyard_orders set status='completed',cycles_remaining=0,completed_at=now(),completed_world_hour=h where id=rec.id;
  built:=built+1;
 end loop;
 for rec in select * from public.fleet_movements where status='moving' and arrive_world_hour<=h for update
 loop
  update public.fleets set location_ref=rec.to_ref,movement_status='stationary',updated_at=now() where id=rec.fleet_id and status='active';
  update public.ships set location_ref=rec.to_ref,updated_at=now() where fleet_id=rec.fleet_id and status='active';
  update public.fleet_movements set status='completed',completed_at=now() where id=rec.id;
  moved:=moved+1;
 end loop;
 return jsonb_build_object('ships_commissioned',built,'fleets_arrived',moved);
end;$fn$;
revoke all on function private.process_fleet_world() from public,anon,authenticated;
do $patch$
declare body text;
begin
 body:=pg_get_functiondef('private.world_clock_heartbeat()'::regprocedure);
 if position('movement_result:=private.process_due_movements_and_operations();' in body)=0 then raise exception 'World tick integration location changed';end if;
 body:=replace(body,'movement_result:=private.process_due_movements_and_operations();',
   'movement_result:=private.process_due_movements_and_operations();
  perform private.process_fleet_world();');
 execute body;
end;$patch$;
