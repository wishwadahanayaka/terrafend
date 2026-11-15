# Disaster news feed (backend)

Every 15 minutes an Edge Function reads a fixed list of official pages and news feeds, keeps only the
headlines about disasters in Sri Lanka, and stores the headline, source, time and link (never the
article text). Phones will read the table. The app side (the sheet and the chip) is not built yet.

```
pg_cron (minutes 4, 19, 34, 49)
  -> run_news_refresh()            reads the Vault secrets, sends a request with the secret header
  -> Edge Function news-refresh    asks each source that is due, keeps the disaster headlines
  -> table news_items              one row per headline, kept 7 days (news-cleanup job, hourly)
     table news_source_state       one row per source: caching headers, last result, robots.txt
```

The plan, the source checks and the reasons behind each choice are in `docs/news-feed-plan.md`. The
sources are listed in `supabase/functions/news-refresh/sources.ts`, the keyword lists in `keywords.ts`.

## What the function does on each run

- Asks only the sources that are due. Each has its own interval (15 minutes to 2 hours), never shorter
  than its robots.txt Crawl-delay (Daily Mirror and Lankadeepa ask for an hour).
- Reads each site's robots.txt once a day and skips a source its robots.txt disallows.
- Identifies itself as `TerraFend/1.0 (+https://terrafend.vercel.app; free Sri Lanka hazard map;
  contact: https://github.com/wishwadahanayaka/terrafend)`.
- Sends `If-None-Match` / `If-Modified-Since` from the last answer, so an unchanged feed costs a 304.
- Gives each request 10 seconds and reads at most 1 MB. Follows at most 3 redirects, and only within
  the source's own site. Stops starting new sources after 45 seconds.
- Reads 4 sources at a time. One failing never stops the others; its error goes in `news_source_state`.
  After 3 failures in a row a source is asked at most hourly, and after a 403 or 410 once a day.
- Keeps a link only if it is https and on the source's own site.
- Official warning channels (DMC Emergency Warnings, DMC's report tables, the Met Department's
  advisories) are kept whole. DMC News and the news sites go through the keyword filter.

## Setup (once)

Do these in order, in **one PowerShell window**, from the project folder. The secret lives only in that
window's memory (`$secret`). None of these commands print it, so don't add an `echo` or `Write-Host`
of it, and close the window at the end.

**1. Run the migration.** Open the Supabase SQL Editor, paste `supabase/migrations/0010_news_feed.sql`
and run it. It needs 0003 (pg_cron, pg_net, Vault and the `project_url` secret), which is already run.
It does not depend on 0009. Until step 5 is done the 15-minute job fails with "Vault secrets
news_secret and project_url must be set first". That does no harm.

Then run `supabase/checks/0010_check.sql`. Every line should say PASS except check 10 (the Vault
secret, done in step 5) and the two "info" lines.

**2. Make a random secret** (32 random bytes, written with letters, digits, `-` and `_` only, so it
needs no quoting anywhere). Use a new one, not the forecast secret:

```powershell
$bytes = New-Object byte[] 32
$rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
$rng.GetBytes($bytes)
$rng.Dispose()
$secret = [Convert]::ToBase64String($bytes).TrimEnd('=').Replace('+','-').Replace('/','_')
```

**3. Give the function its copy.** The CLI should only say it finished; it does not print the value:

```powershell
npx supabase secrets set "NEWS_SECRET=$secret"
```

**4. Deploy the function:**

```powershell
npx supabase functions deploy news-refresh --no-verify-jwt
```

**5. Put the same value in Vault, through the dashboard.** Copy it to the clipboard without showing it:

```powershell
Set-Clipboard -Value $secret
```

In the Supabase dashboard open **Vault** (it has lived under **Integrations** and under **Database** in
different versions of the dashboard; the search box finds it), go to its secrets, choose
**Add new secret**, name it exactly `news_secret`, paste the clipboard as the value, add the
description "Secret the cron job sends to news-refresh", and save. Then clear the clipboard:

```powershell
Set-Clipboard -Value ' '
```

(If you'd rather use the SQL Editor, it is
`select vault.create_secret('PASTE', 'news_secret', 'Secret the cron job sends to news-refresh');`, but
the editor keeps the query in its history, so delete that snippet afterwards.)

Run `supabase/checks/0010_check.sql` again: check 10 should now say PASS.

**6. Try it by hand.** First a dry run: it reads every source, judges every headline and stores nothing.
Its answer lists what it would keep (`items`) and what the filter dropped (`dropped`), which is what to
look at when reviewing the keyword lists:

