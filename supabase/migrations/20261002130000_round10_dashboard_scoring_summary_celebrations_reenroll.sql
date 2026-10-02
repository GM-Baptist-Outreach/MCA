-- Round 10 (additive): parent dashboard, scoring from the photo viewer,
-- weekly summary email, celebrations, saved cards, and re-enrollment.
-- Marker: MCA_R10_MIGRATION
-- No table, column, or row is dropped. Two existing functions get a small,
-- behavior-preserving change (see 6 and 7), and the family_email_log kind
-- check gains one more allowed value.

-- 1) Settings. Weekly summary and celebration emails start ON (the summary
--    only goes to the staff recipient; celebration emails skip test
--    accounts). Re-enrollment starts CLOSED.
insert into public.app_settings (key, value) values
  ('weekly_summary_enabled', 'true'),
  ('weekly_summary_recipient', 'david@midwestchristianacademy.com'),
  ('email_celebration_enabled', 'true'),
  ('reenroll_open', 'false'),
  ('reenroll_window_start', ''),
  ('reenroll_window_end', ''),
  ('reenroll_school_year', '2027-28')
on conflict (key) do nothing;

create or replace function public.app_settings_validate()
returns trigger
language plpgsql
set search_path to 'public'
as $$
begin
  if new.key = 'payment_mode' and new.value not in ('test', 'live') then
    raise exception 'payment_mode must be test or live';
  end if;
  if new.key in ('email_shipping_enabled', 'email_overdue_nudge_enabled',
                 'weekly_summary_enabled', 'email_celebration_enabled', 'reenroll_open')
     and new.value not in ('true', 'false') then
    raise exception '% must be true or false', new.key;
  end if;
  if new.key = 'weekly_summary_recipient'
     and new.value !~ '^[^@\s,;]+@[^@\s,;]+\.[^@\s,;]+$' then
    raise exception 'Enter one email address for the weekly summary';
  end if;
  if new.key in ('reenroll_window_start', 'reenroll_window_end')
     and new.value <> '' and new.value !~ '^\d{4}-\d{2}-\d{2}$' then
    raise exception '% must be a date (YYYY-MM-DD) or blank', new.key;
  end if;
  if new.key = 'reenroll_school_year' and new.value !~ '^\d{4}-\d{2}$' then
    raise exception 'reenroll_school_year must look like 2027-28';
  end if;
  if tg_op = 'UPDATE' and old.key = 'family_emails_live_since' and new.value is distinct from old.value then
    raise exception 'family_emails_live_since cannot be changed';
  end if;
  new.updated_at := now();
  if auth.uid() is not null then
    new.updated_by := auth.uid();
  end if;
  return new;
end;
$$;

-- 2) Celebrations (level finished, school year finished).
create table if not exists public.student_celebrations (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.students(id) on delete cascade,
  kind text not null check (kind in ('level', 'school_year')),
  subject_id uuid references public.subjects(id) on delete set null,
  level integer,
  school_year text,
  title text not null,
  dedupe_key text not null unique,
  pace_slot_id uuid references public.student_pace_slots(id) on delete set null,
  created_at timestamptz not null default now(),
  seen_at timestamptz
);
create index if not exists student_celebrations_student_idx on public.student_celebrations (student_id, created_at desc);
alter table public.student_celebrations enable row level security;
drop policy if exists admin_full_access on public.student_celebrations;
create policy admin_full_access on public.student_celebrations
  for all to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists parent_select_own_celebrations on public.student_celebrations;
create policy parent_select_own_celebrations on public.student_celebrations
  for select to authenticated using (
    student_id in (
      select s.id from public.students s join public.families f on f.id = s.family_id
      where f.auth_user_id = (select auth.uid())
    )
  );

