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

-- Only the sources that have a problem, or have never been read
select source, last_fetch_at, last_status, failures, last_error, robots_ok, robots_at
from public.news_source_state
where last_fetch_at is null or last_error is not null or failures > 0
order by source;

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
  `last_error` says `robots.txt does not allow this address`.
- `last_error` starting with `robots.txt:` means the function could not even read the site's robots.txt,
  and said why: `HTTP 503` or `HTTP 429` (the site is overloaded or limiting us), `TimeoutError` (no answer
  in 10 seconds), `connection reset` or `refused` (the site drops connections from Supabase's addresses),
  or a certificate message. A robots.txt that can't be reached is treated as "not allowed for now", so
  the source is not read at all; the function tries again, and after 3 failures in a row hourly. Nothing
  tries to get round it. If it stays like this for a site, turn the source off in `sources.ts`.
- A source with `last_fetch_at` empty and `last_error` empty was never reached by a run that wrote its
  row. Before the 15 Nov evening fix, an unreadable robots.txt looked exactly like this, with no reason kept.
- `dmc_warnings` usually has nothing: DMC's Emergency Warnings category is empty between emergencies.

## Review Sinhala/Tamil headlines

The PowerShell 5.1 window can't show Sinhala and Tamil reliably, so this saves what a dry run kept and
dropped for **one** source into a text file you open in Notepad, one headline per line with its score.
It stores nothing in the database.

```powershell
# The secret. Skip this if $secret is still set in this window; if the window was closed, copy the
# value from the dashboard's Vault (news_secret) and paste it when asked. Nothing is shown.
if (-not $secret) {
  $entered = Read-Host 'NEWS_SECRET' -AsSecureString
  $secret = [System.Net.NetworkCredential]::new('', $entered).Password
}

# Which source to review. adaderana_si, adaderana_ta, lankadeepa, divaina, tamilmirror, thinakaran...
$only = 'adaderana_si'
$url = 'https://ktwdmwiaodtirrcitlgb.supabase.co/functions/v1/news-refresh'

# A dry run for that one source. force=true asks it now even if it was read a few minutes ago
# (robots.txt still applies).
$response = Invoke-WebRequest -UseBasicParsing -Method Post `
  -Uri "${url}?dry_run=true&force=true&only=$only" -Headers @{ 'x-news-secret' = $secret }

# Read the bytes as UTF-8 ourselves, so the letters are right whatever the console does
$response.RawContentStream.Position = 0
$text = (New-Object System.IO.StreamReader($response.RawContentStream, [System.Text.Encoding]::UTF8)).ReadToEnd()
$dry = $text | ConvertFrom-Json

# One line per headline: score, headline, and the words that scored it
# (+ strong word, ~ weak word, - a word that took points away)
$kept = @($dry.items)
$dropped = @($dry.dropped | Sort-Object -Property score -Descending)
$lines = @()
$lines += "Dry run of $only on $(Get-Date -Format 'yyyy-MM-dd HH:mm')"
$lines += 'Source: ' + (($dry.sources | ForEach-Object { "$($_.id) $($_.status) found=$($_.found) kept=$($_.kept) $($_.error)" }) -join '; ')
$lines += ''
$lines += "=== KEPT: $(($dry.items | Measure-Object).Count) (score 2 or more) ==="
foreach ($i in $kept) { if ($i) { $lines += ('{0,3}  {1}  [{2}]' -f $i.score, $i.title, ($i.matched -join ' ')) } }
$lines += ''
$lines += "=== DROPPED: $(($dry.dropped | Measure-Object).Count), highest score first ==="
foreach ($d in $dropped) { if ($d) { $lines += ('{0,3}  {1}  [{2}]' -f $d.score, $d.title, ($d.matched -join ' ')) } }

# Save it in Downloads as UTF-8 with a byte order mark, so Notepad shows Sinhala and Tamil correctly
$downloads = (New-Object -ComObject Shell.Application).Namespace('shell:Downloads').Self.Path
$file = Join-Path $downloads "news-review-$only.txt"
[System.IO.File]::WriteAllLines($file, [string[]]$lines, (New-Object System.Text.UTF8Encoding($true)))
notepad $file

Remove-Variable only, url, response, text, dry, kept, dropped, lines, downloads, file, entered -ErrorAction SilentlyContinue
```

What to look for:

- The feed holds only the newest 25 or so headlines (a few hours' worth), so a story from this morning may
  already be gone. Run it again later in the day.
- In **DROPPED**, a headline about rain, wind, floods, landslides, elephants or road blockages is a missed
  word form. Tell me the headline and the word that should have matched.
- In **KEPT**, a headline that isn't about a disaster is a word that catches too much. The words in
  brackets are the ones that scored it.
- A score of 1 is a near miss (one weak word). A negative score means a cricket, money or foreign word
  took points off.
- Only sources with the keyword filter have a DROPPED list. The official channels (DMC warnings, the DMC
  report tables, the Met advisories) are kept whole.
- Don't run this over and over for `dailymirror` or `lankadeepa`: their robots.txt asks for an hour
  between requests, and `force=true` ignores our own timing (not theirs).

## Tuning the keywords

The Sinhala and Tamil lists in `keywords.ts` were written by an AI and need a native speaker. Use the
section above to see kept and dropped headlines with their `score` and `matched` words. A headline is
kept at score 2. Look for disaster headlines in the dropped list (a missed word form) and unrelated ones
in the kept list (a word that catches too much), change the lists, run `npm test`, and redeploy.

## Limits to keep in mind

- About 2,900 function runs a month, against the free plan's 500,000. Each run reads at most about
  440 KB from the sources, usually much less thanks to the intervals and 304s.
- The table holds a week of headlines: a few hundred rows, well under 1 MB.
- Supabase's outgoing IP addresses are shared with other projects, so a site may block or limit the
  function for reasons that have nothing to do with this app.
- The Edge Function never runs in tests. Tests use stand-ins for every site, Supabase and the function.
