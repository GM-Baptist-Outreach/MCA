-- Security hardening: tighten what parents (non-admin `authenticated`) can write.
-- Audit of src/pages/portal/** and src/hooks/** (branch claude/mca-initial-spec @ fa16a53):
--   families          : portal never writes (read-only in PortalLayout). Admin UI + edge
--                       functions (service_role) write it.
--   pace_status       : PortalPaceStatus.setSlotStatus upserts
--                       {student_id, item_id, status, status_date, updated_at}
--                       onConflict (student_id,item_id). Needed -> kept, but restricted.
--   form_submissions  : INSERT by all 7 portal forms. UPDATE only by the running-log forms
--                       PortalPeLog (pe_activity_log), PortalMusicVerification
--                       (music_practice_verification) and PortalGoalCard (goal_card), which
--                       change submitted_data, signer_name and (goal card) signed_at.
--                       Signed agreement forms (enrollment_agreement, honesty_policy,
--                       records_release, elementary_course_verification) are never updated.
-- Guards only apply to the anon/authenticated roles when the caller is not an admin;
-- service_role (edge functions) and postgres are unaffected. Functions are SECURITY
-- INVOKER so current_user is the real PostgREST role.

-- ---------------------------------------------------------------- families
create or replace function public.guard_family_parent_update()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  -- columns a parent may edit on their own family row (contact / address profile)
  allowed text[] := array['parent_name','second_parent_name','phone','address',
                          'address_street','address_city','address_state','address_zip',
                          'updated_at'];
begin
  if current_user not in ('anon', 'authenticated') or coalesce(public.is_admin(), false) then
    return new;
  end if;
  -- anything outside the allow-list (auth_user_id, email, report_token, stripe_*,
  -- ghl_contact_id, id, created_at, and any future column) is locked for parents
  if (to_jsonb(new) - allowed) is distinct from (to_jsonb(old) - allowed) then
    raise exception 'Only MCA staff can change these family account fields.'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists families_guard_parent_update on public.families;
create trigger families_guard_parent_update
  before update on public.families
  for each row execute function public.guard_family_parent_update();

-- ---------------------------------------------------------------- pace_status
create or replace function public.guard_pace_status_parent_write()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if current_user not in ('anon', 'authenticated') or coalesce(public.is_admin(), false) then
    return new;
  end if;

  if tg_op = 'UPDATE' then
    if new.student_id is distinct from old.student_id
      or new.item_id is distinct from old.item_id
      or new.order_item_id is distinct from old.order_item_id
      or new.created_at is distinct from old.created_at
      or new.id is distinct from old.id
    then
      raise exception 'Parents can only change the PACE status and date.'
        using errcode = '42501';
    end if;
  else -- INSERT
    if new.order_item_id is not null then
      raise exception 'Parents cannot link PACE status to an order.'
        using errcode = '42501';
    end if;
  end if;

  -- the PACE must actually be prescribed to this student (portal only acts on slots)
  if not exists (
    select 1 from public.student_pace_slots sl
    where sl.student_id = new.student_id and sl.item_id = new.item_id
  ) then
    raise exception 'That PACE is not on this student''s plan.'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists pace_status_guard_parent_write on public.pace_status;
create trigger pace_status_guard_parent_write
  before insert or update on public.pace_status
  for each row execute function public.guard_pace_status_parent_write();

-- ---------------------------------------------------------------- form_submissions
-- Signed/submitted agreement forms become immutable for parents. Only the running-log
-- forms stay editable, and only their content columns.
drop policy if exists parent_update_own_form_submissions on public.form_submissions;
create policy parent_update_own_form_submissions on public.form_submissions
  for update to authenticated
  using (
    form_type in ('pe_activity_log', 'music_practice_verification', 'goal_card')
    and family_id in (select f.id from public.families f where f.auth_user_id = (select auth.uid()))
  )
  with check (
    form_type in ('pe_activity_log', 'music_practice_verification', 'goal_card')
    and family_id in (select f.id from public.families f where f.auth_user_id = (select auth.uid()))
  );

create or replace function public.guard_form_submission_parent_update()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if current_user not in ('anon', 'authenticated') or coalesce(public.is_admin(), false) then
    return new;
  end if;
  if new.id is distinct from old.id
    or new.family_id is distinct from old.family_id
    or new.student_id is distinct from old.student_id
    or new.form_type is distinct from old.form_type
    or new.created_at is distinct from old.created_at
  then
    raise exception 'A submitted form''s family, student and type cannot be changed.'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists form_submissions_guard_parent_update on public.form_submissions;
create trigger form_submissions_guard_parent_update
  before update on public.form_submissions
  for each row execute function public.guard_form_submission_parent_update();

-- trigger-only helpers: not callable over RPC
revoke execute on function public.guard_family_parent_update() from public, anon, authenticated;
revoke execute on function public.guard_pace_status_parent_write() from public, anon, authenticated;
revoke execute on function public.guard_form_submission_parent_update() from public, anon, authenticated;
