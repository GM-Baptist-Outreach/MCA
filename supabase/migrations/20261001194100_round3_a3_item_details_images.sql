-- Round 3 A3 (marker: MCA_R3_A3_ITEM_EDIT)
-- Item short description + photo, course photo fallback, public image bucket
-- (admin write). No order, checkout or webhook changes.

alter table public.items
  add column if not exists short_description text,
  add column if not exists image_path text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'items_short_description_len') then
    alter table public.items
      add constraint items_short_description_len
      check (short_description is null or char_length(short_description) <= 300);
  end if;
end $$;

alter table public.subjects
  add column if not exists image_path text;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('store-item-images', 'store-item-images', true, 5242880,
        array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

drop policy if exists store_item_images_admin_insert on storage.objects;
create policy store_item_images_admin_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'store-item-images' and public.is_admin());

drop policy if exists store_item_images_admin_update on storage.objects;
create policy store_item_images_admin_update on storage.objects
  for update to authenticated
  using (bucket_id = 'store-item-images' and public.is_admin())
  with check (bucket_id = 'store-item-images' and public.is_admin());

drop policy if exists store_item_images_admin_delete on storage.objects;
create policy store_item_images_admin_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'store-item-images' and public.is_admin());

drop policy if exists store_item_images_admin_select on storage.objects;
create policy store_item_images_admin_select on storage.objects
  for select to authenticated
  using (bucket_id = 'store-item-images' and public.is_admin());

-- order_items / checkout / webhook are intentionally untouched.
