-- Gradari Mireris map industry foundation
-- Apply to the Supabase project used by auth.js.

create table if not exists public.map_resource_deposits (
  id uuid primary key default gen_random_uuid(),
  location_ref text not null,
  resource_code text not null check (resource_code in ('energy','gold_ore','aetherite','vyr_ore')),
  richness numeric not null default 1 check (richness > 0),
  created_at timestamptz not null default now(),
  unique(location_ref, resource_code)
);

create table if not exists public.system_economies (
  location_ref text primary key,
  population bigint not null default 0 check (population >= 0),
  manpower bigint not null default 0 check (manpower >= 0),
  food numeric not null default 0,
  slot_limit integer not null default 8 check (slot_limit between 1 and 8),
  updated_at timestamptz not null default now()
);

create table if not exists public.resource_catalog (
  code text primary key,
  name text not null,
  category text not null,
  unit text not null default 'units',
  player_visible boolean not null default true
);

insert into public.resource_catalog(code,name,category) values
 ('energy','Energy','raw'),
 ('gold_ore','Gold Ore','raw'),
 ('aetherite','Aetherite','raw'),
 ('vyr_ore','Vyr Ore','raw'),
 ('refined_gold','Refined Gold','refined'),
 ('vyrsteel','VyrSteel','refined'),
 ('refined_aetherite','Refined Aetherite','refined'),
 ('electronics','Electronics','manufactured'),
 ('energy_cells','Energy Cells','manufactured'),
 ('clothing','Clothing','manufactured'),
 ('weapons','Weapons','manufactured'),
 ('machinery','Machinery','manufactured'),
 ('construction_materials','Construction Materials','manufactured'),
 ('ship_components','Ship Components','manufactured'),
 ('medical_supplies','Medical Supplies','manufactured'),
 ('aetheric_components','Aetheric Components','manufactured'),
 ('military_equipment','Military Equipment','manufactured'),
 ('food','Food','system')
on conflict (code) do update set name=excluded.name, category=excluded.category;

create table if not exists public.faction_resources (
  faction_id uuid not null,
  resource_code text not null references public.resource_catalog(code),
  quantity numeric not null default 0,
  updated_at timestamptz not null default now(),
  primary key(faction_id, resource_code)
);

create table if not exists public.facility_connections (
  refinery_facility_id uuid not null,
  extractor_facility_id uuid not null,
  created_at timestamptz not null default now(),
  primary key(refinery_facility_id, extractor_facility_id)
);

create table if not exists public.factory_recipes (
  code text primary key,
  name text not null,
  output_resource_code text not null references public.resource_catalog(code),
  output_quantity numeric not null default 1,
  inputs jsonb not null default '{}'::jsonb,
  player_visible boolean not null default true
);

insert into public.factory_recipes(code,name,output_resource_code,output_quantity,inputs) values
 ('electronics','Electronics','electronics',1,'{"refined_gold":1,"energy":1}'),
 ('energy_cells','Energy Cells','energy_cells',1,'{"energy":2}'),
 ('clothing','Clothing','clothing',1,'{"energy":1}'),
 ('weapons','Weapons','weapons',1,'{"vyrsteel":1,"electronics":1}'),
 ('machinery','Machinery','machinery',1,'{"vyrsteel":1,"electronics":1}'),
 ('construction_materials','Construction Materials','construction_materials',1,'{"vyrsteel":1,"energy":1}'),
 ('ship_components','Ship Components','ship_components',1,'{"vyrsteel":2,"electronics":1}'),
 ('medical_supplies','Medical Supplies','medical_supplies',1,'{"energy":1,"aetheric_components":1}'),
 ('aetheric_components','Aetheric Components','aetheric_components',1,'{"refined_aetherite":1,"electronics":1,"energy":1}'),
 ('military_equipment','Military Equipment','military_equipment',1,'{"vyrsteel":1,"electronics":1,"energy_cells":1}')
on conflict (code) do update set name=excluded.name,output_resource_code=excluded.output_resource_code,output_quantity=excluded.output_quantity,inputs=excluded.inputs;

create table if not exists public.factory_orders (
  facility_id uuid primary key,
  recipe_code text not null references public.factory_recipes(code),
  updated_at timestamptz not null default now()
);

create table if not exists public.trade_station_markets (
  market_id uuid primary key,
  location_ref text not null unique,
  station_name text not null,
  player_visible boolean not null default true
);

alter table public.map_resource_deposits enable row level security;
alter table public.system_economies enable row level security;
alter table public.resource_catalog enable row level security;
alter table public.faction_resources enable row level security;
alter table public.facility_connections enable row level security;
alter table public.factory_recipes enable row level security;
alter table public.factory_orders enable row level security;
alter table public.trade_station_markets enable row level security;

do $$ begin
 create policy "authenticated read map deposits" on public.map_resource_deposits for select to authenticated using (true);
exception when duplicate_object then null; end $$;
do $$ begin
 create policy "authenticated read system economies" on public.system_economies for select to authenticated using (true);
