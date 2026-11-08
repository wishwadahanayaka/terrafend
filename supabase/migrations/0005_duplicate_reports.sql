-- Duplicate reports become confirmations.
--
-- Adds:
--   1. reports.severity_updated_at, set when someone says a hazard got worse or better
--   2. report_severity_updates, a log with one row per user per report (not reachable
--      from the app, only through the function below)
--   3. similar_reports_nearby(): active reports of the same type within 100 m of a spot
--   4. update_report_severity(): the one controlled way to change a report's severity
--   5. report_confirmations(): how many people said "still there", and nothing else
--   6. reports_in_view() and reports_along_route() now also return severity_updated_at
--
-- Not run yet. Run it by hand in the SQL Editor after checking it.
-- Everything is in one transaction, so it either all applies or none of it does.

begin;


-- 1. When the severity was last changed by a user. Null means it never was.
-- The existing "grant select on public.reports" already covers a new column. Insert is
-- limited to named columns, so nobody can set this from the app. Only the function in
-- section 4 writes it.
alter table public.reports add column severity_updated_at timestamptz;


-- 2. One row per user per report, so a severity can be changed once by each person.
-- RLS is on and there are no grants and no policies on purpose: the Data API cannot read
-- or write this table at all. update_report_severity() runs as the table owner and can.
create table public.report_severity_updates (
  id           uuid primary key default gen_random_uuid(),
  report_id    uuid not null references public.reports (id) on delete cascade,
  user_id      uuid not null references auth.users (id) on delete cascade,
  new_severity text not null check (new_severity in ('passable', 'large_vehicles_only', 'blocked')),
  created_at   timestamptz not null default now(),
  unique (report_id, user_id)
);

alter table public.report_severity_updates enable row level security;
revoke all on public.report_severity_updates from public, anon, authenticated;

-- For the hourly limit below
create index report_severity_updates_user_idx on public.report_severity_updates (user_id, created_at);


-- 3. Active reports of one type close to a spot, nearest first. The report form calls this
-- once a hazard type is chosen. It runs as the caller (no security definer), so the read
-- policy on reports still hides expired and cleared reports; the status and expiry checks
-- below just say the same thing out loud.
-- st_dwithin on geography is in metres and uses the spatial index.
create function public.similar_reports_nearby(
  p_lat         double precision,
  p_lng         double precision,
  p_hazard_type text,
  p_radius_m    double precision default 100
)
returns table (
  id                  uuid,
  hazard_type         text,
  severity            text,
  lat                 double precision,
  lng                 double precision,
  created_at          timestamptz,
  expires_at          timestamptz,
  severity_updated_at timestamptz,
  distance_m          double precision
)
language plpgsql
stable
set search_path = public, extensions
as $$
declare
  spot geography;
begin
  if p_lat is null or p_lng is null or p_lat not between -90 and 90 or p_lng not between -180 and 180 then
    raise exception 'p_lat and p_lng must be a valid position' using errcode = '22023';
  end if;
  if p_hazard_type is null then
    raise exception 'p_hazard_type is required' using errcode = '22023';
  end if;
  if p_radius_m is null or p_radius_m < 10 or p_radius_m > 500 then
    raise exception 'p_radius_m must be between 10 and 500' using errcode = '22023';
  end if;

  spot := st_setsrid(st_makepoint(p_lng, p_lat), 4326)::geography;

  return query
  select r.id, r.hazard_type, r.severity,
         st_y(r.location::geometry), st_x(r.location::geometry),
         r.created_at, r.expires_at, r.severity_updated_at,
         st_distance(r.location, spot)
    from public.reports r
   where r.hazard_type = p_hazard_type
     and r.status = 'active'
     and r.expires_at > now()
     and st_dwithin(r.location, spot, p_radius_m)
   order by st_distance(r.location, spot)
   limit 5;
end;
$$;

revoke all on function public.similar_reports_nearby(double precision, double precision, text, double precision) from public;
grant execute on function public.similar_reports_nearby(double precision, double precision, text, double precision) to anon, authenticated;


