-- Alpha 0.5.0: phased career perks and mandatory adjacent hex travel.
insert into public.research_perks(code,name,description,category,tier,cost_points,position_x,position_y,sort_order,player_visible,is_active) values
('NAVIGATION_PROTOCOLS','Navigation Protocols','Character travel 10% faster and discoverable events detected at radius 2.','EXPLORATION',1,6,100,100,90,true,true),
('DEEP_SPACE_NAVIGATION','Deep Space Navigation','Detect events at radius 3 and retain navigation speed bonus.','EXPLORATION',2,20,180,100,91,true,true),
('LONG_RANGE_SURVEY','Long-Range Survey','Detect nearby events at radius 4.','EXPLORATION',3,45,260,100,92,true,true),
('CIVIC_NETWORKS','Civic Networks','Gain access to higher-tier political progression.','POLITICAL',1,6,100,100,100,true,true),
('PUBLIC_ADMINISTRATION','Public Administration','Expand political specialization and contract potential.','POLITICAL',2,20,180,100,101,true,true),
('IMPERIAL_INSTITUTIONS','Imperial Institutions','Complete the early political specialization network.','POLITICAL',3,45,260,100,102,true,true),
('CITIZEN_EFFICIENCY','Citizen Efficiency','General civilian aptitude research.','GENERAL',1,6,100,100,110,true,true),
('CIVILIAN_LEADERSHIP','Civilian Leadership','Improved general career specialization.','GENERAL',2,20,180,100,111,true,true),
('STRATEGIC_COORDINATION','Strategic Coordination','Advanced civilian specialization.','GENERAL',3,45,260,100,112,true,true)
on conflict(code) do nothing;
insert into public.research_perk_prerequisites(perk_id,prerequisite_perk_id)
select next.id,prev.id from (values
 ('DEEP_SPACE_NAVIGATION','NAVIGATION_PROTOCOLS'),
 ('LONG_RANGE_SURVEY','DEEP_SPACE_NAVIGATION'),
 ('PUBLIC_ADMINISTRATION','CIVIC_NETWORKS'),
 ('IMPERIAL_INSTITUTIONS','PUBLIC_ADMINISTRATION'),
 ('CIVILIAN_LEADERSHIP','CITIZEN_EFFICIENCY'),
 ('STRATEGIC_COORDINATION','CIVILIAN_LEADERSHIP')
) links(next_code,prev_code)
join public.research_perks next on next.code=links.next_code
join public.research_perks prev on prev.code=links.prev_code
on conflict do nothing;

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
  v_arrive:=v_now+(v_distance*v_hours_per_hex*(0.75+0.25*v_difficulty)*v_navigation_modifier);

  insert into public.character_travel(
    character_id,user_id,from_ref,to_ref,distance,depart_world_hour,arrive_world_hour,status
  )
  values(p_character_id,v_uid,v_char.location_ref,p_to_ref,v_distance,v_now,v_arrive,'traveling')
  returning id into v_id;

  update public.characters
  set movement_status='traveling',updated_at=now()
  where id=p_character_id;

  return jsonb_build_object(
    'travel_id',v_id,'distance',v_distance,'depart_world_hour',v_now,
    'arrive_world_hour',v_arrive,'travel_hours',v_distance*v_hours_per_hex*(0.75+0.25*v_difficulty)*v_navigation_modifier
  );
end;
$function$;

-- Server-authoritative proximity discovery, with one unique claim per player/event.
create table if not exists public.civilian_discoveries (
 id uuid primary key default gen_random_uuid(),
 title text not null,
 description text not null default '',
 location_ref text not null references public.map_hexes(location_ref),
 rarity text not null default 'common' check(rarity in ('common','rare')),
 bonus_research_points integer not null default 1 check(bonus_research_points between 0 and 50),
 starts_at timestamptz not null default now(),
 expires_at timestamptz,
 first_discovered_by uuid references auth.users(id),
 created_at timestamptz not null default now(),
 check(expires_at is null or expires_at>starts_at)
);
create table if not exists public.civilian_discovery_claims (
 discovery_id uuid not null references public.civilian_discoveries(id) on delete cascade,
 user_id uuid not null references auth.users(id) on delete cascade,
 claimed_at timestamptz not null default now(),
 research_earned integer not null default 0,
 primary key(discovery_id,user_id)
);
alter table public.civilian_discoveries enable row level security;
alter table public.civilian_discovery_claims enable row level security;
revoke all on public.civilian_discoveries,public.civilian_discovery_claims from anon,authenticated;
grant select,insert,update,delete on public.civilian_discoveries to authenticated;
grant select on public.civilian_discovery_claims to authenticated;
create policy "Game Masters manage civilian discoveries" on public.civilian_discoveries for all to authenticated
 using((select private.is_admin())) with check((select private.is_admin()));
