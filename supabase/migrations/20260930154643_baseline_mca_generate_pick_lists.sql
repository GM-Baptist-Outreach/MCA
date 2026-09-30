-- Baseline of public.mca_generate_pick_lists as it existed on project
-- proiyioqfbjcmprsnqhf on 2026-09-30. Captured before the companion,
-- stock-zero, and backordered changes in the next migration.
-- Cron mca-generate-pick-lists-daily runs:
--   select public.mca_generate_pick_lists(false);

CREATE OR REPLACE FUNCTION public.mca_generate_pick_lists(p_force boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  today date := (timezone('utc', now()))::date;
  schedule record;
  results jsonb := '[]'::jsonb;
  existing record;
  existing_found boolean;
  prior_reminder timestamptz;
  missing_count int;
  pick_id uuid;
  note text;
  next_date date;
  lines_count int;
begin
  for schedule in
    select *
    from student_ship_schedules
    where next_ship_date is not null
  loop
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
    from (
      select 1
      from (
        select sps.id,
               row_number() over (partition by sps.subject_id order by sps.slot_index) as rn
        from student_pace_slots sps
        where sps.student_id = schedule.student_id
          and sps.school_year = schedule.school_year
          and sps.status in ('prescribed','ordered','in_stock')
      ) s
      where s.rn <= 3
    ) q;

    if coalesce(lines_count, 0) = 0 then
      results := results || jsonb_build_array(jsonb_build_object(
        'student_id', schedule.student_id,
        'skipped', 'no unissued PACEs'
      ));
      continue;
    end if;

    insert into pick_lists as pl (
      student_id, school_year, ship_date, status, paused_for_missing_scores, notes, updated_at
    ) values (
      schedule.student_id, schedule.school_year, schedule.next_ship_date, 'ready', false,
      'Next 3 unissued PACEs per logged subject.', now()
    )
    on conflict (student_id, school_year, ship_date) do update set
      status = 'ready',
      paused_for_missing_scores = false,
      notes = excluded.notes,
      updated_at = now()
    returning id into pick_id;

    delete from pick_list_items where pick_list_id = pick_id;
    insert into pick_list_items (pick_list_id, pace_slot_id, subject_id, pace_number, item_id, quantity_needed, quantity_on_hand)
    select pick_id, s.id, s.subject_id, s.pace_number, s.item_id, 1,
           (select nullif(coalesce(sum(il.quantity_on_hand), 0), 0) from inventory_levels il where il.item_id = s.item_id)
    from (
      select sps.*,
             row_number() over (partition by sps.subject_id order by sps.slot_index) as rn
      from student_pace_slots sps
      where sps.student_id = schedule.student_id
        and sps.school_year = schedule.school_year
        and sps.status in ('prescribed','ordered','in_stock')
    ) s
    where s.rn <= 3;

    update student_pace_slots sps
    set status = 'ordered', updated_at = now()
    where sps.status = 'prescribed'
      and sps.id in (
        select x.id from (
          select sps2.id,
                 row_number() over (partition by sps2.subject_id order by sps2.slot_index) as rn
          from student_pace_slots sps2
          where sps2.student_id = schedule.student_id
            and sps2.school_year = schedule.school_year
            and sps2.status in ('prescribed','ordered','in_stock')
        ) x
        where x.rn <= 3
      );

    if schedule.mode = 'every_8_weeks' then
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
      'next_ship_date', next_date,
      'generated_on', today
    ));
  end loop;

  return jsonb_build_object('today', today, 'results', results, 'source', 'sql');
end;
$function$;
