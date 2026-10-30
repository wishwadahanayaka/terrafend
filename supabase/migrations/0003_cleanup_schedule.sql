-- Hourly cleanup: a cron job calls the cleanup-expired Edge Function.
-- The secret it sends is NOT in this file. You store it in Vault by hand
-- after running this (see the steps given with the migration).


create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;
create extension if not exists supabase_vault with schema vault;


-- The Edge Function uses the service_role key. Because new tables are not
-- exposed automatically in this project, give it explicit rights on reports.
grant select, update, delete on public.reports to service_role;


-- Lists photos in the bucket that are older than min_age and that no report
-- points to. It only reads storage.objects; the files are deleted through the
-- Storage API by the Edge Function. Only service_role can call it.
create function public.orphan_report_photos(
  min_age interval default interval '1 day',
  max_rows integer default 500
)
returns table (name text)
language sql
stable
security definer
set search_path = ''
as $$
  select o.name
    from storage.objects o
   where o.bucket_id = 'report-photos'
     and o.created_at < now() - min_age
     and o.name not like '%.emptyFolderPlaceholder'
     and not exists (select 1 from public.reports r where r.photo_path = o.name)
   order by o.created_at
   limit max_rows;
$$;

revoke all on function public.orphan_report_photos(interval, integer) from public, anon, authenticated;
grant execute on function public.orphan_report_photos(interval, integer) to service_role;


-- Reads the two Vault secrets and sends the request to the Edge Function.
-- security definer so it can read Vault; nobody but the owner can run it.
create function public.run_cleanup()
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
    from vault.decrypted_secrets where name = 'cleanup_secret';
  select decrypted_secret into base_url
    from vault.decrypted_secrets where name = 'project_url';

  if secret is null or base_url is null then
    raise exception 'Vault secrets cleanup_secret and project_url must be set first';
  end if;

  -- Returns a request id. The answer lands in net._http_response.
  return net.http_post(
    url := base_url || '/functions/v1/cleanup-expired',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cleanup-secret', secret
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 30000
  );
end;
$$;

revoke all on function public.run_cleanup() from public, anon, authenticated;


-- Every hour, on the hour. Re-running this replaces the job of the same name.
select cron.schedule('cleanup-expired', '0 * * * *', $$select public.run_cleanup()$$);
