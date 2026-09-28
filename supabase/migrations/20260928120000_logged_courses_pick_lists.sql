-- Logged courses, quarter ship schedules, and pick lists.
-- Idempotent: these tables already exist on project proiyioqfbjcmprsnqhf.
-- ACE remains the official grade source. These rows are MCA's ops/transfer layer.
-- Tuition checkout never writes here and never adds shipping or sales tax.

create table if not exists public.required_pace_plans (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.students(id),
  subject_id uuid not null references public.subjects(id),
  school_year text not null,
  required_count integer not null default 12,
  created_at timestamptz not null default now(),
  unique (student_id, subject_id, school_year)
);

create table if not exists public.student_pace_slots (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.students(id) on delete cascade,
  subject_id uuid not null references public.subjects(id),
  school_year text not null,
  slot_index smallint not null check (slot_index >= 1 and slot_index <= 12),
  pace_number integer not null,
  item_id uuid references public.items(id),
  status text not null default 'prescribed' check (
    status = any (array[
      'prescribed', 'ordered', 'in_stock', 'issued', 'passed', 'failed', 'paused'
    ])
  ),
  score numeric,
  issued_at date,
  completed_at date,
  score_report_id uuid references public.score_reports(id),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (student_id, subject_id, school_year, slot_index)
);

create index if not exists student_pace_slots_student_idx
  on public.student_pace_slots (student_id, school_year);
create index if not exists student_pace_slots_status_idx
  on public.student_pace_slots (status);

create table if not exists public.student_ship_schedules (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.students(id) on delete cascade,
  school_year text not null,
  mode text not null check (mode = any (array['fixed_dates', 'every_8_weeks'])),
  q1_ship_date date,
  q2_ship_date date,
  q3_ship_date date,
  q4_ship_date date,
  anchor_ship_date date,
  next_ship_date date,
  shipment_paused boolean not null default false,
  pause_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (student_id, school_year)
);

create table if not exists public.pick_lists (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.students(id) on delete cascade,
  school_year text not null,
  ship_date date not null,
  status text not null default 'draft' check (
    status = any (array['draft', 'ready', 'paused', 'shipped', 'cancelled'])
  ),
  paused_for_missing_scores boolean not null default false,
  reminder_email_sent_at timestamptz,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists pick_lists_ship_date_idx
  on public.pick_lists (ship_date, status);

create unique index if not exists pick_lists_student_year_ship_key
  on public.pick_lists (student_id, school_year, ship_date);

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'pick_lists_student_year_ship_key'
  ) then
    alter table public.pick_lists
      add constraint pick_lists_student_year_ship_key
      unique using index pick_lists_student_year_ship_key;
  end if;
end $$;

create table if not exists public.pick_list_items (
  id uuid primary key default gen_random_uuid(),
  pick_list_id uuid not null references public.pick_lists(id) on delete cascade,
  pace_slot_id uuid references public.student_pace_slots(id) on delete set null,
  subject_id uuid references public.subjects(id),
  pace_number integer not null,
  item_id uuid references public.items(id),
  quantity_needed integer not null default 1,
  quantity_on_hand integer,
  created_at timestamptz not null default now()
);

alter table public.required_pace_plans enable row level security;
alter table public.student_pace_slots enable row level security;
alter table public.student_ship_schedules enable row level security;
alter table public.pick_lists enable row level security;
alter table public.pick_list_items enable row level security;

grant select, insert, update, delete on public.required_pace_plans to authenticated;
grant select, insert, update, delete on public.student_pace_slots to authenticated;
grant select, insert, update, delete on public.student_ship_schedules to authenticated;
grant select, insert, update, delete on public.pick_lists to authenticated;
grant select, insert, update, delete on public.pick_list_items to authenticated;
grant all on public.required_pace_plans to service_role;
grant all on public.student_pace_slots to service_role;
grant all on public.student_ship_schedules to service_role;
grant all on public.pick_lists to service_role;
grant all on public.pick_list_items to service_role;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'required_pace_plans' and policyname = 'admin_full_access'
  ) then
    create policy admin_full_access on public.required_pace_plans
      for all to authenticated using (is_admin()) with check (is_admin());
  end if;
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'required_pace_plans' and policyname = 'parent_select_own_pace_plans'
  ) then
    create policy parent_select_own_pace_plans on public.required_pace_plans
      for select to authenticated using (
        student_id in (
          select s.id from public.students s
          join public.families f on f.id = s.family_id
          where f.auth_user_id = auth.uid()
        )
      );
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'student_pace_slots' and policyname = 'admins manage pace slots'
  ) then
    create policy "admins manage pace slots" on public.student_pace_slots
      for all to authenticated using (is_admin()) with check (is_admin());
  end if;
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'student_pace_slots' and policyname = 'parents read own pace slots'
  ) then
    create policy "parents read own pace slots" on public.student_pace_slots
      for select to authenticated using (
        exists (
          select 1 from public.students s
          join public.families f on f.id = s.family_id
          where s.id = student_pace_slots.student_id and f.auth_user_id = auth.uid()
        )
      );
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'student_ship_schedules' and policyname = 'admins manage ship schedules'
  ) then
    create policy "admins manage ship schedules" on public.student_ship_schedules
      for all to authenticated using (is_admin()) with check (is_admin());
  end if;
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'student_ship_schedules' and policyname = 'parents read own ship schedules'
  ) then
    create policy "parents read own ship schedules" on public.student_ship_schedules
      for select to authenticated using (
        exists (
          select 1 from public.students s
          join public.families f on f.id = s.family_id
          where s.id = student_ship_schedules.student_id and f.auth_user_id = auth.uid()
        )
      );
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'pick_lists' and policyname = 'admins manage pick lists'
  ) then
    create policy "admins manage pick lists" on public.pick_lists
      for all to authenticated using (is_admin()) with check (is_admin());
  end if;
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'pick_list_items' and policyname = 'admins manage pick list items'
  ) then
    create policy "admins manage pick list items" on public.pick_list_items
      for all to authenticated using (is_admin()) with check (is_admin());
  end if;

  -- Goal cards (and other portal forms) update an existing row for the same week.
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'form_submissions' and policyname = 'parent_update_own_form_submissions'
  ) then
    create policy parent_update_own_form_submissions on public.form_submissions
      for update to authenticated
      using (
        family_id in (select id from public.families where auth_user_id = auth.uid())
      )
      with check (
        family_id in (select id from public.families where auth_user_id = auth.uid())
      );
  end if;
end $$;

comment on table public.student_pace_slots is
  'Per student+subject school-year grid of up to 12 PACEs. Ops/transfer layer only; ACE gradebook is authoritative.';
comment on table public.student_ship_schedules is
  'Quarter autoship schedule. 2025-26 fixed dates are 2025-10-26, 2026-01-11, 2026-03-08. Q4 is staff-entered.';
comment on table public.pick_lists is
  'Generated one week before next_ship_date: next 3 unissued PACEs per logged subject. Paused when the prior 6 issued PACEs lack scores.';
