
do $patch$
declare body text;
begin
 body:=pg_get_functiondef('public.get_contextual_actions(text,text,uuid)'::regprocedure);
 if position('elsif p_kind = ''faction'' then' in body)=0 then raise exception 'Contextual action branch changed';end if;
 body:=replace(body,
 'elsif p_kind = ''faction'' then',
 $fragment$elsif p_kind = 'fleet' then
    if p_target_id is null then raise exception 'Fleet ID required';end if;
    select * into v_faction from public.factions
      where id=(select faction_id from public.fleets where id=p_target_id and status='active');
    if not found then raise exception 'Fleet not available';end if;
    v_title:=(select name from public.fleets where id=p_target_id);
    select exists(select 1 from public.faction_memberships
      where user_id=v_uid and faction_id=v_faction.id and status='active'
      and ('military'=any(permissions) or 'all'=any(permissions))) into v_member;
    v_allowed:=v_member or v_faction.leader_user_id=v_uid;
    v_actions:=jsonb_build_array(
      jsonb_build_object('id','inspect','label','Inspect Fleet','category','general','enabled',true),
      jsonb_build_object('id','fleet','label','Open Fleet Command','category','military','enabled',v_allowed,
        'reason',case when not v_allowed then 'Faction military authority required' end)
    );
  elsif p_kind = 'faction' then$fragment$);
 execute body;
end;$patch$;
