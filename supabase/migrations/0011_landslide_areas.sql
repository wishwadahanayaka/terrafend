-- Official landslide warnings from NBRO (the National Building Research Organisation). Every 30
-- minutes a cron job calls the landslide-refresh Edge Function. It reads DMC's list of landslide
-- warning PDFs (the LEWM messages), reads each new PDF, and stores the warning and the DS divisions it
-- names, level by level (1 Watch/Yellow, 2 Alert/Amber, 3 Evacuate/Red). Phones will read the tables
-- through landslide_current(). The app side (the map layer) is not built yet.
--
-- Three tables:
--   landslide_warnings   one row per PDF that is a landslide warning: read, or not readable. Public read.
--   landslide_areas      one row per division a readable warning names, with the name as printed and
--                        its Survey Department p-code (null when the name could not be matched). Public read.
--   landslide_seen_pdfs  PDFs that were looked at and skipped (not a warning, or the same message again).
--                        Closed to the API.
--
-- The secret the cron job sends is NOT in this file: store it in Vault as landslide_secret after
-- running this (see docs/landslide-areas.md).
--
-- Builds on 0003 (pg_cron, pg_net, Vault and the project_url secret) and 0010 (the function keeps its
-- caching and robots.txt state in news_source_state). Independent of 0009 and of the photo-path
-- cleanup, which takes the next free number after this one.
-- Run by hand in the SQL Editor, then supabase/checks/0011_check.sql. One transaction, so it either
-- all applies or none of it does.

begin;

do $$
begin
  if to_regclass('public.news_source_state') is null then
    raise exception 'Migration 0011 needs migration 0010 first (public.news_source_state is missing)';
  end if;
end;
$$;


create table public.landslide_warnings (
  id            bigint generated always as identity primary key,
  -- The DMC file the warning was read from. A link that is here has been looked at, so it is not
  -- downloaded again. Only DMC's own site (dmc.gov.lk or www.dmc.gov.lk) and its PDF folder, the
  -- same rule as the function's PDF_URL_RULE.
  pdf_url       text not null unique
                  check (pdf_url ~ '^https://(www\.)?dmc\.gov\.lk/images/dmcreports/' and char_length(pdf_url) <= 2048),
  -- LEWM-14-11-2026-1600-09, read from inside the PDF and not from the file name (DMC's file names
  -- differ). Unique, so the same message at another address is stored once. Empty when the PDF could
  -- not be read.
  message_id    text unique
                  check (message_id ~ '^LEWM-[0-9]{2}-[0-9]{2}-[0-9]{4}-[0-9]{4}-[0-9]{1,3}$'),
  update_number smallint check (update_number between 0 and 999),
  -- When DMC listed it (the Date and Time of its report list). "Newest" goes by this, because it is
  -- known even for a PDF that could not be read.
  listed_at     timestamptz not null,
  issued_at     timestamptz,
  valid_from    timestamptz,
  valid_to      timestamptz,
  -- false: the PDF could not be read (the table was not in the usual shape, a download kept failing...).
  -- Nothing is guessed then: no message, no times, no areas, only the reason.
  parse_ok      boolean not null,
  -- Why it could not be read, for the owner. The app can't read it.
  parse_error   text check (char_length(parse_error) between 1 and 300),
  fetched_at    timestamptz not null default now(),
  constraint landslide_warnings_read_or_not check (
    (parse_ok
       and message_id is not null and update_number is not null
       and issued_at is not null and valid_from is not null and valid_to is not null
       and valid_to > valid_from
       and parse_error is null)
    or
    (not parse_ok
       and parse_error is not null
       and message_id is null and update_number is null
       and issued_at is null and valid_from is null and valid_to is null)
  )
);

create index landslide_warnings_newest on public.landslide_warnings (listed_at desc, id desc);


