-- Phase 1: discovery sharing for eligible, co-located party members.
-- Useful indexes for contract assignment, discovery, party and travel queries.
create index if not exists civilian_assignments_contract_idx on public.civilian_assignments(contract_id);
create index if not exists civilian_assignments_party_idx on public.civilian_assignments(party_id);
create index if not exists civilian_assignments_deadline_idx on public.civilian_assignments(due_world_hour) where status in ('accepted','in_progress');
create index if not exists civilian_contract_supplies_contract_idx on public.civilian_contract_supplies(contract_id);
create index if not exists civilian_contract_supplies_resource_idx on public.civilian_contract_supplies(resource_code);
create index if not exists civilian_contract_supplies_user_idx on public.civilian_contract_supplies(user_id);
create index if not exists civilian_contracts_created_by_idx on public.civilian_contracts(created_by);
create index if not exists civilian_contracts_resource_idx on public.civilian_contracts(objective_resource_code);
create index if not exists civilian_discoveries_first_idx on public.civilian_discoveries(first_discovered_by);
create index if not exists civilian_discoveries_location_idx on public.civilian_discoveries(location_ref);
create index if not exists civilian_discovery_claims_user_idx on public.civilian_discovery_claims(user_id);
create index if not exists civilian_parties_leader_idx on public.civilian_parties(leader_user_id);
create index if not exists civilian_party_invites_target_idx on public.civilian_party_invites(invited_user_id);
create index if not exists civilian_party_invites_sender_idx on public.civilian_party_invites(sender_user_id);
create index if not exists civilian_travel_incidents_location_idx on public.civilian_travel_incidents(location_ref);
create index if not exists civilian_travel_incidents_user_idx on public.civilian_travel_incidents(user_id);
create index if not exists civilian_political_activity_claims_group_idx on public.civilian_political_activity_claims(group_id);

-- Deliberately deny direct reads of the internal activity-claim ledger.
-- The SECURITY DEFINER verification path is its only mutation interface.
create policy "No direct reads of political claim ledger"
on public.civilian_political_activity_claims for select to authenticated using(false);

CREATE OR REPLACE FUNCTION public.scan_civilian_discoveries(p_character_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_uid uuid:=(select auth.uid());v_pos text;v_radius integer:=1;v_event record;v_claim uuid;
 v_findings jsonb:='[]'::jsonb;v_first boolean;v_bonus integer;
 v_friend record;v_shared uuid;
begin
 if v_uid is null then raise exception 'Authentication required';end if;
 select location_ref into v_pos from public.characters where id=p_character_id and user_id=v_uid
 and status='active' and life_status='alive' and movement_status='stationary';
 if v_pos is null then return jsonb_build_object('events','[]'::jsonb,'scan_radius',1,'reason','CHARACTER_NOT_STATIONARY');end if;
 if exists(select 1 from public.player_research_perks owned join public.research_perks perk on perk.id=owned.perk_id where owned.user_id=v_uid and perk.code='NAVIGATION_PROTOCOLS') then v_radius:=2;end if;
 if exists(select 1 from public.player_research_perks owned join public.research_perks perk on perk.id=owned.perk_id where owned.user_id=v_uid and perk.code='DEEP_SPACE_NAVIGATION') then v_radius:=3;end if;
 if exists(select 1 from public.player_research_perks owned join public.research_perks perk on perk.id=owned.perk_id where owned.user_id=v_uid and perk.code='LONG_RANGE_SURVEY') then v_radius:=4;end if;
 for v_event in select * from public.civilian_discoveries
 where starts_at<=now() and (expires_at is null or expires_at>now())
 and private.hex_distance(v_pos,location_ref)<=v_radius
 order by created_at for update
 loop
  v_first:=v_event.first_discovered_by is null;
  v_bonus:=v_event.bonus_research_points+case when v_first and v_event.rarity='rare' then 2 else 0 end;
  insert into public.civilian_discovery_claims(discovery_id,user_id,research_earned)
   values(v_event.id,v_uid,v_bonus) on conflict do nothing returning discovery_id into v_claim;
  if v_claim is not null then
   if v_first then update public.civilian_discoveries set first_discovered_by=v_uid where id=v_event.id;end if;
   if v_bonus>0 then perform private.add_player_research_points(v_uid,v_bonus);end if;
  end if;
  -- Share discoveries with temporary party members who are physically
  -- stationed in the scanning character's hex, never with remote players.
  for v_friend in
   select member.user_id
   from public.civilian_party_members owner_member
   join public.civilian_party_members member on member.party_id=owner_member.party_id
   join public.civilian_parties party on party.id=owner_member.party_id
   where owner_member.user_id=v_uid and owner_member.departed_at is null
    and member.departed_at is null and member.user_id<>v_uid and party.status='active'
    and exists(select 1 from public.characters ch
     where ch.user_id=member.user_id and ch.location_ref=v_pos and ch.status='active'
      and ch.life_status='alive' and ch.movement_status='stationary')
  loop
   v_shared:=null;
   insert into public.civilian_discovery_claims(discovery_id,user_id,research_earned)
     values(v_event.id,v_friend.user_id,v_event.bonus_research_points)
     on conflict do nothing returning discovery_id into v_shared;
   if v_shared is not null and v_event.bonus_research_points>0 then
    perform private.add_player_research_points(v_friend.user_id,v_event.bonus_research_points);
   end if;
  end loop;
  v_findings:=v_findings||jsonb_build_array(jsonb_build_object(
   'id',v_event.id,'title',v_event.title,'description',v_event.description,
   'location_ref',v_event.location_ref,'rarity',v_event.rarity,
   'discovered_now',v_claim is not null,'research_awarded',case when v_claim is not null then v_bonus else 0 end
  ));
  v_claim:=null;
 end loop;
 return jsonb_build_object('events',v_findings,'scan_radius',v_radius,'location_ref',v_pos);
end $function$;
