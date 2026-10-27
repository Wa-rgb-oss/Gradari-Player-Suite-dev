-- Alpha 0.5.0 / Phase 1: add non-destructive population and hex-condition foundations.
-- IMPORTANT: the legacy run_industry_cycle() already changes population and manpower.
-- This file DOES NOT activate a second daily tick or reinterpret historical ship crews.
-- Deploy only to the GRADARI database, after reconciling current personnel and world-clock behavior.

alter table public.system_economies
  add column if not exists population_capacity bigint,
  add column if not exists energy numeric(20,4) not null default 0,
  add column if not exists military_population bigint not null default 0,
  add column if not exists last_civilian_world_day bigint;

alter table public.system_economies
  add constraint alpha050_population_capacity_nonnegative
    check (population_capacity is null or population_capacity >= 0),
  add constraint alpha050_energy_nonnegative check (energy >= 0),
  add constraint alpha050_military_population_nonnegative check (military_population >= 0);

comment on column public.system_economies.population is
  'Legacy population currently maintained by run_industry_cycle. Phase 2 must reconcile military personnel before redefining as available civilians.';
comment on column public.system_economies.military_population is
  'Reserved for personnel transferred from civilian population through auditable recruitment in Phase 2.';
comment on column public.system_economies.energy is
  'Local energy inventory for upcoming civilian consumption. Existing factory/faction energy flows are not yet connected.';

-- One row per configured hex; no arbitrary starting values are assigned during migration.
create table if not exists public.hex_conditions (
  location_ref text primary key,
  stability_percent numeric(5,2) check (stability_percent between 0 and 100),
  movement_difficulty integer check (movement_difficulty between 1 and 5),
  updated_at timestamptz not null default now()
);
alter table public.hex_conditions enable row level security;
revoke all on public.hex_conditions from anon,authenticated;
grant select,insert,update,delete on public.hex_conditions to authenticated;

drop policy if exists "Players read hex conditions" on public.hex_conditions;
create policy "Players read hex conditions"
  on public.hex_conditions for select to authenticated using (true);
drop policy if exists "Admins edit hex conditions" on public.hex_conditions;
create policy "Admins edit hex conditions"
  on public.hex_conditions for all to authenticated
  using ((select private.is_admin()))
  with check ((select private.is_admin()));

-- Audit-ready day ledger. Population updates will be written here by one atomic,
-- world-clock-aware processing function in a later implementation slice.
create table if not exists public.civilian_population_ledger (
  id uuid primary key default gen_random_uuid(),
  location_ref text not null references public.system_economies(location_ref) on delete restrict,
  world_day bigint not null,
  civilian_before bigint not null check (civilian_before >= 0),
  civilian_after bigint not null check (civilian_after >= 0),
  food_consumed numeric(20,4) not null default 0 check (food_consumed >= 0),
  energy_consumed numeric(20,4) not null default 0 check (energy_consumed >= 0),
  tax_revenue numeric(20,2) not null default 0 check (tax_revenue >= 0),
  created_at timestamptz not null default now(),
  unique(location_ref,world_day)
);
alter table public.civilian_population_ledger enable row level security;
revoke all on public.civilian_population_ledger from anon,authenticated;
grant select on public.civilian_population_ledger to authenticated;
drop policy if exists "Admins read civilian population ledger" on public.civilian_population_ledger;
create policy "Admins read civilian population ledger"
  on public.civilian_population_ledger for select to authenticated
  using ((select private.is_admin()));

-- Read-only balancing function: no mutation, no double ticks, no tax payout.
-- Rates are supplied explicitly because Alpha 0.5.0 balance values are not approved yet.
create or replace function public.preview_civilian_population_day(
  p_location_ref text,
  p_food_per_civilian numeric,
  p_energy_per_civilian numeric,
  p_growth_rate numeric,
  p_shortage_decline_rate numeric,
  p_tax_per_civilian numeric
) returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_population bigint;
  v_capacity bigint;
  v_food numeric;
  v_energy numeric;
  v_military bigint;
  v_stability numeric;
  v_food_need numeric;
  v_energy_need numeric;
  v_supplied boolean;
  v_next bigint;
  v_growth numeric;
begin
  if p_food_per_civilian is null or p_food_per_civilian < 0
     or p_energy_per_civilian is null or p_energy_per_civilian < 0
     or p_tax_per_civilian is null or p_tax_per_civilian < 0
     or p_growth_rate is null or p_growth_rate < 0 or p_growth_rate > 1
     or p_shortage_decline_rate is null or p_shortage_decline_rate < 0 or p_shortage_decline_rate > 1
  then raise exception 'Population preview requires valid nonnegative rates (growth and decline from 0 to 1)'; end if;

  select population,population_capacity,food,energy,military_population
    into v_population,v_capacity,v_food,v_energy,v_military
    from public.system_economies where location_ref=p_location_ref;
  if not found then raise exception 'Unknown system location'; end if;

  select stability_percent into v_stability
    from public.hex_conditions where location_ref=p_location_ref;
  if v_capacity is null or v_stability is null or v_capacity = 0 then
    return jsonb_build_object('status','unconfigured','location_ref',p_location_ref,
                              'population',v_population,'population_capacity',v_capacity);
  end if;

  v_food_need := v_population * p_food_per_civilian;
  v_energy_need := v_population * p_energy_per_civilian;
  v_supplied := coalesce(v_food,0) >= v_food_need
                and coalesce(v_energy,0) >= v_energy_need;

  if v_supplied then
    v_growth := v_population * p_growth_rate * (v_stability / 100)
                * greatest(0, (v_capacity - v_population)::numeric / v_capacity);
    v_next := case when v_population >= v_capacity then v_population
                   else least(v_capacity,v_population + floor(v_growth)::bigint) end;
  else
    v_next := greatest(0,v_population - ceil(v_population * p_shortage_decline_rate)::bigint);
  end if;

  return jsonb_build_object(
    'status','preview_only','location_ref',p_location_ref,
    'civilian_population_before',v_population,'civilian_population_after',v_next,
    'military_population_recorded',v_military,
    'population_capacity',v_capacity,'stability_percent',v_stability,
    'food_needed',v_food_need,'energy_needed',v_energy_need,
    'food_available',v_food,'energy_available',v_energy,
    'supplies_sufficient',v_supplied,
    'estimated_civilian_tax_revenue',v_population*p_tax_per_civilian);
end
$$;
revoke all on function public.preview_civilian_population_day(text,numeric,numeric,numeric,numeric,numeric)
  from public,anon;
grant execute on function public.preview_civilian_population_day(text,numeric,numeric,numeric,numeric,numeric)
  to authenticated;
