# Shared rain forecast cache

Open-Meteo's free tier is limited per IP address, and many phones in Sri Lanka share one. So instead
of every phone fetching the island forecast (about 137 places, hourly numbers to the end of tomorrow),
one Edge Function fetches it once an hour and keeps it in a table. Phones read it from there.

```
pg_cron (minute 23, hourly)
  -> run_forecast_refresh()      reads the Vault secrets, sends a request with the secret header
  -> Edge Function forecast-refresh   asks Open-Meteo once, checks the answer
  -> table island_forecast       one row, replaced by each good run
  <- the app reads it with a plain request (anon key), no sign-in
```

## What the app does with it

In this order (`loadForecast` in `src/lib/forecastCache.ts`):

1. A cached forecast up to **150 minutes** old is used as it is. Open-Meteo is not asked.
2. Otherwise (no row, can't be read, damaged, or older than 150 minutes) the app asks Open-Meteo
   directly, with all the usual 429 handling.
3. If that fails too, the cached one is used anyway, as long as it is inside the **6-hour** age cap. It is
   shown with "Rain forecast from 2:15 pm. It could not be refreshed just now." and tried again sooner.
4. With nothing usable left it says "Rain forecast unavailable right now".

The route rain forecast still asks Open-Meteo directly. It does not use the cache.

If anything here is missing or broken, the app behaves exactly as it did before the cache existed.

## Setup (once)

Do these in order, in **one PowerShell window**, from the project folder. The secret lives only in that
window's memory (`$secret`). None of these commands print it, so don't add an `echo` or `Write-Host`
of it, and close the window at the end.

**1. Run the migration.** Open the Supabase SQL Editor, paste `supabase/migrations/0007_island_forecast_cache.sql`
and run it. It needs 0003 (pg_cron, pg_net, Vault and the `project_url` secret) to have been run already.
Until step 5 is done the hourly job fails with "Vault secrets forecast_secret and project_url must be
set first". That does no harm.

**2. Make a random secret** (32 random bytes, written with letters, digits, `-` and `_` only, so it
needs no quoting anywhere):

```powershell
$bytes = New-Object byte[] 32
$rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
$rng.GetBytes($bytes)
$rng.Dispose()
$secret = [Convert]::ToBase64String($bytes).TrimEnd('=').Replace('+','-').Replace('/','_')
```

**3. Give the function its copy.** The CLI should only say it finished; it does not print the value:

```powershell
npx supabase secrets set "FORECAST_SECRET=$secret"
```

**4. Deploy the function** (the first deploy; later changes use the same command):

```powershell
npx supabase functions deploy forecast-refresh --no-verify-jwt
```

**5. Put the same value in Vault.** Copy it to the clipboard without showing it:

```powershell
Set-Clipboard -Value $secret
```

In the SQL Editor run this, pasting the clipboard where it says `PASTE`, then run it:

```sql
select vault.create_secret('PASTE', 'forecast_secret', 'Secret the cron job sends to forecast-refresh');
```

Then clear the clipboard in PowerShell:

```powershell
Set-Clipboard -Value ' '
```

The SQL Editor keeps what you ran in its history, which now contains the secret. Delete that snippet
from the editor's history (or just write the query in a new tab and close it without saving).

**6. Try it once by hand.** First a dry run (asks Open-Meteo, checks the answer, stores nothing, costs
about 137 calls), then the real thing:

```powershell
$url = 'https://ktwdmwiaodtirrcitlgb.supabase.co/functions/v1/forecast-refresh'
Invoke-RestMethod -Method Post -Uri "${url}?dry_run=true&force=true" -Headers @{ 'x-forecast-secret' = $secret }
Invoke-RestMethod -Method Post -Uri "${url}?force=true" -Headers @{ 'x-forecast-secret' = $secret }
```

Each prints what happened, for example `result : ok`, `points : 137`, `hours : 48` and `bytes`. If it says
`rate_limited` or `failed`, nothing was stored and the reason is in the answer and in the function's logs.

**7. Check the row** with the health query below. After this the hourly job keeps it fresh.

**8. Clean up the window:**

```powershell
Remove-Variable secret, bytes, rng, url
```

### Changing the secret later

Make a new `$secret` as in step 2, run step 3, and replace the Vault copy:

```sql
select vault.update_secret((select id from vault.secrets where name = 'forecast_secret'), 'PASTE');
```

### Stopping it

```sql
select cron.unschedule('forecast-refresh');
```

The app then falls back to asking Open-Meteo itself once the cached row is 150 minutes old.

## Health check

Run in the SQL Editor. It never shows the secret.

```sql
-- The stored forecast: how old, and how the last runs went
select fetched_at,
       now() - fetched_at          as age,
       last_attempt_at,
       last_error,
       point_count,
       pg_column_size(data)        as bytes_stored
from public.island_forecast;

-- The last 5 times the cron job ran (this only says whether the request was sent)
select start_time, end_time, status, return_message
from cron.job_run_details
where jobid = (select jobid from cron.job where jobname = 'forecast-refresh')
order by start_time desc
limit 5;

-- What the function answered to the last 5 requests (status_code 200 is a good run, 502 is not)
select created, status_code, content
from net._http_response
order by created desc
limit 5;
```

How to read it:

- `age` under about 70 minutes is healthy. Over 150 minutes the app stops using the cache as current and
  asks Open-Meteo itself, so check the other two queries.
- `last_error` is the note from the latest failed run (for example `429: Hourly API request limit
  exceeded.`). It is cleared by the next good run. No row at all means no run has ever succeeded.
- `cron.job_run_details` shows `failed` with "Vault secrets ... must be set first" if step 5 wasn't done.
- `net._http_response` shows the function's answer. `skipped` means a run came within 30 minutes of the
  last one (that is the guard working). `rate_limited` or `failed` keep the old row.

## If the grid changes

The function reads its list of places from `supabase/functions/forecast-refresh/grid.json`, which is made
from the app's own grid (`landGrid()`). If the grid ever changes, the test `forecastRefresh.test.ts` fails.
Rewrite the file and redeploy:

```powershell
$env:UPDATE_GRID = '1'
npx vitest run src/lib/forecastRefresh.test.ts
Remove-Item Env:UPDATE_GRID
npx supabase functions deploy forecast-refresh --no-verify-jwt
```

Until it is redeployed the app notices the cached row doesn't match its grid (`point_count`) and asks
Open-Meteo itself.

## Limits to keep in mind

- Open-Meteo free tier: 600 calls a minute, 5,000 an hour, 10,000 a day, 300,000 a month, non-commercial
  use, attribution required (the credit stays in the app). One run is about 137 calls, so about 3,300 a day
  and 99,000 a month.
- Supabase's outgoing IP addresses are shared with other projects, so the function can get a 429 that has
  nothing to do with this app. It keeps the old row and waits for the next run.
- Supabase free tier egress is 5 GB a month. The row is roughly 30 to 55 KB (smaller once compressed) and
  each phone reads it about once an hour while the app is open.
- The Edge Function never runs in tests. Tests use stand-ins for Open-Meteo, Supabase and the function.
