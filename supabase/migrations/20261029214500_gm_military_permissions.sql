
-- Game Master may exercise faction military controls for setup and testing.
create or replace function private.has_faction_permission(p_faction_id uuid,p_permission text)
returns boolean language sql stable security definer set search_path=''
as $fn$
 select private.is_faction_leader(p_faction_id)
   or (p_permission='military' and private.is_admin())
   or exists(select 1 from public.faction_memberships fm
     where fm.faction_id=p_faction_id and fm.user_id=(select auth.uid())
       and fm.status='active' and p_permission=any(fm.permissions));
$fn$;
create or replace function public.can_command_faction(p_faction_id uuid)
returns boolean language sql stable security definer set search_path=''
as $fn$
 select (select auth.uid()) is not null and
 exists(select 1 from public.factions where id=p_faction_id and status='active')
 and private.has_faction_permission(p_faction_id,'military');
$fn$;
revoke all on function public.can_command_faction(uuid) from public,anon;
grant execute on function public.can_command_faction(uuid) to authenticated;
do $patch$
declare body text;
begin
 body:=pg_get_functiondef('public.get_contextual_actions(text,text,uuid)'::regprocedure);
 if position('v_can_military := v_can_military or exists' in body)>0 then
   body:=replace(body,'v_can_military := v_can_military or exists',
     'v_can_military := v_can_military or private.is_admin() or exists');
 end if;
 body:=replace(body,
   'v_allowed:=v_member or v_faction.leader_user_id=v_uid;',
   'v_allowed:=v_member or v_faction.leader_user_id=v_uid or private.is_admin();');
 body:=replace(body,
   'v_allowed := v_member or v_faction.leader_user_id=v_uid;',
   'v_allowed := v_member or v_faction.leader_user_id=v_uid or private.is_admin();');
 execute body;
end;$patch$;
