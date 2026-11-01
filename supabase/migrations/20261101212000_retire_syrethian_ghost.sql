-- Retire obsolete Syrethian developed-system marker without touching the 7 existing
-- player facilities, stored resources, contracts, or historical economy records.
update public.map_hexes
set display_name=null,region_name=null,habitable_systems=0,updated_at=now()
where location_ref='HEX_-5_2' and display_name='SYRETHIAN INDUSTRIAL HOLDINGS'
and exists(select 1 from public.facilities where location_ref='HEX_-5_2')
and exists(select 1 from public.map_hexes where location_ref='HEX_-7_-3' and display_name='SYRETHIAN REACH');