
-- Alpha 0.5.0 expanded vessel registry. Four canon strike craft, five new Imperial/civilian classes.
alter table public.ship_blueprints add column if not exists vessel_category text not null default 'warship';
alter table public.ship_blueprints add column if not exists cargo_capacity numeric not null default 0;
alter table public.ship_blueprints add column if not exists hangar_slots integer not null default 0;
alter table public.ship_blueprints add column if not exists special_role text;
alter table public.ship_blueprints add column if not exists lore_status text not null default 'gameplay_proposal';
update public.ship_blueprints set lore_status='primary_canon',vessel_category='warship',
 hangar_slots=coalesce(strike_craft_min,0) where canon_source like 'Ranks of Fiction%';
with vessels(code,name,hull,description,category,role,crew,strength,cycles,aether,cargo,hangars,troops,source) as (
 values
 ('falx_iv_spireblade','Falx-IV Spireblade','interceptor','Single-seat Imperial interceptor and dogfighter','strike_craft','interception',1::bigint,35::numeric,1,1::numeric,0::numeric,0,0,'Ranks of Fiction, pp. 104–105'),
 ('kireth_7_doctrine_fang','Kireth-7 Doctrine Fang','assault_fighter','Single-seat heavy assault fighter','strike_craft','assault',1::bigint,55::numeric,1,2::numeric,0::numeric,0,0,'Ranks of Fiction, pp. 104–105'),
 ('morvex_weighing_hammer','Morvex-Class Weighing Hammer','bomber','Three-crew strategic heavy bomber','strike_craft','bombardment',3::bigint,90::numeric,2,3::numeric,0::numeric,0,0,'Ranks of Fiction, pp. 104–105'),
 ('volthera_tithe_drop','Volthera Tithe Drop','dropship','Troop landing craft, 24–36 soldiers or one Domitium walker','strike_craft','troop_drop',4::bigint,25::numeric,2,2::numeric,0::numeric,0,36,'Ranks of Fiction, pp. 104–105'),
 ('surneth_logistics_tender','Surneth-Class Logistics Tender','logistics','Imperial fleet supply transport carrying food, energy and equipment','military_support','resupply',220::bigint,75::numeric,3,8::numeric,2000::numeric,0,0,null),
 ('varion_troop_transport','Varion-Class Troop Transport','troop_transport','Dedicated army transport and protected landings','military_support','troop_transport',380::bigint,100::numeric,4,10::numeric,600::numeric,0,10000,null),
 ('kelvar_repair_tender','Kelvar-Class Repair Tender','repair_tender','Mobile hull maintenance and support engineering','military_support','repair',320::bigint,85::numeric,4,12::numeric,900::numeric,0,0,null),
 ('sereth_recon_vessel','Sereth-Class Reconnaissance Vessel','recon','Long-range sensor reconnaissance and intelligence','military_support','reconnaissance',85::bigint,60::numeric,3,6::numeric,120::numeric,0,0,null),
 ('lorak_merchant_freighter','Lorak-Class Merchant Freighter','freighter','Civilian bulk freighter for inter-system cargo transport','civilian','commerce',160::bigint,35::numeric,3,5::numeric,6000::numeric,0,0,null)
)
insert into public.ship_blueprints(code,name,hull_type,description,resource_costs,manpower_cost,build_cycles,strength,player_visible,
canon_source,doctrine_function,crew_min,crew_max,troops_capacity,vessel_category,cargo_capacity,hangar_slots,special_role,lore_status)
select code,name,hull,description,jsonb_build_object('aetherite',aether),crew,cycles,strength,true,
source,role,crew::integer,crew::integer,troops,category,cargo,hangars,role,case when source is null then 'gameplay_proposal' else 'primary_canon' end
from vessels v where not exists(select 1 from public.ship_blueprints b where b.code=v.code);

