
-- Deterministic battle resolution, war score and negotiated peace.
create or replace function private.resolve_due_battles()
returns jsonb language plpgsql security definer set search_path='' as $fn$
declare op public.military_operations%rowtype; att public.armies%rowtype;
 def_total numeric; atk_loss numeric; def_loss numeric; win boolean;war_id uuid;
 rec record; old_strength numeric; losses numeric; resolved integer:=0;
begin
 for op in select * from public.military_operations
   where status='awaiting_resolution' order by resolve_world_hour,id for update
 loop
  select * into att from public.armies where id=op.army_id for update;
  if not found or att.status<>'active' then
   update public.military_operations set status='resolved',outcome='failure',
    resolution_notes='Attacking force unavailable',resolved_at=now() where id=op.id;
   continue;
  end if;
  select coalesce(sum(strength),0) into def_total from public.armies
   where faction_id=op.defender_faction_id and location_ref=op.target_ref
   and status='active' and movement_status='stationary';
  -- Terrain-defense advantage is 15%; raid is easier than full conquest.
  win:=att.strength >= greatest(1,def_total)*(case when op.operation_type='raid' then 0.85 else 1.15 end);
  atk_loss:=least(att.strength,ceil(greatest(1,def_total)*(case when win then .15 else .30 end)));
  def_loss:=least(def_total,ceil(att.strength*(case when win then .25 else .12 end)));
  update public.armies set strength=greatest(0,strength-atk_loss),
   status=case when strength<=atk_loss then 'destroyed' else status end,updated_at=now()
  where id=att.id;
  if def_total>0 and def_loss>0 then
   for rec in select id,strength from public.armies
     where faction_id=op.defender_faction_id and location_ref=op.target_ref
       and status='active' and movement_status='stationary' order by id for update
   loop
    losses:=least(rec.strength,ceil(def_loss*rec.strength/def_total));
    update public.armies set strength=greatest(0,strength-losses),
      status=case when strength<=losses then 'destroyed' else status end,updated_at=now()
    where id=rec.id;
   end loop;
  end if;
  if win and op.operation_type='conquest' then
   update public.territories set faction_id=op.attacker_faction_id,status='occupied',updated_at=now()
   where location_ref=op.target_ref and faction_id=op.defender_faction_id;
  elsif win and op.operation_type='raid' then
   insert into public.location_modifiers(location_ref,modifier_type,label,
      production_multiplier,starts_at,expires_at,player_visible,starts_world_hour,expires_world_hour)
   values(op.target_ref,'raid','Raided',.75,now(),null,true,
     private.world_total_hours_at(now()),private.world_total_hours_at(now())+36);
  end if;
  insert into public.military_battles(operation_id,attacker_faction_id,defender_faction_id,
    location_ref,attacker_before,defender_before,attacker_losses,defender_losses,winner_faction_id,
    resolution_world_hour,narrative)
  values(op.id,op.attacker_faction_id,op.defender_faction_id,op.target_ref,
    att.strength,def_total,atk_loss,def_loss,
    case when win then op.attacker_faction_id else op.defender_faction_id end,
    private.world_total_hours_at(now()),case when win then 'Attacker prevailed' else 'Defense held' end);
  update public.military_operations set status='resolved',
    outcome=case when win then 'success' else 'failure' end,
    resolution_notes='Alpha 0.5 automated strategic combat',
    resolved_at=now() where id=op.id;
  select id into war_id from public.military_wars
   where status='active' and
     least(attacker_faction_id,defender_faction_id)=least(op.attacker_faction_id,op.defender_faction_id)
     and greatest(attacker_faction_id,defender_faction_id)=greatest(op.attacker_faction_id,op.defender_faction_id)
   for update;
  if war_id is null then
   insert into public.military_wars(attacker_faction_id,defender_faction_id)
    values(op.attacker_faction_id,op.defender_faction_id) returning id into war_id;
  end if;
  update public.military_wars set
   attacker_score=attacker_score+
    case when op.attacker_faction_id=attacker_faction_id and win
         or op.defender_faction_id=attacker_faction_id and not win then
         case when op.operation_type='conquest' then 20 else 8 end else 0 end,
   defender_score=defender_score+
    case when op.attacker_faction_id=defender_faction_id and win
         or op.defender_faction_id=defender_faction_id and not win then
         case when op.operation_type='conquest' then 20 else 8 end else 0 end
   where id=war_id;
  resolved:=resolved+1;
 end loop;
 return jsonb_build_object('operations_resolved',resolved);
