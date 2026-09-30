-- Backordered pick-list lines and store order lines, with a fulfilled date.

alter table public.pick_list_items
  add column if not exists backorder_fulfilled_at timestamptz,
  add column if not exists backorder_fulfilled_by uuid;

alter table public.orders
  add column if not exists customer_name text,
  add column if not exists customer_email text;

alter table public.order_items
  add column if not exists backordered boolean not null default false,
  add column if not exists backorder_fulfilled_at timestamptz,
  add column if not exists backorder_fulfilled_by uuid;

create or replace view public.admin_backordered_items_v
with (security_invoker = true) as
select
  'pick_list'::text as source,
  pli.id as line_id,
  f.parent_name as customer_name,
  coalesce(i.original_name, 'Item') as item_name,
  pli.quantity_needed as quantity,
  coalesce(pl.ship_date::timestamptz, pl.created_at) as ordered_at,
  pli.backorder_fulfilled_at,
  pli.backordered
from public.pick_list_items pli
join public.pick_lists pl on pl.id = pli.pick_list_id
join public.students s on s.id = pl.student_id
join public.families f on f.id = s.family_id
left join public.items i on i.id = pli.item_id
where pli.backordered = true or pli.backorder_fulfilled_at is not null
union all
select
  'order'::text as source,
  oi.id as line_id,
  o.customer_name as customer_name,
  coalesce(i.original_name, 'Item') as item_name,
  oi.quantity as quantity,
  o.created_at as ordered_at,
  oi.backorder_fulfilled_at,
  oi.backordered
from public.order_items oi
join public.orders o on o.id = oi.order_id
left join public.items i on i.id = oi.item_id
where oi.backordered = true or oi.backorder_fulfilled_at is not null;

grant select on public.admin_backordered_items_v to authenticated;
