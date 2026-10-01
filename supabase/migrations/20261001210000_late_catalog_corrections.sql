-- Late catalog corrections from David (2026-10-01). Marker: MCA_LATE_CATALOG
--
-- 1. Social Studies level 7 is SS 73-78 plus Illinois History. The six
--    Illinois History PACEs (and their key) were parked under an inactive
--    "Illinois History" subject with no PACE numbers, so nothing could
--    prescribe or sell them. They move into Social Studies as PACEs 79-84,
--    the second half of level 7. Every path that works by level (store
--    "Add level", admin Prescribe, Prescribe All, July 1 represcribe) now
--    includes them with SS 73-78 automatically. Level 8 stays 85-96.
-- 2-4. Animal Science 1-24 (levels 1-2), Bible Reading 1-72 (levels 1-6) and
--    Lit & Creative Writing 13-72 (levels 2-6) were already correct in the
--    catalog; this only marks those subjects confirmed.
-- 5-6. Basic Lit 7 and Basic Lit 8 did not exist. Each is one PACE under a new
--    "Basic Literature" subject: level 7 = PACE 73, level 8 = PACE 85. The
--    book list is in short_description. Price defaults to the standard PACE
--    price (3.30) and is_confirmed stays false until David confirms it.
--
-- Guarded: the moved Illinois History rows must have no orders or PACE boxes.

do $$
declare
  ss uuid;
  refs int;
begin
  select id into ss from subjects where name = 'Social Studies';
  if ss is null then raise exception 'Social Studies subject missing'; end if;

  select count(*) into refs
  from items i
  where i.sku like 'ILS-ILLINOIS-HISTORY-%'
    and (exists (select 1 from order_items oi where oi.item_id = i.id)
      or exists (select 1 from student_pace_slots s where s.item_id = i.id));
  if refs > 0 then raise exception 'Illinois History items are already referenced (%)', refs; end if;

  -- 1. Illinois History PACEs 1-6 -> Social Studies PACEs 79-84 (level 7)
  update items i
  set subject_id = ss,
      item_type = 'pace',
      pace_number = 78 + m.n,
      grade_level = 7,
      original_name = 'Illinois History ' || m.n,
      short_description = 'Illinois History PACE ' || m.n || ' of 6. Second half of Social Studies Level 7 (after SS 1073-1078).',
      active = true,
      updated_at = now()
  from (values
    ('ILS-ILLINOIS-HISTORY-1-1695', 1),
    ('ILS-ILLINOIS-HISTORY-2-1696', 2),
    ('ILS-ILLINOIS-HISTORY-3-1697', 3),
    ('ILS-ILLINOIS-HISTORY-4-1698', 4),
    ('ILS-ILLINOIS-HISTORY-5-1699', 5),
    ('ILS-ILLINOIS-HISTORY-6-1700', 6)
  ) as m(sku, n)
  where i.sku = m.sku;

  update items
  set subject_id = ss,
      range_start = 79,
      range_end = 84,
      original_name = 'Illinois History Key 1-6',
      active = true,
      updated_at = now()
  where sku = 'ILS-ILLINOIS-HISTORY-KEY-1-6-1701';

  -- 2-4. confirmed as-is
  update subjects set is_confirmed = true, updated_at = now()
  where name in ('Animal Science', 'Bible Reading', 'Lit & Creative Writing', 'Social Studies');

  -- 5-6. Basic Lit 7 / Basic Lit 8
  insert into subjects (name, active, store_visible, credit_value, is_confirmed)
  values ('Basic Literature', true, true, 1, false)
  on conflict (name) do nothing;

  insert into items (subject_id, sku, item_type, pace_number, grade_level, original_name,
                     sales_price, price_source, active, is_confirmed, short_description)
  select s.id, v.sku, 'pace', v.pace, v.lvl, v.name, 3.30, 'manual', true, false, v.descr
  from subjects s
  cross join (values
    ('BASIC-LIT-7', 73, 7, 'Basic Lit 7',
     'One PACE for all 7th-level literature books: By Searching; D. L. Moody; George Mueller; Swiss Family Robinson; Through Gates of Splendor. Books sold separately.'),
    ('BASIC-LIT-8', 85, 8, 'Basic Lit 8',
     'One PACE for all 8th-level literature books: Abraham Lincoln; Ann of Ava; God''s Adventurer; In His Steps; Little One, Maid of Israel; When Science Fails. Books sold separately.')
  ) as v(sku, pace, lvl, name, descr)
  where s.name = 'Basic Literature'
  on conflict (sku) do nothing;
end $$;
