-- Round 8 (additive only): progress report / transcript PDFs, graduation credit
-- tracker, reorder forecast, and SMS webhooks for GM Baptist software.
-- Marker: MCA_R8_MIGRATION
-- Nothing here changes or drops an existing table, column, function or cron job.

-- 1) Settings (admin-only app_settings). Webhook toggles start OFF.
insert into public.app_settings (key, value) values
  ('graduation_total_credits', '25'),
  ('reorder_horizon_days', '60'),
  ('sms_webhook_url_overdue', 'https://services.leadconnectorhq.com/hooks/9YFQxlzS8RBbYsxQ9knD/webhook-trigger/856d62f5-a061-40bb-9991-ed90f381667a'),
  ('sms_webhook_url_shipped', 'https://services.leadconnectorhq.com/hooks/9YFQxlzS8RBbYsxQ9knD/webhook-trigger/7d1f4c67-f531-411e-b801-1bbc4cbf2142'),
  ('sms_webhook_enabled_overdue', 'false'),
  ('sms_webhook_enabled_shipped', 'false')
on conflict (key) do nothing;

-- 2) Graduation total for parents (app_settings is admin-only, so parents read
--    the one number through this function).
create or replace function public.mca_graduation_total_credits()
returns numeric
language sql
stable
security definer
set search_path to 'public'
as $$
  select coalesce(
    (select nullif(trim(value), '')::numeric
       from app_settings
      where key = 'graduation_total_credits'
        and trim(value) ~ '^[0-9]+(\.[0-9]+)?$'),
    25
  );
$$;
revoke all on function public.mca_graduation_total_credits() from public;
grant execute on function public.mca_graduation_total_credits() to authenticated;

-- 3) SMS webhook log. Admins read it; only the sms-webhooks function (service
--    role) writes it. dedupe_key keeps each event to one send.
create table if not exists public.sms_webhook_log (
  id uuid primary key default gen_random_uuid(),
  event text not null check (event in ('test_upload_overdue', 'box_shipped')),
  dedupe_key text not null unique,
  family_id uuid references public.families(id) on delete set null,
  student_id uuid references public.students(id) on delete set null,
  status text not null default 'pending' check (status in ('pending', 'sent', 'failed', 'skipped')),
  http_status integer,
  detail text,
  payload jsonb,
  is_test boolean not null default false,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);
create index if not exists sms_webhook_log_created_idx on public.sms_webhook_log (created_at desc);
alter table public.sms_webhook_log enable row level security;
drop policy if exists sms_webhook_log_admin_read on public.sms_webhook_log;
create policy sms_webhook_log_admin_read on public.sms_webhook_log
  for select to authenticated using (public.is_admin());

-- 4) Reorder forecast (admin only, read-only).
--    Demand inside the horizon =
--      open pick list lines (not shipped yet)
--    + open store orders (submitted/confirmed, not refunded)
--    + projected shipments: each scheduled ship date inside the horizon takes the
--      next 3 unshipped prescribed PACEs per subject (Annual Ship takes all),
--      the same rule as mca_pick_list_candidates, plus the answer key covering
--      those PACEs when that student hasn't been sent it yet.
--    Test accounts are left out unless p_include_test.
--    Items with no stock count (no inventory_levels row) come back with
--    tracked = false and on_hand null; their shortfall is the full demand.
create or replace function public.mca_reorder_forecast(
  p_days integer default null,
  p_include_test boolean default false
)
returns table (
  item_id uuid,
  item_name text,
  sku text,
  item_type text,
  on_hand integer,
  open_demand integer,
  projected_demand integer,
  total_demand integer,
  shortfall integer,
  first_short_date date,
  horizon_days integer,
  tracked boolean
)
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_horizon integer;
  v_today date := (timezone('America/Chicago', now()))::date;
