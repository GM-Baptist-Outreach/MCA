-- Keep student_pace_slots in step with the tables that already exist.
-- pace_status is the ops status (ordered / in stock / issued).
-- score_reports is the parent score transfer.
-- student_ship_schedules is the ship schedule. A second ship_schedules
-- table is not created.
-- Triggers are security definer so a parent write to pace_status or
-- score_reports can update a slot the parent is not allowed to write directly.
-- Passed and failed slots are not downgraded by a later pace_status row.

create or replace function public.sync_pace_slot_from_score_report()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  numeric_score numeric;
  next_status text;
begin
  if new.score is null or btrim(new.score) = '' then
    return new;
  end if;
  begin
    numeric_score := btrim(new.score)::numeric;
  exception when others then
    return new;
  end;
  next_status := case when numeric_score >= 80 then 'passed' else 'failed' end;

  update public.student_pace_slots
  set
    score = numeric_score,
    status = next_status,
    completed_at = coalesce(completed_at, new.reported_at::date),
    score_report_id = new.id,
    updated_at = now()
  where student_id = new.student_id
    and subject_id = new.subject_id
    and pace_number = new.pace_number;

  return new;
end;
$$;

create or replace function public.sync_pace_slot_from_pace_status()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status not in ('ordered', 'in_stock', 'issued') then
    return new;
  end if;

  update public.student_pace_slots
  set
    status = new.status,
    issued_at = case
      when new.status = 'issued' then coalesce(issued_at, new.status_date)
      else issued_at
    end,
    updated_at = now()
  where student_id = new.student_id
    and item_id = new.item_id
    and status not in ('passed', 'failed');

  return new;
end;
$$;

drop trigger if exists score_reports_sync_pace_slot on public.score_reports;
create trigger score_reports_sync_pace_slot
  after insert or update of score, reported_at
  on public.score_reports
  for each row
  execute function public.sync_pace_slot_from_score_report();

drop trigger if exists pace_status_sync_pace_slot on public.pace_status;
create trigger pace_status_sync_pace_slot
  after insert or update of status, status_date
  on public.pace_status
  for each row
  execute function public.sync_pace_slot_from_pace_status();

revoke all on function public.sync_pace_slot_from_score_report() from public, anon, authenticated;
revoke all on function public.sync_pace_slot_from_pace_status() from public, anon, authenticated;

-- Backfill slots that were prescribed before these triggers existed.
update public.student_pace_slots as slot
set
  score = report.score::numeric,
  status = case when report.score::numeric >= 80 then 'passed' else 'failed' end,
  completed_at = coalesce(slot.completed_at, report.reported_at::date),
  score_report_id = report.id,
  updated_at = now()
from (
  select distinct on (student_id, subject_id, pace_number)
    id, student_id, subject_id, pace_number, score, reported_at
  from public.score_reports
  where score is not null
    and btrim(score) ~ '^[0-9]+(\.[0-9]+)?$'
  order by student_id, subject_id, pace_number, reported_at desc
) as report
where slot.student_id = report.student_id
  and slot.subject_id = report.subject_id
  and slot.pace_number = report.pace_number;

update public.student_pace_slots as slot
set
  status = pace.status,
  issued_at = case
    when pace.status = 'issued' then coalesce(slot.issued_at, pace.status_date)
    else slot.issued_at
  end,
  updated_at = now()
from public.pace_status as pace
where slot.student_id = pace.student_id
  and slot.item_id = pace.item_id
  and slot.status not in ('passed', 'failed')
  and pace.status in ('ordered', 'in_stock', 'issued');

comment on table public.student_ship_schedules is
  'Ship schedule for logged courses (fixed quarter dates or every 8 weeks). This is the ship schedule; no parallel ship_schedules table. 2025-26: Q1 is the initial 3 PACEs at enrollment. Q2 2025-10-26, Q3 2026-01-11, Q4 2026-03-08.';
