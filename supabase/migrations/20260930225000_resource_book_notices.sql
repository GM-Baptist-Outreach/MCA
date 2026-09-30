-- Resource books are no longer pick-list lines.
-- The generator records a notice. The edge function emails the parent.

create table if not exists public.resource_book_notices (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.students(id) on delete cascade,
  item_id uuid not null references public.items(id),
  school_year text not null,
  pick_list_id uuid references public.pick_lists(id) on delete set null,
  notified_at timestamptz,
  purchased_order_id uuid references public.orders(id),
  created_at timestamptz not null default now(),
  unique (student_id, item_id, school_year)
);

alter table public.resource_book_notices enable row level security;
grant select on public.resource_book_notices to authenticated;
grant all on public.resource_book_notices to service_role;

drop policy if exists admin_full_access on public.resource_book_notices;
create policy admin_full_access on public.resource_book_notices
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists parent_select_own_resource_books on public.resource_book_notices;
create policy parent_select_own_resource_books on public.resource_book_notices
  for select to authenticated
  using (
    exists (
      select 1 from public.students s
      join public.families f on f.id = s.family_id
      where s.id = resource_book_notices.student_id
        and f.auth_user_id = auth.uid()
    )
  );

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
    insert into pick_list_items (
      pick_list_id, pace_slot_id, subject_id, pace_number, item_id,
      quantity_needed, quantity_on_hand, backordered
    )
    select pick_id, s.id, s.subject_id, s.pace_number, s.item_id, 1,
           (select sum(il.quantity_on_hand)::integer from inventory_levels il where il.item_id = s.item_id),
           coalesce(
             (select sum(il.quantity_on_hand) <= 0 from inventory_levels il where il.item_id = s.item_id),
             false
           )
    from (
      select sps.*,
             row_number() over (partition by sps.subject_id order by sps.slot_index) as rn
      from student_pace_slots sps
      where sps.student_id = schedule.student_id
        and sps.school_year = schedule.school_year
        and sps.status in ('prescribed','ordered','in_stock')
    ) s
    where s.rn <= 3;

    -- Answer keys only, same subject. Resource books are notices, not pick lines.
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
