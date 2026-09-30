-- Shipyard construction foundation and facility-rule hardening.
-- Ship classes are intentionally data-driven; no canon hulls are seeded here.

create table if not exists public.ship_blueprints (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  hull_type text not null default 'vessel',
  description text,
  resource_costs jsonb not null default '{}'::jsonb,
  manpower_cost bigint not null default 0 check (manpower_cost>=0),
  build_cycles integer not null default 1 check (build_cycles>=1),
  strength numeric not null default 100 check (strength>0),
  player_visible boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.ships (
  id uuid primary key default gen_random_uuid(),
  faction_id uuid not null references public.factions(id) on delete cascade,
  blueprint_id uuid not null references public.ship_blueprints(id),
  name text not null,
  location_ref text not null,
  strength numeric not null default 100,
  max_strength numeric not null default 100,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.shipyard_orders (
  id uuid primary key default gen_random_uuid(),
  shipyard_facility_id uuid not null references public.facilities(id) on delete cascade,
  faction_id uuid not null references public.factions(id) on delete cascade,
  blueprint_id uuid not null references public.ship_blueprints(id),
  ship_name text not null,
  location_ref text not null,
  cycles_total integer not null check (cycles_total>=1),
  cycles_remaining integer not null check (cycles_remaining>=0),
  status text not null default 'building',
  ordered_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

alter table public.ship_blueprints enable row level security;
alter table public.ships enable row level security;
alter table public.shipyard_orders enable row level security;

do $$ begin
 create policy "authenticated read ship blueprints" on public.ship_blueprints for select to authenticated using (player_visible or public.is_admin());
exception when duplicate_object then null; end $$;
do $$ begin
 create policy "admin ship blueprints" on public.ship_blueprints for all to authenticated using (public.is_admin()) with check (public.is_admin());
exception when duplicate_object then null; end $$;
do $$ begin
 create policy "authenticated read ships" on public.ships for select to authenticated using (true);
exception when duplicate_object then null; end $$;
do $$ begin
 create policy "admin ships" on public.ships for all to authenticated using (public.is_admin()) with check (public.is_admin());
exception when duplicate_object then null; end $$;
do $$ begin
 create policy "authenticated read shipyard orders" on public.shipyard_orders for select to authenticated using (true);
exception when duplicate_object then null; end $$;
do $$ begin
 create policy "admin shipyard orders" on public.shipyard_orders for all to authenticated using (public.is_admin()) with check (public.is_admin());
exception when duplicate_object then null; end $$;

create or replace function public.queue_ship_construction(p_shipyard_id uuid,p_blueprint_id uuid,p_ship_name text default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_uid uuid:=auth.uid();
  v_faction uuid;
  v_location text;
  v_code text;
  v_blueprint ship_blueprints%rowtype;
  v_resource text;
  v_qty numeric;
  v_owned numeric;
  v_manpower bigint;
  v_order uuid;
  v_name text;
begin
  select coalesce(f.owner_faction_id,f.controlling_faction_id),f.location_ref,upper(coalesce(ft.code,ft.name,''))
  into v_faction,v_location,v_code
  from facilities f join facility_types ft on ft.id=f.facility_type_id
  where f.id=p_shipyard_id and coalesce(f.status,'active')='active';

  if v_code not like '%SHIP%' then raise exception 'Selected facility is not an active Shipyard.'; end if;
  if not public.is_admin() and not exists(
    select 1 from faction_memberships where user_id=v_uid and faction_id=v_faction and status='active'
  ) then raise exception 'Not authorized for this Shipyard.'; end if;

  select * into v_blueprint from ship_blueprints where id=p_blueprint_id and (player_visible or public.is_admin());
  if not found then raise exception 'Ship blueprint is unavailable.'; end if;

  for v_resource,v_qty in select key,value::text::numeric from jsonb_each(v_blueprint.resource_costs) loop
    select coalesce(quantity,0) into v_owned from faction_resources where faction_id=v_faction and resource_code=v_resource;
    if coalesce(v_owned,0)<v_qty then raise exception 'Insufficient %.',v_resource; end if;
  end loop;

  select manpower into v_manpower from system_economies where location_ref=v_location for update;
  if coalesce(v_manpower,0)<v_blueprint.manpower_cost then raise exception 'Insufficient system manpower.'; end if;

  for v_resource,v_qty in select key,value::text::numeric from jsonb_each(v_blueprint.resource_costs) loop
    perform add_faction_resource(v_faction,v_resource,-v_qty);
  end loop;
  update system_economies set manpower=manpower-v_blueprint.manpower_cost,updated_at=now() where location_ref=v_location;

  v_name:=coalesce(nullif(trim(coalesce(p_ship_name,'')),''),v_blueprint.name);
  insert into shipyard_orders(shipyard_facility_id,faction_id,blueprint_id,ship_name,location_ref,cycles_total,cycles_remaining,ordered_by)
  values(p_shipyard_id,v_faction,p_blueprint_id,v_name,v_location,v_blueprint.build_cycles,v_blueprint.build_cycles,v_uid)
  returning id into v_order;

  return jsonb_build_object('order_id',v_order,'ship_name',v_name,'cycles_remaining',v_blueprint.build_cycles);
end $$;

create or replace function public.process_shipyard_orders()
returns jsonb language plpgsql security definer set search_path=public as $$
declare o record; b record; completed integer:=0; advanced integer:=0;
begin
  if not public.is_admin() then raise exception 'Admin access required.'; end if;
  for o in select * from shipyard_orders where status='building' order by created_at for update loop
    if o.cycles_remaining>1 then
      update shipyard_orders set cycles_remaining=cycles_remaining-1 where id=o.id;
      advanced:=advanced+1;
    else
      select * into b from ship_blueprints where id=o.blueprint_id;
      insert into ships(faction_id,blueprint_id,name,location_ref,strength,max_strength)
      values(o.faction_id,o.blueprint_id,o.ship_name,o.location_ref,b.strength,b.strength);
      update shipyard_orders set cycles_remaining=0,status='complete',completed_at=now() where id=o.id;
      completed:=completed+1;
    end if;
  end loop;
  return jsonb_build_object('advanced',advanced,'completed',completed);
end $$;

grant execute on function public.queue_ship_construction(uuid,uuid,text) to authenticated;
grant execute on function public.process_shipyard_orders() to authenticated;

-- Correct the default slot behavior when a system economy row has not yet been created.
create or replace function public.enforce_map_facility_rules()
returns trigger language plpgsql security definer set search_path=public as $$
declare
  v_code text; v_faction uuid; v_slots integer:=8; v_used integer:=0;
  v_has_extractor boolean:=false; v_has_refinery boolean:=false;
begin
  if new.location_ref is null then return new; end if;
  select upper(coalesce(code,name,'')) into v_code from facility_types where id=new.facility_type_id;
  v_faction:=coalesce(new.owner_faction_id,new.controlling_faction_id);
  select coalesce((select slot_limit from system_economies where location_ref=new.location_ref),8) into v_slots;
  select count(*) into v_used from facilities where location_ref=new.location_ref and (tg_op='INSERT' or id<>new.id);
  if v_used>=v_slots then raise exception 'This system has no available facility slots.'; end if;
  if public.is_admin() then return new; end if;
  if v_faction is null or not exists(select 1 from faction_memberships where user_id=auth.uid() and faction_id=v_faction and status='active')
    then raise exception 'An active faction membership is required.'; end if;
  if (v_code like '%EXTRACT%' or v_code like '%MINE%') and not exists(select 1 from map_resource_deposits where location_ref=new.location_ref)
    then raise exception 'No extractable resource deposit exists at this location.'; end if;
  select exists(select 1 from facilities f join facility_types ft on ft.id=f.facility_type_id where (f.owner_faction_id=v_faction or f.controlling_faction_id=v_faction) and (upper(coalesce(ft.code,ft.name,'')) like '%EXTRACT%' or upper(coalesce(ft.code,ft.name,'')) like '%MINE%')) into v_has_extractor;
  select exists(select 1 from facilities f join facility_types ft on ft.id=f.facility_type_id where (f.owner_faction_id=v_faction or f.controlling_faction_id=v_faction) and upper(coalesce(ft.code,ft.name,'')) like '%REFIN%') into v_has_refinery;
  if v_code like '%REFIN%' and not v_has_extractor then raise exception 'Construct an Extractor before a Refinery.'; end if;
  if (v_code like '%FACTORY%' or v_code like '%SHIP%') and not v_has_refinery then raise exception 'Construct a Refinery before this facility.'; end if;
  return new;
end $$;