```powershell
$url = 'https://ktwdmwiaodtirrcitlgb.supabase.co/functions/v1/news-refresh'
$dry = Invoke-RestMethod -Method Post -Uri "${url}?dry_run=true&force=true" -Headers @{ 'x-news-secret' = $secret }
$dry.sources | Format-Table id, status, found, kept, error
$dry.items | Format-Table source, language, hazard, score, title -AutoSize
$dry.dropped | Format-Table source, score, title -AutoSize
```

Then one real run (or just wait for the next quarter hour):

```powershell
$run = Invoke-RestMethod -Method Post -Uri "${url}?force=true" -Headers @{ 'x-news-secret' = $secret }
$run | Select-Object result, stored, ended
$run.sources | Format-Table id, status, found, kept, error
```

To try one source only, add `only=<id>`, for example `?only=dailymirror&dry_run=true&force=true`.
`force=true` ignores the intervals (robots.txt still applies), so don't use it in a loop: Daily Mirror
and Lankadeepa ask for an hour between requests.

**7. Clean up the window:**

```powershell
Remove-Variable secret, bytes, rng, url, dry, run
```

### Changing the secret later

Make a new `$secret` as in step 2, run step 3, and replace the Vault copy (dashboard → Vault → edit
`news_secret`, or `select vault.update_secret((select id from vault.secrets where name = 'news_secret'), 'PASTE');`).

### Stopping it

```sql
select cron.unschedule('news-refresh');
```

The stored headlines stay until the `news-cleanup` job removes them after 7 days. To stop one source
only, set `enabled: false` for it in `sources.ts` and redeploy; to remove what it stored:

```sql
delete from public.news_items where source = 'dailymirror';
```

## Health check

Run in the SQL Editor. It never shows the secret.

```sql
-- One line per source: when it was last asked, how it went, and robots.txt
select source,
       last_fetch_at,
       now() - last_fetch_at        as since,
       last_status,
       failures,
       last_error,
       robots_ok,
       memo->>'robotsDelaySec'      as robots_delay_s
from public.news_source_state
order by source;

-- What is stored, per source, over the last day
select source, kind, count(*) as items, max(published_at) as newest
from public.news_items
where fetched_at > now() - interval '1 day'
group by source, kind
order by kind, source;

-- The newest headlines with why they were kept (for tuning the keywords)
select published_at, source, language, hazard, score, matched, title
from public.news_items
order by published_at desc
limit 30;

-- The last 5 times the cron job ran (this only says whether the request was sent)
select start_time, status, return_message
from cron.job_run_details
where jobid = (select jobid from cron.job where jobname = 'news-refresh')
order by start_time desc
limit 5;
```

How to read it:

- `since` should stay under each source's interval plus 15 minutes (15 to 120 minutes). Much longer
  means the job isn't running or the source keeps failing.
- `last_status` 304 is good (nothing new). 200 with `failures` 0 is good.
- `failures` of 3 or more: the source is now asked hourly. `last_error` says why (`HTTP 500`,
  `timed out`, `not an RSS or Atom feed`, `no rows found: the page layout may have changed` for a DMC
  table, `content.json has no severe_weather_advisory` for the Met Department).
- `last_status` 403 or 410: the site blocks us or the feed is gone. The source is asked once a day.
  Don't try to get round it: check the site by hand, and turn the source off if it stays that way.
- `robots_ok` false: the site's robots.txt now disallows the feed. It is not read until that changes.
- `dmc_warnings` usually has nothing: DMC's Emergency Warnings category is empty between emergencies.

## Tuning the keywords

The Sinhala and Tamil lists in `keywords.ts` were written by an AI and need a native speaker. A dry run
(step 6) lists both kept and dropped headlines with their `score` and `matched` words. A headline is kept
at score 2. Look for disaster headlines in `dropped` (a missed word form) and unrelated ones in `items`
(a word that catches too much), change the lists, run `npm test`, and redeploy.

## Limits to keep in mind

- About 2,900 function runs a month, against the free plan's 500,000. Each run reads at most about
  440 KB from the sources, usually much less thanks to the intervals and 304s.
- The table holds a week of headlines: a few hundred rows, well under 1 MB.
- Supabase's outgoing IP addresses are shared with other projects, so a site may block or limit the
  function for reasons that have nothing to do with this app.
- The Edge Function never runs in tests. Tests use stand-ins for every site, Supabase and the function.
