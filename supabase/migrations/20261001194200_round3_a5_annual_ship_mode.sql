-- Round 3 A5 (marker: MCA_R3_A5_ANNUAL_SHIP)
-- Allow ship mode 'annual'. The generator (SQL + edge function) already treats
-- 'annual' as: every unshipped PACE in one pick list, no score gate, no next date.
alter table public.student_ship_schedules
  drop constraint if exists student_ship_schedules_mode_check;
alter table public.student_ship_schedules
  add constraint student_ship_schedules_mode_check
  check (mode = any (array['fixed_dates'::text, 'every_8_weeks'::text, 'annual'::text]));