create table public.landslide_areas (
  id            bigint generated always as identity primary key,
  warning_id    bigint not null references public.landslide_warnings (id) on delete cascade,
  level         smallint not null check (level between 1 and 3),
  -- As printed in the warning ("Nuwara Eliya", "Hali_Ela"), so a name that could not be matched can
  -- still be shown as text
  district_name text not null check (char_length(district_name) between 1 and 60),
  ds_name       text not null check (char_length(ds_name) between 1 and 80),
  -- The Survey Department's p-codes (LK8124 and LK81), the same ones the map's boundary files use
  area_code     text check (area_code ~ '^LK[0-9]{4}$'),
  district_code text check (district_code ~ '^LK[0-9]{2}$'),
  -- -2 to 2: the level changed since the last message (up or down). added: new in this message.
  shift         smallint not null default 0 check (shift between -2 and 2),
  added         boolean not null default false,
  -- Why a name could not be matched ("no DS division of that name in Ratnapura"). Null when it was.
  match_note    text check (char_length(match_note) <= 200),
  -- Matched, with its district, or not matched and explained. Never dropped, never guessed.
  constraint landslide_areas_matched_or_explained check (
    (area_code is not null and district_code is not null and area_code like (district_code || '%') and match_note is null)
    or
    (area_code is null and match_note is not null)
  )
);

create index landslide_areas_warning on public.landslide_areas (warning_id);
-- A division is at one level only in a warning
create unique index landslide_areas_one_per_division on public.landslide_areas (warning_id, area_code)
  where area_code is not null;


create table public.landslide_seen_pdfs (
  pdf_url  text primary key
             check (pdf_url ~ '^https://(www\.)?dmc\.gov\.lk/images/dmcreports/' and char_length(pdf_url) <= 2048),
  -- not_lewm: a PDF in the landslide list that is not a warning. duplicate: a warning whose message
  -- was already stored from another address.
  outcome  text not null check (outcome in ('not_lewm', 'duplicate')),
  note     text check (char_length(note) <= 200),
  seen_at  timestamptz not null default now()
);


alter table public.landslide_warnings enable row level security;
alter table public.landslide_areas enable row level security;
alter table public.landslide_seen_pdfs enable row level security;

-- Public data: anyone can read it, only the function (service_role) writes it. There is no insert,
-- update or delete policy and no such grant for anon or authenticated. landslide_seen_pdfs has no
-- policy and no grant at all.
create policy "landslide warnings are public to read"
  on public.landslide_warnings for select to anon, authenticated using (true);
create policy "landslide areas are public to read"
  on public.landslide_areas for select to anon, authenticated using (true);

revoke all on public.landslide_warnings from public, anon, authenticated;
revoke all on public.landslide_areas from public, anon, authenticated;
revoke all on public.landslide_seen_pdfs from public, anon, authenticated;

-- Column grants: the app must name its columns (select=* is refused). parse_error and fetched_at stay
-- private, and so does the id of an area row (the app has warning_id and the names). A column added
-- later is unreadable until it is added here on purpose.
grant select (id, message_id, update_number, issued_at, valid_from, valid_to, listed_at, pdf_url, parse_ok)
  on public.landslide_warnings to anon, authenticated;
grant select (warning_id, level, district_name, ds_name, area_code, district_code, shift, added, match_note)
  on public.landslide_areas to anon, authenticated;

-- The function runs as service_role. It adds rows and looks up what it has seen; it never changes or
-- deletes one (the cleanup job below, and the owner in the SQL Editor, do that). Its retry counter for
-- downloads lives in news_source_state (0010), not here. Supabase's default privileges give
-- service_role everything on a new table, so that is taken away first.
revoke all on public.landslide_warnings from service_role;
revoke all on public.landslide_areas from service_role;
revoke all on public.landslide_seen_pdfs from service_role;
grant select, insert on public.landslide_warnings to service_role;
grant select, insert on public.landslide_areas to service_role;
grant select, insert on public.landslide_seen_pdfs to service_role;


