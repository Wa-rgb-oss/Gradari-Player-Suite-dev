CREATE OR REPLACE FUNCTION public.get_contextual_actions(p_kind text, p_location_ref text DEFAULT NULL::text, p_target_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare
  v_uid uuid := (select auth.uid());
  v_char public.characters%rowtype;
  v_hex public.map_hexes%rowtype;
  v_fac public.facilities%rowtype;
  v_arm public.armies%rowtype;
  v_faction public.factions%rowtype;
  v_target_char public.characters%rowtype;
  v_has_market boolean := false;
  v_can_military boolean := false;
  v_can_build boolean := false;
  v_member boolean := false;
  v_allowed boolean := false;
  v_actions jsonb := '[]'::jsonb;
  v_title text := '';
begin
  if v_uid is null then
    raise exception 'Authentication required' using errcode='42501';
  end if;
  select * into v_char from public.characters
    where user_id = v_uid and status = 'active' and life_status = 'alive'
    order by created_at desc limit 1;
  if p_kind = 'hex' then
    if p_location_ref is null or p_location_ref !~ '^HEX_-?[0-9]{1,5}_-?[0-9]{1,5}$' then
      raise exception 'Invalid hex reference' using errcode='22023';
    end if;
    select * into v_hex from public.map_hexes
      where location_ref = p_location_ref and player_visible is true;
    if not found then raise exception 'Hex is not available' using errcode='22023'; end if;
    select exists(select 1 from public.trade_station_markets
      where location_ref=p_location_ref and player_visible=true) into v_has_market;
    select exists(select 1 from public.faction_memberships
      where user_id=v_uid and status='active' and
        ('military'=any(permissions) or 'all'=any(permissions)))
      into v_can_military;
    v_can_military := v_can_military or exists(select 1 from public.factions f where f.leader_user_id=v_uid and f.status='active');
    v_can_build := v_char.id is not null and v_char.location_ref=p_location_ref
      and coalesce(v_char.movement_status,'stationary') <> 'traveling';
    v_title := coalesce(v_hex.display_name,p_location_ref);
    v_actions := jsonb_build_array(
      jsonb_build_object('id','inspect','label','System Information','category','general','enabled',true),
      jsonb_build_object('id','travel','label','Travel Here','category','character',
        'enabled',v_char.id is not null and v_char.location_ref is distinct from p_location_ref
           and coalesce(v_char.movement_status,'stationary') <> 'traveling',
        'reason',case when v_char.id is null then 'Create a living character first'
                      when v_char.location_ref=p_location_ref then 'Already at this location'
                      when v_char.movement_status='traveling' then 'Travel already in progress'
                      else null end),
      jsonb_build_object('id','market','label','Open Market','category','economy','enabled',v_has_market,
        'reason',case when not v_has_market then 'No public trading station at this location' end),
      jsonb_build_object('id','build','label','Construct Facility','category','economy','enabled',v_can_build,
        'reason',case when not v_can_build then 'Your living character must be present and not traveling' end),
      jsonb_build_object('id','facilities','label','Inspect Facilities','category','economy','enabled',true),
      jsonb_build_object('id','politics','label','Local Government','category','politics','enabled',true),
      jsonb_build_object('id','military','label','Military Operations','category','military','enabled',v_can_military,
        'reason',case when not v_can_military then 'Requires faction military permissions' end)
    );
  elsif p_kind = 'facility' then
    if p_target_id is null then raise exception 'Facility ID required' using errcode='22023'; end if;
    select * into v_fac from public.facilities where id=p_target_id;
    if not found then raise exception 'Facility not accessible' using errcode='22023'; end if;
    v_title := coalesce(v_fac.name,'Facility');
    select exists(select 1 from public.faction_memberships
      where user_id=v_uid and faction_id=v_fac.owner_faction_id and status='active'
      and ('facilities'=any(permissions) or 'economy'=any(permissions) or 'all'=any(permissions)))
      into v_member;
    v_allowed := v_fac.owner_user_id=v_uid or v_member or exists(select 1 from public.factions f where f.id=v_fac.owner_faction_id and f.leader_user_id=v_uid);
    v_actions := jsonb_build_array(
      jsonb_build_object('id','inspect','label','Inspect Facility','category','general','enabled',true),
      jsonb_build_object('id','manage','label','Manage Production','category','economy','enabled',v_allowed,
        'reason',case when not v_allowed then 'Requires ownership or facility permissions' end),
      jsonb_build_object('id','economy','label','Open Economy & Facilities','category','economy','enabled',v_allowed,
        'reason',case when not v_allowed then 'Requires ownership or facility permissions' end)
    );
  elsif p_kind = 'army' then
    if p_target_id is null then raise exception 'Army ID required' using errcode='22023'; end if;
    select * into v_arm from public.armies where id=p_target_id;
    if not found then raise exception 'Army not accessible' using errcode='22023'; end if;
    v_title := coalesce(v_arm.name,'Army');
    select exists(select 1 from public.faction_memberships
      where user_id=v_uid and faction_id=v_arm.faction_id and status='active'
      and ('military'=any(permissions) or 'all'=any(permissions))) into v_member;
    v_allowed := v_member or (v_arm.commander_character_id=v_char.id and v_char.id is not null) or exists(select 1 from public.factions f where f.id=v_arm.faction_id and f.leader_user_id=v_uid);
    v_actions := jsonb_build_array(
      jsonb_build_object('id','inspect','label','Inspect Army','category','general','enabled',true),
      jsonb_build_object('id','military','label','Issue Military Orders','category','military','enabled',v_allowed,
        'reason',case when not v_allowed then 'Requires military command authority' end)
    );
  elsif p_kind = 'faction' then
    if p_target_id is null then raise exception 'Faction ID required' using errcode='22023'; end if;
    select * into v_faction from public.factions where id=p_target_id and status='active';
    if not found then raise exception 'Faction not accessible' using errcode='22023'; end if;
    v_title := v_faction.name;
    select exists(select 1 from public.faction_memberships
      where user_id=v_uid and faction_id=p_target_id and status='active') into v_member;
    v_member := v_member or v_faction.leader_user_id=v_uid;
    v_actions := jsonb_build_array(
      jsonb_build_object('id','inspect','label','Faction Directory','category','general','enabled',true),
      jsonb_build_object('id','faction','label','Faction Administration','category','politics','enabled',v_member,
        'reason',case when not v_member then 'Requires faction membership' end)
    );
  elsif p_kind = 'character' then
    if p_target_id is null then raise exception 'Character ID required' using errcode='22023'; end if;
    select * into v_target_char from public.characters where id=p_target_id;
    if not found then raise exception 'Character not accessible' using errcode='22023'; end if;
    v_title := v_target_char.name;
    v_actions := jsonb_build_array(
      jsonb_build_object('id','inspect','label','Character Profile','category','general','enabled',true),
      jsonb_build_object('id','character','label','Manage Character','category','character',
        'enabled',v_target_char.user_id=v_uid,
        'reason',case when v_target_char.user_id<>v_uid then 'Not your character' end),
      jsonb_build_object('id','social','label','Social & Friends','category','social','enabled',true)
    );
  else
    raise exception 'Unsupported context type' using errcode='22023';
  end if;
  return jsonb_build_object('kind',p_kind,'title',v_title,'location_ref',p_location_ref,
    'target_id',p_target_id,'actions',v_actions,'version',1);
end;
$function$;
REVOKE ALL ON FUNCTION public.get_contextual_actions(text,text,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_contextual_actions(text,text,uuid) TO authenticated;
