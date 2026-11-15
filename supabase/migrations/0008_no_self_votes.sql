-- No voting on your own report: a vote is refused when the voter is the person who made the report.
-- Before this, someone could vote "still there" on their own report to keep it alive for another
-- 6 hours, or add one of the three "gone" votes that clear a report.
--
-- Replaces the vote trigger function apply_vote() from 0001. It now starts by checking who is
-- voting, and refuses with the error word 'own_report' (the same style as report_not_active and
-- the other words in 0005 and 0006, which the app reads and turns into a friendly message).
--
-- Why in apply_vote and not in the insert policy:
--   * A policy that fails only says "violates row-level security policy". The app already reads
--     that message as "this report is no longer active" (submitVote), so it could not tell the two
--     apart, and there is no way to put a word of our own in it.
--   * apply_vote already runs for every vote, as security definer, so it can read the report's
--     creator whatever the caller's rights are. An exception there rolls back the vote's insert,
--     so nothing is stored.
--   * The policy keeps doing what it did: "vote as yourself, on a report that is still active".
--     An own report that has ended is still refused by the policy first, as "no longer active".
--
-- Votes already cast on own reports are NOT changed or removed by this. To see how many there are,
-- run this first (it only reads):
--
--   select count(*)                                     as self_votes,
--          count(*) filter (where v.vote = 'still_there') as still_there,
--          count(*) filter (where v.vote = 'gone')        as gone,
--          count(distinct v.report_id)                    as reports_affected
--     from public.report_votes v
--     join public.reports r on r.id = v.report_id
--    where v.user_id = r.created_by;
--
-- Builds on 0001 (the table report_votes, the trigger report_votes_apply and apply_vote()).
-- Run by hand in the SQL Editor. Everything is in one
-- transaction, so it either all applies or none of it does.

begin;


-- create or replace keeps the trigger report_votes_apply pointing at this function, and keeps
-- who may run it (nobody directly: it only runs as the trigger).
create or replace function public.apply_vote()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- The report's creator may not vote on it. This runs before anything on the report is changed,
  -- and the exception cancels the insert of the vote as well.
  if exists (
    select 1
      from public.reports r
     where r.id = new.report_id
       and r.created_by = new.user_id
  ) then
    raise exception 'own_report' using errcode = 'P0001';
  end if;

  if new.vote = 'still_there' then
    update public.reports
       set expires_at = now() + interval '6 hours'
     where id = new.report_id and status = 'active';

  elsif (select count(*) from public.report_votes
          where report_id = new.report_id and vote = 'gone') >= 3 then
    update public.reports
       set status = 'cleared'
     where id = new.report_id;
  end if;

  return null;
end;
$$;

revoke all on function public.apply_vote() from public, anon, authenticated;


commit;