-- Stores one warning and all its areas, or nothing: a function is one transaction, so a warning is
-- never left without its areas. p_warning is one object (pdf_url, message_id, update_number, listed_at,
-- issued_at, valid_from, valid_to, parse_ok, parse_error) and p_areas an array of objects (level,
-- district_name, ds_name, area_code, district_code, shift, added, match_note). Gives back the new id,
-- or null when the warning was already stored (this address, or the same message from another one).
-- It runs as the caller, so the table grants and policies apply, and only service_role can call it.
create function public.store_landslide_warning(p_warning jsonb, p_areas jsonb)
returns bigint
language plpgsql
set search_path = ''
as $$
declare
  new_id   bigint;
  readable boolean := (p_warning ->> 'parse_ok')::boolean;
begin
  if readable is null then
    raise exception 'parse_ok is missing';
  end if;
  if not readable and jsonb_array_length(coalesce(p_areas, '[]'::jsonb)) > 0 then
    raise exception 'a warning that could not be read has no areas';
  end if;

  insert into public.landslide_warnings
    (pdf_url, message_id, update_number, listed_at, issued_at, valid_from, valid_to, parse_ok, parse_error)
  values (
    p_warning ->> 'pdf_url',
    p_warning ->> 'message_id',
    (p_warning ->> 'update_number')::smallint,
    (p_warning ->> 'listed_at')::timestamptz,
    (p_warning ->> 'issued_at')::timestamptz,
    (p_warning ->> 'valid_from')::timestamptz,
    (p_warning ->> 'valid_to')::timestamptz,
    readable,
    p_warning ->> 'parse_error'
  )
  on conflict do nothing
  returning id into new_id;

  if new_id is null then
    return null;
  end if;

  insert into public.landslide_areas
    (warning_id, level, district_name, ds_name, area_code, district_code, shift, added, match_note)
  select new_id,
         (a ->> 'level')::smallint,
         a ->> 'district_name',
         a ->> 'ds_name',
         a ->> 'area_code',
         a ->> 'district_code',
         coalesce((a ->> 'shift')::smallint, 0),
         coalesce((a ->> 'added')::boolean, false),
         a ->> 'match_note'
    from jsonb_array_elements(coalesce(p_areas, '[]'::jsonb)) as t(a);

  return new_id;
end;
$$;

