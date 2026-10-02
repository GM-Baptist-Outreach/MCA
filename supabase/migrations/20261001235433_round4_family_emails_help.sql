-- Round 4: shipment email + overdue test-upload nudge (Resend), test-account
-- exclusion, admin on/off switches, and an email log.
-- Only events AFTER this migration count: the shipment trigger fires on a
-- status change, and the overdue rule ignores PACEs issued on or before the
-- go-live date stored in app_settings.family_emails_live_since.

-- 1) Tracking info on shipments (optional, entered by staff when marking shipped)
alter table public.pick_lists
  add column if not exists tracking_number text,
  add column if not exists tracking_url text,
  add column if not exists shipped_at timestamptz;
alter table public.orders
  add column if not exists tracking_number text,
  add column if not exists tracking_url text,
  add column if not exists shipped_at timestamptz;

-- 2) Test accounts never receive automatic family emails
alter table public.families
  add column if not exists is_test_account boolean not null default false;
comment on column public.families.is_test_account is
  'Staff/test family. Automatic family emails (shipment, overdue nudge) are skipped.';
update public.families set is_test_account = true
where id in ('a0f418c5-7ead-43c3-bff6-0eda2ab41763',  -- Chase Kelly (Chase Test Student)
             '54cece29-915b-490d-92be-55d6f4c1b7b4'); -- David Moore (Test Parent)

-- 3) Switches. Shipping ON, overdue nudge OFF until Chase confirms.
insert into public.app_settings (key, value) values
  ('email_shipping_enabled', 'true'),
  ('email_overdue_nudge_enabled', 'false'),
  ('family_emails_live_since', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'))
on conflict (key) do nothing;

create or replace function public.app_settings_validate()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.key = 'payment_mode' and new.value not in ('test', 'live') then
    raise exception 'payment_mode must be test or live';
  end if;
  if new.key in ('email_shipping_enabled', 'email_overdue_nudge_enabled')
     and new.value not in ('true', 'false') then
    raise exception '% must be true or false', new.key;
  end if;
  if tg_op = 'UPDATE' and old.key = 'family_emails_live_since' and new.value is distinct from old.value then
    raise exception 'family_emails_live_since cannot be changed';
  end if;
  new.updated_at := now();
  if auth.uid() is not null then
    new.updated_by := auth.uid();
  end if;
  return new;
end;
$$;

-- 4) Email log / queue
create table if not exists public.family_email_log (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('shipment', 'overdue_test')),
  dedupe_key text not null unique,
  family_id uuid references public.families(id) on delete set null,
  student_id uuid references public.students(id) on delete set null,
  order_id uuid references public.orders(id) on delete set null,
  pick_list_id uuid references public.pick_lists(id) on delete set null,
  pace_slot_id uuid references public.student_pace_slots(id) on delete set null,
  to_email text,
  status text not null default 'pending'
    check (status in ('pending', 'sending', 'sent', 'skipped', 'failed')),
  detail text,
  attempts integer not null default 0,
  batch_id uuid,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);
create index if not exists family_email_log_status_idx on public.family_email_log (status, created_at);
create index if not exists family_email_log_family_idx on public.family_email_log (family_id, kind, sent_at);
create index if not exists family_email_log_student_idx on public.family_email_log (student_id);
create index if not exists family_email_log_order_idx on public.family_email_log (order_id);
create index if not exists family_email_log_pick_idx on public.family_email_log (pick_list_id);
create index if not exists family_email_log_slot_idx on public.family_email_log (pace_slot_id);

alter table public.family_email_log enable row level security;
revoke all on public.family_email_log from anon;
grant select on public.family_email_log to authenticated;
grant all on public.family_email_log to service_role;
drop policy if exists admin_read on public.family_email_log;
create policy admin_read on public.family_email_log
  for select to authenticated using (public.is_admin());

-- 5) Shipment trigger: pick list -> shipped, or a ship-to-home store order -> fulfilled
create or replace function public.mca_queue_shipment_email()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_enabled boolean;
  v_key text;
  v_family uuid;
  v_student uuid;
  v_email text;
  v_test boolean := false;
  v_status text := 'pending';
  v_detail text;
  v_id uuid;
