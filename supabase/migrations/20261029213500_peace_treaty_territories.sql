
create table if not exists public.military_occupation_claims(
 id uuid primary key default gen_random_uuid(),
 war_id uuid not null references public.military_wars(id),
 operation_id uuid not null unique references public.military_operations(id),
 location_ref text not null references public.territories(location_ref),
 original_faction_id uuid not null references public.factions(id),
 occupying_faction_id uuid not null references public.factions(id),
 status text not null default 'occupied' check(status in ('occupied','retained','restored')),
 created_at timestamptz not null default now(),settled_at timestamptz
);
create index if not exists military_occupation_by_war on public.military_occupation_claims(war_id,status);
alter table public.military_occupation_claims enable row level security;
revoke all on public.military_occupation_claims from public,anon,authenticated;
grant select on public.military_occupation_claims to authenticated;
create policy "Signed-in players inspect contested claims" on public.military_occupation_claims
 for select to authenticated using (true);
do $patch$
declare body text;
begin
 body:=pg_get_functiondef('private.resolve_due_battles()'::regprocedure);
 if position('update public.military_wars set' in body)=0 then raise exception 'Battle war score integration changed';end if;
 body:=replace(body,'update public.military_wars set',
 $frag$if win and op.operation_type='conquest' then
   insert into public.military_occupation_claims(war_id,operation_id,location_ref,original_faction_id,occupying_faction_id)
   values(war_id,op.id,op.target_ref,op.defender_faction_id,op.attacker_faction_id)
   on conflict(operation_id) do nothing;
  end if;
  update public.military_wars set$frag$);
 execute body;
 body:=pg_get_functiondef('private.respond_war_peace(uuid,boolean)'::regprocedure);
 if position('if p_accept then' in body)=0 then raise exception 'Peace resolution integration changed';end if;
 body:=replace(body,'if p_accept then',
 $frag$if p_accept then
   -- White peace returns all captures; faction victories keep only winner captures.
   -- Only restore a location if the occupation's holder still controls it.
   update public.territories t set faction_id=c.original_faction_id,status='active',updated_at=now()
   from public.military_occupation_claims c
   where c.war_id=w.id and c.status='occupied' and t.location_ref=c.location_ref
     and t.faction_id=c.occupying_faction_id
     and (prop.terms='white_peace' or
       (prop.terms='attacker_victory' and c.occupying_faction_id<>w.attacker_faction_id) or
       (prop.terms='defender_victory' and c.occupying_faction_id<>w.defender_faction_id));
   update public.military_occupation_claims c
   set status=case when prop.terms='white_peace' or
       (prop.terms='attacker_victory' and c.occupying_faction_id<>w.attacker_faction_id) or
       (prop.terms='defender_victory' and c.occupying_faction_id<>w.defender_faction_id)
       then 'restored' else 'retained' end,settled_at=now()
   where c.war_id=w.id and c.status='occupied';$frag$);
 execute body;
end;$patch$;
