-- Smoke2 decisions 2, 4 and 5.

-- Decision 2: the public store shows in stock / out of stock only.
-- Shoppers never read inventory_levels; this returns just the ids of active,
-- stock-tracked items with nothing on hand (no counts, no locations).
create or replace function public.store_out_of_stock_item_ids()
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select il.item_id
  from inventory_levels il
  join items i on i.id = il.item_id and i.active = true
  group by il.item_id
  having coalesce(sum(il.quantity_on_hand), 0) <= 0
$$;

revoke all on function public.store_out_of_stock_item_ids() from public;
grant execute on function public.store_out_of_stock_item_ids() to anon, authenticated, service_role;

-- Decision 4: item prices can't be negative.
alter table public.items
  add constraint items_sales_price_nonnegative check (sales_price >= 0),
  add constraint items_purchase_price_nonnegative check (purchase_price is null or purchase_price >= 0);

-- Decision 4: photo buckets take images up to 25 MB, including iPhone HEIC/HEIF.
update storage.buckets
set file_size_limit = 26214400,
    allowed_mime_types = array[
      'image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif', 'image/heic', 'image/heif'
    ]
where id in ('test-score-photos', 'store-item-images');

-- Decision 5: drop the duplicate unique index on inventory_levels(item_id, location_id).
-- inventory_levels_item_id_location_id_key (from the initial schema) stays.
alter table public.inventory_levels drop constraint if exists inventory_levels_item_location_unique;

-- Decision 5: evaluate auth.uid() once per query instead of once per row.
-- Same rules as before; only auth.uid() is wrapped as (select auth.uid()).
alter policy "parent_select_own_family" on public.families
  using (auth_user_id = (select auth.uid()));

alter policy "parent_update_own_family" on public.families
  using (auth_user_id = (select auth.uid()))
  with check (auth_user_id = (select auth.uid()));

alter policy "parent_select_own_students" on public.students
  using (family_id IN ( SELECT families.id
   FROM families
  WHERE (families.auth_user_id = (select auth.uid()))));

alter policy "parent_select_own_enrollments" on public.enrollments
  using (student_id IN ( SELECT s.id
   FROM (students s
     JOIN families f ON ((f.id = s.family_id)))
  WHERE (f.auth_user_id = (select auth.uid()))));

alter policy "parent_select_own_score_reports" on public.score_reports
  using (student_id IN ( SELECT s.id
   FROM (students s
     JOIN families f ON ((f.id = s.family_id)))
  WHERE (f.auth_user_id = (select auth.uid()))));

alter policy "parent_insert_own_score_reports" on public.score_reports
  with check (student_id IN ( SELECT s.id
   FROM (students s
     JOIN families f ON ((f.id = s.family_id)))
  WHERE (f.auth_user_id = (select auth.uid()))));

alter policy "parent_select_own_orders" on public.orders
  using (family_id IN ( SELECT families.id
   FROM families
  WHERE (families.auth_user_id = (select auth.uid()))));

alter policy "parent_select_own_order_items" on public.order_items
  using (order_id IN ( SELECT o.id
   FROM (orders o
     JOIN families f ON ((f.id = o.family_id)))
  WHERE (f.auth_user_id = (select auth.uid()))));

alter policy "parent_select_own_course_completions" on public.course_completions
  using (student_id IN ( SELECT s.id
   FROM (students s
     JOIN families f ON ((f.id = s.family_id)))
  WHERE (f.auth_user_id = (select auth.uid()))));

alter policy "parent_insert_own_form_submissions" on public.form_submissions
  with check (family_id IN ( SELECT families.id
   FROM families
  WHERE (families.auth_user_id = (select auth.uid()))));

alter policy "parent_select_own_form_submissions" on public.form_submissions
  using (family_id IN ( SELECT families.id
   FROM families
  WHERE (families.auth_user_id = (select auth.uid()))));

alter policy "parent_select_own_pace_plans" on public.required_pace_plans
  using (student_id IN ( SELECT s.id
   FROM (students s
     JOIN families f ON ((f.id = s.family_id)))
  WHERE (f.auth_user_id = (select auth.uid()))));

alter policy "parent_select_own_pace_status" on public.pace_status
  using (student_id IN ( SELECT s.id
   FROM (students s
     JOIN families f ON ((f.id = s.family_id)))
  WHERE (f.auth_user_id = (select auth.uid()))));

alter policy "parent_update_own_pace_status" on public.pace_status
  using (student_id IN ( SELECT s.id
   FROM (students s
     JOIN families f ON ((f.id = s.family_id)))
  WHERE (f.auth_user_id = (select auth.uid()))))
  with check (student_id IN ( SELECT s.id
   FROM (students s
     JOIN families f ON ((f.id = s.family_id)))
  WHERE (f.auth_user_id = (select auth.uid()))));

alter policy "parent_insert_own_pace_status" on public.pace_status
  with check (student_id IN ( SELECT s.id
   FROM (students s
     JOIN families f ON ((f.id = s.family_id)))
  WHERE (f.auth_user_id = (select auth.uid()))));

alter policy "parents read own pace slots" on public.student_pace_slots
  using (EXISTS ( SELECT 1
   FROM (students s
     JOIN families f ON ((f.id = s.family_id)))
  WHERE ((s.id = student_pace_slots.student_id) AND (f.auth_user_id = (select auth.uid())))));

alter policy "parents read own ship schedules" on public.student_ship_schedules
  using (EXISTS ( SELECT 1
   FROM (students s
     JOIN families f ON ((f.id = s.family_id)))
  WHERE ((s.id = student_ship_schedules.student_id) AND (f.auth_user_id = (select auth.uid())))));

alter policy "parent_select_own_school_calendar" on public.student_school_calendars
  using (EXISTS ( SELECT 1
   FROM (students s
     JOIN families f ON ((f.id = s.family_id)))
  WHERE ((s.id = student_school_calendars.student_id) AND (f.auth_user_id = (select auth.uid())))));

alter policy "parent_select_own_resource_books" on public.resource_book_notices
  using (EXISTS ( SELECT 1
   FROM (students s
     JOIN families f ON ((f.id = s.family_id)))
  WHERE ((s.id = resource_book_notices.student_id) AND (f.auth_user_id = (select auth.uid())))));
