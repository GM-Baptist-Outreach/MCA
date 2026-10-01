-- Round 3 P3 (marker: MCA_R3_P3_START_DATE_SHIPS)
-- The school start date (student_school_calendars) now builds that year's ship
-- schedule. It never overwrites an admin-edited schedule:
--   * no schedule for (student, year)            -> create it, auto_from_calendar = true
--   * schedule exists, auto_from_calendar = true -> recompute dates
--   * schedule exists, auto_from_calendar = false -> leave alone (admin edited)
-- Lead time: 14 days before each 9-week quarter.
--   fixed_dates : Q1 = start-14, Q2 = start+49, Q3 = start+112, Q4 = start+175
--   every_8_weeks / annual : first ship = max(today, start-14)
-- If Q1 is already past and nothing has shipped this year, the first shipment
-- is due today (the next daily cron run picks it up).
-- Mode for a NEW schedule: the student's most recent previous-year mode, else
-- 'annual' when the enrollment pays annually (A5 default), else 'fixed_dates'.

alter table public.student_ship_schedules
  add column if not exists auto_from_calendar boolean not null default false;

create or replace function public.mca_build_ship_schedule_from_calendar(
  p_student_id uuid,
  p_school_year text,
  p_force boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  lead_days constant int := 14;
  today date := (timezone('America/New_York', now()))::date;
  v_start date;
  v_sched record;
  v_found boolean;
  v_mode text;
  q1 date; q2 date; q3 date; q4 date;
  v_next date;
  v_last_shipped date;
begin
  select start_date into v_start
  from student_school_calendars
  where student_id = p_student_id and school_year = p_school_year;
  if v_start is null then
    return jsonb_build_object('skipped', 'no start date');
  end if;

  select * into v_sched
  from student_ship_schedules
  where student_id = p_student_id and school_year = p_school_year;
  v_found := FOUND;

  if v_found and not v_sched.auto_from_calendar and not p_force then
    return jsonb_build_object('skipped', 'schedule edited by admin', 'schedule_id', v_sched.id);
  end if;

  if v_found then
    v_mode := v_sched.mode;
  else
    select s.mode into v_mode
    from student_ship_schedules s
    where s.student_id = p_student_id and s.school_year < p_school_year
    order by s.school_year desc
    limit 1;
    if v_mode is null then
      select case when bool_or(e.frequency = 'annual') then 'annual' else 'fixed_dates' end
        into v_mode
      from enrollments e
      where e.student_id = p_student_id and e.status = 'active';
    end if;
    v_mode := coalesce(v_mode, 'fixed_dates');
  end if;

  q1 := v_start - lead_days;
  q2 := v_start + 63 - lead_days;
  q3 := v_start + 126 - lead_days;
  q4 := v_start + 189 - lead_days;

  select max(p.ship_date) into v_last_shipped
  from pick_lists p
  where p.student_id = p_student_id
    and p.school_year = p_school_year
    and p.status in ('ready', 'shipped');

  if v_last_shipped is null then
    v_next := greatest(today, q1);
  elsif v_mode = 'annual' then
    v_next := null;
  elsif v_mode = 'every_8_weeks' then
    v_next := greatest(today, v_last_shipped + 56);
  else
    select min(d) into v_next
    from (values (q2), (q3), (q4)) v(d)
    where d > v_last_shipped and d >= today;
  end if;

  if v_found then
    update student_ship_schedules
    set q1_ship_date = q1,
        q2_ship_date = q2,
        q3_ship_date = q3,
        q4_ship_date = q4,
        anchor_ship_date = q1,
        next_ship_date = v_next,
        auto_from_calendar = true,
        updated_at = now()
    where id = v_sched.id;
  else
    insert into student_ship_schedules (
      student_id, school_year, mode, q1_ship_date, q2_ship_date, q3_ship_date,
      q4_ship_date, anchor_ship_date, next_ship_date, auto_from_calendar
    ) values (
      p_student_id, p_school_year, v_mode, q1, q2, q3, q4, q1, v_next, true
    );
  end if;

  return jsonb_build_object(
    'mode', v_mode, 'next_ship_date', v_next,
    'q1', q1, 'q2', q2, 'q3', q3, 'q4', q4, 'created', not v_found
  );
end;
$$;

revoke all on function public.mca_build_ship_schedule_from_calendar(uuid, text, boolean) from public, anon, authenticated;
grant execute on function public.mca_build_ship_schedule_from_calendar(uuid, text, boolean) to service_role;

-- Admin button "Rebuild from start date"
create or replace function public.mca_rebuild_ship_schedule_from_calendar(
  p_student_id uuid,
  p_school_year text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not coalesce(public.is_admin(), false) then
    raise exception 'Admin only' using errcode = '42501';
  end if;
  return public.mca_build_ship_schedule_from_calendar(p_student_id, p_school_year, true);
end;
$$;

revoke all on function public.mca_rebuild_ship_schedule_from_calendar(uuid, text) from public, anon;
grant execute on function public.mca_rebuild_ship_schedule_from_calendar(uuid, text) to authenticated;

create or replace function public.student_school_calendars_build_schedule()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.mca_build_ship_schedule_from_calendar(new.student_id, new.school_year, false);
  return new;
end;
$$;

revoke all on function public.student_school_calendars_build_schedule() from public, anon, authenticated;

drop trigger if exists student_school_calendars_build_schedule on public.student_school_calendars;
create trigger student_school_calendars_build_schedule
  after insert or update of start_date on public.student_school_calendars
  for each row execute function public.student_school_calendars_build_schedule();

-- Parent start dates must fall Jul 1 - Dec 31 of the school year's first year.
create or replace function public.guard_school_calendar_parent_date()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  first_year int;
begin
  if current_user not in ('anon', 'authenticated') or coalesce(public.is_admin(), false) then
    return new;
  end if;
  first_year := nullif(substring(new.school_year from '^(\d{4})'), '')::int;
  if first_year is null
     or new.start_date < make_date(first_year, 7, 1)
     or new.start_date > make_date(first_year, 12, 31) then
    raise exception 'Pick a start date between July 1 and December 31, %.', first_year
      using errcode = '22023';
  end if;
  return new;
end;
$$;

drop trigger if exists student_school_calendars_guard_parent_date on public.student_school_calendars;
create trigger student_school_calendars_guard_parent_date
  before insert on public.student_school_calendars
  for each row execute function public.guard_school_calendar_parent_date();
