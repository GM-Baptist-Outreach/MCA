-- Three-tier RLS per the MCA build spec's Security model section.
-- Public/anon: no policies at all (default deny). Real enrollment/order writes
-- happen via a secured Edge Function using the service role (bypasses RLS),
-- so there's never a DB row without a real Stripe object behind it.
-- Authenticated parent: read-only on their own family/students/enrollments/
-- score_reports, can insert their own students' score reports, can self-edit
-- their own family contact info.
-- Admin (admin_users): full read/write on everything, no role tiers.

create or replace function is_admin()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from admin_users where auth_user_id = auth.uid()
  );
$$;

grant execute on function is_admin() to authenticated;
revoke execute on function is_admin() from anon;

-- Admin: full access on every table in one pass.
do $$
declare
  t text;
begin
  for t in
    select tablename from pg_tables where schemaname = 'public'
  loop
    execute format(
      'create policy admin_full_access on %I for all to authenticated using (is_admin()) with check (is_admin())',
      t
    );
  end loop;
end $$;

-- Authenticated parent: read own family, self-edit contact info.
create policy parent_select_own_family on families
  for select to authenticated
  using (auth_user_id = auth.uid());

create policy parent_update_own_family on families
  for update to authenticated
  using (auth_user_id = auth.uid())
  with check (auth_user_id = auth.uid());

-- Authenticated parent: read own students.
create policy parent_select_own_students on students
  for select to authenticated
  using (family_id in (select id from families where auth_user_id = auth.uid()));

-- Authenticated parent: read own enrollments (plan/subscription info, read-only).
create policy parent_select_own_enrollments on enrollments
  for select to authenticated
  using (student_id in (
    select s.id from students s
    join families f on f.id = s.family_id
    where f.auth_user_id = auth.uid()
  ));

-- Authenticated parent: read + submit their own students' score reports.
create policy parent_select_own_score_reports on score_reports
  for select to authenticated
  using (student_id in (
    select s.id from students s
    join families f on f.id = s.family_id
    where f.auth_user_id = auth.uid()
  ));

create policy parent_insert_own_score_reports on score_reports
  for insert to authenticated
  with check (student_id in (
    select s.id from students s
    join families f on f.id = s.family_id
    where f.auth_user_id = auth.uid()
  ));