exception when duplicate_object then null; end $$;
do $$ begin
 create policy "authenticated read resource catalog" on public.resource_catalog for select to authenticated using (player_visible);
exception when duplicate_object then null; end $$;
do $$ begin
 create policy "authenticated read faction resources" on public.faction_resources for select to authenticated using (true);
exception when duplicate_object then null; end $$;
do $$ begin
 create policy "authenticated read connections" on public.facility_connections for select to authenticated using (true);
exception when duplicate_object then null; end $$;
do $$ begin
 create policy "authenticated read recipes" on public.factory_recipes for select to authenticated using (player_visible);
exception when duplicate_object then null; end $$;
do $$ begin
 create policy "authenticated read factory orders" on public.factory_orders for select to authenticated using (true);
exception when duplicate_object then null; end $$;
do $$ begin
 create policy "authenticated read trade stations" on public.trade_station_markets for select to authenticated using (player_visible);
exception when duplicate_object then null; end $$;

-- Admin writes remain governed by the existing public.is_admin() registry.
do $$ begin
 create policy "admin map deposits" on public.map_resource_deposits for all to authenticated using (public.is_admin()) with check (public.is_admin());
exception when duplicate_object then null; end $$;
do $$ begin
 create policy "admin system economies" on public.system_economies for all to authenticated using (public.is_admin()) with check (public.is_admin());
exception when duplicate_object then null; end $$;
do $$ begin
 create policy "admin trade stations" on public.trade_station_markets for all to authenticated using (public.is_admin()) with check (public.is_admin());
exception when duplicate_object then null; end $$;

-- Guardrails used by player construction. Existing facility placement RPCs should call this.
create or replace function public.check_map_facility_prerequisites(p_faction_id uuid,p_location_ref text,p_facility_code text)
returns void language plpgsql security definer set search_path=public as $$
declare
  v_slots integer := 8;
  v_used integer := 0;
  v_has_extractor boolean := false;
  v_has_refinery boolean := false;
begin
  select coalesce(slot_limit,8) into v_slots from system_economies where location_ref=p_location_ref;
  select count(*) into v_used from facilities where location_ref=p_location_ref;
  if v_used >= v_slots then raise exception 'This system has no available facility slots.'; end if;

  select exists(
    select 1 from facilities f join facility_types ft on ft.id=f.facility_type_id
    where (f.owner_faction_id=p_faction_id or f.controlling_faction_id=p_faction_id)
      and upper(coalesce(ft.code,ft.name,'')) like '%EXTRACT%'
  ) into v_has_extractor;

  select exists(
    select 1 from facilities f join facility_types ft on ft.id=f.facility_type_id
    where (f.owner_faction_id=p_faction_id or f.controlling_faction_id=p_faction_id)
      and upper(coalesce(ft.code,ft.name,'')) like '%REFIN%'
  ) into v_has_refinery;

  if upper(p_facility_code) like '%REFIN%' and not v_has_extractor then
    raise exception 'Construct an Extractor before a Refinery.';
  end if;
  if (upper(p_facility_code) like '%FACTORY%' or upper(p_facility_code) like '%SHIP%') and not v_has_refinery then
    raise exception 'Construct a Refinery before this facility.';
  end if;
end $$;

create or replace function public.connect_refinery_extractor(p_refinery_id uuid,p_extractor_id uuid)
returns void language plpgsql security definer set search_path=public as $$
declare
  v_count integer;
  v_ref_faction uuid;
  v_ext_faction uuid;
  v_ref_code text;
  v_ext_code text;
begin
  select coalesce(f.owner_faction_id,f.controlling_faction_id),upper(coalesce(ft.code,ft.name,''))
    into v_ref_faction,v_ref_code from facilities f join facility_types ft on ft.id=f.facility_type_id where f.id=p_refinery_id;
  select coalesce(f.owner_faction_id,f.controlling_faction_id),upper(coalesce(ft.code,ft.name,''))
    into v_ext_faction,v_ext_code from facilities f join facility_types ft on ft.id=f.facility_type_id where f.id=p_extractor_id;
  if v_ref_faction is null or v_ref_faction<>v_ext_faction then raise exception 'Facilities must share an owner.'; end if;
  if v_ref_code not like '%REFIN%' then raise exception 'Selected facility is not a Refinery.'; end if;
  if v_ext_code not like '%EXTRACT%' and v_ext_code not like '%MINE%' then raise exception 'Selected facility is not an Extractor.'; end if;
  if not exists(select 1 from faction_memberships where user_id=auth.uid() and faction_id=v_ref_faction and status='active') and not public.is_admin() then
    raise exception 'Not authorized for this faction.';
  end if;
  select count(*) into v_count from facility_connections where refinery_facility_id=p_refinery_id;
  if v_count>=3 then raise exception 'This Refinery already has three connected Extractors.'; end if;
  insert into facility_connections(refinery_facility_id,extractor_facility_id) values(p_refinery_id,p_extractor_id) on conflict do nothing;
end $$;