create or replace function public.mca_mark_celebration_seen(p_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  update student_celebrations c
     set seen_at = coalesce(c.seen_at, now())
   where c.id = p_id
     and (
       public.is_admin()
       or exists (
         select 1 from students s join families f on f.id = s.family_id
         where s.id = c.student_id and f.auth_user_id = auth.uid()
       )
     );
end;
$$;
revoke all on function public.mca_mark_celebration_seen(uuid) from public, anon;
grant execute on function public.mca_mark_celebration_seen(uuid) to authenticated;

alter table public.family_email_log
  add column if not exists celebration_id uuid references public.student_celebrations(id) on delete set null;
alter table public.family_email_log drop constraint if exists family_email_log_kind_check;
alter table public.family_email_log add constraint family_email_log_kind_check
  check (kind = any (array['shipment'::text, 'overdue_test'::text, 'celebration'::text]));

-- A level is finished when the student passes the last PACE of that level in
-- a subject (catalog items.grade_level). A school year is finished when every
-- PACE slot of that year (at least 6) is passed. The portal screen shows every
-- celebration; the EMAIL only goes out when the finishing score came through
-- Upload Tests / Test Reviews (score_report_id set), so staff back-filling old
-- scores on the PACE grid never emails a family.
create or replace function public.mca_detect_celebrations()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_level integer;
  v_last integer;
  v_levels integer;
  v_subject text;
  v_id uuid;
  v_new uuid[] := '{}';
  v_total integer;
  v_open integer;
  v_family uuid;
  v_email text;
  v_test boolean;
  v_enabled boolean;
  v_status text;
  v_detail text;
  v_pending boolean := false;
  v_cid uuid;
begin
  if new.status is distinct from 'passed' or old.status = 'passed' then
    return new;
  end if;

  select name into v_subject from subjects where id = new.subject_id;

  if new.item_id is not null then
    select i.grade_level into v_level from items i where i.id = new.item_id;
  end if;
  if v_level is null then
    select i.grade_level into v_level
      from items i
     where i.subject_id = new.subject_id and i.item_type = 'pace'
       and i.pace_number = new.pace_number and i.grade_level is not null
     limit 1;
  end if;
  if v_level is not null then
    select max(i.pace_number) into v_last
      from items i
     where i.subject_id = new.subject_id and i.item_type = 'pace'
       and i.active and i.grade_level = v_level;
    if v_last is not null and new.pace_number >= v_last then
      select count(distinct i.grade_level) into v_levels
        from items i
       where i.subject_id = new.subject_id and i.item_type = 'pace'
         and i.active and i.grade_level is not null;
      v_id := null;
      insert into student_celebrations (student_id, kind, subject_id, level, school_year, title, dedupe_key, pace_slot_id)
      values (
        new.student_id, 'level', new.subject_id, v_level, new.school_year,
        case when coalesce(v_levels, 1) > 1
             then format('Finished %s Level %s', coalesce(v_subject, 'a subject'), v_level)
             else format('Finished %s', coalesce(v_subject, 'a subject')) end,
        format('level:%s:%s:%s', new.student_id, new.subject_id, v_level),
        new.id
      )
      on conflict (dedupe_key) do nothing
      returning id into v_id;
      if v_id is not null then v_new := v_new || v_id; end if;
    end if;
  end if;

  select count(*), count(*) filter (where status is distinct from 'passed')
    into v_total, v_open
    from student_pace_slots
   where student_id = new.student_id and school_year = new.school_year;
  if v_total >= 6 and v_open = 0 then
    v_id := null;
    insert into student_celebrations (student_id, kind, school_year, title, dedupe_key, pace_slot_id)
    values (
      new.student_id, 'school_year', new.school_year,
      format('Finished the %s school year', new.school_year),
      format('year:%s:%s', new.student_id, new.school_year),
      new.id
    )
    on conflict (dedupe_key) do nothing
    returning id into v_id;
    if v_id is not null then v_new := v_new || v_id; end if;
  end if;

  if array_length(v_new, 1) is null or new.score_report_id is null then
    return new;
  end if;

  select f.id, f.email, coalesce(f.is_test_account, false)
    into v_family, v_email, v_test
    from students s left join families f on f.id = s.family_id
   where s.id = new.student_id;
  v_enabled := coalesce((select value from app_settings where key = 'email_celebration_enabled'), 'true') = 'true';

  foreach v_cid in array v_new loop
    v_status := 'pending';
    v_detail := null;
    if not v_enabled then
      v_status := 'skipped'; v_detail := 'Celebration emails are turned off';
    elsif v_test then
      v_status := 'skipped'; v_detail := 'Test account';
    elsif coalesce(btrim(v_email), '') = '' then
      v_status := 'skipped'; v_detail := 'No parent email';
    end if;
    insert into family_email_log (kind, dedupe_key, family_id, student_id, pace_slot_id, to_email, status, detail, celebration_id)
    values ('celebration', 'celebration:' || v_cid, v_family, new.student_id, new.id, v_email, v_status, v_detail, v_cid)
    on conflict (dedupe_key) do nothing;
    if v_status = 'pending' then v_pending := true; end if;
  end loop;

  if v_pending then
    begin
      perform net.http_post(
        url := (select decrypted_secret from vault.decrypted_secrets where name = 'mca_project_url')
               || '/functions/v1/family-emails',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'apikey', (select decrypted_secret from vault.decrypted_secrets where name = 'mca_anon_key'),
          'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'mca_anon_key'),
          'x-cron-secret', public.mca_get_cron_secret()
        ),
        body := jsonb_build_object('action', 'send_pending'),
        timeout_milliseconds := 30000
      );
    exception when others then
      raise warning 'family-emails kick failed: %', sqlerrm; -- the 15-minute backstop cron sends it
    end;
  end if;
  return new;
