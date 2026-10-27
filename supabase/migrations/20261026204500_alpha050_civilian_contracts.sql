-- Alpha 0.5.0 / Phase 1: civilian contracts, first server-authoritative slice.
-- This migration is intentionally NOT wired into the live simulation clock yet.
-- Apply only to the GRADARI Supabase project after reviewing its live schema.

create table if not exists public.civilian_contracts (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  title text not null check (length(trim(title)) between 3 and 160),
  description text not null default '',
  career_path text not null check (career_path in ('economic','political','exploration')),
  status text not null default 'draft' check (status in ('draft','active','closed')),
  difficulty integer not null default 1 check (difficulty between 1 and 5),
  min_party_size integer not null default 1 check (min_party_size between 1 and 3),
  max_party_size integer not null default 3 check (max_party_size between 1 and 3),
  reward_aureum numeric(20,2) not null default 0 check (reward_aureum >= 0),
  reward_reputation integer not null default 0 check (reward_reputation >= 0),
  reward_research_points integer not null default 0 check (reward_research_points >= 0),
  location_ref text,
  available_at timestamptz,
  accept_before timestamptz,
  duration_game_hours integer check (duration_game_hours is null or duration_game_hours > 0),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint civilian_contract_party_bounds check (min_party_size <= max_party_size),
  constraint civilian_contract_availability_bounds check (available_at is null or accept_before is null or available_at < accept_before)
);

create table if not exists public.civilian_assignments (
  id uuid primary key default gen_random_uuid(),
  contract_id uuid not null references public.civilian_contracts(id) on delete restrict,
  user_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'accepted' check (status in ('accepted','in_progress','completed','failed','cancelled')),
  accepted_at timestamptz not null default now(),
  completed_at timestamptz,
  -- Future integration: server-calculated canonical world-clock due time and party membership.
  due_world_hour bigint,
  result jsonb not null default '{}'::jsonb
);

create unique index if not exists civilian_assignments_one_active_per_player
  on public.civilian_assignments(user_id,contract_id)
  where status in ('accepted','in_progress');
create index if not exists civilian_assignments_player_recent
  on public.civilian_assignments(user_id,accepted_at desc);

alter table public.civilian_contracts enable row level security;
alter table public.civilian_assignments enable row level security;

revoke all on public.civilian_contracts from anon,authenticated;
revoke all on public.civilian_assignments from anon,authenticated;
grant select,insert,update,delete on public.civilian_contracts to authenticated;
grant select on public.civilian_assignments to authenticated;

drop policy if exists "Players view available civilian contracts" on public.civilian_contracts;
create policy "Players view available civilian contracts"
on public.civilian_contracts for select to authenticated
using (
  (status = 'active'
   and (available_at is null or available_at <= now())
   and (accept_before is null or accept_before > now()))
  or (select private.is_admin())
);

drop policy if exists "Admin manages civilian contracts" on public.civilian_contracts;
create policy "Admin manages civilian contracts"
on public.civilian_contracts for all to authenticated
using ((select private.is_admin()))
with check ((select private.is_admin()));

drop policy if exists "Players view own civilian assignments" on public.civilian_assignments;
create policy "Players view own civilian assignments"
on public.civilian_assignments for select to authenticated
using (user_id = (select auth.uid()) or (select private.is_admin()));

-- A limited acceptance RPC: no direct assignment writes and no unearned reward payouts.
-- Cooperative acceptance and canonical in-game deadlines are implemented in later slices.
create or replace function public.accept_civilian_contract(p_contract_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_contract public.civilian_contracts%rowtype;
  v_assignment uuid;
begin
  if v_user is null then raise exception 'Authentication required'; end if;
  select * into v_contract
  from public.civilian_contracts
  where id = p_contract_id
  for share;
  if not found then raise exception 'Contract not found'; end if;
  if v_contract.status <> 'active'
     or (v_contract.available_at is not null and v_contract.available_at > now())
     or (v_contract.accept_before is not null and v_contract.accept_before <= now())
  then raise exception 'Contract is no longer available'; end if;
  if v_contract.min_party_size > 1 then
    raise exception 'This contract requires a party and is not yet available for solo acceptance';
  end if;
  if exists (
    select 1 from public.civilian_assignments a
    where a.user_id = v_user and a.contract_id = p_contract_id
      and a.status in ('accepted','in_progress')
  ) then raise exception 'You already have an active assignment for this contract'; end if;

  insert into public.civilian_assignments(contract_id,user_id)
  values (p_contract_id,v_user)
  returning id into v_assignment;
  return v_assignment;
end
$$;

revoke all on function public.accept_civilian_contract(uuid) from public,anon;
grant execute on function public.accept_civilian_contract(uuid) to authenticated;

comment on table public.civilian_contracts is
  'Alpha 0.5.0 Phase 1: admin-authored civilian contract templates. Party acceptance, world-time expiry and completion payouts are forthcoming.';
comment on table public.civilian_assignments is
  'Server-controlled civilian contract acceptances; no direct authenticated write grants.';
