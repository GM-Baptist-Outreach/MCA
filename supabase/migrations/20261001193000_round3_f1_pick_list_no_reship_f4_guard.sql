-- Round 3 F1 + F4 (marker: MCA_R3_F1_NO_RESHIP / MCA_R3_F4_SHIPPED_ONLY)
--
-- F1. The generator used to pick "next 3 per subject" from slots in
--     ('prescribed','ordered','in_stock'), so PACEs that had already shipped
--     (ordered) or been received (in_stock) were picked again on the next run.
--     Candidates are now:
--       * status = 'prescribed' (never shipped), plus
--       * slots already on THIS pick list (same student/year/ship_date), so a
--         forced rebuild of the same list stays idempotent.
--     Annual Ship (mode = 'annual', enabled by a later migration) takes every
--     candidate with no 3-per-subject cap, skips the 6-score gate, and leaves
--     next_ship_date NULL afterwards.
-- F4. Parents may only change PACE status on a slot that has shipped
--     (ordered / in_stock / issued). Unshipped (prescribed) slots are admin-only.

create or replace function public.mca_pick_list_candidates(
  p_student_id uuid,
  p_school_year text,
  p_pick_list_id uuid,
  p_annual boolean default false
)
returns table (
  slot_id uuid,
  subject_id uuid,
  slot_index smallint,
  pace_number integer,
  item_id uuid,
  status text
)
language sql
stable
set search_path = public
as $$
  select s.id, s.subject_id, s.slot_index, s.pace_number, s.item_id, s.status
  from (
    select sps.*,
           row_number() over (partition by sps.subject_id order by sps.slot_index) as rn
    from student_pace_slots sps
    where sps.student_id = p_student_id
      and sps.school_year = p_school_year
      and (
        sps.status = 'prescribed'
        or (
          p_pick_list_id is not null
          and sps.status in ('ordered', 'in_stock')
          and exists (
            select 1 from pick_list_items x
            where x.pick_list_id = p_pick_list_id
              and x.pace_slot_id = sps.id
          )
        )
      )
  ) s
  where p_annual or s.rn <= 3
$$;

revoke all on function public.mca_pick_list_candidates(uuid, text, uuid, boolean) from public, anon, authenticated;
grant execute on function public.mca_pick_list_candidates(uuid, text, uuid, boolean) to service_role;

create or replace function public.mca_generate_pick_lists(p_force boolean default false)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  today date := (timezone('utc', now()))::date;
  schedule record;
  results jsonb := '[]'::jsonb;
  existing record;
  existing_found boolean;
  existing_id uuid;
  prior_reminder timestamptz;
  missing_count int;
  pick_id uuid;
  note text;
  next_date date;
  lines_count int;
  is_annual boolean;
  cand_ids uuid[];
