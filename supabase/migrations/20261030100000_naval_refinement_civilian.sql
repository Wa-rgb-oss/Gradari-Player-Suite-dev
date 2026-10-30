
-- Naval Refinement: enforce yard capacity, enable player-owned civilian ships and shipping.
alter table public.ship_blueprints add column if not exists required_yard_level integer not null default 1;
alter table public.ship_blueprints add column if not exists required_yard_kind text not null default 'naval';
update public.ship_blueprints set
 required_yard_kind=case when vessel_category='civilian' then 'civilian' else 'naval' end,
 required_yard_level=case
 when vessel_category='strike_craft' then 1
 when vessel_category='military_support' then 1
 when code='auris_doctrine_frigate' then 1
 when code='severan_line_destroyer' then 2
 when code in ('cindarion_siege_cruiser','aurelian_assault_cruiser') then 3
 when code='virelion_command_carrier' then 3
 else 1 end
where player_visible=true;
alter table public.ships add column if not exists owner_user_id uuid references auth.users(id);
alter table public.shipyard_orders add column if not exists owner_user_id uuid references auth.users(id);
create index if not exists player_ships_by_owner on public.ships(owner_user_id) where owner_user_id is not null;
create table if not exists public.civilian_ship_movements(
 id uuid primary key default gen_random_uuid(),
 ship_id uuid not null references public.ships(id),
 owner_user_id uuid not null references auth.users(id),
 from_ref text not null,to_ref text not null,
 depart_world_hour numeric not null,arrive_world_hour numeric not null,
 status text not null default 'moving' check(status in ('moving','completed','cancelled')),
 created_at timestamptz not null default now(),completed_at timestamptz
);
create unique index if not exists one_active_civilian_voyage on public.civilian_ship_movements(ship_id) where status='moving';
alter table public.civilian_ship_movements enable row level security;
revoke all on public.civilian_ship_movements from public,anon,authenticated;
grant select on public.civilian_ship_movements to authenticated;
create policy "Owner views civilian voyages" on public.civilian_ship_movements
 for select to authenticated using(owner_user_id=(select auth.uid()));
