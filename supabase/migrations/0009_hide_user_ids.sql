-- Nobody can link reports, votes or photos to the same anonymous user.
--
-- There are no accounts, but an anonymous user's id is still a movement trail: anyone with the
-- public key could read reports.created_by and group every report one browser ever made. This
-- closes the two places the id could leak to another user:
--   1. reports.created_by was readable (0001 granted select on the whole table).
--   2. Photos were stored as <user id>/<name>, so the id sat in photo_path and the public photo URL.
--
-- What this does:
--   * reports: select is granted for named columns only. created_by is left out, and so is any
--     column added later until it is added to the list on purpose. Row rules (RLS) are untouched.
--   * reports_along_route() used "select r.*", which would fail without created_by. It now names
--     its columns. Everything else about it is the same as in 0005.
--   * New photos get a random name with no user id and no folder: <uuid>.jpg. Who uploaded a photo
--     is read from the owner Storage records on the object (owner_id), through owns_report_photo(),
--     so a report can still only point at a photo its own author uploaded.
--   * The OLD <your id>/<name> paths are still accepted for now, because an installed copy of the
--     app only updates when its owner taps "New version available". A later migration removes the
--     old style after a grace period of about two weeks (planned for 29 Nov 2026). It takes the next
--     free number after the landslide migration (0010 is the news feed, 0011 the landslide warnings).
--
-- Carried over unchanged in the reports insert policy: created_by = auth.uid(), the 10 reports an
-- hour limit (recent_report_count() < 10) and the old photo_path pattern. The Sri Lanka bounds check
-- is a table constraint (reports_location_in_sri_lanka), not part of the policy, so it is not touched.
--
-- Existing photos are NOT moved: reports last 6 hours unless people keep confirming them, and the
-- hourly cleanup deletes a report's photo once it has ended.
--
-- Builds on 0005 to 0008, which are already run (it uses reports.severity_updated_at). Not run yet. Try it with
-- supabase/checks/0009_dry_run.sql first (it undoes everything), then run this by hand in the
-- SQL Editor. Everything is in one transaction, so it either all applies or none of it does.

begin;


-- 0. Stop early, and change nothing, if the table isn't what this file expects. A column added by
-- hand would otherwise silently become unreadable for the app.
do $$
declare
  unknown_columns text;
begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'reports' and column_name = 'severity_updated_at'
  ) then
    raise exception '0009 needs migration 0005 first (reports.severity_updated_at is missing)';
  end if;

  select string_agg(column_name, ', ') into unknown_columns
    from information_schema.columns
   where table_schema = 'public' and table_name = 'reports'
     and column_name not in (
       'id', 'created_by', 'hazard_type', 'severity', 'note', 'location', 'photo_path',
       'created_at', 'expires_at', 'status', 'severity_updated_at'
     );
  if unknown_columns is not null then
    raise exception '0009 does not know these reports columns: %. Add them to the grant below (or leave them out on purpose), then run it again.', unknown_columns;
  end if;
end;
$$;


-- 1. Column-level select. Revoking at table level also removes any column-level grants, so this
-- can be run again. New columns stay unreadable until they are added to this list.
-- Insert is already limited to named columns (0001) and service_role keeps its own table-level
-- grant (0003), so the cleanup function is not affected.
revoke select on public.reports from anon, authenticated;

grant select (
  id, hazard_type, severity, note, location, photo_path,
  created_at, expires_at, status, severity_updated_at
) on public.reports to anon, authenticated;


-- 2. Same signature, columns, rules and grants as in 0005. The only change is the CTE, which names
-- its columns instead of r.*. The function runs as the caller, and a star would include created_by.
-- Same return type, so create or replace is enough and the grants stay.
create or replace function public.reports_along_route(
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
    select r.id, r.hazard_type, r.severity, r.note, r.location,
           r.created_at, r.expires_at, r.photo_path, r.severity_updated_at,
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


-- 3. Photos.
-- Does this photo belong to the caller? Storage records the uploader on the object (owner_id), so
-- ownership no longer needs the user id in the file name. Security definer because the caller can't
-- read storage.objects. It only ever answers about the caller's own uploads, and says nothing about
-- anyone else's. Both sides are cast to text so it works whichever type owner_id has.
create or replace function public.owns_report_photo(p_path text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from storage.objects o
     where o.bucket_id = 'report-photos'
       and o.name = p_path
       and o.owner_id::text = auth.uid()::text
  );
$$;

revoke all on function public.owns_report_photo(text) from public, anon;
grant execute on function public.owns_report_photo(text) to authenticated;


-- Uploads: a random <uuid>.jpg at the top of the bucket, or (until the photo-path cleanup, the next
-- free migration number after the landslide migration) the old folder named after
-- the caller's own id. There are still no select, update or delete policies, so nobody can list
-- the bucket or replace a file that is already there.
drop policy if exists "Users upload photos into their own folder" on storage.objects;
drop policy if exists "Signed-in users upload photos" on storage.objects;

create policy "Signed-in users upload photos"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'report-photos'
    and (
      name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jpg$'
      or (storage.foldername(name))[1] = auth.uid()::text
    )
  );


-- The reports insert policy. Kept from 0001 and 0002: created_by = auth.uid(), at most 10 reports an
-- hour, and the old photo rule (<your id>/<name>.<jpg|jpeg|png|webp>, no extra slashes or dots).
-- Added: a photo_path that is a random <uuid>.jpg is accepted when the caller uploaded it.
alter policy "Signed-in users create their own reports"
  on public.reports
  with check (
    created_by = auth.uid()
    and public.recent_report_count() < 10
    and (
      photo_path is null
      or photo_path ~ ('^' || auth.uid()::text || '/[A-Za-z0-9_-]+\.(jpg|jpeg|png|webp)$')
      or (
        photo_path ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jpg$'
        and public.owns_report_photo(photo_path)
      )
    )
  );


-- 4. Stop, and undo everything, if the grants aren't what they should be.
do $$
begin
  if has_table_privilege('anon', 'public.reports', 'select')
     or has_table_privilege('authenticated', 'public.reports', 'select') then
    raise exception '0009: reports is still readable as a whole table';
  end if;
  if has_column_privilege('anon', 'public.reports', 'created_by', 'select')
     or has_column_privilege('authenticated', 'public.reports', 'created_by', 'select') then
    raise exception '0009: created_by is still readable';
  end if;
  if has_column_privilege('authenticated', 'public.reports', 'created_by', 'insert')
     or has_column_privilege('anon', 'public.reports', 'created_by', 'update')
     or has_column_privilege('authenticated', 'public.reports', 'created_by', 'update') then
    raise exception '0009: created_by can be written from the app';
  end if;
  if not has_column_privilege('anon', 'public.reports', 'location', 'select')
     or not has_column_privilege('authenticated', 'public.reports', 'expires_at', 'select')
     or not has_column_privilege('authenticated', 'public.reports', 'id', 'select') then
    raise exception '0009: the columns the map needs are not readable';
  end if;
end;
$$;

-- PostgREST reads grants when it starts; this makes it look again now
notify pgrst, 'reload schema';


commit;
