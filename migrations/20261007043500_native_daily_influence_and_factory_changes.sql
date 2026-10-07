
create table private.character_daily_influence (
 character_id uuid primary key references public.characters(id) on delete cascade,
 last_world_hour numeric not null,
 progress_hours numeric not null default 0 check(progress_hours>=0 and progress_hours<36),
 pending_amount numeric not null default 0,
 daily_rate numeric not null default 5,
 eligible boolean not null
);
alter table private.character_daily_influence enable row level security;
revoke all on private.character_daily_influence from public,anon,authenticated;
insert into private.character_daily_influence(character_id,last_world_hour,daily_rate,eligible)
select id,private.world_total_hours_at(now()),5*(1+private.artifact_influence_bonus(id)/100),status='active' and life_status='alive' from public.characters;

create function private.settle_daily_influence(p_character_id uuid) returns numeric
language plpgsql security definer set search_path='' as $$
declare s private.character_daily_influence%rowtype; v_now numeric:=private.world_total_hours_at(now()); elapsed numeric; needed numeric; paid numeric:=0; days numeric; bal numeric;
begin
 perform 1 from public.characters where id=p_character_id for update;
 if not found then return 0; end if;
 select * into s from private.character_daily_influence where character_id=p_character_id for update;
 if not found then return 0; end if;
 elapsed:=greatest(0,v_now-s.last_world_hour);
 if s.eligible then
  needed:=36-s.progress_hours;
  if elapsed>=needed then
   paid:=s.pending_amount+needed*s.daily_rate/36;
   elapsed:=elapsed-needed;
   days:=floor(elapsed/36);
   paid:=paid+days*s.daily_rate;
   elapsed:=elapsed-days*36;
   s.progress_hours:=elapsed; s.pending_amount:=elapsed*s.daily_rate/36;
  else
   s.progress_hours:=s.progress_hours+elapsed;
   s.pending_amount:=s.pending_amount+elapsed*s.daily_rate/36;
  end if;
 end if;
 update private.character_daily_influence set last_world_hour=greatest(last_world_hour,v_now),progress_hours=s.progress_hours,pending_amount=s.pending_amount where character_id=p_character_id;
 paid:=round(paid,2);
 if paid>0 then
  insert into public.character_influence(character_id) values(p_character_id) on conflict do nothing;
  update public.character_influence set balance=balance+paid,lifetime_earned=lifetime_earned+paid,updated_at=now() where character_id=p_character_id returning balance into bal;
  insert into public.influence_transactions(character_id,amount,kind,description,balance_after) values(p_character_id,paid,'daily_influence','Native daily Influence including equipped artifact bonuses',bal);
 end if;
 return paid;
end $$;
revoke all on function private.settle_daily_influence(uuid) from public,anon,authenticated;

create function private.refresh_daily_influence_rate(p_character_id uuid) returns void
language sql security definer set search_path='' as $$
 insert into private.character_daily_influence(character_id,last_world_hour,daily_rate,eligible)
 select id,private.world_total_hours_at(now()),5*(1+private.artifact_influence_bonus(id)/100),status='active' and life_status='alive' from public.characters where id=p_character_id
 on conflict(character_id) do update set daily_rate=excluded.daily_rate,eligible=excluded.eligible;
$$;
revoke all on function private.refresh_daily_influence_rate(uuid) from public,anon,authenticated;

create function private.daily_influence_character_change() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if TG_OP='UPDATE' and TG_WHEN='BEFORE' then perform private.settle_daily_influence(old.id);
 else perform private.refresh_daily_influence_rate(new.id); end if;
 return new;
end $$;
revoke all on function private.daily_influence_character_change() from public,anon,authenticated;
create trigger daily_influence_before_status before update of status,life_status on public.characters for each row execute function private.daily_influence_character_change();
create trigger daily_influence_after_status after insert or update of status,life_status on public.characters for each row execute function private.daily_influence_character_change();

create function private.daily_influence_artifact_change() returns trigger
language plpgsql security definer set search_path='' as $$
declare cid uuid;
begin
 cid:=case when TG_OP='DELETE' then old.character_id else new.character_id end;
 if TG_WHEN='BEFORE' then perform private.settle_daily_influence(cid);
 else perform private.refresh_daily_influence_rate(cid); end if;
 if TG_OP='DELETE' then return old; else return new; end if;
