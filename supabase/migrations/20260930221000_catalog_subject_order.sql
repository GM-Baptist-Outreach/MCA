-- Hide courses that are not on David's list. Nothing is deleted.
-- Kindergarten, Learning to Read, and the RR items stay active.

alter table public.subjects
  add column if not exists store_visible boolean not null default true,
  add column if not exists sort_order integer;

comment on column public.subjects.store_visible is
  'When false, the subject is hidden from the public store. active=false hides it everywhere.';
comment on column public.subjects.sort_order is
  'Optional override of the default subject order. Null keeps Math, English, Word Building, Science, Social Studies, then electives.';

-- Books 1-6 on these two courses are sold as the course, not as unnumbered extras.
update public.items as item
set
  item_type = 'pace',
  pace_number = substring(item.original_name from '([1-6])\s*$')::int
from public.subjects as subject
where item.subject_id = subject.id
  and subject.name in ('Nutrition Science', 'Creative Communication Skills')
  and item.item_type = 'other'
  and item.pace_number is null
  and item.original_name ~ '(^|[^0-9])[1-6]\s*$'
  and item.original_name !~* 'teacher|guide|key|set';

with ranked as (
  select
    item.id,
    row_number() over (partition by item.subject_id order by item.original_name) as n,
    count(*) over (partition by item.subject_id) as total
  from public.items as item
  join public.subjects as subject on subject.id = item.subject_id
  where subject.name in ('Nutrition Science', 'Creative Communication Skills')
    and item.active = true
    and item.item_type = 'other'
    and item.pace_number is null
    and item.original_name !~* 'teacher|guide|key|set'
)
update public.items as item
set item_type = 'pace', pace_number = ranked.n
from ranked
where item.id = ranked.id
  and ranked.total between 1 and 6;

-- Hide listed items unless a slot or pick line still points at them.
update public.items as item
set active = false
where item.active = true
  and not exists (
    select 1 from public.student_pace_slots slot where slot.item_id = item.id
  )
  and not exists (
    select 1 from public.pick_list_items line where line.item_id = item.id
  )
  and (
    item.original_name ilike '%Federalist Papers%'
    or item.original_name ilike '%Flagellant on Horseback%'
    or item.subject_id in (
      select id from public.subjects
      where name in (
        'Basic Art',
        'Etymology',
        'Family & Consumer Science',
        'Illinois History'
      )
    )
    or (
      item.subject_id in (select id from public.subjects where name = 'World History')
      and (
        item.pace_number between 97 and 108
        or (
          item.item_type = 'key'
          and item.range_start >= 97
          and item.range_end <= 108
        )
      )
    )
  );

update public.subjects
set active = false, store_visible = false
where name in (
  'Biology Labs',
  'BT Life of Christ',
  'BT Life of Christ 1st qtr.set',
  'Business & Career Electives',
  'Chemistry Labs',
  'French-108',
  'Honor Roll Cert.',
  'Math Diagnostic',
  'Math Diagnostic Test',
  'Physical Sci LabsSet',
  'Physics Lab',
  'School Supplies & Incentives',
  'Spanish Act Pac',
  'Spanish Test',
  'Videophonics Set of',
  'Basic Art',
  'Etymology',
  'Family & Consumer Science',
  'Illinois History'
)
and not exists (
  select 1 from public.items item
  where item.subject_id = subjects.id
    and item.active = true
);