end;
$$;

drop trigger if exists student_pace_slots_celebrations on public.student_pace_slots;
create trigger student_pace_slots_celebrations
  after update of status on public.student_pace_slots
  for each row execute function public.mca_detect_celebrations();

-- 3) Re-enrollment.
create table if not exists public.reenrollments (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.students(id) on delete cascade,
  family_id uuid not null references public.families(id) on delete cascade,
  enrollment_id uuid references public.enrollments(id) on delete set null,
  school_year text not null,
  status text not null default 'confirmed'
    check (status in ('confirmed', 'awaiting_payment', 'paid', 'declined')),
  grade_next text,
  tuition_tier text check (tuition_tier in ('elementary', 'high_school')),
  frequency text check (frequency in ('annual', 'monthly')),
  payment_path text check (payment_path in ('autopay', 'comp', 'checkout', 'none')),
  stripe_checkout_session_id text,
  confirmed_at timestamptz not null default now(),
  paid_at timestamptz,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (student_id, school_year)
);
alter table public.reenrollments enable row level security;
drop policy if exists admin_full_access on public.reenrollments;
create policy admin_full_access on public.reenrollments
  for all to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists parent_select_own_reenrollments on public.reenrollments;
create policy parent_select_own_reenrollments on public.reenrollments
  for select to authenticated using (
    family_id in (select f.id from public.families f where f.auth_user_id = (select auth.uid()))
  );

-- Parents can't read app_settings, so they read the window through this.
create or replace function public.mca_reenroll_window()
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $$
  with s as (
    select
      coalesce((select value from app_settings where key = 'reenroll_open'), 'false') = 'true' as is_open,
      nullif((select value from app_settings where key = 'reenroll_window_start'), '') as start_on,
      nullif((select value from app_settings where key = 'reenroll_window_end'), '') as end_on,
      coalesce((select value from app_settings where key = 'reenroll_school_year'), '2027-28') as school_year,
      (timezone('America/Chicago', now()))::date as today
  )
  select jsonb_build_object(
    'open', is_open,
    'start', start_on,
    'end', end_on,
    'school_year', school_year,
    'today', today,
    'active', is_open
      and (start_on is null or today >= start_on::date)
      and (end_on is null or today <= end_on::date)
  )
  from s;
$$;
revoke all on function public.mca_reenroll_window() from public, anon;
grant execute on function public.mca_reenroll_window() to authenticated;

