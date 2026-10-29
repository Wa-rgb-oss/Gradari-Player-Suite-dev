
-- Embarked armies travel with fleets; repair tenders restore damaged allied hulls at material cost.
alter table public.armies add column if not exists transport_ship_id uuid references public.ships(id);
create index if not exists armies_transport_ship_idx on public.armies(transport_ship_id);
create or replace function private.manage_army_embarkation(p_army_id uuid,p_ship_id uuid,p_embark boolean)
returns jsonb language plpgsql security definer set search_path='' as $fn$
declare a public.armies%rowtype;s public.ships%rowtype;cap bigint;used numeric;
begin
 select * into a from public.armies where id=p_army_id and status='active' for update;
 if not found or not private.has_faction_permission(a.faction_id,'military') then raise exception 'Army command authority required';end if;
 select * into s from public.ships where id=p_ship_id and status='active' for update;
 if not found or s.faction_id<>a.faction_id then raise exception 'Allied active transport required';end if;
 if p_embark then
  if a.transport_ship_id is not null or a.movement_status<>'stationary' or a.location_ref<>s.location_ref then
   raise exception 'Army must be unembarked and stationed with the transport';end if;
  if s.fleet_id is null or not exists(select 1 from public.fleets where id=s.fleet_id and movement_status='stationary' and status='active') then
   raise exception 'Transport must be assigned to a stationary fleet';end if;
  select troops_capacity into cap from public.ship_blueprints where id=s.blueprint_id;
  select coalesce(sum(strength),0) into used from public.armies where transport_ship_id=s.id and status='active';
  if a.strength+used>cap then raise exception 'Insufficient troop capacity';end if;
  update public.armies set transport_ship_id=s.id,updated_at=now() where id=a.id;
 else
  if a.transport_ship_id is distinct from s.id then raise exception 'Army is not aboard this transport';end if;
  if s.fleet_id is not null and exists(select 1 from public.fleets where id=s.fleet_id and movement_status='moving') then
    raise exception 'Cannot disembark during fleet travel';end if;
  update public.armies set transport_ship_id=null,location_ref=s.location_ref,updated_at=now() where id=a.id;
 end if;
 return jsonb_build_object('army_id',a.id,'ship_id',s.id,'embarked',p_embark);
end;$fn$;
create or replace function public.manage_army_embarkation(p_army_id uuid,p_ship_id uuid,p_embark boolean)
returns jsonb language sql security definer set search_path='' as $fn$ select private.manage_army_embarkation($1,$2,$3);$fn$;
revoke all on function public.manage_army_embarkation(uuid,uuid,boolean) from public,anon;
grant execute on function public.manage_army_embarkation(uuid,uuid,boolean) to authenticated;
create or replace function private.repair_ship_with_tender(p_tender uuid,p_target uuid,p_repair numeric)
returns jsonb language plpgsql security definer set search_path='' as $fn$
declare tender public.ships%rowtype; target public.ships%rowtype;available numeric;cost numeric; repaired numeric;f uuid;
begin
 if p_repair is null or p_repair<=0 or p_repair>1000 then raise exception 'Repair points must be 1–1000';end if;
 select * into tender from public.ships where id=p_tender and status='active' for update;
 select * into target from public.ships where id=p_target and status='active' for update;
 if tender.id is null or target.id is null or tender.faction_id<>target.faction_id or tender.location_ref<>target.location_ref
 or not private.has_faction_permission(tender.faction_id,'military') then raise exception 'Allied colocated active vessels and command required';end if;
 if not exists(select 1 from public.ship_blueprints where id=tender.blueprint_id and special_role='repair') then
 raise exception 'A repair tender is required';end if;
 if tender.fleet_id is not null and exists(select 1 from public.fleets where id=tender.fleet_id and movement_status='moving') then raise exception 'Tender is moving';end if;
 repaired:=least(p_repair,greatest(0,target.max_strength-target.strength));
 if repaired<=0 then raise exception 'Target is already at full strength';end if;
 cost:=ceil(repaired/10);
 select quantity into available from public.faction_resources where faction_id=tender.faction_id and resource_code='ship_components' for update;
 if coalesce(available,0)<cost then raise exception 'Insufficient faction ship components';end if;
 update public.faction_resources set quantity=quantity-cost,updated_at=now() where faction_id=tender.faction_id and resource_code='ship_components';
 update public.ships set strength=strength+repaired,updated_at=now() where id=target.id;
 return jsonb_build_object('target_id',target.id,'strength_restored',repaired,'ship_components_used',cost);
end;$fn$;
create or replace function public.repair_ship_with_tender(p_tender uuid,p_target uuid,p_repair numeric)
returns jsonb language sql security definer set search_path='' as $fn$ select private.repair_ship_with_tender($1,$2,$3);$fn$;
revoke all on function public.repair_ship_with_tender(uuid,uuid,numeric) from public,anon;
grant execute on function public.repair_ship_with_tender(uuid,uuid,numeric) to authenticated;
do $patch$
declare body text;
begin
 body:=pg_get_functiondef('private.process_fleet_world()'::regprocedure);
 if position('update public.fleet_movements set status=' in body)=0 then raise exception 'Fleet processor changed';end if;
 body:=replace(body,'update public.fleet_movements set status=',
 'update public.armies a set location_ref=rec.to_ref,updated_at=now()
  from public.ships s where a.transport_ship_id=s.id and s.fleet_id=rec.fleet_id and a.status=''active'';
  update public.fleet_movements set status=');
 execute body;
 body:=pg_get_functiondef('private.order_army_movement(uuid,text)'::regprocedure);
 if position('if v_army.location_ref is null then' in body)=0 then raise exception 'Army move signature changed';end if;
 body:=replace(body,'if v_army.location_ref is null then',
 'if v_army.transport_ship_id is not null then raise exception ''Disembark before issuing ground movement orders'';end if;
 if v_army.location_ref is null then');
 execute body;
 body:=pg_get_functiondef('private.launch_military_operation(uuid,text,text)'::regprocedure);
 if position('if v_army.movement_status' in body)=0 then raise exception 'Ground combat signature changed';end if;
 body:=replace(body,'if v_army.movement_status',
 'if v_army.transport_ship_id is not null then raise exception ''Disembark before starting ground operations'';end if;
 if v_army.movement_status');
 execute body;
end;$patch$;
