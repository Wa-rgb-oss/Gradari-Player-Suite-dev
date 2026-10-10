-- Keep passive facility production on a stable cadence.
-- When processing runs after a scheduled tick, advance from the previous scheduled time
-- rather than resetting the next tick from the processing timestamp.

create or replace function public.process_passive_facility_production()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  f record;
  c record;
  ticks integer;
  tick_seconds numeric;
  next_interval interval;
  dep record;
  ln record;
  outcode text;
  qty numeric;
  fid uuid;
begin
  perform ensure_facility_production_clocks();

  for f in
    select x.*,ft.code typecode,ft.output_per_cycle
    from facilities x
    join facility_types ft on ft.id=x.facility_type_id
    where x.status='active'
      and ft.code in('MINE','AGRI_COMPLEX','REFINERY','RESEARCH_SITE')
  loop
    select * into c
    from facility_production_clocks
    where facility_id=f.id
    for update;

    if c.next_production_at>now() then
      continue;
    end if;

    if f.typecode='RESEARCH_SITE' then
      tick_seconds:=25920;
      next_interval:=interval '7 hours 12 minutes';
    else
      tick_seconds:=720;
      next_interval:=interval '12 minutes';
    end if;

    ticks:=greatest(
      1,
      floor(extract(epoch from(now()-c.next_production_at))/tick_seconds)::int+1
    );

    fid:=coalesce(f.owner_faction_id,f.controlling_faction_id);

    if f.typecode='AGRI_COMPLEX' then
      qty:=10*ticks*coalesce(f.production_modifier,1)*facility_health_multiplier(f.health);
      if f.owner_user_id is not null then
        perform private.apply_player_resource_delta(f.owner_user_id,'food',qty);
      elsif fid is not null then
        perform add_faction_resource(fid,'food',qty);
      end if;

    elsif f.typecode='MINE' then
      for dep in
        select resource_code,richness
        from map_resource_deposits
        where location_ref=f.location_ref
      loop
        qty:=10*dep.richness*ticks*coalesce(f.production_modifier,1)*facility_health_multiplier(f.health);
        if f.owner_user_id is not null then
          perform private.apply_player_resource_delta(f.owner_user_id,dep.resource_code,qty);
        elsif fid is not null then
          perform add_faction_resource(fid,dep.resource_code,qty);
        end if;
      end loop;

    elsif f.typecode='REFINERY' then
      for ln in
        select d.resource_code,d.richness
        from facility_connections fc
        join facilities ex on ex.id=fc.extractor_facility_id
        join map_resource_deposits d on d.location_ref=ex.location_ref
        where fc.refinery_facility_id=f.id
        limit 3
      loop
        outcode:=case ln.resource_code
          when 'gold_ore' then 'refined_gold'
          when 'vyr_ore' then 'vyrsteel'
          when 'aetherite' then 'refined_aetherite'
          else null
        end;
        if outcode is not null then
          qty:=8*ln.richness*ticks*coalesce(f.production_modifier,1)*facility_health_multiplier(f.health);
          if f.owner_user_id is not null then
            perform private.apply_player_resource_delta(f.owner_user_id,outcode,qty);
          elsif fid is not null then
            perform add_faction_resource(fid,outcode,qty);
          end if;
        end if;
      end loop;

    elsif f.typecode='RESEARCH_SITE' then
      if f.owner_user_id is not null then
        qty:=greatest(coalesce(nullif(f.output_per_cycle,0),36),0)
             * ticks
             * coalesce(f.production_modifier,1)
             * facility_health_multiplier(f.health);
        perform private.add_player_research_points(f.owner_user_id,qty);
      end if;
    end if;

    update facility_production_clocks
    set last_production_at=c.next_production_at + ((ticks-1) * next_interval),
        next_production_at=c.next_production_at + (ticks * next_interval),
        updated_at=now()
    where facility_id=f.id;
  end loop;

  return 1;
end
$function$;