-- 4) Weekly summary log (admins read; the weekly-summary function writes).
create table if not exists public.weekly_summary_runs (
  id uuid primary key default gen_random_uuid(),
  ran_at timestamptz not null default now(),
  trigger text not null check (trigger in ('cron', 'preview')),
  sent_to text,
  status text not null check (status in ('sent', 'skipped', 'failed')),
  detail text,
  stats jsonb
);
alter table public.weekly_summary_runs enable row level security;
drop policy if exists admin_read on public.weekly_summary_runs;
create policy admin_read on public.weekly_summary_runs
  for select to authenticated using (public.is_admin());

-- 5) Parent dashboard: one call per student. Parents only see their own
--    students; admins see any.
create or replace function public.mca_portal_student_summary(p_student_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_family uuid;
  v_today date := (timezone('America/Chicago', now()))::date;
  v_year text;
  v_sched record;
  v_open_pick record;
  v_annual boolean := false;
  v_result jsonb;
begin
  select s.family_id into v_family from students s where s.id = p_student_id;
  if v_family is null then
    raise exception 'Student not found';
  end if;
  if not (
    coalesce(public.is_admin(), false)
    or exists (select 1 from families f where f.id = v_family and f.auth_user_id = auth.uid())
  ) then
    raise exception 'You do not have access to this student.' using errcode = '42501';
  end if;

  v_year := case when extract(month from v_today) >= 7
                 then extract(year from v_today)::int
                 else extract(year from v_today)::int - 1 end
            || '-' || right(((case when extract(month from v_today) >= 7
                 then extract(year from v_today)::int
                 else extract(year from v_today)::int - 1 end) + 1)::text, 2);

  select * into v_sched
    from student_ship_schedules
   where student_id = p_student_id
   order by (school_year = v_year) desc, school_year desc
   limit 1;
  v_annual := coalesce(v_sched.mode = 'annual', false);

  select * into v_open_pick
    from pick_lists
   where student_id = p_student_id and status not in ('shipped', 'cancelled')
   order by ship_date
   limit 1;

  v_result := jsonb_build_object(
    'school_year', v_year,
    'current_paces', coalesce((
      select jsonb_agg(jsonb_build_object(
               'subject', sub.name,
               'pace', case when sps.pace_number > 1000 then sps.pace_number else sps.pace_number + 1000 end,
               'issued_at', sps.issued_at
             ) order by sub.name, sps.slot_index)
        from student_pace_slots sps join subjects sub on sub.id = sps.subject_id
       where sps.student_id = p_student_id and sps.status = 'issued'
    ), '[]'::jsonb),
    'progress', (
      select jsonb_build_object(
               'passed', count(*) filter (where status = 'passed'),
               'total', count(*)
             )
        from student_pace_slots
       where student_id = p_student_id and school_year = v_year
    ),
    'next_shipment', jsonb_build_object(
      'ship_date', coalesce(v_open_pick.ship_date, v_sched.next_ship_date),
      'mode', v_sched.mode,
      'paused', coalesce(v_open_pick.status = 'paused', false) or coalesce(v_sched.shipment_paused, false),
      'pause_reason', coalesce(v_open_pick.notes, v_sched.pause_reason),
      'paces', case
        when v_open_pick.id is not null then coalesce((
          select jsonb_agg(jsonb_build_object(
                   'subject', sub.name,
                   'pace', case when pli.pace_number > 1000 then pli.pace_number else pli.pace_number + 1000 end
                 ) order by sub.name, pli.pace_number)
            from pick_list_items pli join subjects sub on sub.id = pli.subject_id
           where pli.pick_list_id = v_open_pick.id and pli.pace_slot_id is not null
        ), '[]'::jsonb)
        when v_sched.id is not null then coalesce((
          select jsonb_agg(jsonb_build_object(
                   'subject', sub.name,
                   'pace', case when c.pace_number > 1000 then c.pace_number else c.pace_number + 1000 end
                 ) order by sub.name, c.pace_number)
            from mca_pick_list_candidates(p_student_id, v_sched.school_year, null, v_annual) c
            join subjects sub on sub.id = c.subject_id
        ), '[]'::jsonb)
        else '[]'::jsonb end
    ),
    'last_shipment', (
      select jsonb_build_object('shipped_at', pl.shipped_at, 'tracking_number', pl.tracking_number, 'tracking_url', pl.tracking_url)
        from pick_lists pl
       where pl.student_id = p_student_id and pl.status = 'shipped'
       order by pl.shipped_at desc nulls last
       limit 1
    ),
    'recent_tests', coalesce((
      select jsonb_agg(t order by t->>'reported_at' desc)
        from (
          select jsonb_build_object(
                   'subject', sub.name,
                   'pace', case when sr.pace_number > 1000 then sr.pace_number else sr.pace_number + 1000 end,
                   'score', sr.score,
                   'status', sr.review_status,
                   'note', sr.admin_note,
                   'reported_at', sr.reported_at
                 ) as t
            from score_reports sr join subjects sub on sub.id = sr.subject_id
           where sr.student_id = p_student_id
           order by sr.reported_at desc
           limit 6
        ) x
    ), '[]'::jsonb),
    'balance', (
      with past_due as (
        select e.id, st.student_name, coalesce(e.price, 0) as amount, e.stripe_subscription_status as why
          from enrollments e join students st on st.id = e.student_id
         where e.family_id = v_family
           and e.stripe_subscription_status in ('past_due', 'unpaid', 'incomplete')
      ),
      unpaid_orders as (
        select o.id, coalesce(o.total, 0) as amount, o.created_at
          from orders o
         where o.family_id = v_family
           and coalesce(o.status, '') <> 'cancelled'
           and o.payment_status in ('unpaid', 'pending', 'failed', 'requires_payment', 'past_due')
      )
      select jsonb_build_object(
               'total', coalesce((select sum(amount) from past_due), 0) + coalesce((select sum(amount) from unpaid_orders), 0),
               'past_due', coalesce((select jsonb_agg(jsonb_build_object('student', student_name, 'amount', amount, 'status', why)) from past_due), '[]'::jsonb),
               'unpaid_orders', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'amount', amount, 'created_at', created_at)) from unpaid_orders), '[]'::jsonb)
             )
    ),
    'celebrations', coalesce((
      select jsonb_agg(jsonb_build_object('id', c.id, 'kind', c.kind, 'title', c.title, 'level', c.level,
                                          'school_year', c.school_year, 'created_at', c.created_at, 'seen_at', c.seen_at)
                       order by c.created_at desc)
        from student_celebrations c
       where c.student_id = p_student_id
    ), '[]'::jsonb)
  );
  return v_result;