-- Existing military assets are still faction-controlled. Civilian craft have user and sponsoring territory faction.
do $patch$
declare body text;
begin
 body:=pg_get_functiondef('private.queue_faction_ship(uuid,uuid,text)'::regprocedure);
 if position('if length(trim(coalesce(p_name' in body)=0 then raise exception 'Shipyard function changed';end if;
 body:=replace(body,'if length(trim(coalesce(p_name',
 'if b.vessel_category=''civilian'' then raise exception ''Civilian vessels require player shipyard orders'';end if;
 if not exists(select 1 from public.facility_types ty where ty.id=y.facility_type_id and ty.code=''NAVAL_YARD'')
   or y.level<b.required_yard_level then
   raise exception ''Naval yard type or level insufficient for blueprint'';end if;
 if length(trim(coalesce(p_name');
 execute body;
end;$patch$;

create or replace function private.queue_civilian_ship(p_yard uuid,p_blueprint uuid,p_name text)
returns jsonb language plpgsql security definer set search_path='' as $fn$
declare yard public.facilities%rowtype;bp public.ship_blueprints%rowtype;
 territory_faction uuid; wallet numeric; current_qty numeric; rc record; cost numeric;h numeric;result_id uuid;
begin
 if auth.uid() is null then raise exception 'Authentication required';end if;
 select * into yard from public.facilities where id=p_yard and status='active' for update;
 if not found or yard.owner_user_id is distinct from auth.uid()
 or not exists(select 1 from public.facility_types t where t.id=yard.facility_type_id and t.code='SHIPYARD')
 then raise exception 'You must own an active Civilian Shipyard';end if;
 select * into bp from public.ship_blueprints where id=p_blueprint and player_visible=true and vessel_category='civilian';
 if not found then raise exception 'Civilian blueprint required';end if;
 if yard.level<bp.required_yard_level then raise exception 'Shipyard level too low';end if;
 if length(trim(coalesce(p_name,''))) not between 1 and 80 then raise exception 'Ship name required (max 80 characters)';end if;
 select faction_id into territory_faction from public.territories where location_ref=yard.location_ref;
 if territory_faction is null then raise exception 'Shipyard must be located in governed territory';end if;
 if exists(select 1 from public.shipyard_orders where shipyard_facility_id=p_yard and status in('queued','building'))
 then raise exception 'Shipyard is occupied';end if;
 cost:=round(bp.strength*20,2);
 select balance into wallet from public.player_wallets where user_id=auth.uid() for update;
 if coalesce(wallet,0)<cost then raise exception 'Insufficient personal Aureum';end if;
 for rc in select key, value::numeric qty from jsonb_each_text(bp.resource_costs) order by key loop
   select quantity into current_qty from public.player_resources where user_id=auth.uid() and resource_code=rc.key for update;
   if coalesce(current_qty,0)<rc.qty then raise exception 'Missing personal resource: %',rc.key;end if;
 end loop;
 update public.player_wallets set balance=balance-cost,updated_at=now() where user_id=auth.uid();
 for rc in select key,value::numeric qty from jsonb_each_text(bp.resource_costs) loop
   update public.player_resources set quantity=quantity-rc.qty,updated_at=now()
   where user_id=auth.uid() and resource_code=rc.key;
 end loop;
 h:=private.world_total_hours_at(now());
 insert into public.shipyard_orders(shipyard_facility_id,faction_id,blueprint_id,ship_name,location_ref,
 cycles_total,cycles_remaining,status,ordered_by,build_ready_world_hour,owner_user_id)
 values(p_yard,territory_faction,bp.id,trim(p_name),yard.location_ref,bp.build_cycles,bp.build_cycles,
 'building',auth.uid(),h+36*bp.build_cycles,auth.uid()) returning id into result_id;
 return jsonb_build_object('order_id',result_id,'cost',cost,'owner_user_id',auth.uid(),'ready_world_hour',h+36*bp.build_cycles);
end;$fn$;
create or replace function public.queue_civilian_ship(p_yard uuid,p_blueprint uuid,p_name text) returns jsonb
language sql security definer set search_path='' as $fn$ select private.queue_civilian_ship($1,$2,$3);$fn$;
revoke all on function public.queue_civilian_ship(uuid,uuid,text) from public,anon;
grant execute on function public.queue_civilian_ship(uuid,uuid,text) to authenticated;

create or replace function private.move_civilian_ship(p_ship uuid,p_destination text)
returns jsonb language plpgsql security definer set search_path='' as $fn$
declare s public.ships%rowtype;distance int;h numeric;route_id uuid;
begin
 select * into s from public.ships where id=p_ship and status='active' for update;
 if not found or s.owner_user_id is distinct from auth.uid() then raise exception 'Ship not owned by current player';end if;
 if s.fleet_id is not null or s.carrier_ship_id is not null then raise exception 'Ship is assigned to military fleet or carrier';end if;
 if exists(select 1 from public.civilian_ship_movements where ship_id=s.id and status='moving') then raise exception 'Ship already in transit';end if;
 if not exists(select 1 from public.map_hexes where location_ref=p_destination and player_visible=true) then raise exception 'Destination unavailable';end if;
 distance:=private.hex_distance(s.location_ref,p_destination);
 if distance<1 then raise exception 'Select a different destination';end if;
 h:=private.world_total_hours_at(now());
 insert into public.civilian_ship_movements(ship_id,owner_user_id,from_ref,to_ref,depart_world_hour,arrive_world_hour)
 values(s.id,auth.uid(),s.location_ref,p_destination,h,h+distance*10) returning id into route_id;
 return jsonb_build_object('movement_id',route_id,'arrival_world_hour',h+distance*10,'hexes',distance);
end;$fn$;
create or replace function public.move_civilian_ship(p_ship uuid,p_destination text) returns jsonb
language sql security definer set search_path='' as $fn$ select private.move_civilian_ship($1,$2);$fn$;
revoke all on function public.move_civilian_ship(uuid,text) from public,anon;
grant execute on function public.move_civilian_ship(uuid,text) to authenticated;

create or replace function private.transfer_civilian_cargo(p_ship uuid,p_resource text,p_quantity numeric,p_load boolean)
returns jsonb language plpgsql security definer set search_path='' as $fn$
declare s public.ships%rowtype; cap numeric; used numeric;onboard numeric;available numeric;
begin
 if p_quantity is null or p_quantity<=0 or p_quantity>100000 then raise exception 'Invalid quantity';end if;
 select * into s from public.ships where id=p_ship and status='active' for update;
 if not found or s.owner_user_id is distinct from auth.uid() then raise exception 'Ship not owned by player';end if;
 if exists(select 1 from public.civilian_ship_movements where ship_id=s.id and status='moving') then raise exception 'Cannot transfer while traveling';end if;
 if not exists(select 1 from public.territories where location_ref=s.location_ref) then raise exception 'Cargo transfers require a governed system';end if;
 if not exists(select 1 from public.resource_catalog where code=p_resource) then raise exception 'Invalid resource';end if;
 select cargo_capacity into cap from public.ship_blueprints where id=s.blueprint_id;
 used:=(select coalesce(sum(value::numeric),0) from jsonb_each_text(s.cargo_manifest));
 onboard:=coalesce((s.cargo_manifest->>p_resource)::numeric,0);
 if p_load then
  if used+p_quantity>cap then raise exception 'Insufficient cargo hold';end if;
  select quantity into available from public.player_resources where user_id=auth.uid() and resource_code=p_resource for update;
  if coalesce(available,0)<p_quantity then raise exception 'Insufficient personal resources';end if;
  update public.player_resources set quantity=quantity-p_quantity,updated_at=now() where user_id=auth.uid() and resource_code=p_resource;
 else
  if onboard<p_quantity then raise exception 'Insufficient ship cargo';end if;
  insert into public.player_resources(user_id,resource_code,quantity) values(auth.uid(),p_resource,p_quantity)
  on conflict(user_id,resource_code) do update set quantity=public.player_resources.quantity+excluded.quantity,updated_at=now();
 end if;
 update public.ships set cargo_manifest=jsonb_set(cargo_manifest,array[p_resource],
 to_jsonb(onboard+case when p_load then p_quantity else -p_quantity end)),updated_at=now() where id=s.id;
 return jsonb_build_object('ship_id',s.id,'resource',p_resource,'quantity',p_quantity,
 'action',case when p_load then 'loaded' else 'unloaded' end);
end;$fn$;
create or replace function public.transfer_civilian_cargo(p_ship uuid,p_resource text,p_quantity numeric,p_load boolean) returns jsonb
language sql security definer set search_path='' as $fn$ select private.transfer_civilian_cargo($1,$2,$3,$4);$fn$;
revoke all on function public.transfer_civilian_cargo(uuid,text,numeric,boolean) from public,anon;
grant execute on function public.transfer_civilian_cargo(uuid,text,numeric,boolean) to authenticated;

do $patch$
declare body text;
begin
 body:=pg_get_functiondef('private.process_fleet_world()'::regprocedure);
 if position('insert into public.ships(faction_id,blueprint_id,name,location_ref,strength,max_strength,status,crew_origin_ref)' in body)=0 then
 raise exception 'Ship commissioning changed';end if;
 body:=replace(body,'insert into public.ships(faction_id,blueprint_id,name,location_ref,strength,max_strength,status,crew_origin_ref)',
 'insert into public.ships(faction_id,blueprint_id,name,location_ref,strength,max_strength,status,crew_origin_ref,owner_user_id)');
 body:=replace(body,'''active'',rec.location_ref','''active'',case when rec.owner_user_id is null then rec.location_ref else null end,rec.owner_user_id');
 if position('return jsonb_build_object(''ships_commissioned''' in body)=0 then raise exception 'World tick return changed';end if;
 body:=replace(body,'return jsonb_build_object(''ships_commissioned''',
 'for rec in select * from public.civilian_ship_movements
 where status=''moving'' and arrive_world_hour<=h for update loop
   update public.ships set location_ref=rec.to_ref,updated_at=now() where id=rec.ship_id and status=''active'';
   update public.civilian_ship_movements set status=''completed'',completed_at=now() where id=rec.id;
 end loop;
 return jsonb_build_object(''ships_commissioned''');
 execute body;
end;$patch$;
