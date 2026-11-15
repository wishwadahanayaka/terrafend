-- Dry run of migration 0009: applies all of it, tests it, then undoes everything.
--
-- Nothing is kept. There is no commit anywhere in this file. It ends with an error on purpose
-- (see the bottom): the error message is the report, and an error also rolls the transaction
-- back, so even if the closing "rollback" is never reached, nothing is saved.
--
-- Run it by hand in the SQL Editor. It builds on 0005 to 0008, which are already run.
-- Paste the report back if any line says FAIL.
--
-- The part between "begin;" and the tests is the body of 0009, word for word. A unit test
-- (src/lib/migrations.test.ts) checks that the two files stay the same, so if 0009 changes, copy
-- its body here again.
--
-- How the tests work:
--   * Two throwaway users (A and B) are made inside the transaction. If that isn't allowed here,
--     two existing anonymous users are used instead.
--   * public.t0009_try() runs one statement as a role (anon, authenticated, service_role) with a
--     user id, and reports "ok:<rows>" or the error. The statement runs inside a plpgsql block
--     with an exception handler, which is a savepoint under the hood: an expected "permission
--     denied" is caught there and cannot stop the checks after it.
--   * public.t0009_expect() turns that into a PASS / FAIL line, kept in a log that is printed at
--     the end.
--
-- The files in storage are checked as far as the database goes (the upload policy and the
-- owner check). Storage's own API, which fills in owner_id, can't be run from here: see
-- supabase/checks/privacy.sql for the owner_id check on real uploads.

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


-- Uploads: a random <uuid>.jpg at the top of the bucket, or (until 0011) the old folder named after
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


-- ======================================================================
-- Tests. Everything below is undone with the rest.
-- ======================================================================

-- Helpers. They live in public only until the rollback.
create function public.t0009_note(status text, label text)
returns void
language plpgsql
as $$
begin
  perform set_config(
    't0009.log',
    coalesce(current_setting('t0009.log', true), '') || rpad(status, 6) || label || E'\n',
    true
  );
  raise notice '% %', status, label;
end;
$$;

create function public.t0009_true(label text, ok boolean)
returns void
language sql
as $$
  select public.t0009_note(case when coalesce(ok, false) then 'PASS' else 'FAIL' end, label);
$$;

-- Runs one statement as a role and says how it went: "ok:<rows>" or "<sqlstate>: <message>".
-- The inner begin ... exception block is a savepoint, so a refused statement stops nothing else.
create function public.t0009_try(r text, uid uuid, stmt text)
returns text
language plpgsql
as $$
declare
  n       bigint;
  outcome text;
begin
  begin
    perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', r)::text, true);
    perform set_config('request.jwt.claim.sub', coalesce(uid::text, ''), true);
    execute 'set local role ' || quote_ident(r);
    execute stmt;
    get diagnostics n = row_count;
    outcome := 'ok:' || n;
  exception when others then
    outcome := sqlstate || ': ' || sqlerrm;
  end;
  reset role;
  return outcome;
end;
$$;

-- want: ok (ran, any rows), some (ran, at least one row), none (ran, no rows),
--       refused (permission denied, or a row-level security refusal: both are 42501),
--       none_or_refused
create function public.t0009_expect(label text, got text, want text)
returns void
language plpgsql
as $$
declare
  passed boolean;
begin
  passed := case want
    when 'ok'             then got ~ '^ok:'
    when 'some'           then got ~ '^ok:[1-9]'
    when 'none'           then got = 'ok:0'
    when 'refused'        then got like '42501%'
    when 'none_or_refused' then got = 'ok:0' or got like '42501%'
    else false
  end;
  perform public.t0009_note(case when passed then 'PASS' else 'FAIL' end, label ||
    case when passed then '' else '  (wanted ' || want || ', got ' || got || ')' end);
end;
$$;


-- Two users. Made here and undone by the rollback. If that isn't allowed, use two that exist.
do $$
declare
  ua uuid := gen_random_uuid();
  ub uuid := gen_random_uuid();
