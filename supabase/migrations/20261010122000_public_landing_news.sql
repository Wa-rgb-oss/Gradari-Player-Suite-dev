-- Public landing page access to public Gradari Mireris news.
-- Only columns needed by logged-out visitors are exposed, and RLS restricts rows to visibility='public'.

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname='public'
      and tablename='game_news'
      and policyname='Public visitors read public news'
  ) then
    create policy "Public visitors read public news"
      on public.game_news
      for select
      to anon
      using (visibility = 'public');
  end if;
end
$$;

grant select (id,title,body,content_sections,published_at,updated_at,visibility)
on public.game_news to anon;
