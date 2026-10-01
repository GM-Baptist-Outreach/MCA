-- Round 2 verification fixes (2026-10-01)
-- Applied to prod as version 20261001135658 via Supabase MCP.

-- 1) Daily resource-book notification email. The SQL pick-list generator records
--    resource_book_notices but never emails; this job asks the edge function to
--    email any pending notices (notified_at is null) 20 minutes after generation.
select cron.unschedule(jobid) from cron.job where jobname = 'mca-notify-resource-books-daily';

select cron.schedule(
  'mca-notify-resource-books-daily',
  '20 12 * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'mca_project_url')
           || '/functions/v1/generate-pick-lists',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', (select decrypted_secret from vault.decrypted_secrets where name = 'mca_anon_key'),
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'mca_anon_key'),
      'x-cron-secret', public.mca_get_cron_secret()
    ),
    body := '{"action":"notify_resource_books"}'::jsonb,
    timeout_milliseconds := 60000
  ) as request_id;
  $$
);

-- 2) Backordered page: "Date Ordered" for pick-list lines. ship_date is a date;
--    casting it to timestamptz gives UTC midnight, which shows as the previous
--    day in Central/Eastern time. Use the pick list's created_at instead.
create or replace view public.admin_backordered_items_v
with (security_invoker = true) as
 select 'pick_list'::text as source,
    pli.id as line_id,
    f.parent_name as customer_name,
    coalesce(i.original_name, 'Item'::text) as item_name,
    pli.quantity_needed as quantity,
    pl.created_at as ordered_at,
    pli.backorder_fulfilled_at,
    pli.backordered
   from pick_list_items pli
     join pick_lists pl on pl.id = pli.pick_list_id
     join students s on s.id = pl.student_id
     join families f on f.id = s.family_id
     left join items i on i.id = pli.item_id
  where pli.backordered = true or pli.backorder_fulfilled_at is not null
union all
 select 'order'::text as source,
    oi.id as line_id,
    o.customer_name,
    coalesce(i.original_name, 'Item'::text) as item_name,
    oi.quantity,
    o.created_at as ordered_at,
    oi.backorder_fulfilled_at,
    oi.backordered
   from order_items oi
     join orders o on o.id = oi.order_id
     left join items i on i.id = oi.item_id
  where oi.backordered = true or oi.backorder_fulfilled_at is not null;

-- 3) Email template variable chips: only offer variables the senders fill in.
update public.email_templates set variables = jsonb_build_array('student_list', 'portal_url')
 where key in ('welcome_paid', 'enrollment_added_paid', 'welcome_comp', 'enrollment_added_comp');
update public.email_templates set variables = jsonb_build_array('parent_first_name', 'student_name', 'frequency', 'price', 'checkout_url')
 where key = 'payment_link';
update public.email_templates set variables = jsonb_build_array('order_items', 'fulfillment_line', 'order_total')
 where key = 'store_order_confirmed';

-- 4) Hide the empty "Uncategorized" subject from the store filter.
update public.subjects set store_visible = false where name = 'Uncategorized';
