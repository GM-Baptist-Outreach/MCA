-- Round 3 A6 verify fix (marker: MCA_R3_A6_REMOVE_PACE)
-- Hardening found in live verification: removing the last unstarted box for a
-- PACE also deleted that student's pace_status row even when it was 'issued'
-- (an orphan issued row with no slot). Removal now only clears pace_status rows
-- that are still pre-issue (ordered / in stock / shipped / received); issued
-- history is kept.
create or replace function public.mca_remove_pace_slots(p_slot_ids uuid[])
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  blocked int;
  removed int;
  groups text[];
  v_items text[];
  g text;
  g_student uuid;
  g_subject uuid;
  g_year text;
  remaining int;
begin
  if not coalesce(public.is_admin(), false) then
    raise exception 'Admin only' using errcode = '42501';
  end if;

  select count(*) into blocked
  from student_pace_slots
  where id = any(p_slot_ids)
    and (status in ('issued', 'passed', 'failed') or score is not null);
  if blocked > 0 then
    raise exception 'Issued or scored PACEs cannot be removed. Use Re-issue or edit the score instead.'
      using errcode = '22023';
  end if;

  select coalesce(array_agg(distinct s.student_id::text || '|' || s.subject_id::text || '|' || s.school_year), '{}'),
         coalesce(array_agg(distinct s.student_id::text || '|' || s.item_id::text) filter (where s.item_id is not null), '{}')
    into groups, v_items
  from student_pace_slots s
  where s.id = any(p_slot_ids);

  delete from student_pace_slots where id = any(p_slot_ids);
  get diagnostics removed = row_count;

  -- drop pace_status rows whose PACE is no longer on the student's plan
  delete from pace_status ps
  where (ps.student_id::text || '|' || ps.item_id::text) = any(v_items)
    and ps.status not in ('issued', 'passed', 'failed')
    and not exists (
      select 1 from student_pace_slots s
      where s.student_id = ps.student_id and s.item_id = ps.item_id
    );

  foreach g in array groups loop
    g_student := split_part(g, '|', 1)::uuid;
    g_subject := split_part(g, '|', 2)::uuid;
    g_year := split_part(g, '|', 3);
    select count(*) into remaining
    from student_pace_slots s
    where s.student_id = g_student and s.subject_id = g_subject and s.school_year = g_year;
    if remaining > 0 then
      update required_pace_plans p
      set required_count = remaining
      where p.student_id = g_student and p.subject_id = g_subject and p.school_year = g_year;
    else
      delete from required_pace_plans p
      where p.student_id = g_student and p.subject_id = g_subject and p.school_year = g_year;
    end if;
  end loop;

  return jsonb_build_object('removed', removed);
end;
$$;

revoke all on function public.mca_remove_pace_slots(uuid[]) from public, anon;
grant execute on function public.mca_remove_pace_slots(uuid[]) to authenticated;
