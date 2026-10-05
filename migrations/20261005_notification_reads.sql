-- Gradari Mireris notification read-state
create table if not exists public.game_notification_reads (
  user_id uuid not null references auth.users(id) on delete cascade,
  notification_type text not null,
  source_id text not null,
  read_at timestamptz not null default now(),
  primary key (user_id, notification_type, source_id)
);

alter table public.game_notification_reads enable row level security;

drop policy if exists "Players read own notification reads" on public.game_notification_reads;
create policy "Players read own notification reads"
on public.game_notification_reads for select to authenticated
using (auth.uid() = user_id);

drop policy if exists "Players create own notification reads" on public.game_notification_reads;
create policy "Players create own notification reads"
on public.game_notification_reads for insert to authenticated
with check (auth.uid() = user_id);

drop policy if exists "Players update own notification reads" on public.game_notification_reads;
create policy "Players update own notification reads"
on public.game_notification_reads for update to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create index if not exists game_notification_reads_user_idx
on public.game_notification_reads(user_id, read_at desc);
