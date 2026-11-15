# Privacy check from the outside: does the public API refuse to show who made a report?
# Uses only the project URL and the publishable (anon) key from .env. It never prints the key,
# and it only reads (the optional signed-in part also creates one throwaway anonymous user).
#
# Run from the project folder:
#   powershell -ExecutionPolicy Bypass -File supabase\checks\privacy.ps1
#   powershell -ExecutionPolicy Bypass -File supabase\checks\privacy.ps1 -IncludeSignedIn
#
# Every line should say PASS. Run it after 0009, and again after 0010.

param([switch]$IncludeSignedIn)

$envFile = Join-Path (Get-Location) '.env'
if (-not (Test-Path $envFile)) { Write-Host 'No .env in this folder. Run it from the project folder.'; exit 1 }

function Get-EnvValue($name) {
  $line = Get-Content $envFile | Where-Object { $_ -like "$name=*" } | Select-Object -First 1
  if (-not $line) { return $null }
  return ($line -split '=', 2)[1].Trim().Trim('"')
}

$base = (Get-EnvValue 'VITE_SUPABASE_URL').TrimEnd('/')
$key = Get-EnvValue 'VITE_SUPABASE_PUBLISHABLE_KEY'
if (-not $base -or -not $key) { Write-Host 'VITE_SUPABASE_URL or VITE_SUPABASE_PUBLISHABLE_KEY is missing in .env'; exit 1 }

$script:fails = 0

# Returns @{ Status; Body } and never throws
function Send($method, $path, $headers, $body) {
  try {
    $request = @{ Uri = "$base$path"; Method = $method; Headers = $headers; UseBasicParsing = $true }
    if ($body) { $request.Body = $body; $request.ContentType = 'application/json' }
    $r = Invoke-WebRequest @request
    return @{ Status = [int]$r.StatusCode; Body = $r.Content }
  } catch {
    $status = 0
    if ($_.Exception.Response) { $status = [int]$_.Exception.Response.StatusCode }
    return @{ Status = $status; Body = [string]$_.ErrorDetails.Message }
  }
}

function Check($label, $ok, $detail) {
  if ($ok) { Write-Host ("PASS  " + $label) } else { Write-Host ("FAIL  " + $label + "  (" + $detail + ")"); $script:fails++ }
}

# A refused read is a 401 or 403 with PostgREST's permission-denied code (42501)
function Is-Refused($r) { return (($r.Status -eq 401 -or $r.Status -eq 403) -and $r.Body -like '*42501*') }

function Run-Reads($who, $headers) {
  $ok = Send 'GET' '/rest/v1/reports?select=id,hazard_type,severity&limit=1' $headers $null
  Check "$who`: reading id, hazard_type, severity works" ($ok.Status -eq 200) "status $($ok.Status)"

  $c = Send 'GET' '/rest/v1/reports?select=created_by&limit=1' $headers $null
  Check "$who`: select=created_by is refused" (Is-Refused $c) "status $($c.Status), body: $($c.Body)"

  $a = Send 'GET' '/rest/v1/reports?select=*&limit=1' $headers $null
  Check "$who`: select=* is refused" (Is-Refused $a) "status $($a.Status), body: $($a.Body)"

  $f = Send 'GET' '/rest/v1/reports?select=id&created_by=eq.00000000-0000-0000-0000-000000000000' $headers $null
  Check "$who`: filtering on created_by is refused" (Is-Refused $f) "status $($f.Status), body: $($f.Body)"

  $o = Send 'GET' '/rest/v1/reports?select=id&order=created_by&limit=1' $headers $null
  Check "$who`: ordering by created_by is refused" (Is-Refused $o) "status $($o.Status), body: $($o.Body)"

  # The function the route check uses must still work
  $route = '{"route":{"type":"LineString","coordinates":[[79.86,6.93],[80.63,7.29]]}}'
  $r = Send 'POST' '/rest/v1/rpc/reports_along_route' $headers $route
  Check "$who`: reports_along_route works" ($r.Status -eq 200) "status $($r.Status), body: $($r.Body)"
  if ($r.Status -eq 200) {
    Check "$who`: reports_along_route returns no created_by" ($r.Body -notlike '*created_by*') 'the answer mentions created_by'
  }

  $v = Send 'POST' '/rest/v1/rpc/reports_in_view' $headers '{"min_lng":79.4,"min_lat":5.7,"max_lng":82.1,"max_lat":10.0}'
  Check "$who`: reports_in_view works and has no created_by" ($v.Status -eq 200 -and $v.Body -notlike '*created_by*') "status $($v.Status)"

  # Photos: the bucket can't be listed. An empty list or an error are both fine; names are not.
  $l = Send 'POST' '/storage/v1/object/list/report-photos' $headers '{"prefix":"","limit":5}'
  $names = $l.Body -match '"name"\s*:'
  Check "$who`: the photo bucket cannot be listed" (-not $names) "the answer lists file names"
}

$anon = @{ apikey = $key }
Write-Host '--- signed out (publishable key only) ---'
Run-Reads 'anon' $anon

if ($IncludeSignedIn) {
  Write-Host '--- signed in as a new anonymous user ---'
  $s = Send 'POST' '/auth/v1/signup' $anon '{}'
  if ($s.Status -ne 200) {
    Write-Host "Could not sign in anonymously (status $($s.Status)). Skipping this part."
  } else {
    $token = ($s.Body | ConvertFrom-Json).access_token
    $auth = @{ apikey = $key; Authorization = "Bearer $token" }
    Run-Reads 'signed in' $auth

    $vt = Send 'GET' '/rest/v1/report_votes?select=user_id&limit=5' $auth $null
    Check 'signed in: report_votes shows only your own rows (none for a new user)' ($vt.Status -eq 200 -and $vt.Body.Trim() -eq '[]') "status $($vt.Status), body: $($vt.Body)"
  }
}

Write-Host ''
if ($script:fails -eq 0) { Write-Host 'All checks passed.' } else { Write-Host "$($script:fails) check(s) FAILED."; exit 1 }
