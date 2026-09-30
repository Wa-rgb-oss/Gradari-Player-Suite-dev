-- Buildable industrial facility catalog.
-- Initial values are balance defaults and can be tuned later.

insert into public.facility_types(code,name,category,description,build_cost_aureum,upkeep_aureum_per_cycle,player_buildable)
select 'EXTRACTOR','Extractor','industry','Resource extraction complex.',250,8,true
where not exists(select 1 from public.facility_types where upper(coalesce(code,name,'')) in ('EXTRACTOR','MINE'));

insert into public.facility_types(code,name,category,description,build_cost_aureum,upkeep_aureum_per_cycle,player_buildable)
select 'AGRI_COMPLEX','Agri-Complex','industry','Agricultural production complex.',200,5,true
where not exists(select 1 from public.facility_types where upper(coalesce(code,name,'')) like '%AGRI%' or upper(coalesce(code,name,'')) like '%FARM%');

insert into public.facility_types(code,name,category,description,build_cost_aureum,upkeep_aureum_per_cycle,player_buildable)
select 'REFINERY','Refinery','industry','Industrial material refinery.',800,20,true
where not exists(select 1 from public.facility_types where upper(coalesce(code,name,'')) like '%REFIN%');

insert into public.facility_types(code,name,category,description,build_cost_aureum,upkeep_aureum_per_cycle,player_buildable)
select 'FACTORY','Factory','industry','Manufacturing complex.',1500,35,true
where not exists(select 1 from public.facility_types where upper(coalesce(code,name,'')) like '%FACTORY%');

insert into public.facility_types(code,name,category,description,build_cost_aureum,upkeep_aureum_per_cycle,player_buildable)
select 'SHIPYARD','Shipyard','industry','Orbital and planetary vessel construction infrastructure.',5000,90,true
where not exists(select 1 from public.facility_types where upper(coalesce(code,name,'')) like '%SHIP%');