begin
  begin
    insert into auth.users (id, aud, role, is_anonymous, created_at, updated_at)
    values (ua, 'authenticated', 'authenticated', true, now(), now()),
           (ub, 'authenticated', 'authenticated', true, now(), now());
    perform public.t0009_note('INFO', 'made two throwaway users (undone at the end)');
  exception when others then
    select id into ua from auth.users where is_anonymous order by created_at limit 1;
    select id into ub from auth.users where is_anonymous and id <> ua order by created_at limit 1;
    perform public.t0009_note('INFO', 'could not make users (' || sqlerrm || '), using existing anonymous users. A FAIL below about the 10 an hour limit could just mean one of them reported recently.');
  end;
  if ua is null or ub is null then
    raise exception 'The dry run needs two users and found none to use';
  end if;
  perform set_config('t0009.ua', ua::text, true);
  perform set_config('t0009.ub', ub::text, true);
end;
$$;


-- A. The grants, read from the catalog
select public.t0009_true('anon cannot select created_by (column grant)',
  not has_column_privilege('anon', 'public.reports', 'created_by', 'select'));
select public.t0009_true('authenticated cannot select created_by (column grant)',
  not has_column_privilege('authenticated', 'public.reports', 'created_by', 'select'));
select public.t0009_true('nobody has table-wide select on reports',
  not has_table_privilege('anon', 'public.reports', 'select')
  and not has_table_privilege('authenticated', 'public.reports', 'select'));
select public.t0009_true('the app still cannot write created_by',
  not has_column_privilege('authenticated', 'public.reports', 'created_by', 'insert')
  and not has_column_privilege('authenticated', 'public.reports', 'created_by', 'update'));
select public.t0009_true('the 10 columns the map needs are readable by anon and authenticated',
  (select count(*) from information_schema.columns
    where table_schema = 'public' and table_name = 'reports'
      and has_column_privilege('anon', 'public.reports', column_name, 'select')
      and has_column_privilege('authenticated', 'public.reports', column_name, 'select')) = 10);
select public.t0009_true('service_role can still read created_by (the cleanup function)',
  has_column_privilege('service_role', 'public.reports', 'created_by', 'select'));


-- B. Reading reports through the API
select public.t0009_expect('anon: select id, hazard_type works',
  public.t0009_try('anon', null, 'select id, hazard_type from public.reports limit 1'), 'ok');
select public.t0009_expect('anon: select created_by is refused',
  public.t0009_try('anon', null, 'select created_by from public.reports limit 1'), 'refused');
select public.t0009_expect('anon: select * is refused',
  public.t0009_try('anon', null, 'select * from public.reports limit 1'), 'refused');
select public.t0009_expect('anon: filtering on created_by is refused',
  public.t0009_try('anon', null, 'select id from public.reports where created_by is not null'), 'refused');
select public.t0009_expect('anon: ordering by created_by is refused',
  public.t0009_try('anon', null, 'select id from public.reports order by created_by limit 1'), 'refused');
select public.t0009_expect('authenticated: select created_by is refused',
  public.t0009_try('authenticated', current_setting('t0009.ua')::uuid, 'select created_by from public.reports limit 1'), 'refused');
select public.t0009_expect('authenticated: select * is refused',
  public.t0009_try('authenticated', current_setting('t0009.ua')::uuid, 'select * from public.reports limit 1'), 'refused');
select public.t0009_expect('authenticated: select id, severity, location works',
  public.t0009_try('authenticated', current_setting('t0009.ua')::uuid, 'select id, severity, location from public.reports limit 1'), 'ok');


-- C. Sending reports. The insert policy mentions created_by, which can no longer be selected:
-- the first insert shows that the policy still works.
select public.t0009_expect('A: a plain report goes in (insert policy with created_by still works)',
  public.t0009_try('authenticated', current_setting('t0009.ua')::uuid,
    $q$ insert into public.reports (hazard_type, severity, note, location)
        values ('other', 'passable', 't0009-plain', 'SRID=4326;POINT(80.0 7.0)') $q$), 'ok');
select public.t0009_expect('A: writing created_by as B is refused',
  public.t0009_try('authenticated', current_setting('t0009.ua')::uuid,
    $q$ insert into public.reports (hazard_type, severity, location, created_by)
        values ('other', 'passable', 'SRID=4326;POINT(80.0 7.0)', current_setting('t0009.ub')::uuid) $q$), 'refused');