begin
  for schedule in
    select *
    from student_ship_schedules
    where next_ship_date is not null
  loop
    is_annual := schedule.mode = 'annual';

    if not p_force and not (schedule.next_ship_date >= today and schedule.next_ship_date <= today + 7) then
      results := results || jsonb_build_array(jsonb_build_object(
        'student_id', schedule.student_id,
        'skipped', 'outside 7-day window',
        'shipDate', schedule.next_ship_date
      ));
      continue;
    end if;

    select * into existing
    from pick_lists
    where student_id = schedule.student_id
      and school_year = schedule.school_year
      and ship_date = schedule.next_ship_date;
    existing_found := FOUND;
    existing_id := case when existing_found then existing.id else null end;
    prior_reminder := case when existing_found then existing.reminder_email_sent_at else null end;

    if existing_found and existing.status is distinct from 'paused' and not p_force then
      results := results || jsonb_build_array(jsonb_build_object(
        'student_id', schedule.student_id,
        'skipped', 'pick list already exists',
        'pick_list_id', existing.id,
        'status', existing.status
      ));
      continue;
    end if;

    if not is_annual then
      with issued as (
        select score,
               row_number() over (
                 order by coalesce(issued_at::text, '') desc, slot_index desc
               ) as rn,
               count(*) over () as total_issued
        from student_pace_slots
        where student_id = schedule.student_id
          and school_year = schedule.school_year
          and (status in ('issued','passed','failed') or issued_at is not null)
      )
      select count(*) into missing_count
      from issued
      where total_issued >= 6 and rn <= 6 and score is null;
    else
      missing_count := 0;
    end if;

    if coalesce(missing_count, 0) > 0 then
      note := format('Paused: %s of the last 6 issued PACEs have no score.', missing_count);
      insert into pick_lists as pl (
        student_id, school_year, ship_date, status, paused_for_missing_scores,
        reminder_email_sent_at, notes, updated_at
      ) values (
        schedule.student_id, schedule.school_year, schedule.next_ship_date, 'paused', true,
        prior_reminder,
        note, now()
      )
      on conflict (student_id, school_year, ship_date) do update set
        status = 'paused',
        paused_for_missing_scores = true,
        notes = excluded.notes,
        updated_at = now()
      returning id into pick_id;

      update student_ship_schedules
      set shipment_paused = true,
          pause_reason = note,
          updated_at = now()
      where id = schedule.id;

      results := results || jsonb_build_array(jsonb_build_object(
        'student_id', schedule.student_id,
        'pick_list_id', pick_id,
        'status', 'paused',
        'missing', missing_count,
        'emailed', false,
        'reminder_logged', true
      ));
      continue;
    end if;

    select count(*) into lines_count
    from mca_pick_list_candidates(schedule.student_id, schedule.school_year, existing_id, is_annual);

    if coalesce(lines_count, 0) = 0 then
      results := results || jsonb_build_array(jsonb_build_object(
        'student_id', schedule.student_id,
        'skipped', 'no unshipped PACEs'
      ));
      continue;
    end if;

    -- Snapshot candidate slot ids BEFORE pick_list_items for this list are replaced.
    cand_ids := array(
      select c.slot_id
      from mca_pick_list_candidates(schedule.student_id, schedule.school_year, existing_id, is_annual) c
    );

    insert into pick_lists as pl (
      student_id, school_year, ship_date, status, paused_for_missing_scores, notes, updated_at
    ) values (
      schedule.student_id, schedule.school_year, schedule.next_ship_date, 'ready', false,
      case when is_annual then 'Annual Ship: every unshipped prescribed PACE.'
           else 'Next 3 unshipped PACEs per logged subject.' end,
      now()
    )
    on conflict (student_id, school_year, ship_date) do update set
      status = 'ready',
      paused_for_missing_scores = false,
      notes = excluded.notes,
      updated_at = now()
    returning id into pick_id;

    delete from pick_list_items where pick_list_id = pick_id;
    insert into pick_list_items (
      pick_list_id, pace_slot_id, subject_id, pace_number, item_id,
      quantity_needed, quantity_on_hand, backordered
    )
    select pick_id, c.id, c.subject_id, c.pace_number, c.item_id, 1,
           (select sum(il.quantity_on_hand)::integer from inventory_levels il where il.item_id = c.item_id),
           coalesce(
             (select sum(il.quantity_on_hand) <= 0 from inventory_levels il where il.item_id = c.item_id),
             false
           )
    from student_pace_slots c
    where c.id = any(cand_ids);

    insert into pick_list_items (
      pick_list_id, pace_slot_id, subject_id, pace_number, item_id,
      quantity_needed, quantity_on_hand, backordered
    )
    select
      pick_id,
      null,
      c.subject_id,
      min(sps.pace_number),
      c.id,
      1,
      (select sum(il.quantity_on_hand)::integer from inventory_levels il where il.item_id = c.id),
      coalesce(
        (select sum(il.quantity_on_hand) <= 0 from inventory_levels il where il.item_id = c.id),
        false
      )
    from pick_list_items pli
    join student_pace_slots sps on sps.id = pli.pace_slot_id
    join items c
      on c.item_type = 'key'
     and c.subject_id = sps.subject_id
     and c.range_start is not null
     and c.range_end is not null
     and sps.pace_number >= c.range_start
     and sps.pace_number <= c.range_end
    where pli.pick_list_id = pick_id
      and pli.pace_slot_id is not null
      and not exists (
        select 1
        from pick_list_items pli_existing
        where pli_existing.pick_list_id = pick_id
          and pli_existing.item_id = c.id
      )
    group by c.id, c.subject_id;

    insert into resource_book_notices (student_id, item_id, school_year, pick_list_id)
    select distinct schedule.student_id, c.id, schedule.school_year, pick_id
    from pick_list_items pli
    join student_pace_slots sps on sps.id = pli.pace_slot_id
    join items c
      on c.item_type = 'other'
     and c.active = true
     and c.subject_id = sps.subject_id
     and c.range_start is not null
     and c.range_end is not null
     and sps.pace_number >= c.range_start
     and sps.pace_number <= c.range_end
    where pli.pick_list_id = pick_id
      and pli.pace_slot_id is not null
      and not exists (
        select 1
        from orders o
        join order_items oi on oi.order_id = o.id
        join students stu on stu.id = schedule.student_id
        join families fam on fam.id = stu.family_id
        where oi.item_id = c.id
          and lower(coalesce(o.customer_email, '')) = lower(fam.email)
          and o.status is distinct from 'cancelled'
      )
    on conflict (student_id, item_id, school_year) do nothing;

    update student_pace_slots sps
    set status = 'ordered', updated_at = now()
    where sps.status = 'prescribed'
      and sps.id = any(cand_ids);

    if is_annual then
      next_date := null;
    elsif schedule.mode = 'every_8_weeks' then
      next_date := schedule.next_ship_date + 56;
    else
      select min(d) into next_date
      from (values (schedule.q1_ship_date), (schedule.q2_ship_date), (schedule.q3_ship_date), (schedule.q4_ship_date)) as v(d)
      where d is not null and d > schedule.next_ship_date;
    end if;

    update student_ship_schedules
    set shipment_paused = false,
        pause_reason = null,
        next_ship_date = next_date,
        updated_at = now()
    where id = schedule.id;

    results := results || jsonb_build_array(jsonb_build_object(
      'student_id', schedule.student_id,
      'pick_list_id', pick_id,
      'status', 'ready',
      'lines', lines_count,
      'annual', is_annual,
      'next_ship_date', next_date,
      'generated_on', today
    ));
  end loop;

  return jsonb_build_object('today', today, 'results', results, 'source', 'sql');
end;
$function$;

-- ------------------------------------------------------------------ F4
create or replace function public.guard_pace_status_parent_write()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
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
  else
    if new.order_item_id is not null then
      raise exception 'Parents cannot link PACE status to an order.'
        using errcode = '42501';
    end if;
  end if;

  if not exists (
    select 1 from public.student_pace_slots sl
    where sl.student_id = new.student_id and sl.item_id = new.item_id
  ) then
    raise exception 'That PACE is not on this student''s plan.'
      using errcode = '42501';
  end if;

  -- MCA_R3_F4_SHIPPED_ONLY: unshipped PACEs are admin-only.
  if not exists (
    select 1 from public.student_pace_slots sl
    where sl.student_id = new.student_id
      and sl.item_id = new.item_id
      and sl.status in ('ordered', 'in_stock', 'issued')
  ) then
    raise exception 'That PACE has not shipped yet. Contact MCA to change it.'
      using errcode = '42501';
  end if;

  return new;
end;
$function$;