create policy "Players read only own discoveries" on public.civilian_discovery_claims for select to authenticated
 using(user_id=(select auth.uid()) or (select private.is_admin()));

create or replace function public.scan_civilian_discoveries(p_character_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_uid uuid:=(select auth.uid());v_pos text;v_radius integer:=1;v_event record;v_claim uuid;
 v_findings jsonb:='[]'::jsonb;v_first boolean;v_bonus integer;
begin
 if v_uid is null then raise exception 'Authentication required';end if;
 select location_ref into v_pos from public.characters where id=p_character_id and user_id=v_uid
 and status='active' and life_status='alive' and movement_status='stationary';
 if v_pos is null then return jsonb_build_object('events','[]'::jsonb,'scan_radius',1,'reason','CHARACTER_NOT_STATIONARY');end if;
 if exists(select 1 from public.player_research_perks owned join public.research_perks perk on perk.id=owned.perk_id where owned.user_id=v_uid and perk.code='NAVIGATION_PROTOCOLS') then v_radius:=2;end if;
 if exists(select 1 from public.player_research_perks owned join public.research_perks perk on perk.id=owned.perk_id where owned.user_id=v_uid and perk.code='DEEP_SPACE_NAVIGATION') then v_radius:=3;end if;
 if exists(select 1 from public.player_research_perks owned join public.research_perks perk on perk.id=owned.perk_id where owned.user_id=v_uid and perk.code='LONG_RANGE_SURVEY') then v_radius:=4;end if;
 for v_event in select * from public.civilian_discoveries
 where starts_at<=now() and (expires_at is null or expires_at>now())
 and private.hex_distance(v_pos,location_ref)<=v_radius
 order by created_at for update
 loop
  v_first:=v_event.first_discovered_by is null;
  v_bonus:=v_event.bonus_research_points+case when v_first and v_event.rarity='rare' then 2 else 0 end;
  insert into public.civilian_discovery_claims(discovery_id,user_id,research_earned)
   values(v_event.id,v_uid,v_bonus) on conflict do nothing returning discovery_id into v_claim;
  if v_claim is not null then
   if v_first then update public.civilian_discoveries set first_discovered_by=v_uid where id=v_event.id;end if;
   if v_bonus>0 then perform private.add_player_research_points(v_uid,v_bonus);end if;
  end if;
  v_findings:=v_findings||jsonb_build_array(jsonb_build_object(
   'id',v_event.id,'title',v_event.title,'description',v_event.description,
   'location_ref',v_event.location_ref,'rarity',v_event.rarity,
   'discovered_now',v_claim is not null,'research_awarded',case when v_claim is not null then v_bonus else 0 end
  ));
  v_claim:=null;
 end loop;
 return jsonb_build_object('events',v_findings,'scan_radius',v_radius,'location_ref',v_pos);
end $$;
revoke all on function public.scan_civilian_discoveries(uuid) from public,anon;
grant execute on function public.scan_civilian_discoveries(uuid) to authenticated;

-- A handful of launch signals; their appearance is contingent on actual proximity.
insert into public.civilian_discoveries(title,description,location_ref,rarity,bonus_research_points)
select x.title,x.description,x.location_ref,x.rarity,x.bonus
from (values
 ('Imperial Survey Beacon','An automated survey signal offers basic navigation data.','HEX_-2_-1','common',1),
 ('Forgotten Archive Echo','A rare encrypted archive signal has been detected.','HEX_0_1','rare',3),
 ('Industrial Distress Signal','Unverified industrial telemetry appears near the Naexus Arc.','HEX_-6_-2','common',2)
) x(title,description,location_ref,rarity,bonus)
where exists(select 1 from public.map_hexes m where m.location_ref=x.location_ref)
 and not exists(select 1 from public.civilian_discoveries d where d.title=x.title);
