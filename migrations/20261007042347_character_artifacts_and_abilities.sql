create table public.artifact_catalog (
 id uuid primary key default gen_random_uuid(),
 code text not null unique check (length(trim(code)) between 1 and 80),
 name text not null check(length(trim(name)) between 1 and 120),
 description text not null default '',
 rarity text not null default 'rare' check(rarity in ('uncommon','rare','legendary')),
 slot text not null default 'relic' check(slot in ('cloak','relic','signet')),
 influence_bonus_percent numeric not null default 0 check(influence_bonus_percent between 0 and 100),
 ability_name text not null default '',
 ability_description text not null default '',
 ability_influence numeric not null default 0 check(ability_influence between 0 and 10000),
 cooldown_world_hours numeric not null default 36 check(cooldown_world_hours between 1 and 9360),
 active boolean not null default true,
 created_at timestamptz not null default now()
);
create table public.character_artifacts (
 id uuid primary key default gen_random_uuid(),
 character_id uuid not null references public.characters(id) on delete cascade,
 artifact_id uuid not null references public.artifact_catalog(id),
 equipped_slot text check(equipped_slot in ('cloak','relic','signet')),
 next_use_world_hour numeric not null default 0,
 granted_at timestamptz not null default now(),
 granted_by uuid references auth.users(id),
 unique(character_id,artifact_id)
);
create unique index character_artifact_slots on public.character_artifacts(character_id,equipped_slot) where equipped_slot is not null;
alter table public.artifact_catalog enable row level security;
alter table public.character_artifacts enable row level security;
revoke all on public.artifact_catalog,public.character_artifacts from anon,authenticated;
grant select,insert,update on public.artifact_catalog to authenticated;
grant select on public.character_artifacts to authenticated;
create policy artifacts_visible on public.artifact_catalog for select to authenticated using(active or (select private.is_admin()));
create policy artifacts_admin_insert on public.artifact_catalog for insert to authenticated with check((select private.is_admin()));
create policy artifacts_admin_update on public.artifact_catalog for update to authenticated using((select private.is_admin())) with check((select private.is_admin()));
create policy artifacts_owned on public.character_artifacts for select to authenticated using((select private.is_admin()) or exists(select 1 from public.characters c where c.id=character_id and c.user_id=(select auth.uid())));

create function private.artifact_influence_bonus(p_character_id uuid) returns numeric language sql stable security definer set search_path='' as $$
 select least(100,coalesce(sum(a.influence_bonus_percent),0)) from public.character_artifacts h join public.artifact_catalog a on a.id=h.artifact_id where h.character_id=p_character_id and h.equipped_slot=a.slot and a.active;
$$;
revoke all on function private.artifact_influence_bonus(uuid) from public,anon,authenticated;

create function private.set_character_artifact(p_holding_id uuid,p_equipped boolean) returns jsonb language plpgsql security definer set search_path='' as $$
declare h public.character_artifacts%rowtype; a public.artifact_catalog%rowtype; c public.characters%rowtype;
begin
 if auth.uid() is null then raise exception 'Authentication required'; end if;
 select * into h from public.character_artifacts where id=p_holding_id;
 if not found then raise exception 'Artifact not found'; end if;
 select * into c from public.characters where id=h.character_id and user_id=auth.uid() and status='active' and life_status='alive' for update;
 if not found then raise exception 'Your active living character is required'; end if;
 select * into h from public.character_artifacts where id=p_holding_id for update;
 if not found then raise exception 'Artifact no longer owned'; end if;
 select * into a from public.artifact_catalog where id=h.artifact_id;
 if p_equipped and not a.active then raise exception 'Artifact is unavailable'; end if;
 if p_equipped then update public.character_artifacts set equipped_slot=null where character_id=c.id and equipped_slot=a.slot; end if;
 update public.character_artifacts set equipped_slot=case when p_equipped then a.slot end where id=h.id;
 return jsonb_build_object('equipped',p_equipped,'bonus_percent',private.artifact_influence_bonus(c.id));
end $$;

