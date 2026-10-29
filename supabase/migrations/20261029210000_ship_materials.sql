
-- Ship construction consumes actual faction materials as specified by each blueprint.
update public.ship_blueprints
set resource_costs=case code
 when 'patrol_corvette' then '{"aetherite":5}'::jsonb
 when 'line_frigate' then '{"aetherite":15}'::jsonb
 when 'heavy_cruiser' then '{"aetherite":30}'::jsonb
 else resource_costs end
where code in ('patrol_corvette','line_frigate','heavy_cruiser')
and resource_costs='{}'::jsonb;

do $patch$
declare body text;
begin
 body:=pg_get_functiondef('private.queue_faction_ship(uuid,uuid,text)'::regprocedure);
 if position('update public.factions set treasury=treasury-c' in body)=0 then raise exception 'Shipyard queue body changed';end if;
 body:=replace(body,'update public.factions set treasury=treasury-c',
 $frag$-- Atomic resource debit for required materials, after locking all required stockpile rows.
 if exists (
  select 1 from jsonb_each_text(b.resource_costs) rc
  left join public.faction_resources fr on fr.faction_id=f.id and fr.resource_code=rc.key
  where coalesce(fr.quantity,0)<(rc.value)::numeric
 ) then raise exception 'Insufficient shipbuilding resources in faction stockpile';end if;
 perform 1 from public.faction_resources fr
   where fr.faction_id=f.id and fr.resource_code in (select key from jsonb_each_text(b.resource_costs))
   order by fr.resource_code for update;
 if exists (
  select 1 from jsonb_each_text(b.resource_costs) rc
  left join public.faction_resources fr on fr.faction_id=f.id and fr.resource_code=rc.key
  where coalesce(fr.quantity,0)<(rc.value)::numeric
 ) then raise exception 'Insufficient shipbuilding resources in faction stockpile';end if;
 update public.faction_resources fr set quantity=fr.quantity-(rc.value)::numeric,updated_at=now()
 from jsonb_each_text(b.resource_costs) rc
 where fr.faction_id=f.id and fr.resource_code=rc.key;
 update public.factions set treasury=treasury-c$frag$);
 execute body;
end;$patch$;
