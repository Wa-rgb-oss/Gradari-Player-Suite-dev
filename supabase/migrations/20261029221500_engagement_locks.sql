
do $patch$
declare body text; guard text;
begin
 guard:=$guard$
 if exists(select 1 from public.naval_operations no
   where no.attacking_fleet_id=f.id and no.status='active')
 then raise exception 'Fleet has an unresolved naval engagement';end if;
 $guard$;
 body:=pg_get_functiondef('private.move_fleet(uuid,text)'::regprocedure);
 if position('if not exists(select 1 from public.ships' in body)=0 then raise exception 'Fleet movement integration point changed';end if;
 body:=replace(body,'if not exists(select 1 from public.ships',guard||'
 if not exists(select 1 from public.ships');
 execute body;
 body:=pg_get_functiondef('private.assign_ship_to_fleet(uuid,uuid)'::regprocedure);
 if position('select * into v_ship from public.ships' in body)=0 then raise exception 'Ship assignment integration point changed';end if;
 body:=replace(body,'select * into v_ship from public.ships',
 $frag$if exists(select 1 from public.naval_operations no
  where no.attacking_fleet_id=v_fleet.id and no.status='active') then
    raise exception 'Cannot reassign ships while fleet is engaged';end if;
  select * into v_ship from public.ships$frag$);
 execute body;
end;$patch$;
