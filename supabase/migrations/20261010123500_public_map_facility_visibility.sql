-- Public-safe map facility visibility for authenticated players.
-- Exposes only identity/location/type-level data; private operating fields remain behind facilities RLS.

create or replace function public.map_visible_facilities()
returns table (
  id uuid,
  facility_type_id uuid,
  location_ref text,
  name text,
  level integer,
  status text,
  owner_kind text,
  ownership_scope text,
  owner_name text,
  faction_name text
)
language sql
stable
security definer
set search_path = ''
as $$
  with viewer as (
    select auth.uid() as uid
  ),
  viewer_factions as (
    select fm.faction_id
    from public.faction_memberships fm, viewer v
    where v.uid is not null
      and fm.user_id = v.uid
      and fm.status = 'active'
  )
  select
    f.id,
    f.facility_type_id,
    f.location_ref,
    f.name,
    f.level,
    f.status,
    case
      when f.owner_user_id is not null then 'player'
      when f.owner_faction_id is not null then 'faction'
      else 'system'
    end as owner_kind,
    case
      when f.owner_user_id = v.uid then 'self'
      when f.owner_user_id is not null
           and exists (
             select 1 from viewer_factions vf
             where vf.faction_id = f.controlling_faction_id
           ) then 'same_faction_player'
      when f.owner_user_id is not null then 'other_player'
      when f.owner_faction_id is not null
           and exists (
             select 1 from viewer_factions vf
             where vf.faction_id = f.owner_faction_id
           ) then 'own_faction'
      when f.owner_faction_id is not null then 'other_faction'
      else 'system'
    end as ownership_scope,
    case
      when f.owner_user_id is not null then coalesce(nullif(trim(pp.display_name),''),'UNNAMED PLAYER')
      when f.owner_faction_id is not null then coalesce(nullif(trim(ofac.name),''),'UNNAMED FACTION')
      else 'UNALIGNED'
    end as owner_name,
    coalesce(nullif(trim(cfac.name),''),nullif(trim(ofac.name),'')) as faction_name
  from public.facilities f
  cross join viewer v
  left join public.player_profiles pp on pp.user_id = f.owner_user_id
  left join public.factions ofac on ofac.id = f.owner_faction_id
  left join public.factions cfac on cfac.id = f.controlling_faction_id
  where v.uid is not null
    and f.location_ref is not null
    and f.status <> 'scrapped'
  order by
    case
      when f.owner_user_id = v.uid then 0
      when f.owner_faction_id is not null
           and exists (select 1 from viewer_factions vf where vf.faction_id=f.owner_faction_id) then 1
      when f.owner_user_id is not null
           and exists (select 1 from viewer_factions vf where vf.faction_id=f.controlling_faction_id) then 2
      when f.owner_user_id is not null then 3
      when f.owner_faction_id is not null then 4
      else 5
    end,
    f.location_ref,
    f.created_at;
$$;

revoke all on function public.map_visible_facilities() from public, anon;
grant execute on function public.map_visible_facilities() to authenticated;
