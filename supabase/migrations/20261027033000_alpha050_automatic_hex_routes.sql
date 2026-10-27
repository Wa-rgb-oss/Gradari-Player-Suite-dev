-- Alpha 0.5.0 fix: one destination, automatic sequential hex travel.
-- Route snapshots are server-authored and persist per-hex arrival times.
-- Old, already-active one-leg travel records retain their prior behavior.

alter table public.character_travel
 add column if not exists route_waypoints jsonb not null default '[]'::jsonb,
 add column if not exists route_step_index integer not null default 0,
 add constraint character_travel_route_array_check check (jsonb_typeof(route_waypoints)='array'),
 add constraint character_travel_route_step_nonnegative check (route_step_index>=0);

create index if not exists character_travel_active_steps_idx
 on public.character_travel(status,arrive_world_hour) where status='traveling';

-- Private planner: shortest HEX COUNT, favoring easier adjacent steps when
-- more than one shortest path is available. Each step has its own duration.
-- If map holes prevent an onward route, the operation fails atomically.
create or replace function private.plan_civilian_hex_route(
 p_from_ref text, p_to_ref text, p_user_id uuid,
 p_depart_world_hour numeric, p_include_incidents boolean
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
 v_current text:=p_from_ref;
 v_distance integer;
 v_remaining integer;
 v_hex record;
 v_base numeric;
 v_nav numeric:=1;
 v_arrival numeric:=p_depart_world_hour;
 v_time numeric;
 v_delay numeric;
 v_total_delay numeric:=0;
 v_risk numeric;
 v_waypoints jsonb:=jsonb_build_array(jsonb_build_object(
   'ref',p_from_ref,'arrival_world_hour',p_depart_world_hour,'difficulty',null,
   'piracy_delay_hours',0
 ));
begin
 if not exists (select 1 from public.map_hexes where location_ref=p_from_ref and player_visible)
   or not exists (select 1 from public.map_hexes where location_ref=p_to_ref and player_visible)
 then raise exception 'Start or destination hex is not accessible'; end if;
 v_distance:=private.hex_distance(p_from_ref,p_to_ref);
 if v_distance<1 then raise exception 'Choose a different destination'; end if;
 select character_travel_hours_per_hex into v_base
 from public.game_config where singleton=true;
 if v_base is null or v_base<=0 then raise exception 'Character travel speed is not configured';end if;
 if exists(select 1 from public.player_research_perks owned
  join public.research_perks perk on perk.id=owned.perk_id
  where owned.user_id=p_user_id and perk.code in ('NAVIGATION_PROTOCOLS','DEEP_SPACE_NAVIGATION'))
 then v_nav:=0.9;end if;

 for i in 1..v_distance loop
   v_remaining:=private.hex_distance(v_current,p_to_ref);
   select m.location_ref,
          coalesce(h.movement_difficulty,3) difficulty,
          coalesce(h.stability_percent,65) stability
   into v_hex
   from public.map_hexes m
   left join public.hex_conditions h on h.location_ref=m.location_ref
   where m.player_visible=true
     and private.hex_distance(v_current,m.location_ref)=1
     and private.hex_distance(m.location_ref,p_to_ref)=v_remaining-1
   order by coalesce(h.movement_difficulty,3) asc,m.q asc,m.r asc
   limit 1;
   if not found then raise exception 'No accessible hex route to destination';end if;
   v_time:=v_base*(0.75+0.25*v_hex.difficulty)*v_nav;
   v_risk:=least(0.35,greatest(0,(100-v_hex.stability)*0.002+(v_hex.difficulty-1)*0.01));
   v_delay:=case when p_include_incidents and random()<v_risk
       then v_base*0.5 else 0 end;
   v_total_delay:=v_total_delay+v_delay;
   v_arrival:=v_arrival+v_time+v_delay;
   v_waypoints:=v_waypoints||jsonb_build_array(jsonb_build_object(
     'ref',v_hex.location_ref,'arrival_world_hour',v_arrival,
     'difficulty',v_hex.difficulty,'piracy_delay_hours',v_delay
   ));
   v_current:=v_hex.location_ref;
 end loop;
 if v_current<>p_to_ref then raise exception 'Route calculation did not reach destination';end if;
 return jsonb_build_object(
   'route',v_waypoints,'distance',v_distance,
   'depart_world_hour',p_depart_world_hour,
   'arrive_world_hour',v_arrival,
   'travel_hours',v_arrival-p_depart_world_hour,
   'piracy_delay_hours',v_total_delay,
   'piracy_incident',v_total_delay>0
 );
end $$;

revoke all on function private.plan_civilian_hex_route(text,text,uuid,numeric,boolean)
 from public,anon,authenticated;

-- Preview follows the same deterministic routing rules, excluding
-- unrevealed chance-based incidents until actual departure.
create or replace function public.preview_character_route(
 p_character_id uuid,p_to_ref text
) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_char public.characters%rowtype; v_user uuid:=(select auth.uid());
begin
 if v_user is null then raise exception 'Authentication required';end if;
 select * into v_char from public.characters
 where id=p_character_id and user_id=v_user and status='active' and life_status='alive';
 if not found or v_char.location_ref is null then raise exception 'Active character location not found';end if;
 if v_char.movement_status<>'stationary' then raise exception 'Character already traveling';end if;
 return private.plan_civilian_hex_route(v_char.location_ref,p_to_ref,v_user,
                                       private.world_total_hours_at(now()),false);
end $$;
revoke all on function public.preview_character_route(uuid,text) from public,anon;
grant execute on function public.preview_character_route(uuid,text) to authenticated;

create or replace function private.begin_character_travel(
 p_character_id uuid,p_to_ref text
) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_user uuid:=(select auth.uid());
 v_char public.characters%rowtype;
 v_plan jsonb;
 v_travel_id uuid;
 v_depart numeric;
begin
 if v_user is null then raise exception 'Authentication required';end if;
 select * into v_char from public.characters
 where id=p_character_id and user_id=v_user and status='active' and life_status='alive'
 for update;
 if not found then raise exception 'Active living character not found';end if;
 if v_char.location_ref is null then raise exception 'Set a starting location first';end if;
 if v_char.movement_status<>'stationary' then raise exception 'Character is already traveling';end if;

 v_depart:=private.world_total_hours_at(now());
 v_plan:=private.plan_civilian_hex_route(v_char.location_ref,p_to_ref,v_user,v_depart,true);

 insert into public.character_travel(
   character_id,user_id,from_ref,to_ref,distance,depart_world_hour,
   arrive_world_hour,status,route_waypoints,route_step_index
 ) values (
   p_character_id,v_user,v_char.location_ref,p_to_ref,
   (v_plan->>'distance')::integer,v_depart,
   (v_plan->>'arrive_world_hour')::numeric,'traveling',
   v_plan->'route',0
 ) returning id into v_travel_id;

 if (v_plan->>'piracy_incident')::boolean then
   insert into public.civilian_travel_incidents(
     travel_id,user_id,location_ref,incident_type,delay_world_hours
   ) values (
     v_travel_id,v_user,p_to_ref,'piracy_disruption',
     (v_plan->>'piracy_delay_hours')::numeric
   );
 end if;

 update public.characters set movement_status='traveling',updated_at=now()
 where id=p_character_id;

 return v_plan||jsonb_build_object('travel_id',v_travel_id);
end $$;

-- Heartbeat progresses as many hexes as elapsed time allows. The character
-- stays "traveling" until the final waypoint; physical position is updated
-- at each actual intermediate arrival. Legacy in-flight rows use the old path.
create or replace function private.process_due_movements_and_operations()
returns jsonb language plpgsql security definer set search_path='' as $$
declare
 v_now numeric:=private.world_total_hours_at(now());
 rec record;
 v_steps integer;
 v_idx integer;
 v_current text;
 v_arrival numeric;
 char_count integer:=0;
 hex_count integer:=0;
 army_count integer:=0;
 op_count integer:=0;
begin
 for rec in
  select * from public.character_travel
  where status='traveling'
    and (arrive_world_hour<=v_now or jsonb_array_length(route_waypoints)>1)
  for update
 loop
  v_steps:=jsonb_array_length(rec.route_waypoints);
  if v_steps<2 then
   -- Backward compatibility for trips started before this migration.
   if rec.arrive_world_hour>v_now then continue;end if;
   update public.characters
    set location_ref=rec.to_ref,
      location_name=coalesce((select display_name from public.map_hexes where location_ref=rec.to_ref),rec.to_ref),
      movement_status='stationary',updated_at=now()
    where id=rec.character_id and life_status='alive';
   update public.character_travel set status='completed',completed_at=now()
    where id=rec.id;
   char_count:=char_count+1;
   continue;
  end if;

  v_idx:=rec.route_step_index;
  while v_idx<v_steps-1 loop
   v_arrival:=(rec.route_waypoints->(v_idx+1)->>'arrival_world_hour')::numeric;
   exit when v_arrival is null or v_arrival>v_now;
   v_idx:=v_idx+1;
  end loop;
  if v_idx=rec.route_step_index then continue;end if;
  v_current:=rec.route_waypoints->v_idx->>'ref';
  update public.characters set location_ref=v_current,
    location_name=coalesce((select display_name from public.map_hexes where location_ref=v_current),v_current),
    movement_status=case when v_idx=v_steps-1 then 'stationary' else 'traveling' end,
    updated_at=now()
   where id=rec.character_id and life_status='alive';
  update public.character_travel
   set route_step_index=v_idx,
       status=case when v_idx=v_steps-1 then 'completed' else 'traveling' end,
       completed_at=case when v_idx=v_steps-1 then now() else completed_at end
   where id=rec.id;
  hex_count:=hex_count+(v_idx-rec.route_step_index);
  if v_idx=v_steps-1 then char_count:=char_count+1;end if;
 end loop;

 for rec in
  select * from public.army_movements
  where status='moving' and arrive_world_hour<=v_now for update
 loop
  update public.armies set location_ref=rec.to_ref,
    movement_status='stationary',updated_at=now()
  where id=rec.army_id and status='active';
  update public.army_movements
  set status='completed',completed_at=now()
  where id=rec.id;
  army_count:=army_count+1;
 end loop;

 update public.military_operations
 set status='awaiting_resolution'
 where status='active' and resolve_world_hour<=v_now;
 get diagnostics op_count=row_count;
 return jsonb_build_object(
  'world_hour',v_now,'character_arrivals',char_count,
  'character_hexes_crossed',hex_count,'army_arrivals',army_count,
  'operations_ready',op_count
 );
end $$;
revoke all on function private.process_due_movements_and_operations() from public,anon,authenticated;
