
-- Embarked formations do not defend a planet or consume its ground supply.
do $patch$
declare body text;
begin
 body:=pg_get_functiondef('private.resolve_due_battles()'::regprocedure);
 if position('movement_status=''stationary''' in body)=0 then raise exception 'Ground battle resolver changed';end if;
 body:=replace(body,'movement_status=''stationary''',
   'movement_status=''stationary'' and transport_ship_id is null');
 execute body;
 body:=pg_get_functiondef('private.process_army_supply_day(bigint)'::regprocedure);
 if position('a.location_ref is not null' in body)=0 then raise exception 'Supply source changed';end if;
 body:=replace(body,'a.location_ref is not null','a.location_ref is not null and a.transport_ship_id is null');
 execute body;
end;$patch$;