-- Mounted strike craft are part of their carrier's location/fleet, not independent fleet members.
alter table public.ships add column if not exists carrier_ship_id uuid references public.ships(id);
alter table public.ships add column if not exists cargo_manifest jsonb not null default '{}'::jsonb;
create index if not exists ships_carrier_idx on public.ships(carrier_ship_id);
create or replace function private.assign_strike_craft(p_craft_id uuid,p_carrier_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $fn$
declare c public.ships%rowtype; host public.ships%rowtype; capacity int; occupied int;
begin
 if p_craft_id=p_carrier_id then raise exception 'Craft cannot carry itself';end if;
 select * into host from public.ships where id=p_carrier_id and status='active' for update;
 select * into c from public.ships where id=p_craft_id and status='active' for update;
 if host.id is null or c.id is null or host.faction_id<>c.faction_id or not private.has_faction_permission(host.faction_id,'military') then
 raise exception 'Faction military authorization and active allied vessels required';end if;
 if c.location_ref<>host.location_ref or c.fleet_id is not null or host.carrier_ship_id is not null then
 raise exception 'Craft must be unassigned and colocated with an independent carrier';end if;
 if not exists(select 1 from public.ship_blueprints where id=c.blueprint_id and vessel_category='strike_craft') then
 raise exception 'Only strike craft may embark';end if;
 select hangar_slots into capacity from public.ship_blueprints where id=host.blueprint_id;
 select count(*) into occupied from public.ships where carrier_ship_id=host.id and status='active';
 if capacity<1 or occupied>=capacity then raise exception 'No carrier hangar capacity';end if;
 update public.ships set carrier_ship_id=host.id,location_ref=host.location_ref,updated_at=now() where id=c.id;
 return jsonb_build_object('craft_id',c.id,'carrier_id',host.id,'hangars_used',occupied+1,'hangar_capacity',capacity);
end;$fn$;
create or replace function public.assign_strike_craft(p_craft_id uuid,p_carrier_id uuid) returns jsonb
language sql security definer set search_path='' as $fn$ select private.assign_strike_craft($1,$2);$fn$;
revoke all on function public.assign_strike_craft(uuid,uuid) from public,anon;
grant execute on function public.assign_strike_craft(uuid,uuid) to authenticated;

create or replace function private.transfer_ship_cargo(p_ship_id uuid,p_resource text,p_quantity numeric,p_load boolean)
returns jsonb language plpgsql security definer set search_path='' as $fn$
declare ship public.ships%rowtype; capacity numeric; used numeric; present numeric; faction_stock numeric;
begin
 if p_quantity is null or p_quantity<=0 or p_quantity>100000 then raise exception 'Quantity out of bounds';end if;
 select * into ship from public.ships where id=p_ship_id and status='active' for update;
 if not found or not private.has_faction_permission(ship.faction_id,'military') then raise exception 'Faction cargo authority required';end if;
 if ship.fleet_id is not null and exists(select 1 from public.fleets where id=ship.fleet_id and movement_status='moving') then
 raise exception 'Cargo transfers are unavailable in transit';end if;
 if not exists(select 1 from public.territories where faction_id=ship.faction_id and location_ref=ship.location_ref) then
 raise exception 'Cargo transfers require friendly-controlled territory';end if;
 if not exists(select 1 from public.resource_catalog where code=p_resource) then raise exception 'Unknown resource';end if;
 select cargo_capacity into capacity from public.ship_blueprints where id=ship.blueprint_id;
 used:=(select coalesce(sum(value::numeric),0) from jsonb_each_text(ship.cargo_manifest));
 present:=coalesce((ship.cargo_manifest->>p_resource)::numeric,0);
 if p_load then
  if used+p_quantity>capacity then raise exception 'Cargo hold full';end if;
  select quantity into faction_stock from public.faction_resources
   where faction_id=ship.faction_id and resource_code=p_resource for update;
  if coalesce(faction_stock,0)<p_quantity then raise exception 'Insufficient faction stockpile';end if;
  update public.faction_resources set quantity=quantity-p_quantity,updated_at=now()
   where faction_id=ship.faction_id and resource_code=p_resource;
 else
  if present<p_quantity then raise exception 'Insufficient cargo aboard ship';end if;
  insert into public.faction_resources(faction_id,resource_code,quantity)
   values(ship.faction_id,p_resource,p_quantity)
   on conflict(faction_id,resource_code) do update set quantity=public.faction_resources.quantity+excluded.quantity,updated_at=now();
 end if;
 update public.ships set cargo_manifest=jsonb_set(cargo_manifest,array[p_resource],
  to_jsonb(present+(case when p_load then p_quantity else -p_quantity end))),updated_at=now()
 where id=ship.id;
 return jsonb_build_object('ship_id',ship.id,'resource',p_resource,'quantity',p_quantity,
   'action',case when p_load then 'loaded' else 'unloaded' end,'cargo_used',used+(case when p_load then p_quantity else -p_quantity end),'cargo_capacity',capacity);
end;$fn$;
create or replace function public.transfer_ship_cargo(p_ship_id uuid,p_resource text,p_quantity numeric,p_load boolean)
returns jsonb language sql security definer set search_path='' as $fn$ select private.transfer_ship_cargo($1,$2,$3,$4);$fn$;
revoke all on function public.transfer_ship_cargo(uuid,text,numeric,boolean) from public,anon;
grant execute on function public.transfer_ship_cargo(uuid,text,numeric,boolean) to authenticated;
