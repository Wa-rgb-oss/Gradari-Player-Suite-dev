
drop policy if exists "authenticated read ships" on public.ships;
create policy "Players inspect military ships and own civilian cargo" on public.ships for select to authenticated
using(owner_user_id is null or owner_user_id=(select auth.uid()) or (select private.is_admin()));
-- Existing admin write policy is preserved.
