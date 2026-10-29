-- Hazard reports and votes.
-- Project settings this relies on: new tables are not auto-exposed to the
-- Data API, and RLS is switched on automatically. So every table below needs
-- explicit grants plus policies, or the app cannot reach it.

create extension if not exists postgis with schema extensions;


create table public.reports (
  id          uuid primary key default gen_random_uuid(),
  created_by  uuid not null default auth.uid() references auth.users (id) on delete cascade,
  hazard_type text not null check (hazard_type in (
    'flood',
    'landslide',
    'fallen_tree',
    'fallen_power_line',
    'road_closed',
    'accident',
    'road_works',
    'damaged_road_or_bridge',
    'wild_elephant',
    'protest_or_road_block',
    'other'
  )),
  severity    text not null check (severity in ('passable', 'large_vehicles_only', 'blocked')),
  note        text check (char_length(note) <= 280),
  location    extensions.geography(point, 4326) not null
    constraint reports_location_in_sri_lanka check (
      extensions.st_x(location::extensions.geometry) between 79.4 and 82.1
      and extensions.st_y(location::extensions.geometry) between 5.7 and 10.0
    ),
  photo_path  text,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null default now() + interval '6 hours',
  status      text not null default 'active' check (status in ('active', 'cleared'))
);

create index reports_location_idx on public.reports using gist (location);
create index reports_status_expires_idx on public.reports (status, expires_at);
create index reports_created_by_idx on public.reports (created_by, created_at);

alter table public.reports enable row level security;

grant select on public.reports to anon, authenticated;
-- Insert is limited to these columns, so a user cannot set their own
-- expires_at, status or created_by. Those come from the defaults and triggers.
grant insert (hazard_type, severity, note, location, photo_path) on public.reports to authenticated;
-- No update or delete grants at all: nobody edits or deletes reports from the app.

create policy "Anyone can read active reports"
  on public.reports for select
  to anon, authenticated
  using (status = 'active' and expires_at > now());

-- Counts the caller's reports from the last hour. It is security definer so
-- it also counts reports that were cleared and are hidden by the read policy,
-- otherwise those would not count towards the limit.
create function public.recent_report_count()
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::integer
    from public.reports
   where created_by = auth.uid()
     and created_at > now() - interval '1 hour';
$$;

revoke all on function public.recent_report_count() from public, anon;
grant execute on function public.recent_report_count() to authenticated;

-- Up to 10 reports per user per hour. A bulk insert of many rows in one
-- statement would all be counted before it runs, so this is a soft limit.
create policy "Signed-in users create their own reports"
  on public.reports for insert
  to authenticated
  with check (
    created_by = auth.uid()
    and public.recent_report_count() < 10
  );


create table public.report_votes (
  id         uuid primary key default gen_random_uuid(),
  report_id  uuid not null references public.reports (id) on delete cascade,
  user_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  vote       text not null check (vote in ('still_there', 'gone')),
  created_at timestamptz not null default now(),
  unique (report_id, user_id)
);

alter table public.report_votes enable row level security;

grant select on public.report_votes to authenticated;
grant insert (report_id, vote) on public.report_votes to authenticated;

-- Users only see their own votes, so the app can show "you already voted".
create policy "Users read their own votes"
  on public.report_votes for select
  to authenticated
  using (user_id = auth.uid());

-- The exists() check goes through the reports policy, so it only passes
-- for reports that are still active and not expired.
create policy "Signed-in users vote as themselves"
  on public.report_votes for insert
  to authenticated
  with check (
    user_id = auth.uid()
    and exists (select 1 from public.reports r where r.id = report_id)
  );


-- Votes change the report, but users have no update rights on reports.
-- security definer makes this function run with its owner's rights instead.
-- The empty search_path is a safety habit for security definer functions.
create function public.apply_vote()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.vote = 'still_there' then
    update public.reports
       set expires_at = now() + interval '6 hours'
     where id = new.report_id and status = 'active';

  elsif (select count(*) from public.report_votes
          where report_id = new.report_id and vote = 'gone') >= 3 then
    update public.reports
       set status = 'cleared'
     where id = new.report_id;
  end if;

  return null;
end;
$$;

revoke all on function public.apply_vote() from public, anon, authenticated;

create trigger report_votes_apply
  after insert on public.report_votes
  for each row execute function public.apply_vote();


-- What the frontend calls for the visible map area. Runs with the caller's
-- rights, so the read policy still hides expired and cleared reports.
-- The && operator compares bounding boxes and uses the spatial index.
create function public.reports_in_view(
  min_lng double precision,
  min_lat double precision,
  max_lng double precision,
  max_lat double precision
)
returns table (
  id          uuid,
  hazard_type text,
  severity    text,
  note        text,
  lat         double precision,
  lng         double precision,
  created_at  timestamptz,
  expires_at  timestamptz
)
language sql
stable
set search_path = public, extensions
as $$
  select r.id, r.hazard_type, r.severity, r.note,
         st_y(r.location::geometry), st_x(r.location::geometry),
         r.created_at, r.expires_at
    from public.reports r
   where r.location && st_makeenvelope(min_lng, min_lat, max_lng, max_lat, 4326)::geography
   order by r.created_at desc
   limit 500;
$$;

revoke all on function public.reports_in_view(double precision, double precision, double precision, double precision) from public;
grant execute on function public.reports_in_view(double precision, double precision, double precision, double precision) to anon, authenticated;
