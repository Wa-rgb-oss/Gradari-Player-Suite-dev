
do $patch$
declare body text;
begin
 body:=pg_get_functiondef('private.assign_ship_to_fleet(uuid,uuid)'::regprocedure);
 if position('if v_ship.carrier_ship_id is not null' in body)=0 then raise exception 'Fleet assignment location changed';end if;
 body:=replace(body,'if v_ship.carrier_ship_id is not null',
 'if v_ship.owner_user_id is not null then raise exception ''Civilian vessels cannot be militarized by faction assignment'';end if;
  if v_ship.carrier_ship_id is not null');
 execute body;
 body:=pg_get_functiondef('private.launch_naval_engagement(uuid,uuid)'::regprocedure);
 if position('s.status=''active'' and s.strength>0' in body)=0 then raise exception 'Naval launch changed';end if;
 body:=replace(body,'s.status=''active'' and s.strength>0','s.status=''active'' and s.strength>0 and s.owner_user_id is null');
 execute body;
 body:=pg_get_functiondef('private.resolve_due_naval_battles()'::regprocedure);
 if position('where faction_id=op.defender_faction_id' in body)=0 then raise exception 'Naval combat changed';end if;
 body:=replace(body,'where faction_id=op.defender_faction_id','where faction_id=op.defender_faction_id and owner_user_id is null');
 execute body;
 body:=pg_get_functiondef('private.transfer_ship_cargo(uuid,text,numeric,boolean)'::regprocedure);
 if position('if ship.fleet_id is not null' in body)=0 then raise exception 'Cargo transfer changed';end if;
 body:=replace(body,'if ship.fleet_id is not null',
 'if ship.owner_user_id is not null then raise exception ''Civilian cargo must use personal inventory transactions'';end if;
 if ship.fleet_id is not null');
 execute body;
end;$patch$;