-- 4. Change the severity of an active report.
--
-- Users have no update rights on reports, and they still don't. This function runs with its
-- owner's rights (security definer) and only ever sets two columns: severity and
-- severity_updated_at. created_by, location, hazard_type, note, photo_path, created_at,
-- expires_at and status are never touched. The empty search_path is the usual safety habit
-- for security definer functions, so every name below is written out in full.
--
-- Rules, each one raises an error whose message the app recognises:
--   not_signed_in        no signed-in user (anonymous sign-in counts as signed in)
--   report_not_active    the report is cleared, expired or does not exist
--   needs_still_there    the caller has not voted "still there" on it (a "gone" vote blocks it too)
--   already_updated      the caller already changed this report's severity once
--   too_many_updates     10 changes in the last hour, the same limit as reports
-- A change to the severity the report already has does nothing and is not counted.
create function public.update_report_severity(p_report_id uuid, p_severity text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller  uuid := auth.uid();
  current_severity text;
begin
  if caller is null then
    raise exception 'not_signed_in' using errcode = '28000';
  end if;
  if p_severity is null or p_severity not in ('passable', 'large_vehicles_only', 'blocked') then
    raise exception 'p_severity must be passable, large_vehicles_only or blocked' using errcode = '22023';
  end if;

  -- Locks the row, so two people changing it at the same moment take turns
  select r.severity into current_severity
    from public.reports r
   where r.id = p_report_id
     and r.status = 'active'
     and r.expires_at > now()
     for update;

  if not found then
    raise exception 'report_not_active' using errcode = 'P0001';
  end if;

  -- Whoever says it is worse or better has to have said it is still there
  if not exists (
    select 1 from public.report_votes v
     where v.report_id = p_report_id
       and v.user_id = caller
       and v.vote = 'still_there'
  ) then
    raise exception 'needs_still_there' using errcode = 'P0001';
  end if;

  if current_severity = p_severity then
    return current_severity;
  end if;

  if exists (
    select 1 from public.report_severity_updates u
     where u.report_id = p_report_id and u.user_id = caller
  ) then
    raise exception 'already_updated' using errcode = 'P0001';
  end if;

  if (select count(*) from public.report_severity_updates u
       where u.user_id = caller and u.created_at > now() - interval '1 hour') >= 10 then
    raise exception 'too_many_updates' using errcode = 'P0001';
  end if;

  insert into public.report_severity_updates (report_id, user_id, new_severity)
  values (p_report_id, caller, p_severity);

  update public.reports r
     set severity = p_severity,
         severity_updated_at = now()
   where r.id = p_report_id;

  return p_severity;
end;
$$;

revoke all on function public.update_report_severity(uuid, text) from public, anon;
grant execute on function public.update_report_severity(uuid, text) to authenticated;


-- 5. How many people said "still there". Votes are private (people only see their own), so
-- this runs as the owner and hands back a single number, never who voted. It answers 0 for
-- a report that is not active, so it tells nothing about reports the read policy hides.
create function public.report_confirmations(p_report_id uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::integer
    from public.report_votes v
   where v.report_id = p_report_id
     and v.vote = 'still_there'
     and exists (
       select 1 from public.reports r
        where r.id = p_report_id
          and r.status = 'active'
          and r.expires_at > now()
     );
$$;

revoke all on function public.report_confirmations(uuid) from public;
grant execute on function public.report_confirmations(uuid) to anon, authenticated;


-- 6. The two list functions get one more column. A function's result columns cannot be
-- changed in place, so each is dropped and created again, then granted again.

drop function public.reports_in_view(double precision, double precision, double precision, double precision);

create function public.reports_in_view(
  min_lng double precision,
  min_lat double precision,
  max_lng double precision,
  max_lat double precision
)
returns table (
  id                  uuid,
  hazard_type         text,
  severity            text,
  note                text,
  lat                 double precision,
  lng                 double precision,
  created_at          timestamptz,
  expires_at          timestamptz,
  photo_path          text,
  severity_updated_at timestamptz
)
language sql
stable
set search_path = public, extensions
as $$
  select r.id, r.hazard_type, r.severity, r.note,
         st_y(r.location::geometry), st_x(r.location::geometry),
         r.created_at, r.expires_at, r.photo_path, r.severity_updated_at
    from public.reports r
   where r.location && st_makeenvelope(min_lng, min_lat, max_lng, max_lat, 4326)::geography
   order by r.created_at desc
   limit 500;
$$;

revoke all on function public.reports_in_view(double precision, double precision, double precision, double precision) from public;
grant execute on function public.reports_in_view(double precision, double precision, double precision, double precision) to anon, authenticated;


drop function public.reports_along_route(jsonb, double precision);

create function public.reports_along_route(
  route    jsonb,
  buffer_m double precision default 150
)
returns table (
  id                    uuid,
  hazard_type           text,
  severity              text,
  note                  text,
  lat                   double precision,
  lng                   double precision,
  created_at            timestamptz,
  expires_at            timestamptz,
  photo_path            text,
  severity_updated_at   timestamptz,
  distance_along_m      double precision,
  distance_from_route_m double precision
)
language plpgsql
stable
set search_path = public, extensions
as $$
declare
  line      geometry;
  line_geog geography;
  points    integer;
begin
  if route is null or jsonb_typeof(route) <> 'object' or route ->> 'type' is distinct from 'LineString' then
    raise exception 'route must be a GeoJSON LineString' using errcode = '22023';
  end if;
  if jsonb_typeof(route -> 'coordinates') is distinct from 'array' then
    raise exception 'route needs a coordinates array' using errcode = '22023';
  end if;

  points := jsonb_array_length(route -> 'coordinates');
  if points < 2 or points > 20000 then
    raise exception 'route must have between 2 and 20000 points' using errcode = '22023';
  end if;

  if buffer_m is null or buffer_m < 25 or buffer_m > 500 then
    raise exception 'buffer_m must be between 25 and 500' using errcode = '22023';
  end if;

  line := st_setsrid(st_geomfromgeojson(route::text), 4326);
  line_geog := line::geography;

  return query
  with nearby as (
    select r.*,
           st_linelocatepoint(line, r.location::geometry) as fraction
      from public.reports r
     where st_dwithin(r.location, line_geog, buffer_m)
  )
  select n.id, n.hazard_type, n.severity, n.note,
         st_y(n.location::geometry), st_x(n.location::geometry),
         n.created_at, n.expires_at, n.photo_path, n.severity_updated_at,
         st_length(st_linesubstring(line, 0, n.fraction)::geography),
         st_distance(n.location, line_geog)
    from nearby n
   order by n.fraction
   limit 200;
end;
$$;

revoke all on function public.reports_along_route(jsonb, double precision) from public;
grant execute on function public.reports_along_route(jsonb, double precision) to anon, authenticated;


commit;