end $$;
revoke all on function private.daily_influence_artifact_change() from public,anon,authenticated;
create trigger daily_influence_before_artifact before insert or update or delete on public.character_artifacts for each row execute function private.daily_influence_artifact_change();
create trigger daily_influence_after_artifact after insert or update or delete on public.character_artifacts for each row execute function private.daily_influence_artifact_change();

create function private.daily_influence_catalog_change() returns trigger
language plpgsql security definer set search_path='' as $$
declare cid uuid;
begin
 for cid in select character_id from private.character_daily_influence order by character_id loop
  if TG_WHEN='BEFORE' then perform private.settle_daily_influence(cid);
  else perform private.refresh_daily_influence_rate(cid); end if;
 end loop;
 return null;
end $$;
revoke all on function private.daily_influence_catalog_change() from public,anon,authenticated;
create trigger daily_influence_before_catalog before update on public.artifact_catalog for each statement execute function private.daily_influence_catalog_change();
create trigger daily_influence_after_catalog after update on public.artifact_catalog for each statement execute function private.daily_influence_catalog_change();

create function private.process_daily_influence() returns numeric
language plpgsql security definer set search_path='' as $$
declare cid uuid; total numeric:=0;
begin
 for cid in select character_id from private.character_daily_influence order by character_id loop total:=total+private.settle_daily_influence(cid); end loop;
 return total;
end $$;
revoke all on function private.process_daily_influence() from public,anon,authenticated;
select cron.schedule('gradari-daily-influence','* * * * *','select private.process_daily_influence();');

create function private.claim_daily_influence() returns jsonb
language plpgsql security definer set search_path='' as $$
declare cid uuid; earned numeric:=0;
begin
 if auth.uid() is null then raise exception 'Authentication required'; end if;
 for cid in select id from public.characters where user_id=auth.uid() and status='active' and life_status='alive' order by id loop earned:=earned+private.settle_daily_influence(cid); end loop;
 return jsonb_build_object('influence_gained',earned,'native_daily_gain',5);
end $$;
create function public.claim_daily_influence() returns jsonb language sql set search_path='' as $$select private.claim_daily_influence()$$;
revoke all on function private.claim_daily_influence(),public.claim_daily_influence() from public,anon;
grant execute on function private.claim_daily_influence(),public.claim_daily_influence() to authenticated;

create function private.change_factory_production(p_facility_id uuid,p_recipe_code text,p_quantity numeric) returns jsonb
language plpgsql security definer set search_path='' as $$
declare f public.facilities%rowtype; o public.factory_orders%rowtype;
begin
 if auth.uid() is null then raise exception 'Authentication required'; end if;
 select * into f from public.facilities where id=p_facility_id for update;
 if not found then raise exception 'Factory not found'; end if;
 if not private.is_admin() and not (
  f.owner_user_id=auth.uid() or (f.owner_user_id is null and exists(select 1 from public.faction_memberships where user_id=auth.uid() and faction_id=coalesce(f.owner_faction_id,f.controlling_faction_id) and status='active'))
 ) then raise exception 'Not authorized for this factory'; end if;
 select * into o from public.factory_orders where facility_id=f.id for update;
 if o.status='producing' and o.completes_at<=now() then
  perform private.settle_factory_output(f.id);
  select * into o from public.factory_orders where facility_id=f.id;
 end if;
 if o.status in ('producing','storage_blocked') then
  update public.factory_orders set status='cancelled',output_remaining=0,updated_at=now() where facility_id=f.id;
 end if;
 return public.queue_factory_production(p_facility_id,p_recipe_code,p_quantity);
end $$;
create function public.change_factory_production(p_facility_id uuid,p_recipe_code text,p_quantity numeric default 1) returns jsonb language sql set search_path='' as $$select private.change_factory_production($1,$2,$3)$$;
revoke all on function private.change_factory_production(uuid,text,numeric),public.change_factory_production(uuid,text,numeric) from public,anon;
grant execute on function private.change_factory_production(uuid,text,numeric),public.change_factory_production(uuid,text,numeric) to authenticated;
-- Serialize starts with replacements to prevent duplicate input charges.
do $patch$
declare def text;
begin
 def:=pg_get_functiondef('public.queue_factory_production(uuid,text,numeric)'::regprocedure);
 def:=replace(def,'where x.id=p_facility_id and x.status=''active'';','where x.id=p_facility_id and x.status=''active'' for update of x;');
 execute def;
end $patch$;
