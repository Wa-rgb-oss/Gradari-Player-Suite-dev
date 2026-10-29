
do $patch$
declare body text;
begin
 body:=pg_get_functiondef('private.process_fleet_world()'::regprocedure);
 if position('for rec in select * from public.shipyard_orders' in body)=0
 then raise exception 'Shipyard heartbeat shape changed';end if;
 body:=replace(body,
 'for rec in select * from public.shipyard_orders',
 'update public.shipyard_orders
  set cycles_remaining=greatest(0,ceil((build_ready_world_hour-h)/36)::integer)
  where status=''building'' and build_ready_world_hour is not null;
  for rec in select * from public.shipyard_orders');
 execute body;
end;$patch$;
