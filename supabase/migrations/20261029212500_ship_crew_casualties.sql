
-- Crew casualties from destroyed commissioned vessels.
alter table public.ships add column if not exists crew_origin_ref text references public.system_economies(location_ref);
alter table public.ships add column if not exists crew_loss_recorded boolean not null default false;
create or replace function private.account_destroyed_ship_crews()
returns integer language plpgsql security definer set search_path='' as $fn$
declare rec record; count_processed integer:=0;
begin
 for rec in select s.id,s.crew_origin_ref,b.manpower_cost
 from public.ships s join public.ship_blueprints b on b.id=s.blueprint_id
 where s.status='destroyed' and s.crew_loss_recorded=false
 order by s.id for update of s
 loop
  if rec.crew_origin_ref is not null and rec.manpower_cost>0 then
   update public.system_economies set military_population=greatest(0,military_population-rec.manpower_cost),
      updated_at=now() where location_ref=rec.crew_origin_ref;
  end if;
  update public.ships set crew_loss_recorded=true where id=rec.id;
  count_processed:=count_processed+1;
 end loop;
 return count_processed;
end;$fn$;
revoke all on function private.account_destroyed_ship_crews() from public,anon,authenticated;
do $patch$
declare body text;
begin
 body:=pg_get_functiondef('private.process_fleet_world()'::regprocedure);
 if position('insert into public.ships(faction_id,blueprint_id,name,location_ref,strength,max_strength,status)' in body)=0
 then raise exception 'Ship construction integration body changed';end if;
 body:=replace(body,'insert into public.ships(faction_id,blueprint_id,name,location_ref,strength,max_strength,status)',
 'insert into public.ships(faction_id,blueprint_id,name,location_ref,strength,max_strength,status,crew_origin_ref)');
 body:=replace(body,'from public.ship_blueprints b where b.id=rec.blueprint_id;',
 'from public.ship_blueprints b where b.id=rec.blueprint_id;');
 -- Match the ship commission SELECT, not other unrelated queries.
 if position('b.strength,b.strength,''active''' in body)=0 then raise exception 'Ship commissioning values changed';end if;
 body:=replace(body,'b.strength,b.strength,''active''',
  'b.strength,b.strength,''active'',rec.location_ref');
 execute body;
 body:=pg_get_functiondef('private.resolve_due_naval_battles()'::regprocedure);
 if position('count_done:=count_done+1;' in body)=0 then raise exception 'Naval resolution integration changed';end if;
 body:=replace(body,'count_done:=count_done+1;',
 'perform private.account_destroyed_ship_crews();
  count_done:=count_done+1;');
 execute body;
end;$patch$;
