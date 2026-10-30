
create table if not exists public.faction_recon_reports(
 id uuid primary key default gen_random_uuid(),
 faction_id uuid not null references public.factions(id),
 scout_ship_id uuid not null references public.ships(id),
 origin_ref text not null,target_ref text not null,
 enemy_factions integer not null default 0,
 hostile_ships integer not null default 0,
 hostile_strength numeric not null default 0,
 scan_world_hour numeric not null,
 created_at timestamptz not null default now()
);
create index if not exists faction_recon_report_idx on public.faction_recon_reports(faction_id,created_at desc);
alter table public.faction_recon_reports enable row level security;
revoke all on public.faction_recon_reports from public,anon,authenticated;
grant select on public.faction_recon_reports to authenticated;
create policy "Authorized faction members view recon reports" on public.faction_recon_reports
for select to authenticated using (
  exists(select 1 from public.faction_memberships m where m.user_id=(select auth.uid()) and m.faction_id=faction_recon_reports.faction_id and m.status='active')
  or exists(select 1 from public.factions f where f.id=faction_recon_reports.faction_id and f.leader_user_id=(select auth.uid()))
  or (select private.is_admin())
);
create or replace function private.scan_with_recon(p_ship uuid,p_target text)
returns jsonb language plpgsql security definer set search_path='' as $fn$
declare s public.ships%rowtype; distance integer;count_ships integer;count_factions integer;total_strength numeric;report_id uuid;
begin
 select * into s from public.ships where id=p_ship and status='active' for update;
 if not found or not private.has_faction_permission(s.faction_id,'military') then raise exception 'Military authority required';end if;
 if not exists(select 1 from public.ship_blueprints b where b.id=s.blueprint_id and b.special_role='reconnaissance')
 then raise exception 'Reconnaissance vessel required';end if;
 if s.fleet_id is not null and exists(select 1 from public.fleets where id=s.fleet_id and movement_status='moving')
 then raise exception 'Cannot scan while moving';end if;
 if not exists(select 1 from public.map_hexes where location_ref=p_target and player_visible=true)
 then raise exception 'Unknown map destination';end if;
 distance:=private.hex_distance(s.location_ref,p_target);
 if distance>3 then raise exception 'Target outside sensor range (3 hexes)';end if;
 select count(*),count(distinct faction_id),coalesce(sum(strength),0) into count_ships,count_factions,total_strength
 from public.ships where status='active' and faction_id<>s.faction_id and location_ref=p_target;
 insert into public.faction_recon_reports(faction_id,scout_ship_id,origin_ref,target_ref,enemy_factions,hostile_ships,hostile_strength,scan_world_hour)
 values(s.faction_id,s.id,s.location_ref,p_target,count_factions,count_ships,total_strength,
 private.world_total_hours_at(now())) returning id into report_id;
 return jsonb_build_object('report_id',report_id,'target_ref',p_target,'hostile_ships',count_ships,
 'hostile_factions',count_factions,'hostile_strength',total_strength);
end;$fn$;
create or replace function public.scan_with_recon(p_ship uuid,p_target text) returns jsonb
language sql security definer set search_path='' as $fn$ select private.scan_with_recon($1,$2);$fn$;
revoke all on function public.scan_with_recon(uuid,text) from public,anon;
grant execute on function public.scan_with_recon(uuid,text) to authenticated;

-- Logistics tender supplies actual resident system stockpiles. Existing army supply heartbeat consumes these same resources.
create or replace function private.resupply_system_from_tender(p_ship uuid,p_resource text,p_quantity numeric)
returns jsonb language plpgsql security definer set search_path='' as $fn$
declare s public.ships%rowtype; onboard numeric;current_stock numeric;
begin
 if p_resource not in ('food','energy') then raise exception 'Supply requires food or energy';end if;
 if p_quantity is null or p_quantity<=0 or p_quantity>100000 then raise exception 'Invalid supply quantity';end if;
 select * into s from public.ships where id=p_ship and status='active' for update;
 if not found or not private.has_faction_permission(s.faction_id,'military') then raise exception 'Military authority required';end if;
 if not exists(select 1 from public.ship_blueprints where id=s.blueprint_id and special_role='resupply')
 then raise exception 'Logistics tender required';end if;
 if s.fleet_id is not null and exists(select 1 from public.fleets where id=s.fleet_id and movement_status='moving')
 then raise exception 'Cannot resupply while moving';end if;
 if not exists(select 1 from public.territories where location_ref=s.location_ref and faction_id=s.faction_id)
 then raise exception 'Resupply requires a friendly governed system';end if;
 onboard:=coalesce((s.cargo_manifest->>p_resource)::numeric,0);
 if onboard<p_quantity then raise exception 'Insufficient onboard supplies';end if;
 perform 1 from public.system_economies where location_ref=s.location_ref for update;
 if not found then raise exception 'Developed system stockpile required';end if;
 update public.system_economies
 set food=food+case when p_resource='food' then p_quantity else 0 end,
 energy=energy+case when p_resource='energy' then p_quantity else 0 end,updated_at=now()
 where location_ref=s.location_ref;
 update public.ships set cargo_manifest=jsonb_set(cargo_manifest,array[p_resource],to_jsonb(onboard-p_quantity)),
 updated_at=now() where id=s.id;
 return jsonb_build_object('location_ref',s.location_ref,'resource',p_resource,'quantity_delivered',p_quantity);
end;$fn$;
create or replace function public.resupply_system_from_tender(p_ship uuid,p_resource text,p_quantity numeric) returns jsonb
language sql security definer set search_path='' as $fn$ select private.resupply_system_from_tender($1,$2,$3);$fn$;
revoke all on function public.resupply_system_from_tender(uuid,text,numeric) from public,anon;
grant execute on function public.resupply_system_from_tender(uuid,text,numeric) to authenticated;
