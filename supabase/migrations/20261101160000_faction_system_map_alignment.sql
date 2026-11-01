-- Faction-system alignment based on existing user-painted hex control, preserving all current holdings.
create table if not exists private.system_placement_audit(
  id bigint generated always as identity primary key,
  location_ref text not null,
  old_name text,
  new_name text,
  operation text not null,
  source_ref text,
  recorded_at timestamptz not null default now()
);
do $placement$
declare v record;current_name text;owned_code text;already_economy boolean;fac_count integer;source_name text;
begin
 -- Canonical existing Imperial system identities are relocated to the territories painted by the user.
 -- The separate original hex records, investments and historical logs are NOT moved or destroyed.
 for v in select * from (values
 ('HEX_-7_-3','AS','SYRETHIAN REACH','HEX_-5_2',true),
 ('HEX_-8_-3','AS','AURIS SOMNARIUM','HEX_0_1',true),
 ('HEX_0_-4','BF','NAEXUS ARC','HEX_-6_-2',true),
 ('HEX_2_-5','BF','LORAK''S CHAIN','HEX_0_-2',true),
 ('HEX_-7_3','VC','VARN''CATH EXPANSE','HEX_-4_-3',true),
 ('HEX_6_0','LC','ARCH-LUX NEXUS',null::text,false),
 ('HEX_8_0','LC','VIRE-LUX MATRIX',null::text,false),
 ('HEX_9_0','LC','TERA-LUX ASSEMBLY',null::text,false),
 ('HEX_8_-12','CC','SOLIS CROWN',null::text,false),
 ('HEX_10_-10','CC','RADIANT CITADEL',null::text,false),
 ('HEX_12_-11','CC','DAWNWARD SANCTUM',null::text,false)
 ) x(target,code,new_name,source_ref,is_canon)
 loop
  select h.display_name,f.code into current_name,owned_code
    from public.map_hexes h join public.territories t on t.location_ref=h.location_ref
    join public.factions f on f.id=t.faction_id where h.location_ref=v.target for update of h;
  if not found or owned_code<>v.code then raise exception 'Destination % is not held by expected faction %',v.target,v.code;end if;
  if current_name is not null and current_name<>v.new_name then raise exception 'Target % already contains %',v.target,current_name;end if;
  if exists(select 1 from public.system_economies where location_ref=v.target) then
   raise exception 'Destination % already has civilian economy',v.target;
  end if;
  select count(*) into fac_count from public.facilities where location_ref=v.target;
  if fac_count<>0 then raise exception 'Destination % contains player facilities',v.target;end if;
  if v.source_ref is not null then
   select display_name into source_name from public.map_hexes where location_ref=v.source_ref for update;
   if source_name is distinct from v.new_name then raise exception 'Canonical name % missing from its expected original hex %',v.new_name,v.source_ref;end if;
   -- Preserve the landmark for the player with established facilities; a historically recognizable label remains.
   update public.map_hexes set display_name=case when v.source_ref='HEX_-5_2' then
     'SYRETHIAN INDUSTRIAL HOLDINGS' else null end,
     updated_at=now() where location_ref=v.source_ref;
   insert into private.system_placement_audit(location_ref,old_name,new_name,operation,source_ref)
      values(v.source_ref,source_name,case when v.source_ref='HEX_-5_2' then 'SYRETHIAN INDUSTRIAL HOLDINGS' else null end,
       'source_landmark_retained',v.source_ref);
  end if;
  update public.map_hexes set display_name=v.new_name,region_name=
    (select name from public.factions where code=v.code),
    habitable_systems=greatest(1,habitable_systems),
    metadata=coalesce(metadata,'{}'::jsonb)||
      jsonb_build_object('system_origin',case when v.is_canon then 'canonical_relocation' else 'provisional_expansion' end,
        'placement_date','2026-11-01'),
    updated_at=now() where location_ref=v.target;
  insert into public.system_economies(location_ref,population,manpower,food,energy,
      development_tier,is_capital,development_level,population_capacity,military_population,last_civilian_world_day)
   values(v.target,case when v.is_canon then 12032 else 8000 end,0,2500,2500,'developed',false,1,30000,0,
          floor(private.world_total_hours_at(now())/36)::bigint);
  insert into private.system_placement_audit(location_ref,old_name,new_name,operation,source_ref)
      values(v.target,current_name,v.new_name,case when v.is_canon then 'canonical_system_relocated' else 'new_faction_system' end,v.source_ref);
 end loop;
end;$placement$;
