-- Alpha 0.5.0: temporary civilian parties of up to three players.
create table if not exists public.civilian_parties (
 id uuid primary key default gen_random_uuid(),
 leader_user_id uuid not null references auth.users(id),
 status text not null default 'active' check(status in ('active','disbanded')),
 created_at timestamptz not null default now()
);
create table if not exists public.civilian_party_members (
 party_id uuid not null references public.civilian_parties(id) on delete cascade,
 user_id uuid not null references auth.users(id) on delete cascade,
 joined_at timestamptz not null default now(),
 departed_at timestamptz,
 primary key(party_id,user_id)
);
create unique index if not exists one_active_civilian_party_per_user on public.civilian_party_members(user_id) where departed_at is null;
create table if not exists public.civilian_party_invites (
 id uuid primary key default gen_random_uuid(),
 party_id uuid not null references public.civilian_parties(id) on delete cascade,
 invited_user_id uuid not null references auth.users(id) on delete cascade,
 sender_user_id uuid not null references auth.users(id) on delete cascade,
 status text not null default 'pending' check(status in ('pending','accepted','declined','revoked')),
 created_at timestamptz not null default now(),
 expires_at timestamptz not null default (now()+interval '1 day')
);
create unique index if not exists one_pending_civilian_party_invite on public.civilian_party_invites(party_id,invited_user_id) where status='pending';
alter table public.civilian_parties enable row level security;
alter table public.civilian_party_members enable row level security;
alter table public.civilian_party_invites enable row level security;
revoke all on public.civilian_parties, public.civilian_party_members, public.civilian_party_invites from anon,authenticated;
grant select on public.civilian_parties,public.civilian_party_members,public.civilian_party_invites to authenticated;
create or replace function private.civilian_party_visible(p_party_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.civilian_party_members m where m.party_id=p_party_id and m.user_id=(select auth.uid()) and m.departed_at is null)
 or exists(select 1 from public.civilian_party_invites i where i.party_id=p_party_id and i.invited_user_id=(select auth.uid()) and i.status='pending')
 or (select private.is_admin());
$$;
drop policy if exists "Party participants read parties" on public.civilian_parties;
create policy "Party participants read parties" on public.civilian_parties for select to authenticated using (private.civilian_party_visible(id));
drop policy if exists "Party participants read roster" on public.civilian_party_members;
create policy "Party participants read roster" on public.civilian_party_members for select to authenticated using (private.civilian_party_visible(party_id));
drop policy if exists "Invited players see invites" on public.civilian_party_invites;
create policy "Invited players see invites" on public.civilian_party_invites for select to authenticated using (invited_user_id=(select auth.uid()) or sender_user_id=(select auth.uid()) or private.civilian_party_visible(party_id));

create or replace function public.create_civilian_party()
returns uuid language plpgsql security definer set search_path='' as $$
declare v_user uuid:=(select auth.uid()); v_party uuid;
begin
 if v_user is null then raise exception 'Sign in to create a party'; end if;
 perform pg_advisory_xact_lock(hashtext('civilian-party'),hashtext(v_user::text));
 if exists(select 1 from public.civilian_party_members where user_id=v_user and departed_at is null) then raise exception 'Leave your current party first'; end if;
 insert into public.civilian_parties(leader_user_id) values(v_user) returning id into v_party;
 insert into public.civilian_party_members(party_id,user_id) values(v_party,v_user);
 return v_party;
end $$;

create or replace function public.invite_civilian_party(p_party_id uuid,p_user_id uuid)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_user uuid:=(select auth.uid());v_invite uuid;
begin
 if p_user_id is null or p_user_id=v_user then raise exception 'Choose another player'; end if;
 perform 1 from public.civilian_parties where id=p_party_id and leader_user_id=v_user and status='active' for update;
 if not found then raise exception 'Only the party leader can invite'; end if;
 if (select count(*) from public.civilian_party_members where party_id=p_party_id and departed_at is null)>=3 then raise exception 'Party is full';end if;
 if not exists(select 1 from public.friendships where (user_a=v_user and user_b=p_user_id) or (user_b=v_user and user_a=p_user_id)) then raise exception 'Invitations require friendship';end if;
 if exists(select 1 from public.civilian_party_members where user_id=p_user_id and departed_at is null) then raise exception 'Player already belongs to a party';end if;
 update public.civilian_party_invites set status='revoked' where party_id=p_party_id and invited_user_id=p_user_id and status='pending' and expires_at<=now();
 insert into public.civilian_party_invites(party_id,invited_user_id,sender_user_id) values(p_party_id,p_user_id,v_user) returning id into v_invite;
 return v_invite;
end $$;

create or replace function public.respond_civilian_party_invite(p_invite_id uuid,p_accept boolean)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_user uuid:=(select auth.uid());v_inv public.civilian_party_invites%rowtype;v_party public.civilian_parties%rowtype;
begin
 select * into v_inv from public.civilian_party_invites where id=p_invite_id and invited_user_id=v_user for update;
 if not found or v_inv.status<>'pending' or v_inv.expires_at<=now() then raise exception 'Invitation is not valid';end if;
 select * into v_party from public.civilian_parties where id=v_inv.party_id for update;
 if v_party.status<>'active' then raise exception 'Party disbanded';end if;
 if p_accept then
  perform pg_advisory_xact_lock(hashtext('civilian-party'),hashtext(v_user::text));
  if exists(select 1 from public.civilian_party_members where user_id=v_user and departed_at is null) then raise exception 'Leave your current party first';end if;
  if (select count(*) from public.civilian_party_members where party_id=v_inv.party_id and departed_at is null)>=3 then raise exception 'Party is full';end if;
  insert into public.civilian_party_members(party_id,user_id) values(v_inv.party_id,v_user)
   on conflict(party_id,user_id) do update set departed_at=null,joined_at=now();
 end if;
 update public.civilian_party_invites set status=case when p_accept then 'accepted' else 'declined' end where id=p_invite_id;
 return jsonb_build_object('party_id',v_inv.party_id,'accepted',p_accept);
end $$;

create or replace function public.leave_civilian_party(p_party_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_user uuid:=(select auth.uid());v_leader uuid;v_next uuid;
begin
 select leader_user_id into v_leader from public.civilian_parties where id=p_party_id and status='active' for update;
 if not found then raise exception 'Party unavailable';end if;
 update public.civilian_party_members set departed_at=now() where party_id=p_party_id and user_id=v_user and departed_at is null;
 if not found then raise exception 'You are not in this party';end if;
 if v_leader=v_user then
  select user_id into v_next from public.civilian_party_members where party_id=p_party_id and departed_at is null order by joined_at limit 1;
  if v_next is null then
   update public.civilian_parties set status='disbanded' where id=p_party_id;
   update public.civilian_party_invites set status='revoked' where party_id=p_party_id and status='pending';
  else
   update public.civilian_parties set leader_user_id=v_next where id=p_party_id;
  end if;
 end if;
 return jsonb_build_object('left',true,'party_id',p_party_id);
end $$;
revoke all on function private.civilian_party_visible(uuid) from public,anon;
grant execute on function private.civilian_party_visible(uuid) to authenticated;
revoke all on function public.create_civilian_party(),public.invite_civilian_party(uuid,uuid),public.respond_civilian_party_invite(uuid,boolean),public.leave_civilian_party(uuid) from public,anon;
grant execute on function public.create_civilian_party(),public.invite_civilian_party(uuid,uuid),public.respond_civilian_party_invite(uuid,boolean),public.leave_civilian_party(uuid) to authenticated;
