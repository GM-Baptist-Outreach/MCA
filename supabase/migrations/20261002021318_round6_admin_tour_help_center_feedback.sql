-- Round 6: admin spotlight tour dismissal, admin Help Center files, admin feedback.

-- 1) Admin tour: remember dismissal per admin user. admin_users is already
--    admin-only (admin_full_access: is_admin()); the app only updates the
--    signed-in admin's own row (auth_user_id = auth.uid()).
alter table public.admin_users
  add column if not exists tour_dismissed_at timestamptz;
comment on column public.admin_users.tour_dismissed_at is
  'When this admin dismissed the admin spotlight tour. NULL = show it on next admin load.';

-- 2) Feedback sent from the admin Help Center. Rows are written by the
--    admin-feedback edge function (service role); admins can read them.
create table if not exists public.admin_feedback (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  admin_user_id uuid references auth.users(id) on delete set null,
  admin_name text,
  admin_email text,
  topic text not null,
  message text not null,
  page_url text,
  screenshot_path text,
  email_to text,
  email_status text not null default 'pending'
    check (email_status in ('pending', 'sent', 'failed')),
  email_error text,
  resend_id text,
  delivery_status text,
  delivery_checked_at timestamptz
);
create index if not exists admin_feedback_created_at_idx on public.admin_feedback (created_at desc);
create index if not exists admin_feedback_admin_user_id_idx on public.admin_feedback (admin_user_id);
alter table public.admin_feedback enable row level security;
drop policy if exists admin_feedback_admin_read on public.admin_feedback;
create policy admin_feedback_admin_read on public.admin_feedback
  for select to authenticated using ((select public.is_admin()));
revoke insert, update, delete, truncate on public.admin_feedback from anon, authenticated;

-- 3) Storage: public Help Center files (guide PDF, help screenshots) that only
--    admins can upload, and private feedback screenshots.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('help-center', 'help-center', true, 26214400,
   array['application/pdf', 'image/jpeg', 'image/png', 'image/webp']),
  ('admin-feedback', 'admin-feedback', false, 10485760,
   array['image/jpeg', 'image/png', 'image/webp', 'image/gif'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists help_center_admin_insert on storage.objects;
create policy help_center_admin_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'help-center' and (select public.is_admin()));
drop policy if exists help_center_admin_update on storage.objects;
create policy help_center_admin_update on storage.objects
  for update to authenticated
  using (bucket_id = 'help-center' and (select public.is_admin()))
  with check (bucket_id = 'help-center' and (select public.is_admin()));
drop policy if exists help_center_admin_select on storage.objects;
create policy help_center_admin_select on storage.objects
  for select to authenticated
  using (bucket_id = 'help-center' and (select public.is_admin()));
drop policy if exists help_center_admin_delete on storage.objects;
create policy help_center_admin_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'help-center' and (select public.is_admin()));

drop policy if exists admin_feedback_files_insert on storage.objects;
create policy admin_feedback_files_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'admin-feedback'
    and (select public.is_admin())
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );
drop policy if exists admin_feedback_files_select on storage.objects;
create policy admin_feedback_files_select on storage.objects
  for select to authenticated
  using (bucket_id = 'admin-feedback' and (select public.is_admin()));