end;
$$;
revoke all on function public.mca_portal_student_summary(uuid) from public, anon;
grant execute on function public.mca_portal_student_summary(uuid) to authenticated;

-- 6) Per-student pick-list refresh, built from the existing
--    mca_generate_pick_lists body (unchanged) with one extra student filter,
--    so scoring a test can un-pause that student's next box right away.
do $mig$
declare
  def text;
begin
  def := pg_get_functiondef('public.mca_generate_pick_lists(boolean)'::regprocedure);
  def := replace(def,
    'FUNCTION public.mca_generate_pick_lists(p_force boolean DEFAULT false)',
    'FUNCTION public.mca_generate_pick_lists_for_student(p_student_id uuid, p_force boolean DEFAULT true)');
  def := replace(def,
    'where next_ship_date is not null',
    'where next_ship_date is not null and student_id = p_student_id');
  if position('mca_generate_pick_lists_for_student' in def) = 0
     or position('student_id = p_student_id' in def) = 0 then
    raise exception 'Round 10: could not derive mca_generate_pick_lists_for_student';
  end if;
  execute def;
end
$mig$;
revoke all on function public.mca_generate_pick_lists_for_student(uuid, boolean) from public, anon, authenticated;
grant execute on function public.mca_generate_pick_lists_for_student(uuid, boolean) to service_role;

-- 7) The weekly summary (service role, no signed-in admin) reads the same
--    reorder forecast the Today dashboard uses.
do $mig$
declare
  def text;
