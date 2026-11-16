-- Privacy checks, to run AFTER 0009 is live. Read-only: it changes nothing.
-- Run it in the SQL Editor. One result table, one line per check. Every line should say PASS.
-- Run it again after 0010 (news feed), 0011 (landslide warnings), the photo-path cleanup (the next
-- free number after the landslide migration), and any time a table, column or policy is added. Check 17
-- says FAIL until 0010 has been run, and check 18 until 0011 has been run.
--
-- Not covered here, because SQL can't do it: the real API with the public key (see privacy.ps1),
-- and a real photo upload (see the last line).

select ord, check_name, case when ok then 'PASS' else 'FAIL' end as result, detail
  from (

    select 1 as ord, 'created_by is not readable by anon or authenticated' as check_name,
           not has_column_privilege('anon', 'public.reports', 'created_by', 'select')
           and not has_column_privilege('authenticated', 'public.reports', 'created_by', 'select') as ok,
           ''::text as detail

    union all
    select 2, 'reports has no table-wide select for anon or authenticated',
           not has_table_privilege('anon', 'public.reports', 'select')
           and not has_table_privilege('authenticated', 'public.reports', 'select'), ''

    union all
    -- Every column except created_by should be readable. A column added later and not granted shows up here
    select 3, 'every reports column except created_by is readable (so the app keeps working)',
           count(*) filter (where column_name <> 'created_by'
                              and has_column_privilege('anon', 'public.reports', column_name, 'select')
                              and has_column_privilege('authenticated', 'public.reports', column_name, 'select'))
             = count(*) filter (where column_name <> 'created_by'),
           'unreadable: ' || coalesce(string_agg(column_name, ', ') filter (
             where column_name <> 'created_by'
               and not (has_column_privilege('anon', 'public.reports', column_name, 'select')
                        and has_column_privilege('authenticated', 'public.reports', column_name, 'select'))), 'none')
      from information_schema.columns where table_schema = 'public' and table_name = 'reports'

    union all
    select 4, 'created_by cannot be written from the app',
           not has_column_privilege('anon', 'public.reports', 'created_by', 'insert')
           and not has_column_privilege('authenticated', 'public.reports', 'created_by', 'insert')
           and not has_column_privilege('anon', 'public.reports', 'created_by', 'update')
           and not has_column_privilege('authenticated', 'public.reports', 'created_by', 'update'), ''

    union all
    select 5, 'anon and authenticated cannot update or delete reports',
           not has_table_privilege('anon', 'public.reports', 'update')
           and not has_table_privilege('authenticated', 'public.reports', 'update')
           and not has_table_privilege('anon', 'public.reports', 'delete')
           and not has_table_privilege('authenticated', 'public.reports', 'delete')
           and not has_any_column_privilege('anon', 'public.reports', 'update')
           and not has_any_column_privilege('authenticated', 'public.reports', 'update'), ''

    union all
    -- Tables the API can read at all. Anything unexpected here is worth a look.
    select 6, 'API-readable tables in public are only the expected ones',
           coalesce(bool_and(c.relname in ('reports', 'report_votes', 'island_forecast', 'news_items',
                                           'landslide_warnings', 'landslide_areas')), true),
           'readable: ' || coalesce(string_agg(c.relname, ', ' order by c.relname), 'none')
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind in ('r', 'v', 'm', 'p')
       and (has_table_privilege('anon', c.oid, 'select') or has_table_privilege('authenticated', c.oid, 'select')
            or has_any_column_privilege('anon', c.oid, 'select') or has_any_column_privilege('authenticated', c.oid, 'select'))

    union all
    select 7, 'report_votes: user_id is only visible to its owner (policy)',
           exists (select 1 from pg_policies
                    where schemaname = 'public' and tablename = 'report_votes' and cmd = 'SELECT'
                      and qual ~ 'user_id\s*=\s*\(?\s*(SELECT\s+)?auth\.uid\(\)')
           and not has_table_privilege('anon', 'public.report_votes', 'select'), ''

    union all
    select 8, 'report_severity_updates and report_edits are closed to the API',
           coalesce(bool_and(not has_any_column_privilege('anon', c.oid, 'select')
                             and not has_any_column_privilege('authenticated', c.oid, 'select')
                             and not has_any_column_privilege('authenticated', c.oid, 'insert')), true),
           'checked: ' || coalesce(string_agg(c.relname, ', '), 'neither exists yet')
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relname in ('report_severity_updates', 'report_edits')

    union all
    select 9, 'no public function returns a created_by or user_id column',
           count(*) = 0, coalesce(string_agg(p.proname, ', '), '')
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.prokind = 'f'
       and pg_get_function_result(p.oid) ~* '\m(created_by|user_id)\M'

    union all
    select 10, 'no function that runs as the caller uses a star select or created_by',
           count(*) = 0, coalesce(string_agg(p.proname, ', '), '')
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.prokind = 'f' and not p.prosecdef
       and (p.prosrc ~* '\w+\.\*' or p.prosrc ~* 'select\s+\*' or p.prosrc ~* 'created_by')

    union all
    select 11, 'reports is not in the Realtime publication',
           not exists (select 1 from pg_publication_tables
                        where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'reports'), ''

    union all
    select 12, 'nobody can list, replace or delete photos (no select, update or delete policy on storage.objects)',
           count(*) = 0, coalesce(string_agg(policyname || ' [' || cmd || ']', '; '), '')
      from pg_policies
     where schemaname = 'storage' and tablename = 'objects' and cmd in ('SELECT', 'UPDATE', 'DELETE', 'ALL')

    union all
    select 13, 'the photo bucket is not listable by the old per-user policy, and the new upload policy exists',
           exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects'
                    and policyname = 'Signed-in users upload photos')
           and not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects'
                            and policyname = 'Users upload photos into their own folder'), ''

    union all
    select 14, 'owns_report_photo() can be run by signed-in users only',
           has_function_privilege('authenticated', 'public.owns_report_photo(text)', 'execute')
           and not has_function_privilege('anon', 'public.owns_report_photo(text)', 'execute'), ''

    union all
    -- Shows how many photos are still on the old <user id>/<name> paths. The photo-path cleanup (the next
    -- free migration number after the landslide migration) can go ahead at 0.
    select 15, 'photos still on old <user id>/ paths (info: this should fall to 0 on its own)',
           true,
           'old style=' || count(*) filter (where name like '%/%') || ', flat=' || count(*) filter (where name not like '%/%')
      from storage.objects where bucket_id = 'report-photos'

    union all
    -- After a real upload from the new app, owner_id must be filled in or photo reports are refused
    select 16, 'newest 5 photo objects all have an owner_id (upload a photo first, then run this)',
           coalesce(bool_and(owner_id is not null), false),
           'checked ' || count(*) || ' newest objects'
      from (select owner_id from storage.objects where bucket_id = 'report-photos' order by created_at desc limit 5) s

    union all
    -- The news feed (0010). The app may only read news_items, and only through the column grant, which
    -- leaves out score and matched. news_source_state (caching headers and errors) has no grants at all.
    select 17, 'news_items is read-only for the app with score/matched private, and news_source_state is closed',
           count(*) = 2 and coalesce(bool_and(c.relrowsecurity and case c.relname
             when 'news_items' then
               not has_table_privilege('anon', c.oid, 'select') and not has_table_privilege('authenticated', c.oid, 'select')
               and has_column_privilege('anon', c.oid, 'title', 'select') and has_column_privilege('authenticated', c.oid, 'title', 'select')
               and not has_column_privilege('anon', c.oid, 'score', 'select') and not has_column_privilege('authenticated', c.oid, 'score', 'select')
               and not has_column_privilege('anon', c.oid, 'matched', 'select') and not has_column_privilege('authenticated', c.oid, 'matched', 'select')
               and not has_any_column_privilege('anon', c.oid, 'insert') and not has_any_column_privilege('authenticated', c.oid, 'insert')
               and not has_any_column_privilege('anon', c.oid, 'update') and not has_any_column_privilege('authenticated', c.oid, 'update')
               and not has_table_privilege('anon', c.oid, 'delete') and not has_table_privilege('authenticated', c.oid, 'delete')
             else
               not has_any_column_privilege('anon', c.oid, 'select') and not has_any_column_privilege('authenticated', c.oid, 'select')
               and not has_any_column_privilege('anon', c.oid, 'insert') and not has_any_column_privilege('authenticated', c.oid, 'insert')
               and not has_any_column_privilege('anon', c.oid, 'update') and not has_any_column_privilege('authenticated', c.oid, 'update')
               and not has_table_privilege('anon', c.oid, 'delete') and not has_table_privilege('authenticated', c.oid, 'delete')
             end), false),
           'found: ' || coalesce(string_agg(c.relname, ', ' order by c.relname), 'neither (run 0010 first)')
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relname in ('news_items', 'news_source_state')

    union all
    -- The landslide warnings (0011). The app may only read landslide_warnings and landslide_areas,
    -- through column grants that leave out parse_error and fetched_at, and never write. The seen-PDF
    -- list has no grants at all, and the function that stores a warning is for service_role only.
    select 18, 'landslide tables are read-only for the app (parse_error and fetched_at private), landslide_seen_pdfs is closed, and nobody but service_role can store',
           count(*) = 3 and coalesce(bool_and(c.relrowsecurity and case c.relname
             when 'landslide_warnings' then
               not has_table_privilege('anon', c.oid, 'select') and not has_table_privilege('authenticated', c.oid, 'select')
               and has_column_privilege('anon', c.oid, 'parse_ok', 'select') and has_column_privilege('authenticated', c.oid, 'parse_ok', 'select')
               and not has_column_privilege('anon', c.oid, 'parse_error', 'select') and not has_column_privilege('authenticated', c.oid, 'parse_error', 'select')
               and not has_column_privilege('anon', c.oid, 'fetched_at', 'select') and not has_column_privilege('authenticated', c.oid, 'fetched_at', 'select')
               and not has_any_column_privilege('anon', c.oid, 'insert') and not has_any_column_privilege('authenticated', c.oid, 'insert')
               and not has_any_column_privilege('anon', c.oid, 'update') and not has_any_column_privilege('authenticated', c.oid, 'update')
               and not has_table_privilege('anon', c.oid, 'delete') and not has_table_privilege('authenticated', c.oid, 'delete')
             when 'landslide_areas' then
               not has_table_privilege('anon', c.oid, 'select') and not has_table_privilege('authenticated', c.oid, 'select')
               and has_column_privilege('anon', c.oid, 'area_code', 'select') and has_column_privilege('authenticated', c.oid, 'area_code', 'select')
               and not has_any_column_privilege('anon', c.oid, 'insert') and not has_any_column_privilege('authenticated', c.oid, 'insert')
               and not has_any_column_privilege('anon', c.oid, 'update') and not has_any_column_privilege('authenticated', c.oid, 'update')
               and not has_table_privilege('anon', c.oid, 'delete') and not has_table_privilege('authenticated', c.oid, 'delete')
             else
               not has_any_column_privilege('anon', c.oid, 'select') and not has_any_column_privilege('authenticated', c.oid, 'select')
               and not has_any_column_privilege('anon', c.oid, 'insert') and not has_any_column_privilege('authenticated', c.oid, 'insert')
               and not has_any_column_privilege('anon', c.oid, 'update') and not has_any_column_privilege('authenticated', c.oid, 'update')
               and not has_table_privilege('anon', c.oid, 'delete') and not has_table_privilege('authenticated', c.oid, 'delete')
             end), false)
           -- by oid, so this says FAIL (not an error) when 0011 has not been run
           and not exists (select 1 from pg_proc p join pg_namespace pn on pn.oid = p.pronamespace
                            where pn.nspname = 'public' and p.proname = 'store_landslide_warning'
                              and (has_function_privilege('anon', p.oid, 'execute')
                                   or has_function_privilege('authenticated', p.oid, 'execute'))),
           'found: ' || coalesce(string_agg(c.relname, ', ' order by c.relname), 'none (run 0011 first)')
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relname in ('landslide_warnings', 'landslide_areas', 'landslide_seen_pdfs')

  ) q
 order by ord;