begin
  if tg_table_name = 'pick_lists' then
    if new.status is distinct from 'shipped' or old.status = 'shipped' then return new; end if;
    v_key := 'shipment:pick_list:' || new.id;
    v_student := new.student_id;
    select s.family_id, f.email, f.is_test_account into v_family, v_email, v_test
      from students s left join families f on f.id = s.family_id where s.id = new.student_id;
  else
    if new.status is distinct from 'fulfilled' or old.status = 'fulfilled'
       or coalesce(btrim(new.shipping_address), '') = '' then
      return new; -- local pickup or not a new fulfillment
    end if;
    v_key := 'shipment:order:' || new.id;
    v_family := new.family_id;
    v_student := new.student_id;
    select f.is_test_account, f.email into v_test, v_email from families f where f.id = new.family_id;
    v_email := coalesce(nullif(btrim(new.customer_email), ''), v_email);
    if not coalesce(v_test, false) then
      select bool_or(f.is_test_account) into v_test from families f where lower(f.email) = lower(v_email);
    end if;
  end if;

  if new.shipped_at is null then new.shipped_at := now(); end if;

  v_enabled := coalesce((select value from app_settings where key = 'email_shipping_enabled'), 'true') = 'true';
  if not v_enabled then
    v_status := 'skipped'; v_detail := 'Shipping emails are turned off';
  elsif coalesce(v_test, false) then
    v_status := 'skipped'; v_detail := 'Test account';
  elsif coalesce(btrim(v_email), '') = '' then
    v_status := 'skipped'; v_detail := 'No parent email';
  end if;

  insert into family_email_log (kind, dedupe_key, family_id, student_id, order_id, pick_list_id, to_email, status, detail)
  values ('shipment', v_key, v_family, v_student,
          case when tg_table_name = 'orders' then new.id end,
          case when tg_table_name = 'pick_lists' then new.id end,
          v_email, v_status, v_detail)
  on conflict (dedupe_key) do nothing
  returning id into v_id;

  if v_id is not null and v_status = 'pending' then
    begin
      perform net.http_post(
        url := (select decrypted_secret from vault.decrypted_secrets where name = 'mca_project_url')
               || '/functions/v1/family-emails',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'apikey', (select decrypted_secret from vault.decrypted_secrets where name = 'mca_anon_key'),
          'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'mca_anon_key'),
          'x-cron-secret', public.mca_get_cron_secret()
        ),
        body := jsonb_build_object('action', 'send_pending'),
        timeout_milliseconds := 30000
      );
    exception when others then
      -- the 15-minute backstop cron sends it instead
      raise warning 'family-emails kick failed: %', sqlerrm;
    end;
  end if;
  return new;
end;
$$;
revoke execute on function public.mca_queue_shipment_email() from public, anon, authenticated;

drop trigger if exists pick_lists_queue_shipment_email on public.pick_lists;
create trigger pick_lists_queue_shipment_email
  before update of status on public.pick_lists
  for each row execute function public.mca_queue_shipment_email();
drop trigger if exists orders_queue_shipment_email on public.orders;
create trigger orders_queue_shipment_email
  before update of status on public.orders
  for each row execute function public.mca_queue_shipment_email();

