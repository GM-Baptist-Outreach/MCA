-- Round 3 A2 (marker: MCA_R3_A2_TRANSFER_CREDITS)
-- Per-student graduation requirements (override the shared template when a
-- student has >= 1 row) and transfer-credit columns on course_completions.
-- Additive only. The shared graduation_requirements template is unchanged.

create table if not exists public.student_graduation_requirements (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.students(id) on delete cascade,
  subject_name text not null,
  credit_required numeric(4,2) not null default 1.00 check (credit_required >= 0),
  sort_order integer not null default 0,
  notes text,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists student_graduation_requirements_student_idx
  on public.student_graduation_requirements (student_id, sort_order);

alter table public.student_graduation_requirements enable row level security;

drop policy if exists admin_full_access on public.student_graduation_requirements;
create policy admin_full_access on public.student_graduation_requirements
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists parent_select_own_graduation_requirements on public.student_graduation_requirements;
create policy parent_select_own_graduation_requirements on public.student_graduation_requirements
  for select to authenticated
  using (student_id in (
    select s.id from public.students s
    join public.families f on f.id = s.family_id
    where f.auth_user_id = (select auth.uid())
  ));

alter table public.course_completions
  add column if not exists is_transfer boolean not null default false,
  add column if not exists transfer_school text,
  add column if not exists transfer_school_location text,
  add column if not exists grade_level smallint,
  add column if not exists fulfills_requirement text,
  add column if not exists notes text;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'course_completions_grade_level_check'
  ) then
    alter table public.course_completions
      add constraint course_completions_grade_level_check
      check (grade_level is null or grade_level between 9 and 12);
  end if;
end $$;

comment on column public.course_completions.is_transfer is
  'Transfer credit from another school. Counts toward credits; never toward the MCA GPA.';
