
-- Keep embarked strike craft together with carrier during a fleet arrival.
do $patch$
declare source text;
begin
 source := pg_get_functiondef('private.process_fleet_world()'::regprocedure);
 if position('update public.fleet_movements set status=' in source)=0 then raise exception 'Fleet processor changed'; end if;
 source := replace(source,
   'update public.fleet_movements set status=',
   'update public.ships craft set location_ref=rec.to_ref,updated_at=now()
    from public.ships host where craft.carrier_ship_id=host.id
      and host.fleet_id=rec.fleet_id and craft.status=''active'';
    update public.fleet_movements set status=');
 execute source;

 source := pg_get_functiondef('private.assign_ship_to_fleet(uuid,uuid)'::regprocedure);
 if position('if v_ship.fleet_id is not null' in source)=0 then raise exception 'Fleet assignment changed';end if;
 source := replace(source,'if v_ship.fleet_id is not null',
   'if v_ship.carrier_ship_id is not null then raise exception ''Embarked strike craft cannot join a fleet independently'';end if;
    if v_ship.fleet_id is not null');
 execute source;
end;$patch$;