-- 6) New editable templates
insert into public.email_templates (key, name, description, subject, body_html, enabled, variables, default_subject, default_body_html)
values
(
  'shipment_notice',
  'Shipment on the way',
  'Sent when staff marks a pick list shipped, or marks a ship-to-home store order Fulfilled. Turn it on or off under Automatic emails above.',
  'Your Midwest Christian Academy shipment is on the way',
  $b1$<div style="font-family: Georgia, serif; color: #1a1a2e; max-width: 600px;">
  <h2>Your shipment is on the way</h2>
  <p>Hi {{parent_first_name}},</p>
  <p>Good news! We just shipped {{shipment_label}}. Here's what's in the box:</p>
  {{shipment_items}}
  {{tracking_line}}
  <p>When PACEs arrive, sign in to the Parent Portal, open <strong>PACE Status</strong>, and click <strong>Receive All</strong> so we know they made it: <a href="{{portal_url}}">{{portal_url}}</a></p>
  <p>If anything is missing or damaged, just reply to this email or call (844) 663-4477.</p>
  <p>Midwest Christian Academy</p>
</div>$b1$,
  true,
  jsonb_build_array('parent_first_name', 'student_name', 'shipment_label', 'shipment_items', 'tracking_line', 'tracking_number', 'tracking_url', 'portal_url'),
  'Your Midwest Christian Academy shipment is on the way',
  $b1$<div style="font-family: Georgia, serif; color: #1a1a2e; max-width: 600px;">
  <h2>Your shipment is on the way</h2>
  <p>Hi {{parent_first_name}},</p>
  <p>Good news! We just shipped {{shipment_label}}. Here's what's in the box:</p>
  {{shipment_items}}
  {{tracking_line}}
  <p>When PACEs arrive, sign in to the Parent Portal, open <strong>PACE Status</strong>, and click <strong>Receive All</strong> so we know they made it: <a href="{{portal_url}}">{{portal_url}}</a></p>
  <p>If anything is missing or damaged, just reply to this email or call (844) 663-4477.</p>
  <p>Midwest Christian Academy</p>
</div>$b1$
),
(
  'overdue_test_nudge',
  'Test upload reminder (overdue)',
  'A gentle reminder when a PACE was handed out 28+ days ago and no test has been uploaded. At most once per PACE and once per family per week. Off until turned on under Automatic emails above.',
  'A quick reminder: PACE tests to upload',
  $b2$<div style="font-family: Georgia, serif; color: #1a1a2e; max-width: 600px;">
  <p>Hi {{parent_first_name}},</p>
  <p>Our records show these PACEs were handed out a few weeks ago, but we haven't received the test scores yet:</p>
  {{overdue_list}}
  <p>When the tests are done, please upload a photo of each one in the Parent Portal under <strong>Upload Tests</strong>: <a href="{{portal_url}}">{{portal_url}}</a></p>
  <p>If you've already sent them, or your student is still working, thank you! You can ignore this note.</p>
  <p>Midwest Christian Academy · (844) 663-4477</p>
</div>$b2$,
  true,
  jsonb_build_array('parent_first_name', 'student_names', 'overdue_list', 'portal_url'),
  'A quick reminder: PACE tests to upload',
  $b2$<div style="font-family: Georgia, serif; color: #1a1a2e; max-width: 600px;">
  <p>Hi {{parent_first_name}},</p>
  <p>Our records show these PACEs were handed out a few weeks ago, but we haven't received the test scores yet:</p>
  {{overdue_list}}
  <p>When the tests are done, please upload a photo of each one in the Parent Portal under <strong>Upload Tests</strong>: <a href="{{portal_url}}">{{portal_url}}</a></p>
  <p>If you've already sent them, or your student is still working, thank you! You can ignore this note.</p>
  <p>Midwest Christian Academy · (844) 663-4477</p>
</div>$b2$
)
on conflict (key) do nothing;

-- 7) Crons (offset from 12:00 / 12:10 / 12:20 UTC jobs)
do $$
begin
  perform cron.unschedule(jobid) from cron.job where jobname in ('mca-family-emails-backstop', 'mca-overdue-test-nudge-daily');
end $$;

select cron.schedule(
  'mca-family-emails-backstop',
  '7,22,37,52 * * * *',
  $cron$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'mca_project_url')
           || '/functions/v1/family-emails',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', (select decrypted_secret from vault.decrypted_secrets where name = 'mca_anon_key'),
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'mca_anon_key'),
      'x-cron-secret', public.mca_get_cron_secret()
    ),
    body := '{"action":"send_pending"}'::jsonb,
    timeout_milliseconds := 60000
  ) as request_id
  where exists (
    select 1 from public.family_email_log
    where status = 'pending' or (status = 'failed' and attempts < 3)
  );
  $cron$
);

select cron.schedule(
  'mca-overdue-test-nudge-daily',
  '40 13 * * *',
  $cron$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'mca_project_url')
           || '/functions/v1/family-emails',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', (select decrypted_secret from vault.decrypted_secrets where name = 'mca_anon_key'),
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'mca_anon_key'),
      'x-cron-secret', public.mca_get_cron_secret()
    ),
    body := '{"action":"overdue_nudges"}'::jsonb,
    timeout_milliseconds := 120000
  ) as request_id
  where coalesce((select value from public.app_settings where key = 'email_overdue_nudge_enabled'), 'false') = 'true';
  $cron$
);
