-- Reads (and only reads) what is really live in the database that 0009 touches, so it can be
-- compared with what the migration files say before 0009 is run.
-- Run it in the SQL Editor. It is ONE query with one result table: copy the rows out, or use the
-- editor's "Copy as markdown". The detail column can be long (policy rules, function bodies).
--
-- What to look at:
--   * "reports column"    every column. 0009 grants select on 10 of them and refuses to run if there
--                         is one it doesn't know.
--   * "policy ..."        the insert policy on reports (its WITH CHECK must match 0001 + 0002, and
--                         0009 keeps every condition in it) and every policy on storage.objects
--                         (a policy made in the dashboard would sit next to the one 0009 replaces).
--   * "constraint"        the Sri Lanka bounds check lives here, not in the policy.
--   * "function ..."      every public function that mentions reports or created_by, with its body.
--                         "caller rights" ones are the ones that matter: they run with the app
--                         user's column privileges, so a star select or created_by would break.
--   * "column acl"        column-level grants that exist today (should be only the insert list).
--   * "photos"            owner_id must be filled on existing uploads, or the new photo rule
--                         (which relies on it) would refuse every new photo.

select section, name, detail
  from (

    select 1 as ord, 'reports column' as section, column_name::text as name,
           (data_type
             || case when is_nullable = 'NO' then ' not null' else '' end
             || coalesce(' default ' || column_default, ''))::text as detail
      from information_schema.columns
     where table_schema = 'public' and table_name = 'reports'

    union all
    select 2, 'table', c.relname::text,
           ('row level security=' || c.relrowsecurity || '; table grants=' || coalesce(c.relacl::text, 'none'))::text
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where (n.nspname = 'public' and c.relname in ('reports', 'report_votes', 'report_severity_updates', 'report_edits'))
        or (n.nspname = 'storage' and c.relname = 'objects')

    union all
    select 3, 'column acl (reports)', a.attname::text, a.attacl::text
      from pg_attribute a
     where a.attrelid = 'public.reports'::regclass and a.attnum > 0 and not a.attisdropped and a.attacl is not null

    union all
    select 4, 'constraint (reports)', conname::text, pg_get_constraintdef(oid)::text
      from pg_constraint where conrelid = 'public.reports'::regclass

    union all
    select 5, 'policy ' || schemaname || '.' || tablename, policyname::text,
           ('cmd=' || cmd || '; roles=' || roles::text || '; permissive=' || permissive
             || E'\nUSING: ' || coalesce(qual, '-')
             || E'\nWITH CHECK: ' || coalesce(with_check, '-'))::text
      from pg_policies
     where (schemaname = 'public' and tablename in ('reports', 'report_votes')) or schemaname = 'storage'

    union all
    -- The same insert policy straight from pg_policy, as asked: pg_get_expr of its WITH CHECK
    select 6, 'insert policy WITH CHECK (pg_get_expr)', polname::text,
           pg_get_expr(polwithcheck, polrelid)::text
      from pg_policy
     where polrelid = 'public.reports'::regclass and polcmd = 'a'

    union all
    select 7, 'trigger', tgname::text, pg_get_triggerdef(oid)::text
      from pg_trigger
     where tgrelid in ('public.reports'::regclass, 'public.report_votes'::regclass) and not tgisinternal

    union all
    select 8,
           case when p.prosecdef then 'function (security definer)' else 'function (caller rights)' end,
           (p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ') owner=' || pg_get_userbyid(p.proowner))::text,
           pg_get_functiondef(p.oid)::text
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.prokind = 'f'
       and (p.prosrc ilike '%reports%' or p.prosrc ilike '%created_by%')

    union all
    select 9, 'function grants', (p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')')::text,
           coalesce(p.proacl::text, 'default (everyone can run it)')
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.prokind = 'f'

    union all
    select 10, 'realtime publication', (schemaname || '.' || tablename)::text, ''::text
      from pg_publication_tables where pubname = 'supabase_realtime'

    union all
    select 11, 'bucket', id::text,
           ('public=' || public || '; size limit=' || coalesce(file_size_limit::text, 'none')
             || '; types=' || coalesce(allowed_mime_types::text, 'any'))::text
      from storage.buckets where id = 'report-photos'

    union all
    select 12, 'photos', 'report-photos objects'::text,
           ('total=' || count(*)
             || '; with owner_id=' || count(o.owner_id)
             || '; old style (folder/name)=' || count(*) filter (where o.name like '%/%')
             || '; flat=' || count(*) filter (where o.name not like '%/%'))::text
      from storage.objects o where o.bucket_id = 'report-photos'

  ) q
 order by ord, section, name;
