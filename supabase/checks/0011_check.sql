-- Checks for migration 0011 (landslide areas), to run AFTER it. Read-only: it changes nothing.
-- Run it in the SQL Editor. One result table, one line per check. Every line should say PASS, except
-- the ones marked "info", which just show numbers, and check 12 until the Vault secret is stored
-- (see docs/landslide-areas.md). It never shows the secret itself.

select ord, check_name, case when ok then 'PASS' else 'FAIL' end as result, detail
  from (

    select 1 as ord, 'all three tables exist with row level security on' as check_name,
           count(*) = 3 and bool_and(c.relrowsecurity) as ok,
           'found: ' || coalesce(string_agg(c.relname, ', ' order by c.relname), 'none') as detail
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public'
       and c.relname in ('landslide_warnings', 'landslide_areas', 'landslide_seen_pdfs')

    union all
    -- The app reads with column grants, so a table-wide select must not be there
    select 2, 'warnings and areas: no table-wide select for anon or authenticated',
           not has_table_privilege('anon', 'public.landslide_warnings', 'select')
           and not has_table_privilege('authenticated', 'public.landslide_warnings', 'select')
           and not has_table_privilege('anon', 'public.landslide_areas', 'select')
           and not has_table_privilege('authenticated', 'public.landslide_areas', 'select'), ''

    union all
    select 3, 'landslide_warnings: the 9 public columns are readable by anon and authenticated',
           count(*) = 9 and bool_and(has_column_privilege('anon', 'public.landslide_warnings', column_name, 'select')
                                     and has_column_privilege('authenticated', 'public.landslide_warnings', column_name, 'select')),
           'readable: ' || count(*) filter (where has_column_privilege('anon', 'public.landslide_warnings', column_name, 'select')) || ' of 9'
      from information_schema.columns
     where table_schema = 'public' and table_name = 'landslide_warnings'
       and column_name in ('id', 'message_id', 'update_number', 'issued_at', 'valid_from', 'valid_to',
                           'listed_at', 'pdf_url', 'parse_ok')

    union all
    select 4, 'landslide_areas: the 9 public columns are readable by anon and authenticated',
           count(*) = 9 and bool_and(has_column_privilege('anon', 'public.landslide_areas', column_name, 'select')
                                      and has_column_privilege('authenticated', 'public.landslide_areas', column_name, 'select')),
           'readable: ' || count(*) filter (where has_column_privilege('anon', 'public.landslide_areas', column_name, 'select')) || ' of 9'
      from information_schema.columns
     where table_schema = 'public' and table_name = 'landslide_areas'
       and column_name in ('warning_id', 'level', 'district_name', 'ds_name', 'area_code',
                           'district_code', 'shift', 'added', 'match_note')

    union all
    select 5, 'parse_error, fetched_at and the area row id are not readable by the app',
           not has_column_privilege('anon', 'public.landslide_areas', 'id', 'select')
           and not has_column_privilege('authenticated', 'public.landslide_areas', 'id', 'select')
           and not has_column_privilege('anon', 'public.landslide_warnings', 'parse_error', 'select')
           and not has_column_privilege('authenticated', 'public.landslide_warnings', 'parse_error', 'select')
           and not has_column_privilege('anon', 'public.landslide_warnings', 'fetched_at', 'select')
           and not has_column_privilege('authenticated', 'public.landslide_warnings', 'fetched_at', 'select'), ''

    union all
    select 6, 'anon and authenticated cannot add, change or remove rows in any of the three tables',
           coalesce(bool_and(not has_any_column_privilege('anon', c.oid, 'insert')
                             and not has_any_column_privilege('authenticated', c.oid, 'insert')
                             and not has_any_column_privilege('anon', c.oid, 'update')
                             and not has_any_column_privilege('authenticated', c.oid, 'update')
                             and not has_table_privilege('anon', c.oid, 'delete')
                             and not has_table_privilege('authenticated', c.oid, 'delete')), false),
           'checked: ' || count(*)
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public'
       and c.relname in ('landslide_warnings', 'landslide_areas', 'landslide_seen_pdfs')

    union all
    select 7, 'landslide_seen_pdfs: closed to anon and authenticated',
           not has_any_column_privilege('anon', 'public.landslide_seen_pdfs', 'select')
           and not has_any_column_privilege('authenticated', 'public.landslide_seen_pdfs', 'select'), ''

    union all
    -- Only select and insert: Supabase's default privileges would give it everything
    select 8, 'service_role (the function) can read and add rows in all three tables, and cannot change, remove or empty them',
           coalesce(bool_and(has_table_privilege('service_role', c.oid, 'select')
                             and has_table_privilege('service_role', c.oid, 'insert')
                             and not has_any_column_privilege('service_role', c.oid, 'update')
                             and not has_table_privilege('service_role', c.oid, 'delete')
                             and not has_table_privilege('service_role', c.oid, 'truncate')), false)
           and count(*) = 3,
           'not as it should be: ' || coalesce(string_agg(c.relname, ', ') filter (
             where not (has_table_privilege('service_role', c.oid, 'select')
                        and has_table_privilege('service_role', c.oid, 'insert')
                        and not has_any_column_privilege('service_role', c.oid, 'update')
                        and not has_table_privilege('service_role', c.oid, 'delete')
                        and not has_table_privilege('service_role', c.oid, 'truncate'))), 'none')
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public'
       and c.relname in ('landslide_warnings', 'landslide_areas', 'landslide_seen_pdfs')

    union all
    select 9, 'warnings and areas each have exactly one policy: public select',
           count(*) = 2
           and count(distinct tablename) = 2
           and bool_and(cmd = 'SELECT' and roles @> array['anon', 'authenticated']::name[]),
           coalesce(string_agg(tablename || ': ' || policyname || ' [' || cmd || ']', '; '), 'none')
      from pg_policies
     where schemaname = 'public' and tablename in ('landslide_warnings', 'landslide_areas', 'landslide_seen_pdfs')

    union all
    select 10, 'store_landslide_warning() can be run by service_role only',
           count(*) = 1
           and has_function_privilege('service_role', 'public.store_landslide_warning(jsonb, jsonb)', 'execute')
           and not has_function_privilege('anon', 'public.store_landslide_warning(jsonb, jsonb)', 'execute')
           and not has_function_privilege('authenticated', 'public.store_landslide_warning(jsonb, jsonb)', 'execute'),
           ''
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'store_landslide_warning'

    union all
    -- It must run as the caller, so the column grants apply to what it reads
    select 11, 'landslide_current() runs as the caller, is read-only, and the app can run it',
           count(*) = 1
           and bool_and(not p.prosecdef and p.provolatile = 's')
           and has_function_privilege('anon', 'public.landslide_current()', 'execute')
           and has_function_privilege('authenticated', 'public.landslide_current()', 'execute'),
           ''
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'landslide_current'

    union all
    select 12, 'the Vault secret landslide_secret is stored (FAIL until the setup step)',
           count(*) = 1, 'found ' || count(*)
      from vault.secrets where name = 'landslide_secret'

    union all
    select 13, 'run_landslide_refresh() is security definer and nobody else can run it',
           count(*) = 1
           and bool_and(p.prosecdef)
           and not has_function_privilege('anon', 'public.run_landslide_refresh()', 'execute')
           and not has_function_privilege('authenticated', 'public.run_landslide_refresh()', 'execute'),
           ''
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'run_landslide_refresh'

    union all
    select 14, 'both cron jobs are scheduled, at minutes no other job uses',
           count(*) = 2
           and bool_and((jobname = 'landslide-refresh' and schedule = '9,39 * * * *')
                        or (jobname = 'landslide-cleanup' and schedule = '56 * * * *')),
           coalesce(string_agg(jobname || ' ' || schedule, '; ' order by jobname), 'none')
      from cron.job where jobname in ('landslide-refresh', 'landslide-cleanup')

    union all
    select 15, 'no other cron job runs at the same minutes',
           count(*) = 0,
           coalesce(string_agg(jobname || ' ' || schedule, '; ' order by jobname), 'none')
      from cron.job
     where jobname not in ('landslide-refresh', 'landslide-cleanup')
       and exists (select 1 from unnest(string_to_array(split_part(schedule, ' ', 1), ',')) m
                    where m in ('9', '39', '56'))

    union all
    -- The app refetches, so the tables must not broadcast
    select 16, 'the landslide tables are not in the Realtime publication',
           not exists (select 1 from pg_publication_tables
                        where pubname = 'supabase_realtime' and schemaname = 'public'
                          and tablename in ('landslide_warnings', 'landslide_areas', 'landslide_seen_pdfs')), ''

    union all
    select 17, 'news_source_state exists (0010 was run: the function keeps its caching state there)',
           to_regclass('public.news_source_state') is not null, ''

    union all
    select 18, 'a warning that could not be read has no message, no times and no areas',
           count(*) = 0,
           coalesce('problem rows: ' || string_agg(w.id::text, ', '), '')
      from public.landslide_warnings w
     where not w.parse_ok
       and (w.message_id is not null or w.issued_at is not null or w.valid_to is not null
            or exists (select 1 from public.landslide_areas a where a.warning_id = w.id))

    union all
    select 19, 'info: what landslide_current() says right now (what the app would be told)',
           true,
           coalesce('found=' || (public.landslide_current() ->> 'found')
                    || ', parse_ok=' || coalesce(public.landslide_current() ->> 'parse_ok', '-')
                    || ', valid=' || coalesce(public.landslide_current() ->> 'valid', '-')
                    || ', message=' || coalesce(public.landslide_current() ->> 'message_id', '-')
                    || ', areas=' || jsonb_array_length(coalesce(public.landslide_current() -> 'areas', '[]'::jsonb)), '')

    union all
    select 20, 'info: last run of the landslide-refresh job',
           true,
           coalesce((select status || ' at ' || to_char(start_time, 'YYYY-MM-DD HH24:MI') || ' ' || coalesce(left(return_message, 80), '')
                       from cron.job_run_details
                      where jobid = (select jobid from cron.job where jobname = 'landslide-refresh')
                      order by start_time desc limit 1), 'not run yet')

    union all
    select 21, 'info: warnings stored',
           true,
           count(*) || ' rows, ' || count(*) filter (where parse_ok) || ' read, '
             || count(*) filter (where not parse_ok) || ' not readable, newest listed '
             || coalesce(to_char(max(listed_at), 'YYYY-MM-DD HH24:MI'), 'none')
      from public.landslide_warnings

    union all
    select 22, 'info: names that could not be matched, in warnings stored over the last 7 days',
           true,
           count(*) || ' unmatched' || coalesce(': ' || string_agg(distinct a.district_name || ' / ' || a.ds_name, '; '), '')
      from public.landslide_areas a join public.landslide_warnings w on w.id = a.warning_id
     where a.area_code is null and w.fetched_at > now() - interval '7 days'

    union all
    select 23, 'info: how the list was last read (news_source_state, row landslide_list)',
           true,
           coalesce((select 'last_fetch ' || coalesce(to_char(last_fetch_at, 'YYYY-MM-DD HH24:MI'), '-')
                            || ', status ' || coalesce(last_status::text, '-')
                            || ', failures ' || failures
                            || ', error ' || coalesce(left(last_error, 80), '-')
                       from public.news_source_state where source = 'landslide_list'), 'not read yet')

  ) q
 order by ord;
