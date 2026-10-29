
-- Unpaid supply/upkeep constrains deployment; existing forces without assessed upkeep unaffected.
do $patch$
declare body text; guard text;
begin
 guard:=$guard$
  if exists(select 1 from public.military_upkeep_log u
     where u.army_id=v_army.id and u.status='unpaid'
       and u.world_day>=floor(private.world_total_hours_at(now())/36)::bigint-1)
  then raise exception 'Army deployment blocked by unpaid military upkeep';end if;
 $guard$;
 body:=pg_get_functiondef('private.order_army_movement(uuid,text)'::regprocedure);
 if position('if v_army.location_ref is null then' in body)=0 then raise exception 'Army movement signature changed';end if;
 body:=replace(body,'if v_army.location_ref is null then',guard||'
  if v_army.location_ref is null then');
 if position('Army already has an active operation' in body)=0 then
   body:=replace(body,'if v_army.location_ref is null then',
    'if exists(select 1 from public.military_operations o where o.army_id=v_army.id and o.status in (''active'',''awaiting_resolution'')) then
    raise exception ''Army is engaged in an active operation'';end if;
    if v_army.location_ref is null then');
 end if;
 execute body;
 body:=pg_get_functiondef('private.launch_military_operation(uuid,text,text)'::regprocedure);
 if position('if v_army.movement_status' in body)=0 then raise exception 'Military operation signature changed';end if;
 body:=replace(body,'if v_army.movement_status',guard||'
  if v_army.movement_status');
 execute body;
 body:=pg_get_functiondef('private.move_fleet(uuid,text)'::regprocedure);
 if position('if not exists(select 1 from public.ships' in body)=0 then raise exception 'Fleet movement signature changed';end if;
 body:=replace(body,'if not exists(select 1 from public.ships',
 'if exists(select 1 from public.fleet_upkeep_log u where u.fleet_id=f.id
     and u.status=''unpaid'' and u.world_day>=floor(private.world_total_hours_at(now())/36)::bigint-1)
   then raise exception ''Fleet deployment blocked by unpaid upkeep'';end if;
 if not exists(select 1 from public.ships');
 execute body;
end;$patch$;
