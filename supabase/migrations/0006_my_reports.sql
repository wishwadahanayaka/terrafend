-- "My reports": people can see, edit and clear the reports their own browser sent.
-- There are no accounts. "Mine" means created_by = auth.uid(), the anonymous user the
-- browser signed in as, so it only works on the browser that sent them.
--
-- Adds:
--   1. report_edits, a log with one row per edit (not reachable from the app), for the
--      limit of 10 edits an hour
--   2. my_reports(): the caller's own reports from the last 7 days, active or not
--   3. clear_my_report(p_id): takes one of the caller's reports off the map
--   4. edit_my_report(p_id, p_severity, p_note): changes the severity and note of an
--      active report of the caller's
--
-- Builds on 0005: edit_my_report sets reports.severity_updated_at, which 0005 adds. Run 0005
-- first. Not run yet. Run it by hand in the SQL Editor after checking it. Everything is in
-- one transaction, so it either all applies or none of it does.

begin;


-- 1. One row per edit, only used to count them. RLS is on and there are no grants and no
-- policies on purpose: the Data API cannot read or write this table at all. The functions
-- below run as the table owner and can.
create table public.report_edits (
  id         uuid primary key default gen_random_uuid(),
  report_id  uuid not null references public.reports (id) on delete cascade,
  user_id    uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table public.report_edits enable row level security;
revoke all on public.report_edits from public, anon, authenticated;

create index report_edits_user_idx on public.report_edits (user_id, created_at);
-- Keeps cleanup deletes fast: removing a report cascades to its edits, and this finds them.
create index report_edits_report_idx on public.report_edits (report_id);


-- 2. The caller's own reports, newest first, with how many people said "still there".
--
-- The read policy on reports only shows active, unexpired reports, so a normal query would
-- hide the caller's own expired and cleared ones. That is why this is security definer: it
-- runs with its owner's rights, and the only thing that limits what it returns is the
-- created_by = auth.uid() filter below. The empty search_path is the usual safety habit for
-- security definer functions, so every name is written out in full.
--
-- "Last 7 days" counts from when the report was made. At most 100 are returned.
-- With no signed-in user auth.uid() is null, nothing matches, and the answer is empty.
create function public.my_reports()
returns table (
  id            uuid,
  hazard_type   text,
  severity      text,
  note          text,
  lat           double precision,
  lng           double precision,
  photo_path    text,
  created_at    timestamptz,
  expires_at    timestamptz,
  status        text,
  confirmations integer
)
language sql
stable
security definer
set search_path = ''
as $$
  select r.id, r.hazard_type, r.severity, r.note,
         extensions.st_y(r.location::extensions.geometry),
         extensions.st_x(r.location::extensions.geometry),
         r.photo_path, r.created_at, r.expires_at, r.status,
         (select count(*)::integer
            from public.report_votes v
           where v.report_id = r.id and v.vote = 'still_there')
    from public.reports r
   where r.created_by = auth.uid()
     and r.created_at > now() - interval '7 days'
   order by r.created_at desc
   limit 100;
$$;

revoke all on function public.my_reports() from public, anon;
grant execute on function public.my_reports() to authenticated;


-- 3. Take one of the caller's reports off the map. The row is not deleted: expires_at is set
-- to now, so the read policy hides it at once, nobody can vote on it any more, and the hourly
-- cleanup job removes its photo and, later, the row itself, like any other expired report.
-- Nothing else on the report changes.
--
-- Errors (the message is a word the app reads):
--   not_signed_in      no signed-in user
--   report_not_active  the report is not the caller's, does not exist, or has already ended.
--                      These are one answer on purpose, so it can't be used to find out
--                      whether someone else's report id exists.
create function public.clear_my_report(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := auth.uid();
begin
  if caller is null then
    raise exception 'not_signed_in' using errcode = '28000';
  end if;

  update public.reports r
     set expires_at = now()
   where r.id = p_id
     and r.created_by = caller
     and r.status = 'active'
     and r.expires_at > now();

  if not found then
    raise exception 'report_not_active' using errcode = 'P0001';
  end if;
end;
$$;

revoke all on function public.clear_my_report(uuid) from public, anon;
grant execute on function public.clear_my_report(uuid) to authenticated;


-- 4. Change the severity and note of an active report of the caller's. Only those two columns
-- (and severity_updated_at, when the severity really changed, so the card can say it was
-- updated) are written. created_by, location, hazard_type, photo_path, created_at, expires_at
-- and status are never touched.
--
-- The note is trimmed, and a blank note becomes null, the same as when a report is sent. It
-- can be at most 280 characters, the same limit the table has. Passing the severity and note
-- the report already has does nothing and is not counted.
--
-- Errors (the message is a word the app reads):
--   not_signed_in      no signed-in user
--   report_not_active  not the caller's, missing, expired or cleared (one answer, as above)
--   too_many_edits     10 edits in the last hour, the same limit as sending reports
--   note_too_long      more than 280 characters
-- A severity that isn't one of the three values is refused with error code 22023.
create function public.edit_my_report(p_id uuid, p_severity text, p_note text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller           uuid := auth.uid();
  new_note         text := nullif(btrim(p_note), '');
  current_severity text;
  current_note     text;
begin
  if caller is null then
    raise exception 'not_signed_in' using errcode = '28000';
  end if;
  if p_severity is null or p_severity not in ('passable', 'large_vehicles_only', 'blocked') then
    raise exception 'p_severity must be passable, large_vehicles_only or blocked' using errcode = '22023';
  end if;
  if char_length(new_note) > 280 then
    raise exception 'note_too_long' using errcode = '22023';
  end if;

  -- Locks the row, so two edits at the same moment take turns
  select r.severity, r.note into current_severity, current_note
    from public.reports r
   where r.id = p_id
     and r.created_by = caller
     and r.status = 'active'
     and r.expires_at > now()
     for update;

  if not found then
    raise exception 'report_not_active' using errcode = 'P0001';
  end if;

  if current_severity = p_severity and current_note is not distinct from new_note then
    return;
  end if;

  if (select count(*) from public.report_edits e
       where e.user_id = caller and e.created_at > now() - interval '1 hour') >= 10 then
    raise exception 'too_many_edits' using errcode = 'P0001';
  end if;

  insert into public.report_edits (report_id, user_id) values (p_id, caller);

  update public.reports r
     set severity = p_severity,
         note = new_note,
         severity_updated_at = case
           when r.severity is distinct from p_severity then now()
           else r.severity_updated_at
         end
   where r.id = p_id;
end;
$$;

revoke all on function public.edit_my_report(uuid, text, text) from public, anon;
grant execute on function public.edit_my_report(uuid, text, text) to authenticated;


commit;
