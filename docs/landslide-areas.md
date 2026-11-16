# Official landslide warnings (backend)

Every 30 minutes an Edge Function reads DMC's list of landslide warnings, downloads the NBRO warning
PDFs (LEWM messages) it hasn't seen, reads each one, and stores the warning and the DS divisions it
names, level by level (1 Watch/Yellow, 2 Alert/Amber, 3 Evacuate/Red). Phones will read the tables
through one function, `landslide_current()`. The app side (the map layer, the chip, the route warnings)
is not built yet.

```
pg_cron (minutes 9 and 39)
  -> run_landslide_refresh()        reads the Vault secrets, sends a request with the secret header
  -> Edge Function landslide-refresh
       reads DMC's list (robots.txt, Crawl-delay, conditional requests, like news-refresh)
       downloads each new PDF, reads its text with positions (unpdf), matches the names to p-codes
       -> store_landslide_warning()   the warning and its areas in ONE transaction
  -> table landslide_warnings        one row per PDF that is a warning: read, or "could not be read"
     table landslide_areas           one row per division named (matched to a p-code, or kept as text)
     table landslide_seen_pdfs       PDFs looked at and skipped (not a warning, or a repeat). Closed to the API.
     table news_source_state         one row, `landslide_list`: caching headers, last result, robots.txt
  -> pg_cron 'landslide-cleanup' (minute 56): warnings and skipped PDFs deleted after 14 days
  -> landslide_current()             what the app is told: the NEWEST warning, valid or not, readable or not
```

The plan and the reasons behind each choice are in `docs/news-map-plan.md` (section B, and "Built:
landslide areas, part 1 and part 2"). The reader is `supabase/functions/landslide-refresh/lewm.ts`
(layout rules and what it refuses), the name matching `names.ts` (with the alias list), the run itself
`logic.ts`.

## What the function does on each run

- Reads DMC's landslide list (the same address `news-refresh` reads as `dmc_landslide`, which it does
  hourly). Keeps its own row of state, `landslide_list`, in `news_source_state`, so it needs 0010.
- Keeps to DMC the same polite way: the same User-Agent
  (`TerraFend/1.0 (+https://terrafend.vercel.app; ...)`), robots.txt read once a day (for the list and for
  the PDF folder `/images/dmcreports/`), any Crawl-delay kept, `If-None-Match` / `If-Modified-Since`
  from the last answer, 10 seconds for the list and 20 for a PDF, at most 3 redirects and only within
  `dmc.gov.lk`, 1 MB for the list and 3 MB for a PDF, a pause of at least a second before each PDF, and
  the same 45-second budget and 52-second deadline per run as `news-refresh`. After 3 failing runs in a
  row it asks at most hourly, and after a 403 or 410 once a day. Nothing tries to get round a block.
- Looks at the newest 5 entries of the list (`?pdfs=N`, at most 10) and ignores any listed more than 13
  days ago. Of those, it downloads only the PDFs it has not seen: a link is "seen" if it is stored as a
  warning (read or not) or is in `landslide_seen_pdfs`.
- Only downloads from DMC's PDF folder: `https://www.dmc.gov.lk/images/dmcreports/...` (or the same
  without `www.`; every real sample was on `www.dmc.gov.lk`). A link anywhere else is a failure of the
  list, not a download. The tables refuse any other link too.
- Identifies a warning by the **Message ID inside the PDF**, not by its file name (DMC's file names
  differ: `LEWM_14-11-2026_16_00__...pdf`, `Landslide_EW_Report_at_1600hrs_on_2026__...pdf`).
- A PDF with readable text and no "Landslide Early Warning" title or `LEWM` message is **not a warning**:
  it is recorded in `landslide_seen_pdfs` and skipped. A PDF with no text at all (a scan), or with the
  title but a layout the reader can't handle, is a **warning that could not be read**, never skipped,
  because skipping a real warning silently would be worse than saying it couldn't be read.
- A readable warning is stored with all its names: matched to the Survey Department's p-code, or kept as
  printed with `area_code` empty and the reason in `match_note`. Nothing is dropped and nothing is
  guessed.
- A PDF that can't be downloaded (a 5xx, a timeout, an error page with status 200, a cut-off file) is
  tried again on the next runs. After 3 tries it is stored as a warning that could not be read
  ("could not be downloaded after 3 tries: HTTP 500"), so the app can say there is a newer warning it
  couldn't read, instead of showing an older one as current.