end;$fn$;
revoke all on function private.resolve_due_battles() from public,anon,authenticated;
create or replace function private.offer_war_peace(p_war uuid,p_terms text)
returns jsonb language plpgsql security definer set search_path='' as $fn$
declare w public.military_wars%rowtype; fid uuid;pid uuid;
begin
 select * into w from public.military_wars where id=p_war and status='active' for update;
 if not found then raise exception 'War not active';end if;
 if p_terms not in ('white_peace','attacker_victory','defender_victory') then raise exception 'Invalid peace terms';end if;
 if private.has_faction_permission(w.attacker_faction_id,'military') then fid:=w.attacker_faction_id;
 elsif private.has_faction_permission(w.defender_faction_id,'military') then fid:=w.defender_faction_id;
 else raise exception 'Faction military authority required';end if;
 insert into public.military_peace_proposals(war_id,proposed_by_faction_id,proposed_by_user_id,terms)
 values(p_war,fid,auth.uid(),p_terms) returning id into pid;
 return jsonb_build_object('proposal_id',pid,'status','pending');
end;$fn$;
create or replace function public.offer_war_peace(p_war uuid,p_terms text) returns jsonb
language sql security definer set search_path='' as $fn$ select private.offer_war_peace($1,$2);$fn$;
revoke all on function public.offer_war_peace(uuid,text) from public,anon;
grant execute on function public.offer_war_peace(uuid,text) to authenticated;
create or replace function private.respond_war_peace(p_proposal uuid,p_accept boolean)
returns jsonb language plpgsql security definer set search_path='' as $fn$
declare prop public.military_peace_proposals%rowtype;w public.military_wars%rowtype;opponent uuid;
begin
 select * into prop from public.military_peace_proposals where id=p_proposal and status='pending' for update;
 if not found then raise exception 'Pending proposal not found';end if;
 select * into w from public.military_wars where id=prop.war_id and status='active' for update;
 if not found then raise exception 'War no longer active';end if;
 opponent:=case when w.attacker_faction_id=prop.proposed_by_faction_id then w.defender_faction_id else w.attacker_faction_id end;
 if not private.has_faction_permission(opponent,'military') then raise exception 'Opposing faction authorization required';end if;
 update public.military_peace_proposals set status=case when p_accept then 'accepted' else 'rejected' end,
   responded_at=now() where id=prop.id;
 if p_accept then
   update public.military_wars set status='ended',resolution=prop.terms,ended_at=now() where id=w.id;
   update public.military_peace_proposals set status='expired',responded_at=now()
     where war_id=w.id and id<>prop.id and status='pending';
 end if;
 return jsonb_build_object('proposal_id',prop.id,'accepted',p_accept,'war_ended',p_accept);
end;$fn$;
create or replace function public.respond_war_peace(p_proposal uuid,p_accept boolean) returns jsonb
language sql security definer set search_path='' as $fn$ select private.respond_war_peace($1,$2);$fn$;
revoke all on function public.respond_war_peace(uuid,boolean) from public,anon;
grant execute on function public.respond_war_peace(uuid,boolean) to authenticated;
do $patch$
declare body text;
begin
 body:=pg_get_functiondef('private.world_clock_heartbeat()'::regprocedure);
 if position('perform private.process_fleet_world();' in body)=0 then raise exception 'Fleet heartbeat integration missing';end if;
 body:=replace(body,'perform private.process_fleet_world();',
  'perform private.process_fleet_world();
  perform private.resolve_due_battles();');
 execute body;
end;$patch$;
