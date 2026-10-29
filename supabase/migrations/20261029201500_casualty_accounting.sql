
-- Military personnel casualties are debited from their original recruiting systems.
create table if not exists public.military_casualty_ledger(
 id bigint generated always as identity primary key,
 army_id uuid not null references public.armies(id),
 origin_ref text not null references public.system_economies(location_ref),
 personnel bigint not null check(personnel>0),
 created_at timestamptz not null default now()
);
create index if not exists casualty_by_army_origin on public.military_casualty_ledger(army_id,origin_ref);
alter table public.military_casualty_ledger enable row level security;
revoke all on public.military_casualty_ledger from public,anon,authenticated;
create or replace function private.account_army_casualties(p_army_id uuid,p_losses numeric)
returns bigint language plpgsql security definer set search_path='' as $fn$
declare rec record; remain bigint:=least(100000000,ceil(greatest(0,p_losses))::bigint);take_count bigint;already bigint;assigned bigint:=0;
begin
 if remain=0 then return 0;end if;
 for rec in select location_ref,sum(personnel)::bigint enlisted
 from public.military_recruitment_log where army_id=p_army_id
 group by location_ref order by location_ref loop
  select coalesce(sum(personnel),0)::bigint into already from public.military_casualty_ledger
    where army_id=p_army_id and origin_ref=rec.location_ref;
  take_count:=least(remain,greatest(0,rec.enlisted-already));
  if take_count>0 then
   update public.system_economies set military_population=greatest(0,military_population-take_count),
      updated_at=now() where location_ref=rec.location_ref;
   insert into public.military_casualty_ledger(army_id,origin_ref,personnel) values(p_army_id,rec.location_ref,take_count);
   remain:=remain-take_count;assigned:=assigned+take_count;
  end if;
  exit when remain=0;
 end loop;
 return assigned;
end;$fn$;
revoke all on function private.account_army_casualties(uuid,numeric) from public,anon,authenticated;
do $patch$
declare body text;
begin
 body:=pg_get_functiondef('private.resolve_due_battles()'::regprocedure);
 if position('where id=att.id;' in body)=0 or position('where id=rec.id;' in body)=0 then
 raise exception 'Combat function body unexpectedly changed';end if;
 body:=replace(body,'where id=att.id;', 'where id=att.id;
  perform private.account_army_casualties(att.id,atk_loss);');
 body:=replace(body,'where id=rec.id;', 'where id=rec.id;
    perform private.account_army_casualties(rec.id,losses);');
 execute body;
end;$patch$;
