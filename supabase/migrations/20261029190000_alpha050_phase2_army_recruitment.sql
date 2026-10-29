
-- Alpha 0.5.0 Phase 2A: recruitment and military accounting.
create table if not exists public.military_recruitment_log (
  id uuid primary key default gen_random_uuid(),
  faction_id uuid not null references public.factions(id),
  army_id uuid not null references public.armies(id),
  location_ref text not null references public.system_economies(location_ref),
  ordered_by uuid not null references auth.users(id),
  personnel integer not null check (personnel between 1 and 5000),
  aureum_cost numeric(18,2) not null check (aureum_cost >= 0),
  previous_civilian_population bigint not null,
  resulting_civilian_population bigint not null,
  created_at timestamptz not null default now()
);
create index if not exists military_recruitment_log_faction_at_idx
  on public.military_recruitment_log(faction_id, created_at desc);
create index if not exists military_recruitment_log_army_at_idx
  on public.military_recruitment_log(army_id, created_at desc);
alter table public.military_recruitment_log enable row level security;
revoke all on public.military_recruitment_log from anon, authenticated;
grant select on public.military_recruitment_log to authenticated;
drop policy if exists "Faction members see recruitment" on public.military_recruitment_log;
create policy "Faction members see recruitment" on public.military_recruitment_log
  for select to authenticated
  using (
    exists(select 1 from public.faction_memberships fm
       where fm.faction_id=military_recruitment_log.faction_id
       and fm.user_id=(select auth.uid()) and fm.status='active')
    or exists(select 1 from public.factions f
       where f.id=military_recruitment_log.faction_id
       and f.leader_user_id=(select auth.uid()))
    or (select private.is_admin())
  );
create or replace function private.recruit_faction_army(
  p_location_ref text,
  p_personnel integer,
  p_army_name text default null,
  p_reinforce_army_id uuid default null
) returns jsonb
language plpgsql security definer set search_path = ''
as $function$
declare
 v_uid uuid:=(select auth.uid());
 v_faction_id uuid;
 v_faction public.factions%rowtype;
 v_system public.system_economies%rowtype;
 v_army public.armies%rowtype;
 v_cost numeric;
 v_remaining bigint;
 v_limit bigint;
 v_army_id uuid;
begin
 if v_uid is null then raise exception 'Authentication required' using errcode='42501'; end if;
 if p_location_ref is null or p_location_ref !~ '^HEX_-?[0-9]{1,5}_-?[0-9]{1,5}$' then
   raise exception 'Invalid location' using errcode='22023';
 end if;
 if p_personnel is null or p_personnel < 10 or p_personnel > 5000 then
   raise exception 'Recruitment must be between 10 and 5000 personnel' using errcode='22023';
 end if;
 select faction_id into v_faction_id from public.territories
 where location_ref=p_location_ref;
 if v_faction_id is null then
   raise exception 'Only faction-controlled systems can recruit' using errcode='42501';
 end if;
 if not private.has_faction_permission(v_faction_id,'military') then
   raise exception 'Military faction authority required' using errcode='42501';
 end if;
 select * into v_faction from public.factions where id=v_faction_id and status='active' for update;
 if not found then raise exception 'Faction not available'; end if;
 select * into v_system from public.system_economies
 where location_ref=p_location_ref for update;
 if not found then raise exception 'Developed system required'; end if;
 -- Keep the civilian population viable; maximum military share 20% of residents.
 v_limit:=floor((v_system.population+v_system.military_population)*0.20)::bigint;
 if v_system.military_population+p_personnel>v_limit then
   raise exception 'Recruitment would exceed the 20 percent military population cap';
 end if;
 v_remaining:=v_system.population-p_personnel;
 if v_remaining<100 then raise exception 'At least 100 civilians must remain in the system'; end if;
 v_cost:=p_personnel*25;
 if coalesce(v_faction.treasury,0)<v_cost then raise exception 'Faction treasury lacks Aureum'; end if;
 if p_reinforce_army_id is not null then
   select * into v_army from public.armies where id=p_reinforce_army_id for update;
   if not found or v_army.faction_id<>v_faction_id or v_army.location_ref<>p_location_ref
      or v_army.status<>'active' or v_army.movement_status<>'stationary' then
     raise exception 'Army must be active, stationary, and owned by the recruiting faction at this system';
   end if;
   update public.armies
   set strength=least(max_strength+p_personnel,strength+p_personnel),
       max_strength=max_strength+p_personnel,updated_at=now()
   where id=v_army.id;
   v_army_id:=v_army.id;
 else
   if nullif(trim(coalesce(p_army_name,'')),'') is null or length(trim(p_army_name))>80 then
     raise exception 'New army name must be 1 to 80 characters long';
   end if;
   insert into public.armies(faction_id,name,strength,max_strength,location_ref,status,movement_status)
   values(v_faction_id,trim(p_army_name),p_personnel,p_personnel,p_location_ref,'active','stationary')
   returning id into v_army_id;
 end if;
 update public.system_economies set population=v_remaining,
     military_population=military_population+p_personnel,updated_at=now()
 where location_ref=p_location_ref;
 update public.factions set treasury=treasury-v_cost where id=v_faction_id;
 insert into public.military_recruitment_log(
 faction_id,army_id,location_ref,ordered_by,personnel,aureum_cost,
 previous_civilian_population,resulting_civilian_population)
 values(v_faction_id,v_army_id,p_location_ref,v_uid,p_personnel,v_cost,v_system.population,v_remaining);
 return jsonb_build_object('army_id',v_army_id,'faction_id',v_faction_id,
 'personnel',p_personnel,'cost',v_cost,'civilians_remaining',v_remaining,
 'military_population',v_system.military_population+p_personnel,
 'remaining_treasury',v_faction.treasury-v_cost);
end;
$function$;
revoke all on function private.recruit_faction_army(text,integer,text,uuid) from public,anon,authenticated;
create or replace function public.recruit_faction_army(
 p_location_ref text,
 p_personnel integer,
 p_army_name text default null,
 p_reinforce_army_id uuid default null
) returns jsonb
language sql security definer set search_path=''
as $function$
 select private.recruit_faction_army($1,$2,$3,$4);
$function$;
revoke all on function public.recruit_faction_army(text,integer,text,uuid) from public,anon;
grant execute on function public.recruit_faction_army(text,integer,text,uuid) to authenticated;
