-- Parents insert their own score_reports. That policy checks the student,
-- not the review columns, so a parent could mark an upload approved.
-- Admins use the same authenticated role, so column grants cannot tell
-- them apart. This trigger does.
--
-- A non-admin insert is always unreviewed. A non-admin update cannot
-- change the review columns (other columns, such as a score correction
-- the parent is not granted today, would keep the staff review as-is).

create or replace function public.guard_score_report_review_columns()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(public.is_admin(), false) then
    return new;
  end if;

  if tg_op = 'INSERT' then
    new.review_status := 'pending';
    new.reviewed_by := null;
    new.reviewed_at := null;
    new.admin_note := null;
    new.entered_into_ace := false;
    return new;
  end if;

  if new.review_status is distinct from old.review_status
    or new.reviewed_by is distinct from old.reviewed_by
    or new.reviewed_at is distinct from old.reviewed_at
    or new.admin_note is distinct from old.admin_note
    or new.entered_into_ace is distinct from old.entered_into_ace
  then
    raise exception 'Only MCA staff can change a test review.'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists score_reports_guard_review_columns on public.score_reports;
create trigger score_reports_guard_review_columns
  before insert or update
  on public.score_reports
  for each row
  execute function public.guard_score_report_review_columns();

revoke all on function public.guard_score_report_review_columns() from public, anon, authenticated;

comment on function public.guard_score_report_review_columns() is
  'Non-admins insert score reports as pending and cannot change review_status, reviewed_by, reviewed_at, admin_note, or entered_into_ace.';