revoke all on function public.store_landslide_warning(jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.store_landslide_warning(jsonb, jsonb) to service_role;


-- The current situation, for the app: the NEWEST warning only, whether it is still valid, its areas,
-- and whether it could be read. If the newest warning could not be read it says so (parse_ok false,
-- valid false, no areas) and does NOT fall back to an older one: an older warning that is still inside
-- its 24 hours would otherwise look current while a newer, unread one may say something else.
-- "Newest" is the one DMC listed last (listed_at, then id). With nothing stored it gives {"found": false}.
-- Runs as the caller, so it can only read the columns the grants above allow.
create function public.landslide_current()
returns jsonb
language sql
stable
set search_path = ''
as $$
  select coalesce(
    (
      select jsonb_build_object(
               'found', true,
               'id', n.id,
               'message_id', n.message_id,
               'update', n.update_number,
               'issued_at', n.issued_at,
               'valid_from', n.valid_from,
               'valid_to', n.valid_to,
               'listed_at', n.listed_at,
               'pdf_url', n.pdf_url,
               'parse_ok', n.parse_ok,
               'valid', n.parse_ok and n.valid_to > now(),
               'areas', case
                 when n.parse_ok then coalesce((
                   select jsonb_agg(
                            jsonb_build_object(
                              'level', a.level,
                              'district', a.district_name,
                              'name', a.ds_name,
                              'code', a.area_code,
                              'district_code', a.district_code,
                              'shift', a.shift,
                              'added', a.added,
                              'note', a.match_note)
                            order by a.level desc, a.district_name, a.ds_name)
                     from public.landslide_areas a
                    where a.warning_id = n.id), '[]'::jsonb)
                 else '[]'::jsonb
               end)
        from (select w.id, w.message_id, w.update_number, w.issued_at, w.valid_from, w.valid_to,
                     w.listed_at, w.pdf_url, w.parse_ok
                from public.landslide_warnings w
               order by w.listed_at desc, w.id desc
               limit 1) n
    ),
    jsonb_build_object('found', false)
  );
$$;

revoke all on function public.landslide_current() from public;
grant execute on function public.landslide_current() to anon, authenticated;


-- Like run_news_refresh() in 0010. security definer so it can read Vault; only the owner runs it.
create function public.run_landslide_refresh()
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  secret   text;
  base_url text;
begin
  select decrypted_secret into secret
    from vault.decrypted_secrets where name = 'landslide_secret';
  select decrypted_secret into base_url
    from vault.decrypted_secrets where name = 'project_url';

  if secret is null or base_url is null then
    raise exception 'Vault secrets landslide_secret and project_url must be set first';
  end if;

  -- Returns a request id. The answer lands in net._http_response.
  return net.http_post(
    url := base_url || '/functions/v1/landslide-refresh',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-landslide-secret', secret),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  );
end;
$$;

revoke all on function public.run_landslide_refresh() from public, anon, authenticated;


-- Minutes already used by the other jobs: 0 (cleanup), 4, 19, 34 and 49 (news), 23 (forecast) and 41
-- (news cleanup). This one runs at 9 and 39, and its cleanup at 56. Until the Vault secret is set the
-- job fails with the message above, which does no harm. Re-running this replaces jobs of the same name.
select cron.schedule('landslide-refresh', '9,39 * * * *', $$select public.run_landslide_refresh()$$);

-- Warnings are kept for 14 days (their areas go with them), and so are the skipped PDFs
select cron.schedule('landslide-cleanup', '56 * * * *',
  $$delete from public.landslide_warnings where listed_at < now() - interval '14 days';
    delete from public.landslide_seen_pdfs where seen_at < now() - interval '14 days'$$);


-- Stop here, and undo everything, if the grants are not what this file says
do $$
declare
  t text;
begin
  -- service_role reads and adds rows, and nothing else (the default privileges were taken away above)
  foreach t in array array['public.landslide_warnings', 'public.landslide_areas', 'public.landslide_seen_pdfs'] loop
    if not has_table_privilege('service_role', t, 'select')
       or not has_table_privilege('service_role', t, 'insert')
       or has_any_column_privilege('service_role', t, 'update')
       or has_table_privilege('service_role', t, 'delete')
       or has_table_privilege('service_role', t, 'truncate')
       or has_any_column_privilege('service_role', t, 'references')
       or has_table_privilege('service_role', t, 'trigger') then
      raise exception 'service_role must only read and add rows in %', t;
    end if;
  end loop;
  if has_table_privilege('anon', 'public.landslide_warnings', 'select')
     or has_table_privilege('authenticated', 'public.landslide_areas', 'select')
     or has_column_privilege('anon', 'public.landslide_warnings', 'parse_error', 'select')
     or has_column_privilege('authenticated', 'public.landslide_warnings', 'fetched_at', 'select')
     or has_any_column_privilege('anon', 'public.landslide_seen_pdfs', 'select')
     or has_any_column_privilege('authenticated', 'public.landslide_seen_pdfs', 'select') then
    raise exception 'the landslide tables are readable by more than the app should read';
  end if;
  if not has_column_privilege('anon', 'public.landslide_warnings', 'parse_ok', 'select')
     or not has_column_privilege('authenticated', 'public.landslide_areas', 'area_code', 'select') then
    raise exception 'the app cannot read the landslide columns it needs';
  end if;
  if has_function_privilege('anon', 'public.store_landslide_warning(jsonb, jsonb)', 'execute')
     or has_function_privilege('authenticated', 'public.store_landslide_warning(jsonb, jsonb)', 'execute') then
    raise exception 'store_landslide_warning can be run by the app';
  end if;
end;
$$;

notify pgrst, 'reload schema';

commit;
