-- Alpha 0.5.0: ensure new non-navigation career perks have actual effects.
update public.research_perks set description=case code
 when 'CITIZEN_EFFICIENCY' then 'Gain 5% more Aureum from completed civilian contracts.'
 when 'CIVILIAN_LEADERSHIP' then 'Earn one bonus Reputation from each completed civilian contract.'
 when 'STRATEGIC_COORDINATION' then 'Earn one bonus Research Point from each completed civilian contract.'
 when 'CIVIC_NETWORKS' then 'Earn one bonus Political Reputation from political contracts.'
 when 'PUBLIC_ADMINISTRATION' then 'Earn 5% more Aureum from political contracts.'
 when 'IMPERIAL_INSTITUTIONS' then 'Earn one additional Research Point from political contracts.'
 else description end,
 updated_at=now()
where code in ('CITIZEN_EFFICIENCY','CIVILIAN_LEADERSHIP','STRATEGIC_COORDINATION',
'CIVIC_NETWORKS','PUBLIC_ADMINISTRATION','IMPERIAL_INSTITUTIONS');

CREATE OR REPLACE FUNCTION public.claim_civilian_assignment(p_assignment_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_user uuid:=(select auth.uid());v_a public.civilian_assignments%rowtype;
 v_c public.civilian_contracts%rowtype;v_member record;v_members integer;v_index integer:=0;
 v_wallet numeric;v_amount numeric;v_rp numeric;v_rep integer;v_progress numeric;
 v_activity uuid;v_total numeric:=0;v_last uuid;
begin
 if v_user is null then raise exception 'Authentication required';end if;
 select * into v_a from public.civilian_assignments where id=p_assignment_id and user_id=v_user;
 if not found then raise exception 'Assignment not found';end if;
 perform pg_advisory_xact_lock(hashtext('civilian-assignment'),hashtext(v_a.group_id::text));
 select * into v_a from public.civilian_assignments where id=p_assignment_id for update;
 if v_a.status not in ('accepted','in_progress') then raise exception 'Assignment already resolved';end if;
 if v_a.due_world_hour is not null and private.world_total_hours_at(now())>=v_a.due_world_hour then
  update public.civilian_assignments set status='failed' where group_id=v_a.group_id and status in ('accepted','in_progress');
  raise exception 'Assignment deadline has passed';
 end if;
 select * into v_c from public.civilian_contracts where id=v_a.contract_id;
 select count(*) into v_members from public.civilian_assignments where group_id=v_a.group_id and status in ('accepted','in_progress');
 if v_members=0 then raise exception 'No active participants';end if;
 if exists(select 1 from public.civilian_assignments where group_id=v_a.group_id and status not in ('accepted','in_progress'))
 then raise exception 'Party assignment has already been resolved';end if;

 if v_c.objective_kind='visit_hex' then
  if exists(select 1 from public.civilian_assignments m where m.group_id=v_a.group_id and not exists(
    select 1 from public.characters ch where ch.user_id=m.user_id and ch.location_ref=v_c.location_ref
     and ch.status='active' and ch.life_status='alive' and ch.movement_status='stationary'))
  then raise exception 'All participants must arrive at the destination';end if;
 elsif v_c.objective_kind='supply_system' then
  select coalesce(sum(quantity),0) into v_progress from public.civilian_contract_supplies
   where group_id=v_a.group_id and contract_id=v_a.contract_id and resource_code=v_c.objective_resource_code and location_ref=v_c.location_ref;
  if v_progress<v_c.objective_quantity then raise exception 'Deliver more supplies before completing';end if;
 elsif v_c.objective_kind='political_activity' then
  for v_member in select * from public.civilian_assignments where group_id=v_a.group_id order by accepted_at,id loop
   select p.id into v_activity from public.political_activity_log p
   where p.user_id=v_member.user_id and p.created_at>=v_member.accepted_at
    and not exists(select 1 from public.civilian_political_activity_claims used where used.activity_id=p.id)
   order by p.created_at limit 1 for update of p;
   if v_activity is null then raise exception 'Each participant must complete a new political activity';end if;
   insert into public.civilian_political_activity_claims(activity_id,group_id) values(v_activity,v_a.group_id);
  end loop;
 else raise exception 'Unknown contract objective';end if;

 for v_member in select * from public.civilian_assignments where group_id=v_a.group_id order by accepted_at,id loop
  v_index:=v_index+1;
  -- Only pennies are distributed; rounding leftovers go to the final participant.
  v_amount:=case when v_index<v_members
   then trunc(v_c.reward_aureum/v_members,2)
   else v_c.reward_aureum - trunc(v_c.reward_aureum/v_members,2)*(v_members-1) end;
  v_rp:=case when v_index<v_members
   then trunc(v_c.reward_research_points::numeric/v_members)
   else v_c.reward_research_points - trunc(v_c.reward_research_points::numeric/v_members)*(v_members-1) end;
  v_rep:=case when v_index<v_members
   then floor(v_c.reward_reputation::numeric/v_members)::integer
   else v_c.reward_reputation - floor(v_c.reward_reputation::numeric/v_members)::integer*(v_members-1) end;
  -- Perks affect only verified earned rewards, never client-supplied totals.
  if exists(select 1 from public.player_research_perks owned join public.research_perks perk on perk.id=owned.perk_id
    where owned.user_id=v_member.user_id and perk.code='CITIZEN_EFFICIENCY') then
    v_amount:=round(v_amount*1.05,2);
  end if;
  if exists(select 1 from public.player_research_perks owned join public.research_perks perk on perk.id=owned.perk_id
    where owned.user_id=v_member.user_id and perk.code='CIVILIAN_LEADERSHIP') then
    v_rep:=v_rep+1;
  end if;
  if exists(select 1 from public.player_research_perks owned join public.research_perks perk on perk.id=owned.perk_id
    where owned.user_id=v_member.user_id and perk.code='STRATEGIC_COORDINATION') then
    v_rp:=v_rp+1;
  end if;
  if v_c.career_path='political' then
   if exists(select 1 from public.player_research_perks owned join public.research_perks perk on perk.id=owned.perk_id
     where owned.user_id=v_member.user_id and perk.code='CIVIC_NETWORKS') then
     v_rep:=v_rep+1;
   end if;
   if exists(select 1 from public.player_research_perks owned join public.research_perks perk on perk.id=owned.perk_id
     where owned.user_id=v_member.user_id and perk.code='PUBLIC_ADMINISTRATION') then
     v_amount:=round(v_amount*1.05,2);
   end if;
   if exists(select 1 from public.player_research_perks owned join public.research_perks perk on perk.id=owned.perk_id
     where owned.user_id=v_member.user_id and perk.code='IMPERIAL_INSTITUTIONS') then
     v_rp:=v_rp+1;
   end if;
  end if;
  insert into public.player_wallets(user_id,currency,balance) values(v_member.user_id,'Aureum',0)
   on conflict(user_id) do nothing;
  update public.player_wallets set balance=balance+v_amount,updated_at=now()
   where user_id=v_member.user_id returning balance into v_wallet;
  if v_amount>0 then
   insert into public.player_transactions(user_id,amount,currency,kind,description,balance_after)
   values(v_member.user_id,v_amount,'Aureum','civilian_contract',v_c.title,v_wallet);
  end if;
  if v_rp>0 then perform private.add_player_research_points(v_member.user_id,v_rp);end if;
  insert into public.civilian_reputation(user_id) values(v_member.user_id)
   on conflict(user_id) do nothing;
  update public.civilian_reputation set
   economic=economic+case when v_c.career_path='economic' then v_rep else 0 end,
   political=political+case when v_c.career_path='political' then v_rep else 0 end,
   exploration=exploration+case when v_c.career_path='exploration' then v_rep else 0 end,
   updated_at=now() where user_id=v_member.user_id;
  v_total:=v_total+v_amount;
 end loop;
 update public.civilian_assignments set status='completed',completed_at=now()
  where group_id=v_a.group_id and status in ('accepted','in_progress');
 return jsonb_build_object('completed',true,'participants',v_members,'aureum_distributed',v_total,'contract',v_c.title);
end $function$;