begin
  def := pg_get_functiondef('public.mca_reorder_forecast(integer, boolean)'::regprocedure);
  if position('service_role' in def) = 0 then
    def := replace(def,
      'if not public.is_admin() then',
      'if not public.is_admin() and coalesce(auth.role(), '''') <> ''service_role'' then');
    if position('service_role' in def) = 0 then
      raise exception 'Round 10: could not update mca_reorder_forecast';
    end if;
    execute def;
  end if;
end
$mig$;

-- 8) Score a test from the Test Reviews photo viewer: save PACE + score,
--    approve, let the existing triggers update the PACE slot, then refresh
--    this student's paused pick list (the existing prescribe logic).
create or replace function public.mca_score_test(
  p_score_report_id uuid,
  p_score text,
  p_ace_pace integer default null,
  p_approve boolean default true,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  r score_reports%rowtype;
  v_internal integer;
  v_num numeric;
  v_slot record;
  v_sched record;
  v_pick record;
  v_pick_result jsonb := null;
begin
  if coalesce(public.is_admin(), false) is not true then
    raise exception 'Admin only' using errcode = '42501';
  end if;
  select * into r from score_reports where id = p_score_report_id for update;
  if not found then
    raise exception 'Test upload not found';
  end if;

  begin
    v_num := btrim(coalesce(p_score, ''))::numeric;
  exception when others then
    raise exception 'Enter the score as a number, like 92';
  end;
  if v_num < 0 or v_num > 100 then
    raise exception 'The score must be from 0 to 100';
  end if;

  v_internal := coalesce(p_ace_pace, r.pace_number);
  if v_internal > 1000 then v_internal := v_internal - 1000; end if;

  if v_internal <> r.pace_number then
    if not exists (
      select 1 from student_pace_slots
       where student_id = r.student_id and subject_id = r.subject_id and pace_number = v_internal
    ) then
      raise exception 'PACE % is not prescribed for this student in this subject.', v_internal + 1000;
    end if;
    update student_pace_slots
       set status = 'issued', score = null, completed_at = null, score_report_id = null, updated_at = now()
     where score_report_id = r.id;
  end if;

  update score_reports
     set score = trim(to_char(v_num, 'FM999990.##'), '.'),
         pace_number = v_internal,
         review_status = case when p_approve then 'approved' else review_status end,
         reviewed_by = case when p_approve then auth.uid() else reviewed_by end,
         reviewed_at = case when p_approve then now() else reviewed_at end,
         admin_note = coalesce(nullif(btrim(p_note), ''), admin_note)
   where id = r.id;

  select id, status, score, slot_index, school_year into v_slot
    from student_pace_slots
   where student_id = r.student_id and subject_id = r.subject_id and pace_number = v_internal
   order by school_year desc
   limit 1;

  select * into v_sched from student_ship_schedules
   where student_id = r.student_id and next_ship_date is not null
   order by school_year desc limit 1;
  if v_sched.id is not null then
    select * into v_pick from pick_lists
     where student_id = r.student_id and school_year = v_sched.school_year
       and ship_date = v_sched.next_ship_date;
    if v_pick.id is not null and v_pick.status = 'paused' then
      v_pick_result := public.mca_generate_pick_lists_for_student(r.student_id, true);
    end if;
  end if;

  return jsonb_build_object(
    'score_report_id', r.id,
    'score', v_num,
    'ace_pace', v_internal + 1000,
    'approved', p_approve,
    'slot_id', v_slot.id,
    'slot_status', v_slot.status,
    'passed', v_num >= 80,
    'next_ship_date', v_sched.next_ship_date,
    'pick_list_refreshed', v_pick_result is not null,
    'pick_list_result', v_pick_result,
    'new_celebrations', coalesce((
      select jsonb_agg(c.title) from student_celebrations c
       where c.student_id = r.student_id and c.created_at >= now()
    ), '[]'::jsonb)
  );
end;
$$;
revoke all on function public.mca_score_test(uuid, text, integer, boolean, text) from public, anon;
grant execute on function public.mca_score_test(uuid, text, integer, boolean, text) to authenticated;
