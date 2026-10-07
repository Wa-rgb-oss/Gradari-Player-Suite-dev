
-- Settle old equipment bonuses before converting equipment positions.
select private.process_daily_influence();
alter table public.character_artifacts drop constraint character_artifacts_equipped_slot_check;
update public.character_artifacts set equipped_slot=case equipped_slot when 'cloak' then 'slot_1' when 'signet' then 'slot_2' when 'relic' then 'slot_3' else equipped_slot end where equipped_slot is not null;
alter table public.character_artifacts add constraint character_artifacts_equipped_slot_check check(equipped_slot in('slot_1','slot_2','slot_3'));

create or replace function private.artifact_influence_bonus(p_character_id uuid) returns numeric language sql stable security definer set search_path='' as $$
select least(100,coalesce(sum(a.influence_bonus_percent),0)) from public.character_artifacts h join public.artifact_catalog a on a.id=h.artifact_id where h.character_id=p_character_id and h.equipped_slot in('slot_1','slot_2','slot_3') and a.active;
$$;

create function private.equip_character_artifact(p_holding_id uuid,p_slot integer) returns jsonb language plpgsql security definer set search_path='' as $$
declare h public.character_artifacts%rowtype; c public.characters%rowtype; target_slot text;
begin
 if auth.uid() is null then raise exception 'Authentication required'; end if;
 if p_slot is not null and p_slot not between 1 and 3 then raise exception 'Choose artifact slot 1, 2, or 3'; end if;
 select * into h from public.character_artifacts where id=p_holding_id;
 if not found then raise exception 'Artifact not found'; end if;
 select * into c from public.characters where id=h.character_id and user_id=auth.uid() and status='active' and life_status='alive' for update;
 if not found then raise exception 'Your active living character is required'; end if;
 select * into h from public.character_artifacts where id=p_holding_id for update;
 if not found then raise exception 'Artifact no longer owned'; end if;
 if p_slot is not null and not exists(select 1 from public.artifact_catalog where id=h.artifact_id and active) then raise exception 'Artifact is unavailable'; end if;
 target_slot:=case when p_slot is not null then 'slot_'||p_slot end;
 -- Ownership is represented by one holding row. Moving it cannot duplicate an effect.
 update public.character_artifacts set equipped_slot=null where id=h.id or (character_id=c.id and equipped_slot=target_slot);
 update public.character_artifacts set equipped_slot=target_slot where id=h.id;
 return jsonb_build_object('equipped_slot',target_slot,'bonus_percent',private.artifact_influence_bonus(c.id));
end $$;
create function public.equip_character_artifact(p_holding_id uuid,p_slot integer) returns jsonb language sql set search_path='' as $$select private.equip_character_artifact($1,$2)$$;
revoke all on function private.equip_character_artifact(uuid,integer),public.equip_character_artifact(uuid,integer) from public,anon;
grant execute on function private.equip_character_artifact(uuid,integer),public.equip_character_artifact(uuid,integer) to authenticated;

-- Keep existing clients working, choosing the first free generic slot.
create or replace function private.set_character_artifact(p_holding_id uuid,p_equipped boolean) returns jsonb language plpgsql security definer set search_path='' as $$
declare h public.character_artifacts%rowtype; target integer;
begin
 if auth.uid() is null then raise exception 'Authentication required'; end if;
 select * into h from public.character_artifacts where id=p_holding_id;
 if not found then raise exception 'Artifact not found'; end if;
 perform 1 from public.characters where id=h.character_id and user_id=auth.uid() and status='active' and life_status='alive' for update;
 if not found then raise exception 'Your active living character is required'; end if;
 select * into h from public.character_artifacts where id=p_holding_id;
 if p_equipped then
  if h.equipped_slot is not null then target:=right(h.equipped_slot,1)::integer;
  else
   select n into target from generate_series(1,3) n where not exists(select 1 from public.character_artifacts where character_id=h.character_id and equipped_slot='slot_'||n) order by n limit 1;
   if target is null then raise exception 'All three artifact slots are occupied. Choose a slot to replace.'; end if;
  end if;
 end if;
 return private.equip_character_artifact(p_holding_id,target);
end $$;
do $patch$ declare def text; begin
 def:=pg_get_functiondef('private.use_character_artifact(uuid)'::regprocedure);
 def:=replace(def,'h.equipped_slot is distinct from a.slot','(h.equipped_slot is null or h.equipped_slot not in (''slot_1'',''slot_2'',''slot_3''))');
 execute def;
end $patch$;
do $$ declare cid uuid; begin
 for cid in select id from public.characters order by id loop perform private.refresh_daily_influence_rate(cid); end loop;
end $$;
