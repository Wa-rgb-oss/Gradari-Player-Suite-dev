
-- Alpha 0.5 fleet and warfare foundation. Existing ships and shipyard orders remain authoritative.
insert into public.ship_blueprints(code,name,hull_type,description,resource_costs,manpower_cost,build_cycles,strength,player_visible)
select v.code,v.name,v.hull,v.description,'{}'::jsonb,v.crew,v.cycles,v.strength,true
from (values
 ('patrol_corvette','Patrol Corvette','corvette','Light patrol and escort hull',25::bigint,2,120::numeric),
 ('line_frigate','Line Frigate','frigate','Medium frontline vessel',80::bigint,4,350::numeric),
 ('heavy_cruiser','Heavy Cruiser','cruiser','Capital escort and strategic patrol ship',200::bigint,8,1100::numeric)
) v(code,name,hull,description,crew,cycles,strength)
where not exists(select 1 from public.ship_blueprints b where b.code=v.code);

create table if not exists public.fleets(
 id uuid primary key default gen_random_uuid(),
 faction_id uuid not null references public.factions(id),
 name text not null check(length(trim(name)) between 1 and 80),
 location_ref text not null references public.map_hexes(location_ref),
 movement_status text not null default 'stationary' check(movement_status in ('stationary','moving')),
 status text not null default 'active' check(status in ('active','destroyed','disbanded')),
 commander_character_id uuid references public.characters(id),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
alter table public.ships add column if not exists fleet_id uuid references public.fleets(id);
create index if not exists ships_fleet_idx on public.ships(fleet_id);
create table if not exists public.fleet_movements(
 id uuid primary key default gen_random_uuid(),
 fleet_id uuid not null references public.fleets(id),
 from_ref text not null, to_ref text not null,
 ordered_by uuid not null references auth.users(id),
 depart_world_hour numeric not null, arrive_world_hour numeric not null,
 status text not null default 'moving' check(status in ('moving','completed','cancelled')),
 created_at timestamptz not null default now(), completed_at timestamptz
);
create unique index if not exists one_active_fleet_movement on public.fleet_movements(fleet_id) where status='moving';
alter table public.shipyard_orders add column if not exists completed_world_hour numeric;
alter table public.shipyard_orders add column if not exists build_ready_world_hour numeric;
create table if not exists public.military_battles(
 id uuid primary key default gen_random_uuid(),
 operation_id uuid unique references public.military_operations(id),
 attacker_faction_id uuid not null references public.factions(id),
 defender_faction_id uuid not null references public.factions(id),
 location_ref text not null,
 attacker_before numeric not null, defender_before numeric not null,
 attacker_losses numeric not null, defender_losses numeric not null,
 winner_faction_id uuid references public.factions(id),
 resolution_world_hour numeric not null,
 narrative text, created_at timestamptz not null default now()
);
create table if not exists public.military_wars(
 id uuid primary key default gen_random_uuid(),
 attacker_faction_id uuid not null references public.factions(id),
 defender_faction_id uuid not null references public.factions(id),
 status text not null default 'active' check(status in ('active','ended')),
 attacker_score numeric not null default 0, defender_score numeric not null default 0,
 opened_at timestamptz not null default now(), ended_at timestamptz,
 resolution text,
 check(attacker_faction_id<>defender_faction_id)
);
create unique index if not exists one_active_war_per_pair on public.military_wars(
 least(attacker_faction_id,defender_faction_id),greatest(attacker_faction_id,defender_faction_id)) where status='active';
create table if not exists public.military_peace_proposals(
 id uuid primary key default gen_random_uuid(),
 war_id uuid not null references public.military_wars(id),
 proposed_by_faction_id uuid not null references public.factions(id),
 proposed_by_user_id uuid not null references auth.users(id),
 terms text not null check(terms in ('white_peace','attacker_victory','defender_victory')),
 status text not null default 'pending' check(status in ('pending','accepted','rejected','expired')),
 created_at timestamptz not null default now(),responded_at timestamptz
);
create index if not exists military_proposals_by_war on public.military_peace_proposals(war_id,status);
-- RLS for player-facing read models; writes confined to dedicated RPCs.
do $pol$
declare t text;
begin
 foreach t in array array['fleets','fleet_movements','military_battles','military_wars','military_peace_proposals']
 loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on public.%I from anon, authenticated',t);
  execute format('grant select on public.%I to authenticated',t);
  execute format('create policy "Authenticated read military record" on public.%I for select to authenticated using (true)',t);
 end loop;
end $pol$;
grant select on public.ship_blueprints, public.ships, public.shipyard_orders to authenticated;