- A warning that was already stored under another address (same message ID) is stored once, and the
  second address goes in `landslide_seen_pdfs` as `duplicate`.
- Before storing, checks the warning against the same rules as the tables (message ID pattern,
  update number 0 to 999, the validity period ending after it starts, text lengths, p-code patterns,
  no DS division twice). A warning that breaks one is stored as **could not be read** with the reason,
  so it isn't downloaded and refused again on every run.
- Stores a warning and its areas through `store_landslide_warning()`, which is one transaction: a
  warning is never left without its areas. What happens when storing raises an error depends on the
  **Postgres error code** (kept all the way from the database):
  - **Class 22 (data exception: a value out of range, a bad timestamp...) or class 23 (integrity
    constraint violation: a check, a unique key...)** means the database refused the data itself. The
    PDF is stored as could not be read, with a reason starting `database rejected:` and the code (cut to
    300 characters), so it isn't downloaded and refused again on every run. The run reports a failure, so
    it shows. If even that row can't be stored, it is logged and left, and the next run tries again.
  - **Anything else** (no code, a network error, a timeout, a dropped connection, an HTTP 5xx, a
    PostgREST `PGRST...` code, a lock or shutdown) says nothing about the warning. **Nothing is stored**,
    the run counts as failed (`store_failed` in the answer, and the usual backoff after 3 failing runs in
    a row), and the next run downloads and reads that PDF again, until it is stored. While one waits, the
    list is read in full each time (no `304 Not Modified`), so it can't be hidden. A PDF stuck this way
    does not block the others: each one is handled on its own, newest first, so a newer warning is stored
    in the same run (the answer shows each PDF's outcome). Its count of failed attempts is
    `store_failures` in the state's memo (see the health check).
- The function (`service_role`) can only read and add rows in the three tables, never change, delete
  or empty them. Its count of download tries is kept in its `news_source_state` row, not in these tables.

### What the app will be told (`landslide_current()`)

```json
{ "found": true, "id": 12, "message_id": "LEWM-14-11-2026-1600-09", "update": 9,
  "issued_at": "...", "valid_from": "...", "valid_to": "...", "listed_at": "...", "pdf_url": "https://...pdf",
  "parse_ok": true, "valid": true,
  "areas": [ { "level": 1, "district": "Badulla", "name": "Hali_Ela", "code": "LK8124",
               "district_code": "LK81", "shift": -1, "added": false, "note": null } ] }
```

- It is about the **newest** warning only: the one DMC listed last (`listed_at`, then `id`).
- `valid` is true only when the warning was read and `valid_to` is still in the future.
- **If the newest warning could not be read**: `parse_ok` is false, `valid` is false and `areas` is
  empty. It does **not** fall back to an older warning, even one that is still inside its 24 hours. The
  app shows "Latest warning couldn't be read, open the PDF" with `pdf_url`.
- A name that could not be matched is in `areas` with `code` null and the reason in `note`.
- With nothing stored it is `{ "found": false }`.
- The app calls it as `POST /rest/v1/rpc/landslide_current` with only the `apikey` header, like the
  other reads. The app can read the columns granted in 0011 and nothing else: `parse_error` and
  `fetched_at` (and the internal id of an area row) are private.

## Setup (once)

Do these in order, in **one PowerShell window**, from the project folder. The secret lives only in that
window's memory (`$secret`). None of these commands print it, so don't add an `echo` or `Write-Host`
of it, and close the window at the end.

**1. Run the migration.** Open the Supabase SQL Editor, paste `supabase/migrations/0011_landslide_areas.sql`
and run it. It needs 0003 (pg_cron, pg_net, Vault and the `project_url` secret) and 0010
(`news_source_state`), which are already run; it stops with a message if 0010 is missing. It doesn't
depend on 0009. Until step 5 is done the 30-minute job fails with "Vault secrets landslide_secret and
project_url must be set first". That does no harm.

Then run `supabase/checks/0011_check.sql`. Every line should say PASS except check 12 (the Vault
secret, done in step 5) and the "info" lines.

**2. Make a random secret** (32 random bytes, written with letters, digits, `-` and `_` only). Use a new
one, not the news or forecast secret:

```powershell
$bytes = New-Object byte[] 32
$rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
$rng.GetBytes($bytes)
$rng.Dispose()
$secret = [Convert]::ToBase64String($bytes).TrimEnd('=').Replace('+','-').Replace('/','_')
```

**3. Give the function its copy.** The CLI should only say it finished; it does not print the value:

```powershell
npx supabase secrets set "LANDSLIDE_SECRET=$secret"
```

**4. Deploy the function:**

```powershell
npx supabase functions deploy landslide-refresh --no-verify-jwt
```

The function imports a few pieces from `supabase/functions/news-refresh/` (its polite fetching and
robots.txt reading), so the deploy bundles those files too. This is what `deno check` accepts, but the
deploy itself hasn't been tried yet: if it complains about a file outside the function's folder, say so
and the shared pieces move to `supabase/functions/_shared/`. `news-refresh` itself does **not** need
redeploying: its code only gained `export` keywords, and nothing about how it behaves changed.

**5. Put the same value in Vault, through the dashboard.** Copy it to the clipboard without showing it:

```powershell
Set-Clipboard -Value $secret
```

In the Supabase dashboard open **Vault**, go to its secrets, choose **Add new secret**, name it exactly
`landslide_secret`, paste the clipboard as the value, add the description "Secret the cron job sends to
landslide-refresh", and save. Then clear the clipboard:

```powershell
Set-Clipboard -Value ' '
```

(If you'd rather use the SQL Editor, it is
`select vault.create_secret('PASTE', 'landslide_secret', 'Secret the cron job sends to landslide-refresh');`,
but the editor keeps the query in its history, so delete that snippet afterwards.)

Run `supabase/checks/0011_check.sql` again: check 12 should now say PASS.

**6. Your first test: a dry run.** It reads DMC's list, downloads the newest PDFs, parses them and
matches the names, and **stores nothing** (not even its state). `force=true` ignores the interval and
the "already seen" list, `pdfs=3` looks at the newest 3 entries:

```powershell
$url = 'https://ktwdmwiaodtirrcitlgb.supabase.co/functions/v1/landslide-refresh'
$took = Measure-Command {
  $dry = Invoke-RestMethod -Method Post -Uri "${url}?dry_run=true&force=true&pdfs=3" -Headers @{ 'x-landslide-secret' = $secret }
}
"{0:n1} s" -f $took.TotalSeconds
$dry | Select-Object result, startedAt, leftForLater
$dry.list
$dry.errors
$dry.pdfs | Format-Table outcome, stored, reason, url -AutoSize -Wrap
$dry.pdfs[0].summary | Format-List messageId, update, issuedAt, validFrom, validTo, matched, unmatched
$dry.pdfs[0].summary.areas | Format-Table level, district, name, code, shift, added, note -AutoSize
```

What to look at:

- `list.status` is `ok` and `list.found` is about 10 (rows in DMC's table).
- Each PDF's `outcome` is `read` (a readable warning) for a real LEWM. `unreadable` says why in `reason`.
- `summary.unmatched` should be 0 (or each one explained in `note`). A real name that didn't match is
  a spelling NBRO uses that isn't in `ALIASES` in `names.ts`: tell me the district and the name, and it
  gets an alias (never a guess).
- It should take a few seconds. Supabase's Edge Functions have a CPU limit per request (about 2 s at the
  time of writing: check the current figure in the Supabase docs). Reading a PDF took 20 to 190 ms on
  a PC, so it should be far inside it, but this is the first time on Supabase. If the function is cut
  off ("CPU time exceeded", or no answer), look at the function's logs and tell me.
- A 502 means `result` is `failed`: `errors` says why.

**7. Then one real run** (or just wait for the next half hour). `force=true` makes it look at all the
newest entries once:

```powershell
$run = Invoke-RestMethod -Method Post -Uri "${url}?force=true" -Headers @{ 'x-landslide-secret' = $secret }
$run | Select-Object result, stored
$run.pdfs | Format-Table outcome, stored, reason, url -AutoSize -Wrap
```

Run `0011_check.sql` again: check 19 shows what the app would be told (`found=true, parse_ok=true,
valid=...`), and checks 21 to 23 show what is stored.

**8. See it as the app will.** The public key is read from `.env` and not shown:

```powershell
$base = 'https://ktwdmwiaodtirrcitlgb.supabase.co'
$key = ((Get-Content .env | Where-Object { $_ -like 'VITE_SUPABASE_PUBLISHABLE_KEY=*' }) -split '=', 2)[1].Trim().Trim('"')
$now = Invoke-RestMethod -Method Post -Uri "$base/rest/v1/rpc/landslide_current" -Headers @{ apikey = $key } -ContentType 'application/json' -Body '{}'
$now | Select-Object found, message_id, update, valid, parse_ok, valid_to
$now.areas | Format-Table level, district, name, code -AutoSize
# the private columns must be refused (a 401 or 403 with 42501)
try { Invoke-WebRequest -UseBasicParsing -Uri "$base/rest/v1/landslide_warnings?select=parse_error&limit=1" -Headers @{ apikey = $key } | Out-Null; 'FAIL: parse_error was readable' } catch { 'PASS: parse_error refused' }
```

Also run `supabase/checks/privacy.sql`: check 6 and the new check 18 should say PASS.

**9. Clean up the window:**

```powershell
Remove-Variable secret, bytes, rng, url, took, dry, run, base, key, now
```

### Changing the secret later

Make a new `$secret` as in step 2, run step 3, and replace the Vault copy (dashboard → Vault → edit
`landslide_secret`, or `select vault.update_secret((select id from vault.secrets where name = 'landslide_secret'), 'PASTE');`).

### Stopping it

```sql
select cron.unschedule('landslide-refresh');
select cron.unschedule('landslide-cleanup');
```

The stored warnings stay until the cleanup job removes them after 14 days (so unschedule the cleanup
only if you want to keep them).

## Health check

Run in the SQL Editor. It never shows the secret.

```sql
-- How the list was last read: when, how it went, robots.txt, and any PDF waiting for another try
-- (a download that failed, or a database call that failed while storing it)
select source, last_fetch_at, now() - last_fetch_at as since, last_status, failures, last_error,
       robots_ok, memo->>'robotsDelaySec' as robots_delay_s, memo->>'pdfAllowed' as pdf_folder_allowed,
       memo->'tries' as download_tries, memo->'storeFailures' as store_failures
from public.news_source_state
where source = 'landslide_list';

-- The newest warnings, with why one could not be read
select id, listed_at, message_id, update_number, valid_to, valid_to > now() as still_valid,
       parse_ok, parse_error, pdf_url, fetched_at
from public.landslide_warnings
order by listed_at desc
limit 10;

-- Names that could not be matched to a boundary (add each to ALIASES in names.ts, or tell me)
select w.message_id, a.level, a.district_name, a.ds_name, a.match_note
from public.landslide_areas a join public.landslide_warnings w on w.id = a.warning_id
where a.area_code is null
order by w.listed_at desc, a.level desc, a.district_name;

-- PDFs looked at and skipped
select seen_at, outcome, note, pdf_url from public.landslide_seen_pdfs order by seen_at desc limit 10;

-- What the app is told right now
select public.landslide_current();

-- The last 5 times the cron job ran (this only says whether the request was sent)
select start_time, status, return_message
from cron.job_run_details
where jobid = (select jobid from cron.job where jobname = 'landslide-refresh')
order by start_time desc
limit 5;
```

How to read it:

- `since` should stay under about 45 minutes (30-minute job, 25-minute interval). Much longer means the
  job isn't running or the list keeps failing.
- `failures` of 3 or more: the list is now asked hourly. `last_error` says why (`HTTP 500`, `timed out`,
  `no rows found: the page layout may have changed`, `no usable rows: ...`, or a PDF's name and reason).
  `robots.txt: ...` means robots.txt couldn't be read: nothing is asked until it can. `robots.txt does
  not allow this address` means DMC now disallows the list. Nothing tries to get round either.
- `download_tries` shows a PDF that failed to download and is waiting for another try (`{"https://...pdf": 2}`).
- `store_failures` shows a PDF that was read but could not be stored because the database call itself
  failed (not because of the data). It should be empty. A number that keeps growing means the database
  or the function's connection to it is down or erroring: see `last_error` (`LEWM-...: storing it failed
  (...), will try again`) and the function's logs.
- **The list can go quiet without any error** (DMC stops publishing, or changes the page so it still
  has rows but not these). The page layout changing shows up as `no rows found`. A quiet list when
  warnings are being issued (check the news or nbri.gov.lk by hand) is worth a look at the dry run.
- `still_valid` is false once a warning's 24 hours are over. The app will say so (and it is greyed on the
  news sheet, see `docs/news-feed.md`).
- A few `not_lewm` rows in the skipped list are normal only if DMC puts other documents in this
  category. A real warning in there means the title or message wording changed: see below.

## When a warning could not be read

The app will say "Latest warning couldn't be read, open the PDF", and will **not** show an older warning
as current, so this needs fixing, but nothing is hidden meanwhile.

1. **Find it.** The "newest warnings" query above shows `parse_ok = false` with `parse_error`, and the
   PDF link. Open the PDF and look at its table.
2. **Read the reason.** Common ones:
   - `the table header is incomplete` / `... is out of order` / `no warning table`: the table's header
     changed (a column renamed, added or moved).
   - `the end of the table (the "Note:" line) was not found`, or a cell that "doesn't end with
     Divisional Secretariat Division(s) (DSD) and surrounding areas": NBRO changed the wording around
     the cells.
   - `a Level 2 cell (...) lines up with 0 districts`, `... text crosses into the next column`: the
     layout moved.
   - `unexpected text where a DS division should be: "..."`: a cell holds something that isn't a name
     (a note, a number, a new symbol).
   - `no Message ID`, `no Validity Period`, `the Validity Period doesn't start near the issue time`:
     the top of the first page changed.
   - `the PDF has no text (a scan?)`: DMC uploaded a picture. Nothing can read it; open the PDF by hand.
   - `could not be downloaded after 3 tries: ...`: DMC's server was failing. Open the PDF in a browser; if
     it works now, delete the row (step 5) and it is read again.
   - `the message ID is not in the usual form`, `the update number is out of range`, `a name is empty or
     longer than expected`, `... is named twice` and the like: the PDF was read, but what it says breaks
     a rule of the tables. The function's answer for a dry run (`?dry_run=true&force=true`) still shows
     what was read (`summary`), to see which part is odd.
   - `database rejected: ...` (with Postgres's error code, always class 22 or 23, e.g. `23514` for a
     failed check): the table refused a warning the function's own checks passed, so the two disagree.
     That is a bug: send me the reason. (A lost connection or a timeout is never stored this way: that
     PDF is tried again by itself, see "What the function does".)
3. **Make a fixture of it.** Text with positions, the form the tests keep (a PDF itself is DMC's
   document and is not kept in the repo). From the project folder:
   ```powershell
   node -e "const { pdfPages } = await import('./supabase/functions/landslide-refresh/pdfText.ts'); const fs = await import('node:fs'); const pages = await pdfPages(new Uint8Array(fs.readFileSync(process.argv[1]))); fs.writeFileSync('lewm-new.json', JSON.stringify({ pages }, null, 1))" --input-type=module "C:\path\to\the.pdf"
   ```
   Then give me `lewm-new.json` (it holds only the PDF's text and positions) and what the PDF shows.
4. **Fix the reader** (`lewm.ts`) or the names (`names.ts` `ALIASES`), with a test on that fixture, run
   `npm test`, and redeploy: `npx supabase functions deploy landslide-refresh --no-verify-jwt`.
5. **Read it again.** A failed warning counts as seen, so it is not downloaded again by itself. Delete its
   row (an unreadable warning has no areas, so nothing else goes) and the next run, or a forced one,
   reads it again:
   ```sql
   delete from public.landslide_warnings where parse_ok = false;
   ```
   To re-read a warning that was stored with unmatched names after adding an alias, delete that
   warning's row (its areas go with it): `delete from public.landslide_warnings where message_id = 'LEWM-...';`.
   To re-read a PDF that was skipped as not a warning: `delete from public.landslide_seen_pdfs where pdf_url = '...';`.
   Then `Invoke-RestMethod -Method Post -Uri "${url}?force=true" -Headers @{ 'x-landslide-secret' = $secret }`.

A name that can't be matched (the "Names that could not be matched" query) is not a failed warning: the
warning is stored and its other names work. Add the spelling to `ALIASES` and re-read that warning as
in step 5.

## Limits to keep in mind

- About 1,460 function runs a month, against the free plan's 500,000. DMC is asked for the list every
  30 minutes (about 50 requests a day, besides the hourly one from `news-refresh`) and for a PDF only
  when a new one is listed (1 to 3 a day, 0.5 to 1 MB each).
- The tables hold two weeks: a few dozen warnings of a few dozen rows each, far under 1 MB.
- Supabase's outgoing IP addresses are shared with other projects, so DMC may block or limit the
  function for reasons that have nothing to do with this app (a 403 means once a day, and nothing tries
  to get round it).
- The Edge Function never runs in tests. Tests use stand-ins for DMC, the PDF reader and the database
  (`src/lib/landslideRefresh.test.ts`), the real warnings' text (`src/lib/fixtures/lewm/`), and read the
  SQL as text (`src/lib/migrations.test.ts`). **The SQL has not been run by a database yet**: the first
  run of `0011_landslide_areas.sql` and `0011_check.sql` is the real test of the SQL's behaviour, like
  0009 and 0010.
