-- Study app: run this once in Supabase → SQL Editor → New query → Run.
-- Every record (decks, cards, sets, timetable sessions, targets…) is stored as jsonb.

create sequence if not exists public.records_seq;

create table if not exists public.records (
  user_id    uuid   not null default auth.uid() references auth.users (id) on delete cascade,
  id         text   not null,
  kind       text   not null,
  data       jsonb  not null,
  updated_at bigint not null,            -- client timestamp (ms) used for last-write-wins
  deleted    boolean not null default false,
  seq        bigint not null default nextval('public.records_seq'),
  primary key (user_id, id)
);

create index if not exists records_user_seq on public.records (user_id, seq);

alter table public.records enable row level security;

drop policy if exists "own records" on public.records;
create policy "own records" on public.records
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Upsert a batch, keeping whichever version is newer. Bumps seq so other devices pull it.
create or replace function public.push_records(rows jsonb)
returns void
language sql
security invoker
set search_path = public
as $$
  insert into public.records as r (user_id, id, kind, data, updated_at, deleted, seq)
  select auth.uid(), x->>'id', x->>'kind', x->'data', (x->>'updated_at')::bigint,
         coalesce((x->>'deleted')::boolean, false), nextval('public.records_seq')
  from jsonb_array_elements(rows) as x
  on conflict (user_id, id) do update
    set kind = excluded.kind,
        data = excluded.data,
        updated_at = excluded.updated_at,
        deleted = excluded.deleted,
        seq = excluded.seq
    where r.updated_at <= excluded.updated_at;
$$;

grant execute on function public.push_records(jsonb) to authenticated;
grant usage on sequence public.records_seq to authenticated;

-- Live updates between devices
do $$ begin
  alter publication supabase_realtime add table public.records;
exception when duplicate_object then null;
end $$;
