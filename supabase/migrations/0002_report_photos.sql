-- Photos on reports: a public Storage bucket, upload rules, a tighter insert
-- policy on reports, and photo_path in the map-area function.
-- 0001 has already been run, so this builds on top of it.


-- Public read is fine because reports are public too. The limits are enforced
-- by Storage itself, before the file is saved.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'report-photos',
  'report-photos',
  true,
  2097152, -- 2 MB
  array['image/jpeg', 'image/png', 'image/webp']
);

-- Uploads must go into a folder named after the user's own id:
-- <user id>/<file>. foldername(name)[1] is that first folder.
-- There are deliberately no update or delete policies, so files can't be
-- replaced or removed from the app. Public reads don't need a policy.
create policy "Users upload photos into their own folder"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'report-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );


-- Same policy as before (own created_by, max 10 reports an hour) plus a rule
-- for photo_path: empty, or <your user id>/<name>.<jpg|jpeg|png|webp>.
-- The pattern allows no extra slashes or dots in the name, so a path like
-- "<your id>/../<someone else's id>/x.jpg" can't point into another folder.
alter policy "Signed-in users create their own reports"
  on public.reports
  with check (
    created_by = auth.uid()
    and public.recent_report_count() < 10
    and (
      photo_path is null
      or photo_path ~ ('^' || auth.uid()::text || '/[A-Za-z0-9_-]+\.(jpg|jpeg|png|webp)$')
    )
  );


-- A function's return columns can't be changed in place, so drop and re-create
-- it with the same settings and grants as in 0001, plus photo_path.
drop function public.reports_in_view(double precision, double precision, double precision, double precision);

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
  expires_at  timestamptz,
  photo_path  text
)
language sql
stable
set search_path = public, extensions
as $$
  select r.id, r.hazard_type, r.severity, r.note,
         st_y(r.location::geometry), st_x(r.location::geometry),
         r.created_at, r.expires_at, r.photo_path
    from public.reports r
   where r.location && st_makeenvelope(min_lng, min_lat, max_lng, max_lat, 4326)::geography
   order by r.created_at desc
   limit 500;
$$;

revoke all on function public.reports_in_view(double precision, double precision, double precision, double precision) from public;
grant execute on function public.reports_in_view(double precision, double precision, double precision, double precision) to anon, authenticated;
