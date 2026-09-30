-- Bug fix found during security testing: parent_insert_own_school_calendar (added in
-- 20260930222000) had a NOT EXISTS subquery on student_school_calendars itself, which
-- makes Postgres raise "infinite recursion detected in policy for relation
-- student_school_calendars" on EVERY insert (parents and admins). The "insert once"
-- rule is already enforced by the primary key (student_id, school_year), and parents
-- still have no UPDATE policy, so dropping the self-reference keeps the same semantics.

drop policy if exists parent_insert_own_school_calendar on public.student_school_calendars;
create policy parent_insert_own_school_calendar on public.student_school_calendars
  for insert to authenticated
  with check (
    exists (
      select 1 from public.students s
      join public.families f on f.id = s.family_id
      where s.id = student_school_calendars.student_id
        and f.auth_user_id = (select auth.uid())
    )
  );
