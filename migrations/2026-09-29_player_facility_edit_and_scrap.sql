-- Player-owned facility management.
create or replace function public.update_owned_facility(p_facility_id uuid,p_name text)
returns public.facilities language plpgsql security definer set search_path='' as $$
declare v_row public.facilities;
begin
  select * into v_row from public.facilities where id=p_facility_id and owner_user_id=auth.uid() for update;
  if not found then raise exception 'Facility not found or not owned by this player'; end if;
  if length(trim(coalesce(p_name,'')))>160 then raise exception 'Facility name is too long'; end if;
  update public.facilities set name=nullif(trim(coalesce(p_name,'')),''),updated_at=now()
  where id=p_facility_id returning * into v_row;
  return v_row;
end $$;

create or replace function public.scrap_owned_facility(p_facility_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_row public.facilities; v_active_orders integer;
begin
  select * into v_row from public.facilities where id=p_facility_id and owner_user_id=auth.uid() for update;
  if not found then raise exception 'Facility not found or not owned by this player'; end if;
  select count(*) into v_active_orders from public.shipyard_orders where shipyard_facility_id=p_facility_id and status in ('queued','building');
  if v_active_orders>0 then raise exception 'Complete or cancel active ship construction before scrapping this facility'; end if;
  delete from public.facilities where id=p_facility_id;
  return jsonb_build_object('scrapped',true,'facility_id',p_facility_id,'name',v_row.name);
end $$;
grant execute on function public.update_owned_facility(uuid,text) to authenticated;
grant execute on function public.scrap_owned_facility(uuid) to authenticated;