create function private.use_character_artifact(p_holding_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare h public.character_artifacts%rowtype; a public.artifact_catalog%rowtype; c public.characters%rowtype; v_now numeric; v_balance numeric;
begin
 if auth.uid() is null then raise exception 'Authentication required'; end if;
 select * into h from public.character_artifacts where id=p_holding_id;
 if not found then raise exception 'Artifact not found'; end if;
 select * into c from public.characters where id=h.character_id and user_id=auth.uid() and status='active' and life_status='alive' for update;
 if not found then raise exception 'Your active living character is required'; end if;
 select * into h from public.character_artifacts where id=p_holding_id for update;
 if not found then raise exception 'Artifact no longer owned'; end if;
 select * into a from public.artifact_catalog where id=h.artifact_id;
 if not a.active or h.equipped_slot is distinct from a.slot then raise exception 'Equip an available artifact first'; end if;
 if a.ability_influence<=0 then raise exception 'This artifact has no activated ability'; end if;
 v_now:=private.world_total_hours_at(now());
 if v_now<h.next_use_world_hour then raise exception 'Ability is cooling down for % world hours',round(h.next_use_world_hour-v_now,2); end if;
 insert into public.character_influence(character_id) values(c.id) on conflict do nothing;
 update public.character_influence set balance=balance+a.ability_influence,lifetime_earned=lifetime_earned+a.ability_influence,updated_at=now() where character_id=c.id returning balance into v_balance;
 insert into public.influence_transactions(character_id,amount,kind,description,balance_after,actor_user_id) values(c.id,a.ability_influence,'artifact_ability',a.name||': '||a.ability_name,v_balance,auth.uid());
 update public.character_artifacts set next_use_world_hour=v_now+a.cooldown_world_hours where id=h.id;
 return jsonb_build_object('influence_gained',a.ability_influence,'influence_balance',v_balance,'next_use_world_hour',v_now+a.cooldown_world_hours);
end $$;

create function private.gm_assign_artifact(p_character_id uuid,p_artifact_id uuid,p_grant boolean) returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or not private.is_admin() then raise exception 'Game Master authorization required'; end if;
 perform 1 from public.characters where id=p_character_id for update;
 if not found then raise exception 'Character not found'; end if;
 if p_grant then
  if not exists(select 1 from public.artifact_catalog where id=p_artifact_id and active) then raise exception 'Available artifact not found'; end if;
  insert into public.character_artifacts(character_id,artifact_id,granted_by) values(p_character_id,p_artifact_id,auth.uid()) on conflict(character_id,artifact_id) do nothing;
 else delete from public.character_artifacts where character_id=p_character_id and artifact_id=p_artifact_id;
 end if;
 return jsonb_build_object('granted',p_grant);
end $$;
revoke all on function private.set_character_artifact(uuid,boolean),private.use_character_artifact(uuid),private.gm_assign_artifact(uuid,uuid,boolean) from public,anon;
grant execute on function private.set_character_artifact(uuid,boolean),private.use_character_artifact(uuid),private.gm_assign_artifact(uuid,uuid,boolean) to authenticated;
create function public.set_character_artifact(p_holding_id uuid,p_equipped boolean) returns jsonb language sql set search_path='' as $$select private.set_character_artifact($1,$2)$$;
create function public.use_character_artifact(p_holding_id uuid) returns jsonb language sql set search_path='' as $$select private.use_character_artifact($1)$$;
create function public.gm_assign_artifact(p_character_id uuid,p_artifact_id uuid,p_grant boolean) returns jsonb language sql set search_path='' as $$select private.gm_assign_artifact($1,$2,$3)$$;
revoke all on function public.set_character_artifact(uuid,boolean),public.use_character_artifact(uuid),public.gm_assign_artifact(uuid,uuid,boolean) from public,anon;
grant execute on function public.set_character_artifact(uuid,boolean),public.use_character_artifact(uuid),public.gm_assign_artifact(uuid,uuid,boolean) to authenticated;

-- Extend the existing authorized activity award without changing costs or cooldowns.
do $$declare source text; begin
 select pg_get_functiondef(oid) into source from pg_proc where pronamespace='private'::regnamespace and proname='perform_political_action';
 if source is null or position('v_artifact_bonus' in source)>0 then raise exception 'Unexpected political activity function'; end if;
 source:=replace(source,'v_influence numeric(20,2);','v_influence numeric(20,2); v_reward numeric(20,2); v_artifact_bonus numeric;');
 source:=replace(source,'v_action.influence_reward','v_reward');
 source:=replace(source,'  select political_action_cooldown_world_hours',E'  v_artifact_bonus:=private.artifact_influence_bonus(p_character_id);\n  v_reward:=round(v_action.influence_reward*(1+v_artifact_bonus/100),2);\n\n  select political_action_cooldown_world_hours');
 source:=replace(source,'''influence_gained'',v_reward,', '''influence_gained'',v_reward,''artifact_bonus_percent'',v_artifact_bonus,');
 execute source;
end $$;
insert into public.artifact_catalog(code,name,description,rarity,slot,influence_bonus_percent)
values('cloak_of_charisma','Cloak of Charisma','An enchanted cloak that lends weight to its wearer''s words. While equipped, political activities grant 10% more Influence.','rare','cloak',10);
insert into public.artifact_catalog(code,name,description,rarity,slot,ability_name,ability_description,ability_influence,cooldown_world_hours)
values('signet_of_command','Signet of Command','A signet imbued with the authority of a forgotten court.','rare','signet','Voice of Command','Gain 5 Influence. Usable once every in-game day (36 world hours).',5,36);
notify pgrst,'reload schema';
