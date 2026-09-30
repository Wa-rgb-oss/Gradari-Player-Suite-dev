create table if not exists public.trade_station_resource_listings (
  market_id uuid not null references public.trade_station_markets(market_id) on delete cascade,
  resource_code text not null references public.resource_catalog(code),
  buy_price numeric not null check (buy_price>=0),
  sell_price numeric not null check (sell_price>=0),
  stock numeric null check (stock is null or stock>=0),
  primary key(market_id,resource_code)
);

alter table public.trade_station_resource_listings enable row level security;
do $$ begin
 create policy "authenticated read trade station resources" on public.trade_station_resource_listings
 for select to authenticated using (true);
exception when duplicate_object then null; end $$;
do $$ begin
 create policy "admin trade station resources" on public.trade_station_resource_listings
 for all to authenticated using (public.is_admin()) with check (public.is_admin());
exception when duplicate_object then null; end $$;

create or replace function public.trade_station_resource(
  p_market_id uuid,p_resource_code text,p_quantity numeric,p_direction text
) returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_user uuid:=auth.uid();
  v_faction uuid;
  v_listing trade_station_resource_listings%rowtype;
  v_balance numeric;
  v_owned numeric;
  v_cost numeric;
begin
  if p_quantity<=0 then raise exception 'Quantity must be greater than zero.'; end if;
  select faction_id into v_faction from faction_memberships
  where user_id=v_user and status='active' order by created_at asc limit 1;
  if v_faction is null then raise exception 'An active faction is required.'; end if;

  select * into v_listing from trade_station_resource_listings
  where market_id=p_market_id and resource_code=p_resource_code for update;
  if v_listing.market_id is null then raise exception 'Resource is not traded at this station.'; end if;

  if lower(p_direction)='buy' then
    if v_listing.stock is not null and v_listing.stock<p_quantity then raise exception 'Insufficient station stock.'; end if;
    v_cost:=v_listing.buy_price*p_quantity;
    select balance into v_balance from player_wallets where user_id=v_user for update;
    if coalesce(v_balance,0)<v_cost then raise exception 'Insufficient Aureum.'; end if;
    update player_wallets set balance=balance-v_cost where user_id=v_user;
    perform add_faction_resource(v_faction,p_resource_code,p_quantity);
    if v_listing.stock is not null then
      update trade_station_resource_listings set stock=stock-p_quantity where market_id=p_market_id and resource_code=p_resource_code;
    end if;
    return jsonb_build_object('direction','buy','quantity',p_quantity,'value',v_cost);
  elsif lower(p_direction)='sell' then
    select quantity into v_owned from faction_resources where faction_id=v_faction and resource_code=p_resource_code for update;
    if coalesce(v_owned,0)<p_quantity then raise exception 'Insufficient faction stock.'; end if;
    v_cost:=v_listing.sell_price*p_quantity;
    perform add_faction_resource(v_faction,p_resource_code,-p_quantity);
    update player_wallets set balance=balance+v_cost where user_id=v_user;
    if v_listing.stock is not null then
      update trade_station_resource_listings set stock=stock+p_quantity where market_id=p_market_id and resource_code=p_resource_code;
    end if;
    return jsonb_build_object('direction','sell','quantity',p_quantity,'value',v_cost);
  end if;
  raise exception 'Direction must be buy or sell.';
end $$;

grant execute on function public.trade_station_resource(uuid,text,numeric,text) to authenticated;
