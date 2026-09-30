-- Parent-chosen school start date. Four quarters of 9 weeks.
-- A parent may insert the row once. Only an admin can change it.

create table if not exists public.student_school_calendars (
  student_id uuid not null references public.students(id) on delete cascade,
  school_year text not null,
  start_date date not null,
  set_by uuid,
  set_at timestamptz not null default now(),
  updated_by uuid,
  updated_at timestamptz,
  primary key (student_id, school_year)
);

alter table public.student_school_calendars enable row level security;

grant select, insert, update on public.student_school_calendars to authenticated;
grant all on public.student_school_calendars to service_role;

drop policy if exists admin_full_access on public.student_school_calendars;
create policy admin_full_access on public.student_school_calendars
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists parent_select_own_school_calendar on public.student_school_calendars;
create policy parent_select_own_school_calendar on public.student_school_calendars
  for select to authenticated
  using (
    exists (
      select 1 from public.students s
      join public.families f on f.id = s.family_id
      where s.id = student_school_calendars.student_id
        and f.auth_user_id = auth.uid()
    )
  );

drop policy if exists parent_insert_own_school_calendar on public.student_school_calendars;
create policy parent_insert_own_school_calendar on public.student_school_calendars
  for insert to authenticated
  with check (
    exists (
      select 1 from public.students s
      join public.families f on f.id = s.family_id
      where s.id = student_school_calendars.student_id
        and f.auth_user_id = auth.uid()
    )
    and not exists (
      select 1 from public.student_school_calendars existing
      where existing.student_id = student_school_calendars.student_id
        and existing.school_year = student_school_calendars.school_year
    )
  );

comment on table public.student_school_calendars is
  'Frozen school start date. Quarters are 9 weeks from start_date. Parents insert once; admins may update.';
