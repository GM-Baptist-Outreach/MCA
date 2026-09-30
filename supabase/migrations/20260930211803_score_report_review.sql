-- Admin review of uploaded tests. Rejecting a score puts that PACE back to issued.

alter table public.score_reports
  add column if not exists review_status text not null default 'pending',
  add column if not exists reviewed_by uuid,
  add column if not exists reviewed_at timestamptz,
  add column if not exists admin_note text;

alter table public.score_reports
  drop constraint if exists score_reports_review_status_check;

alter table public.score_reports
  add constraint score_reports_review_status_check
  check (review_status in ('pending', 'approved', 'rejected'));

create or replace function public.sync_pace_slot_from_score_report()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  numeric_score numeric;
  next_status text;
  internal_pace integer;
begin
  if new.review_status = 'rejected' then
    return new;
  end if;
  if new.score is null or btrim(new.score) = '' then
    return new;
  end if;
  begin
    numeric_score := btrim(new.score)::numeric;
  exception when others then
    return new;
  end;
  next_status := case when numeric_score >= 80 then 'passed' else 'failed' end;
  internal_pace := case
    when new.pace_number > 1000 then new.pace_number - 1000
    else new.pace_number
  end;

  update public.student_pace_slots
  set
    score = numeric_score,
    status = next_status,
    completed_at = coalesce(completed_at, new.reported_at::date),
    score_report_id = new.id,
    updated_at = now()
  where student_id = new.student_id
    and subject_id = new.subject_id
    and pace_number = internal_pace;

  return new;
end;
$$;

drop trigger if exists score_reports_sync_pace_slot on public.score_reports;
create trigger score_reports_sync_pace_slot
  after insert or update of score, reported_at, pace_number
  on public.score_reports
  for each row
  execute function public.sync_pace_slot_from_score_report();

create or replace function public.revert_slot_when_score_rejected()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.review_status = 'rejected' and old.review_status is distinct from 'rejected' then
    update public.student_pace_slots
    set
      status = 'issued',
      score = null,
      completed_at = null,
      score_report_id = null,
      updated_at = now()
    where student_id = new.student_id
      and subject_id = new.subject_id
      and pace_number = new.pace_number
      and status in ('passed', 'failed');
  end if;
  return new;
end;
$$;

drop trigger if exists score_reports_revert_rejected_slot on public.score_reports;
create trigger score_reports_revert_rejected_slot
  after update of review_status
  on public.score_reports
  for each row
  execute function public.revert_slot_when_score_rejected();

revoke all on function public.revert_slot_when_score_rejected() from public, anon, authenticated;
