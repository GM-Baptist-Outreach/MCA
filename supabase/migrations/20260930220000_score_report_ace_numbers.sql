-- Store score_reports.pace_number as MCA internal numbering.
-- Parents type the ACE number printed on the book (1037). That is 37 internally.
-- A missing prescription is rejected so a free-typed PACE cannot create a second star.

create or replace function public.normalize_score_report_pace()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.pace_number is not null and new.pace_number > 1000 then
    new.pace_number := new.pace_number - 1000;
  end if;

  if tg_op = 'INSERT' then
    if not exists (
      select 1
      from public.student_pace_slots slot
      where slot.student_id = new.student_id
        and slot.subject_id = new.subject_id
        and slot.pace_number = new.pace_number
    ) then
      raise exception 'This PACE is not prescribed. Contact MCA.'
        using errcode = '23514';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists score_reports_normalize_pace_number on public.score_reports;
create trigger score_reports_normalize_pace_number
  before insert or update of pace_number
  on public.score_reports
  for each row
  execute function public.normalize_score_report_pace();

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

-- Fix the rows parents saved as ACE numbers, then match them to the slots.
update public.score_reports
set pace_number = pace_number - 1000
where pace_number > 1000;

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

revoke all on function public.normalize_score_report_pace() from public, anon, authenticated;
