-- Alpha 0.5.0 Phase 1: preserve full existing heartbeat and append civilian processing.
CREATE OR REPLACE FUNCTION private.world_clock_heartbeat()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  payload jsonb;
  current_index bigint;
  previous_index bigint;
  idx bigint;
  current_day_index bigint;
  previous_day_index bigint;
  day_idx bigint;
  inserted_count integer:=0;
  daily_count integer:=0;
  movement_result jsonb;
  economy_result jsonb:='[]'::jsonb;
  daily_facility_result jsonb:='[]'::jsonb;
  political_result jsonb;
  passive_result integer:=0;
  factory_result jsonb:='[]'::jsonb;
  chat_deleted integer:=0;
begin
  delete from public.game_chat_messages
  where channel='global'
    and expires_at is not null
    and expires_at<=now();
  get diagnostics chat_deleted = row_count;

  payload:=private.world_clock_payload(now());
  current_index:=(payload->>'cycle_index')::bigint;
  current_day_index:=floor((payload->>'total_world_hours')::numeric / 36.0)::bigint;

  select last_cycle_index,last_day_index
  into previous_index,previous_day_index
  from public.world_automation_state
  where singleton=true
  for update;

  if previous_index is null then previous_index:=current_index; end if;
  if previous_day_index is null then previous_day_index:=current_day_index; end if;

  if current_day_index>previous_day_index then
    for day_idx in previous_day_index+1..current_day_index loop
      daily_facility_result:=daily_facility_result||jsonb_build_array(
        private.process_daily_facility_upkeep_internal(day_idx,day_idx::numeric*36)
      );
      perform private.process_civilian_day(day_idx);
      daily_count:=daily_count+1;
    end loop;
  end if;

  if current_index>previous_index then
    for idx in previous_index+1..current_index loop
      insert into public.world_cycle_log(cycle_index,aevum,cycle,crossed_at,processed_at)
      values(idx,floor(idx/13.0)::integer,mod(idx,13)::integer+1,now(),now())
      on conflict(cycle_index) do nothing;

      economy_result:=economy_result||jsonb_build_array(private.run_economy_cycle(idx));
      inserted_count:=inserted_count+1;
    end loop;
  end if;

  passive_result:=public.process_passive_facility_production();
  factory_result:=private.process_due_factory_production();
  movement_result:=private.process_due_movements_and_operations();
  political_result:=private.process_political_timers();
  perform private.expire_civilian_assignments();

  update public.world_automation_state
  set last_cycle_index=current_index,
      last_day_index=current_day_index,
      last_heartbeat=now(),
      updated_at=now()
  where singleton=true;

  return jsonb_build_object(
    'cycle_index',current_index,
    'day_index',current_day_index,
    'cycles_recorded',inserted_count,
    'days_recorded',daily_count,
    'world_clock',payload,
    'daily_facilities',daily_facility_result,
    'passive_production',passive_result,
    'factory_production',factory_result,
    'movement',movement_result,
    'economy',economy_result,
    'politics',political_result,
    'expired_global_messages_deleted',chat_deleted
  );
end
$function$