begin
  if not public.is_admin() then
    raise exception 'Admins only';
  end if;
  v_horizon := coalesce(
    p_days,
    (select case when trim(value) ~ '^[0-9]+$' then trim(value)::integer end
       from app_settings where key = 'reorder_horizon_days'),
    60
  );
  v_horizon := greatest(1, least(v_horizon, 365));

  return query
  with live_students as (
    select st.id as student_id
    from students st
    join families f on f.id = st.family_id
    where p_include_test or not coalesce(f.is_test_account, false)
  ),
  sched as (
    select s.*
    from student_ship_schedules s
    join live_students ls on ls.student_id = s.student_id
    where s.next_ship_date is not null
  ),
  ship_dates as (
    -- every_8_weeks: next date, then every 56 days
    select s.student_id, s.school_year, false as annual, (s.next_ship_date + g * 56) as d
    from sched s, generate_series(0, 8) g
    where s.mode = 'every_8_weeks'
    union all
    -- fixed quarter dates: next date and any later quarter date
    select s.student_id, s.school_year, false, v.d
    from sched s
    cross join lateral (values (s.next_ship_date), (s.q1_ship_date), (s.q2_ship_date), (s.q3_ship_date), (s.q4_ship_date)) v(d)
    where s.mode not in ('every_8_weeks', 'annual')
      and v.d is not null and v.d >= s.next_ship_date
    union all
    select s.student_id, s.school_year, true, s.next_ship_date
    from sched s
    where s.mode = 'annual'
  ),
  ship_ranked as (
    select x.student_id, x.school_year, x.annual,
           greatest(x.d, v_today) as ship_on,
           row_number() over (partition by x.student_id, x.school_year order by x.d) as k
    from (select distinct * from ship_dates) x
    where x.d <= v_today + v_horizon
  ),
  free_slots as (
    select sps.id, sps.student_id, sps.school_year, sps.subject_id, sps.pace_number, sps.item_id,
           row_number() over (partition by sps.student_id, sps.school_year, sps.subject_id order by sps.slot_index) as rn
    from student_pace_slots sps
    join live_students ls on ls.student_id = sps.student_id
    where sps.status = 'prescribed'
      and sps.item_id is not null
      and not exists (
        select 1 from pace_status ps
        where ps.student_id = sps.student_id and ps.item_id = sps.item_id
      )
  ),
  projected_slots as (
    select fs.*, sr.ship_on
    from free_slots fs
    join ship_ranked sr
      on sr.student_id = fs.student_id
     and sr.school_year = fs.school_year
     and sr.k = case when sr.annual then 1 else ceil(fs.rn / 3.0)::integer end
  ),
  projected_keys as (
    select k.id as item_id, ps.student_id, min(ps.ship_on) as ship_on
    from projected_slots ps
    join items k
      on k.item_type = 'key'
     and k.subject_id = ps.subject_id
     and k.range_start is not null and k.range_end is not null
     and ps.pace_number between k.range_start and k.range_end
    where not exists (
      select 1 from pick_list_items pli
      join pick_lists pl on pl.id = pli.pick_list_id
      where pl.student_id = ps.student_id and pli.item_id = k.id
    )
    group by k.id, ps.student_id
  ),
  demand as (
    select pli.item_id, greatest(pl.ship_date, v_today) as need_on,
           coalesce(pli.quantity_needed, 1)::integer as qty, true as is_open
    from pick_list_items pli
    join pick_lists pl on pl.id = pli.pick_list_id
    join live_students ls on ls.student_id = pl.student_id
    where pl.status not in ('shipped', 'cancelled')
      and pli.item_id is not null
    union all
    select oi.item_id, v_today, coalesce(oi.quantity, 1)::integer, true
    from order_items oi
    join orders o on o.id = oi.order_id
    left join families f on f.id = o.family_id
    where o.status in ('submitted', 'confirmed')
      and o.payment_status is distinct from 'refunded'
      and (p_include_test or not coalesce(f.is_test_account, false))
      and oi.item_id is not null
    union all
    select ps.item_id, ps.ship_on, 1, false from projected_slots ps
    union all
    select pk.item_id, pk.ship_on, 1, false from projected_keys pk
  ),
  stock as (
    select il.item_id, sum(il.quantity_on_hand)::integer as on_hand
    from inventory_levels il
    group by il.item_id
  ),
  running as (
    select d.item_id, d.need_on,
           sum(d.qty) over (partition by d.item_id order by d.need_on
                            rows between unbounded preceding and current row) as cum
    from demand d
  ),
  agg as (
    select d.item_id,
           sum(d.qty) filter (where d.is_open)::integer as open_qty,
           sum(d.qty) filter (where not d.is_open)::integer as proj_qty,
           sum(d.qty)::integer as total_qty
    from demand d
    group by d.item_id
  )
  select i.id,
         coalesce(i.original_name, i.sku, 'Item')::text,
         i.sku::text,
         i.item_type::text,
         s.on_hand,
         coalesce(a.open_qty, 0),
         coalesce(a.proj_qty, 0),
         a.total_qty,
         greatest(a.total_qty - coalesce(s.on_hand, 0), 0),
         (select min(r.need_on) from running r where r.item_id = a.item_id and r.cum > coalesce(s.on_hand, 0)),
         v_horizon,
         (s.item_id is not null)
  from agg a
  left join stock s on s.item_id = a.item_id
  join items i on i.id = a.item_id
  order by (s.item_id is not null) desc,
           greatest(a.total_qty - coalesce(s.on_hand, 0), 0) desc,
           (select min(r.need_on) from running r where r.item_id = a.item_id and r.cum > coalesce(s.on_hand, 0)) nulls last,
           i.original_name;
end;
$$;
revoke all on function public.mca_reorder_forecast(integer, boolean) from public;
grant execute on function public.mca_reorder_forecast(integer, boolean) to authenticated;

-- 5) Crons for the sms-webhooks function. Both do nothing unless that event's
--    switch is on in Settings.
do $$
begin
  perform cron.unschedule(jobid) from cron.job
   where jobname in ('mca-sms-webhook-shipped', 'mca-sms-webhook-overdue-daily');
end $$;

select cron.schedule(
  'mca-sms-webhook-shipped',
  '*/5 * * * *',
  $cron$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'mca_project_url')
           || '/functions/v1/sms-webhooks',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', (select decrypted_secret from vault.decrypted_secrets where name = 'mca_anon_key'),
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'mca_anon_key'),
      'x-cron-secret', public.mca_get_cron_secret()
    ),
    body := '{"action":"shipped_scan"}'::jsonb,
    timeout_milliseconds := 60000
  ) as request_id
  where coalesce((select value from public.app_settings where key = 'sms_webhook_enabled_shipped'), 'false') = 'true'
    and exists (
      select 1 from public.family_email_log l
      where l.kind = 'shipment'
        and l.created_at > now() - interval '2 days'
        and not exists (select 1 from public.sms_webhook_log s where s.dedupe_key = 'shipped:' || l.id::text)
    );
  $cron$
);

select cron.schedule(
  'mca-sms-webhook-overdue-daily',
  '45 13 * * *',
  $cron$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'mca_project_url')
           || '/functions/v1/sms-webhooks',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', (select decrypted_secret from vault.decrypted_secrets where name = 'mca_anon_key'),
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'mca_anon_key'),
      'x-cron-secret', public.mca_get_cron_secret()
    ),
    body := '{"action":"overdue_scan"}'::jsonb,
    timeout_milliseconds := 120000
  ) as request_id
  where coalesce((select value from public.app_settings where key = 'sms_webhook_enabled_overdue'), 'false') = 'true';
  $cron$
);
