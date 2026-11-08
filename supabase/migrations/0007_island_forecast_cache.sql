-- Shared rain forecast cache: a cron job calls the forecast-refresh Edge Function once an hour, the
-- function fetches the island forecast from Open-Meteo and keeps it here, and every phone reads it
-- from this table instead of asking Open-Meteo itself.
-- The secret the cron job sends is NOT in this file. You store it in Vault by hand after running this
-- (see docs/forecast-cache.md for the steps).
--
-- Builds on 0003, which turned on pg_cron, pg_net and Vault and stored the project_url secret.
-- Not run yet. Run it by hand in the SQL Editor after checking it. Everything is in one transaction,
-- so it either all applies or none of it does.

begin;


-- One row only (id is always 1), replaced by each good run. A phone therefore always sees one
-- complete forecast, and there is nothing to clean up.
create table public.island_forecast (
  id              smallint primary key default 1 check (id = 1),
  -- When the function got it from Open-Meteo. The app counts the age of the forecast from this.
  fetched_at      timestamptz not null,
  -- How many places are in it, so the app can tell it matches its own grid
  point_count     integer not null check (point_count > 0),
  -- { "times": [hour labels, once], "cells": [{ "mm": [...], "code": [...], "chance": [...] }, ...] }
  -- with one cell per grid point, in the grid's order
  data            jsonb not null,
  -- Notes about the latest run, for checking on it. The app can't read these two.
  last_attempt_at timestamptz,
  last_error      text
);

alter table public.island_forecast enable row level security;

-- The forecast is public data: anyone can read it, nobody but the function can change it.
-- There is no insert, update or delete policy and no such grant for anon or authenticated.
create policy "island forecast is public to read"
  on public.island_forecast for select to anon, authenticated using (true);

revoke all on public.island_forecast from public, anon, authenticated;
-- A column grant, so the app can read the forecast but not the error text. The app has to name
-- its columns (select=* would be refused).
grant select (id, fetched_at, point_count, data) on public.island_forecast to anon, authenticated;
-- The Edge Function runs as service_role. New tables aren't reachable without explicit grants.
grant select, insert, update on public.island_forecast to service_role;


-- Reads the two Vault secrets and sends the request to the Edge Function, like run_cleanup() in 0003.
-- security definer so it can read Vault; nobody but the owner can run it.
create function public.run_forecast_refresh()
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
    from vault.decrypted_secrets where name = 'forecast_secret';
  select decrypted_secret into base_url
    from vault.decrypted_secrets where name = 'project_url';

  if secret is null or base_url is null then
    raise exception 'Vault secrets forecast_secret and project_url must be set first';
  end if;

  -- Returns a request id. The answer lands in net._http_response.
  return net.http_post(
    url := base_url || '/functions/v1/forecast-refresh',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-forecast-secret', secret
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 30000
  );
end;
$$;

revoke all on function public.run_forecast_refresh() from public, anon, authenticated;


-- Every hour at minute 23: off the hour, and away from the cleanup job at minute 0.
-- Until the Vault secret is set the job fails with the message above, which does no harm.
-- Re-running this replaces the job of the same name.
select cron.schedule('forecast-refresh', '23 * * * *', $$select public.run_forecast_refresh()$$);


commit;