select public.t0009_expect('A: old-style photo path <A>/x.jpg is still accepted',
  public.t0009_try('authenticated', current_setting('t0009.ua')::uuid,
    $q$ insert into public.reports (hazard_type, severity, location, photo_path)
        values ('other', 'passable', 'SRID=4326;POINT(80.0 7.0)', current_setting('t0009.ua') || '/x.jpg') $q$), 'ok');
select public.t0009_expect('A: old-style photo path <B>/x.jpg is refused',
  public.t0009_try('authenticated', current_setting('t0009.ua')::uuid,
    $q$ insert into public.reports (hazard_type, severity, location, photo_path)
        values ('other', 'passable', 'SRID=4326;POINT(80.0 7.0)', current_setting('t0009.ub') || '/x.jpg') $q$), 'refused');

-- A photo A uploaded (owner_id is what Storage's API records for the uploader)
select public.t0009_expect('fixture: a photo object owned by A',
  public.t0009_try('postgres', null,
    $q$ insert into storage.objects (bucket_id, name, owner_id)
        values ('report-photos', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.jpg', current_setting('t0009.ua')) $q$), 'ok');
select public.t0009_true('owns_report_photo: true for A on A''s photo, false for B',
  (select public.t0009_try('authenticated', current_setting('t0009.ua')::uuid,
     $q$ select 1 where public.owns_report_photo('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.jpg') $q$) = 'ok:1')
  and (select public.t0009_try('authenticated', current_setting('t0009.ub')::uuid,
     $q$ select 1 where public.owns_report_photo('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.jpg') $q$) = 'ok:0'));
select public.t0009_expect('A: a report with its own new-style photo goes in',
  public.t0009_try('authenticated', current_setting('t0009.ua')::uuid,
    $q$ insert into public.reports (hazard_type, severity, location, photo_path)
        values ('other', 'passable', 'SRID=4326;POINT(80.0 7.0)', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.jpg') $q$), 'ok');
select public.t0009_expect('B: using A''s photo is refused',
  public.t0009_try('authenticated', current_setting('t0009.ub')::uuid,
    $q$ insert into public.reports (hazard_type, severity, location, photo_path)
        values ('other', 'passable', 'SRID=4326;POINT(80.0 7.0)', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.jpg') $q$), 'refused');
select public.t0009_expect('A: a photo name nobody uploaded is refused',
  public.t0009_try('authenticated', current_setting('t0009.ua')::uuid,
    $q$ insert into public.reports (hazard_type, severity, location, photo_path)
        values ('other', 'passable', 'SRID=4326;POINT(80.0 7.0)', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb.jpg') $q$), 'refused');
-- One statement per path, because a single insert is refused as a whole if any row is
do $$
declare
  p text;
begin
  foreach p in array array[
    'AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA.jpg',
    '../aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.jpg',
    'x/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.jpg',
    'photo.jpg',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.png'
  ] loop
    perform public.t0009_expect('A: photo path ' || p || ' is refused',
      public.t0009_try('authenticated', current_setting('t0009.ua')::uuid,
        format($f$ insert into public.reports (hazard_type, severity, location, photo_path)
                  values ('other', 'passable', 'SRID=4326;POINT(80.0 7.0)', %L) $f$, p)),
      'refused');
  end loop;
end;
$$;

-- The hourly limit is still there: A has 3 reports now, 7 more make 10, the next one is refused
select public.t0009_expect('A: 7 more reports (up to the limit of 10 an hour)',
  public.t0009_try('authenticated', current_setting('t0009.ua')::uuid,
    $q$ insert into public.reports (hazard_type, severity, location)
        select 'other', 'passable', 'SRID=4326;POINT(80.0 7.0)' from generate_series(1, 7) $q$), 'ok');
select public.t0009_expect('A: the 11th report in an hour is refused',
  public.t0009_try('authenticated', current_setting('t0009.ua')::uuid,
    $q$ insert into public.reports (hazard_type, severity, location)
        values ('other', 'passable', 'SRID=4326;POINT(80.0 7.0)') $q$), 'refused');


-- D. Storage upload rules and listing
select public.t0009_expect('A: uploading <uuid>.jpg is allowed',
  public.t0009_try('authenticated', current_setting('t0009.ua')::uuid,
    $q$ insert into storage.objects (bucket_id, name, owner_id)
        values ('report-photos', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc.jpg', current_setting('t0009.ua')) $q$), 'ok');
select public.t0009_expect('A: uploading into the old <A>/ folder is still allowed',
  public.t0009_try('authenticated', current_setting('t0009.ua')::uuid,
    $q$ insert into storage.objects (bucket_id, name, owner_id)
        values ('report-photos', current_setting('t0009.ua') || '/y.jpg', current_setting('t0009.ua')) $q$), 'ok');
select public.t0009_expect('A: uploading into B''s folder is refused',
  public.t0009_try('authenticated', current_setting('t0009.ua')::uuid,
    $q$ insert into storage.objects (bucket_id, name, owner_id)
        values ('report-photos', current_setting('t0009.ub') || '/y.jpg', current_setting('t0009.ua')) $q$), 'refused');
select public.t0009_expect('A: uploading a name that is not a uuid is refused',
  public.t0009_try('authenticated', current_setting('t0009.ua')::uuid,
    $q$ insert into storage.objects (bucket_id, name, owner_id)
        values ('report-photos', 'holiday.jpg', current_setting('t0009.ua')) $q$), 'refused');
select public.t0009_expect('anon: cannot upload',
  public.t0009_try('anon', null,
    $q$ insert into storage.objects (bucket_id, name)
        values ('report-photos', 'dddddddd-dddd-4ddd-8ddd-dddddddddddd.jpg') $q$), 'refused');
select public.t0009_expect('anon: cannot list the photo bucket',
  public.t0009_try('anon', null, $q$ select name from storage.objects where bucket_id = 'report-photos' $q$), 'none_or_refused');
select public.t0009_expect('authenticated: cannot list the photo bucket',
  public.t0009_try('authenticated', current_setting('t0009.ua')::uuid,
    $q$ select name from storage.objects where bucket_id = 'report-photos' $q$), 'none_or_refused');
select public.t0009_expect('authenticated: cannot replace or delete a photo',
  public.t0009_try('authenticated', current_setting('t0009.ua')::uuid,
    $q$ update storage.objects set name = name where bucket_id = 'report-photos' $q$), 'none_or_refused');


-- E. The functions the app calls (route: a short line through the A's test reports at 80.0, 7.0)
select public.t0009_expect('anon: reports_along_route works and finds the test reports',
  public.t0009_try('anon', null,
    $q$ select * from public.reports_along_route('{"type":"LineString","coordinates":[[79.99,7.0],[80.01,7.0]]}'::jsonb) $q$), 'some');
select public.t0009_expect('authenticated: reports_along_route works',
  public.t0009_try('authenticated', current_setting('t0009.ub')::uuid,
    $q$ select * from public.reports_along_route('{"type":"LineString","coordinates":[[79.99,7.0],[80.01,7.0]]}'::jsonb) $q$), 'some');
select public.t0009_expect('anon: reports_in_view works',
  public.t0009_try('anon', null, 'select * from public.reports_in_view(79.9, 6.9, 80.1, 7.1)'), 'some');
select public.t0009_expect('authenticated: similar_reports_nearby works',
  public.t0009_try('authenticated', current_setting('t0009.ub')::uuid,
    $q$ select * from public.similar_reports_nearby(7.0, 80.0, 'other') $q$), 'some');
select public.t0009_expect('anon: report_confirmations works',
  public.t0009_try('anon', null,
    $q$ select public.report_confirmations(id) from public.reports where note = 't0009-plain' $q$), 'some');
select case
  when to_regprocedure('public.my_reports()') is null
    then public.t0009_note('SKIP', 'my_reports() does not exist (0006 missing)')
  else public.t0009_expect('A: my_reports() works and returns A''s reports',
    public.t0009_try('authenticated', current_setting('t0009.ua')::uuid, 'select * from public.my_reports()'), 'some')
end;
select case
  when to_regprocedure('public.my_reports()') is null
    then public.t0009_note('SKIP', 'my_reports() does not exist (0006 missing)')
  else public.t0009_expect('B: my_reports() returns nothing of A''s',
    public.t0009_try('authenticated', current_setting('t0009.ub')::uuid, 'select * from public.my_reports()'), 'none')
end;


-- F. Votes. B votes on A's report (the vote policy and the vote trigger read reports and created_by).
select public.t0009_expect('B: a vote on A''s report goes in',
  public.t0009_try('authenticated', current_setting('t0009.ub')::uuid,
    $q$ insert into public.report_votes (report_id, vote)
        select id, 'still_there' from public.reports where note = 't0009-plain' $q$), 'ok');
select public.t0009_expect('A: cannot see B''s vote',
  public.t0009_try('authenticated', current_setting('t0009.ua')::uuid, 'select 1 from public.report_votes'), 'none');
select public.t0009_expect('B: sees only their own vote',
  public.t0009_try('authenticated', current_setting('t0009.ub')::uuid, 'select user_id from public.report_votes'), 'some');
select public.t0009_expect('anon: cannot read votes at all',
  public.t0009_try('anon', null, 'select user_id from public.report_votes'), 'refused');
select case
  when to_regclass('public.report_severity_updates') is null
    then public.t0009_note('SKIP', 'report_severity_updates does not exist (0005 missing)')
  else public.t0009_expect('authenticated: report_severity_updates is closed',
    public.t0009_try('authenticated', current_setting('t0009.ua')::uuid, 'select 1 from public.report_severity_updates'), 'refused')
end;
select case
  when to_regclass('public.report_edits') is null
    then public.t0009_note('SKIP', 'report_edits does not exist (0006 missing)')
  else public.t0009_expect('authenticated: report_edits is closed',
    public.t0009_try('authenticated', current_setting('t0009.ua')::uuid, 'select 1 from public.report_edits'), 'refused')
end;


-- G. The cleanup function's role keeps what it needs
select public.t0009_expect('service_role: can read created_by and photo_path',
  public.t0009_try('service_role', null, 'select id, photo_path, created_by from public.reports limit 1'), 'ok');
select public.t0009_expect('service_role: can clear a photo_path',
  public.t0009_try('service_role', null, $q$ update public.reports set photo_path = null where note = 't0009-plain' $q$), 'ok');
select public.t0009_expect('service_role: orphan_report_photos() works',
  public.t0009_try('service_role', null, 'select * from public.orphan_report_photos()'), 'ok');


-- H. Looking for other ways the id could come out
do $$
declare
  bad text;
begin
  select string_agg(p.proname, ', ') into bad
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.prokind = 'f'
     and pg_get_function_result(p.oid) ~* '\m(created_by|user_id)\M';
  perform public.t0009_true('no function in public returns a created_by or user_id column' || coalesce(' (' || bad || ')', ''), bad is null);

  select string_agg(p.proname, ', ') into bad
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.prokind = 'f' and not p.prosecdef
     and p.proname not like 't0009\_%'
     and (p.prosrc ~* '\w+\.\*' or p.prosrc ~* 'select\s+\*' or p.prosrc ~* 'created_by');
  perform public.t0009_true('no function that runs as the caller uses a star select or created_by' || coalesce(' (' || bad || ')', ''), bad is null);

  perform public.t0009_true('reports is not in the Realtime publication (it would send whole rows)',
    not exists (select 1 from pg_publication_tables
                 where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'reports'));

  perform public.t0009_note('INFO', 'storage.objects policies: ' || coalesce(
    (select string_agg(policyname || ' [' || cmd || ']', '; ') from pg_policies
      where schemaname = 'storage' and tablename = 'objects'), 'none'));
end;
$$;


-- The report. The error is on purpose: its message is the log, and an error rolls everything back.
do $$
declare
  log   text := coalesce(current_setting('t0009.log', true), '');
  fails integer;
begin
  select count(*) into fails from unnest(string_to_array(log, E'\n')) as l where l like 'FAIL%';
  raise exception E'DRY RUN FINISHED. Nothing was kept. % check(s) FAILED.\n\n%', fails, log;
end;
$$;

rollback;
