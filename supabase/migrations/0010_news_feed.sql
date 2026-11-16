-- Disaster news headlines. A cron job calls the news-refresh Edge Function every 15 minutes; it reads a
-- fixed list of official pages and news feeds, keeps only disaster-related headlines (headline, source,
-- time and link, never the article text) and stores them here. Phones read this table.
-- The secret the cron job sends is NOT in this file: store it in Vault as news_secret after running this
-- (see docs/news-feed.md for the steps).
--
-- Builds on 0003 (pg_cron, pg_net, Vault and the project_url secret). Independent of 0009, and of the
-- photo-path cleanup (which drops the old photo paths; the next free number after the landslide migration).
-- Run by hand in the SQL Editor, then supabase/checks/0010_check.sql. One transaction, so it either all
-- applies or none of it does.

begin;

create table public.news_items (
  id            bigint generated always as identity primary key,
  -- What makes an item unique: the cleaned-up link. For a notice that keeps the same address for each
  -- new issue (the Met Department's advisory PDFs) the function adds the file's version.
  item_key      text not null unique check (char_length(item_key) <= 2048),
  url           text not null check (url ~ '^https://' and char_length(url) <= 2048),
  title         text not null check (char_length(title) between 1 and 300),
  -- A short code ('dmc_news', 'adaderana_en', ...). The app turns it into the name it shows.
  source        text not null check (source ~ '^[a-z0-9_]{2,40}$'),
  kind          text not null check (kind in ('official', 'media')),
  -- Fixed official channels ('dmc_situation', 'meteo_sea', ...); null for headlines
  channel       text check (channel ~ '^[a-z0-9_]{2,40}$'),
  language      text not null check (language in ('en', 'si', 'ta')),
  hazard        text not null check (hazard in ('tsunami', 'cyclone', 'landslide', 'flood', 'earthquake',
                  'wind_sea', 'rain', 'elephant', 'road', 'drought', 'other')),
  published_at  timestamptz not null,
  fetched_at    timestamptz not null default now(),
  -- When an official notice was withdrawn (its Met Department field went empty)
  ended_at      timestamptz,
  -- For news pins later. Nothing fills these yet.
  place_name    text check (char_length(place_name) <= 100),
  location      extensions.geography(point, 4326)
    constraint news_items_location_in_sri_lanka check (
      location is null or (
        extensions.st_x(location::extensions.geometry) between 79.4 and 82.1
        and extensions.st_y(location::extensions.geometry) between 5.7 and 10.0)
    ),
  -- Why the filter kept it, for tuning. The app can't read these two.
  score         smallint not null default 0,
  matched       text[] not null default '{}',
  constraint news_items_channel_is_official check (channel is null or kind = 'official'),
  constraint news_items_not_from_the_future check (published_at <= fetched_at + interval '10 minutes')
);

create index news_items_published_at on public.news_items (published_at desc);

alter table public.news_items enable row level security;

-- Public data: anyone can read it, only the function (service_role) writes it.
-- There is no insert, update or delete policy and no such grant for anon or authenticated.
create policy "news items are public to read"
  on public.news_items for select to anon, authenticated using (true);

revoke all on public.news_items from public, anon, authenticated;
-- A column grant: the app must name its columns (select=* is refused). item_key (the app has url) and
-- score/matched (for tuning) stay private.
grant select (id, url, title, source, kind, channel, language, hazard,
              published_at, fetched_at, ended_at, place_name, location)
  on public.news_items to anon, authenticated;
grant select, insert, update, delete on public.news_items to service_role;


-- One row per source: caching headers and the last outcome. Closed to the API, like report_edits.
create table public.news_source_state (
  source        text primary key check (source ~ '^[a-z0-9_]{2,40}$'),
  etag          text,
  last_modified text,
  last_fetch_at timestamptz,
  last_status   integer,
  last_error    text,
  failures      integer not null default 0,
  robots_ok     boolean,
  robots_at     timestamptz,
  -- Per-source notes: the robots.txt Crawl-delay, and which Met Department advisories were out last time
  memo          jsonb not null default '{}'
);

alter table public.news_source_state enable row level security;
revoke all on public.news_source_state from public, anon, authenticated;
grant select, insert, update on public.news_source_state to service_role;


-- Like run_forecast_refresh() in 0007. security definer so it can read Vault; only the owner runs it.
create function public.run_news_refresh()
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
    from vault.decrypted_secrets where name = 'news_secret';
  select decrypted_secret into base_url
    from vault.decrypted_secrets where name = 'project_url';

  if secret is null or base_url is null then
    raise exception 'Vault secrets news_secret and project_url must be set first';
  end if;

  -- Returns a request id. The answer lands in net._http_response.
  return net.http_post(
    url := base_url || '/functions/v1/news-refresh',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-news-secret', secret),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  );
end;
$$;

revoke all on function public.run_news_refresh() from public, anon, authenticated;


-- Every 15 minutes, away from the cleanup job (minute 0) and the forecast (minute 23). Until the Vault
-- secret is set the job fails with the message above, which does no harm. Re-running this replaces jobs
-- of the same name.
select cron.schedule('news-refresh', '4,19,34,49 * * * *', $$select public.run_news_refresh()$$);

-- Headlines are kept for 7 days
select cron.schedule('news-cleanup', '41 * * * *',
  $$delete from public.news_items where published_at < now() - interval '7 days'$$);


commit;
