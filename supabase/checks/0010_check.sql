-- Checks for migration 0010 (news feed), to run AFTER it. Read-only: it changes nothing.
-- Run it in the SQL Editor. One result table, one line per check. Every line should say PASS, except
-- the ones marked "info", which just show numbers, and check 10 until the Vault secret is stored
-- (step 5 of docs/news-feed.md). It never shows the secret itself.

select ord, check_name, case when ok then 'PASS' else 'FAIL' end as result, detail
  from (

    select 1 as ord, 'both tables exist with row level security on' as check_name,
           count(*) = 2 and bool_and(c.relrowsecurity) as ok,
           'found: ' || coalesce(string_agg(c.relname, ', ' order by c.relname), 'neither') as detail
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relname in ('news_items', 'news_source_state')

    union all
    -- The app reads with a column grant, so a table-wide select must not be there
    select 2, 'news_items: no table-wide select for anon or authenticated',
           not has_table_privilege('anon', 'public.news_items', 'select')
           and not has_table_privilege('authenticated', 'public.news_items', 'select'), ''

    union all
    select 3, 'news_items: the public columns are readable by anon and authenticated',
           count(*) = 13 and bool_and(has_column_privilege('anon', 'public.news_items', column_name, 'select')
                                      and has_column_privilege('authenticated', 'public.news_items', column_name, 'select')),
           'readable: ' || count(*) filter (where has_column_privilege('anon', 'public.news_items', column_name, 'select')) || ' of 13'
      from information_schema.columns
     where table_schema = 'public' and table_name = 'news_items'
       and column_name in ('id', 'url', 'title', 'source', 'kind', 'channel', 'language', 'hazard',
                           'published_at', 'fetched_at', 'ended_at', 'place_name', 'location')

    union all
    select 4, 'news_items: score and matched are not readable by the app',
           not has_column_privilege('anon', 'public.news_items', 'score', 'select')
           and not has_column_privilege('authenticated', 'public.news_items', 'score', 'select')
           and not has_column_privilege('anon', 'public.news_items', 'matched', 'select')
           and not has_column_privilege('authenticated', 'public.news_items', 'matched', 'select'), ''

    union all
    select 5, 'news_items: anon and authenticated cannot add, change or remove rows',
           not has_any_column_privilege('anon', 'public.news_items', 'insert')
           and not has_any_column_privilege('authenticated', 'public.news_items', 'insert')
           and not has_any_column_privilege('anon', 'public.news_items', 'update')
           and not has_any_column_privilege('authenticated', 'public.news_items', 'update')
           and not has_table_privilege('anon', 'public.news_items', 'delete')
           and not has_table_privilege('authenticated', 'public.news_items', 'delete'), ''

    union all
    select 6, 'news_source_state: closed to anon and authenticated',
           not has_any_column_privilege('anon', 'public.news_source_state', 'select')
           and not has_any_column_privilege('authenticated', 'public.news_source_state', 'select')
           and not has_any_column_privilege('anon', 'public.news_source_state', 'insert')
           and not has_any_column_privilege('authenticated', 'public.news_source_state', 'insert')
           and not has_any_column_privilege('anon', 'public.news_source_state', 'update')
           and not has_any_column_privilege('authenticated', 'public.news_source_state', 'update'), ''

    union all
    select 7, 'service_role (the function) can write both tables',
           has_table_privilege('service_role', 'public.news_items', 'insert')
           and has_table_privilege('service_role', 'public.news_items', 'update')
           and has_table_privilege('service_role', 'public.news_items', 'delete')
           and has_table_privilege('service_role', 'public.news_source_state', 'insert')
           and has_table_privilege('service_role', 'public.news_source_state', 'update'), ''

    union all
    select 8, 'news_items has exactly one policy: public select',
           count(*) = 1 and bool_and(cmd = 'SELECT' and roles @> array['anon', 'authenticated']::name[]),
           coalesce(string_agg(policyname || ' [' || cmd || ']', '; '), 'none')
      from pg_policies where schemaname = 'public' and tablename = 'news_items'

    union all
    select 9, 'run_news_refresh() is security definer and nobody else can run it',
           count(*) = 1
           and bool_and(p.prosecdef)
           and not has_function_privilege('anon', 'public.run_news_refresh()', 'execute')
           and not has_function_privilege('authenticated', 'public.run_news_refresh()', 'execute'),
           ''
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'run_news_refresh'

    union all
    select 10, 'the Vault secret news_secret is stored (FAIL until setup step 5)',
           count(*) = 1, 'found ' || count(*)
      from vault.secrets where name = 'news_secret'

    union all
    select 11, 'both cron jobs are scheduled',
           count(*) = 2
           and bool_and((jobname = 'news-refresh' and schedule = '4,19,34,49 * * * *')
                        or (jobname = 'news-cleanup' and schedule = '41 * * * *')),
           coalesce(string_agg(jobname || ' ' || schedule, '; ' order by jobname), 'none')
      from cron.job where jobname in ('news-refresh', 'news-cleanup')

    union all
    -- The app refetches instead (docs/news-feed-plan.md, part 4), so the table must not broadcast
    select 12, 'news_items is not in the Realtime publication',
           not exists (select 1 from pg_publication_tables
                        where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'news_items'), ''

    union all
    select 13, 'info: last run of the news-refresh job',
           true,
           coalesce((select status || ' at ' || to_char(start_time, 'YYYY-MM-DD HH24:MI') || ' ' || coalesce(left(return_message, 80), '')
                       from cron.job_run_details
                      where jobid = (select jobid from cron.job where jobname = 'news-refresh')
                      order by start_time desc limit 1), 'not run yet')

    union all
    select 14, 'info: headlines stored',
           true,
           count(*) || ' rows, ' || count(*) filter (where kind = 'official') || ' official, newest '
             || coalesce(to_char(max(published_at), 'YYYY-MM-DD HH24:MI'), 'none')
      from public.news_items

  ) q
 order by ord;
